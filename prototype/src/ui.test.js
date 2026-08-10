import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./van.js', () => ({ buildVanGeometry: vi.fn() }));
vi.mock('./objects.js', () => ({
    addBox: vi.fn(() => ({})),
    clearAllObjects: vi.fn(),
    clearUnlockedObjects: vi.fn(),
    toggleLock: vi.fn(),
    removeObject: vi.fn(),
    moveVertical: vi.fn(),
    resizeObject: vi.fn(() => true),
    rotate90: vi.fn(() => true),
    rotateX90: vi.fn(() => true),
    flashReject: vi.fn(),
    setXrayEnabled: vi.fn(),
    renameObject: vi.fn(() => true),
    parkObject: vi.fn(),
    returnObjectToVan: vi.fn(),
    DEFAULT_WEIGHT: 5,
}));
vi.mock('./persistence.js', () => ({
    saveConfig: vi.fn(() => true),
    loadConfig: vi.fn(() => false),
    hasSavedConfig: vi.fn(() => false),
    clearSavedConfig: vi.fn(),
    exportToFile: vi.fn(),
    sanitizeFilename: vi.fn((name, fallback, extension) => `${name || fallback}.${extension}`),
    importFromText: vi.fn(() => true),
    listProjects: vi.fn(() => []),
    saveNamedProject: vi.fn(() => true),
    loadNamedProject: vi.fn(() => true),
    deleteNamedProject: vi.fn(() => true),
    renameNamedProject: vi.fn(() => true),
}));
vi.mock('./pdfExport.js', () => ({
    exportSchematicPdfToFile: vi.fn(),
}));
vi.mock('./history.js', () => ({
    captureUndoPoint: vi.fn(),
    undo: vi.fn(() => false),
    redo: vi.fn(() => false),
    canUndo: vi.fn(() => false),
    canRedo: vi.fn(() => false),
}));
vi.mock('./controls.js', () => ({
    selectObject: vi.fn(),
    setCameraView: vi.fn(),
}));

const { vanState, DEFAULT_VAN_STATE, objects } = await import('./state.js');
const { buildVanGeometry } = await import('./van.js');
const {
    addBox, clearAllObjects, clearUnlockedObjects, toggleLock, removeObject, moveVertical, resizeObject, rotate90,
    rotateX90, flashReject, setXrayEnabled, renameObject, parkObject, returnObjectToVan,
} = await import('./objects.js');
const {
    saveConfig, loadConfig, hasSavedConfig, clearSavedConfig, exportToFile, sanitizeFilename,
    importFromText, listProjects, saveNamedProject, loadNamedProject, deleteNamedProject, renameNamedProject,
} = await import('./persistence.js');
const { exportSchematicPdfToFile } = await import('./pdfExport.js');
const { captureUndoPoint, canUndo, canRedo } = await import('./history.js');
const { selectObject } = await import('./controls.js');
const { STANDARD_LIBRARY } = await import('./library.js');
const { VEHICLE_PRESETS } = await import('./vehicles.js');
const { initUI, isSnapEnabled, isLabelsEnabled, refreshHistoryButtons } = await import('./ui.js');

// Minimal DOM fixture mirroring the ids/attributes ui.js reads/writes.
// Not the full Tailwind markup — just the seams this module touches.
function mountFixture() {
    document.body.innerHTML = `
        <button id="toggle-snap" aria-pressed="true"></button>
        <button id="toggle-labels" aria-pressed="true"></button>

        <div id="ui-container" class="max-h-16 overflow-hidden">
            <button id="panel-toggle" aria-expanded="false"></button>
        </div>
        <button id="help-toggle"></button>
        <div id="help-modal" class="hidden">
            <button id="help-close"></button>
        </div>

        <button id="tab-objects" class="tab-btn active flex-1 py-2 text-sm font-semibold"></button>
        <button id="tab-config" class="tab-btn inactive flex-1 py-2 text-sm font-semibold"></button>
        <div id="panel-objects" class="flex"></div>
        <div id="panel-config" class="hidden"></div>

        <div id="standard-library-list"></div>
        <div id="vehicle-preset-list"></div>

        <form id="custom-object-form">
            <input id="custom-name" value="">
            <input type="checkbox" id="custom-fixed">
            <input id="custom-w" value="50">
            <p id="custom-w-error"></p>
            <input id="custom-h" value="40">
            <p id="custom-h-error"></p>
            <input id="custom-d" value="80">
            <p id="custom-d-error"></p>
            <input id="custom-weight" value="5">
            <p id="custom-weight-error"></p>
            <input id="custom-price" value="0">
            <p id="custom-price-error"></p>
            <input id="custom-c" value="#10b981">
            <button type="submit" id="add-custom"></button>
        </form>

        <div id="object-list"></div>

        <div id="edit-dims-modal" class="hidden">
            <button id="edit-dims-close"></button>
            <form id="edit-dims-form">
                <input id="edit-dims-w" value="0">
                <p id="edit-dims-w-error"></p>
                <input id="edit-dims-h" value="0">
                <p id="edit-dims-h-error"></p>
                <input id="edit-dims-d" value="0">
                <p id="edit-dims-d-error"></p>
                <button type="submit"></button>
            </form>
            <button id="edit-dims-cancel"></button>
        </div>

        <span id="obj-count"></span>
        <span id="parked-count" class="hidden"></span>
        <span id="total-weight"></span>
        <span id="total-price"></span>
        <span id="cog-info"></span>
        <button id="clear-all"></button>

        <div id="camera-toolbar">
            <button id="cam-top"></button>
            <button id="cam-front"></button>
            <button id="cam-side"></button>
            <button id="cam-reset"></button>
            <button id="cam-xray" aria-pressed="false"></button>
        </div>

        <!-- No production min/max here on purpose (beyond a generous max, to
             avoid jsdom's silent default-max-100 clamp on a bare <input
             type=range>) — several tests below deliberately probe values
             outside the real slider range to exercise clamp logic. -->
        <input type="range" id="van-len" max="1000" value="330">
        <input type="range" id="van-front-len" max="1000" value="160">
        <input type="range" id="van-height" max="1000" value="190">
        <input type="range" id="van-width-max" max="1000" value="180">
        <input type="range" id="van-width-min" max="1000" value="130">
        <input type="range" id="van-arch-h" max="1000" value="45">
        <input type="range" id="van-payload" min="50" max="2000" value="400">
        <span id="val-len"></span>
        <span id="val-front-len"></span>
        <span id="val-height"></span>
        <span id="val-payload"></span>
        <span id="val-width-max"></span>
        <span id="val-width-min"></span>
        <span id="val-arch-h"></span>

        <button id="undo-btn"></button>
        <button id="redo-btn"></button>

        <button id="save-config"></button>
        <button id="load-config"></button>
        <button id="reset-config"></button>
        <button id="export-config"></button>
        <button id="export-pdf"></button>
        <input type="file" id="import-config-file">
        <p id="persistence-status"></p>

        <button id="save-as-project"></button>
        <div id="project-list"></div>
    `;
}

