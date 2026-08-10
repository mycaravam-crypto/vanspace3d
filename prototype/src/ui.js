import { vanState, DEFAULT_VAN_STATE, objects } from './state.js';
import { buildVanGeometry } from './van.js';
import {
    addBox, clearAllObjects, clearUnlockedObjects, toggleLock, removeObject, moveVertical, resizeObject, rotate90,
    rotateX90, flashReject, setXrayEnabled, renameObject, parkObject, returnObjectToVan,
} from './objects.js';
import { STANDARD_LIBRARY } from './library.js';
import { VEHICLE_PRESETS } from './vehicles.js';
import {
    saveConfig, loadConfig, hasSavedConfig, clearSavedConfig, exportToFile, importFromText,
    sanitizeFilename,
    listProjects, saveNamedProject, loadNamedProject, deleteNamedProject, renameNamedProject,
} from './persistence.js';
import { exportSchematicPdfToFile } from './pdfExport.js';
import { captureUndoPoint, undo, redo, canUndo, canRedo } from './history.js';
import { selectObject, setCameraView } from './controls.js';

// ==========================================
// UI LOGIC
// ==========================================
export function isSnapEnabled() {
    return document.getElementById('toggle-snap').checked;
}

export function isLabelsEnabled() {
    return document.getElementById('toggle-labels').checked;
}

function initTabs() {
    const tabObjects = document.getElementById('tab-objects');
    const tabConfig = document.getElementById('tab-config');
    const panelObjects = document.getElementById('panel-objects');
    const panelConfig = document.getElementById('panel-config');

    function switchTab(activeTab, inactiveTab, activePanel, inactivePanel) {
        activePanel.classList.remove('hidden');
        activePanel.classList.add('flex');
        inactivePanel.classList.add('hidden');
        inactivePanel.classList.remove('flex');

        activeTab.className = 'tab-btn active flex-1 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60';
        inactiveTab.className = 'tab-btn inactive flex-1 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60';
    }

    tabObjects.addEventListener('click', () => switchTab(tabObjects, tabConfig, panelObjects, panelConfig));
    tabConfig.addEventListener('click', () => switchTab(tabConfig, tabObjects, panelConfig, panelObjects));
}

// Help modal (keyboard shortcuts + basic controls) — hidden by default,
// opened via the "?" button in the header instead of taking up permanent
// scroll space in the side panel.
function initHelpModal() {
    const toggle = document.getElementById('help-toggle');
    const modal = document.getElementById('help-modal');
    const closeBtn = document.getElementById('help-close');
    if (!toggle || !modal) return;

    const open = () => { modal.classList.remove('hidden'); modal.classList.add('flex'); };
    const close = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };

    toggle.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    // Click on the backdrop (not the dialog itself) closes it too.
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
    });
}

// ==========================================
// RESPONSIVE PANEL (mobile bottom sheet)
// ==========================================
// Below the md breakpoint, #ui-container becomes a full-width bottom sheet
// (see index.html) that starts collapsed so it doesn't cover the 3D view on
// a phone/tablet. #panel-toggle expands/collapses it by swapping a couple of
// Tailwind utility classes; md+ layout is handled entirely by static md:
// classes in index.html and is unaffected by this toggle.
const SHEET_COLLAPSED_CLASSES = ['max-h-16', 'overflow-hidden'];
const SHEET_EXPANDED_CLASSES = ['max-h-[70vh]', 'overflow-y-auto'];

function initResponsivePanel() {
    const container = document.getElementById('ui-container');
    const toggle = document.getElementById('panel-toggle');
    if (!container || !toggle) return;

    // jsdom (test environment) doesn't implement matchMedia — fall back to
    // "not mobile" so tests can drive the toggle explicitly instead.
    const mq = typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 767px)')
        : { matches: false, addEventListener() {} };

    let collapsed = mq.matches;

    function apply() {
        if (collapsed) {
            container.classList.remove(...SHEET_EXPANDED_CLASSES);
            container.classList.add(...SHEET_COLLAPSED_CLASSES);
            toggle.innerHTML = '&#9652;'; // ▲ — tap to expand
            toggle.setAttribute('aria-expanded', 'false');
        } else {
            container.classList.remove(...SHEET_COLLAPSED_CLASSES);
            container.classList.add(...SHEET_EXPANDED_CLASSES);
            toggle.innerHTML = '&#9662;'; // ▼ — tap to collapse
            toggle.setAttribute('aria-expanded', 'true');
        }
    }

    toggle.addEventListener('click', () => {
        collapsed = !collapsed;
        apply();
    });

    // Crossing back into the desktop breakpoint drops the mobile collapsed
    // state, so resizing a window up never leaves the sheet stuck collapsed
    // underneath the always-expanded md: layout.
    mq.addEventListener('change', (e) => {
        collapsed = e.matches;
        apply();
    });

    apply();
}

// ==========================================
// CONFIGURATION BINDINGS
// ==========================================
// vanState stores lengths in meters (matching the Three.js scene's
// 1-unit-per-meter convention), but every length in the UI — including
// these sliders — is shown/entered in cm, like the rest of the app
// (library sizes, custom objects, vehicle presets). This is a display/input
// conversion only; nothing downstream of vanState changes units.
const CM_PER_M = 100;

