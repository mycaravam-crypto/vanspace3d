import * as THREE from 'three';
import { scene } from './scene.js';
import { vanState, objects } from './state.js';
import { clampToVan, checkCollision } from './collision.js';
import { refreshCenterOfGravity } from './cog.js';
import { refreshTotalPrice } from './price.js';

// Illustrative default payload weight (kg) for newly added objects when the
// caller doesn't specify one. Single source of truth, reused by ui.js (the
// weight input's default) and persistence.js (fallback for old/invalid saves).
export const DEFAULT_WEIGHT = 5;

// No-price-given default — unlike weight, a missing/omitted price is a
// perfectly normal "didn't cost anything (yet)" rather than a value that
// needs an illustrative fallback.
export const DEFAULT_PRICE = 0;

const DEFAULT_EDGE_COLOR = 0x000000;
const LOCKED_EDGE_COLOR = 0xef4444; // same red family as the "action rejected" flash
const SELECTED_EDGE_COLOR = 0x3b82f6; // blue — multi-selection (see selection.js)
const FIXED_EDGE_COLOR = 0x78716c; // warm stone gray — permanent, not a "you can't touch this right now" red
const PARKED_EDGE_COLOR = 0xf59e0b; // amber — staged outside the van (see parkObject() below)

// ==========================================
// X-RAY VIEW — a global toggle (not per-object, not persisted/undo-tracked,
// same as camera position) that makes every object's fill translucent so one
// hidden behind/inside another is still visible without moving anything.
// ==========================================
const XRAY_OPACITY = 0.15;
let xrayEnabled = false;

export function isXrayEnabled() {
    return xrayEnabled;
}

// Edge outlines are left alone — they stay fully opaque either way, which is
// exactly what keeps overlapping boxes distinguishable in x-ray mode.
function applyXray(mat) {
    mat.transparent = xrayEnabled;
    mat.opacity = xrayEnabled ? XRAY_OPACITY : 1;
    // Matches createVanZone()'s own translucent van-shell materials in
    // van.js — depthWrite:false while transparent avoids draw-order
    // artifacts between overlapping see-through boxes.
    mat.depthWrite = !xrayEnabled;
    // Without this, WebGLRenderer keeps using the blend/depth state it
    // compiled the material with the first time it was rendered opaque, so
    // opacity/transparent/depthWrite silently stop having any visible
    // effect on an already-rendered material — needsUpdate forces it to
    // pick the new state back up.
    mat.needsUpdate = true;
}

// Applies (or clears) x-ray translucency across every currently tracked
// object. New objects pick up the current state automatically (see addBox()
// below), so toggling this once covers everything already placed and
// anything added/loaded/undone afterward.
export function setXrayEnabled(enabled) {
    xrayEnabled = enabled;
    objects.forEach((obj) => applyXray(obj.material));
}

// ==========================================
// EXPLODE VIEW — a global toggle (not per-object, not persisted/undo-tracked,
// same as x-ray above) that animates every non-parked object outward from
// the van's own origin, as a staggered burst, so tightly packed or stacked
// cargo can be told apart without dragging anything. Unlike x-ray (a pure
// material property), this moves obj.position itself: the exact offset
// vector is stashed in obj.userData.explodeOffset the instant the animation
// is *scheduled* (not when it lands), and subtracted back out on toggle
// off, so the stashed offset is always valid even mid-flight. Anything that
// would otherwise write a position derived from the (currently displaced or
// animating) obj.position — dragging (see controls.js), keyboard nudging,
// resizing, rotating — is refused (flashReject) the whole time explode is
// active, the same way a locked object refuses them.
// ==========================================
const EXPLODE_DISTANCE = 0.5; // meters each object is pushed outward from the van's origin
const EXPLODE_ANIM_DURATION = 450; // ms for one object's push/return animation
const EXPLODE_ANIM_STAGGER = 25; // ms of extra delay per object index, so a batch bursts outward instead of jumping in lockstep

let explodedEnabled = false;

export function isExplodedEnabled() {
    return explodedEnabled;
}

// In-flight position tweens, one entry per object currently animating in or
// out of the explode view. `base` is the object's true (non-exploded)
// resting position, recorded once when the tween starts and never touched
// again, so getBasePosition() below stays correct however far the
// animation has progressed. `from`/`to` are the actual endpoints being
// interpolated between, which only equal `base`/exploded-target on an
// uninterrupted tween — see startPositionTween()'s `from` comment.
const explodeAnimations = new Map();

// Same curve the exploded-view reference this was modeled on uses for its
// part-separation animation: overshoots slightly past the target before
// settling, which reads as a little "pop" outward rather than a linear glide.
function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function startPositionTween(obj, base, target, delayMs) {
    explodeAnimations.set(obj, {
        base: base.clone(),
        from: obj.position.clone(), // wherever it visually is right now — lets re-toggling mid-animation reverse smoothly instead of jumping
        to: target.clone(),
        startAt: performance.now() + delayMs,
    });
}