beforeEach(() => {
    Object.assign(vanState, DEFAULT_VAN_STATE);
    objects.length = 0;
    mountFixture();
    buildVanGeometry.mockClear();
    addBox.mockClear();
    clearAllObjects.mockClear();
    clearUnlockedObjects.mockClear();
    toggleLock.mockClear();
    removeObject.mockClear();
    moveVertical.mockClear();
    resizeObject.mockClear();
    resizeObject.mockReturnValue(true);
    rotate90.mockClear();
    rotateX90.mockClear();
    flashReject.mockClear();
    setXrayEnabled.mockClear();
    renameObject.mockClear();
    renameObject.mockReturnValue(true);
    parkObject.mockClear();
    returnObjectToVan.mockClear();
    selectObject.mockClear();
    saveConfig.mockClear();
    saveConfig.mockReturnValue(true);
    loadConfig.mockClear();
    loadConfig.mockReturnValue(false); // default: nothing saved, so initUI() builds from defaults
    hasSavedConfig.mockClear();
    hasSavedConfig.mockReturnValue(false);
    clearSavedConfig.mockClear();
    exportToFile.mockClear();
    sanitizeFilename.mockClear();
    exportSchematicPdfToFile.mockClear();
    importFromText.mockClear();
    importFromText.mockReturnValue(true);
    listProjects.mockClear();
    listProjects.mockReturnValue([]);
    saveNamedProject.mockClear();
    saveNamedProject.mockReturnValue(true);
    loadNamedProject.mockClear();
    loadNamedProject.mockReturnValue(true);
    deleteNamedProject.mockClear();
    deleteNamedProject.mockReturnValue(true);
    renameNamedProject.mockClear();
    renameNamedProject.mockReturnValue(true);
    captureUndoPoint.mockClear();
    canUndo.mockClear();
    canUndo.mockReturnValue(false);
    canRedo.mockClear();
    canRedo.mockReturnValue(false);
    initUI();
});

describe('isSnapEnabled', () => {
    it('reflects the button\'s pressed state', () => {
        expect(isSnapEnabled()).toBe(true);
        document.getElementById('toggle-snap').setAttribute('aria-pressed', 'false');
        expect(isSnapEnabled()).toBe(false);
    });
});

describe('isLabelsEnabled', () => {
    it('reflects the button\'s pressed state', () => {
        expect(isLabelsEnabled()).toBe(true);
        document.getElementById('toggle-labels').setAttribute('aria-pressed', 'false');
        expect(isLabelsEnabled()).toBe(false);
    });
});

describe('view toggle buttons (Einrasten / Objektnamen)', () => {
    it('flips aria-pressed and the active styling on click, and back again', () => {
        const btn = document.getElementById('toggle-snap');
        expect(btn.getAttribute('aria-pressed')).toBe('true');

        btn.click();
        expect(btn.getAttribute('aria-pressed')).toBe('false');
        expect(btn.classList.contains('bg-blue-500/10')).toBe(false);
        expect(btn.classList.contains('bg-white/5')).toBe(true);
        expect(isSnapEnabled()).toBe(false);

        btn.click();
        expect(btn.getAttribute('aria-pressed')).toBe('true');
        expect(btn.classList.contains('bg-blue-500/10')).toBe(true);
        expect(btn.classList.contains('bg-white/5')).toBe(false);
        expect(isSnapEnabled()).toBe(true);
    });

    it('toggles the labels button independently from the snap button', () => {
        document.getElementById('toggle-labels').click();
        expect(isLabelsEnabled()).toBe(false);
        expect(isSnapEnabled()).toBe(true); // untouched
    });
});

describe('tab switching', () => {
    it('switches to the config panel and back', () => {
        document.getElementById('tab-config').click();
        expect(document.getElementById('panel-config').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('panel-objects').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('tab-config').className).toContain('active');

        document.getElementById('tab-objects').click();
        expect(document.getElementById('panel-objects').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('panel-config').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('tab-objects').className).toContain('active');
    });
});

