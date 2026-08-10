import { jsPDF } from 'jspdf';
import { vanState, objects } from './state.js';
import { computeCenterOfGravity } from './cog.js';
import { computeTotalPrice } from './price.js';
import { DEFAULT_WEIGHT, DEFAULT_PRICE } from './objects.js';
import { sanitizeFilename } from './persistence.js';

// ==========================================
// PDF EXPORT — a "Packplan": page 1 is a to-scale, three-view schematic
// (top/front/side, like a technical drawing) of the van + placed objects;
// page 2+ is a bill-of-materials table, meant to be printed and taken
// along, not just read on screen.
//
// Three views instead of one matter because a single top-down view can only
// separate objects that differ in X or Z — two objects stacked at different
// heights (same X/Z, different Y) are indistinguishable from directly above.
// All three views share one scale, so a size read off any one of them is
// consistent with the others (like a real technical drawing).
// ==========================================
const PAGE_MARGIN = 15; // mm
const TITLE_BOTTOM = 24; // mm — below the title block
const TOP_VIEW_HEIGHT = 82; // mm — reserved drawing height for the top (floor-plan) view
const SMALL_VIEW_HEIGHT = 52; // mm — reserved height for the front/side views
const VIEW_ROW_GAP = 10; // mm — gap between the top view and the front/side row
const VIEW_COL_GAP = 8; // mm — gap between the front and side views
const CAPTION_GAP = 5; // mm — space reserved above each view for its caption
const ROW_HEIGHT = 6; // mm — BOM table row height
const CLUSTER_EPS_MM = 3; // footprints whose centers land this close together share one call-out
const BOM_COLUMNS = [
    { label: 'Nr.', x: 0, width: 10 },
    { label: 'Name', x: 10, width: 68 },
    { label: 'Maße B×T×H (cm)', x: 78, width: 45 },
    { label: 'Gewicht (kg)', x: 123, width: 25 },
    { label: 'Preis (€)', x: 148, width: 25 },
    { label: 'Status', x: 173, width: 40 },
];
const BOM_TABLE_WIDTH = 213; // mm — sum of the last column's x + width above
const LOCKED_RGB = [239, 68, 68]; // matches LOCKED_EDGE_COLOR (objects.js)
const FIXED_RGB = [120, 113, 108]; // matches FIXED_EDGE_COLOR (objects.js)
const FIXED_FILL_RGB = [214, 211, 209];

function formatOffsetCm(value, positiveLabel, negativeLabel) {
    return value >= 0 ? `${Math.round(value * 100)}cm ${positiveLabel}` : `${Math.round(-value * 100)}cm ${negativeLabel}`;
}

function formatEuro(value) {
    return `${(Number.isFinite(value) ? value : DEFAULT_PRICE).toFixed(2)} €`;
}

// The van's stepped top-down (floor-level) footprint as a list of
// {x, z, w, d} rectangles (van-space meters; x = left/right, z = front/back;
// w/d are full extents, not half-extents) — the same front-wide/rear-narrow/
// wheel-arch shape buildVanGeometry() (van.js) draws in 3D, flattened to the
// floor plan. Exported for testing; pure function of vanState.
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

function setObjectStyle(doc, obj) {
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
}

// Draws a van-outline rectangle given its center + full extents in this
// view's (u, v) van-space plane, via the view's own toPage(u, v) point
// mapping. Reads the two opposite corners rather than assuming which one is
// page-top-left, since toPage's v-axis direction differs per view (see
// drawObjectFootprints below for the same reasoning).
function drawOutlineRect(doc, toPage, u, v, wu, wv) {
    const a = toPage(u - wu / 2, v - wv / 2);
    const b = toPage(u + wu / 2, v + wv / 2);
    return {
        px: Math.min(a.px, b.px), py: Math.min(a.py, b.py), w: Math.abs(b.px - a.px), h: Math.abs(b.py - a.py),
    };
}