function updateLabels() {
    document.getElementById('val-len').textContent = Math.round(vanState.length * CM_PER_M);
    document.getElementById('val-front-len').textContent = Math.round(vanState.frontLength * CM_PER_M);
    document.getElementById('val-height').textContent = Math.round(vanState.maxHeight * CM_PER_M);
    document.getElementById('val-width-max').textContent = Math.round(vanState.maxWidth * CM_PER_M);
    document.getElementById('val-width-min').textContent = Math.round(vanState.narrowWidth * CM_PER_M);
    document.getElementById('val-arch-h').textContent = Math.round(vanState.archHeight * CM_PER_M);
    document.getElementById('val-payload').textContent = vanState.maxPayload.toFixed(0);
}

function updateConfigFromUI() {
    vanState.length = parseFloat(document.getElementById('van-len').value) / CM_PER_M;

    const rawFront = parseFloat(document.getElementById('van-front-len').value) / CM_PER_M;
    vanState.frontLength = Math.min(rawFront, vanState.length);
    document.getElementById('van-front-len').value = vanState.frontLength * CM_PER_M; // Update slider if clamped

    vanState.maxHeight = parseFloat(document.getElementById('van-height').value) / CM_PER_M;
    vanState.maxWidth = parseFloat(document.getElementById('van-width-max').value) / CM_PER_M;

    const rawMinW = parseFloat(document.getElementById('van-width-min').value) / CM_PER_M;
    vanState.narrowWidth = Math.min(rawMinW, vanState.maxWidth);

    const rawArchH = parseFloat(document.getElementById('van-arch-h').value) / CM_PER_M;
    vanState.archHeight = Math.min(rawArchH, vanState.maxHeight - 0.1);

    vanState.maxPayload = parseFloat(document.getElementById('van-payload').value);

    updateLabels();
    buildVanGeometry();
}

const CONFIG_SLIDER_IDS = [
    'van-len', 'van-front-len', 'van-height', 'van-width-max', 'van-width-min', 'van-arch-h', 'van-payload',
];

// Renders one button per VEHICLE_PRESETS entry; clicking one overwrites the
// whole vanState (all dimensions + maxPayload) in one gesture, same pattern
// as a standard-library object add (one undo point, then a full re-sync).
function initVehiclePresets() {
    const container = document.getElementById('vehicle-preset-list');
    if (!container) return;

    const VAN_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M3 16V8a1 1 0 0 1 1-1h10l4 4v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg>';

    // Dims go on their own line (indented under the label) rather than
    // squeezed onto the same row as the icon — some preset names ("VW
    // Transporter (kurz)", "Mercedes Sprinter L2H2") are long enough that
    // sharing a row with both the icon and the dims forced a truncated label.
    container.innerHTML = VEHICLE_PRESETS.map((preset) => `
        <button class="flex flex-col items-start gap-0.5 px-3 py-2 bg-white/5 border border-white/10 rounded-lg transition-colors hover:bg-white/10 hover:border-white/20 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60" data-preset-id="${preset.id}">
            <span class="flex items-center gap-1.5 min-w-0 text-slate-500 group-hover:text-blue-300">
                ${VAN_ICON}
                <span class="text-sm font-medium text-slate-300 group-hover:text-blue-300">${preset.label}</span>
            </span>
            <span class="text-[10px] text-slate-500 font-mono pl-[20px]">${(preset.length * 100).toFixed(0)}x${(preset.maxWidth * 100).toFixed(0)}x${(preset.maxHeight * 100).toFixed(0)}</span>
        </button>
    `).join('');

    container.querySelectorAll('button[data-preset-id]').forEach((btn) => {
        const preset = VEHICLE_PRESETS.find((p) => p.id === btn.dataset.presetId);
        btn.addEventListener('click', () => {
            captureUndoPoint();
            Object.assign(vanState, {
                length: preset.length,
                frontLength: preset.frontLength,
                maxHeight: preset.maxHeight,
                maxWidth: preset.maxWidth,
                narrowWidth: preset.narrowWidth,
                archHeight: preset.archHeight,
                maxPayload: preset.maxPayload,
            });
            syncSlidersFromState();
            buildVanGeometry();
            refreshHistoryButtons();
        });
    });
}

function initConfigSliders() {
    CONFIG_SLIDER_IDS.forEach((id) => {
        const slider = document.getElementById(id);
        // 'input' fires continuously while dragging — live preview only.
        slider.addEventListener('input', updateConfigFromUI);
        // Capture the pre-drag state once per gesture, on 'pointerdown' —
        // before any 'input' events have mutated vanState. A 'change'
        // listener would fire too late, after the drag already moved it.
        slider.addEventListener('pointerdown', () => {
            captureUndoPoint();
            refreshHistoryButtons();
        });
    });
}

