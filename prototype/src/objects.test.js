import {
    describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import * as THREE from 'three';

// scene.js creates a real THREE.WebGLRenderer at import time, which needs a
// WebGL context jsdom doesn't provide. objects.js only ever calls
// scene.add/scene.remove, so a plain spy object is a faithful stand-in.
vi.mock('./scene.js', () => ({
    scene: { add: vi.fn(), remove: vi.fn() },
}));

const { scene } = await import('./scene.js');
const { vanState, objects } = await import('./state.js');
const { checkCollision } = await import('./collision.js');
const {
    addBox, clearAllObjects, clearUnlockedObjects, rotate90, rotateX90, resizeObject, removeObject, duplicateObject,
    toggleLock, moveVertical, moveHorizontal, flashReject, DEFAULT_WEIGHT, DEFAULT_PRICE, isXrayEnabled, setXrayEnabled,
    renameObject, isParked, parkObject, returnObjectToVan, isExplodedEnabled, setExplodedEnabled, stepExplodeAnimation,
} = await import('./objects.js');

// Fast-forwards every in-flight explode/implode tween to completion in one
// step, regardless of the real animation duration/stagger — passing a
// timestamp far past any delayMs a burst could have scheduled guarantees
// every entry's `t` clamps to 1 on this single call.
const FAR_FUTURE = () => performance.now() + 1e6;

beforeEach(() => {
    Object.assign(vanState, {
        length: 3.3, frontLength: 1.6, maxHeight: 1.9, maxWidth: 1.8, narrowWidth: 1.3, archHeight: 0.45,
    });
    objects.length = 0;
    scene.add.mockClear();
    scene.remove.mockClear();
    document.body.innerHTML = '<span id="obj-count">0</span>';
});

describe('addBox', () => {
    it('creates a mesh with the requested dimensions and adds it to the scene + objects list', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(mesh.geometry.parameters).toMatchObject({ width: 0.6, height: 0.32, depth: 0.4 });
        expect(objects).toContain(mesh);
        expect(scene.add).toHaveBeenCalledWith(mesh);
    });

    it('spawns the object near the front-top of the van, derived from vanState', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(mesh.position.x).toBeCloseTo(0);
        expect(mesh.position.y).toBeCloseTo(vanState.maxHeight - 0.32 / 2 - 0.1);
        expect(mesh.position.z).toBeCloseTo(-vanState.length / 2 + 0.4 / 2 + 0.2);
    });

    // Shrunk slightly before testing, same as collision.js's own checkCollision
    // tolerance — two boxes placed exactly face-to-face (touching, not
    // overlapping) are a valid, intentional outcome of the open-spot search
    // and shouldn't be flagged as a collision.
    const overlaps = (a, b) => {
        const boxA = new THREE.Box3().setFromCenterAndSize(a.position, new THREE.Vector3(0.6, 0.32, 0.4)).expandByScalar(-0.005);
        const boxB = new THREE.Box3().setFromCenterAndSize(b.position, new THREE.Vector3(0.6, 0.32, 0.4)).expandByScalar(-0.005);
        return boxA.intersectsBox(boxB);
    };

    it('does not spawn a new object exactly on top of an existing one at the same default spot', () => {
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        const b = addBox(0.6, 0.32, 0.4, 0x10b981);

        expect(a.position.equals(b.position)).toBe(false);
        expect(overlaps(a, b)).toBe(false);
    });

    it('finds an open spot for a third object once the default spot and its neighbor are both taken', () => {
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        const b = addBox(0.6, 0.32, 0.4, 0x10b981);
        const c = addBox(0.6, 0.32, 0.4, 0xf59e0b);

        expect(overlaps(a, b)).toBe(false);
        expect(overlaps(a, c)).toBe(false);
        expect(overlaps(b, c)).toBe(false);
    });

    it('still clamps the found spot into the van bounds', () => {
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        const b = addBox(0.6, 0.32, 0.4, 0x10b981);

        [a, b].forEach((mesh) => {
            expect(Math.abs(mesh.position.x)).toBeLessThanOrEqual(vanState.maxWidth / 2 + 1e-9);
            expect(mesh.position.y).toBeGreaterThanOrEqual(0.32 / 2 - 1e-9);
            expect(mesh.position.y).toBeLessThanOrEqual(vanState.maxHeight + 1e-9);
        });
    });

    it('attaches an edge-outline LineSegments as a child', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(mesh.children).toHaveLength(1);
        expect(mesh.children[0]).toBeInstanceOf(THREE.LineSegments);
    });

    it('updates the on-screen object count', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b);
        addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(document.getElementById('obj-count').textContent).toBe('2');
    });

    it('does not throw when the #obj-count element is missing from the DOM', () => {
        document.body.innerHTML = '';
        expect(() => addBox(0.6, 0.32, 0.4, 0x64748b)).not.toThrow();
    });

    it('accepts a hex-string color (as produced by the <input type="color"> picker)', () => {
        const mesh = addBox(0.6, 0.32, 0.4, '#10b981');
        expect(mesh.material.color.getHexString()).toBe('10b981');
    });

    it('returns the created mesh', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(mesh).toBeInstanceOf(THREE.Mesh);
        expect(mesh.isMesh).toBe(true);
    });

    it('stores the given weight on userData', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b, 12.5);
        expect(mesh.userData.weight).toBe(12.5);
    });

    it('falls back to DEFAULT_WEIGHT when no weight is given', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(mesh.userData.weight).toBe(DEFAULT_WEIGHT);
    });

    it('falls back to DEFAULT_WEIGHT for a non-positive or non-finite weight', () => {
        expect(addBox(0.6, 0.32, 0.4, 0x64748b, -5).userData.weight).toBe(DEFAULT_WEIGHT);
        expect(addBox(0.6, 0.32, 0.4, 0x64748b, NaN).userData.weight).toBe(DEFAULT_WEIGHT);
        expect(addBox(0.6, 0.32, 0.4, 0x64748b, 0).userData.weight).toBe(DEFAULT_WEIGHT);
    });

    it('defaults to DEFAULT_PRICE (0) when no price option is given', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(mesh.userData.price).toBe(DEFAULT_PRICE);
    });

    it('stores the given price on userData', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b, 5, 'Objekt', { price: 49.99 });
        expect(mesh.userData.price).toBe(49.99);
    });

    it('accepts a price of exactly 0 as legitimate, unlike weight', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b, 5, 'Objekt', { price: 0 });
        expect(mesh.userData.price).toBe(0);
    });

    it('falls back to DEFAULT_PRICE for a negative or non-finite price', () => {
        expect(addBox(0.6, 0.32, 0.4, 0x64748b, 5, 'Objekt', { price: -10 }).userData.price).toBe(DEFAULT_PRICE);
        expect(addBox(0.6, 0.32, 0.4, 0x64748b, 5, 'Objekt', { price: NaN }).userData.price).toBe(DEFAULT_PRICE);
    });

    it('gives a fixed fixture a price too, independent of its zero weight', () => {
        const mesh = addBox(0.6, 0.4, 0.3, 0x78716c, 0, 'Wassertank', { fixed: true, price: 300 });
        expect(mesh.userData.price).toBe(300);
        expect(mesh.userData.weight).toBe(0);
    });

    it('is unlocked by default', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(mesh.userData.locked).toBe(false);
    });

    it('stores the given label on userData', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b, 5, 'Werkzeugkiste');
        expect(mesh.userData.label).toBe('Werkzeugkiste');
    });

    it('trims a label with surrounding whitespace', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b, 5, '  Werkzeugkiste  ');
        expect(mesh.userData.label).toBe('Werkzeugkiste');
    });

    it('falls back to a generic "Objekt" label when none, blank, or non-string is given', () => {
        expect(addBox(0.6, 0.32, 0.4, 0x64748b).userData.label).toBe('Objekt');
        expect(addBox(0.6, 0.32, 0.4, 0x64748b, 5, '   ').userData.label).toBe('Objekt');
        expect(addBox(0.6, 0.32, 0.4, 0x64748b, 5, 42).userData.label).toBe('Objekt');
    });
});

