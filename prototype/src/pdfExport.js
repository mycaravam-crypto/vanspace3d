import { jsPDF } from 'jspdf';
import { vanState, objects } from './state.js';
import { computeCenterOfGravity } from './cog.js';
import { DEFAULT_WEIGHT } from './objects.js';
import { sanitizeFilename } from './persistence.js';

// ==========================================
// PDF EXPORT — a one-page (or more, if the BOM overflows) "Packplan":
// a to-scale top-down schematic of the van + placed objects, followed by a
// bill-of-materials table. Complements the plain-text packing list
// (generatePackingListText() in persistence.js) with something meant to be
// printed and taken along, not just read on screen.
// ==========================================
const PAGE_MARGIN = 15; // mm
const SCHEMATIC_TOP = 26; // mm — below the title block
const SCHEMATIC_HEIGHT = 95; // mm — reserved drawing height for the top-down view
const LEGEND_HEIGHT = 14; // mm — scale bar + compass captions below the drawing
const ROW_HEIGHT = 6; // mm — BOM table row height
const BOM_COLUMNS = [
    { label: 'Nr.', x: 0, width: 10 },
    { label: 'Name', x: 10, width: 68 },
    { label: 'Maße B×T×H (cm)', x: 78, width: 45 },
    { label: 'Gewicht (kg)', x: 123, width: 25 },
    { label: 'Status', x: 148, width: 40 },
];
const LOCKED_RGB = [239, 68, 68]; // matches LOCKED_EDGE_COLOR (objects.js)
const FIXED_RGB = [120, 113, 108]; // matches FIXED_EDGE_COLOR (objects.js)
const FIXED_FILL_RGB = [214, 211, 209];

function formatOffsetCm(value, positiveLabel, negativeLabel) {
    return value >= 0 ? `${Math.round(value * 100)}cm ${positiveLabel}` : `${Math.round(-value * 100)}cm ${negativeLabel}`;
}

// The van's stepped top-down footprint as a list of {x, z, w, d} rectangles
// (van-space meters; x = left/right, z = front/back; w/d are full extents,
// not half-extents) — the same front-wide/rear-narrow/wheel-arch shape
// buildVanGeometry() (van.js) draws in 3D, flattened for the 2D schematic.
// Exported for testing; pure function of vanState.
export function vanFootprintRects() {
    const rects = [];
    const zFrontStart = -vanState.length / 2;
    const zSplit = zFrontStart + vanState.frontLength;
    const rearLength = Math.max(0, vanState.length - vanState.frontLength);
    const hasFront = vanState.frontLength > 0.01;
    const hasRear = rearLength > 0.01;

    if (hasFront) {
        rects.push({
            x: 0, z: zFrontStart + vanState.frontLength / 2, w: vanState.maxWidth, d: vanState.frontLength,
        });
    }
    if (hasRear) {
        // The rear's *floor* footprint is only narrowWidth wide — maxWidth is
        // reached again above the wheel arches, but that upper-zone width
        // doesn't exist at floor level, so a top-down view has no business
        // drawing it. The wheel-arch rects below fill in the rest of the van's
        // full-width silhouette at floor level.
        rects.push({
            x: 0, z: zSplit + rearLength / 2, w: vanState.narrowWidth, d: rearLength,
        });

        const archWidth = Math.max(0, (vanState.maxWidth - vanState.narrowWidth) / 2);
        if (archWidth > 0.01) {
            rects.push({
                x: -vanState.narrowWidth / 2 - archWidth / 2, z: zSplit + rearLength / 2, w: archWidth, d: rearLength, arch: true,
            });
            rects.push({
                x: vanState.narrowWidth / 2 + archWidth / 2, z: zSplit + rearLength / 2, w: archWidth, d: rearLength, arch: true,
            });
        }
    }
    return rects;
}