// Pushes the current vanState back onto the sliders + labels. Needed after
// anything that changes vanState from outside the slider inputs themselves
// (loading a saved config, undo/redo, resetting to defaults).
export function syncSlidersFromState() {
    document.getElementById('van-len').value = Math.round(vanState.length * CM_PER_M);
    document.getElementById('van-front-len').value = Math.round(vanState.frontLength * CM_PER_M);
    document.getElementById('van-height').value = Math.round(vanState.maxHeight * CM_PER_M);
    document.getElementById('van-width-max').value = Math.round(vanState.maxWidth * CM_PER_M);
    document.getElementById('van-width-min').value = Math.round(vanState.narrowWidth * CM_PER_M);
    document.getElementById('van-arch-h').value = Math.round(vanState.archHeight * CM_PER_M);
    document.getElementById('van-payload').value = vanState.maxPayload;
    updateLabels();
}

// ==========================================
// OBJECT PANEL BINDINGS
// ==========================================
// Tailwind's build-time content scanner only picks up class names that
// appear literally in source — `hover:bg-${item.accent}-500/10` would compile
// away since the scanner never sees the resolved string. This lookup keeps
// every accent's full class names literal so the build doesn't purge them.
const LIBRARY_ACCENT_CLASSES = {
    sky: { hoverBg: 'hover:bg-sky-500/10 hover:border-sky-400/40' },
    blue: { hoverBg: 'hover:bg-blue-500/10 hover:border-blue-400/40' },
    indigo: { hoverBg: 'hover:bg-indigo-500/10 hover:border-indigo-400/40' },
    cyan: { hoverBg: 'hover:bg-cyan-500/10 hover:border-cyan-400/40' },
    amber: { hoverBg: 'hover:bg-amber-500/10 hover:border-amber-400/40' },
};

// A small color swatch showing the object's actual 3D color reads as a more
// direct "icon" for what you're about to place than an abstract accent
// stripe — same numeric color used for the box mesh itself (see library.js).
function swatchHex(colorInt) {
    return `#${colorInt.toString(16).padStart(6, '0')}`;
}

function renderStandardLibrary() {
    const container = document.getElementById('standard-library-list');
    if (!container) return;

    container.innerHTML = STANDARD_LIBRARY.map((item) => {
        const accent = LIBRARY_ACCENT_CLASSES[item.accent] || LIBRARY_ACCENT_CLASSES.blue;
        const dims = `${Math.round(item.w * 100)}x${Math.round(item.d * 100)}x${Math.round(item.h * 100)}`;
        // Only shown when the entry actually has one — most non-Eurobox
        // entries don't, and a "0.00€" on every card/tooltip would just be
        // noise.
        const priceSuffix = item.price > 0 ? `, ${item.price.toFixed(2)}€` : '';
        // Weight and price live only in the tooltip, not the visible card —
        // with both the label and dims already fighting for space in a
        // 2-column grid this narrow, adding a third/fourth value to the
        // on-card text overlapped/overflowed it (see truncate below); the
        // full detail is still one hover away.
        const tooltip = `${item.label}: ${dims}cm, ${item.weight}kg${priceSuffix}`;
        return `
        <button class="flex flex-col items-start gap-1 px-2.5 py-2 bg-white/5 border border-white/10 rounded-lg transition-colors ${accent.hoverBg} group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60" data-lib-id="${item.id}" title="${tooltip}">
            <span class="flex items-center gap-1.5 min-w-0">
                <span class="w-3 h-3 rounded shrink-0 ring-1 ring-white/20" style="background:${swatchHex(item.color)}" aria-hidden="true"></span>
                <span class="text-sm font-medium text-slate-300 truncate">${item.label}</span>
            </span>
            <span class="text-[10px] text-slate-500 font-mono truncate">${dims}</span>
        </button>
    `;
    }).join('');

    container.querySelectorAll('button[data-lib-id]').forEach((btn) => {
        const item = STANDARD_LIBRARY.find((i) => i.id === btn.dataset.libId);
        btn.addEventListener('click', () => {
            captureUndoPoint();
            addBox(item.w, item.h, item.d, item.color, item.weight, item.label, { price: item.price ?? 0 });
            refreshHistoryButtons();
        });
    });
}

// Dimension fields are sanity-checked against a <= 10 (m) bound, rejecting
// anything over 1000cm; weight gets an analogous upper bound so a stray
// extra digit can't silently blow past the payload display and skew the
// center-of-gravity calculation.
const CUSTOM_DIMENSION_FIELDS = [
    { id: 'custom-w', errorId: 'custom-w-error', label: 'Breite' },
    { id: 'custom-h', errorId: 'custom-h-error', label: 'Höhe' },
    { id: 'custom-d', errorId: 'custom-d-error', label: 'Tiefe' },
];
const CUSTOM_WEIGHT_FIELD = { id: 'custom-weight', errorId: 'custom-weight-error', label: 'Gewicht' };
const CUSTOM_PRICE_FIELD = { id: 'custom-price', errorId: 'custom-price-error', label: 'Preis' };
const isSaneDimension = (v) => Number.isFinite(v) && v > 0 && v <= 10;
const isSaneWeight = (v) => Number.isFinite(v) && v > 0 && v <= 1000;
// Unlike weight, 0 is a legitimate price (nothing paid for it yet) rather
// than a value that needs rejecting — validated for every object regardless
// of the "Fest verbaut" toggle, since a built-in fixture still costs money.
const isSanePrice = (v) => Number.isFinite(v) && v >= 0 && v <= 1000000;

