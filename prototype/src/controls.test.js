import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

// controls.js needs a camera and a DOM element for OrbitControls/DragControls
// to attach listeners to. A real PerspectiveCamera is harmless (no WebGL
// involved); a jsdom <canvas> satisfies addEventListener/style/getBoundingClientRect.
vi.mock('./scene.js', () => ({
    camera: new THREE.PerspectiveCamera(45, 1, 0.1, 100),
    renderer: { domElement: document.createElement('canvas') },
}));

let snapEnabled = true;
vi.mock('./ui.js', () => ({
    isSnapEnabled: () => snapEnabled,
    syncSlidersFromState: vi.fn(),
    refreshHistoryButtons: vi.fn(),
}));
vi.mock('./objects.js', () => ({
    rotate90: vi.fn(),
    removeObject: vi.fn(),
    duplicateObject: vi.fn((obj) => obj), // returns something dispatchable by default
    toggleLock: vi.fn(),
    moveVertical: vi.fn(),
    moveHorizontal: vi.fn(),
    flashReject: vi.fn(),
    // selection.js imports this from the (mocked) './objects.js' too — a
    // no-op stub is enough since these tests assert on userData.selected
    // directly, not the visual edge-color side effect.
    refreshObjectAppearance: vi.fn(),
}));
// history.js pulls in the real persistence.js -> van.js/objects.js chain;
// mocked here so controls.test.js stays focused on controls.js's own wiring
// (undo/redo mechanics themselves are covered by history.test.js).
vi.mock('./history.js', () => ({
    captureUndoPoint: vi.fn(),
    undo: vi.fn(() => false),
    redo: vi.fn(() => false),
}));

const { camera, renderer } = await import('./scene.js');
const { vanState, objects, DEFAULT_VAN_STATE } = await import('./state.js');
const {
    rotate90, removeObject, duplicateObject, toggleLock, moveVertical, moveHorizontal, flashReject,
} = await import('./objects.js');
const { syncSlidersFromState, refreshHistoryButtons } = await import('./ui.js');
const { captureUndoPoint, undo, redo } = await import('./history.js');
const {
    isSelected, getSelected, selectOnly, toggleInSelection, addManyToSelection, clearSelection,
} = await import('./selection.js');
const {
    orbitControls, dragControls, selectObject, setCameraView, projectToScreen, pointInRect,
    handlePointerDown, handlePointerMove, handlePointerUp,
} = await import('./controls.js');

function makeTrackedBox(w = 0.6, h = 0.32, d = 0.4) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
    objects.push(mesh);
    return mesh;
}

// jsdom's canvas has no real layout (getBoundingClientRect is all zeros by
// default), which would make every NDC computation divide by zero — stub a
// plausible fixed viewport so hit-testing/marquee math is well-defined.
const CANVAS_RECT = {
    left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600,
};
renderer.domElement.getBoundingClientRect = () => CANVAS_RECT;

// These call controls.js's pointer handlers directly with a plain
// { clientX, clientY, shiftKey } object, rather than dispatching real DOM
// pointer events on the shared canvas — dispatching for real would also
// reach OrbitControls'/DragControls' own native listeners on that same
// element (registered by the real, unmocked instances this file exercises
// elsewhere via direct dispatchEvent calls), pulling in jsdom gaps that are
// irrelevant to what's under test here (no Pointer Capture API, and
// DragControls' internal handler assumes every object is scene-parented,
// which these test fixtures deliberately aren't).
function firePointerDown(x, y, opts = {}) {
    handlePointerDown({ clientX: x, clientY: y, shiftKey: false, ...opts });
}
function firePointerMove(x, y) {
    handlePointerMove({ clientX: x, clientY: y });
}
function firePointerUp(x, y) {
    handlePointerUp({ clientX: x, clientY: y });
}
// A full click gesture (down+up at the same point, no movement).
function click(x, y, opts = {}) {
    firePointerDown(x, y, opts);
    firePointerUp(x, y);
}

// activeObj inside controls.js is module-private state, and both 'hoveron'
// and 'dragstart' can set it (mirroring the real handlers). Route every
// dispatch through here so beforeEach can reliably clear it via a matching
// 'hoveroff' — otherwise a later "nothing is hovered" test could observe a
// stale activeObj left over from an earlier drag test.
let lastActive = null;
function fire(type, object) {
    dragControls.dispatchEvent({ type, object });
    if (type === 'hoveron' || type === 'dragstart') lastActive = object;
    if (type === 'hoveroff') lastActive = null;
}

function keydown(key, opts = {}) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

