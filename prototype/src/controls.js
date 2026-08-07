import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { camera, renderer } from './scene.js';
import { vanState, objects } from './state.js';
import { clampToVan, checkCollision, findFaceSnap } from './collision.js';
import {
    rotate90, rotateX90, removeObject, duplicateObject, toggleLock, moveVertical, moveHorizontal, flashReject,
} from './objects.js';
import {
    isSelected, getSelected, selectOnly, toggleInSelection, addManyToSelection, clearSelection,
} from './selection.js';
import { isSnapEnabled, syncSlidersFromState, refreshHistoryButtons } from './ui.js';
import { captureUndoPoint, undo, redo } from './history.js';

// ==========================================
// INTERACTION CONTROLS
// ==========================================
export const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.target.set(0, 1, 0);
orbitControls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't clip through floor
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.05;

export const dragControls = new DragControls(objects, camera, renderer.domElement);
// Objects carry a child LineSegments (edge outline). With recursive raycasting
// (the default), a click can hit that child instead of the box itself — Line
// raycasting uses a generous threshold, so this happens often in practice.
// That breaks dragging (moves only the outline) and throws when code assumes
// a Mesh (e.g. reading .material.emissive or .geometry.parameters.height on
// an EdgesGeometry/LineBasicMaterial). Restricting to non-recursive picks
// ensures only the top-level objects in `objects` are ever selected.
dragControls.recursive = false;

const lastValidPos = new THREE.Vector3();
let activeObj = null;
let isDragging = false;

// Non-null while dragging a multi-selection (>1 unlocked members) as a rigid
// group instead of a single object — see dragGroup() below. Array of
// { obj, lastValidPos } so each member tracks its own last-accepted position,
// the same role lastValidPos plays for a solo drag.
let groupDragMembers = null;

// Defense in depth: even with non-recursive picking, guard against any
// object that isn't one of our tracked, fully-formed boxes (e.g. if it was
// removed via "Alle entfernen" in the same tick as a pending event).
function isValidTarget(obj) {
    return !!obj && objects.includes(obj) && obj.material && obj.material.emissive
        && obj.geometry && obj.geometry.parameters;
}

// Hover Effects
dragControls.addEventListener('hoveron', (e) => {
    if (!isDragging && isValidTarget(e.object)) {
        activeObj = e.object;
        activeObj.material.emissive.setHex(0x222222);
        document.body.style.cursor = activeObj.userData.locked ? 'not-allowed' : 'grab';
    }
});

dragControls.addEventListener('hoveroff', (e) => {
    if (!isDragging && activeObj === e.object) {
        if (isValidTarget(activeObj)) activeObj.material.emissive.setHex(0x000000);
        activeObj = null;
        document.body.style.cursor = 'auto';
    }
});

dragControls.addEventListener('dragstart', (event) => {
    if (!isValidTarget(event.object)) return;
    // DragControls' own pointermove handler moves _selected.position directly,
    // before our 'drag' listener even runs — it doesn't know about locking.
    // Recording the pre-drag position here lets the 'drag' handler below snap
    // a locked object straight back every tick, effectively making it immovable.
    lastValidPos.copy(event.object.position);

    if (event.object.userData.locked) {
        flashReject(event.object);
        return; // orbitControls stays enabled, so camera orbit still works normally
    }

    captureUndoPoint(); // one undo point per drag gesture, not per movement tick
    refreshHistoryButtons();
    orbitControls.enabled = false;
    isDragging = true;
    activeObj = event.object;
    activeObj.material.emissive.setHex(0x444444);
    document.body.style.cursor = 'grabbing';

    // Dragging a selected object that's part of a multi-selection (with at
    // least one other unlocked member) moves the whole group together,
    // rigidly. Locked members stay selected but are excluded from the move
    // (and from the movable count) — same "locked is untouchable" rule as
    // everything else.
    const movable = getSelected().filter((o) => !o.userData.locked);
    groupDragMembers = (isSelected(event.object) && movable.length > 1)
        ? movable.map((o) => ({ obj: o, lastValidPos: o.position.clone() }))
        : null;
});

dragControls.addEventListener('dragend', (event) => {
    orbitControls.enabled = true;
    isDragging = false;
    document.body.style.cursor = 'auto';
    if (isValidTarget(activeObj)) activeObj.material.emissive.setHex(0x000000);

    const snapToFloor = (o) => {
        if (o.position.y < o.geometry.parameters.height / 2 + 0.02) {
            o.position.y = o.geometry.parameters.height / 2;
        }
    };

    if (groupDragMembers) {
        groupDragMembers.forEach((m) => snapToFloor(m.obj));
        groupDragMembers = null;
        return;
    }

    if (!isValidTarget(event.object) || event.object.userData.locked) return;
    snapToFloor(event.object); // Final floor snap check
});