function cancelExplodeTween(obj) {
    explodeAnimations.delete(obj);
}

// Advances every in-flight explode/implode tween by one frame. Called from
// main.js's render loop, mirroring updateRotateHandle()/updateObjectLabels().
// Accepts an explicit timestamp (defaulting to real time) purely so tests
// can fast-forward deterministically instead of depending on wall-clock time.
export function stepExplodeAnimation(now = performance.now()) {
    explodeAnimations.forEach((anim, obj) => {
        if (now < anim.startAt) return; // still waiting out its stagger delay
        const t = Math.min(1, (now - anim.startAt) / EXPLODE_ANIM_DURATION);
        obj.position.lerpVectors(anim.from, anim.to, easeOutBack(t));
        if (t >= 1) explodeAnimations.delete(obj);
    });
}

// obj's true resting position, whether it's currently exploded, parked, or
// mid-animation — the single source of truth duplicateObject() and
// implodeOne() below use instead of reading obj.position directly, which
// mid-tween is neither the resting position nor the fully-exploded one.
function getBasePosition(obj) {
    const anim = explodeAnimations.get(obj);
    if (anim) return anim.base.clone();
    if (obj.userData.explodeOffset) return obj.position.clone().sub(obj.userData.explodeOffset);
    return obj.position.clone();
}

// The van is centered left-right and front-back on X=0/Z=0 and sits on the
// floor at Y=0 (see van.js), so an object's own resting position vector *is*
// its direction away from the van's origin — no separate "center" point
// needed, and critically it's never pointing downward (every placed
// object's Y is positive), so exploding never pushes something down through
// the floor. Falls back to straight up for the (rare) object sitting
// exactly on the origin, so it still moves instead of staying put.
function explodeDirection(basePos) {
    const dir = basePos.clone();
    return dir.lengthSq() < 1e-6 ? new THREE.Vector3(0, 1, 0) : dir.normalize();
}

// Schedules the outward push for a single object, unless it's parked
// (already staged outside the van — nothing to separate it from) or already
// exploded. `delayMs` staggers a batch into a burst — see
// setExplodedEnabled() below.
function explodeOne(obj, delayMs = 0) {
    if (obj.userData.parked || obj.userData.explodeOffset) return;
    const base = getBasePosition(obj);
    const offset = explodeDirection(base).multiplyScalar(EXPLODE_DISTANCE);
    obj.userData.explodeOffset = offset;
    startPositionTween(obj, base, base.clone().add(offset), delayMs);
}

// Reverses explodeOne() for a single object; no-op if it was never exploded.
function implodeOne(obj, delayMs = 0) {
    if (!obj.userData.explodeOffset) return;
    const base = getBasePosition(obj);
    delete obj.userData.explodeOffset;
    clampToVan(obj, base); // re-validate against the van's current bounds, in case they changed while exploded
    startPositionTween(obj, base, base, delayMs);
}

// Applies (or clears) the outward push across every currently tracked
// object, mirroring setXrayEnabled() above, as a staggered burst rather than
// snapping instantly. New objects pick up the current state automatically
// (see addBox()/duplicateObject()/returnObjectToVan() below), so toggling
// this once covers everything already placed and anything added/loaded/
// undone afterward.
export function setExplodedEnabled(enabled) {
    explodedEnabled = enabled;
    objects.forEach((obj, idx) => {
        const delay = idx * EXPLODE_ANIM_STAGGER;
        if (enabled) explodeOne(obj, delay);
        else implodeOne(obj, delay);
    });
}