beforeEach(() => {
    if (lastActive) {
        // hoveroff only clears activeObj while !isDragging — a test that fired
        // 'dragstart' without a matching 'dragend' would otherwise leave the
        // module-private isDragging flag stuck true, silently defeating this
        // cleanup for every test that follows.
        dragControls.dispatchEvent({ type: 'dragend', object: lastActive });
        fire('hoveroff', lastActive);
    }
    objects.length = 0;
    Object.assign(vanState, DEFAULT_VAN_STATE);
    snapEnabled = true;
    rotate90.mockClear();
    removeObject.mockClear();
    duplicateObject.mockClear();
    duplicateObject.mockImplementation((obj) => obj);
    toggleLock.mockClear();
    moveVertical.mockClear();
    moveHorizontal.mockClear();
    flashReject.mockClear();
    captureUndoPoint.mockClear();
    undo.mockClear();
    undo.mockReturnValue(false);
    redo.mockClear();
    redo.mockReturnValue(false);
    syncSlidersFromState.mockClear();
    refreshHistoryButtons.mockClear();
    orbitControls.enabled = true;
    document.body.style.cursor = 'auto';
    document.body.innerHTML = '';
    // camera is a shared singleton across this whole file — the setCameraView
    // tests deliberately move it, so reset to a known pose (origin, looking
    // down -Z) for the projectToScreen/pointer-selection tests below, which
    // depend on a deterministic camera position/orientation.
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    camera.updateMatrixWorld(true);
});

describe('dragControls raycasting', () => {
    it('is non-recursive, so it can never pick a child edge-outline instead of the box itself', () => {
        // Regression test for the original bug: recursive picking let clicks
        // land on the child LineSegments (which has no .emissive / box .parameters),
        // breaking drag/hover/rotate.
        expect(dragControls.recursive).toBe(false);
    });
});

describe('hover handling', () => {
    it('sets emissive highlight and grab cursor for a valid tracked object', () => {
        const mesh = makeTrackedBox();
        fire('hoveron', mesh);

        expect(mesh.material.emissive.getHex()).toBe(0x222222);
        expect(document.body.style.cursor).toBe('grab');
    });

    it('clears the highlight on hoveroff', () => {
        const mesh = makeTrackedBox();
        fire('hoveron', mesh);
        fire('hoveroff', mesh);

        expect(mesh.material.emissive.getHex()).toBe(0x000000);
        expect(document.body.style.cursor).toBe('auto');
    });

    it('ignores hoveron for an object that is not in the tracked objects list', () => {
        // This is the shape of the original bug: a stray object (e.g. an edge
        // LineSegments) reaching a handler that assumes a fully-formed box.
        const stranger = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
        expect(() => fire('hoveron', stranger)).not.toThrow();
        expect(document.body.style.cursor).not.toBe('grab');
    });

    it('does not clear the active highlight on hoveroff for a different object', () => {
        const active = makeTrackedBox();
        const other = makeTrackedBox();
        fire('hoveron', active);

        dragControls.dispatchEvent({ type: 'hoveroff', object: other }); // not routed through fire() on purpose

        expect(active.material.emissive.getHex()).toBe(0x222222);
        expect(document.body.style.cursor).toBe('grab');
    });
});