// "Fest verbaut" toggles the custom-object form between generating movable
// cargo (the default) and a permanent built-in fixture (bed platform, water
// tank, ...) — addBox()'s `fixed` option handles the actual weight/lock
// semantics; this just disables the now-inapplicable weight field and clears
// any stale error on it so a leftover "Gewicht: bitte ..." message doesn't
// linger once weight stops being asked for.
function applyFixedToggleState(fixedCheckbox, weightInput) {
    weightInput.disabled = fixedCheckbox.checked;
    weightInput.classList.toggle('opacity-50', fixedCheckbox.checked);
    if (fixedCheckbox.checked) setCustomFieldError(CUSTOM_WEIGHT_FIELD, '');
}

function initFixedToggle() {
    const fixedCheckbox = document.getElementById('custom-fixed');
    const weightInput = document.getElementById(CUSTOM_WEIGHT_FIELD.id);
    if (!fixedCheckbox || !weightInput) return;

    fixedCheckbox.addEventListener('change', () => applyFixedToggleState(fixedCheckbox, weightInput));
}

// Un-checks "Fest verbaut" after a successful add and re-enables the weight
// field to match — otherwise the checkbox stays checked from the previous
// submission and every object generated afterward silently becomes another
// permanent, zero-weight fixture until the user notices and unchecks it
// themselves.
function resetFixedToggle() {
    const fixedCheckbox = document.getElementById('custom-fixed');
    const weightInput = document.getElementById(CUSTOM_WEIGHT_FIELD.id);
    if (!fixedCheckbox || !weightInput || !fixedCheckbox.checked) return;
    fixedCheckbox.checked = false;
    applyFixedToggleState(fixedCheckbox, weightInput);
}

function setCustomFieldError(field, message) {
    const input = document.getElementById(field.id);
    const errorEl = document.getElementById(field.errorId);
    if (!input) return;
    input.classList.toggle('border-red-500', !!message);
    input.classList.toggle('border-white/10', !message);
    if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    if (errorEl) errorEl.textContent = message || '';
}

function initObjectPanel() {
    renderStandardLibrary();
    initFixedToggle();

    // Wrapped in a <form> (index.html) so pressing Enter in any field submits
    // it, same as clicking "Generieren".
    document.getElementById('custom-object-form').addEventListener('submit', (e) => {
        e.preventDefault();

        const dims = CUSTOM_DIMENSION_FIELDS.map((f) => parseFloat(document.getElementById(f.id).value) / 100);
        const rawWeight = parseFloat(document.getElementById(CUSTOM_WEIGHT_FIELD.id).value);
        const rawPrice = parseFloat(document.getElementById(CUSTOM_PRICE_FIELD.id).value);
        const c = document.getElementById('custom-c').value;
        const rawName = document.getElementById('custom-name').value.trim();
        const label = rawName || 'Eigenes Objekt';
        const fixedEl = document.getElementById('custom-fixed');
        const isFixed = !!(fixedEl && fixedEl.checked);

        let firstInvalidId = null;
        CUSTOM_DIMENSION_FIELDS.forEach((field, i) => {
            const ok = isSaneDimension(dims[i]);
            setCustomFieldError(field, ok ? '' : `${field.label}: bitte 1-1000 cm.`);
            if (!ok) firstInvalidId = firstInvalidId || field.id;
        });
        // A fixed fixture carries no weight (addBox() forces it to 0
        // regardless of what's entered here), so the field is skipped
        // entirely rather than validated against a value that won't be used.
        if (!isFixed) {
            const weightOk = isSaneWeight(rawWeight);
            setCustomFieldError(CUSTOM_WEIGHT_FIELD, weightOk ? '' : 'Gewicht: bitte 0.1-1000 kg.');
            if (!weightOk) firstInvalidId = firstInvalidId || CUSTOM_WEIGHT_FIELD.id;
        }
        // Price applies regardless of fixed/movable — a built-in fixture
        // still cost real money — so it's always validated.
        const priceOk = isSanePrice(rawPrice);
        setCustomFieldError(CUSTOM_PRICE_FIELD, priceOk ? '' : 'Preis: bitte 0-1.000.000 €.');
        if (!priceOk) firstInvalidId = firstInvalidId || CUSTOM_PRICE_FIELD.id;

        if (firstInvalidId) {
            document.getElementById(firstInvalidId).focus();
            return;
        }

        const [w, h, d] = dims;
        captureUndoPoint();
        // Only pass an options object when it actually says something beyond
        // addBox()'s own defaults (fixed:false, price:0), keeping the common
        // "plain movable cargo" call the same shape it's always been.
        const boxOptions = {};
        if (isFixed) boxOptions.fixed = true;
        if (rawPrice > 0) boxOptions.price = rawPrice;
        if (Object.keys(boxOptions).length > 0) {
            addBox(w, h, d, c, rawWeight, label, boxOptions);
        } else {
            addBox(w, h, d, c, rawWeight, label);
        }
        resetFixedToggle();
        refreshHistoryButtons();
    });

    document.getElementById('clear-all').addEventListener('click', () => {
        captureUndoPoint();
        clearUnlockedObjects(); // locked objects are protected from bulk removal too
        refreshHistoryButtons();
    });
}

