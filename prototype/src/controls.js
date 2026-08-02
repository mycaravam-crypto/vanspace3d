import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { camera, renderer } from './scene.js';
import { vanState, objects } from './state.js';
import { clampToVan, checkCollision, findFaceSnap } from './collision.js';
import {
    rotate90, removeObject, duplicateObject, toggleLock, moveVertical, flashReject,
} from './objects.js';
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
});

dragControls.addEventListener('dragend', (event) => {
    orbitControls.enabled = true;
    isDragging = false;
    document.body.style.cursor = 'auto';
    if (isValidTarget(activeObj)) activeObj.material.emissive.setHex(0x000000);
    if (!isValidTarget(event.object) || event.object.userData.locked) return;

    // Final floor snap check
    if (event.object.position.y < event.object.geometry.parameters.height / 2 + 0.02) {
        event.object.position.y = event.object.geometry.parameters.height / 2;
    }
});

// The core physics drag loop
dragControls.addEventListener('drag', (event) => {
    const obj = event.object;
    if (!isValidTarget(obj)) return;

    if (obj.userData.locked) {
        obj.position.copy(lastValidPos); // undo DragControls' own direct mutation this tick
        return;
    }

    const doSnap = isSnapEnabled();

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

    if (!activeObj) return;

    if (e.key === 'r' || e.key === 'R') {
        if (activeObj.userData.locked) { flashReject(activeObj); return; }
        captureUndoPoint();
        rotate90(activeObj, isSnapEnabled());
        refreshHistoryButtons();
        return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault(); // don't scroll the page
        if (activeObj.userData.locked) { flashReject(activeObj); return; }
        if (!e.repeat) captureUndoPoint(); // one undo point per key-hold gesture, not per repeat tick
        moveVertical(activeObj, e.key === 'ArrowUp' ? 0.05 : -0.05, isSnapEnabled());
        if (!e.repeat) refreshHistoryButtons();
        return;
    }

    if (e.key === 'l' || e.key === 'L') {
        captureUndoPoint();
        toggleLock(activeObj);
        refreshHistoryButtons();
        return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeObj.userData.locked) { flashReject(activeObj); return; }
        captureUndoPoint();
        removeObject(activeObj);
        activeObj = null;
        refreshHistoryButtons();
        return;
    }

    if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault(); // avoid the browser's "bookmark this page" shortcut
        captureUndoPoint();
        const copy = duplicateObject(activeObj);
        dragControls.dispatchEvent({ type: 'hoveroff', object: activeObj });
        dragControls.dispatchEvent({ type: 'hoveron', object: copy });
        refreshHistoryButtons();
    }
});