describe('drag lifecycle', () => {
    it('disables orbit controls on dragstart and re-enables on dragend', () => {
        const mesh = makeTrackedBox();
        mesh.position.set(0, 0.16, 0);

        fire('dragstart', mesh);
        expect(orbitControls.enabled).toBe(false);

        fire('dragend', mesh);
        expect(orbitControls.enabled).toBe(true);
    });

    it('captures one undo point per drag gesture on dragstart', () => {
        const mesh = makeTrackedBox();
        fire('dragstart', mesh);
        expect(captureUndoPoint).toHaveBeenCalledTimes(1);
        expect(refreshHistoryButtons).toHaveBeenCalled();
    });

    it('does not capture an undo point for dragstart on an untracked object', () => {
        const stranger = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
        fire('dragstart', stranger);
        expect(captureUndoPoint).not.toHaveBeenCalled();
    });

    it('ignores dragstart for an untracked object and leaves orbit controls enabled', () => {
        const stranger = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
        fire('dragstart', stranger);
        expect(orbitControls.enabled).toBe(true);
    });

    it('clamps the dragged position to stay inside the van bounds', () => {
        const mesh = makeTrackedBox();
        mesh.position.set(0, 0.16, 0);
        fire('dragstart', mesh);

        mesh.position.set(50, 0.16, 0); // fly far outside the van on x
        fire('drag', mesh);

        expect(Math.abs(mesh.position.x)).toBeLessThan(2); // well within any plausible van width
    });

    it('snaps the floor position on dragend if left slightly below the floor', () => {
        const mesh = makeTrackedBox(0.6, 0.32, 0.4);
        mesh.position.set(0, 0.05, 0); // below height/2 (0.16)
        fire('dragend', mesh);

        expect(mesh.position.y).toBeCloseTo(0.16);
    });

    it('rounds the dragged position to the 5cm grid when snapping is enabled', () => {
        const mesh = makeTrackedBox(0.3, 0.2, 0.3);
        mesh.position.set(0, 0.1, -1.0);
        fire('dragstart', mesh);

        mesh.position.set(0.12, 0.1, -1.0); // 0.12 should round down to 0.10
        fire('drag', mesh);

        expect(mesh.position.x).toBeCloseTo(0.10);
    });

    it('blocks the axis that would collide but still slides along a free axis', () => {
        const a = makeTrackedBox(0.3, 0.2, 0.3);
        a.position.set(0, 0.1, -1.0);
        const b = makeTrackedBox(0.3, 0.2, 0.3);
        b.position.set(0.5, 0.1, -1.0); // far enough on x to not overlap a yet

        fire('dragstart', a);

        // Attempt to move onto b's x position while also sliding along z.
        a.position.set(0.5, 0.1, -0.5);
        fire('drag', a);

        expect(a.position.x).toBeCloseTo(0); // blocked: would collide with b
        expect(a.position.z).toBeCloseTo(-0.5); // still allowed: no collision on this axis
    });

    it('snaps onto a neighboring box\'s top face instead of the plain grid when close enough', () => {
        const base = makeTrackedBox(0.6, 0.32, 0.4);
        base.position.set(0, 0.16, -1.0); // top face at y = 0.32

        const mover = makeTrackedBox(0.6, 0.32, 0.4);
        mover.position.set(0, 0.5, -1.0); // same footprint, hovering a few cm above a perfect stack

        fire('dragstart', mover);
        mover.position.set(0, 0.5, -1.0); // simulate the pointer hovering here
        fire('drag', mover);

        // Perfect stack would be y = 0.32 (base top) + 0.16 (mover half-height) = 0.48,
        // which isn't on the 5cm grid — proving this came from face-snap, not grid-snap.
        expect(mover.position.y).toBeCloseTo(0.48);
    });

    it('falls back to grid snapping when no neighboring face is within tolerance', () => {
        const mover = makeTrackedBox(0.3, 0.2, 0.3);
        mover.position.set(0, 0.1, -1.0);
        fire('dragstart', mover);

        mover.position.set(0.12, 0.1, -1.0); // no neighbors at all — should just round to the grid
        fire('drag', mover);

        expect(mover.position.x).toBeCloseTo(0.10);
    });

    it('allows overlapping positions when snapping/collision checking is disabled', () => {
        snapEnabled = false;
        const a = makeTrackedBox(0.3, 0.2, 0.3);
        a.position.set(0, 0.1, -1.0);
        const b = makeTrackedBox(0.3, 0.2, 0.3);
        b.position.set(0.5, 0.1, -1.0);

        fire('dragstart', a);
        a.position.set(0.5, 0.1, -1.0); // directly onto b
        fire('drag', a);

        expect(a.position.x).toBeCloseTo(0.5);
        expect(a.position.z).toBeCloseTo(-1.0);
    });

    it('shows a "not-allowed" cursor when hovering a locked object', () => {
        const mesh = makeTrackedBox();
        mesh.userData.locked = true;
        fire('hoveron', mesh);
        expect(document.body.style.cursor).toBe('not-allowed');
    });

    it('rejects dragstart on a locked object: no undo capture, camera orbit stays enabled', () => {
        const mesh = makeTrackedBox();
        mesh.userData.locked = true;
        mesh.position.set(0, 0.16, 0);

        fire('dragstart', mesh);

        expect(captureUndoPoint).not.toHaveBeenCalled();
        expect(flashReject).toHaveBeenCalledWith(mesh);
        expect(orbitControls.enabled).toBe(true);
    });

    it('snaps a locked object straight back to its pre-drag position every tick', () => {
        const mesh = makeTrackedBox();
        mesh.userData.locked = true;
        mesh.position.set(0, 0.16, -1.0);

        fire('dragstart', mesh);
        mesh.position.set(0.4, 0.16, -0.5); // simulate DragControls' own direct mutation
        fire('drag', mesh);

        expect(mesh.position.x).toBeCloseTo(0);
        expect(mesh.position.z).toBeCloseTo(-1.0);
    });

    it('skips the floor-snap on dragend for a locked object', () => {
        const mesh = makeTrackedBox(0.6, 0.32, 0.4);
        mesh.userData.locked = true;
        mesh.position.set(0, 0.05, 0); // below height/2 — would normally get floor-snapped

        fire('dragstart', mesh);
        fire('dragend', mesh);

        expect(mesh.position.y).toBeCloseTo(0.05); // untouched
    });
});

