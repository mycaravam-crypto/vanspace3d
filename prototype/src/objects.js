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
const FIXED_EDGE_COLOR = 0x78716c; // warm stone gray — permanent, not a "you can't touch this right now" red

// ==========================================
// OBJECT MANAGEMENT
// ==========================================
function updateStats() {
    const countEl = document.getElementById('obj-count');
    if (countEl) countEl.textContent = objects.length;
    refreshCenterOfGravity();
}

// Scans the van's floor-up, front-to-back, left-to-right for the first spot
// where `mesh` (already positioned at its preferred spawn point) doesn't
// collide with any existing object, and moves it there. Falls back to
// leaving `mesh` at its original (possibly overlapping) position if the van
// is packed too tightly at this grid resolution to find one.
function placeInFirstOpenSpot(mesh, w, h, d) {
    const originalPos = mesh.position.clone();
    const candidate = new THREE.Vector3();

    for (let y = h / 2; y <= vanState.maxHeight + 1e-6; y += h) {
        for (let z = -vanState.length / 2 + d / 2; z <= vanState.length / 2 - d / 2 + 1e-6; z += d) {
            for (let x = -vanState.maxWidth / 2 + w / 2; x <= vanState.maxWidth / 2 - w / 2 + 1e-6; x += w) {
                candidate.set(x, y, z);
                clampToVan(mesh, candidate);
                mesh.position.copy(candidate);
                if (!checkCollision(mesh)) return;
            }
        }
    }

    mesh.position.copy(originalPos);
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

// Edge-outline color, precedence fixed > locked > selected > default. Both
// toggleLock() below and selection.js's mutators call this after flipping
// their respective userData flag, so the states always compose correctly
// regardless of which changed most recently. `fixed` outranks `locked` (even
// though a fixed object is always also locked, see addBox()) so a permanent
// built-in fixture reads visually distinct from cargo you've merely locked
// yourself and could unlock again.
export function refreshObjectAppearance(obj) {
    const edges = obj.children[0];
    if (!edges || !edges.material) return;
    const color = obj.userData.fixed
        ? FIXED_EDGE_COLOR
        : (obj.userData.locked
            ? LOCKED_EDGE_COLOR
            : (obj.userData.selected ? SELECTED_EDGE_COLOR : DEFAULT_EDGE_COLOR));
    edges.material.color.setHex(color);
}

// `options.fixed` marks a permanent, built-in fixture (a bed platform, water
// tank, etc.) rather than movable cargo: it spawns already locked — and
// stays locked forever, see toggleLock() below — carries no weight (it's
// part of the van's own structure, not payload you're deciding whether to
// bring, so it's excluded from the weight/COG totals the same way any
// zero-weight object already is), and can't be duplicated (see
// duplicateObject() below). It still occupies space like any other object,
// so cargo can't be placed inside it.
export function addBox(w, h, d, colorHex, weight = DEFAULT_WEIGHT, label = null, options = {}) {
    const { fixed = false } = options;
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
    mesh.userData.weight = fixed ? 0 : ((Number.isFinite(weight) && weight > 0) ? weight : DEFAULT_WEIGHT);
    mesh.userData.locked = fixed;
    mesh.userData.fixed = fixed;
    mesh.userData.selected = false;
    mesh.userData.label = (typeof label === 'string' && label.trim()) ? label.trim() : 'Objekt';

    // Better edges
    const objEdges = new THREE.EdgesGeometry(geo);
    const objLine = new THREE.LineSegments(objEdges, new THREE.LineBasicMaterial({
        color: fixed ? FIXED_EDGE_COLOR : DEFAULT_EDGE_COLOR, linewidth: 1, transparent: true, opacity: 0.5,
    }));
    mesh.add(objLine);

    // Spawn safely near the front top
    mesh.position.set(0, vanState.maxHeight - (h / 2) - 0.1, -vanState.length / 2 + (d / 2) + 0.2);

    // The preferred spot above is a fixed point, so it collides with
    // whatever was added there already — hunt for an open spot instead of
    // leaving the new object exactly coincident with an existing one.
    if (checkCollision(mesh)) {
        placeInFirstOpenSpot(mesh, w, h, d);
    }

    scene.add(mesh);
    objects.push(mesh);
    updateStats();
    return mesh;
}

// Creates a copy of obj with the same dimensions/color/weight, offset
// slightly so it doesn't spawn exactly overlapping the original. The copy is
// always unlocked (regardless of the source), so it can be placed right away.
// Refuses to duplicate a fixed fixture — "another one of this built-in water
// tank" isn't a meaningful cargo item — and flashes it red instead.
export function duplicateObject(obj) {
    if (obj.userData.fixed) {
        flashReject(obj);
        return null;
    }

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
// locked state, or undefined if obj isn't currently tracked. A fixed fixture
// is permanently locked — it never unlocks, since that's what distinguishes
// it from cargo you've merely chosen to lock for now.
export function toggleLock(obj) {
    if (!obj || !objects.includes(obj)) return undefined;
    if (obj.userData.fixed) {
        flashReject(obj);
        return obj.userData.locked;
    }
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

// Moves obj by delta (meters) along a single axis ('x', 'y', or 'z'),
// clamped to the van bounds and (when snapEnabled) rolled back on collision —
// the same rules as dragging. Returns false without moving if obj is locked
// or the move was rejected. Shared by moveVertical (Y) and moveHorizontal
// (X/Z) below, which are just this with the axis fixed.
function moveAxis(obj, axis, delta, snapEnabled) {
    if (!obj) return false;
    if (obj.userData.locked) {
        flashReject(obj);
        return false;
    }

    const original = obj.position[axis];
    obj.position[axis] += delta;
    clampToVan(obj, obj.position);

    if (snapEnabled && checkCollision(obj)) {
        obj.position[axis] = original;
        flashReject(obj);
        return false;
    }
    return true;
}

export function moveVertical(obj, deltaY, snapEnabled) {
    return moveAxis(obj, 'y', deltaY, snapEnabled);
}

// Nudges obj left/right (axis 'x') or forward/back (axis 'z') — the keyboard
// counterpart to moveVertical for the other two axes, so an object can be
// positioned entirely without a mouse/touch drag.
export function moveHorizontal(obj, axis, delta, snapEnabled) {
    return moveAxis(obj, axis, delta, snapEnabled);
}

// Changes obj's width/height/depth in place, keeping its current center
// position. Clamped to the van bounds and (when snapEnabled) rolled back on
// collision — the same rules as rotate90() above. Returns false without
// resizing if obj is locked, isn't tracked, or any dimension isn't a finite
// positive number.
export function resizeObject(obj, w, h, d, snapEnabled) {
    if (!obj || !objects.includes(obj)) return false;
    if (obj.userData.locked) {
        flashReject(obj);
        return false;
    }
    if (![w, h, d].every((v) => Number.isFinite(v) && v > 0)) return false;

    const oldW = obj.geometry.parameters.width;
    const oldH = obj.geometry.parameters.height;
    const oldD = obj.geometry.parameters.depth;

    obj.geometry.dispose();
    obj.children[0].geometry.dispose();

    const newGeo = new THREE.BoxGeometry(w, h, d);
    obj.geometry = newGeo;
    obj.children[0].geometry = new THREE.EdgesGeometry(newGeo);

    const originalPos = obj.position.clone();
    clampToVan(obj, obj.position);

    // Rollback if collision detected
    if (snapEnabled && checkCollision(obj)) {
        obj.geometry.dispose();
        obj.children[0].geometry.dispose();
        const oldGeo = new THREE.BoxGeometry(oldW, oldH, oldD);
        obj.geometry = oldGeo;
        obj.children[0].geometry = new THREE.EdgesGeometry(oldGeo);
        obj.position.copy(originalPos);
        flashReject(obj);
        return false;
    }
    return true;
}

// Rebuilds obj's box geometry with the given (w, h, d), rolling back to the
// original dimensions/position if that lands it in a collision (when
// snapEnabled) — shared by rotate90() and rotateX90(), which only differ in
// which pair of dimensions they swap.
function rebuildGeometry(obj, snapEnabled, w, h, d) {
    if (obj.userData.locked) {
        flashReject(obj);
        return false;
    }

    const oldW = obj.geometry.parameters.width;
    const oldH = obj.geometry.parameters.height;
    const oldD = obj.geometry.parameters.depth;

    obj.geometry.dispose();
    obj.children[0].geometry.dispose();

    const newGeo = new THREE.BoxGeometry(w, h, d);
    obj.geometry = newGeo;
    obj.children[0].geometry = new THREE.EdgesGeometry(newGeo);

    const originalPos = obj.position.clone();
    clampToVan(obj, obj.position);

    // Rollback if collision detected
    if (snapEnabled && checkCollision(obj)) {
        obj.geometry.dispose();
        obj.children[0].geometry.dispose();
        const oldGeo = new THREE.BoxGeometry(oldW, oldH, oldD);
        obj.geometry = oldGeo;
        obj.children[0].geometry = new THREE.EdgesGeometry(oldGeo);
        obj.position.copy(originalPos);
        flashReject(obj);
        return false;
    }
    return true;
}

// Rotates obj 90 degrees around the Y (vertical) axis — swaps its width and
// depth, height unchanged. E.g. turning a couch to face a different wall.
export function rotate90(obj, snapEnabled) {
    const { width: w, height: h, depth: d } = obj.geometry.parameters;
    return rebuildGeometry(obj, snapEnabled, d, h, w);
}

// Rotates obj 90 degrees around the X (left-right) axis — swaps its height
// and depth, width unchanged. E.g. tipping a box onto its front/back face.
export function rotateX90(obj, snapEnabled) {
    const { width: w, height: h, depth: d } = obj.geometry.parameters;
    return rebuildGeometry(obj, snapEnabled, w, d, h);
}
