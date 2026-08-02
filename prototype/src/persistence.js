import { vanState, objects, DEFAULT_VAN_STATE } from './state.js';
import { buildVanGeometry } from './van.js';
import { computeCenterOfGravity } from './cog.js';
import {
    addBox, clearAllObjects, toggleLock, DEFAULT_WEIGHT,
} from './objects.js';

const STORAGE_KEY = 'vanspace3d.config.v1';
const VAN_STATE_KEYS = Object.keys(DEFAULT_VAN_STATE);

function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

// localStorage access can throw even for read-only calls (Safari private
// browsing, disabled storage, sandboxed iframes) — never let a save/load
// attempt crash the app over it.
function safeStorageCall(fn, fallback) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

// Only copies over keys that are known, valid numbers — a corrupted or
// hand-edited save falls back to the existing (default) value per field
// instead of poisoning the whole van with NaN/undefined.
function sanitizeVanState(raw) {
    const clean = {};
    if (raw && typeof raw === 'object') {
        for (const key of VAN_STATE_KEYS) {
            if (isFiniteNumber(raw[key])) clean[key] = raw[key];
        }
    }
    return clean;
}

function isSaneObjectEntry(o) {
    if (!o || typeof o !== 'object') return false;
    const dimsOk = ['w', 'h', 'd'].every((k) => isFiniteNumber(o[k]) && o[k] > 0 && o[k] <= 10);
    const colorOk = isFiniteNumber(o.color) && o.color >= 0 && o.color <= 0xffffff;
    const posOk = !!o.position && ['x', 'y', 'z'].every((k) => isFiniteNumber(o.position[k]));
    return dimsOk && colorOk && posOk;
}

// Weight is treated more leniently than dimensions/position: an old save
// from before this field existed, or a corrupted value, just falls back to
// the default rather than disqualifying the whole object entry.
function sanitizeWeight(w) {
    return (isFiniteNumber(w) && w > 0 && w <= 2000) ? w : DEFAULT_WEIGHT;
}

// Same leniency as weight: missing (old saves) or invalid falls back to
// addBox()'s own "Objekt" default rather than disqualifying the entry.
function sanitizeLabel(l) {
    return (typeof l === 'string' && l.trim()) ? l.trim().slice(0, 60) : null;
}

function isValidPayloadShape(payload) {
    return !!payload && typeof payload === 'object' && Array.isArray(payload.objects);
}

// ==========================================
// PURE (DE)SERIALIZATION — shared by localStorage save/load, file
// export/import, and the in-memory undo/redo history.
// ==========================================
export function serializeState() {
    return {
        version: 1,
        vanState: { ...vanState },
        objects: objects.map((o) => ({
            w: o.geometry.parameters.width,
            h: o.geometry.parameters.height,
            d: o.geometry.parameters.depth,
            color: o.material.color.getHex(),
            weight: o.userData.weight ?? DEFAULT_WEIGHT,
            label: o.userData.label ?? null,
            locked: !!o.userData.locked,
            position: { x: o.position.x, y: o.position.y, z: o.position.z },
        })),
    };
}

// Replaces the live van + objects with the given (already shape-checked)
// payload. Individually invalid fields/entries are sanitized rather than
// rejecting the whole payload.
export function applyState(payload) {
    clearAllObjects();
    Object.assign(vanState, sanitizeVanState(payload.vanState));
    (payload.objects || []).filter(isSaneObjectEntry).forEach((o) => {
        const mesh = addBox(o.w, o.h, o.d, o.color, sanitizeWeight(o.weight), sanitizeLabel(o.label));
        mesh.position.set(o.position.x, o.position.y, o.position.z);
        if (o.locked) toggleLock(mesh); // addBox() always creates unlocked, so toggle only when true
    });
    buildVanGeometry(); // rebuilds the van for the loaded state and re-clamps every object into it
}