describe('keyboard shortcuts', () => {
    it('ignores every shortcut while a form field is focused/targeted', () => {
        const mesh = makeTrackedBox();
        fire('hoveron', mesh);
        const input = document.createElement('input');
        document.body.appendChild(input);

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));

        expect(removeObject).not.toHaveBeenCalled();
        expect(rotate90).not.toHaveBeenCalled();
        expect(undo).not.toHaveBeenCalled();
    });

    describe('rotation ("r")', () => {
        it('rotates the currently hovered object, passing through the snap state', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);

            keydown('r');

            expect(captureUndoPoint).toHaveBeenCalled();
            expect(rotate90).toHaveBeenCalledWith(mesh, true);
            expect(refreshHistoryButtons).toHaveBeenCalled();
        });

        it('does nothing when no object is hovered', () => {
            keydown('r');
            expect(rotate90).not.toHaveBeenCalled();
            expect(captureUndoPoint).not.toHaveBeenCalled();
        });

        it('rejects rotation of a locked object without capturing an undo point', () => {
            const mesh = makeTrackedBox();
            mesh.userData.locked = true;
            fire('hoveron', mesh);

            keydown('r');

            expect(rotate90).not.toHaveBeenCalled();
            expect(captureUndoPoint).not.toHaveBeenCalled();
            expect(flashReject).toHaveBeenCalledWith(mesh);
        });
    });

    describe('lock toggle ("l")', () => {
        it('toggles lock on the hovered object', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);

            keydown('l');

            expect(captureUndoPoint).toHaveBeenCalled();
            expect(toggleLock).toHaveBeenCalledWith(mesh);
            expect(refreshHistoryButtons).toHaveBeenCalled();
        });

        it('also responds to uppercase "L"', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);
            keydown('L');
            expect(toggleLock).toHaveBeenCalledWith(mesh);
        });

        it('does nothing when no object is hovered', () => {
            keydown('l');
            expect(toggleLock).not.toHaveBeenCalled();
        });

        it('works even on an already-locked object (i.e. can unlock)', () => {
            const mesh = makeTrackedBox();
            mesh.userData.locked = true;
            fire('hoveron', mesh);
            keydown('l');
            expect(toggleLock).toHaveBeenCalledWith(mesh);
        });

        it('rejects toggling a fixed fixture without capturing an undo point', () => {
            const mesh = makeTrackedBox();
            mesh.userData.fixed = true;
            fire('hoveron', mesh);

            keydown('l');

            expect(toggleLock).not.toHaveBeenCalled();
            expect(captureUndoPoint).not.toHaveBeenCalled();
            expect(flashReject).toHaveBeenCalledWith(mesh);
        });
    });

    describe('vertical movement (ArrowUp/ArrowDown)', () => {
        it('moves the hovered object up by one grid step', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);

            keydown('ArrowUp');

            expect(captureUndoPoint).toHaveBeenCalled();
            expect(moveVertical).toHaveBeenCalledWith(mesh, 0.05, true);
            expect(refreshHistoryButtons).toHaveBeenCalled();
        });

        it('moves the hovered object down by one grid step', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);

            keydown('ArrowDown');

            expect(moveVertical).toHaveBeenCalledWith(mesh, -0.05, true);
        });

        it('captures only one undo point across an auto-repeated key hold', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);

            keydown('ArrowUp'); // first press: repeat = false
            keydown('ArrowUp', { repeat: true });
            keydown('ArrowUp', { repeat: true });

            expect(captureUndoPoint).toHaveBeenCalledTimes(1);
            expect(moveVertical).toHaveBeenCalledTimes(3); // every tick still moves it
        });

        it('rejects movement of a locked object without capturing an undo point', () => {
            const mesh = makeTrackedBox();
            mesh.userData.locked = true;
            fire('hoveron', mesh);

            keydown('ArrowUp');

            expect(moveVertical).not.toHaveBeenCalled();
            expect(captureUndoPoint).not.toHaveBeenCalled();
            expect(flashReject).toHaveBeenCalledWith(mesh);
        });

        it('does nothing when no object is hovered', () => {
            keydown('ArrowUp');
            expect(moveVertical).not.toHaveBeenCalled();
        });
    });

    describe('horizontal movement (ArrowLeft/ArrowRight, Shift+ArrowUp/ArrowDown)', () => {
        it('moves the hovered object left on the x axis', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);

            keydown('ArrowLeft');

            expect(captureUndoPoint).toHaveBeenCalled();
            expect(moveHorizontal).toHaveBeenCalledWith(mesh, 'x', -0.05, true);
            expect(refreshHistoryButtons).toHaveBeenCalled();
        });

        it('moves the hovered object right on the x axis', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);

            keydown('ArrowRight');

            expect(moveHorizontal).toHaveBeenCalledWith(mesh, 'x', 0.05, true);
        });

        it('moves the hovered object forward on the z axis with Shift+ArrowUp', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);

            keydown('ArrowUp', { shiftKey: true });

            expect(moveHorizontal).toHaveBeenCalledWith(mesh, 'z', -0.05, true);
            expect(moveVertical).not.toHaveBeenCalled();
        });

        it('moves the hovered object backward on the z axis with Shift+ArrowDown', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);

            keydown('ArrowDown', { shiftKey: true });

            expect(moveHorizontal).toHaveBeenCalledWith(mesh, 'z', 0.05, true);
        });

        it('plain ArrowUp/ArrowDown (no shift) still move vertically, not on the z axis', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);

            keydown('ArrowUp');

            expect(moveVertical).toHaveBeenCalledWith(mesh, 0.05, true);
            expect(moveHorizontal).not.toHaveBeenCalled();
        });

        it('rejects horizontal movement of a locked object without capturing an undo point', () => {
            const mesh = makeTrackedBox();
            mesh.userData.locked = true;
            fire('hoveron', mesh);

            keydown('ArrowLeft');

            expect(moveHorizontal).not.toHaveBeenCalled();
            expect(captureUndoPoint).not.toHaveBeenCalled();
            expect(flashReject).toHaveBeenCalledWith(mesh);
        });

        it('does nothing when no object is hovered', () => {
            keydown('ArrowLeft');
            expect(moveHorizontal).not.toHaveBeenCalled();
        });
    });

    describe('delete (Delete / Backspace)', () => {
        it('removes the hovered object and clears the hover state', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);

            keydown('Delete');

            expect(captureUndoPoint).toHaveBeenCalled();
            expect(removeObject).toHaveBeenCalledWith(mesh);
            expect(refreshHistoryButtons).toHaveBeenCalled();

            // activeObj was cleared, so a second Delete is a no-op.
            removeObject.mockClear();
            keydown('Delete');
            expect(removeObject).not.toHaveBeenCalled();
        });

        it('also responds to Backspace', () => {
            const mesh = makeTrackedBox();
            fire('hoveron', mesh);
            keydown('Backspace');
            expect(removeObject).toHaveBeenCalledWith(mesh);
        });

        it('does nothing when no object is hovered', () => {
            keydown('Delete');
            expect(removeObject).not.toHaveBeenCalled();
        });

        it('rejects deletion of a locked object, keeps hover, without capturing an undo point', () => {
            const mesh = makeTrackedBox();
            mesh.userData.locked = true;
            fire('hoveron', mesh);

            keydown('Delete');

            expect(removeObject).not.toHaveBeenCalled();
            expect(captureUndoPoint).not.toHaveBeenCalled();
            expect(flashReject).toHaveBeenCalledWith(mesh);

            // Hover was preserved (not cleared like a successful delete would),
            // so e.g. unlocking it right after still works on the same object.
            keydown('l');
            expect(toggleLock).toHaveBeenCalledWith(mesh);
        });
    });

    describe('duplicate (Ctrl+D)', () => {
        it('duplicates the hovered object and transfers hover to the copy', () => {
            const mesh = makeTrackedBox();
            const copy = makeTrackedBox();
            duplicateObject.mockImplementation(() => copy);
            fire('hoveron', mesh);

            keydown('d', { ctrlKey: true });

            expect(captureUndoPoint).toHaveBeenCalled();
            expect(duplicateObject).toHaveBeenCalledWith(mesh);
            expect(refreshHistoryButtons).toHaveBeenCalled();
            // Hover moved to the duplicate: it's now highlighted...
            expect(copy.material.emissive.getHex()).toBe(0x222222);
            // ...and the original is no longer.
            expect(mesh.material.emissive.getHex()).toBe(0x000000);

            // The hoveron/hoveroff that moved the hover happened via direct
            // dispatchEvent calls inside controls.js, not through this test
            // file's fire() helper — tell beforeEach's cleanup where the
            // *real* activeObj ended up so it doesn't leak into the next test.
            lastActive = copy;
        });

        it('does nothing when no object is hovered', () => {
            keydown('d', { ctrlKey: true });
            expect(duplicateObject).not.toHaveBeenCalled();
        });

        it('rejects duplicating a fixed fixture without capturing an undo point', () => {
            const mesh = makeTrackedBox();
            mesh.userData.fixed = true;
            fire('hoveron', mesh);

            keydown('d', { ctrlKey: true });

            expect(duplicateObject).not.toHaveBeenCalled();
            expect(captureUndoPoint).not.toHaveBeenCalled();
            expect(flashReject).toHaveBeenCalledWith(mesh);
        });
    });

    describe('undo/redo (Ctrl+Z / Ctrl+Y)', () => {
        it('calls undo() and re-syncs the UI when there is something to undo', () => {
            undo.mockReturnValue(true);
            keydown('z', { ctrlKey: true });
            expect(undo).toHaveBeenCalled();
            expect(syncSlidersFromState).toHaveBeenCalled();
            expect(refreshHistoryButtons).toHaveBeenCalled();
        });

        it('does not re-sync the UI when undo() reports nothing happened', () => {
            undo.mockReturnValue(false);
            keydown('z', { ctrlKey: true });
            expect(undo).toHaveBeenCalled();
            expect(syncSlidersFromState).not.toHaveBeenCalled();
        });

        it('calls redo() on Ctrl+Y', () => {
            redo.mockReturnValue(true);
            keydown('y', { ctrlKey: true });
            expect(redo).toHaveBeenCalled();
            expect(syncSlidersFromState).toHaveBeenCalled();
        });

        it('calls redo() on Ctrl+Shift+Z', () => {
            redo.mockReturnValue(true);
            keydown('z', { ctrlKey: true, shiftKey: true });
            expect(redo).toHaveBeenCalled();
            expect(undo).not.toHaveBeenCalled();
        });

        it('works without requiring a hovered object', () => {
            undo.mockReturnValue(true);
            keydown('z', { ctrlKey: true }); // nothing hovered
            expect(undo).toHaveBeenCalled();
        });
    });
});