describe('clearAllObjects', () => {
    it('removes every object from the scene and empties the objects list', () => {
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        const b = addBox(0.3, 0.2, 0.3, 0x10b981);

        clearAllObjects();

        expect(objects).toHaveLength(0);
        expect(scene.remove).toHaveBeenCalledWith(a);
        expect(scene.remove).toHaveBeenCalledWith(b);
        expect(document.getElementById('obj-count').textContent).toBe('0');
    });

    it('is a no-op (does not throw) when there is nothing to clear', () => {
        expect(() => clearAllObjects()).not.toThrow();
        expect(objects).toHaveLength(0);
    });
});

describe('removeObject', () => {
    it('removes only the given object, disposing its geometry/material', () => {
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        const b = addBox(0.3, 0.2, 0.3, 0x10b981);
        const geoDisposeSpy = vi.spyOn(a.geometry, 'dispose');
        const matDisposeSpy = vi.spyOn(a.material, 'dispose');

        expect(removeObject(a)).toBe(true);

        expect(objects).toEqual([b]);
        expect(scene.remove).toHaveBeenCalledWith(a);
        expect(geoDisposeSpy).toHaveBeenCalled();
        expect(matDisposeSpy).toHaveBeenCalled();
        expect(document.getElementById('obj-count').textContent).toBe('1');
    });

    it('returns false and does nothing for an object that is not tracked', () => {
        const stranger = addBox(0.6, 0.32, 0.4, 0x64748b);
        clearAllObjects();
        scene.remove.mockClear();

        expect(removeObject(stranger)).toBe(false);
        expect(scene.remove).not.toHaveBeenCalled();
    });

    it('refuses to remove a locked object and flashes it red instead', () => {
        vi.useFakeTimers();
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        toggleLock(mesh);

        expect(removeObject(mesh)).toBe(false);
        expect(objects).toContain(mesh);
        expect(mesh.material.emissive.getHex()).toBe(0xff0000);

        vi.advanceTimersByTime(150);
        expect(mesh.material.emissive.getHex()).toBe(0x000000);
        vi.useRealTimers();
    });
});

describe('toggleLock', () => {
    it('flips locked state and returns the new state', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(toggleLock(mesh)).toBe(true);
        expect(mesh.userData.locked).toBe(true);
        expect(toggleLock(mesh)).toBe(false);
        expect(mesh.userData.locked).toBe(false);
    });

    it('tints the edge outline red while locked, black again once unlocked', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        const edgeMaterial = mesh.children[0].material;

        toggleLock(mesh);
        expect(edgeMaterial.color.getHex()).toBe(0xef4444);

        toggleLock(mesh);
        expect(edgeMaterial.color.getHex()).toBe(0x000000);
    });

    it('returns undefined and does nothing for an untracked object', () => {
        const stranger = addBox(0.6, 0.32, 0.4, 0x64748b);
        clearAllObjects();
        expect(toggleLock(stranger)).toBeUndefined();
    });
});

