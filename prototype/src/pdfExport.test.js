import {
    describe, it, expect, beforeEach, vi,
} from 'vitest';
import * as THREE from 'three';

// cog.js/van.js (pulled in transitively via persistence.js's sanitizeFilename
// import) create real THREE objects tied to `scene` at module-load time —
// same reason objects.test.js/persistence.test.js mock this.
vi.mock('./scene.js', () => ({
    scene: { add: vi.fn(), remove: vi.fn() },
}));

// A minimal stand-in for jsPDF: records every draw call (method name + args)
// on `.calls` so tests can assert on what got drawn without rendering an
// actual PDF or depending on jsPDF's own internals.
vi.mock('jspdf', () => {
    class MockJsPDF {
        constructor(opts) {
            this.opts = opts;
            this.calls = [];
            this.internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
            MockJsPDF.instances.push(this);
        }

        setFont() { return this; }

        setFontSize() { return this; }

        setTextColor() { return this; }

        setDrawColor() { return this; }

        setFillColor() { return this; }

        setLineWidth() { return this; }

        setLineDashPattern() { return this; }

        getTextWidth(text) { return text.length * 2; }

        text(...args) { this.calls.push(['text', ...args]); return this; }

        rect(...args) { this.calls.push(['rect', ...args]); return this; }

        circle(...args) { this.calls.push(['circle', ...args]); return this; }

        line(...args) { this.calls.push(['line', ...args]); return this; }

        addPage() { this.calls.push(['addPage']); return this; }

        save(filename) { this.savedFilename = filename; }
    }
    MockJsPDF.instances = [];
    return { jsPDF: MockJsPDF };
});

const { vanState, objects, DEFAULT_VAN_STATE } = await import('./state.js');
const { jsPDF } = await import('jspdf');
const { vanFootprintRects, exportSchematicPdfToFile } = await import('./pdfExport.js');

