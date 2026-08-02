import { vanState, DEFAULT_VAN_STATE, objects } from './state.js';
import { buildVanGeometry } from './van.js';
import {
    addBox, clearAllObjects, clearUnlockedObjects, toggleLock, removeObject, moveVertical, flashReject,
} from './objects.js';
import { STANDARD_LIBRARY } from './library.js';
import { VEHICLE_PRESETS } from './vehicles.js';
import {
    saveConfig, loadConfig, hasSavedConfig, clearSavedConfig, exportToFile, exportPackingListToFile, importFromText,
    listProjects, saveNamedProject, loadNamedProject, deleteNamedProject, renameNamedProject,
} from './persistence.js';
import { captureUndoPoint, undo, redo, canUndo, canRedo } from './history.js';
import { selectObject, setCameraView } from './controls.js';

// ==========================================
// UI LOGIC
// ==========================================
export function isSnapEnabled() {
    return document.getElementById('toggle-snap').checked;
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

        activeTab.className = 'tab-btn active flex-1 py-2 text-sm font-semibold';
        inactiveTab.className = 'tab-btn inactive flex-1 py-2 text-sm font-semibold';
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

    container.innerHTML = VEHICLE_PRESETS.map((preset) => `
        <button class="flex justify-between items-center px-3 py-2 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:border-slate-300 border-l-4 border-l-slate-400 group" data-preset-id="${preset.id}">
            <span class="text-sm font-medium text-slate-700 group-hover:text-blue-600">${preset.label}</span>
            <span class="text-[11px] text-slate-400 font-mono">${(preset.length * 100).toFixed(0)}x${(preset.maxWidth * 100).toFixed(0)}x${(preset.maxHeight * 100).toFixed(0)}</span>
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
// appear literally in source — `border-l-${item.accent}-500` would compile
// away since the scanner never sees the resolved string. This lookup keeps
// every accent's full class names literal so the build doesn't purge them.
const LIBRARY_ACCENT_CLASSES = {
    sky: { border: 'border-l-sky-500', hoverBg: 'hover:bg-sky-50 hover:border-sky-300', hoverText: 'group-hover:text-sky-600' },
    blue: { border: 'border-l-blue-500', hoverBg: 'hover:bg-blue-50 hover:border-blue-300', hoverText: 'group-hover:text-blue-600' },
    indigo: { border: 'border-l-indigo-500', hoverBg: 'hover:bg-indigo-50 hover:border-indigo-300', hoverText: 'group-hover:text-indigo-600' },
    cyan: { border: 'border-l-cyan-500', hoverBg: 'hover:bg-cyan-50 hover:border-cyan-300', hoverText: 'group-hover:text-cyan-600' },
    amber: { border: 'border-l-amber-500', hoverBg: 'hover:bg-amber-50 hover:border-amber-300', hoverText: 'group-hover:text-amber-600' },
};

function renderStandardLibrary() {
    const container = document.getElementById('standard-library-list');
    if (!container) return;

    container.innerHTML = STANDARD_LIBRARY.map((item) => {
        const accent = LIBRARY_ACCENT_CLASSES[item.accent] || LIBRARY_ACCENT_CLASSES.blue;
        return `
        <button class="flex justify-between items-center px-3 py-2 bg-white border border-slate-200 rounded-md ${accent.hoverBg} border-l-4 ${accent.border} group" data-lib-id="${item.id}">
            <span class="text-sm font-medium text-slate-700 ${accent.hoverText}">${item.label}</span>
            <span class="text-right">
                <span class="block text-[11px] text-slate-400 font-mono">${Math.round(item.w * 100)}x${Math.round(item.d * 100)}x${Math.round(item.h * 100)}</span>
                <span class="block text-[10px] text-slate-400 font-mono">${item.weight}kg</span>
            </span>
        </button>
    `;
    }).join('');

    container.querySelectorAll('button[data-lib-id]').forEach((btn) => {
        const item = STANDARD_LIBRARY.find((i) => i.id === btn.dataset.libId);
        btn.addEventListener('click', () => {
            captureUndoPoint();
            addBox(item.w, item.h, item.d, item.color, item.weight, item.label);
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
const isSaneDimension = (v) => Number.isFinite(v) && v > 0 && v <= 10;
const isSaneWeight = (v) => Number.isFinite(v) && v > 0 && v <= 1000;

function setCustomFieldError(field, message) {
    const input = document.getElementById(field.id);
    const errorEl = document.getElementById(field.errorId);
    if (!input) return;
    input.classList.toggle('border-red-500', !!message);
    input.classList.toggle('border-slate-300', !message);
    if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    if (errorEl) errorEl.textContent = message || '';
}

function initObjectPanel() {
    renderStandardLibrary();

    // Wrapped in a <form> (index.html) so pressing Enter in any field submits
    // it, same as clicking "Generieren".
    document.getElementById('custom-object-form').addEventListener('submit', (e) => {
        e.preventDefault();

        const dims = CUSTOM_DIMENSION_FIELDS.map((f) => parseFloat(document.getElementById(f.id).value) / 100);
        const rawWeight = parseFloat(document.getElementById(CUSTOM_WEIGHT_FIELD.id).value);
        const c = document.getElementById('custom-c').value;
        const rawName = document.getElementById('custom-name').value.trim();
        const label = rawName || 'Eigenes Objekt';

        let firstInvalidId = null;
        CUSTOM_DIMENSION_FIELDS.forEach((field, i) => {
            const ok = isSaneDimension(dims[i]);
            setCustomFieldError(field, ok ? '' : `${field.label}: bitte 1-1000 cm.`);
            if (!ok) firstInvalidId = firstInvalidId || field.id;
        });
        const weightOk = isSaneWeight(rawWeight);
        setCustomFieldError(CUSTOM_WEIGHT_FIELD, weightOk ? '' : 'Gewicht: bitte 0.1-1000 kg.');
        if (!weightOk) firstInvalidId = firstInvalidId || CUSTOM_WEIGHT_FIELD.id;

        if (firstInvalidId) {
            document.getElementById(firstInvalidId).focus();
            return;
        }

        const [w, h, d] = dims;
        captureUndoPoint();
        addBox(w, h, d, c, rawWeight, label);
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

// Renders the list of placed objects (label, size, weight, lock state) so an
// object can be found and selected/locked/deleted without hunting for it in
// the 3D view. Kept in sync by calling this from refreshHistoryButtons() —
// every mutation site in the app already calls that after changing `objects`.
function renderObjectList() {
    const container = document.getElementById('object-list');
    if (!container) return;

    if (objects.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-400 italic px-1 py-1">Keine Objekte platziert.</p>';
        return;
    }

    container.innerHTML = objects.map((obj, i) => {
        const { width, height, depth } = obj.geometry.parameters;
        const label = escapeHtml(obj.userData.label || 'Objekt');
        const locked = !!obj.userData.locked;
        const selected = !!obj.userData.selected;
        const weight = obj.userData.weight ?? 0;
        const dims = `${Math.round(width * 100)}x${Math.round(depth * 100)}x${Math.round(height * 100)}`;
        const rowBorder = selected ? 'border-blue-400 ring-1 ring-blue-300' : 'border-slate-200';
        return `
            <div class="flex items-center gap-0.5 pl-2 pr-1 py-1 bg-white border ${rowBorder} rounded-md hover:border-blue-300 hover:bg-blue-50/50">
                <button type="button" data-action="select" data-idx="${i}" class="flex-1 min-w-0 text-left py-0.5">
                    <div class="text-xs font-medium text-slate-700 truncate">${label}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${dims} &middot; ${weight}kg</div>
                </button>
                <button type="button" data-action="up" data-idx="${i}" title="Hoch (&uarr;), 5cm" class="p-1.5 rounded text-slate-300 hover:text-slate-600 text-xs leading-none font-bold">&uarr;</button>
                <button type="button" data-action="down" data-idx="${i}" title="Runter (&darr;), 5cm" class="p-1.5 rounded text-slate-300 hover:text-slate-600 text-xs leading-none font-bold">&darr;</button>
                <button type="button" data-action="lock" data-idx="${i}" title="Sperren/Entsperren (L)" class="p-1.5 rounded ${locked ? 'text-red-500 hover:text-red-600' : 'text-slate-300 hover:text-slate-500'}">${locked ? ICON_LOCK : ICON_UNLOCK}</button>
                <button type="button" data-action="delete" data-idx="${i}" title="L&ouml;schen (Entf)" class="p-1.5 rounded text-slate-300 hover:text-red-500">${ICON_TRASH}</button>
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
            } else if (action === 'up' || action === 'down') {
                if (obj.userData.locked) { flashReject(obj); return; }
                captureUndoPoint();
                moveVertical(obj, action === 'up' ? 0.05 : -0.05, isSnapEnabled());
                refreshHistoryButtons();
            } else if (action === 'lock') {
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
        exportToFile();
        showStatus('Exportiert ✓');
    });

    document.getElementById('export-packing-list').addEventListener('click', () => {
        exportPackingListToFile();
        showStatus('Packliste exportiert ✓');
    });

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
    if (list.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-400 italic px-1 py-1">Keine gespeicherten Projekte.</p>';
        return;
    }

    container.innerHTML = list.map((p) => `
        <div class="flex items-center gap-0.5 pl-2 pr-1 py-1 bg-white border border-slate-200 rounded-md hover:border-blue-300 hover:bg-blue-50/50">
            <button type="button" data-action="load-project" data-id="${p.id}" class="flex-1 min-w-0 text-left py-0.5">
                <div class="text-xs font-medium text-slate-700 truncate">${escapeHtml(p.name)}</div>
                <div class="text-[10px] text-slate-400 font-mono">${formatSavedAt(p.savedAt)}</div>
            </button>
            <button type="button" data-action="rename-project" data-id="${p.id}" title="Umbenennen" class="p-1.5 rounded text-slate-300 hover:text-slate-600">${ICON_PENCIL}</button>
            <button type="button" data-action="delete-project" data-id="${p.id}" title="L&ouml;schen" class="p-1.5 rounded text-slate-300 hover:text-red-500">${ICON_TRASH}</button>
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
    initHistoryButtons();
    initPersistence();
    initNamedProjects();
    initCameraToolbar();
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