describe('clearUnlockedObjects', () => {
    it('removes unlocked objects but spares locked ones', () => {
        const locked = addBox(0.6, 0.32, 0.4, 0x64748b);
        toggleLock(locked);
        const unlocked = addBox(0.3, 0.2, 0.3, 0x10b981);

        clearUnlockedObjects();

        expect(objects).toEqual([locked]);
        expect(scene.remove).toHaveBeenCalledWith(unlocked);
        expect(scene.remove).not.toHaveBeenCalledWith(locked);
        expect(document.getElementById('obj-count').textContent).toBe('1');
    });

    it('removes everything when nothing is locked', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b);
        addBox(0.3, 0.2, 0.3, 0x10b981);
        clearUnlockedObjects();
        expect(objects).toHaveLength(0);
    });

    it('is a no-op when everything is locked', () => {
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        toggleLock(a);
        clearUnlockedObjects();
        expect(objects).toEqual([a]);
    });
});

describe('moveVertical', () => {
    it('moves the object up/down by the given delta', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        mesh.position.y = 0.5;
        expect(moveVertical(mesh, 0.05, true)).toBe(true);
        expect(mesh.position.y).toBeCloseTo(0.55);
    });

    it('clamps into the van bounds instead of exiting through the roof', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        mesh.position.y = vanState.maxHeight - 0.16;
        moveVertical(mesh, 10, true); // absurd delta, should just clamp
        expect(mesh.position.y).toBeLessThanOrEqual(vanState.maxHeight);
    });

    it('rolls back and rejects when the move would collide, with snapping enabled', () => {
        vi.useFakeTimers();
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        a.position.set(0, 0.16, -1.0);
        const b = addBox(0.6, 0.32, 0.4, 0x10b981);
        b.position.set(0, 0.48, -1.0); // stacked directly above a, touching

        expect(moveVertical(a, 0.05, true)).toBe(false);
        expect(a.position.y).toBeCloseTo(0.16);
        expect(a.material.emissive.getHex()).toBe(0xff0000);
        vi.advanceTimersByTime(150);
        vi.useRealTimers();
    });

    it('allows overlapping moves when snapping is disabled', () => {
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        a.position.set(0, 0.16, -1.0);
        const b = addBox(0.6, 0.32, 0.4, 0x10b981);
        b.position.set(0, 0.48, -1.0);

        expect(moveVertical(a, 0.05, false)).toBe(true);
        expect(a.position.y).toBeCloseTo(0.21);
    });

    it('refuses to move a locked object and flashes it red instead', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        mesh.position.y = 0.5;
        toggleLock(mesh);

        expect(moveVertical(mesh, 0.05, true)).toBe(false);
        expect(mesh.position.y).toBeCloseTo(0.5);
        expect(mesh.material.emissive.getHex()).toBe(0xff0000);
    });
});

describe('moveHorizontal', () => {
    it('moves the object left/right on the x axis by the given delta', () => {
        const mesh = addBox(0.3, 0.2, 0.3, 0x64748b);
        mesh.position.set(0, 0.1, -1.0);
        expect(moveHorizontal(mesh, 'x', 0.05, true)).toBe(true);
        expect(mesh.position.x).toBeCloseTo(0.05);
    });

    it('moves the object forward/back on the z axis by the given delta', () => {
        const mesh = addBox(0.3, 0.2, 0.3, 0x64748b);
        mesh.position.set(0, 0.1, -1.0);
        expect(moveHorizontal(mesh, 'z', 0.05, true)).toBe(true);
        expect(mesh.position.z).toBeCloseTo(-0.95);
    });

    it('clamps into the van bounds instead of exiting through a wall', () => {
        const mesh = addBox(0.3, 0.2, 0.3, 0x64748b);
        mesh.position.set(0, 0.1, -1.0);
        moveHorizontal(mesh, 'x', 10, true); // absurd delta, should just clamp
        expect(mesh.position.x).toBeLessThanOrEqual(vanState.maxWidth / 2);
    });

    it('rolls back and rejects when the move would collide, with snapping enabled', () => {
        vi.useFakeTimers();
        const a = addBox(0.3, 0.2, 0.3, 0x64748b);
        a.position.set(0, 0.1, -1.0);
        const b = addBox(0.3, 0.2, 0.3, 0x10b981);
        b.position.set(0.3, 0.1, -1.0); // touching a's right face

        expect(moveHorizontal(a, 'x', 0.05, true)).toBe(false);
        expect(a.position.x).toBeCloseTo(0);
        expect(a.material.emissive.getHex()).toBe(0xff0000);
        vi.advanceTimersByTime(150);
        vi.useRealTimers();
    });

    it('allows overlapping moves when snapping is disabled', () => {
        const a = addBox(0.3, 0.2, 0.3, 0x64748b);
        a.position.set(0, 0.1, -1.0);
        const b = addBox(0.3, 0.2, 0.3, 0x10b981);
        b.position.set(0.3, 0.1, -1.0);

        expect(moveHorizontal(a, 'x', 0.05, false)).toBe(true);
        expect(a.position.x).toBeCloseTo(0.05);
    });

    it('refuses to move a locked object and flashes it red instead', () => {
        const mesh = addBox(0.3, 0.2, 0.3, 0x64748b);
        mesh.position.set(0, 0.1, -1.0);
        toggleLock(mesh);

        expect(moveHorizontal(mesh, 'x', 0.05, true)).toBe(false);
        expect(mesh.position.x).toBeCloseTo(0);
        expect(mesh.material.emissive.getHex()).toBe(0xff0000);
    });
});