function makeMesh({
    width = 0.6, height = 0.32, depth = 0.4, x = 0, y = 0.16, z = 0, colorHex = 0x2563eb, weight = 8, label = 'Kiste',
    locked = false, fixed = false,
} = {}) {
    const geo = new THREE.BoxGeometry(width, height, depth);
    const mat = new THREE.MeshStandardMaterial({ color: colorHex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.userData = {
        weight, label, locked, fixed,
    };
    return mesh;
}

function texts(doc) {
    return doc.calls.filter((c) => c[0] === 'text').map((c) => c[1]);
}

function numberCallouts(doc) {
    // Schematic call-outs are centered/middle-baseline text, unlike the BOM
    // table's plain left-aligned "Nr." column (which also prints "1"/"2") —
    // filtering on the alignment options isolates the footprint numbering.
    return doc.calls.filter((c) => c[0] === 'text' && c[4] && c[4].align === 'center').map((c) => c[1]);
}

beforeEach(() => {
    Object.assign(vanState, DEFAULT_VAN_STATE);
    objects.length = 0;
    jsPDF.instances.length = 0;
});

describe('vanFootprintRects', () => {
    it('returns a front zone, rear zone, and two wheel-arch rects for the default van shape', () => {
        const rects = vanFootprintRects();
        expect(rects).toHaveLength(4);
        const front = rects.find((r) => Math.abs(r.d - vanState.frontLength) < 1e-9);
        expect(front.w).toBeCloseTo(vanState.maxWidth);
        // The rear's floor-level footprint is only narrowWidth — the arches
        // (not maxWidth) make up the rest of the van's full-width silhouette
        // at that z-range.
        const rear = rects.find((r) => !r.arch && Math.abs(r.d - vanState.frontLength) >= 1e-9);
        expect(rear.w).toBeCloseTo(vanState.narrowWidth);
        const arches = rects.filter((r) => r.arch);
        expect(arches).toHaveLength(2);
        arches.forEach((a) => expect(a.w).toBeCloseTo((vanState.maxWidth - vanState.narrowWidth) / 2));
    });

    it('collapses to a single rectangle when frontLength covers the whole van', () => {
        Object.assign(vanState, { frontLength: vanState.length });
        const rects = vanFootprintRects();
        expect(rects).toHaveLength(1);
        expect(rects[0].d).toBeCloseTo(vanState.length);
    });

    it('omits the wheel-arch rects when narrowWidth equals maxWidth', () => {
        Object.assign(vanState, { narrowWidth: vanState.maxWidth });
        const rects = vanFootprintRects();
        expect(rects.some((r) => r.arch)).toBe(false);
    });
});

describe('exportSchematicPdfToFile', () => {
    it('creates a landscape A4 document and saves it with a .pdf filename', () => {
        exportSchematicPdfToFile();
        expect(jsPDF.instances).toHaveLength(1);
        const doc = jsPDF.instances[0];
        expect(doc.opts).toMatchObject({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        expect(doc.savedFilename).toMatch(/\.pdf$/);
    });

    // Baseline rect count with nothing placed: the top view's van-footprint
    // rects + one outline rect each for the front/side views' plain
    // maxWidth×maxHeight / length×maxHeight silhouettes + the two
    // always-drawn legend swatches (fixed/locked key) — see drawTopView()/
    // drawFrontView()/drawSideView()/drawLegend().
    const BASELINE_RECT_COUNT = () => vanFootprintRects().length + 2 + 2;

    it('draws the van outlines (all three views) + legend rects even with nothing placed', () => {
        exportSchematicPdfToFile();
        const doc = jsPDF.instances[0];
        const rectCalls = doc.calls.filter((c) => c[0] === 'rect');
        expect(rectCalls).toHaveLength(BASELINE_RECT_COUNT());
    });

    it('draws one footprint rect per placed object in each of the three views', () => {
        objects.push(makeMesh({ label: 'Kiste A' }), makeMesh({ label: 'Kiste B', x: 0.5 }));
        exportSchematicPdfToFile();
        const doc = jsPDF.instances[0];
        const rectCalls = doc.calls.filter((c) => c[0] === 'rect');
        expect(rectCalls).toHaveLength(BASELINE_RECT_COUNT() + 2 * 3);
    });

    it('numbers a well-separated object in every view it appears in', () => {
        // Positioned far apart on every axis (x, y, z) so it never clusters
        // with anything else and reliably gets its own call-out in all
        // three views (top, front, side).
        objects.push(makeMesh({
            label: 'Kiste A', x: -0.6, y: 0.5, z: -1.2,
        }));
        exportSchematicPdfToFile();
        const doc = jsPDF.instances[0];
        const numbers = numberCallouts(doc);
        expect(numbers).toEqual(['1', '1', '1']);
    });

    it('lists every object name in the BOM table', () => {
        objects.push(makeMesh({ label: 'Werkzeugkiste' }), makeMesh({ label: 'Wasserkanister', x: 0.5 }));
        exportSchematicPdfToFile();
        const doc = jsPDF.instances[0];
        expect(texts(doc)).toContain('Werkzeugkiste');
        expect(texts(doc)).toContain('Wasserkanister');
    });

    it('shows a placeholder row in the BOM when nothing is placed', () => {
        exportSchematicPdfToFile();
        const doc = jsPDF.instances[0];
        expect(texts(doc)).toContain('Keine Objekte platziert.');
    });

    it('starts the BOM on its own page, after the schematic', () => {
        exportSchematicPdfToFile();
        const doc = jsPDF.instances[0];
        expect(doc.calls.some((c) => c[0] === 'addPage')).toBe(true);
    });

    it('breaks to a further new page once the BOM table overflows the page height', () => {
        for (let i = 0; i < 40; i += 1) objects.push(makeMesh({ label: `Kiste ${i}` }));
        exportSchematicPdfToFile();
        const doc = jsPDF.instances[0];
        const addPageCalls = doc.calls.filter((c) => c[0] === 'addPage');
        // At least one addPage() for the schematic->BOM page break, plus at
        // least one more for the BOM overflowing onto a third page.
        expect(addPageCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('labels a fixed fixture "Fest verbaut" and a locked object "Gesperrt" in the BOM', () => {
        objects.push(
            makeMesh({ label: 'Bett', fixed: true, locked: true }),
            makeMesh({ label: 'Kiste', locked: true, x: 0.5 }),
        );
        exportSchematicPdfToFile();
        const doc = jsPDF.instances[0];
        expect(texts(doc)).toContain('Fest verbaut');
        expect(texts(doc)).toContain('Gesperrt');
    });

    it('captions all three schematic views', () => {
        exportSchematicPdfToFile();
        const doc = jsPDF.instances[0];
        expect(texts(doc)).toContain('Draufsicht');
        expect(texts(doc)).toContain('Vorderansicht');
        expect(texts(doc)).toContain('Seitenansicht');
    });

    it('clusters two objects sharing (nearly) the same footprint into one call-out per view, instead of stacking illegible digits', () => {
        // Same position and dimensions on every axis — as close to a
        // worst-case overlap as it gets.
        objects.push(makeMesh({ label: 'Kiste A' }), makeMesh({ label: 'Kiste B' }));
        exportSchematicPdfToFile();
        const doc = jsPDF.instances[0];
        const numbers = numberCallouts(doc);
        // One combined "1,2" call-out per view (top/front/side) rather than
        // two separate (and, at this exact overlap, perfectly coincident)
        // "1" and "2" texts.
        expect(numbers).toEqual(['1,2', '1,2', '1,2']);
    });
});