describe('selectObject', () => {
    it('highlights the given object like a mouse hover would', () => {
        const mesh = makeTrackedBox();
        selectObject(mesh);
        lastActive = mesh; // dispatched internally, not through fire()

        expect(mesh.material.emissive.getHex()).toBe(0x222222);
    });

    it('clears the highlight on the previously selected object first', () => {
        const first = makeTrackedBox();
        const second = makeTrackedBox();

        selectObject(first);
        selectObject(second);
        lastActive = second;

        expect(first.material.emissive.getHex()).toBe(0x000000);
        expect(second.material.emissive.getHex()).toBe(0x222222);
    });

    it('does nothing for an object that is not tracked', () => {
        const stranger = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
        expect(() => selectObject(stranger)).not.toThrow();
        expect(document.body.style.cursor).not.toBe('grab');
    });

    it('is a no-op while a drag is in progress', () => {
        const dragged = makeTrackedBox();
        fire('dragstart', dragged);

        const other = makeTrackedBox();
        selectObject(other);

        expect(other.material.emissive.getHex()).toBe(0x000000);

        fire('dragend', dragged); // cleanup: end the drag this test started
        lastActive = dragged;
    });
});

describe('setCameraView', () => {
    it('frames the van from the top with the target centered on the floor', () => {
        setCameraView('top');
        expect(orbitControls.target.y).toBeCloseTo(0);
        expect(orbitControls.object.position.y).toBeGreaterThan(0);
    });

    it('frames the van from the front, looking along -Z, target at mid-height', () => {
        setCameraView('front');
        expect(orbitControls.target.y).toBeCloseTo(vanState.maxHeight / 2);
        expect(orbitControls.object.position.z).toBeGreaterThan(0);
        expect(orbitControls.object.position.x).toBeCloseTo(0);
    });

    it('frames the van from the side, target at mid-height', () => {
        setCameraView('side');
        expect(orbitControls.target.y).toBeCloseTo(vanState.maxHeight / 2);
        expect(orbitControls.object.position.x).toBeGreaterThan(0);
    });

    it('falls back to the default isometric framing for an unknown/missing view', () => {
        setCameraView('iso');
        expect(orbitControls.target.y).toBeCloseTo(1);
        expect(orbitControls.object.position.x).toBeGreaterThan(0);
        expect(orbitControls.object.position.y).toBeGreaterThan(0);
        expect(orbitControls.object.position.z).toBeGreaterThan(0);
    });

    it('scales the framing distance with the current van dimensions', () => {
        setCameraView('front');
        const smallZ = orbitControls.object.position.z;

        vanState.length = 10;
        setCameraView('front');
        const largeZ = orbitControls.object.position.z;

        expect(largeZ).toBeGreaterThan(smallZ);
    });
});