describe('responsive panel (mobile bottom sheet)', () => {
    // jsdom has no matchMedia, so initResponsivePanel()'s fallback always
    // reports "not mobile" and initUI() leaves the sheet expanded on init —
    // these tests drive #panel-toggle explicitly to cover the class-swapping
    // logic itself, independent of which state a real breakpoint starts in.
    it('starts expanded (matchMedia unavailable → "not mobile" fallback)', () => {
        const container = document.getElementById('ui-container');
        const toggle = document.getElementById('panel-toggle');
        expect(container.classList.contains('max-h-[70vh]')).toBe(true);
        expect(container.classList.contains('overflow-y-auto')).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('collapses on toggle click, swapping expanded classes for collapsed ones', () => {
        const container = document.getElementById('ui-container');
        const toggle = document.getElementById('panel-toggle');

        toggle.click();

        expect(container.classList.contains('max-h-[70vh]')).toBe(false);
        expect(container.classList.contains('overflow-y-auto')).toBe(false);
        expect(container.classList.contains('max-h-16')).toBe(true);
        expect(container.classList.contains('overflow-hidden')).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('expands again on a second toggle click', () => {
        const container = document.getElementById('ui-container');
        const toggle = document.getElementById('panel-toggle');

        toggle.click(); // collapse
        toggle.click(); // expand

        expect(container.classList.contains('max-h-[70vh]')).toBe(true);
        expect(container.classList.contains('overflow-y-auto')).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });
});

describe('help modal', () => {
    it('is hidden by default and opens on toggle click', () => {
        const modal = document.getElementById('help-modal');
        expect(modal.classList.contains('hidden')).toBe(true);

        document.getElementById('help-toggle').click();
        expect(modal.classList.contains('hidden')).toBe(false);
    });

    it('closes on the close button', () => {
        document.getElementById('help-toggle').click();
        document.getElementById('help-close').click();
        expect(document.getElementById('help-modal').classList.contains('hidden')).toBe(true);
    });

    it('closes on a backdrop click (event target is the modal itself)', () => {
        const modal = document.getElementById('help-modal');
        document.getElementById('help-toggle').click();
        expect(modal.classList.contains('hidden')).toBe(false);

        modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(modal.classList.contains('hidden')).toBe(true);
    });

    it('does not close on a click that bubbles up from inside the dialog', () => {
        const modal = document.getElementById('help-modal');
        document.getElementById('help-toggle').click();

        const inner = document.createElement('div');
        modal.appendChild(inner);
        inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(modal.classList.contains('hidden')).toBe(false);
    });

    it('closes on Escape, only while open', () => {
        const modal = document.getElementById('help-modal');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(modal.classList.contains('hidden')).toBe(true); // was already closed, still closed

        document.getElementById('help-toggle').click();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(modal.classList.contains('hidden')).toBe(true);
    });
});

describe('config sliders', () => {
    it('updates vanState (meters) from the cm slider, and shows the cm label text on input', () => {
        const slider = document.getElementById('van-height');
        slider.value = '210'; // cm
        slider.dispatchEvent(new Event('input', { bubbles: true }));

        expect(vanState.maxHeight).toBe(2.1); // meters, internal
        expect(document.getElementById('val-height').textContent).toBe('210');
        expect(buildVanGeometry).toHaveBeenCalled();
    });

    it('clamps frontLength to the total length and writes the clamped cm value back to the slider', () => {
        document.getElementById('van-len').value = '250'; // 2.5m
        document.getElementById('van-len').dispatchEvent(new Event('input', { bubbles: true }));

        document.getElementById('van-front-len').value = '400'; // 4.0m, more than the 2.5m total
        document.getElementById('van-front-len').dispatchEvent(new Event('input', { bubbles: true }));

        expect(vanState.frontLength).toBe(2.5);
        expect(document.getElementById('van-front-len').value).toBe('250');
    });

    it('clamps narrowWidth to maxWidth', () => {
        document.getElementById('van-width-max').value = '150'; // 1.5m
        document.getElementById('van-width-max').dispatchEvent(new Event('input', { bubbles: true }));

        document.getElementById('van-width-min').value = '170'; // 1.7m, more than the 1.5m max width
        document.getElementById('van-width-min').dispatchEvent(new Event('input', { bubbles: true }));

        expect(vanState.narrowWidth).toBe(1.5);
    });

    it('leaves narrowWidth untouched when it is already within maxWidth', () => {
        document.getElementById('van-width-min').value = '110'; // 1.1m
        document.getElementById('van-width-min').dispatchEvent(new Event('input', { bubbles: true }));

        expect(vanState.narrowWidth).toBe(1.1);
    });

    it('clamps archHeight to maxHeight - 0.1 when the arch slider exceeds the new headroom', () => {
        document.getElementById('van-arch-h').value = '80'; // 0.8m, its own slider max
        document.getElementById('van-height').value = '85'; // 0.85m, leaves only 0.75m of headroom
        document.getElementById('van-height').dispatchEvent(new Event('input', { bubbles: true }));

        expect(vanState.archHeight).toBeCloseTo(0.75); // 0.85 - 0.1
        expect(document.getElementById('val-arch-h').textContent).toBe('75');
    });

    it('leaves archHeight untouched when there is enough clearance', () => {
        document.getElementById('van-height').value = '240'; // 2.4m
        document.getElementById('van-height').dispatchEvent(new Event('input', { bubbles: true }));

        expect(vanState.archHeight).toBe(0.45);
    });

    it('captures an undo point on pointerdown, before the drag gesture changes anything', () => {
        captureUndoPoint.mockClear();
        document.getElementById('van-height').dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(captureUndoPoint).toHaveBeenCalledTimes(1);
    });

    it('updates maxPayload and its label on input', () => {
        const slider = document.getElementById('van-payload');
        slider.value = '650';
        slider.dispatchEvent(new Event('input', { bubbles: true }));

        expect(vanState.maxPayload).toBe(650);
        expect(document.getElementById('val-payload').textContent).toBe('650');
    });
});

describe('vehicle preset rendering', () => {
    it('renders one button per preset', () => {
        const buttons = document.querySelectorAll('#vehicle-preset-list button');
        expect(buttons).toHaveLength(VEHICLE_PRESETS.length);
    });

    it('applying a preset overwrites the entire vanState and re-syncs the sliders', () => {
        const preset = VEHICLE_PRESETS[0];
        document.querySelector(`#vehicle-preset-list button[data-preset-id="${preset.id}"]`).click();

        expect(vanState).toMatchObject({
            length: preset.length,
            frontLength: preset.frontLength,
            maxHeight: preset.maxHeight,
            maxWidth: preset.maxWidth,
            narrowWidth: preset.narrowWidth,
            archHeight: preset.archHeight,
            maxPayload: preset.maxPayload,
        });
        expect(document.getElementById('van-len').value).toBe(String(Math.round(preset.length * 100)));
        expect(document.getElementById('val-payload').textContent).toBe(preset.maxPayload.toFixed(0));
        expect(buildVanGeometry).toHaveBeenCalled();
    });

    it('captures a single undo point when applying a preset', () => {
        captureUndoPoint.mockClear();
        document.querySelector(`#vehicle-preset-list button[data-preset-id="${VEHICLE_PRESETS[0].id}"]`).click();
        expect(captureUndoPoint).toHaveBeenCalledTimes(1);
    });
});

describe('standard library rendering', () => {
    it('renders one button per library entry', () => {
        const buttons = document.querySelectorAll('#standard-library-list button');
        expect(buttons).toHaveLength(STANDARD_LIBRARY.length);
    });

    it('calls addBox with the exact dimensions/color/weight/label/price for every library entry', () => {
        STANDARD_LIBRARY.forEach((item) => {
            addBox.mockClear();
            document.querySelector(`#standard-library-list button[data-lib-id="${item.id}"]`).click();
            expect(addBox).toHaveBeenCalledWith(
                item.w, item.h, item.d, item.color, item.weight, item.label, { price: item.price ?? 0 },
            );
        });
    });

    it('keeps weight/price out of the visible card label, showing only dimensions', () => {
        const eurobox = STANDARD_LIBRARY.find((item) => item.price > 0);
        const btn = document.querySelector(`#standard-library-list button[data-lib-id="${eurobox.id}"]`);
        expect(btn.textContent).not.toContain(`${eurobox.weight}kg`);
        expect(btn.textContent).not.toContain('€');
        expect(btn.textContent).toContain(`${Math.round(eurobox.w * 100)}x${Math.round(eurobox.d * 100)}x${Math.round(eurobox.h * 100)}`);
    });

    it('shows the weight in the tooltip', () => {
        const first = STANDARD_LIBRARY[0];
        const btn = document.querySelector(`#standard-library-list button[data-lib-id="${first.id}"]`);
        expect(btn.title).toContain(`${first.weight}kg`);
    });

    it('shows the price in the tooltip for a Eurobox entry', () => {
        const eurobox = STANDARD_LIBRARY.find((item) => item.price > 0);
        const btn = document.querySelector(`#standard-library-list button[data-lib-id="${eurobox.id}"]`);
        expect(btn.title).toContain(`${eurobox.price.toFixed(2)}€`);
    });

    it('omits the price from the tooltip for an entry without one', () => {
        const noPrice = STANDARD_LIBRARY.find((item) => !(item.price > 0));
        const btn = document.querySelector(`#standard-library-list button[data-lib-id="${noPrice.id}"]`);
        expect(btn.title).not.toContain('€');
    });

    it('captures an undo point before adding a library object', () => {
        captureUndoPoint.mockClear();
        document.querySelector(`#standard-library-list button[data-lib-id="${STANDARD_LIBRARY[0].id}"]`).click();
        expect(captureUndoPoint).toHaveBeenCalledTimes(1);
    });

    it('shows the dimensions in the button label as WxDxH centimeters', () => {
        const first = STANDARD_LIBRARY[0];
        const btn = document.querySelector(`#standard-library-list button[data-lib-id="${first.id}"]`);
        expect(btn.textContent).toContain(`${Math.round(first.w * 100)}x${Math.round(first.d * 100)}x${Math.round(first.h * 100)}`);
    });
});

describe('object panel buttons', () => {
    it('adds a custom object converted from cm to meters, with the given weight', () => {
        document.getElementById('add-custom').click();
        expect(addBox).toHaveBeenCalledWith(0.5, 0.4, 0.8, '#10b981', 5, 'Eigenes Objekt');
    });

    it('rejects an invalid custom weight without calling addBox', () => {
        document.getElementById('custom-weight').value = '-3';
        document.getElementById('add-custom').click();

        expect(addBox).not.toHaveBeenCalled();
        expect(document.getElementById('custom-weight-error').textContent).not.toBe('');
    });

    it('rejects an absurdly large custom weight without calling addBox', () => {
        document.getElementById('custom-weight').value = '999999999';
        document.getElementById('add-custom').click();

        expect(addBox).not.toHaveBeenCalled();
        expect(document.getElementById('custom-weight-error').textContent).not.toBe('');
    });

    it('passes the exact color picker value through to addBox unmodified', () => {
        document.getElementById('custom-c').value = '#ff00aa';
        document.getElementById('add-custom').click();
        expect(addBox).toHaveBeenCalledWith(0.5, 0.4, 0.8, '#ff00aa', 5, 'Eigenes Objekt');
    });

    it('passes a custom name through to addBox as the label', () => {
        document.getElementById('custom-name').value = '  Werkzeugkiste  ';
        document.getElementById('add-custom').click();
        expect(addBox).toHaveBeenCalledWith(0.5, 0.4, 0.8, '#10b981', 5, 'Werkzeugkiste');
    });

    it('falls back to "Eigenes Objekt" when no name is given', () => {
        document.getElementById('add-custom').click();
        expect(addBox).toHaveBeenCalledWith(0.5, 0.4, 0.8, '#10b981', 5, 'Eigenes Objekt');
    });

    it('rejects an empty/non-numeric custom dimension without calling addBox', () => {
        document.getElementById('custom-h').value = '';
        document.getElementById('add-custom').click();

        expect(addBox).not.toHaveBeenCalled();
        expect(document.getElementById('custom-h-error').textContent).not.toBe('');
    });

    it('rejects non-positive custom dimensions without calling addBox', () => {
        document.getElementById('custom-w').value = '-5';
        document.getElementById('add-custom').click();

        expect(addBox).not.toHaveBeenCalled();
        expect(document.getElementById('custom-w-error').textContent).not.toBe('');
    });

    it('rejects absurdly large custom dimensions without calling addBox', () => {
        document.getElementById('custom-w').value = '5000';
        document.getElementById('add-custom').click();

        expect(addBox).not.toHaveBeenCalled();
        expect(document.getElementById('custom-w-error').textContent).not.toBe('');
    });

    it('clears a previous field error once a valid value is submitted', () => {
        document.getElementById('custom-w').value = '-5';
        document.getElementById('add-custom').click();
        expect(document.getElementById('custom-w-error').textContent).not.toBe('');

        document.getElementById('custom-w').value = '50';
        document.getElementById('add-custom').click();
        expect(document.getElementById('custom-w-error').textContent).toBe('');
        expect(addBox).toHaveBeenCalled();
    });

    it('submits the custom object form on Enter (native form submission), not just button click', () => {
        const form = document.getElementById('custom-object-form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        expect(addBox).toHaveBeenCalledWith(0.5, 0.4, 0.8, '#10b981', 5, 'Eigenes Objekt');
    });

    describe('"Fest verbaut" (fixed obstacle) toggle', () => {
        it('passes the fixed option through to addBox when checked', () => {
            document.getElementById('custom-fixed').checked = true;
            document.getElementById('add-custom').click();
            expect(addBox).toHaveBeenCalledWith(0.5, 0.4, 0.8, '#10b981', 5, 'Eigenes Objekt', { fixed: true });
        });

        it('does not pass a fixed option when unchecked, matching the pre-existing call shape', () => {
            document.getElementById('add-custom').click();
            expect(addBox).toHaveBeenCalledWith(0.5, 0.4, 0.8, '#10b981', 5, 'Eigenes Objekt');
        });

        it('disables the weight field while checked, re-enables it once unchecked', () => {
            const checkbox = document.getElementById('custom-fixed');
            const weightInput = document.getElementById('custom-weight');

            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));
            expect(weightInput.disabled).toBe(true);

            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change'));
            expect(weightInput.disabled).toBe(false);
        });

        it('skips weight validation for a fixed obstacle, even with an invalid weight value', () => {
            document.getElementById('custom-fixed').checked = true;
            document.getElementById('custom-weight').value = '-3'; // would normally fail validation
            document.getElementById('add-custom').click();

            expect(addBox).toHaveBeenCalled();
            expect(document.getElementById('custom-weight-error').textContent).toBe('');
        });

        it('still validates dimensions for a fixed obstacle', () => {
            document.getElementById('custom-fixed').checked = true;
            document.getElementById('custom-w').value = '-5';
            document.getElementById('add-custom').click();

            expect(addBox).not.toHaveBeenCalled();
            expect(document.getElementById('custom-w-error').textContent).not.toBe('');
        });

        it('unchecks itself and re-enables the weight field after a successful add, so the next object defaults back to movable cargo', () => {
            const checkbox = document.getElementById('custom-fixed');
            const weightInput = document.getElementById('custom-weight');

            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));
            document.getElementById('add-custom').click();

            expect(checkbox.checked).toBe(false);
            expect(weightInput.disabled).toBe(false);

            document.getElementById('add-custom').click();
            expect(addBox).toHaveBeenLastCalledWith(0.5, 0.4, 0.8, '#10b981', 5, 'Eigenes Objekt');
        });

        it('leaves the checkbox unchecked (a no-op) when the add was already for a movable object', () => {
            const checkbox = document.getElementById('custom-fixed');
            document.getElementById('add-custom').click();
            expect(checkbox.checked).toBe(false);
        });

        it('does not uncheck itself when validation rejects the submission', () => {
            const checkbox = document.getElementById('custom-fixed');
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));
            document.getElementById('custom-w').value = '-5';
            document.getElementById('add-custom').click();

            expect(addBox).not.toHaveBeenCalled();
            expect(checkbox.checked).toBe(true);
        });
    });

    describe('price field', () => {
        it('passes a positive price through to addBox as an option', () => {
            document.getElementById('custom-price').value = '49.99';
            document.getElementById('add-custom').click();
            expect(addBox).toHaveBeenCalledWith(0.5, 0.4, 0.8, '#10b981', 5, 'Eigenes Objekt', { price: 49.99 });
        });

        it('does not pass a price option when left at the default 0, matching the pre-existing call shape', () => {
            document.getElementById('add-custom').click();
            expect(addBox).toHaveBeenCalledWith(0.5, 0.4, 0.8, '#10b981', 5, 'Eigenes Objekt');
        });

        it('combines fixed and price into one options object when both apply', () => {
            document.getElementById('custom-fixed').checked = true;
            document.getElementById('custom-price').value = '250';
            document.getElementById('add-custom').click();
            expect(addBox).toHaveBeenCalledWith(0.5, 0.4, 0.8, '#10b981', 5, 'Eigenes Objekt', { fixed: true, price: 250 });
        });

        it('rejects a negative price without calling addBox', () => {
            document.getElementById('custom-price').value = '-10';
            document.getElementById('add-custom').click();

            expect(addBox).not.toHaveBeenCalled();
            expect(document.getElementById('custom-price-error').textContent).not.toBe('');
        });

        it('rejects a non-numeric price without calling addBox', () => {
            document.getElementById('custom-price').value = '';
            document.getElementById('add-custom').click();

            expect(addBox).not.toHaveBeenCalled();
            expect(document.getElementById('custom-price-error').textContent).not.toBe('');
        });

        it('still validates price for a fixed fixture, independent of the weight-skip', () => {
            document.getElementById('custom-fixed').checked = true;
            document.getElementById('custom-price').value = '-5';
            document.getElementById('add-custom').click();

            expect(addBox).not.toHaveBeenCalled();
            expect(document.getElementById('custom-price-error').textContent).not.toBe('');
        });

        it('clears a previous price field error once a valid value is submitted', () => {
            document.getElementById('custom-price').value = '-5';
            document.getElementById('add-custom').click();
            expect(document.getElementById('custom-price-error').textContent).not.toBe('');

            document.getElementById('custom-price').value = '10';
            document.getElementById('add-custom').click();
            expect(document.getElementById('custom-price-error').textContent).toBe('');
            expect(addBox).toHaveBeenCalled();
        });
    });

    it('clears unlocked objects (sparing locked ones) and captures an undo point first', () => {
        document.getElementById('clear-all').click();
        expect(captureUndoPoint).toHaveBeenCalled();
        expect(clearUnlockedObjects).toHaveBeenCalled();
        expect(clearAllObjects).not.toHaveBeenCalled();
    });
});

