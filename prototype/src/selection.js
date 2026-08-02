import { objects } from './state.js';
import { refreshObjectAppearance } from './objects.js';

// ==========================================
// MULTI-SELECTION
// ==========================================
// Selection state lives directly on each object (obj.userData.selected),
// the same pattern as userData.locked, rather than a separate Set — so it's
// automatically consistent with removal/undo/redo (an object that's gone is
// simply not in `objects` any more, nothing to keep in sync).

export function isSelected(obj) {
    return !!(obj && obj.userData.selected);
}

export function getSelected() {
    return objects.filter((o) => o.userData.selected);
}

function setFlag(obj, selected) {
    if (!obj || obj.userData.selected === selected) return;
    obj.userData.selected = selected;
    refreshObjectAppearance(obj);
}

// Replaces the whole selection with just `obj` (or clears it, if obj is
// null/undefined) — the "plain click" convention.
export function selectOnly(obj) {
    objects.forEach((o) => { if (o !== obj) setFlag(o, false); });
    if (obj) setFlag(obj, true);
}

// Adds obj to the selection if it isn't already, or drops it if it is —
// the "shift+click" convention.
export function toggleInSelection(obj) {
    if (!obj) return;
    setFlag(obj, !obj.userData.selected);
}

// Unions objs into the current selection — used by marquee-select, which is
// only reachable while holding shift (see controls.js), so it always adds
// rather than replacing.
export function addManyToSelection(objs) {
    objs.forEach((o) => setFlag(o, true));
}

export function clearSelection() {
    objects.forEach((o) => setFlag(o, false));
}