describe('projectToScreen / pointInRect', () => {
    it('projects an object directly in front of the camera to the rect center', () => {
        const mesh = makeTrackedBox();
        mesh.position.set(0, 0, -1); // dead ahead of the origin-positioned test camera
        const p = projectToScreen(mesh, camera, CANVAS_RECT);
        expect(p.x).toBeCloseTo(CANVAS_RECT.width / 2, 0);
        expect(p.y).toBeCloseTo(CANVAS_RECT.height / 2, 0);
    });

    it('projects an object off to one side away from center, in the expected direction', () => {
        const mesh = makeTrackedBox();
        mesh.position.set(-0.3, 0, -1);
        const p = projectToScreen(mesh, camera, CANVAS_RECT);
        expect(p.x).toBeLessThan(CANVAS_RECT.width / 2);
    });

    describe('pointInRect', () => {
        const rect = { left: 10, top: 10, width: 100, height: 50 };
        it('is true for a point inside', () => {
            expect(pointInRect({ x: 50, y: 30 }, rect)).toBe(true);
        });
        it('is true exactly on the boundary', () => {
            expect(pointInRect({ x: 10, y: 10 }, rect)).toBe(true);
            expect(pointInRect({ x: 110, y: 60 }, rect)).toBe(true);
        });
        it('is false outside the boundary', () => {
            expect(pointInRect({ x: 9, y: 30 }, rect)).toBe(false);
            expect(pointInRect({ x: 50, y: 61 }, rect)).toBe(false);
        });
    });
});