// Moves every member of groupDragMembers by the same rigid delta as `primary`
// (the object DragControls is actually driving via the pointer), clamped
// individually to the van bounds. All-or-nothing per tick: if moving would
// collide any member against a non-group object, the whole group's delta for
// this tick is rejected rather than letting the group tear apart axis by
// axis (unlike the solo-drag per-axis sliding above — kept simple on purpose).
function dragGroup(primary, doSnap) {
    const primaryEntry = groupDragMembers.find((m) => m.obj === primary);
    if (!primaryEntry) return;

    let targetX = primary.position.x;
    let targetY = primary.position.y;
    let targetZ = primary.position.z;
    if (doSnap) {
        targetX = Math.round(targetX / 0.05) * 0.05;
        targetY = Math.round(targetY / 0.05) * 0.05;
        targetZ = Math.round(targetZ / 0.05) * 0.05;
    }

    const delta = new THREE.Vector3(
        targetX - primaryEntry.lastValidPos.x,
        targetY - primaryEntry.lastValidPos.y,
        targetZ - primaryEntry.lastValidPos.z,
    );

    const proposed = groupDragMembers.map((m) => {
        const p = m.lastValidPos.clone().add(delta);
        clampToVan(m.obj, p);
        return p;
    });
    groupDragMembers.forEach((m, i) => m.obj.position.copy(proposed[i]));

    const memberSet = new Set(groupDragMembers.map((m) => m.obj));
    const blocked = doSnap && groupDragMembers.some((m) => checkCollision(m.obj, memberSet));

    if (blocked) {
        groupDragMembers.forEach((m) => m.obj.position.copy(m.lastValidPos));
    } else {
        groupDragMembers.forEach((m, i) => m.lastValidPos.copy(proposed[i]));
    }
}

// The core physics drag loop
dragControls.addEventListener('drag', (event) => {
    const obj = event.object;
    if (!isValidTarget(obj)) return;

    if (obj.userData.locked) {
        obj.position.copy(lastValidPos); // undo DragControls' own direct mutation this tick
        return;
    }

    const doSnap = isSnapEnabled();

    if (groupDragMembers) {
        dragGroup(obj, doSnap);
        return;
    }

    let targetX = obj.position.x;
    let targetY = obj.position.y;
    let targetZ = obj.position.z;

    // Optional snapping: prefer catching a neighboring object's adjacent
    // face (stacking on top, or side-by-side) over the plain 5cm grid, since
    // it's what you actually want when nudging boxes together — fall back
    // to the grid when no neighbor is close enough on that axis.
    if (doSnap) {
        const faceSnapX = findFaceSnap(obj, 'x', targetX);
        const faceSnapY = findFaceSnap(obj, 'y', targetY);
        const faceSnapZ = findFaceSnap(obj, 'z', targetZ);

        targetX = faceSnapX !== null ? faceSnapX : Math.round(targetX / 0.05) * 0.05;
        targetY = faceSnapY !== null ? faceSnapY : Math.round(targetY / 0.05) * 0.05;
        targetZ = faceSnapZ !== null ? faceSnapZ : Math.round(targetZ / 0.05) * 0.05;
    }

    const p = lastValidPos.clone();

    // Test axes independently to allow sliding against walls/objects
    const testAxis = (axis, targetVal) => {
        p[axis] = targetVal;
        clampToVan(obj, p);
        obj.position.copy(p);

        if (doSnap && checkCollision(obj)) {
            p[axis] = lastValidPos[axis]; // rollback axis
        } else {
            lastValidPos[axis] = p[axis]; // accept axis
        }
    };

    testAxis('x', targetX);
    testAxis('y', targetY);
    testAxis('z', targetZ);

    // Final apply
    obj.position.copy(lastValidPos);
});

// Programmatically selects/highlights an object — used by the object-list
// panel in ui.js so clicking a row behaves exactly like hovering the object
// in the 3D view (same emissive highlight, same activeObj that the keyboard
// shortcuts below act on).
export function selectObject(obj) {
    if (isDragging || !isValidTarget(obj)) return;
    if (activeObj && activeObj !== obj) {
        dragControls.dispatchEvent({ type: 'hoveroff', object: activeObj });
    }
    dragControls.dispatchEvent({ type: 'hoveron', object: obj });
}