// ==========================================
// OBJECT LIST (inspector)
// ==========================================
function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

const ICON_LOCK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const ICON_UNLOCK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 7.6-1.5"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7m2 0-.8 12.1a2 2 0 0 1-2 1.9H9.8a2 2 0 0 1-2-1.9L7 7"/></svg>';
const ICON_PENCIL = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_TAG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.41 20.59a2 2 0 0 1-2.82 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><path d="M7 7h.01"/></svg>';
// Touch/mobile-friendly equivalent of the 'R' keyboard shortcut (rotate90()) —
// the object list is the only place a phone/tablet user (no keyboard) can
// trigger a rotation at all.
const ICON_ROTATE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 1 3 6.7"/><path d="M3 21v-6h6"/></svg>';
// Same glyph as ICON_ROTATE, rotated 90deg on-screen to hint at the other
// rotation plane — the object list's equivalent of the 'T' shortcut
// (rotateX90()), for tipping an object onto its front/back face.
const ICON_ROTATE_X = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(90deg)"><path d="M3 12a9 9 0 1 1 3 6.7"/><path d="M3 21v-6h6"/></svg>';
// "Auslagern" (park outside the van) / "Zurück in den Laderaum" (return) —
// a log-out / log-in pair reads naturally as "take it out of" / "put it back
// into" the van.
const ICON_PARK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
const ICON_UNPARK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';

// Renders the list of placed objects (label, size, weight, lock state) so an
// object can be found and selected/locked/deleted without hunting for it in
// the 3D view. Kept in sync by calling this from refreshHistoryButtons() —
// every mutation site in the app already calls that after changing `objects`.
function renderObjectList() {
    const container = document.getElementById('object-list');

    const parkedCountEl = document.getElementById('parked-count');
    if (parkedCountEl) {
        const parkedCount = objects.filter((o) => o.userData.parked).length;
        parkedCountEl.classList.toggle('hidden', parkedCount === 0);
        parkedCountEl.textContent = `${parkedCount} ausgelagert`;
    }

    if (!container) return;

    if (objects.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-500 text-center px-2 py-3 border border-dashed border-white/10 rounded-lg">Keine Objekte platziert</p>';
        return;
    }

    container.innerHTML = objects.map((obj, i) => {
        const { width, height, depth } = obj.geometry.parameters;
        const label = escapeHtml(obj.userData.label || 'Objekt');
        const fixed = !!obj.userData.fixed;
        const locked = !!obj.userData.locked;
        const selected = !!obj.userData.selected;
        const parked = !!obj.userData.parked;
        const weight = obj.userData.weight ?? 0;
        const price = obj.userData.price ?? 0;
        const dims = `${Math.round(width * 100)}x${Math.round(depth * 100)}x${Math.round(height * 100)}`;
        const parkedSuffix = parked ? ' &middot; ausgelagert' : '';
        // Only shown when a price was actually given — most objects have
        // none, and a string of "0.00€" on every row would just be noise.
        const priceSuffix = price > 0 ? ` &middot; ${price.toFixed(2)}&euro;` : '';
        const meta = fixed
            ? `${dims} &middot; fest verbaut${priceSuffix}`
            : `${dims} &middot; ${weight}kg${parkedSuffix}${priceSuffix}`;
        const rowBorder = selected
            ? 'border-blue-400/60 ring-1 ring-blue-400/40 bg-blue-500/10'
            : (parked ? 'border-amber-400/40 bg-amber-500/10' : 'border-white/10 bg-white/5');
        const lockTitle = fixed ? 'Fest verbaut (dauerhaft gesperrt)' : 'Sperren/Entsperren (L)';
        const parkTitle = fixed
            ? 'Fest verbaut (kann nicht ausgelagert werden)'
            : (parked ? 'Zurück in den Laderaum' : 'Vorübergehend auslagern (aus dem Laderaum nehmen)');
        // Rows now carry 9 action icons (park is the newest addition) in a
        // fixed-width sidebar, so every icon button here is a notch tighter
        // (p-1 instead of the p-1.5 still used elsewhere, e.g. the project
        // list) than the app's usual icon-button padding — otherwise the
        // label/meta text on the left is squeezed down to almost nothing.
        return `
            <div class="flex items-center gap-px pl-1.5 pr-0.5 py-1 border ${rowBorder} rounded-lg hover:border-blue-400/40 hover:bg-blue-500/10 transition-colors">
                <button type="button" data-action="select" data-idx="${i}" title="${label}" class="flex-1 min-w-0 text-left py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">
                    <div class="text-xs font-medium text-slate-200 truncate">${label}</div>
                    <div class="text-[10px] text-slate-500 font-mono truncate">${meta}</div>
                </button>
                <button type="button" data-action="rename" data-idx="${i}" title="Umbenennen" class="p-1 rounded text-slate-500 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">${ICON_TAG}</button>
                <button type="button" data-action="edit-dims" data-idx="${i}" title="Ma&szlig;e bearbeiten" class="p-1 rounded text-slate-500 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">${ICON_PENCIL}</button>
                <button type="button" data-action="rotate" data-idx="${i}" title="Drehen (R), 90&deg; (Y-Achse)" class="p-1 rounded text-slate-500 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">${ICON_ROTATE}</button>
                <button type="button" data-action="rotate-x" data-idx="${i}" title="Kippen (T), 90&deg; (X-Achse)" class="p-1 rounded text-slate-500 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">${ICON_ROTATE_X}</button>
                <button type="button" data-action="up" data-idx="${i}" title="Hoch (&uarr;), 5cm" class="p-1 rounded text-slate-500 hover:text-slate-200 text-xs leading-none font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">&uarr;</button>
                <button type="button" data-action="down" data-idx="${i}" title="Runter (&darr;), 5cm" class="p-1 rounded text-slate-500 hover:text-slate-200 text-xs leading-none font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">&darr;</button>
                <button type="button" data-action="park" data-idx="${i}" title="${parkTitle}" class="p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ${parked ? 'text-amber-400 hover:text-amber-300' : 'text-slate-500 hover:text-slate-300'}">${parked ? ICON_UNPARK : ICON_PARK}</button>
                <button type="button" data-action="lock" data-idx="${i}" title="${lockTitle}" class="p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ${locked ? 'text-red-400 hover:text-red-300' : 'text-slate-500 hover:text-slate-300'}">${locked ? ICON_LOCK : ICON_UNLOCK}</button>
                <button type="button" data-action="delete" data-idx="${i}" title="L&ouml;schen (Entf)" class="p-1 rounded text-slate-500 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60">${ICON_TRASH}</button>
            </div>`;
    }).join('');

    container.querySelectorAll('button[data-action]').forEach((btn) => {
        const idx = parseInt(btn.dataset.idx, 10);
        const obj = objects[idx];
        if (!obj) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'select') {
                selectObject(obj);
            } else if (action === 'rename') {
                // Not lock-gated (see renameObject() in objects.js) — reachable
                // for locked and fixed objects alike, unlike every other row
                // action here.
                const current = obj.userData.label || 'Objekt';
                const next = prompt('Neuer Name:', current);
                if (next === null) return; // cancelled
                if (!next.trim()) {
                    showStatus('Umbenennen fehlgeschlagen (Name darf nicht leer sein).');
                    return; // nothing changed — not worth an undo slot
                }
                captureUndoPoint();
                renameObject(obj, next);
                refreshHistoryButtons();
            } else if (action === 'edit-dims') {
                openEditDimsModal(obj);
            } else if (action === 'rotate') {
                if (obj.userData.locked) { flashReject(obj); return; }
                captureUndoPoint();
                rotate90(obj, isSnapEnabled());
                refreshHistoryButtons();
            } else if (action === 'rotate-x') {
                if (obj.userData.locked) { flashReject(obj); return; }
                captureUndoPoint();
                rotateX90(obj, isSnapEnabled());
                refreshHistoryButtons();
            } else if (action === 'up' || action === 'down') {
                if (obj.userData.locked) { flashReject(obj); return; }
                captureUndoPoint();
                moveVertical(obj, action === 'up' ? 0.05 : -0.05, isSnapEnabled());
                refreshHistoryButtons();
            } else if (action === 'park') {
                if (obj.userData.fixed) { flashReject(obj); return; } // never a candidate for staging outside the van
                if (obj.userData.locked) { flashReject(obj); return; }
                captureUndoPoint();
                if (obj.userData.parked) returnObjectToVan(obj); else parkObject(obj);
                refreshHistoryButtons();
            } else if (action === 'lock') {
                if (obj.userData.fixed) { flashReject(obj); return; } // permanently locked, nothing to toggle
                captureUndoPoint();
                toggleLock(obj);
                refreshHistoryButtons();
            } else if (action === 'delete') {
                if (obj.userData.locked) { flashReject(obj); return; }
                captureUndoPoint();
                removeObject(obj);
                refreshHistoryButtons();
            }
        });
    });
}

