import { vanState, objects, DEFAULT_VAN_STATE } from './state.js';
import { buildVanGeometry } from './van.js';
import {
    addBox, clearAllObjects, toggleLock, refreshObjectAppearance, DEFAULT_WEIGHT, DEFAULT_PRICE,
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

// Shared by every localStorage collection below (named projects, custom
// library) that needs a per-entry id distinct from its display name.
function generateStorageId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

// Same leniency as weight, but unlike weight 0 is a legitimate value (an
// object that didn't cost anything), not something to fall back away from.
function sanitizePrice(p) {
    return (isFiniteNumber(p) && p >= 0 && p <= 1000000) ? p : DEFAULT_PRICE;
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
            price: o.userData.price ?? DEFAULT_PRICE,
            label: o.userData.label ?? null,
            locked: !!o.userData.locked,
            fixed: !!o.userData.fixed,
            parked: !!o.userData.parked,
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
        const fixed = !!o.fixed;
        const mesh = addBox(o.w, o.h, o.d, o.color, sanitizeWeight(o.weight), sanitizeLabel(o.label), {
            fixed, price: sanitizePrice(o.price),
        });
        mesh.position.set(o.position.x, o.position.y, o.position.z);
        // addBox() already creates a fixed fixture locked — toggle only for a
        // plain cargo item saved as locked (fixed's lock is permanent, so
        // toggling it here would just be undone by toggleLock()'s own guard,
        // but there's no reason to trigger the reject-flash on a silent load).
        if (o.locked && !fixed) toggleLock(mesh);
        // Set directly (not via parkObject()) so the saved position is kept
        // exactly rather than being re-derived from a staging-slot index —
        // a fixed fixture can never be parked, same restriction as parkObject().
        if (o.parked && !fixed) {
            mesh.userData.parked = true;
            refreshObjectAppearance(mesh);
        }
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
// Named projects — multiple independently saved layouts, distinct from the
// single autosave slot above. Same localStorage mechanism, a separate key
// holding an array of {id, name, savedAt, payload} entries.
// ==========================================
const PROJECTS_KEY = 'vanspace3d.projects.v1';

function readProjectsStore() {
    return safeStorageCall(() => {
        const raw = localStorage.getItem(PROJECTS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }, []);
}

function writeProjectsStore(list) {
    return safeStorageCall(() => {
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(list));
        return true;
    }, false);
}

// Metadata only (no payload) — cheap to call for rendering a list.
export function listProjects() {
    return readProjectsStore()
        .map((p) => ({ id: p.id, name: p.name, savedAt: p.savedAt }))
        .sort((a, b) => b.savedAt - a.savedAt);
}

// Creates a new project, or overwrites the existing one with the same name
// ("save as" semantics: same name = update, new name = new slot).
export function saveNamedProject(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return false;

    const list = readProjectsStore();
    const existingIdx = list.findIndex((p) => p.name === trimmed);
    const entry = {
        id: existingIdx >= 0 ? list[existingIdx].id : generateStorageId(),
        name: trimmed,
        savedAt: Date.now(),
        payload: serializeState(),
    };
    if (existingIdx >= 0) list[existingIdx] = entry; else list.push(entry);
    return writeProjectsStore(list);
}

export function loadNamedProject(id) {
    const entry = readProjectsStore().find((p) => p.id === id);
    if (!entry || !isValidPayloadShape(entry.payload)) return false;
    applyState(entry.payload);
    return true;
}

// Returns false (no-op) if no project with that id exists.
export function deleteNamedProject(id) {
    const list = readProjectsStore();
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) return false;
    return writeProjectsStore(next);
}

export function renameNamedProject(id, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) return false;

    const list = readProjectsStore();
    const entry = list.find((p) => p.id === id);
    if (!entry) return false;

    entry.name = trimmed;
    return writeProjectsStore(list);
}

// ==========================================
// Custom object library — user-saved "Eigenes Objekt" presets shown
// alongside STANDARD_LIBRARY (src/library.js) in the sidebar, so a
// frequently-reused custom size/weight/price doesn't need re-entering by
// hand every time. Same localStorage mechanism as named projects above, a
// separate key holding an array of {id, label, w, h, d, color, weight,
// price, fixed} entries (dimensions in meters, same convention as
// STANDARD_LIBRARY and serializeState()'s object entries).
// ==========================================
const CUSTOM_LIBRARY_KEY = 'vanspace3d.customLibrary.v1';

// Individually invalid entries are dropped rather than rejecting the whole
// list — same "sanitize per-entry" approach as applyState() uses for a
// corrupted/hand-edited config.
function isSaneCustomLibraryEntry(e) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string') return false;
    const dimsOk = ['w', 'h', 'd'].every((k) => isFiniteNumber(e[k]) && e[k] > 0 && e[k] <= 10);
    const colorOk = typeof e.color === 'string' && /^#[0-9a-f]{6}$/i.test(e.color);
    return dimsOk && colorOk;
}

function readCustomLibraryStore() {
    return safeStorageCall(() => {
        const raw = localStorage.getItem(CUSTOM_LIBRARY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isSaneCustomLibraryEntry) : [];
    }, []);
}

function writeCustomLibraryStore(list) {
    return safeStorageCall(() => {
        localStorage.setItem(CUSTOM_LIBRARY_KEY, JSON.stringify(list));
        return true;
    }, false);
}

export function listCustomLibrary() {
    return readCustomLibraryStore();
}

// Always appends a new entry — unlike named projects there's no name-based
// "same slot" identity to overwrite, so saving the same shape twice just
// means two entries.
export function saveCustomLibraryEntry({
    label, w, h, d, color, weight, price, fixed,
}) {
    const list = readCustomLibraryStore();
    const entry = {
        id: generateStorageId(),
        label: sanitizeLabel(label) || 'Eigenes Objekt',
        w,
        h,
        d,
        color,
        weight: sanitizeWeight(weight),
        price: sanitizePrice(price),
        fixed: !!fixed,
    };
    return writeCustomLibraryStore([...list, entry]) ? entry : false;
}

// Returns false (no-op) if no entry with that id exists.
export function deleteCustomLibraryEntry(id) {
    const list = readCustomLibraryStore();
    const next = list.filter((e) => e.id !== id);
    if (next.length === list.length) return false;
    return writeCustomLibraryStore(next);
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

// Turns free-typed user input into a safe download filename: strips
// characters that are invalid in a filename on Windows/macOS/Linux, trims
// the result, falls back to `fallback` if that leaves nothing, and ensures
// the given extension is present (without double-adding it if the user
// already typed one).
export function sanitizeFilename(name, fallback, extension) {
    const cleaned = (name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
    const base = cleaned || fallback;
    return new RegExp(`\\.${extension}$`, 'i').test(base) ? base : `${base}.${extension}`;
}

export function exportToFile(filename = 'vanspace3d-project.json') {
    downloadTextFile(JSON.stringify(serializeState(), null, 2), filename, 'application/json');
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