describe('fixed obstacles (addBox with options.fixed)', () => {
    it('marks the object fixed and permanently locked, with zero weight regardless of the requested weight', () => {
        const mesh = addBox(0.6, 0.4, 0.3, 0x78716c, 25, 'Wassertank', { fixed: true });
        expect(mesh.userData.fixed).toBe(true);
        expect(mesh.userData.locked).toBe(true);
        expect(mesh.userData.weight).toBe(0);
    });

    it('still occupies space, so cargo placed on top of it collides', () => {
        const fixture = addBox(0.6, 0.4, 0.3, 0x78716c, 0, 'Tank', { fixed: true });
        fixture.position.set(0, 0.2, -1.0);

        const cargo = addBox(0.6, 0.4, 0.3, 0x64748b);
        cargo.position.copy(fixture.position);

        expect(checkCollision(cargo)).toBe(true);
    });

    it('defaults to fixed:false, matching the pre-existing addBox(...) call shape', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b, 5, 'Objekt');
        expect(mesh.userData.fixed).toBe(false);
        expect(mesh.userData.locked).toBe(false);
    });

    it('refuses to duplicate a fixed fixture and flashes it red instead', () => {
        const fixture = addBox(0.6, 0.4, 0.3, 0x78716c, 0, 'Tank', { fixed: true });
        const before = objects.length;

        expect(duplicateObject(fixture)).toBeNull();
        expect(objects).toHaveLength(before);
        expect(fixture.material.emissive.getHex()).toBe(0xff0000);
    });

    it('refuses to unlock a fixed fixture', () => {
        const fixture = addBox(0.6, 0.4, 0.3, 0x78716c, 0, 'Tank', { fixed: true });
        expect(toggleLock(fixture)).toBe(true); // still locked
        expect(fixture.userData.locked).toBe(true);
        expect(fixture.material.emissive.getHex()).toBe(0xff0000);
    });

    it('cannot be rotated, moved, or deleted — the existing "locked" guards already cover it', () => {
        const fixture = addBox(0.6, 0.4, 0.3, 0x78716c, 0, 'Tank', { fixed: true });
        fixture.position.set(0, 0.2, -1.0);

        expect(rotate90(fixture, true)).toBe(false);
        expect(resizeObject(fixture, 0.5, 0.5, 0.5, true)).toBe(false);
        expect(moveVertical(fixture, 0.05, true)).toBe(false);
        expect(moveHorizontal(fixture, 'x', 0.05, true)).toBe(false);
        expect(removeObject(fixture)).toBe(false);
        expect(objects).toContain(fixture);
    });

    it('is spared by clearUnlockedObjects(), same as any other locked object', () => {
        const fixture = addBox(0.6, 0.4, 0.3, 0x78716c, 0, 'Tank', { fixed: true });
        addBox(0.6, 0.32, 0.4, 0x64748b); // ordinary cargo, should be cleared

        clearUnlockedObjects();

        expect(objects).toEqual([fixture]);
    });
});

describe('flashReject', () => {
    it('does not throw for a null/undefined object', () => {
        expect(() => flashReject(null)).not.toThrow();
        expect(() => flashReject(undefined)).not.toThrow();
    });

    it('does not throw for an object without an emissive material (e.g. a stray LineSegments)', () => {
        const stray = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
        expect(() => flashReject(stray)).not.toThrow();
    });
});

describe('duplicateObject', () => {
    it('creates a second object with the same dimensions, color and weight', () => {
        const original = addBox(0.6, 0.32, 0.4, 0x64748b, 9);
        const copy = duplicateObject(original);

        expect(copy).not.toBe(original);
        expect(objects).toContain(copy);
        expect(copy.geometry.parameters).toMatchObject({ width: 0.6, height: 0.32, depth: 0.4 });
        expect(copy.material.color.getHex()).toBe(0x64748b);
        expect(copy.userData.weight).toBe(9);
    });

    it('carries the label over to the copy', () => {
        const original = addBox(0.6, 0.32, 0.4, 0x64748b, 9, 'Werkzeugkiste');
        const copy = duplicateObject(original);
        expect(copy.userData.label).toBe('Werkzeugkiste');
    });

    it('carries the price over to the copy', () => {
        const original = addBox(0.6, 0.32, 0.4, 0x64748b, 9, 'Werkzeugkiste', { price: 25.5 });
        const copy = duplicateObject(original);
        expect(copy.userData.price).toBe(25.5);
    });

    it('offsets the copy from the original instead of stacking exactly on top', () => {
        const original = addBox(0.6, 0.32, 0.4, 0x64748b);
        original.position.set(0, 0.16, -1.0);

        const copy = duplicateObject(original);

        expect(copy.position.equals(original.position)).toBe(false);
    });

    it('clamps the copy into the van bounds', () => {
        const original = addBox(0.6, 0.32, 0.4, 0x64748b);
        original.position.set(vanState.maxWidth / 2 - 0.3, 0.16, -1.0); // near the right wall

        const copy = duplicateObject(original);

        expect(Math.abs(copy.position.x)).toBeLessThanOrEqual(vanState.maxWidth / 2 + 1e-9);
    });
});