// Draws every placed object's footprint in one 2D projection of the given
// view, then — in a *second* pass, after every fill/border is down — draws
// each footprint's call-out number on top. That ordering (rather than
// numbering each object right after its own rect, interleaved with the
// next) is what keeps a number from ever being buried under a
// later-drawn object's fill.
//
// `project(obj)` maps an object to its bounding box *center* + full extents
// in this view's plane, in van-space meters: {u, v, wu, wv}. `toPage(u, v)`
// converts a van-space point to a page-mm point; its v-axis direction is up
// to the view (e.g. "up" on the page can mean increasing OR decreasing
// van-space height), so the rect is derived from both opposite corners
// rather than assuming one particular corner is page-top-left.
function drawObjectFootprints(doc, project, toPage) {
    const placements = objects.map((obj, i) => {
        const { u, v, wu, wv } = project(obj);
        const a = toPage(u - wu / 2, v - wv / 2);
        const b = toPage(u + wu / 2, v + wv / 2);
        return {
            i,
            obj,
            px: Math.min(a.px, b.px),
            py: Math.min(a.py, b.py),
            w: Math.abs(b.px - a.px),
            h: Math.abs(b.py - a.py),
        };
    });

    placements.forEach(({
        px, py, w, h, obj,
    }) => {
        setObjectStyle(doc, obj);
        doc.rect(px, py, w, h, 'FD');
    });
    doc.setLineDashPattern([], 0);
    doc.setLineWidth(0.2);

    // Footprints whose centers land within CLUSTER_EPS_MM of each other get
    // one combined "1,2,3" label instead of stacking individually-illegible
    // digits on top of each other — a simple greedy nearest-neighbor
    // grouping (not full transitive clustering), which is plenty for the
    // small clusters that actually occur here (a handful of same-size
    // objects placed at nearly the same spot).
    const centers = placements.map((p) => ({ ...p, cx: p.px + p.w / 2, cy: p.py + p.h / 2 }));
    const used = new Set();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(15, 23, 42);
    centers.forEach((p, idx) => {
        if (used.has(idx)) return;
        used.add(idx);
        if (p.w < 5 || p.h < 4) return; // too small to hold a legible number
        const cluster = [p];
        centers.forEach((q, jdx) => {
            if (used.has(jdx)) return;
            if (Math.hypot(p.cx - q.cx, p.cy - q.cy) <= CLUSTER_EPS_MM) {
                cluster.push(q);
                used.add(jdx);
            }
        });
        const text = cluster.map((c) => c.i + 1).join(',');
        doc.text(text, p.cx, p.cy, { align: 'center', baseline: 'middle' });
    });
}

// A single scale (mm per van-meter) shared by all three views, so a
// distance read off any one of them agrees with the others — the tightest
// of the three views' own fit constraints wins.
function computeSharedScale(availWidth, smallViewWidth) {
    const topScale = Math.min(availWidth / vanState.length, TOP_VIEW_HEIGHT / vanState.maxWidth);
    const frontScale = Math.min(smallViewWidth / vanState.maxWidth, SMALL_VIEW_HEIGHT / vanState.maxHeight);
    const sideScale = Math.min(smallViewWidth / vanState.length, SMALL_VIEW_HEIGHT / vanState.maxHeight);
    return Math.min(topScale, frontScale, sideScale);
}

function drawCaption(doc, text, x, y) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    doc.text(text, x, y);
}