// ==========================================
// EDIT DIMENSIONS MODAL
// ==========================================
// Lets the user change a placed object's width/height/depth after the fact,
// instead of only being able to set them at creation time. Opened from the
// pencil icon on an object-list row; shares the same "1-1000 cm" validation
// as the custom-object form above.
const EDIT_DIMS_FIELDS = [
    { id: 'edit-dims-w', errorId: 'edit-dims-w-error', label: 'Breite' },
    { id: 'edit-dims-h', errorId: 'edit-dims-h-error', label: 'Höhe' },
    { id: 'edit-dims-d', errorId: 'edit-dims-d-error', label: 'Tiefe' },
];

let editingObj = null;

function closeEditDimsModal() {
    const modal = document.getElementById('edit-dims-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    editingObj = null;
    EDIT_DIMS_FIELDS.forEach((f) => setCustomFieldError(f, ''));
}

// Refuses — with the usual red flash, no dialog — for a locked (or fixed,
// which is always locked) object, since resizeObject() would reject it
// anyway; better to say so upfront than let the form look usable and only
// fail on submit.
function openEditDimsModal(obj) {
    if (!obj || obj.userData.locked) {
        flashReject(obj);
        return;
    }
    const modal = document.getElementById('edit-dims-modal');
    if (!modal) return;

    editingObj = obj;
    const { width, height, depth } = obj.geometry.parameters;
    document.getElementById('edit-dims-w').value = Math.round(width * CM_PER_M);
    document.getElementById('edit-dims-h').value = Math.round(height * CM_PER_M);
    document.getElementById('edit-dims-d').value = Math.round(depth * CM_PER_M);
    EDIT_DIMS_FIELDS.forEach((f) => setCustomFieldError(f, ''));

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function initEditDimsModal() {
    const modal = document.getElementById('edit-dims-modal');
    if (!modal) return;

    document.getElementById('edit-dims-close').addEventListener('click', closeEditDimsModal);
    document.getElementById('edit-dims-cancel').addEventListener('click', closeEditDimsModal);
    // Click on the backdrop (not the dialog itself) closes it too.
    modal.addEventListener('click', (e) => { if (e.target === modal) closeEditDimsModal(); });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeEditDimsModal();
    });

    document.getElementById('edit-dims-form').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!editingObj) return;

        const dims = EDIT_DIMS_FIELDS.map((f) => parseFloat(document.getElementById(f.id).value) / CM_PER_M);

        let firstInvalidId = null;
        EDIT_DIMS_FIELDS.forEach((field, i) => {
            const ok = isSaneDimension(dims[i]);
            setCustomFieldError(field, ok ? '' : `${field.label}: bitte 1-1000 cm.`);
            if (!ok) firstInvalidId = firstInvalidId || field.id;
        });
        if (firstInvalidId) {
            document.getElementById(firstInvalidId).focus();
            return;
        }

        const [w, h, d] = dims;
        const obj = editingObj;
        closeEditDimsModal();

        captureUndoPoint();
        const ok = resizeObject(obj, w, h, d, isSnapEnabled());
        refreshHistoryButtons();
        if (!ok) showStatus('Nicht möglich (Kollision).');
    });
}