describe('rotate90', () => {
    it('swaps width and depth in place', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        rotate90(mesh, /* snapEnabled */ true);
        expect(mesh.geometry.parameters).toMatchObject({ width: 0.4, height: 0.32, depth: 0.6 });
    });

    it('rebuilds the edge outline to match the new geometry', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        rotate90(mesh, true);
        expect(mesh.children[0]).toBeInstanceOf(THREE.LineSegments);
    });

    it('rolls back geometry and position if the rotation would collide with another object', () => {
        // Two identical boxes stacked at the same spawn position: after rotating
        // the first, it would still fully overlap the second, so it must revert.
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        const b = addBox(0.6, 0.32, 0.4, 0x10b981);
        b.position.copy(a.position); // force an unmissable overlap

        const originalPos = a.position.clone();
        rotate90(a, /* snapEnabled */ true);

        expect(a.geometry.parameters).toMatchObject({ width: 0.6, height: 0.32, depth: 0.4 });
        expect(a.position.equals(originalPos)).toBe(true);
    });

    it('does not roll back on collision when snapping/collision checking is disabled', () => {
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        const b = addBox(0.6, 0.32, 0.4, 0x10b981);
        b.position.copy(a.position);

        rotate90(a, /* snapEnabled */ false);

        expect(a.geometry.parameters).toMatchObject({ width: 0.4, height: 0.32, depth: 0.6 });
    });

    it('flashes emissive red and restores the original color after a rollback', () => {
        vi.useFakeTimers();
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        const b = addBox(0.6, 0.32, 0.4, 0x10b981);
        b.position.copy(a.position);

        rotate90(a, true);
        expect(a.material.emissive.getHex()).toBe(0xff0000);

        vi.advanceTimersByTime(150);
        expect(a.material.emissive.getHex()).toBe(0x000000);
        vi.useRealTimers();
    });

    it('disposes the previous geometry and edge outline instead of leaking on rotation', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        const oldGeo = mesh.geometry;
        const oldEdges = mesh.children[0].geometry;
        const geoDisposeSpy = vi.spyOn(oldGeo, 'dispose');
        const edgesDisposeSpy = vi.spyOn(oldEdges, 'dispose');

        rotate90(mesh, true);

        expect(geoDisposeSpy).toHaveBeenCalled();
        expect(edgesDisposeSpy).toHaveBeenCalled();
        expect(mesh.geometry).not.toBe(oldGeo);
    });

    it('returns to the original dimensions after four rotations', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        rotate90(mesh, true);
        rotate90(mesh, true);
        rotate90(mesh, true);
        rotate90(mesh, true);
        expect(mesh.geometry.parameters).toMatchObject({ width: 0.6, height: 0.32, depth: 0.4 });
    });

    it('refuses to rotate a locked object and flashes it red instead', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        toggleLock(mesh);
        const geoDisposeSpy = vi.spyOn(mesh.geometry, 'dispose');

        expect(rotate90(mesh, true)).toBe(false);

        expect(mesh.geometry.parameters).toMatchObject({ width: 0.6, height: 0.32, depth: 0.4 });
        expect(geoDisposeSpy).not.toHaveBeenCalled();
        expect(mesh.material.emissive.getHex()).toBe(0xff0000);
    });

    it('does not touch the material if the object was removed before the rollback timeout fires', () => {
        vi.useFakeTimers();
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        const b = addBox(0.6, 0.32, 0.4, 0x10b981);
        b.position.copy(a.position);

        rotate90(a, true);
        clearAllObjects(); // simulates "Alle entfernen" firing before the timeout

        expect(() => vi.advanceTimersByTime(150)).not.toThrow();
        vi.useRealTimers();
    });
});

describe('rotateX90', () => {
    it('swaps height and depth in place, width unchanged', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        rotateX90(mesh, /* snapEnabled */ true);
        expect(mesh.geometry.parameters).toMatchObject({ width: 0.6, height: 0.4, depth: 0.32 });
    });

    it('rolls back geometry and position if the rotation would collide with another object', () => {
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        const b = addBox(0.6, 0.32, 0.4, 0x10b981);
        b.position.copy(a.position);

        const originalPos = a.position.clone();
        rotateX90(a, /* snapEnabled */ true);

        expect(a.geometry.parameters).toMatchObject({ width: 0.6, height: 0.32, depth: 0.4 });
        expect(a.position.equals(originalPos)).toBe(true);
    });

    it('returns to the original dimensions after four rotations', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        rotateX90(mesh, true);
        rotateX90(mesh, true);
        rotateX90(mesh, true);
        rotateX90(mesh, true);
        expect(mesh.geometry.parameters).toMatchObject({ width: 0.6, height: 0.32, depth: 0.4 });
    });

    it('refuses to rotate a locked object and flashes it red instead', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        toggleLock(mesh);
        const geoDisposeSpy = vi.spyOn(mesh.geometry, 'dispose');

        expect(rotateX90(mesh, true)).toBe(false);

        expect(mesh.geometry.parameters).toMatchObject({ width: 0.6, height: 0.32, depth: 0.4 });
        expect(geoDisposeSpy).not.toHaveBeenCalled();
        expect(mesh.material.emissive.getHex()).toBe(0xff0000);
    });
});