// renderObjectList() isn't exported directly — it's exercised through
// refreshHistoryButtons(), which every real mutation site already calls.
// Fake mesh-like entries only need the shape renderObjectList() reads
// (geometry.parameters + userData), not real THREE objects.
function makeFakeObj({
    width = 0.6, height = 0.32, depth = 0.4, label = 'Eurobox M', weight = 8, price = 0, locked = false, fixed = false,
    parked = false,
} = {}) {
    return {
        geometry: { parameters: { width, height, depth } },
        userData: {
            label, weight, price, locked, fixed, parked,
        },
    };
}

describe('object list panel', () => {
    it('shows a placeholder when nothing is placed', () => {
        refreshHistoryButtons();
        expect(document.getElementById('object-list').textContent).toMatch(/keine objekte/i);
    });

    it('renders one row per placed object with label, size and weight', () => {
        objects.push(makeFakeObj({ label: 'Eurobox M', width: 0.6, height: 0.32, depth: 0.4, weight: 8 }));
        refreshHistoryButtons();

        const list = document.getElementById('object-list');
        expect(list.textContent).toContain('Eurobox M');
        expect(list.textContent).toContain('60x40x32');
        expect(list.textContent).toContain('8kg');
    });

    it('escapes a label containing HTML instead of injecting it', () => {
        objects.push(makeFakeObj({ label: '<img src=x onerror=alert(1)>' }));
        refreshHistoryButtons();

        const list = document.getElementById('object-list');
        expect(list.querySelector('img')).toBeNull();
        expect(list.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    it('clicking a row selects the object via controls.js', () => {
        const obj = makeFakeObj();
        objects.push(obj);
        refreshHistoryButtons();

        document.querySelector('#object-list button[data-action="select"]').click();
        expect(selectObject).toHaveBeenCalledWith(obj);
    });

    it('clicking the up icon moves the object up 5cm respecting the snap toggle, and captures an undo point', () => {
        const obj = makeFakeObj({ locked: false });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();
        document.getElementById('toggle-snap').setAttribute('aria-pressed', 'false');

        document.querySelector('#object-list button[data-action="up"]').click();
        expect(captureUndoPoint).toHaveBeenCalled();
        expect(moveVertical).toHaveBeenCalledWith(obj, 0.05, false);
    });

    it('clicking the down icon moves the object down 5cm', () => {
        const obj = makeFakeObj({ locked: false });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="down"]').click();
        expect(captureUndoPoint).toHaveBeenCalled();
        expect(moveVertical).toHaveBeenCalledWith(obj, -0.05, true);
    });

    it('clicking up/down on a locked object flashes it instead of moving it', () => {
        const obj = makeFakeObj({ locked: true });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="up"]').click();
        expect(captureUndoPoint).not.toHaveBeenCalled();
        expect(moveVertical).not.toHaveBeenCalled();
        expect(flashReject).toHaveBeenCalledWith(obj);
    });

    it('clicking the rotate icon rotates the object 90° respecting the snap toggle, and captures an undo point', () => {
        const obj = makeFakeObj({ locked: false });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();
        document.getElementById('toggle-snap').setAttribute('aria-pressed', 'false');

        document.querySelector('#object-list button[data-action="rotate"]').click();
        expect(captureUndoPoint).toHaveBeenCalled();
        expect(rotate90).toHaveBeenCalledWith(obj, false);
    });

    it('clicking rotate on a locked object flashes it instead of rotating it', () => {
        const obj = makeFakeObj({ locked: true });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="rotate"]').click();
        expect(captureUndoPoint).not.toHaveBeenCalled();
        expect(rotate90).not.toHaveBeenCalled();
        expect(flashReject).toHaveBeenCalledWith(obj);
    });

    it('clicking the tip (X-axis rotate) icon rotates the object 90° respecting the snap toggle, and captures an undo point', () => {
        const obj = makeFakeObj({ locked: false });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();
        document.getElementById('toggle-snap').setAttribute('aria-pressed', 'false');

        document.querySelector('#object-list button[data-action="rotate-x"]').click();
        expect(captureUndoPoint).toHaveBeenCalled();
        expect(rotateX90).toHaveBeenCalledWith(obj, false);
    });

    it('clicking tip (X-axis rotate) on a locked object flashes it instead of rotating it', () => {
        const obj = makeFakeObj({ locked: true });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="rotate-x"]').click();
        expect(captureUndoPoint).not.toHaveBeenCalled();
        expect(rotateX90).not.toHaveBeenCalled();
        expect(flashReject).toHaveBeenCalledWith(obj);
    });

    it('clicking the lock icon toggles lock and captures an undo point', () => {
        const obj = makeFakeObj({ locked: false });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="lock"]').click();
        expect(captureUndoPoint).toHaveBeenCalled();
        expect(toggleLock).toHaveBeenCalledWith(obj);
    });

    it('clicking the park icon on an unparked object stages it outside the van and captures an undo point', () => {
        const obj = makeFakeObj({ locked: false, parked: false });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="park"]').click();
        expect(captureUndoPoint).toHaveBeenCalled();
        expect(parkObject).toHaveBeenCalledWith(obj);
        expect(returnObjectToVan).not.toHaveBeenCalled();
    });

    it('clicking the park icon on a parked object returns it to the van and captures an undo point', () => {
        const obj = makeFakeObj({ locked: false, parked: true });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="park"]').click();
        expect(captureUndoPoint).toHaveBeenCalled();
        expect(returnObjectToVan).toHaveBeenCalledWith(obj);
        expect(parkObject).not.toHaveBeenCalled();
    });

    it('clicking the park icon on a locked object flashes it instead of (un)parking it', () => {
        const obj = makeFakeObj({ locked: true });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="park"]').click();
        expect(captureUndoPoint).not.toHaveBeenCalled();
        expect(parkObject).not.toHaveBeenCalled();
        expect(returnObjectToVan).not.toHaveBeenCalled();
        expect(flashReject).toHaveBeenCalledWith(obj);
    });

    it('clicking the park icon on a fixed obstacle flashes it instead of parking it', () => {
        const obj = makeFakeObj({ locked: true, fixed: true });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="park"]').click();
        expect(parkObject).not.toHaveBeenCalled();
        expect(flashReject).toHaveBeenCalledWith(obj);
    });

    it('shows an "ausgelagert" tag and amber styling for a parked object', () => {
        const obj = makeFakeObj({ label: 'Kajak', parked: true });
        objects.push(obj);
        refreshHistoryButtons();

        const list = document.getElementById('object-list');
        expect(list.textContent).toContain('ausgelagert');
        expect(list.querySelector('[data-action="park"][data-idx="0"]').closest('div').className).toMatch(/amber/);
    });

    it('shows and updates the parked-count badge, hiding it when nothing is parked', () => {
        const badge = document.getElementById('parked-count');
        objects.push(makeFakeObj({ parked: false }));
        refreshHistoryButtons();
        expect(badge.classList.contains('hidden')).toBe(true);

        objects.push(makeFakeObj({ parked: true }));
        refreshHistoryButtons();
        expect(badge.classList.contains('hidden')).toBe(false);
        expect(badge.textContent).toContain('1');
    });

    it('clicking delete on an unlocked object removes it and captures an undo point', () => {
        const obj = makeFakeObj({ locked: false });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="delete"]').click();
        expect(captureUndoPoint).toHaveBeenCalled();
        expect(removeObject).toHaveBeenCalledWith(obj);
    });

    it('clicking delete on a locked object flashes it instead of removing it', () => {
        const obj = makeFakeObj({ locked: true });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="delete"]').click();
        expect(captureUndoPoint).not.toHaveBeenCalled();
        expect(removeObject).not.toHaveBeenCalled();
        expect(flashReject).toHaveBeenCalledWith(obj);
    });

    it('shows "fest verbaut" instead of a weight for a fixed obstacle', () => {
        objects.push(makeFakeObj({
            label: 'Wassertank', weight: 0, locked: true, fixed: true,
        }));
        refreshHistoryButtons();

        const list = document.getElementById('object-list');
        expect(list.textContent).toContain('fest verbaut');
        expect(list.textContent).not.toContain('0kg');
    });

    it('shows the price alongside the weight when a price was given', () => {
        objects.push(makeFakeObj({ label: 'Solarpanel', weight: 4, price: 129.9 }));
        refreshHistoryButtons();

        expect(document.getElementById('object-list').textContent).toContain('129.90€');
    });

    it('shows the price for a fixed fixture too', () => {
        objects.push(makeFakeObj({
            label: 'Wassertank', weight: 0, locked: true, fixed: true, price: 250,
        }));
        refreshHistoryButtons();

        expect(document.getElementById('object-list').textContent).toContain('250.00€');
    });

    it('omits the price entirely when it is zero, instead of showing "0.00€" clutter', () => {
        objects.push(makeFakeObj({ label: 'Eurobox M', price: 0 }));
        refreshHistoryButtons();

        expect(document.getElementById('object-list').textContent).not.toContain('€');
    });

    it('clicking the lock icon on a fixed obstacle flashes it instead of toggling', () => {
        const obj = makeFakeObj({ locked: true, fixed: true });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="lock"]').click();
        expect(captureUndoPoint).not.toHaveBeenCalled();
        expect(toggleLock).not.toHaveBeenCalled();
        expect(flashReject).toHaveBeenCalledWith(obj);
    });

    it('clicking the rename icon prompts for a new name, captures an undo point, and applies it', () => {
        const obj = makeFakeObj({ label: 'Eurobox M', locked: false });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Werkzeugkiste');

        document.querySelector('#object-list button[data-action="rename"]').click();

        expect(promptSpy).toHaveBeenCalledWith('Neuer Name:', 'Eurobox M');
        expect(captureUndoPoint).toHaveBeenCalled();
        expect(renameObject).toHaveBeenCalledWith(obj, 'Werkzeugkiste');
        promptSpy.mockRestore();
    });

    it('does nothing when the rename prompt is cancelled', () => {
        const obj = makeFakeObj({ locked: false });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

        document.querySelector('#object-list button[data-action="rename"]').click();

        expect(captureUndoPoint).not.toHaveBeenCalled();
        expect(renameObject).not.toHaveBeenCalled();
        promptSpy.mockRestore();
    });

    it('rejects a blank name without capturing an undo point', () => {
        const obj = makeFakeObj({ locked: false });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('   ');

        document.querySelector('#object-list button[data-action="rename"]').click();

        expect(captureUndoPoint).not.toHaveBeenCalled();
        expect(renameObject).not.toHaveBeenCalled();
        promptSpy.mockRestore();
    });

    it('works on a locked object, unlike every other row action', () => {
        const obj = makeFakeObj({ locked: true });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Neuer Name');

        document.querySelector('#object-list button[data-action="rename"]').click();

        expect(flashReject).not.toHaveBeenCalled();
        expect(captureUndoPoint).toHaveBeenCalled();
        expect(renameObject).toHaveBeenCalledWith(obj, 'Neuer Name');
        promptSpy.mockRestore();
    });
});