// ==========================================
// localStorage
// ==========================================
export function saveConfig() {
    return safeStorageCall(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
        return true;
    }, false);
}

export function hasSavedConfig() {
    return safeStorageCall(() => localStorage.getItem(STORAGE_KEY) !== null, false);
}

export function clearSavedConfig() {
    safeStorageCall(() => localStorage.removeItem(STORAGE_KEY), undefined);
}

// Returns true if a saved config was found and applied, false otherwise
// (nothing saved, storage unavailable, or the saved payload was corrupt).
export function loadConfig() {
    const raw = safeStorageCall(() => localStorage.getItem(STORAGE_KEY), null);
    if (!raw) return false;

    let payload;
    try {
        payload = JSON.parse(raw);
    } catch {
        return false;
    }
    if (!isValidPayloadShape(payload)) return false;

    applyState(payload);
    return true;
}

// ==========================================
// JSON file export/import
// ==========================================
function downloadTextFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function exportToFile(filename = 'vanspace3d-project.json') {
    downloadTextFile(JSON.stringify(serializeState(), null, 2), filename, 'application/json');
}

// ==========================================
// Human-readable packing list (.txt) — a take-along summary for loading the
// van, distinct from the JSON project file above (which is meant for
// re-import, not reading).
// ==========================================
function formatOffsetCm(value, positiveLabel, negativeLabel) {
    return value >= 0 ? `${Math.round(value * 100)}cm ${positiveLabel}` : `${Math.round(-value * 100)}cm ${negativeLabel}`;
}

export function generatePackingListText() {
    const lines = [
        'VanSpace 3D – Packliste',
        `Erstellt: ${new Date().toLocaleString('de-DE')}`,
        '',
        'Fahrzeug:',
        `  Länge: ${Math.round(vanState.length * 100)}cm, Höhe: ${Math.round(vanState.maxHeight * 100)}cm, Breite: ${Math.round(vanState.maxWidth * 100)}cm (unten: ${Math.round(vanState.narrowWidth * 100)}cm)`,
        `  Max. Zuladung: ${vanState.maxPayload}kg`,
        '',
        `Objekte (${objects.length}):`,
    ];

    objects.forEach((obj, i) => {
        const { width, height, depth } = obj.geometry.parameters;
        const label = obj.userData.label || 'Objekt';
        const dims = `${Math.round(width * 100)}x${Math.round(depth * 100)}x${Math.round(height * 100)}cm`;
        const weight = (obj.userData.weight ?? DEFAULT_WEIGHT).toFixed(1);
        const lockFlag = obj.userData.locked ? ' [gesperrt]' : '';
        const pos = obj.position;
        const posLabel = `${formatOffsetCm(pos.x, 'rechts', 'links')}, ${formatOffsetCm(pos.z, 'hinten', 'vorne')}, ${Math.round(pos.y * 100)}cm hoch`;
        lines.push(`  ${i + 1}. ${label} — ${dims} — ${weight}kg${lockFlag}`);
        lines.push(`     Position: ${posLabel}`);
    });

    const cog = computeCenterOfGravity();
    const totalWeight = cog ? cog.totalWeight : 0;
    lines.push('');
    lines.push(`Gesamtgewicht: ${totalWeight.toFixed(1)}kg von ${vanState.maxPayload}kg Zuladung`);
    if (cog) {
        lines.push(`Schwerpunkt: ${formatOffsetCm(cog.x, 'rechts', 'links')}, ${formatOffsetCm(cog.z, 'hinten', 'vorne')} von Fahrzeugmitte`);
    }

    return lines.join('\n');
}

export function exportPackingListToFile(filename = 'vanspace3d-packliste.txt') {
    downloadTextFile(generatePackingListText(), filename, 'text/plain');
}

// Returns true if the given text was a valid project JSON and was applied.
export function importFromText(text) {
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        return false;
    }
    if (!isValidPayloadShape(payload)) return false;

    applyState(payload);
    return true;
}