describe('resizeObject', () => {
    it('changes width/height/depth in place', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(resizeObject(mesh, 0.5, 0.6, 0.3, /* snapEnabled */ true)).toBe(true);
        expect(mesh.geometry.parameters).toMatchObject({ width: 0.5, height: 0.6, depth: 0.3 });
    });

    it('rebuilds the edge outline to match the new geometry', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        resizeObject(mesh, 0.5, 0.6, 0.3, true);
        expect(mesh.children[0]).toBeInstanceOf(THREE.LineSegments);
    });

    it('keeps the object centered at its current position', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        mesh.position.set(0, 0.16, -1.0);
        resizeObject(mesh, 0.5, 0.6, 0.3, true);
        expect(mesh.position.x).toBeCloseTo(0);
        expect(mesh.position.z).toBeCloseTo(-1.0);
    });

    it('rolls back geometry and position if the resize would collide with another object', () => {
        const a = addBox(0.4, 0.32, 0.4, 0x64748b);
        const b = addBox(0.4, 0.32, 0.4, 0x10b981);
        b.position.set(a.position.x + 0.4, a.position.y, a.position.z); // just clear of a at its original width

        const originalPos = a.position.clone();
        resizeObject(a, 1.0, 0.32, 0.4, /* snapEnabled */ true); // growing into b

        expect(a.geometry.parameters).toMatchObject({ width: 0.4, height: 0.32, depth: 0.4 });
        expect(a.position.equals(originalPos)).toBe(true);
    });

    it('does not roll back on collision when snapping/collision checking is disabled', () => {
        const a = addBox(0.4, 0.32, 0.4, 0x64748b);
        const b = addBox(0.4, 0.32, 0.4, 0x10b981);
        b.position.set(a.position.x + 0.4, a.position.y, a.position.z);

        resizeObject(a, 1.0, 0.32, 0.4, /* snapEnabled */ false);

        expect(a.geometry.parameters).toMatchObject({ width: 1.0, height: 0.32, depth: 0.4 });
    });

    it('flashes emissive red and restores the original color after a rollback', () => {
        vi.useFakeTimers();
        const a = addBox(0.4, 0.32, 0.4, 0x64748b);
        const b = addBox(0.4, 0.32, 0.4, 0x10b981);
        b.position.set(a.position.x + 0.4, a.position.y, a.position.z);

        resizeObject(a, 1.0, 0.32, 0.4, true);
        expect(a.material.emissive.getHex()).toBe(0xff0000);

        vi.advanceTimersByTime(150);
        expect(a.material.emissive.getHex()).toBe(0x000000);
        vi.useRealTimers();
    });

    it('disposes the previous geometry and edge outline instead of leaking on resize', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        const oldGeo = mesh.geometry;
        const oldEdges = mesh.children[0].geometry;
        const geoDisposeSpy = vi.spyOn(oldGeo, 'dispose');
        const edgesDisposeSpy = vi.spyOn(oldEdges, 'dispose');

        resizeObject(mesh, 0.5, 0.6, 0.3, true);

        expect(geoDisposeSpy).toHaveBeenCalled();
        expect(edgesDisposeSpy).toHaveBeenCalled();
        expect(mesh.geometry).not.toBe(oldGeo);
    });

    it('refuses to resize a locked object and flashes it red instead', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        toggleLock(mesh);
        const geoDisposeSpy = vi.spyOn(mesh.geometry, 'dispose');

        expect(resizeObject(mesh, 0.5, 0.6, 0.3, true)).toBe(false);

        expect(mesh.geometry.parameters).toMatchObject({ width: 0.6, height: 0.32, depth: 0.4 });
        expect(geoDisposeSpy).not.toHaveBeenCalled();
        expect(mesh.material.emissive.getHex()).toBe(0xff0000);
    });

    it('rejects non-finite or non-positive dimensions without mutating the object', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        const geoDisposeSpy = vi.spyOn(mesh.geometry, 'dispose');

        expect(resizeObject(mesh, 0, 0.6, 0.3, true)).toBe(false);
        expect(resizeObject(mesh, NaN, 0.6, 0.3, true)).toBe(false);
        expect(resizeObject(mesh, -1, 0.6, 0.3, true)).toBe(false);

        expect(mesh.geometry.parameters).toMatchObject({ width: 0.6, height: 0.32, depth: 0.4 });
        expect(geoDisposeSpy).not.toHaveBeenCalled();
    });

    it('clamps the object back into the van bounds if the new size no longer fits at its current position', () => {
        const mesh = addBox(0.4, 0.32, 0.4, 0x64748b);
        mesh.position.set(vanState.maxWidth / 2 - 0.2, 0.16, -1.0); // near the right wall

        resizeObject(mesh, 1.5, 0.32, 0.4, true);

        expect(Math.abs(mesh.position.x)).toBeLessThanOrEqual(vanState.maxWidth / 2 + 1e-9);
    });

    it('returns false for an object that is not tracked', () => {
        const stray = addBox(0.5, 0.5, 0.5, 0x64748b);
        clearAllObjects(); // detaches stray without disposing our spy expectations
        expect(resizeObject(stray, 0.6, 0.6, 0.6, true)).toBe(false);
    });
});

describe('x-ray view', () => {
    afterEach(() => setXrayEnabled(false)); // module-level flag — leave it as the app's own default

    it('starts disabled, with objects fully opaque', () => {
        expect(isXrayEnabled()).toBe(false);
        const mesh = addBox(0.5, 0.5, 0.5, 0x64748b);
        expect(mesh.material.transparent).toBe(false);
        expect(mesh.material.opacity).toBe(1);
    });

    it('makes every currently tracked object translucent, without touching its edge outline', () => {
        const a = addBox(0.5, 0.5, 0.5, 0x64748b);
        const b = addBox(0.4, 0.4, 0.4, 0x64748b);
        const edgeColorBefore = a.children[0].material.opacity;

        setXrayEnabled(true);

        expect(isXrayEnabled()).toBe(true);
        [a, b].forEach((obj) => {
            expect(obj.material.transparent).toBe(true);
            expect(obj.material.opacity).toBeLessThan(1);
            expect(obj.material.depthWrite).toBe(false);
        });
        expect(a.children[0].material.opacity).toBe(edgeColorBefore); // edges untouched
    });

    it('restores full opacity when turned back off', () => {
        const mesh = addBox(0.5, 0.5, 0.5, 0x64748b);
        setXrayEnabled(true);
        setXrayEnabled(false);

        expect(mesh.material.transparent).toBe(false);
        expect(mesh.material.opacity).toBe(1);
        expect(mesh.material.depthWrite).toBe(true);
    });

    it('applies the current x-ray state to objects created afterward', () => {
        setXrayEnabled(true);
        const mesh = addBox(0.5, 0.5, 0.5, 0x64748b);
        expect(mesh.material.transparent).toBe(true);
        expect(mesh.material.opacity).toBeLessThan(1);
    });
});

