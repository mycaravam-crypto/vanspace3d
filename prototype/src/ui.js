import { vanState, DEFAULT_VAN_STATE } from './state.js';
import { buildVanGeometry } from './van.js';
import {
    addBox, clearAllObjects, clearUnlockedObjects, DEFAULT_WEIGHT,
} from './objects.js';
import { STANDARD_LIBRARY } from './library.js';
import {
    saveConfig, loadConfig, hasSavedConfig, clearSavedConfig, exportToFile, importFromText,
} from './persistence.js';
import { captureUndoPoint, undo, redo, canUndo, canRedo } from './history.js';

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

// ==========================================
// CONFIGURATION BINDINGS
// ==========================================
function updateLabels() {
    document.getElementById('val-len').textContent = vanState.length.toFixed(2);
    document.getElementById('val-front-len').textContent = vanState.frontLength.toFixed(2);
    document.getElementById('val-height').textContent = vanState.maxHeight.toFixed(2);
    document.getElementById('val-width-max').textContent = vanState.maxWidth.toFixed(2);
    document.getElementById('val-width-min').textContent = vanState.narrowWidth.toFixed(2);
    document.getElementById('val-arch-h').textContent = vanState.archHeight.toFixed(2);
}

function updateConfigFromUI() {
    vanState.length = parseFloat(document.getElementById('van-len').value);

    const rawFront = parseFloat(document.getElementById('van-front-len').value);
    vanState.frontLength = Math.min(rawFront, vanState.length);
    document.getElementById('van-front-len').value = vanState.frontLength; // Update slider if clamped

    vanState.maxHeight = parseFloat(document.getElementById('van-height').value);
    vanState.maxWidth = parseFloat(document.getElementById('van-width-max').value);

    const rawMinW = parseFloat(document.getElementById('van-width-min').value);
    vanState.narrowWidth = Math.min(rawMinW, vanState.maxWidth);

    const rawArchH = parseFloat(document.getElementById('van-arch-h').value);
    vanState.archHeight = Math.min(rawArchH, vanState.maxHeight - 0.1);

    updateLabels();
    buildVanGeometry();
}

const CONFIG_SLIDER_IDS = ['van-len', 'van-front-len', 'van-height', 'van-width-max', 'van-width-min', 'van-arch-h'];

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
    document.getElementById('van-len').value = vanState.length;
    document.getElementById('van-front-len').value = vanState.frontLength;
    document.getElementById('van-height').value = vanState.maxHeight;
    document.getElementById('van-width-max').value = vanState.maxWidth;
    document.getElementById('van-width-min').value = vanState.narrowWidth;
    document.getElementById('van-arch-h').value = vanState.archHeight;
    updateLabels();
}

// ==========================================
// OBJECT PANEL BINDINGS
// ==========================================
function renderStandardLibrary() {
    const container = document.getElementById('standard-library-list');
    if (!container) return;

    container.innerHTML = STANDARD_LIBRARY.map((item) => `
        <button class="flex justify-between items-center px-3 py-2 bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:border-slate-300 border-l-4 border-l-${item.accent}-500 group" data-lib-id="${item.id}">
            <span class="text-sm font-medium text-slate-700 group-hover:text-${item.accent}-600">${item.label}</span>
            <span class="text-[11px] text-slate-400 font-mono">${Math.round(item.w * 100)}x${Math.round(item.d * 100)}x${Math.round(item.h * 100)}</span>
        </button>
    `).join('');

    container.querySelectorAll('button[data-lib-id]').forEach((btn) => {
        const item = STANDARD_LIBRARY.find((i) => i.id === btn.dataset.libId);
        btn.addEventListener('click', () => {
            captureUndoPoint();
            addBox(item.w, item.h, item.d, item.color, item.weight);
            refreshHistoryButtons();
        });
    });
}

function initObjectPanel() {
    renderStandardLibrary();

    document.getElementById('add-custom').addEventListener('click', () => {
        const w = parseFloat(document.getElementById('custom-w').value) / 100;
        const h = parseFloat(document.getElementById('custom-h').value) / 100;
        const d = parseFloat(document.getElementById('custom-d').value) / 100;
        const c = document.getElementById('custom-c').value;
        const rawWeight = parseFloat(document.getElementById('custom-weight').value);
        const weight = (Number.isFinite(rawWeight) && rawWeight > 0) ? rawWeight : DEFAULT_WEIGHT;

        // Guard against NaN (empty/invalid input), non-positive, and absurdly
        // large values (e.g. a stray extra digit) that would silently fail or
        // spawn a box far outside the visible/interactive area.
        const isSane = (v) => Number.isFinite(v) && v > 0 && v <= 10;
        if (isSane(w) && isSane(h) && isSane(d)) {
            captureUndoPoint();
            addBox(w, h, d, c, weight);
            refreshHistoryButtons();
        } else {
            alert('Bitte gültige Maße zwischen 1 und 1000 cm eingeben.');
        }
    });

    document.getElementById('clear-all').addEventListener('click', () => {
        captureUndoPoint();
        clearUnlockedObjects(); // locked objects are protected from bulk removal too
        refreshHistoryButtons();
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

export function initUI() {
    initTabs();
    initConfigSliders();
    initObjectPanel();
    initHistoryButtons();
    initPersistence();

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