describe('edit-dimensions modal', () => {
    it('clicking the pencil icon opens the modal pre-filled with the object\'s current size in cm', () => {
        const obj = makeFakeObj({
            width: 0.6, height: 0.32, depth: 0.4, locked: false,
        });
        objects.push(obj);
        refreshHistoryButtons();

        document.querySelector('#object-list button[data-action="edit-dims"]').click();

        expect(document.getElementById('edit-dims-modal').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('edit-dims-w').value).toBe('60');
        expect(document.getElementById('edit-dims-h').value).toBe('32');
        expect(document.getElementById('edit-dims-d').value).toBe('40');
    });

    it('clicking the pencil icon on a locked object flashes it instead of opening the modal', () => {
        const obj = makeFakeObj({ locked: true });
        objects.push(obj);
        refreshHistoryButtons();

        document.querySelector('#object-list button[data-action="edit-dims"]').click();

        expect(document.getElementById('edit-dims-modal').classList.contains('hidden')).toBe(true);
        expect(flashReject).toHaveBeenCalledWith(obj);
    });

    it('submitting the form resizes the object, captures an undo point, and closes the modal', () => {
        const obj = makeFakeObj({ locked: false });
        objects.push(obj);
        refreshHistoryButtons();
        captureUndoPoint.mockClear();

        document.querySelector('#object-list button[data-action="edit-dims"]').click();
        document.getElementById('edit-dims-w').value = '70';
        document.getElementById('edit-dims-h').value = '50';
        document.getElementById('edit-dims-d').value = '45';
        document.getElementById('toggle-snap').setAttribute('aria-pressed', 'false');
        document.getElementById('edit-dims-form').dispatchEvent(new Event('submit', { cancelable: true }));

        expect(captureUndoPoint).toHaveBeenCalled();
        expect(resizeObject).toHaveBeenCalledWith(obj, 0.7, 0.5, 0.45, false);
        expect(document.getElementById('edit-dims-modal').classList.contains('hidden')).toBe(true);
    });

    it('rejects an out-of-range dimension without resizing or closing the modal', () => {
        const obj = makeFakeObj({ locked: false });
        objects.push(obj);
        refreshHistoryButtons();

        document.querySelector('#object-list button[data-action="edit-dims"]').click();
        document.getElementById('edit-dims-w').value = '2000'; // > 1000cm
        document.getElementById('edit-dims-form').dispatchEvent(new Event('submit', { cancelable: true }));

        expect(resizeObject).not.toHaveBeenCalled();
        expect(document.getElementById('edit-dims-modal').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('edit-dims-w-error').textContent).toMatch(/1-1000/);
    });

    it('cancel button closes the modal without resizing', () => {
        const obj = makeFakeObj({ locked: false });
        objects.push(obj);
        refreshHistoryButtons();

        document.querySelector('#object-list button[data-action="edit-dims"]').click();
        document.getElementById('edit-dims-cancel').click();

        expect(resizeObject).not.toHaveBeenCalled();
        expect(document.getElementById('edit-dims-modal').classList.contains('hidden')).toBe(true);
    });
});