describe('explode view', () => {
    afterEach(() => setExplodedEnabled(false)); // module-level flag — leave it as the app's own default

    it('starts disabled, leaving objects at their placed position', () => {
        expect(isExplodedEnabled()).toBe(false);
        const mesh = addBox(0.5, 0.3, 0.5, 0x64748b);
        expect(mesh.userData.explodeOffset).toBeUndefined();
    });

    it('animates the push over time rather than snapping instantly', () => {
        const mesh = addBox(0.5, 0.3, 0.5, 0x64748b);
        mesh.position.set(0.5, 0.15, 1.0);
        const before = mesh.position.clone();

        setExplodedEnabled(true);
        expect(mesh.position.equals(before)).toBe(true); // hasn't moved yet — no animation frame has run

        stepExplodeAnimation(FAR_FUTURE());
        expect(mesh.position.equals(before)).toBe(false);
    });

    it('pushes every currently tracked object outward from the van origin, by the fixed explode distance, once the animation lands', () => {
        const a = addBox(0.5, 0.3, 0.5, 0x64748b);
        a.position.set(0.5, 0.15, 1.0);
        const before = a.position.clone();

        setExplodedEnabled(true);
        stepExplodeAnimation(FAR_FUTURE());

        expect(isExplodedEnabled()).toBe(true);
        expect(a.position.equals(before)).toBe(false);
        expect(a.position.distanceTo(before)).toBeCloseTo(0.5); // EXPLODE_DISTANCE
    });

    it('restores the exact original position when turned back off', () => {
        const mesh = addBox(0.5, 0.3, 0.5, 0x64748b);
        mesh.position.set(0.4, 0.2, -1.0);
        const before = mesh.position.clone();

        setExplodedEnabled(true);
        stepExplodeAnimation(FAR_FUTURE());
        setExplodedEnabled(false);
        stepExplodeAnimation(FAR_FUTURE());

        expect(mesh.position.x).toBeCloseTo(before.x);
        expect(mesh.position.y).toBeCloseTo(before.y);
        expect(mesh.position.z).toBeCloseTo(before.z);
        expect(mesh.userData.explodeOffset).toBeUndefined();
    });

    it('never pushes an object below its own resting height, even dead-center over the van origin', () => {
        const mesh = addBox(0.3, 0.2, 0.3, 0x64748b);
        mesh.position.set(0, 0.1, 0); // exactly on the van's centerline, low to the floor

        setExplodedEnabled(true);
        stepExplodeAnimation(FAR_FUTURE());

        expect(mesh.position.y).toBeGreaterThanOrEqual(0.1);
    });

    it('applies the current explode state to objects created afterward', () => {
        setExplodedEnabled(true);
        const mesh = addBox(0.5, 0.3, 0.5, 0x64748b);
        // The offset/target is committed synchronously at spawn time even
        // though the visual animation is still deferred to the next frame.
        expect(mesh.userData.explodeOffset).toBeInstanceOf(THREE.Vector3);
    });

    it('skips parked objects', () => {
        const mesh = addBox(0.5, 0.3, 0.5, 0x64748b);
        parkObject(mesh);
        const parkedPos = mesh.position.clone();

        setExplodedEnabled(true);
        stepExplodeAnimation(FAR_FUTURE());

        expect(mesh.position.equals(parkedPos)).toBe(true);
        expect(mesh.userData.explodeOffset).toBeUndefined();
    });

    it('blocks moveVertical/moveHorizontal while active, flashing reject instead', () => {
        const mesh = addBox(0.5, 0.3, 0.5, 0x64748b);
        setExplodedEnabled(true);
        const before = mesh.position.clone();

        expect(moveVertical(mesh, 0.05, true)).toBe(false);
        expect(moveHorizontal(mesh, 'x', 0.05, true)).toBe(false);
        expect(mesh.position.equals(before)).toBe(true);
    });

    it('blocks resizeObject while active', () => {
        const mesh = addBox(0.5, 0.3, 0.5, 0x64748b);
        setExplodedEnabled(true);

        expect(resizeObject(mesh, 0.6, 0.4, 0.6, true)).toBe(false);
        expect(mesh.geometry.parameters).toMatchObject({ width: 0.5, height: 0.3, depth: 0.5 });
    });

    it('blocks rotate90/rotateX90 while active', () => {
        const mesh = addBox(0.5, 0.3, 0.6, 0x64748b);
        setExplodedEnabled(true);

        expect(rotate90(mesh, true)).toBe(false);
        expect(rotateX90(mesh, true)).toBe(false);
        expect(mesh.geometry.parameters).toMatchObject({ width: 0.5, height: 0.3, depth: 0.6 });
    });

    it('duplicates near the original\'s true (non-exploded) position even mid-animation, exploding the copy too', () => {
        const mesh = addBox(0.4, 0.3, 0.4, 0x64748b);
        mesh.position.set(0.3, 0.15, -0.5);
        const truePos = mesh.position.clone();
        setExplodedEnabled(true); // animation scheduled but not yet stepped — mesh.position is still truePos

        const copy = duplicateObject(mesh);
        stepExplodeAnimation(FAR_FUTURE());

        expect(copy.userData.explodeOffset).toBeInstanceOf(THREE.Vector3);
        const copyTruePos = copy.position.clone().sub(copy.userData.explodeOffset);
        expect(copyTruePos.x).toBeCloseTo(truePos.x + 0.1);
        expect(copyTruePos.z).toBeCloseTo(truePos.z + 0.1);
    });

    it('parking clears the offset; returning re-applies it if explode is still active', () => {
        const mesh = addBox(0.4, 0.3, 0.4, 0x64748b);
        mesh.position.set(0.3, 0.15, -0.5);
        setExplodedEnabled(true);
        expect(mesh.userData.explodeOffset).toBeInstanceOf(THREE.Vector3);

        parkObject(mesh);
        expect(mesh.userData.explodeOffset).toBeUndefined();

        returnObjectToVan(mesh);
        expect(mesh.userData.explodeOffset).toBeInstanceOf(THREE.Vector3);
    });
});