// ==========================================
// CAMERA VIEW TOOLBAR
// ==========================================
const CAMERA_VIEW_BUTTON_IDS = {
    'cam-top': 'top', 'cam-front': 'front', 'cam-side': 'side', 'cam-reset': 'iso',
};

function initCameraToolbar() {
    Object.entries(CAMERA_VIEW_BUTTON_IDS).forEach(([id, view]) => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', () => setCameraView(view));
    });
}

// X-ray toggle, next to the camera-view presets — a persistent on/off state
// (unlike the momentary view buttons above), so it needs its own pressed
// styling instead of just firing once. Not persisted/undo-tracked, same as
// the camera position itself; setXrayEnabled() (objects.js) re-applies to
// every tracked object and any added/loaded/undone afterward.
function initXrayToggle() {
    const btn = document.getElementById('cam-xray');
    if (!btn) return;

    let active = false;
    btn.addEventListener('click', () => {
        active = !active;
        setXrayEnabled(active);
        btn.classList.toggle('text-blue-300', active);
        btn.classList.toggle('bg-blue-500/10', active);
        btn.setAttribute('aria-pressed', String(active));
    });
}

// ==========================================
// UNDO / REDO
// ==========================================
export function refreshHistoryButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if (undoBtn) undoBtn.disabled = !canUndo();
    if (redoBtn) redoBtn.disabled = !canRedo();
    renderObjectList();
}

function initHistoryButtons() {
    document.getElementById('undo-btn').addEventListener('click', () => {
        if (undo()) {
            syncSlidersFromState();
            refreshHistoryButtons();
        }
    });
    document.getElementById('redo-btn').addEventListener('click', () => {
        if (redo()) {
            syncSlidersFromState();
            refreshHistoryButtons();
        }
    });
}

// ==========================================
// PROJECT PERSISTENCE (localStorage + JSON file)
// ==========================================
let statusTimeout = null;
function showStatus(message) {
    const el = document.getElementById('persistence-status');
    if (!el) return;
    el.textContent = message;
    clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => { el.textContent = ''; }, 2500);
}

function initPersistence() {
    document.getElementById('save-config').addEventListener('click', () => {
        showStatus(saveConfig() ? 'Gespeichert ✓' : 'Speichern fehlgeschlagen (Speicher nicht verfügbar).');
    });

    document.getElementById('load-config').addEventListener('click', () => {
        // Check first so a "nothing saved" click doesn't waste an undo slot.
        if (!hasSavedConfig()) {
            showStatus('Kein gespeicherter Stand gefunden.');
            return;
        }
        captureUndoPoint();
        if (loadConfig()) {
            syncSlidersFromState();
            refreshHistoryButtons();
            showStatus('Geladen ✓');
        } else {
            showStatus('Laden fehlgeschlagen (gespeicherter Stand ist beschädigt).');
        }
    });

    document.getElementById('reset-config').addEventListener('click', () => {
        if (!confirm('Laderaum und alle Objekte wirklich zurücksetzen?')) return;
        captureUndoPoint();
        clearSavedConfig();
        clearAllObjects();
        Object.assign(vanState, DEFAULT_VAN_STATE);
        syncSlidersFromState();
        buildVanGeometry();
        refreshHistoryButtons();
        showStatus('Zurückgesetzt ✓');
    });

    document.getElementById('export-config').addEventListener('click', () => {
        const name = prompt('Dateiname für den Export:', 'vanspace3d-projekt');
        if (name === null) return; // cancelled
        exportToFile(sanitizeFilename(name, 'vanspace3d-projekt', 'json'));
        showStatus('Exportiert ✓');
    });

    document.getElementById('export-pdf').addEventListener('click', () => {
        exportSchematicPdfToFile();
        showStatus('PDF exportiert ✓');
    });

    // The hidden file input is triggered by a <label for="import-config-file">
    // styled as an icon button — labels forward a mouse click to their
    // associated control natively, but not a keyboard Enter/Space on the
    // label itself, so that needs a manual bridge for keyboard users.
    const importLabel = document.querySelector('label[for="import-config-file"]');
    if (importLabel) {
        importLabel.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                document.getElementById('import-config-file').click();
            }
        });
    }

    document.getElementById('import-config-file').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            captureUndoPoint();
            if (importFromText(String(reader.result))) {
                syncSlidersFromState();
                refreshHistoryButtons();
                showStatus('Importiert ✓');
            } else {
                refreshHistoryButtons();
                showStatus('Import fehlgeschlagen (ungültige Datei).');
            }
        };
        reader.onerror = () => showStatus('Import fehlgeschlagen (Datei konnte nicht gelesen werden).');
        reader.readAsText(file);

        e.target.value = ''; // allow re-selecting the same file later
    });
}