// ==========================================
// OBJECT MANAGEMENT
// ==========================================
function updateStats() {
    const countEl = document.getElementById('obj-count');
    if (countEl) countEl.textContent = objects.length;
    refreshCenterOfGravity();
    refreshTotalPrice();
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
    cancelExplodeTween(obj); // an object mid-animation getting removed shouldn't leave a stale tween writing to it every frame
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

// Edge-outline color, precedence fixed > locked > selected > parked >
// default. toggleLock() below, selection.js's mutators, and
// parkObject()/returnObjectToVan() below all call this after flipping their
// respective userData flag, so the states always compose correctly
// regardless of which changed most recently. `fixed` outranks `locked` (even
// though a fixed object is always also locked, see addBox()) so a permanent
// built-in fixture reads visually distinct from cargo you've merely locked
// yourself and could unlock again. `parked` sits below `selected` so
// selecting a parked object (e.g. to bring it back) still shows the more
// actionable blue highlight rather than being masked by the amber tag.
export function refreshObjectAppearance(obj) {
    const edges = obj.children[0];
    if (!edges || !edges.material) return;
    const color = obj.userData.fixed
        ? FIXED_EDGE_COLOR
        : (obj.userData.locked
            ? LOCKED_EDGE_COLOR
            : (obj.userData.selected
                ? SELECTED_EDGE_COLOR
                : (obj.userData.parked ? PARKED_EDGE_COLOR : DEFAULT_EDGE_COLOR)));
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
// `options.price` is what the object cost — independent of `fixed`/weight,
// since a built-in fixture's cost is still money spent even though it
// doesn't count as payload. Defaults to DEFAULT_PRICE (0, i.e. free/unknown)
// and is included in the total-price readout (price.js) and PDF export
// (pdfExport.js) regardless of fixed/locked/parked state.
export function addBox(w, h, d, colorHex, weight = DEFAULT_WEIGHT, label = null, options = {}) {
    const { fixed = false, price = DEFAULT_PRICE } = options;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.6,
        metalness: 0.1,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
    });
    applyXray(mat); // new objects pick up whatever x-ray state is currently active
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.weight = fixed ? 0 : ((Number.isFinite(weight) && weight > 0) ? weight : DEFAULT_WEIGHT);
    mesh.userData.price = (Number.isFinite(price) && price >= 0) ? price : DEFAULT_PRICE;
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

    if (explodedEnabled) explodeOne(mesh); // new objects join the current explode view immediately, like applyXray() above

    scene.add(mesh);
    objects.push(mesh);
    updateStats();
    return mesh;
}

// ==========================================
// PARKING — temporarily move an object out of the van to set it aside,
// without deleting it. A parked object is skipped entirely by
// clampToVan()/checkCollision() (collision.js), so it neither gets pushed
// back into the van bounds nor blocks — or is blocked by — anything else,
// and it's excluded from the weight/COG totals (cog.js), matching the idea
// that it's temporarily NOT loaded.
// ==========================================
const PARK_SLOT_PITCH = 0.6; // meters between staging slots beside the van
const PARK_ROW_SIZE = 6; // slots per row before wrapping to the next column

// A small grid just outside the van's right side (+X), front-to-back, so
// several parked items don't render on top of each other. Purely cosmetic —
// parked objects never collide with anything — so the pitch is a fixed slot
// size rather than derived from each object's own footprint.
function nextParkSlot(h) {
    const parkedCount = objects.filter((o) => o.userData.parked).length;
    return new THREE.Vector3(
        vanState.maxWidth / 2 + PARK_SLOT_PITCH * (1 + Math.floor(parkedCount / PARK_ROW_SIZE)),
        h / 2,
        -vanState.length / 2 + PARK_SLOT_PITCH * (parkedCount % PARK_ROW_SIZE),
    );
}

export function isParked(obj) {
    return !!(obj && obj.userData.parked);
}

// Moves obj into a staging slot beside the van and marks it parked. Refuses
// a fixed fixture (it's part of the van's own structure, not cargo you'd
// ever set aside) or a locked object (locking protects position, same as
// every other move) — flashes red instead, same guards as moveAxis() below.
// Returns false (no-op) if obj isn't tracked or is already parked.
export function parkObject(obj) {
    if (!obj || !objects.includes(obj)) return false;
    if (obj.userData.fixed || obj.userData.locked) {
        flashReject(obj);
        return false;
    }
    if (obj.userData.parked) return false;

    const { height: h } = obj.geometry.parameters;
    // Parked objects sit outside the explode view entirely (see explodeOne()
    // above) and get a fresh position below anyway, so any in-flight tween
    // or stashed offset is just discarded rather than resolved.
    cancelExplodeTween(obj);
    delete obj.userData.explodeOffset;
    obj.userData.parked = true;
    obj.position.copy(nextParkSlot(h));
    refreshObjectAppearance(obj);
    updateStats(); // parking changes the weight/COG totals even though the object count doesn't
    return true;
}

// Brings a parked object back into the van: clears the parked flag and
// places it the same way a freshly added object would — a preferred
// front-top spawn point, falling back to a full open-spot scan on collision
// (see placeInFirstOpenSpot() above). Refuses a locked object, same as
// parkObject(). Returns false (no-op) if obj isn't tracked or isn't parked.
export function returnObjectToVan(obj) {
    if (!obj || !objects.includes(obj)) return false;
    if (!obj.userData.parked) return false;
    if (obj.userData.locked) {
        flashReject(obj);
        return false;
    }

    const { width: w, height: h, depth: d } = obj.geometry.parameters;
    obj.userData.parked = false;
    obj.position.set(0, vanState.maxHeight - (h / 2) - 0.1, -vanState.length / 2 + (d / 2) + 0.2);
    clampToVan(obj, obj.position);
    if (checkCollision(obj)) placeInFirstOpenSpot(obj, w, h, d);
    if (explodedEnabled) explodeOne(obj); // rejoin the current explode view, like a freshly added object
    refreshObjectAppearance(obj);
    updateStats();
    return true;
}