describe('parkObject / returnObjectToVan', () => {
    it('is unparked by default', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(isParked(mesh)).toBe(false);
    });

    it('marks the object parked and moves it outside the van bounds', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(parkObject(mesh)).toBe(true);
        expect(isParked(mesh)).toBe(true);
        expect(mesh.position.x).toBeGreaterThan(vanState.maxWidth / 2);
    });

    it('tints the edge outline amber while parked', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        parkObject(mesh);
        expect(mesh.children[0].material.color.getHex()).toBe(0xf59e0b);
    });

    it('spaces out multiple parked objects instead of stacking them on the same slot', () => {
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        const b = addBox(0.6, 0.32, 0.4, 0x10b981);
        parkObject(a);
        parkObject(b);
        expect(a.position.equals(b.position)).toBe(false);
    });

    it('is exempt from collision checks once parked, even overlapping another parked object', () => {
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        const b = addBox(0.6, 0.32, 0.4, 0x10b981);
        parkObject(a);
        parkObject(b);
        b.position.copy(a.position); // force an overlap
        expect(checkCollision(a)).toBe(false);
        expect(checkCollision(b)).toBe(false);
    });

    it('is exempt from clampToVan once parked, so moving it further away is not pulled back', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        parkObject(mesh);
        const farOut = mesh.position.x + 5;
        moveHorizontal(mesh, 'x', 5, true);
        expect(mesh.position.x).toBeCloseTo(farOut);
    });

    it('refuses to park a locked object and flashes it red instead', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        toggleLock(mesh);
        expect(parkObject(mesh)).toBe(false);
        expect(isParked(mesh)).toBe(false);
        expect(mesh.material.emissive.getHex()).toBe(0xff0000);
    });

    it('refuses to park a fixed fixture and flashes it red instead', () => {
        const fixture = addBox(0.6, 0.4, 0.3, 0x78716c, 0, 'Tank', { fixed: true });
        expect(parkObject(fixture)).toBe(false);
        expect(isParked(fixture)).toBe(false);
        expect(fixture.material.emissive.getHex()).toBe(0xff0000);
    });

    it('is a no-op when already parked', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        parkObject(mesh);
        const pos = mesh.position.clone();
        expect(parkObject(mesh)).toBe(false);
        expect(mesh.position.equals(pos)).toBe(true);
    });

    it('returns false for an object that is not tracked', () => {
        const stray = addBox(0.6, 0.32, 0.4, 0x64748b);
        clearAllObjects();
        expect(parkObject(stray)).toBe(false);
    });

    it('brings a parked object back into the van, clearing the parked flag', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        parkObject(mesh);

        expect(returnObjectToVan(mesh)).toBe(true);
        expect(isParked(mesh)).toBe(false);
        expect(Math.abs(mesh.position.x)).toBeLessThanOrEqual(vanState.maxWidth / 2 + 1e-9);
    });

    it('restores the default (black) edge outline once back in the van', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        parkObject(mesh);
        returnObjectToVan(mesh);
        expect(mesh.children[0].material.color.getHex()).toBe(0x000000);
    });

    it('finds an open spot if the default spawn point is occupied on return', () => {
        const occupant = addBox(0.6, 0.32, 0.4, 0x10b981); // sits at the default spawn spot
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        parkObject(mesh);

        returnObjectToVan(mesh);

        expect(checkCollision(mesh)).toBe(false);
        expect(mesh.position.equals(occupant.position)).toBe(false);
    });

    it('is a no-op (returns false) for an object that is not parked', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        const pos = mesh.position.clone();
        expect(returnObjectToVan(mesh)).toBe(false);
        expect(mesh.position.equals(pos)).toBe(true);
    });

    it('refuses to return a locked (but parked) object and flashes it red instead', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        parkObject(mesh);
        toggleLock(mesh);

        expect(returnObjectToVan(mesh)).toBe(false);
        expect(isParked(mesh)).toBe(true);
        expect(mesh.material.emissive.getHex()).toBe(0xff0000);
    });
});

describe('renameObject', () => {
    it('trims and applies a new label', () => {
        const mesh = addBox(0.5, 0.5, 0.5, 0x64748b, DEFAULT_WEIGHT, 'Kiste');
        expect(renameObject(mesh, '  Werkzeugkiste  ')).toBe(true);
        expect(mesh.userData.label).toBe('Werkzeugkiste');
    });

    it('rejects an empty/whitespace-only name, leaving the existing label untouched', () => {
        const mesh = addBox(0.5, 0.5, 0.5, 0x64748b, DEFAULT_WEIGHT, 'Kiste');
        expect(renameObject(mesh, '   ')).toBe(false);
        expect(renameObject(mesh, '')).toBe(false);
        expect(mesh.userData.label).toBe('Kiste');
    });

    it('caps the label length at 60 characters', () => {
        const mesh = addBox(0.5, 0.5, 0.5, 0x64748b);
        const longName = 'x'.repeat(100);
        renameObject(mesh, longName);
        expect(mesh.userData.label).toHaveLength(60);
    });

    it('works on a locked object, unlike every other mutator', () => {
        const mesh = addBox(0.5, 0.5, 0.5, 0x64748b);
        toggleLock(mesh);
        expect(renameObject(mesh, 'Neuer Name')).toBe(true);
        expect(mesh.userData.label).toBe('Neuer Name');
    });

    it('works on a fixed fixture', () => {
        const mesh = addBox(0.5, 0.5, 0.5, 0x64748b, 0, 'Bett', { fixed: true });
        expect(renameObject(mesh, 'Bett (Doppel)')).toBe(true);
        expect(mesh.userData.label).toBe('Bett (Doppel)');
    });

    it('returns false for an object that is not tracked', () => {
        const stray = addBox(0.5, 0.5, 0.5, 0x64748b);
        clearAllObjects();
        expect(renameObject(stray, 'Neu')).toBe(false);
    });
});