describe('camera view toolbar', () => {
    it('calls setCameraView with the matching preset for each button', async () => {
        const { setCameraView } = await import('./controls.js');
        const cases = [['cam-top', 'top'], ['cam-front', 'front'], ['cam-side', 'side'], ['cam-reset', 'iso']];
        cases.forEach(([id, view]) => {
            setCameraView.mockClear();
            document.getElementById(id).click();
            expect(setCameraView).toHaveBeenCalledWith(view);
        });
    });
});

describe('x-ray toggle', () => {
    it('toggles setXrayEnabled and the button\'s pressed state on each click', () => {
        const btn = document.getElementById('cam-xray');
        expect(btn.getAttribute('aria-pressed')).toBe('false');

        btn.click();
        expect(setXrayEnabled).toHaveBeenLastCalledWith(true);
        expect(btn.getAttribute('aria-pressed')).toBe('true');
        expect(btn.classList.contains('text-blue-300')).toBe(true);

        btn.click();
        expect(setXrayEnabled).toHaveBeenLastCalledWith(false);
        expect(btn.getAttribute('aria-pressed')).toBe('false');
        expect(btn.classList.contains('text-blue-300')).toBe(false);
    });
});

describe('undo/redo buttons', () => {
    it('starts with both buttons disabled (fresh history)', () => {
        expect(document.getElementById('undo-btn').disabled).toBe(true);
        expect(document.getElementById('redo-btn').disabled).toBe(true);
    });

    it('enables a button once its history mock reports availability', () => {
        canUndo.mockReturnValue(true);
        refreshHistoryButtons();
        expect(document.getElementById('undo-btn').disabled).toBe(false);
        expect(document.getElementById('redo-btn').disabled).toBe(true);
    });

    it('undo button click calls undo() and re-syncs sliders on success', async () => {
        const { undo } = await import('./history.js');
        undo.mockReturnValue(true);
        canUndo.mockReturnValue(true);
        refreshHistoryButtons(); // enable the button, matching what a real capture would do
        vanState.maxHeight = 2.2;

        document.getElementById('undo-btn').click();

        expect(undo).toHaveBeenCalled();
        expect(document.getElementById('van-height').value).toBe('220');
    });

    it('redo button click calls redo()', async () => {
        const { redo } = await import('./history.js');
        redo.mockReturnValue(true);
        canRedo.mockReturnValue(true);
        refreshHistoryButtons();

        document.getElementById('redo-btn').click();

        expect(redo).toHaveBeenCalled();
    });
});