describe('pointer-driven selection (click / shift+click / marquee)', () => {
    // All three test boxes sit dead ahead of the origin camera on x (see
    // projectToScreen tests above), so a click at the exact rect center hits
    // whichever one is currently in `objects` at z=-1, x=0.
    const CENTER_X = CANVAS_RECT.width / 2;
    const CENTER_Y = CANVAS_RECT.height / 2;

    it('a plain click on an object selects only it', () => {
        const mesh = makeTrackedBox();
        mesh.position.set(0, 0, -1);

        click(CENTER_X, CENTER_Y);

        expect(isSelected(mesh)).toBe(true);
        expect(getSelected()).toEqual([mesh]);
        expect(refreshHistoryButtons).toHaveBeenCalled();
    });

    it('a plain click on a different object replaces the selection', () => {
        const a = makeTrackedBox();
        a.position.set(0, 0, -1);
        selectOnly(a);

        const b = makeTrackedBox();
        b.position.set(0, 0, -0.5); // closer to the camera — raycaster hits this one first
        click(CENTER_X, CENTER_Y);

        expect(getSelected()).toEqual([b]);
    });

    it('a plain click on empty space clears the selection', () => {
        const a = makeTrackedBox();
        a.position.set(0, 0, -1);
        selectOnly(a);
        refreshHistoryButtons.mockClear();

        click(50, 50); // far from the box's projected center

        expect(getSelected()).toEqual([]);
        expect(refreshHistoryButtons).toHaveBeenCalled();
    });

    it('a plain click on empty space with nothing selected does not call refreshHistoryButtons redundantly', () => {
        click(50, 50);
        expect(refreshHistoryButtons).not.toHaveBeenCalled();
    });

    it('shift+click on an unselected object adds it to the selection (accumulation)', () => {
        const a = makeTrackedBox();
        a.position.set(0, 0, -1);
        const b = makeTrackedBox(0.2, 0.2, 0.2); // small + well clear of `a`'s footprint, so no raycast ambiguity
        b.position.set(-2, 0, -1);
        const screenB = projectToScreen(b, camera, CANVAS_RECT);

        click(CENTER_X, CENTER_Y, { shiftKey: true });
        click(screenB.x, screenB.y, { shiftKey: true });

        expect(getSelected()).toEqual([a, b]);
    });

    it('shift+click on an already-selected object removes it from the selection', () => {
        const a = makeTrackedBox();
        a.position.set(0, 0, -1);
        selectOnly(a);

        click(CENTER_X, CENTER_Y, { shiftKey: true });

        expect(getSelected()).toEqual([]);
    });

    it('a real drag gesture (movement beyond the click threshold) does not affect selection', () => {
        const a = makeTrackedBox();
        a.position.set(0, 0, -1);

        firePointerDown(CENTER_X, CENTER_Y);
        firePointerUp(CENTER_X + 50, CENTER_Y); // moved well past the click threshold

        expect(getSelected()).toEqual([]);
    });

    describe('marquee select (shift+drag over empty space)', () => {
        it('selects every object whose projected position falls inside the dragged rectangle, unioned with the existing selection', () => {
            const inside1 = makeTrackedBox();
            inside1.position.set(0, 0, -1); // projects near rect center
            const inside2 = makeTrackedBox();
            inside2.position.set(-0.3, 0, -1); // projects left-of-center, still on screen
            const outside = makeTrackedBox();
            outside.position.set(5, 0, -1); // projects far off to the right, outside the canvas

            const alreadySelected = makeTrackedBox();
            alreadySelected.position.set(0, 0, -5); // irrelevant to the marquee rect below
            selectOnly(alreadySelected);

            // Empty-space start point (bottom-right corner, away from every
            // object's projected position) dragged up to enclose both
            // "inside" objects but not the far-off "outside" one.
            firePointerDown(750, 550, { shiftKey: true });
            firePointerMove(50, 50);
            firePointerUp(50, 50);

            expect(getSelected()).toEqual(expect.arrayContaining([alreadySelected, inside1, inside2]));
            expect(getSelected()).not.toContain(outside);
            expect(refreshHistoryButtons).toHaveBeenCalled();
        });

        it('removes the marquee overlay element and re-enables orbit controls afterwards', () => {
            const a = makeTrackedBox();
            a.position.set(0, 0, -1);

            firePointerDown(750, 550, { shiftKey: true });
            expect(orbitControls.enabled).toBe(false);
            firePointerMove(50, 50);
            firePointerUp(50, 50);

            expect(orbitControls.enabled).toBe(true);
            expect(document.body.querySelectorAll('div').length).toBe(0);
        });

        it('does not start a marquee for a shift+drag that starts on an object (handled as a shift+click instead)', () => {
            const a = makeTrackedBox();
            a.position.set(0, 0, -1);

            firePointerDown(CENTER_X, CENTER_Y, { shiftKey: true });
            expect(document.body.querySelectorAll('div').length).toBe(0); // no marquee element was ever created
            expect(orbitControls.enabled).toBe(true); // untouched — real dragging is DragControls' own concern

            firePointerUp(CENTER_X, CENTER_Y);
            expect(isSelected(a)).toBe(true); // resolves as an ordinary shift+click
        });
    });
});

