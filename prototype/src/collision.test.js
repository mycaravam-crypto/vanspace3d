import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { vanState, objects } from './state.js';
import { clampToVan, checkCollision } from './collision.js';

function makeBox(w, h, d) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
}

beforeEach(() => {
    Object.assign(vanState, {
        length: 3.3, frontLength: 1.6, maxHeight: 1.9, maxWidth: 1.8, narrowWidth: 1.3, archHeight: 0.45,
    });
    objects.length = 0;
});

describe('clampToVan', () => {
    it('keeps a centered object within the front (full-width) bounds unchanged', () => {
        const box = makeBox(0.6, 0.32, 0.4);
        const pos = new THREE.Vector3(0, 0.16, -1.0); // well inside the front zone
        clampToVan(box, pos);
        expect(pos.x).toBeCloseTo(0);
        expect(pos.z).toBeCloseTo(-1.0);
    });

    it('clamps x to the max-width half-extent in the front zone', () => {
        const box = makeBox(0.6, 0.32, 0.4);
        const pos = new THREE.Vector3(10, 0.16, -1.0); // way outside on the right
        clampToVan(box, pos);
        expect(pos.x).toBeCloseTo(vanState.maxWidth / 2 - 0.6 / 2);
    });

    it('clamps y so the object never sinks below the floor', () => {
        const box = makeBox(0.6, 0.32, 0.4);
        const pos = new THREE.Vector3(0, -5, -1.0);
        clampToVan(box, pos);
        expect(pos.y).toBeCloseTo(0.32 / 2);
    });

    it('clamps z to the van length half-extent', () => {
        const box = makeBox(0.6, 0.32, 0.4);
        const pos = new THREE.Vector3(0, 0.16, 100);
        clampToVan(box, pos);
        expect(pos.z).toBeCloseTo(vanState.length / 2 - 0.4 / 2);
    });

    it('restricts x to the narrow width when low in the rear (wheel-arch) section', () => {
        const box = makeBox(0.5, 0.2, 0.4); // narrow enough to fit (0.5 < narrowWidth 1.3)
        // Rear section starts at -length/2 + frontLength = -1.65 + 1.6 = -0.05
        const pos = new THREE.Vector3(10, 0.1, 0.5); // low object, deep in the rear
        clampToVan(box, pos);
        expect(pos.x).toBeCloseTo(vanState.narrowWidth / 2 - 0.5 / 2);
    });

    it('pushes an object too wide for the narrow section up above the arch height', () => {
        // Wider than narrowWidth (1.3) so it cannot sit in the low rear section.
        const box = makeBox(1.6, 0.2, 0.4);
        const pos = new THREE.Vector3(0, 0.1, 0.5); // low, in the rear
        clampToVan(box, pos);
        expect(pos.y).toBeGreaterThanOrEqual(vanState.archHeight + 0.2 / 2 - 1e-9);
        // Once pushed up, it's allowed to use the full width again.
        expect(pos.x).toBeCloseTo(0);
    });

    it('allows full width for an object high above the arch in the rear', () => {
        const box = makeBox(1.6, 0.2, 0.4);
        const pos = new THREE.Vector3(10, 1.0, 0.5); // above archHeight already
        clampToVan(box, pos);
        expect(pos.x).toBeCloseTo(vanState.maxWidth / 2 - 1.6 / 2);
    });

    it('still applies full-width rules right at the front/rear split line', () => {
        // zSplitLine = -length/2 + frontLength = -1.65 + 1.6 = -0.05.
        // objRear must exceed zSplitLine + 0.01 to count as "in the rear" —
        // an object whose back face sits exactly on the line stays full-width.
        const box = makeBox(1.6, 0.2, 0.4); // too wide for the narrow rear section
        const pos = new THREE.Vector3(10, 0.1, -0.25); // objRear = -0.25 + 0.2 = -0.05
        clampToVan(box, pos);
        expect(pos.x).toBeCloseTo(vanState.maxWidth / 2 - 1.6 / 2);
        expect(pos.y).toBeCloseTo(0.1); // not pushed up, front-zone height rules apply
    });

    it('keeps an object taller than the van pinned to floor height (degenerate case)', () => {
        const box = makeBox(0.6, 3.0, 0.4); // taller than maxHeight (1.9)
        const pos = new THREE.Vector3(0, 50, -1.0);
        clampToVan(box, pos);
        expect(pos.y).toBeCloseTo(3.0 / 2);
    });
});

describe('checkCollision', () => {
    it('returns false when the object list only contains itself', () => {
        const box = makeBox(0.6, 0.32, 0.4);
        box.position.set(0, 0.16, 0);
        objects.push(box);
        expect(checkCollision(box)).toBe(false);
    });

    it('returns true for two overlapping boxes', () => {
        const a = makeBox(0.6, 0.32, 0.4);
        a.position.set(0, 0.16, 0);
        const b = makeBox(0.6, 0.32, 0.4);
        b.position.set(0.1, 0.16, 0); // heavily overlapping with a
        objects.push(a, b);
        expect(checkCollision(a)).toBe(true);
        expect(checkCollision(b)).toBe(true);
    });

    it('returns false for two well-separated boxes', () => {
        const a = makeBox(0.6, 0.32, 0.4);
        a.position.set(-1, 0.16, 0);
        const b = makeBox(0.6, 0.32, 0.4);
        b.position.set(1, 0.16, 0);
        objects.push(a, b);
        expect(checkCollision(a)).toBe(false);
        expect(checkCollision(b)).toBe(false);
    });

    it('treats boxes only touching at the boundary as non-colliding (tolerance)', () => {
        const a = makeBox(0.6, 0.32, 0.4);
        a.position.set(0, 0.16, 0);
        const b = makeBox(0.6, 0.32, 0.4);
        b.position.set(0.6, 0.16, 0); // edges exactly touching
        objects.push(a, b);
        expect(checkCollision(a)).toBe(false);
    });

    it('reports collision only against the one overlapping neighbor among several', () => {
        const a = makeBox(0.6, 0.32, 0.4);
        a.position.set(0, 0.16, 0);
        const overlapping = makeBox(0.6, 0.32, 0.4);
        overlapping.position.set(0.1, 0.16, 0);
        const farAway1 = makeBox(0.6, 0.32, 0.4);
        farAway1.position.set(5, 0.16, 0);
        const farAway2 = makeBox(0.6, 0.32, 0.4);
        farAway2.position.set(-5, 0.16, 0);
        objects.push(a, overlapping, farAway1, farAway2);

        expect(checkCollision(a)).toBe(true);
        expect(checkCollision(farAway1)).toBe(false);
        expect(checkCollision(farAway2)).toBe(false);
    });

    it('returns false for an object that is not part of the tracked list at all', () => {
        const a = makeBox(0.6, 0.32, 0.4);
        a.position.set(0, 0.16, 0);
        // objects list intentionally left empty — nothing to collide against.
        expect(checkCollision(a)).toBe(false);
    });
});