describe('project persistence', () => {
    it('auto-loads a saved project on init instead of building defaults', () => {
        loadConfig.mockReturnValue(true);
        buildVanGeometry.mockClear();

        initUI(); // re-init to exercise the loadConfig()-succeeds branch

        expect(buildVanGeometry).not.toHaveBeenCalled(); // loadConfig() already rebuilds internally
    });

    it('builds from defaults on init when nothing was saved', () => {
        // loadConfig already mocked to return false in beforeEach
        expect(buildVanGeometry).toHaveBeenCalled();
    });

    it('does not add an undo point for the initial auto-load on page boot', () => {
        // captureUndoPoint was already cleared post-init by earlier tests'
        // beforeEach ordering; check directly against a fresh init.
        captureUndoPoint.mockClear();
        loadConfig.mockReturnValue(true);
        initUI();
        expect(captureUndoPoint).not.toHaveBeenCalled();
    });

    it('saves on click and shows a success status', () => {
        document.getElementById('save-config').click();
        expect(saveConfig).toHaveBeenCalled();
        expect(document.getElementById('persistence-status').textContent).toMatch(/gespeichert/i);
    });

    it('shows a failure status when saving fails', () => {
        saveConfig.mockReturnValueOnce(false);
        document.getElementById('save-config').click();
        expect(document.getElementById('persistence-status').textContent).toMatch(/fehlgeschlagen/i);
    });

    it('loads, captures an undo point first, and re-syncs the sliders when a saved config exists', () => {
        hasSavedConfig.mockReturnValue(true);
        loadConfig.mockReturnValue(true);
        vanState.maxHeight = 2.2; // simulate loadConfig() having changed vanState

        document.getElementById('load-config').click();

        expect(captureUndoPoint).toHaveBeenCalled();
        expect(loadConfig).toHaveBeenCalled();
        expect(document.getElementById('van-height').value).toBe('220');
        expect(document.getElementById('val-height').textContent).toBe('220');
    });

    it('shows a "nothing saved" status and skips the undo capture when there is nothing to load', () => {
        // hasSavedConfig mocked to false in beforeEach; clear the call that
        // initUI()'s own auto-load-on-boot already made to loadConfig().
        loadConfig.mockClear();
        document.getElementById('load-config').click();
        expect(captureUndoPoint).not.toHaveBeenCalled();
        expect(loadConfig).not.toHaveBeenCalled();
        expect(document.getElementById('persistence-status').textContent).toMatch(/kein/i);
    });

    it('asks for confirmation, then clears storage, wipes objects, and restores default vanState on reset', () => {
        vanState.length = 4.9;
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

        document.getElementById('reset-config').click();

        expect(confirmSpy).toHaveBeenCalled();
        expect(captureUndoPoint).toHaveBeenCalled();
        expect(clearSavedConfig).toHaveBeenCalled();
        expect(clearAllObjects).toHaveBeenCalled();
        expect(vanState.length).toBe(DEFAULT_VAN_STATE.length);
        expect(document.getElementById('van-len').value).toBe(String(Math.round(DEFAULT_VAN_STATE.length * 100)));
        expect(buildVanGeometry).toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('does nothing when the reset confirmation is declined', () => {
        vanState.length = 4.9;
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

        document.getElementById('reset-config').click();

        expect(captureUndoPoint).not.toHaveBeenCalled();
        expect(clearSavedConfig).not.toHaveBeenCalled();
        expect(clearAllObjects).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('prompts for a filename, sanitizes it, and exports on click', () => {
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('mein-projekt');

        document.getElementById('export-config').click();

        expect(promptSpy).toHaveBeenCalledWith('Dateiname für den Export:', 'vanspace3d-projekt');
        expect(sanitizeFilename).toHaveBeenCalledWith('mein-projekt', 'vanspace3d-projekt', 'json');
        expect(exportToFile).toHaveBeenCalledWith('mein-projekt.json');
        promptSpy.mockRestore();
    });

    it('does not export when the filename prompt is cancelled', () => {
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

        document.getElementById('export-config').click();

        expect(exportToFile).not.toHaveBeenCalled();
        promptSpy.mockRestore();
    });

    it('exports the PDF packplan on click and shows a success status', () => {
        document.getElementById('export-pdf').click();
        expect(exportSchematicPdfToFile).toHaveBeenCalled();
        expect(document.getElementById('persistence-status').textContent).toMatch(/pdf/i);
    });

    it('imports the selected file, captures an undo point, and re-syncs on success', async () => {
        loadConfig.mockReturnValue(false); // keep init simple; irrelevant here
        vanState.maxHeight = 2.4;

        const file = new File(['{"version":1,"vanState":{},"objects":[]}'], 'project.json', { type: 'application/json' });
        const input = document.getElementById('import-config-file');
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change', { bubbles: true }));

        await vi.waitFor(() => expect(importFromText).toHaveBeenCalled());

        expect(captureUndoPoint).toHaveBeenCalled();
        expect(document.getElementById('persistence-status').textContent).toMatch(/importiert/i);
        expect(input.value).toBe(''); // cleared so re-selecting the same file re-fires 'change'
    });

    it('shows a failure status when the imported file is invalid', async () => {
        importFromText.mockReturnValue(false);

        const file = new File(['not json'], 'bad.json', { type: 'application/json' });
        const input = document.getElementById('import-config-file');
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change', { bubbles: true }));

        await vi.waitFor(() => expect(importFromText).toHaveBeenCalled());

        expect(document.getElementById('persistence-status').textContent).toMatch(/fehlgeschlagen/i);
    });
});

describe('named projects', () => {
    it('shows a placeholder when none are saved', () => {
        expect(document.getElementById('project-list').textContent).toMatch(/keine gespeicherten/i);
    });

    it('renders one row per saved project with its name', () => {
        listProjects.mockReturnValue([
            { id: 'a', name: 'Umzug', savedAt: Date.now() },
            { id: 'b', name: 'Camping', savedAt: Date.now() },
        ]);
        initUI(); // re-render the project list with the mocked entries present

        const rows = document.querySelectorAll('#project-list button[data-action="load-project"]');
        expect(rows).toHaveLength(2);
        expect(document.getElementById('project-list').textContent).toContain('Umzug');
        expect(document.getElementById('project-list').textContent).toContain('Camping');
    });

    it('save-as prompts for a name and calls saveNamedProject', () => {
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Umzug');
        document.getElementById('save-as-project').click();

        expect(promptSpy).toHaveBeenCalled();
        expect(saveNamedProject).toHaveBeenCalledWith('Umzug');
        promptSpy.mockRestore();
    });

    it('save-as does nothing when the prompt is cancelled', () => {
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
        document.getElementById('save-as-project').click();

        expect(saveNamedProject).not.toHaveBeenCalled();
        promptSpy.mockRestore();
    });

    it('save-as asks for confirmation before overwriting an existing project name', () => {
        listProjects.mockReturnValue([{ id: 'abc', name: 'Umzug', savedAt: Date.now() }]);
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Umzug');
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

        document.getElementById('save-as-project').click();

        expect(confirmSpy).toHaveBeenCalled();
        expect(saveNamedProject).toHaveBeenCalledWith('Umzug');
        promptSpy.mockRestore();
        confirmSpy.mockRestore();
    });

    it('save-as does not overwrite when the confirmation is declined', () => {
        listProjects.mockReturnValue([{ id: 'abc', name: 'Umzug', savedAt: Date.now() }]);
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Umzug');
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

        document.getElementById('save-as-project').click();

        expect(saveNamedProject).not.toHaveBeenCalled();
        promptSpy.mockRestore();
        confirmSpy.mockRestore();
    });

    it('shows a failure status when saveNamedProject rejects the name', () => {
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Umzug');
        saveNamedProject.mockReturnValue(false);

        document.getElementById('save-as-project').click();

        expect(document.getElementById('persistence-status').textContent).toMatch(/fehlgeschlagen/i);
        promptSpy.mockRestore();
    });

    it('loading a project captures an undo point, re-syncs sliders, and shows success', () => {
        listProjects.mockReturnValue([{ id: 'abc', name: 'Umzug', savedAt: Date.now() }]);
        initUI(); // re-render the project list with the mocked entry present
        captureUndoPoint.mockClear();

        document.querySelector('#project-list button[data-action="load-project"]').click();

        expect(captureUndoPoint).toHaveBeenCalled();
        expect(loadNamedProject).toHaveBeenCalledWith('abc');
        expect(document.getElementById('persistence-status').textContent).toMatch(/geladen/i);
    });

    it('shows a failure status when loading a project fails', () => {
        listProjects.mockReturnValue([{ id: 'abc', name: 'Umzug', savedAt: Date.now() }]);
        loadNamedProject.mockReturnValue(false);
        initUI();

        document.querySelector('#project-list button[data-action="load-project"]').click();

        expect(document.getElementById('persistence-status').textContent).toMatch(/fehlgeschlagen/i);
    });

    it('renaming a project prompts pre-filled with the current name and calls renameNamedProject', () => {
        listProjects.mockReturnValue([{ id: 'abc', name: 'Umzug', savedAt: Date.now() }]);
        initUI();
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Umzug (final)');

        document.querySelector('#project-list button[data-action="rename-project"]').click();

        expect(promptSpy).toHaveBeenCalledWith(expect.any(String), 'Umzug');
        expect(renameNamedProject).toHaveBeenCalledWith('abc', 'Umzug (final)');
        promptSpy.mockRestore();
    });

    it('rename does nothing when the prompt is cancelled', () => {
        listProjects.mockReturnValue([{ id: 'abc', name: 'Umzug', savedAt: Date.now() }]);
        initUI();
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

        document.querySelector('#project-list button[data-action="rename-project"]').click();

        expect(renameNamedProject).not.toHaveBeenCalled();
        promptSpy.mockRestore();
    });

    it('deleting a project asks for confirmation, then calls deleteNamedProject', () => {
        listProjects.mockReturnValue([{ id: 'abc', name: 'Umzug', savedAt: Date.now() }]);
        initUI();
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

        document.querySelector('#project-list button[data-action="delete-project"]').click();

        expect(confirmSpy).toHaveBeenCalled();
        expect(deleteNamedProject).toHaveBeenCalledWith('abc');
        confirmSpy.mockRestore();
    });

    it('delete does nothing when the confirmation is declined', () => {
        listProjects.mockReturnValue([{ id: 'abc', name: 'Umzug', savedAt: Date.now() }]);
        initUI();
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

        document.querySelector('#project-list button[data-action="delete-project"]').click();

        expect(deleteNamedProject).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });
});