describe('group drag (multi-selection moved as a rigid group)', () => {
    it('moves every selected object by the same delta', () => {
        const a = makeTrackedBox(0.2, 0.2, 0.2);
        a.position.set(0, 0.1, -1.0);
        const b = makeTrackedBox(0.2, 0.2, 0.2);
        b.position.set(0.5, 0.1, -1.0);
        addManyToSelection([a, b]);

        fire('dragstart', a);
        a.position.set(0.1, 0.1, -1.0); // primary moved +0.1 on x
        fire('drag', a);

        expect(a.position.x).toBeCloseTo(0.1);
        expect(b.position.x).toBeCloseTo(0.6); // same +0.1 delta

        fire('dragend', a);
    });

    it('excludes locked members from the move but leaves them selected', () => {
        const a = makeTrackedBox(0.2, 0.2, 0.2);
        a.position.set(0, 0.1, -1.0);
        const locked = makeTrackedBox(0.2, 0.2, 0.2);
        locked.position.set(0.5, 0.1, -1.0);
        locked.userData.locked = true;
        addManyToSelection([a, locked]);

        fire('dragstart', a);
        a.position.set(0.3, 0.1, -1.0);
        fire('drag', a);

        expect(a.position.x).toBeCloseTo(0.3);
        expect(locked.position.x).toBeCloseTo(0.5); // untouched
        expect(isSelected(locked)).toBe(true); // still selected, just not moved

        fire('dragend', a);
    });

    it('rejects the whole group\'s move for this tick if any member would collide with a non-group object', () => {
        const a = makeTrackedBox(0.2, 0.2, 0.2);
        a.position.set(0, 0.1, -1.0);
        const b = makeTrackedBox(0.2, 0.2, 0.2);
        b.position.set(0.5, 0.1, -1.0);
        addManyToSelection([a, b]);

        // An obstacle sitting right where `b` would land if the group moved +0.1 on x.
        const obstacle = makeTrackedBox(0.2, 0.2, 0.2);
        obstacle.position.set(0.6, 0.1, -1.0);

        fire('dragstart', a);
        a.position.set(0.1, 0.1, -1.0);
        fire('drag', a);

        expect(a.position.x).toBeCloseTo(0); // whole group's tick rejected, including the primary
        expect(b.position.x).toBeCloseTo(0.5);

        fire('dragend', a);
    });

    it('does not rigidly group-drag when only one member of the selection is unlocked', () => {
        const a = makeTrackedBox(0.2, 0.2, 0.2);
        a.position.set(0, 0.1, -1.0);
        const locked = makeTrackedBox(0.2, 0.2, 0.2);
        locked.position.set(0.5, 0.1, -1.0);
        locked.userData.locked = true;
        addManyToSelection([a, locked]);

        fire('dragstart', a); // only `a` is movable — falls back to a normal solo drag
        a.position.set(0.12, 0.1, -1.0);
        fire('drag', a);

        expect(a.position.x).toBeCloseTo(0.10); // ordinary grid-snap behavior applied
        fire('dragend', a);
    });

    it('applies the floor-snap to every group member on dragend', () => {
        const a = makeTrackedBox(0.6, 0.32, 0.4);
        a.position.set(0, 0.05, -1.0); // below floor height
        const b = makeTrackedBox(0.6, 0.32, 0.4);
        b.position.set(1.0, 0.05, -1.0);
        addManyToSelection([a, b]);

        fire('dragstart', a);
        fire('dragend', a);

        expect(a.position.y).toBeCloseTo(0.16);
        expect(b.position.y).toBeCloseTo(0.16);
    });
});

describe('keyboard shortcuts on a multi-selection', () => {
    it('rotates every selected object individually on "r"', () => {
        const a = makeTrackedBox();
        const b = makeTrackedBox();
        addManyToSelection([a, b]);

        keydown('r');

        expect(captureUndoPoint).toHaveBeenCalledTimes(1);
        expect(rotate90).toHaveBeenCalledWith(a, true);
        expect(rotate90).toHaveBeenCalledWith(b, true);
        expect(refreshHistoryButtons).toHaveBeenCalled();
    });

    it('rotates the whole selection even when nothing is separately hovered', () => {
        const a = makeTrackedBox();
        const b = makeTrackedBox();
        addManyToSelection([a, b]); // no fire('hoveron', ...) at all

        keydown('r');

        expect(rotate90).toHaveBeenCalledTimes(2);
    });

    it('deletes every selected object and clears the selection on Delete', () => {
        const a = makeTrackedBox();
        const b = makeTrackedBox();
        addManyToSelection([a, b]);

        keydown('Delete');

        expect(captureUndoPoint).toHaveBeenCalledTimes(1);
        expect(removeObject).toHaveBeenCalledWith(a);
        expect(removeObject).toHaveBeenCalledWith(b);
        expect(getSelected()).toEqual([]);
        expect(refreshHistoryButtons).toHaveBeenCalled();
    });

    it('rotates a single selected object the same way whether or not it is also hovered', () => {
        const mesh = makeTrackedBox();
        selectOnly(mesh);
        fire('hoveron', mesh);

        keydown('r');

        expect(rotate90).toHaveBeenCalledTimes(1);
        expect(rotate90).toHaveBeenCalledWith(mesh, true);
    });

    it('rotates/deletes a single selected object even when it is not hovered (e.g. selected via marquee, mouse moved away since)', () => {
        const mesh = makeTrackedBox();
        selectOnly(mesh); // selected, but no fire('hoveron', ...) — activeObj stays null

        keydown('r');
        expect(rotate90).toHaveBeenCalledWith(mesh, true);

        keydown('Delete');
        expect(removeObject).toHaveBeenCalledWith(mesh);
        expect(getSelected()).toEqual([]);
    });

    it('clears the selection on Escape without touching undo history', () => {
        const a = makeTrackedBox();
        const b = makeTrackedBox();
        addManyToSelection([a, b]);

        keydown('Escape');

        expect(getSelected()).toEqual([]);
        expect(captureUndoPoint).not.toHaveBeenCalled();
        expect(refreshHistoryButtons).toHaveBeenCalled();
    });

    it('does nothing on Escape when there is no selection', () => {
        keydown('Escape');
        expect(refreshHistoryButtons).not.toHaveBeenCalled();
    });
});