function drawTitleBlock(doc) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text('VanSpace 3D – Packplan', PAGE_MARGIN, 13);

    const dims = `${Math.round(vanState.length * 100)}×${Math.round(vanState.maxWidth * 100)}×${Math.round(vanState.maxHeight * 100)} cm`;
    const dateStr = new Date().toLocaleDateString('de-DE');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Laderaum ${dims} · erstellt am ${dateStr}`, PAGE_MARGIN, 19);
}

// Draws the to-scale top-down schematic (van outline + numbered object
// footprints + center-of-gravity marker) and returns the y-coordinate (mm)
// where the BOM table can safely start.
function drawSchematic(doc) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const availWidth = pageWidth - PAGE_MARGIN * 2;

    // mm per meter — whichever axis is tighter sets the scale, so the whole
    // van fits within the reserved drawing box regardless of its proportions.
    const scale = Math.min(availWidth / vanState.length, SCHEMATIC_HEIGHT / vanState.maxWidth);
    const drawW = vanState.length * scale;
    const drawH = vanState.maxWidth * scale;
    const originX = PAGE_MARGIN + (availWidth - drawW) / 2; // centered horizontally
    const originY = SCHEMATIC_TOP;

    // z (front/back) maps to the page's horizontal axis (front reads left),
    // x (left/right) maps to the page's vertical axis — a floor plan read
    // left-to-right as front-to-back of the vehicle.
    const toPage = (x, z) => ({
        px: originX + (z + vanState.length / 2) * scale,
        py: originY + (x + vanState.maxWidth / 2) * scale,
    });

    // Van outline
    doc.setLineDashPattern([], 0);
    doc.setLineWidth(0.4);
    vanFootprintRects().forEach((r) => {
        const { px, py } = toPage(r.x - r.w / 2, r.z - r.d / 2);
        const w = r.d * scale;
        const h = r.w * scale;
        if (r.arch) {
            doc.setDrawColor(140, 140, 140);
            doc.setFillColor(225, 225, 225);
            doc.rect(px, py, w, h, 'FD');
        } else {
            doc.setDrawColor(80, 80, 80);
            doc.rect(px, py, w, h, 'D');
        }
    });

    // Objects, numbered in the same order as the BOM table below so each
    // footprint can be looked up by its row.
    objects.forEach((obj, i) => {
        const { width, height, depth } = obj.geometry.parameters;
        const { px, py } = toPage(obj.position.x - width / 2, obj.position.z - depth / 2);
        const w = depth * scale;
        const h = width * scale;
        const fixed = !!obj.userData.fixed;
        const locked = !!obj.userData.locked;

        doc.setLineDashPattern(locked && !fixed ? [1, 0.7] : [], 0);
        doc.setLineWidth(fixed || locked ? 0.6 : 0.3);
        if (fixed) {
            doc.setDrawColor(...FIXED_RGB);
            doc.setFillColor(...FIXED_FILL_RGB);
        } else {
            const col = obj.material.color;
            doc.setDrawColor(locked ? LOCKED_RGB[0] : 40, locked ? LOCKED_RGB[1] : 40, locked ? LOCKED_RGB[2] : 40);
            doc.setFillColor(Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255));
        }
        doc.rect(px, py, w, h, 'FD');

        // Skip the call-out number on a footprint too small to hold it
        // legibly rather than spilling text outside the box.
        if (w >= 5 && h >= 4) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7);
            doc.setTextColor(15, 23, 42);
            doc.text(String(i + 1), px + w / 2, py + h / 2, { align: 'center', baseline: 'middle' });
        }
    });
    doc.setLineDashPattern([], 0);
    doc.setLineWidth(0.2);

    // Center of gravity marker, same red used for the 3D marker (cog.js).
    const cog = computeCenterOfGravity();
    if (cog) {
        const { px, py } = toPage(cog.x, cog.z);
        doc.setDrawColor(...LOCKED_RGB);
        doc.setFillColor(255, 255, 255);
        doc.circle(px, py, 1.6, 'FD');
        doc.setLineWidth(0.25);
        doc.line(px - 2.4, py, px + 2.4, py);
        doc.line(px, py - 2.4, px, py + 2.4);
    }

    // Compass captions along the drawing's edges.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('VORNE', originX, originY - 2);
    doc.text('HINTEN', originX + drawW, originY - 2, { align: 'right' });
    doc.text('LINKS', originX - 2, originY + 3, { align: 'right', angle: 90 });
    doc.text('RECHTS', originX - 2, originY + drawH, { align: 'right', angle: 90 });

    // Scale bar — a fixed 50cm reference length, positioned under the drawing.
    const barY = originY + drawH + 6;
    const barLenM = 0.5;
    const barLenMm = barLenM * scale;
    doc.setDrawColor(100, 116, 139);
    doc.setLineWidth(0.3);
    doc.line(originX, barY, originX + barLenMm, barY);
    doc.line(originX, barY - 1, originX, barY + 1);
    doc.line(originX + barLenMm, barY - 1, originX + barLenMm, barY + 1);
    doc.text(`${Math.round(barLenM * 100)} cm`, originX + barLenMm + 2, barY + 1);

    // Legend
    const legendX = originX + barLenMm + 25;
    doc.setFillColor(214, 211, 209);
    doc.setDrawColor(...FIXED_RGB);
    doc.rect(legendX, barY - 3, 4, 3, 'FD');
    doc.text('Fest verbaut', legendX + 6, barY);
    doc.setLineDashPattern([1, 0.7], 0);
    doc.setDrawColor(...LOCKED_RGB);
    doc.setFillColor(255, 255, 255);
    doc.rect(legendX + 35, barY - 3, 4, 3, 'FD');
    doc.setLineDashPattern([], 0);
    doc.text('Gesperrt', legendX + 41, barY);
    doc.setDrawColor(...LOCKED_RGB);
    doc.circle(legendX + 62, barY - 1.5, 1.4, 'D');
    doc.text('Schwerpunkt', legendX + 66, barY);

    return originY + SCHEMATIC_HEIGHT + LEGEND_HEIGHT;
}

function drawBomHeader(doc, y) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    BOM_COLUMNS.forEach((col) => doc.text(col.label, PAGE_MARGIN + col.x, y));
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.2);
    doc.line(PAGE_MARGIN, y + 2, PAGE_MARGIN + 188, y + 2);
    return y + ROW_HEIGHT;
}

// Truncates a name to fit its column instead of letting it run into the
// next one — this is a fixed-width text layout, not a real table with
// per-cell clipping.
function fitText(doc, text, maxWidthMm) {
    if (doc.getTextWidth(text) <= maxWidthMm) return text;
    let truncated = text;
    while (truncated.length > 1 && doc.getTextWidth(`${truncated}…`) > maxWidthMm) {
        truncated = truncated.slice(0, -1);
    }
    return `${truncated}…`;
}

// Renders the bill-of-materials table starting at `startY`, breaking to a
// new page (with the header repeated) whenever a row would overflow the
// page's bottom margin. Returns the y-coordinate (mm, on whichever page
// ended up current) just below the last thing drawn, so the summary block
// can be placed right after it regardless of how many page breaks happened.
function drawBom(doc, startY) {
    const pageHeight = doc.internal.pageSize.getHeight();
    let y = drawBomHeader(doc, startY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);

    if (objects.length === 0) {
        doc.setTextColor(100, 116, 139);
        doc.text('Keine Objekte platziert.', PAGE_MARGIN, y);
        return y + ROW_HEIGHT;
    }

    objects.forEach((obj, i) => {
        if (y + ROW_HEIGHT > pageHeight - PAGE_MARGIN) {
            doc.addPage();
            y = drawBomHeader(doc, PAGE_MARGIN + 5);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
        }

        const { width, height, depth } = obj.geometry.parameters;
        const fixed = !!obj.userData.fixed;
        const locked = !!obj.userData.locked;
        const label = obj.userData.label || 'Objekt';
        const dims = `${Math.round(width * 100)}×${Math.round(depth * 100)}×${Math.round(height * 100)}`;
        const weight = fixed ? '–' : (obj.userData.weight ?? DEFAULT_WEIGHT).toFixed(1);
        const status = fixed ? 'Fest verbaut' : (locked ? 'Gesperrt' : '–');

        doc.setTextColor(30, 41, 59);
        doc.text(String(i + 1), PAGE_MARGIN + BOM_COLUMNS[0].x, y);
        doc.text(fitText(doc, label, BOM_COLUMNS[1].width - 2), PAGE_MARGIN + BOM_COLUMNS[1].x, y);
        doc.text(dims, PAGE_MARGIN + BOM_COLUMNS[2].x, y);
        doc.text(weight, PAGE_MARGIN + BOM_COLUMNS[3].x, y);
        doc.text(status, PAGE_MARGIN + BOM_COLUMNS[4].x, y);

        y += ROW_HEIGHT;
    });

    return y;
}

function drawSummary(doc, y) {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (y + ROW_HEIGHT * 3 > pageHeight - PAGE_MARGIN) {
        doc.addPage();
        y = PAGE_MARGIN;
    }

    const cog = computeCenterOfGravity();
    const totalWeight = cog ? cog.totalWeight : 0;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(`Gesamtgewicht: ${totalWeight.toFixed(1)} kg von ${vanState.maxPayload} kg Zuladung`, PAGE_MARGIN, y);

    if (cog) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        const pos = `${formatOffsetCm(cog.x, 'rechts', 'links')}, ${formatOffsetCm(cog.z, 'hinten', 'vorne')} von Fahrzeugmitte`;
        doc.text(`Schwerpunkt: ${pos}`, PAGE_MARGIN, y + 5);
    }
}

// Builds and downloads the packplan PDF (schematic + BOM). Pure side effect
// (triggers a browser download via jsPDF's own save()) — nothing to return.
export function exportSchematicPdfToFile(filename = 'vanspace3d-packplan.pdf') {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    drawTitleBlock(doc);
    const bomStartY = drawSchematic(doc);
    const bomEndY = drawBom(doc, bomStartY);
    drawSummary(doc, bomEndY + 6);
    doc.save(sanitizeFilename(filename, 'vanspace3d-packplan', 'pdf'));
}