// Floor-plan (top-down) view: van outline + numbered object footprints +
// center-of-gravity marker — the only view with enough information (x/z,
// no height) to place one. z (front/back) maps to the page's horizontal
// axis (front reads left), x (left/right) to the page's vertical axis.
function drawTopView(doc, box, scale) {
    const drawW = vanState.length * scale;
    const drawH = vanState.maxWidth * scale;
    const originX = box.x + (box.w - drawW) / 2; // centered within the reserved box
    const originY = box.y;
    const toPage = (u, v) => ({ px: originX + (u + vanState.length / 2) * scale, py: originY + (v + vanState.maxWidth / 2) * scale });

    drawCaption(doc, 'Draufsicht', box.x, box.y - 2);

    doc.setLineDashPattern([], 0);
    doc.setLineWidth(0.4);
    vanFootprintRects().forEach((r) => {
        const rect = drawOutlineRect(doc, toPage, r.z, r.x, r.d, r.w);
        if (r.arch) {
            doc.setDrawColor(140, 140, 140);
            doc.setFillColor(225, 225, 225);
            doc.rect(rect.px, rect.py, rect.w, rect.h, 'FD');
        } else {
            doc.setDrawColor(80, 80, 80);
            doc.rect(rect.px, rect.py, rect.w, rect.h, 'D');
        }
    });

    drawObjectFootprints(
        doc,
        (obj) => {
            const { width, depth } = obj.geometry.parameters;
            return {
                u: obj.position.z, v: obj.position.x, wu: depth, wv: width,
            };
        },
        toPage,
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text('VORNE', originX + 1, originY + drawH + 4);
    doc.text('HINTEN', originX + drawW - 1, originY + drawH + 4, { align: 'right' });

    const cog = computeCenterOfGravity();
    if (cog) {
        const { px, py } = toPage(cog.z, cog.x);
        doc.setDrawColor(...LOCKED_RGB);
        doc.setFillColor(255, 255, 255);
        doc.circle(px, py, 1.6, 'FD');
        doc.setLineWidth(0.25);
        doc.line(px - 2.4, py, px + 2.4, py);
        doc.line(px, py - 2.4, px, py + 2.4);
    }
}

// Front elevation: looking at the van head-on. x (left/right) maps to the
// page's horizontal axis, y (height) to the vertical axis — increasing
// height means decreasing page-y, so the floor reads at the bottom like a
// real elevation drawing, not the top-view's arbitrary top-to-bottom axis.
// The van's own outline here is always a plain maxWidth×maxHeight rectangle:
// the wheel-arch notch (see vanFootprintRects()) only exists in the rear
// zone at floor height, and the front zone alone already reaches full
// width at every height, so the head-on silhouette has no visible step.
function drawFrontView(doc, box, scale) {
    const drawW = vanState.maxWidth * scale;
    const drawH = vanState.maxHeight * scale;
    const originX = box.x + (box.w - drawW) / 2;
    const originY = box.y + (box.h - drawH);
    const toPage = (u, v) => ({ px: originX + (u + vanState.maxWidth / 2) * scale, py: originY + (vanState.maxHeight - v) * scale });

    drawCaption(doc, 'Vorderansicht', box.x, box.y - 2);

    doc.setDrawColor(80, 80, 80);
    doc.setLineWidth(0.4);
    const outline = drawOutlineRect(doc, toPage, 0, vanState.maxHeight / 2, vanState.maxWidth, vanState.maxHeight);
    doc.rect(outline.px, outline.py, outline.w, outline.h, 'D');

    drawObjectFootprints(
        doc,
        (obj) => {
            const { width, height } = obj.geometry.parameters;
            return {
                u: obj.position.x, v: obj.position.y, wu: width, wv: height,
            };
        },
        toPage,
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text('LINKS', originX + 1, originY + drawH + 4);
    doc.text('RECHTS', originX + drawW - 1, originY + drawH + 4, { align: 'right' });
}

// Side elevation: looking at the van from the side, along its length. z
// (front/back) maps to the page's horizontal axis (front reads left, same
// convention as the top view), y (height) to the vertical axis (floor at
// the bottom, same convention as the front view). Also a plain rectangle
// outline for the same reason as the front view — the wheel-arch notch is
// a floor-level width constraint that doesn't show in a height/length
// silhouette either.
function drawSideView(doc, box, scale) {
    const drawW = vanState.length * scale;
    const drawH = vanState.maxHeight * scale;
    const originX = box.x + (box.w - drawW) / 2;
    const originY = box.y + (box.h - drawH);
    const toPage = (u, v) => ({ px: originX + (u + vanState.length / 2) * scale, py: originY + (vanState.maxHeight - v) * scale });

    drawCaption(doc, 'Seitenansicht', box.x, box.y - 2);

    doc.setDrawColor(80, 80, 80);
    doc.setLineWidth(0.4);
    const outline = drawOutlineRect(doc, toPage, 0, vanState.maxHeight / 2, vanState.length, vanState.maxHeight);
    doc.rect(outline.px, outline.py, outline.w, outline.h, 'D');

    drawObjectFootprints(
        doc,
        (obj) => {
            const { depth, height } = obj.geometry.parameters;
            return {
                u: obj.position.z, v: obj.position.y, wu: depth, wv: height,
            };
        },
        toPage,
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text('VORNE', originX + 1, originY + drawH + 4);
    doc.text('HINTEN', originX + drawW - 1, originY + drawH + 4, { align: 'right' });
}

// Shared legend, drawn once beneath all three views (they share one scale,
// so one legend applies to all of them).
function drawLegend(doc, x, y) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);

    doc.setFillColor(...FIXED_FILL_RGB);
    doc.setDrawColor(...FIXED_RGB);
    doc.setLineDashPattern([], 0);
    doc.rect(x, y - 3, 4, 3, 'FD');
    doc.text('Fest verbaut', x + 6, y);

    doc.setLineDashPattern([1, 0.7], 0);
    doc.setDrawColor(...LOCKED_RGB);
    doc.setFillColor(255, 255, 255);
    doc.rect(x + 35, y - 3, 4, 3, 'FD');
    doc.setLineDashPattern([], 0);
    doc.text('Gesperrt', x + 41, y);

    doc.setDrawColor(...LOCKED_RGB);
    doc.circle(x + 62, y - 1.5, 1.4, 'D');
    doc.text('Schwerpunkt (nur Draufsicht)', x + 66, y);
}

function drawBomHeader(doc, y) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    BOM_COLUMNS.forEach((col) => doc.text(col.label, PAGE_MARGIN + col.x, y));
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.2);
    doc.line(PAGE_MARGIN, y + 2, PAGE_MARGIN + BOM_TABLE_WIDTH, y + 2);
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
        // Unlike weight, price isn't tied to fixed/locked status — a built-in
        // fixture still cost money — so it's always shown as a plain number.
        const price = (obj.userData.price ?? DEFAULT_PRICE).toFixed(2);
        const status = fixed ? 'Fest verbaut' : (locked ? 'Gesperrt' : '–');

        doc.setTextColor(30, 41, 59);
        doc.text(String(i + 1), PAGE_MARGIN + BOM_COLUMNS[0].x, y);
        doc.text(fitText(doc, label, BOM_COLUMNS[1].width - 2), PAGE_MARGIN + BOM_COLUMNS[1].x, y);
        doc.text(dims, PAGE_MARGIN + BOM_COLUMNS[2].x, y);
        doc.text(weight, PAGE_MARGIN + BOM_COLUMNS[3].x, y);
        doc.text(price, PAGE_MARGIN + BOM_COLUMNS[4].x, y);
        doc.text(status, PAGE_MARGIN + BOM_COLUMNS[5].x, y);

        y += ROW_HEIGHT;
    });

    return y;
}