// ==========================================
// NAMED PROJECTS — multiple independently saved layouts, distinct from the
// single autosave slot handled by initPersistence() above.
// ==========================================
function formatSavedAt(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

function renderProjectList() {
    const container = document.getElementById('project-list');
    if (!container) return;

    const list = listProjects();

    const countEl = document.getElementById('project-count');
    if (countEl) countEl.textContent = list.length;

    if (list.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-500 text-center px-2 py-3 border border-dashed border-white/10 rounded-lg">Keine gespeicherten Projekte</p>';
        return;
    }

    container.innerHTML = list.map((p) => `
        <div class="flex items-center gap-0.5 pl-2 pr-1 py-1 bg-white/5 border border-white/10 rounded-lg hover:border-blue-400/40 hover:bg-blue-500/10 transition-colors">
            <button type="button" data-action="load-project" data-id="${p.id}" class="flex-1 min-w-0 text-left py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">
                <div class="text-xs font-medium text-slate-200 truncate">${escapeHtml(p.name)}</div>
                <div class="text-[10px] text-slate-500 font-mono">${formatSavedAt(p.savedAt)}</div>
            </button>
            <button type="button" data-action="rename-project" data-id="${p.id}" title="Umbenennen" class="p-1.5 rounded text-slate-500 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">${ICON_PENCIL}</button>
            <button type="button" data-action="delete-project" data-id="${p.id}" title="L&ouml;schen" class="p-1.5 rounded text-slate-500 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60">${ICON_TRASH}</button>
        </div>`).join('');

    container.querySelectorAll('button[data-action]').forEach((btn) => {
        const { id } = btn.dataset;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;

            if (action === 'load-project') {
                captureUndoPoint();
                if (loadNamedProject(id)) {
                    syncSlidersFromState();
                    refreshHistoryButtons();
                    showStatus('Projekt geladen ✓');
                } else {
                    refreshHistoryButtons();
                    showStatus('Laden fehlgeschlagen.');
                }
            } else if (action === 'rename-project') {
                const current = listProjects().find((p) => p.id === id);
                const next = prompt('Neuer Projektname:', current ? current.name : '');
                if (next === null) return; // cancelled
                showStatus(renameNamedProject(id, next) ? 'Umbenannt ✓' : 'Umbenennen fehlgeschlagen.');
                renderProjectList();
            } else if (action === 'delete-project') {
                const current = listProjects().find((p) => p.id === id);
                if (!confirm(`"${current ? current.name : 'Projekt'}" wirklich löschen?`)) return;
                deleteNamedProject(id);
                renderProjectList();
                showStatus('Gelöscht ✓');
            }
        });
    });
}

function initNamedProjects() {
    renderProjectList();

    document.getElementById('save-as-project').addEventListener('click', () => {
        const name = prompt('Projektname:');
        if (name === null) return; // cancelled

        const trimmed = name.trim();
        const existing = listProjects().find((p) => p.name === trimmed);
        if (existing && !confirm(`"${trimmed}" existiert bereits — überschreiben?`)) return;

        if (saveNamedProject(name)) {
            renderProjectList();
            showStatus('Gespeichert ✓');
        } else {
            showStatus('Speichern fehlgeschlagen (Name leer?).');
        }
    });
}

export function initUI() {
    initTabs();
    initResponsivePanel();
    initVehiclePresets();
    initConfigSliders();
    initObjectPanel();
    initEditDimsModal();
    initHistoryButtons();
    initPersistence();
    initNamedProjects();
    initCameraToolbar();
    initXrayToggle();
    initHelpModal();

    // Resume the last saved project on startup if there is one, otherwise
    // just build the van from the default vanState. Not itself an undo point
    // — undo/redo history starts empty on every fresh page load.
    if (loadConfig()) {
        syncSlidersFromState();
    } else {
        buildVanGeometry();
    }
    refreshHistoryButtons();
}
