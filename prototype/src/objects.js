import * as THREE from 'three';
import { scene } from './scene.js';
import { vanState, objects } from './state.js';
import { clampToVan, checkCollision } from './collision.js';
import { refreshCenterOfGravity } from './cog.js';

// Illustrative default payload weight (kg) for newly added objects when the
// caller doesn't specify one. Single source of truth, reused by ui.js (the
// weight input's default) and persistence.js (fallback for old/invalid saves).
export const DEFAULT_WEIGHT = 5;

const DEFAULT_EDGE_COLOR = 0x000000;
const LOCKED_EDGE_COLOR = 0xef4444; // same red family as the "action rejected" flash
const SELECTED_EDGE_COLOR = 0x3b82f6; // blue — multi-selection (see selection.js)

// ==========================================
// OBJECT MANAGEMENT
// ==========================================
function updateStats() {
    const countEl = document.getElementById('obj-count');
    if (countEl) countEl.textContent = objects.length;
    refreshCenterOfGravity();
}

function disposeAndDetach(obj) {
    scene.remove(obj);
    obj.geometry.dispose();
    if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
    else obj.material.dispose();
}

// Briefly flashes an object's emissive color red — visual feedback for an
// action that was rejected (rotation blocked by collision, delete/drag/move
// blocked because the object is locked).
export function flashReject(obj) {
    if (!obj || !obj.material || !obj.material.emissive) return;
    const origColor = obj.material.emissive.getHex();
    obj.material.emissive.setHex(0xff0000);
    setTimeout(() => {
        if (objects.includes(obj)) obj.material.emissive.setHex(origColor);
    }, 150);
}

// Edge-outline color, precedence locked > selected > default. Both
// toggleLock() below and selection.js's mutators call this after flipping
// their respective userData flag, so the two states always compose
// correctly regardless of which changed most recently.
export function refreshObjectAppearance(obj) {
    const edges = obj.children[0];
    if (!edges || !edges.material) return;
    const color = obj.userData.locked
        ? LOCKED_EDGE_COLOR
        : (obj.userData.selected ? SELECTED_EDGE_COLOR : DEFAULT_EDGE_COLOR);
    edges.material.color.setHex(color);
}

export function addBox(w, h, d, colorHex, weight = DEFAULT_WEIGHT, label = null) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.6,
        metalness: 0.1,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.weight = (Number.isFinite(weight) && weight > 0) ? weight : DEFAULT_WEIGHT;
    mesh.userData.locked = false;
    mesh.userData.selected = false;
    mesh.userData.label = (typeof label === 'string' && label.trim()) ? label.trim() : 'Objekt';

    // Better edges
    const objEdges = new THREE.EdgesGeometry(geo);
    const objLine = new THREE.LineSegments(objEdges, new THREE.LineBasicMaterial({
        color: DEFAULT_EDGE_COLOR, linewidth: 1, transparent: true, opacity: 0.5,
    }));
    mesh.add(objLine);

    // Spawn safely near the front top
    mesh.position.set(0, vanState.maxHeight - (h / 2) - 0.1, -vanState.length / 2 + (d / 2) + 0.2);

    scene.add(mesh);
    objects.push(mesh);
    updateStats();
    return mesh;
}

// Creates a copy of obj with the same dimensions/color/weight, offset
// slightly so it doesn't spawn exactly overlapping the original. The copy is
// always unlocked (regardless of the source), so it can be placed right away.
export function duplicateObject(obj) {
    const { width, height, depth } = obj.geometry.parameters;
    const color = obj.material.color.getHex();
    const weight = obj.userData.weight ?? DEFAULT_WEIGHT;
    const label = obj.userData.label;

    const copy = addBox(width, height, depth, color, weight, label);
    copy.position.set(obj.position.x + 0.1, obj.position.y, obj.position.z + 0.1);
    clampToVan(copy, copy.position);
    return copy;
}

// Flips obj's locked state and updates its visual indicator. Returns the new
// locked state, or undefined if obj isn't currently tracked.
export function toggleLock(obj) {
    if (!obj || !objects.includes(obj)) return undefined;
    obj.userData.locked = !obj.userData.locked;
    refreshObjectAppearance(obj);
    return obj.userData.locked;
}

// Removes a single object. Returns false (no-op) if obj isn't tracked, or if
// it's locked (locking protects against exactly this).
export function removeObject(obj) {
    const idx = objects.indexOf(obj);
    if (idx === -1) return false;
    if (obj.userData.locked) {
        flashReject(obj);
        return false;
    }

    disposeAndDetach(obj);
    objects.splice(idx, 1);
    updateStats();
    return true;
}

// Unconditional full clear — used internally by persistence.js (load/import/
// undo/redo) where the target snapshot must fully replace the current scene,
// lock state included. For the user-facing "Alle entfernen" button, see
// clearUnlockedObjects() below, which leaves locked objects in place.
export function clearAllObjects() {
    objects.forEach(disposeAndDetach);
    objects.length = 0;
    updateStats();
}

export function clearUnlockedObjects() {
    const keep = objects.filter((obj) => obj.userData.locked);
    const remove = objects.filter((obj) => !obj.userData.locked);
    remove.forEach(disposeAndDetach);
    objects.length = 0;
    objects.push(...keep);
    updateStats();
}

// Moves obj up/down by deltaY (meters), clamped to the van bounds and
// (when snapEnabled) rolled back on collision — the same rules as dragging.
// Returns false without moving if obj is locked or the move was rejected.
export function moveVertical(obj, deltaY, snapEnabled) {
    if (!obj) return false;
    if (obj.userData.locked) {
        flashReject(obj);
        return false;
    }

    const originalY = obj.position.y;
    obj.position.y += deltaY;
    clampToVan(obj, obj.position);

    if (snapEnabled && checkCollision(obj)) {
        obj.position.y = originalY;
        flashReject(obj);
        return false;
    }
    return true;
}

export function rotate90(obj, snapEnabled) {
    if (obj.userData.locked) {
        flashReject(obj);
        return false;
    }

    const w = obj.geometry.parameters.width;
    const h = obj.geometry.parameters.height;
    const d = obj.geometry.parameters.depth;

    // Dispose old
    obj.geometry.dispose();
    obj.children[0].geometry.dispose();

    // Swap Width (X) and Depth (Z)
    const newGeo = new THREE.BoxGeometry(d, h, w);
    obj.geometry = newGeo;
    obj.children[0].geometry = new THREE.EdgesGeometry(newGeo);

    const originalPos = obj.position.clone();
    clampToVan(obj, obj.position);

    // Rollback if collision detected
    if (snapEnabled && checkCollision(obj)) {
        obj.geometry.dispose();
        obj.children[0].geometry.dispose();
        const oldGeo = new THREE.BoxGeometry(w, h, d);
        obj.geometry = oldGeo;
        obj.children[0].geometry = new THREE.EdgesGeometry(oldGeo);
        obj.position.copy(originalPos);
        flashReject(obj);
        return false;
    }
    return true;
}