// ==========================================
// MULTI-SELECT: shift+click accumulation, shift+drag marquee-select
// ==========================================
// Wired up independently of DragControls' own pointer handling (which only
// fires dragstart/hoveron for a hit object and stays silent over empty
// space) — these listeners observe the same raw pointer events to add: a
// screen-space marquee rectangle, and click-vs-drag disambiguation by
// movement distance.
const CLICK_MOVE_THRESHOLD_PX = 5;
const pickRaycaster = new THREE.Raycaster();
const pickNdc = new THREE.Vector2();

function hitTestObject(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    pickNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pickNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    pickRaycaster.setFromCamera(pickNdc, camera);
    // Raycaster reads matrixWorld directly rather than recomputing it —
    // normally guaranteed fresh by the render loop's scene.updateMatrixWorld()
    // each frame, but cheap enough to make certain of here too.
    objects.forEach((o) => o.updateMatrixWorld());
    const hits = pickRaycaster.intersectObjects(objects, false);
    return hits.length > 0 ? hits[0].object : null;
}

// Projects obj's world position to on-screen coordinates within `rect`
// (typically the canvas's getBoundingClientRect()) — exported because it's
// pure enough to unit-test directly against a real camera without going
// through jsdom's (zeroed) layout.
export function projectToScreen(obj, cam, rect) {
    const v = obj.position.clone().project(cam);
    return {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
}

export function pointInRect(point, rect) {
    return point.x >= rect.left && point.x <= rect.left + rect.width
        && point.y >= rect.top && point.y <= rect.top + rect.height;
}

let marqueeEl = null;
let marqueeStart = null; // { x, y } client coords, set while a marquee drag is in progress
let pointerDownInfo = null; // { x, y, shiftKey, hit } captured at pointerdown

function startMarquee(x, y) {
    orbitControls.enabled = false; // marquee-drag must not also orbit the camera
    marqueeStart = { x, y };
    marqueeEl = document.createElement('div');
    Object.assign(marqueeEl.style, {
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        width: '0px',
        height: '0px',
        border: '1px dashed #3b82f6',
        background: 'rgba(59, 130, 246, 0.15)',
        pointerEvents: 'none',
        zIndex: '50',
    });
    document.body.appendChild(marqueeEl);
}

function updateMarqueeRect(x, y) {
    const left = Math.min(marqueeStart.x, x);
    const top = Math.min(marqueeStart.y, y);
    const width = Math.abs(x - marqueeStart.x);
    const height = Math.abs(y - marqueeStart.y);
    if (marqueeEl) {
        Object.assign(marqueeEl.style, {
            left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
        });
    }
    return { left, top, width, height };
}

function endMarquee(x, y) {
    const rect = updateMarqueeRect(x, y);
    if (marqueeEl) { marqueeEl.remove(); marqueeEl = null; }
    orbitControls.enabled = true;
    marqueeStart = null;

    const canvasRect = renderer.domElement.getBoundingClientRect();
    const inside = objects.filter((o) => pointInRect(projectToScreen(o, camera, canvasRect), rect));
    if (inside.length > 0) {
        addManyToSelection(inside);
        refreshHistoryButtons();
    }
}

// Handlers are named + exported (rather than inline listener callbacks) so
// tests can call them directly with a plain { clientX, clientY, shiftKey }
// object, without dispatching real DOM pointer events on the shared canvas —
// which would also reach OrbitControls'/DragControls' own native listeners
// registered on the same element and drag in unrelated jsdom/library
// limitations (no Pointer Capture API, meshes not scene-parented in tests).
export function handlePointerDown(e) {
    pointerDownInfo = {
        x: e.clientX, y: e.clientY, shiftKey: e.shiftKey, hit: hitTestObject(e.clientX, e.clientY),
    };
    // Marquee-select only kicks in on an empty-space shift+drag — a shift+drag
    // that starts on an object is handled by dragControls (moving it/the
    // group) instead, exactly like an unmodified drag would be.
    if (!pointerDownInfo.hit && e.shiftKey) startMarquee(e.clientX, e.clientY);
}

export function handlePointerMove(e) {
    if (marqueeStart) updateMarqueeRect(e.clientX, e.clientY);
}

export function handlePointerUp(e) {
    if (!pointerDownInfo) return;
    const { x, y, shiftKey, hit } = pointerDownInfo;
    pointerDownInfo = null;

    if (marqueeStart) {
        endMarquee(e.clientX, e.clientY);
        return;
    }

    // Anything that actually moved is a drag/orbit gesture already handled
    // elsewhere (DragControls or OrbitControls) — only a near-stationary
    // pointerdown/up counts as a "click" for selection purposes.
    if (Math.hypot(e.clientX - x, e.clientY - y) > CLICK_MOVE_THRESHOLD_PX) return;

    if (hit && isValidTarget(hit)) {
        if (shiftKey) toggleInSelection(hit);
        else selectOnly(hit);
        refreshHistoryButtons();
    } else if (!shiftKey && getSelected().length > 0) {
        clearSelection();
        refreshHistoryButtons();
    }
}

renderer.domElement.addEventListener('pointerdown', handlePointerDown);
renderer.domElement.addEventListener('pointermove', handlePointerMove);
renderer.domElement.addEventListener('pointerup', handlePointerUp);

// ==========================================
// VIEWPORT ROTATE HANDLES
// ==========================================
// Two floating buttons that track the single selected object's screen
// position, so rotating on touch (no "R"/"T" keys) no longer requires
// leaving the 3D view for the object-list panel. Visible only for exactly
// one selection — matches the "R"/"T" keys' per-object behavior above; for
// a multi-selection, use the object list or a keyboard, same as today.
const rotateHandle = document.getElementById('viewport-rotate-btn');
const rotateXHandle = document.getElementById('viewport-rotate-x-btn');

if (rotateHandle) {
    rotateHandle.addEventListener('click', () => {
        const obj = getSelected()[0];
        if (!obj) return;
        if (obj.userData.locked) { flashReject(obj); return; }
        captureUndoPoint();
        rotate90(obj, isSnapEnabled());
        refreshHistoryButtons();
    });
}

if (rotateXHandle) {
    rotateXHandle.addEventListener('click', () => {
        const obj = getSelected()[0];
        if (!obj) return;
        if (obj.userData.locked) { flashReject(obj); return; }
        captureUndoPoint();
        rotateX90(obj, isSnapEnabled());
        refreshHistoryButtons();
    });
}

// Called every render frame from main.js's animate loop — the object's
// screen position changes continuously as the camera orbits.
export function updateRotateHandle() {
    if (!rotateHandle && !rotateXHandle) return;

    const selected = getSelected();
    const obj = (!isDragging && !marqueeStart && selected.length === 1) ? selected[0] : null;
    if (!obj) {
        rotateHandle?.classList.add('hidden');
        rotateXHandle?.classList.add('hidden');
        return;
    }

    const ndc = obj.position.clone().project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    // Outside the near/far planes (behind the camera, or clipped) or off the
    // canvas entirely — nothing sensible to point the handles at.
    const screenX = rect.left + ((ndc.x + 1) / 2) * rect.width;
    const screenY = rect.top + ((1 - ndc.y) / 2) * rect.height;
    if (ndc.z < -1 || ndc.z > 1 || !pointInRect({ x: screenX, y: screenY }, rect)) {
        rotateHandle?.classList.add('hidden');
        rotateXHandle?.classList.add('hidden');
        return;
    }

    // Side by side, offset above the object's screen center so neither
    // handle sits directly on top of it and blocks the drag-start touch
    // target: Y-axis (turn) handle on the left, X-axis (tip) on the right.
    if (rotateHandle) {
        rotateHandle.style.left = `${screenX - 22}px`;
        rotateHandle.style.top = `${screenY - 34}px`;
        rotateHandle.classList.remove('hidden');
    }
    if (rotateXHandle) {
        rotateXHandle.style.left = `${screenX + 22}px`;
        rotateXHandle.style.top = `${screenY - 34}px`;
        rotateXHandle.classList.remove('hidden');
    }
}

// Distance far enough back to frame the whole van regardless of its current
// (user-adjustable) size.
function frameDistance() {
    return Math.max(vanState.length, vanState.maxWidth, vanState.maxHeight) * 1.6 + 2;
}

// Camera view presets for the toolbar in ui.js. 'top'/'front'/'side' are
// orthogonal-ish framing angles for precise layout work; anything else
// (including no argument) resets to the default isometric view.
export function setCameraView(view) {
    const dist = frameDistance();
    const midHeight = vanState.maxHeight / 2;

    if (view === 'top') {
        // Tiny x/z offset avoids the camera-directly-above up-vector singularity.
        camera.position.set(0.001, dist, 0.001);
        orbitControls.target.set(0, 0, 0);
    } else if (view === 'front') {
        camera.position.set(0, midHeight, dist);
        orbitControls.target.set(0, midHeight, 0);
    } else if (view === 'side') {
        camera.position.set(dist, midHeight, 0);
        orbitControls.target.set(0, midHeight, 0);
    } else {
        camera.position.set(dist * 0.65, dist * 0.65, dist * 0.85);
        orbitControls.target.set(0, 1, 0);
    }
    orbitControls.update();
}

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
    // Never hijack shortcuts while the user is typing in a form field (e.g.
    // Backspace while editing the custom-width number input).
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const mod = e.ctrlKey || e.metaKey;

    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (undo()) {
            syncSlidersFromState();
            refreshHistoryButtons();
        }
        return;
    }

    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        if (redo()) {
            syncSlidersFromState();
            refreshHistoryButtons();
        }
        return;
    }

    const group = getSelected();

    if (e.key === 'Escape') {
        if (group.length > 0) {
            clearSelection();
            refreshHistoryButtons(); // re-renders the object list's selection highlighting
        }
        return;
    }

    // Below this point, every shortcut acts on either the hovered object
    // (activeObj) or, for rotate/delete, the current selection (any size,
    // including exactly one — e.g. a single object marquee-selected without
    // also being hovered still needs Delete to work) — bail out if neither
    // is present.
    if (!activeObj && group.length === 0) return;

    if (e.key === 'r' || e.key === 'R') {
        // Selection rotation: each selected object rotates 90° in place
        // individually (not the group as a whole around a shared center) —
        // feeds straight into the existing single-object rotate90().
        if (group.length > 0) {
            captureUndoPoint();
            group.forEach((o) => rotate90(o, isSnapEnabled()));
            refreshHistoryButtons();
            return;
        }
        if (!activeObj) return;
        if (activeObj.userData.locked) { flashReject(activeObj); return; }
        captureUndoPoint();
        rotate90(activeObj, isSnapEnabled());
        refreshHistoryButtons();
        return;
    }

    if (e.key === 't' || e.key === 'T') {
        // Tip 90° around the X axis (swaps height/depth) — same per-object
        // selection handling as 'r' above, just around the other axis.
        if (group.length > 0) {
            captureUndoPoint();
            group.forEach((o) => rotateX90(o, isSnapEnabled()));
            refreshHistoryButtons();
            return;
        }
        if (!activeObj) return;
        if (activeObj.userData.locked) { flashReject(activeObj); return; }
        captureUndoPoint();
        rotateX90(activeObj, isSnapEnabled());
        refreshHistoryButtons();
        return;
    }

    // Full keyboard control over an object's position, not just vertical:
    // ArrowLeft/Right nudge left/right (X), plain ArrowUp/Down nudge up/down
    // (Y, unchanged from before), and Shift+ArrowUp/Down nudge forward/back
    // (Z) — the third axis needs a modifier since the four arrow keys are
    // already spoken for by the other two axes.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); // don't scroll the page
        if (!activeObj) return;
        if (activeObj.userData.locked) { flashReject(activeObj); return; }
        if (!e.repeat) captureUndoPoint(); // one undo point per key-hold gesture, not per repeat tick

        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            moveHorizontal(activeObj, 'x', e.key === 'ArrowRight' ? 0.05 : -0.05, isSnapEnabled());
        } else if (e.shiftKey) {
            moveHorizontal(activeObj, 'z', e.key === 'ArrowUp' ? -0.05 : 0.05, isSnapEnabled());
        } else {
            moveVertical(activeObj, e.key === 'ArrowUp' ? 0.05 : -0.05, isSnapEnabled());
        }

        if (!e.repeat) refreshHistoryButtons();
        return;
    }

    if (e.key === 'l' || e.key === 'L') {
        if (!activeObj) return;
        if (activeObj.userData.fixed) { flashReject(activeObj); return; } // permanently locked, nothing to toggle
        captureUndoPoint();
        toggleLock(activeObj);
        refreshHistoryButtons();
        return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (group.length > 0) {
            captureUndoPoint();
            group.forEach((o) => removeObject(o)); // no-op per-object for any that are locked
            clearSelection();
            activeObj = null;
            refreshHistoryButtons();
            return;
        }
        if (!activeObj) return;
        if (activeObj.userData.locked) { flashReject(activeObj); return; }
        captureUndoPoint();
        removeObject(activeObj);
        activeObj = null;
        refreshHistoryButtons();
        return;
    }

    if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault(); // avoid the browser's "bookmark this page" shortcut
        if (!activeObj) return;
        if (activeObj.userData.fixed) { flashReject(activeObj); return; }
        captureUndoPoint();
        const copy = duplicateObject(activeObj);
        dragControls.dispatchEvent({ type: 'hoveroff', object: activeObj });
        dragControls.dispatchEvent({ type: 'hoveron', object: copy });
        refreshHistoryButtons();
    }
});