// ==========================================
// PARK ALL — bulk toggle (sidebar button above "Alle entfernen") that parks
// every parkable object at once via parkObject() above, so they land in the
// same staging grid beside the van as a single-object park would. Unlike the
// x-ray/explode toggles, this really moves objects and flips their `parked`
// flag, so it's undo-tracked by ui.js like any other mutation — but it still
// needs its own bookkeeping here: `parkedByParkAll` remembers exactly which
// objects THIS toggle parked and where each one was standing, so restoring
// puts every one of them back to its original spot instead of wherever a
// freshly-returned object would spawn. It's null while inactive; an object
// the user parks/unparks individually while it's active is simply left alone
// by restoreAllParkedObjects() below (it's either not in the map, or no
// longer parked).
// ==========================================
let parkedByParkAll = null;

export function isParkAllActive() {
    return !!parkedByParkAll;
}

// Parks every currently-in-van object (fixed/locked/already-parked objects
// are left alone, same restrictions as parkObject() itself). No-op if the
// toggle is already active.
export function parkAllObjects() {
    if (parkedByParkAll) return false;
    parkedByParkAll = new Map();
    objects
        .filter((obj) => !obj.userData.fixed && !obj.userData.locked && !obj.userData.parked)
        .forEach((obj) => {
            parkedByParkAll.set(obj, obj.position.clone());
            parkObject(obj);
        });
    return true;
}

// Reverses parkAllObjects(): returns every object it parked to its
// remembered pre-park position, falling back to an open-spot scan (same as
// returnObjectToVan()) if that spot is no longer free. No-op if the toggle
// isn't active.
export function restoreAllParkedObjects() {
    if (!parkedByParkAll) return false;
    parkedByParkAll.forEach((pos, obj) => {
        if (!objects.includes(obj) || !obj.userData.parked) return; // removed, or already returned individually
        const { width: w, height: h, depth: d } = obj.geometry.parameters;
        obj.userData.parked = false;
        obj.position.copy(pos);
        clampToVan(obj, obj.position);
        if (checkCollision(obj)) placeInFirstOpenSpot(obj, w, h, d);
        if (explodedEnabled) explodeOne(obj); // rejoin the current explode view, like returnObjectToVan()
        refreshObjectAppearance(obj);
    });
    parkedByParkAll = null;
    updateStats();
    return true;
}

// Renames a placed object's label — the only mutator here that ISN'T gated
// on obj.userData.locked/fixed: a name is metadata, not a physical
// attribute, so there's nothing for locking (which protects position/size/
// existence) to guard here. That also makes it the only way to fix a typo
// in a fixed fixture's name after creation, since a fixed object can never
// be unlocked. Returns false (no-op) if obj isn't tracked or the trimmed
// name is empty — an accidental blank submission leaves the existing label
// alone rather than silently clearing it.
export function renameObject(obj, newLabel) {
    if (!obj || !objects.includes(obj)) return false;
    const trimmed = (newLabel || '').trim();
    if (!trimmed) return false;
    obj.userData.label = trimmed.slice(0, 60); // same cap as persistence.js's sanitizeLabel()
    return true;
}

// Creates a copy of obj with the same dimensions/color/weight/price, offset
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
    const price = obj.userData.price ?? DEFAULT_PRICE;
    const label = obj.userData.label;

    // Duplicate near obj's true (non-exploded) position, not wherever it's
    // currently displaced/animating to for the explode view — see
    // getBasePosition() in EXPLODE VIEW above.
    const basePos = getBasePosition(obj);

    const copy = addBox(width, height, depth, color, weight, label, { price });
    // addBox() may have just scheduled an explode animation for the spawn
    // position above; the .set() below replaces that position outright, so
    // discard it rather than let it fight the fresh one scheduled below.
    cancelExplodeTween(copy);
    delete copy.userData.explodeOffset;
    copy.position.set(basePos.x + 0.1, basePos.y, basePos.z + 0.1);
    clampToVan(copy, copy.position);
    if (explodedEnabled) explodeOne(copy);
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
    if (obj.userData.locked || explodedEnabled) {
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
    if (obj.userData.locked || explodedEnabled) {
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
    if (obj.userData.locked || explodedEnabled) {
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

// Changes obj's fill color (the box material, not the edge outline — that's
// driven separately by refreshObjectAppearance() based on lock/selection/
// fixed state). Accepts anything THREE.Color#set understands (a '#rrggbb'
// string from a <input type="color">, a hex number, ...). Returns false
// without changing anything if obj is locked or isn't tracked — same guard
// as every other mutator here.
export function setObjectColor(obj, color) {
    if (!obj || !objects.includes(obj)) return false;
    if (obj.userData.locked) {
        flashReject(obj);
        return false;
    }
    obj.material.color.set(color);
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