function drawSummary(doc, y) {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (y + ROW_HEIGHT * 4 > pageHeight - PAGE_MARGIN) {
        doc.addPage();
        y = PAGE_MARGIN;
    }

    const cog = computeCenterOfGravity();
    const totalWeight = cog ? cog.totalWeight : 0;
    const totalPrice = computeTotalPrice();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(`Gesamtgewicht: ${totalWeight.toFixed(1)} kg von ${vanState.maxPayload} kg Zuladung`, PAGE_MARGIN, y);
    doc.text(`Gesamtwert: ${formatEuro(totalPrice)}`, PAGE_MARGIN, y + 5);

    if (cog) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        const pos = `${formatOffsetCm(cog.x, 'rechts', 'links')}, ${formatOffsetCm(cog.z, 'hinten', 'vorne')} von Fahrzeugmitte`;
        doc.text(`Schwerpunkt: ${pos}`, PAGE_MARGIN, y + 10);
    }
}

// Builds and downloads the packplan PDF: page 1 is the three-view schematic
// (top/front/side, one shared scale, see drawTopView/drawFrontView/
// drawSideView above), page 2+ is the BOM table + summary. Pure side effect
// (triggers a browser download via jsPDF's own save()) — nothing to return.
export function exportSchematicPdfToFile(filename = 'vanspace3d-packplan.pdf') {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    drawTitleBlock(doc);

    const pageWidth = doc.internal.pageSize.getWidth();
    const availWidth = pageWidth - PAGE_MARGIN * 2;
    const smallViewWidth = (availWidth - VIEW_COL_GAP) / 2;
    const scale = computeSharedScale(availWidth, smallViewWidth);

    const topBox = {
        x: PAGE_MARGIN, y: TITLE_BOTTOM + CAPTION_GAP, w: availWidth, h: TOP_VIEW_HEIGHT,
    };
    drawTopView(doc, topBox, scale);

    const smallRowY = topBox.y + topBox.h + VIEW_ROW_GAP + CAPTION_GAP;
    const frontBox = {
        x: PAGE_MARGIN, y: smallRowY, w: smallViewWidth, h: SMALL_VIEW_HEIGHT,
    };
    const sideBox = {
        x: PAGE_MARGIN + smallViewWidth + VIEW_COL_GAP, y: smallRowY, w: smallViewWidth, h: SMALL_VIEW_HEIGHT,
    };
    drawFrontView(doc, frontBox, scale);
    drawSideView(doc, sideBox, scale);

    drawLegend(doc, PAGE_MARGIN, smallRowY + SMALL_VIEW_HEIGHT + 8);

    doc.addPage();
    const bomEndY = drawBom(doc, PAGE_MARGIN + 5);
    drawSummary(doc, bomEndY + 6);
    doc.save(sanitizeFilename(filename, 'vanspace3d-packplan', 'pdf'));
}
