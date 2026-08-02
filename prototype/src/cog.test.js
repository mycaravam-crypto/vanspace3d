import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('./scene.js', () => ({
    scene: { add: vi.fn(), remove: vi.fn() },
}));

const { objects } = await import('./state.js');
const { computeCenterOfGravity, refreshCenterOfGravity, cogMarker } = await import('./cog.js');

function boxAt(x, y, z, weight) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), new THREE.MeshStandardMaterial());
    mesh.position.set(x, y, z);
    mesh.userData.weight = weight;
    return mesh;
}

beforeEach(() => {
    objects.length = 0;
    document.body.innerHTML = '<span id="total-weight"></span><span id="cog-info"></span>';
});

describe('computeCenterOfGravity', () => {
    it('returns null when there are no objects', () => {
        expect(computeCenterOfGravity()).toBeNull();
    });

    it('returns null when every object has zero/invalid weight', () => {
        objects.push(boxAt(1, 0.1, 1, 0), boxAt(-1, 0.1, -1, NaN));
        expect(computeCenterOfGravity()).toBeNull();
    });

    it('equals a single object\'s own position', () => {
        objects.push(boxAt(0.5, 0.1, -0.8, 10));
        const cog = computeCenterOfGravity();
        expect(cog.x).toBeCloseTo(0.5);
        expect(cog.z).toBeCloseTo(-0.8);
        expect(cog.totalWeight).toBe(10);
    });

    it('is the plain average for two equally-weighted objects', () => {
        objects.push(boxAt(-1, 0.1, 0, 5), boxAt(1, 0.1, 0, 5));
        const cog = computeCenterOfGravity();
        expect(cog.x).toBeCloseTo(0);
        expect(cog.totalWeight).toBe(10);
    });

    it('is pulled toward the heavier object', () => {
        objects.push(boxAt(-1, 0.1, 0, 1), boxAt(1, 0.1, 0, 9));
        const cog = computeCenterOfGravity();
        // Weighted average: (-1*1 + 1*9) / 10 = 0.8
        expect(cog.x).toBeCloseTo(0.8);
    });

    it('ignores objects with non-finite or non-positive weight in the sum', () => {
        objects.push(boxAt(-1, 0.1, 0, 5), boxAt(1000, 0.1, 1000, 0)); // second has zero weight
        const cog = computeCenterOfGravity();
        expect(cog.x).toBeCloseTo(-1);
        expect(cog.totalWeight).toBe(5);
    });
});

describe('refreshCenterOfGravity', () => {
    it('hides the marker and shows placeholder text when nothing is placed', () => {
        refreshCenterOfGravity();
        expect(cogMarker.visible).toBe(false);
        expect(document.getElementById('total-weight').textContent).toBe('0.0');
        expect(document.getElementById('cog-info').textContent).toBe('–');
    });

    it('shows the marker and formats the total weight to one decimal', () => {
        objects.push(boxAt(0, 0.1, 0, 7.25));
        refreshCenterOfGravity();
        expect(cogMarker.visible).toBe(true);
        expect(document.getElementById('total-weight').textContent).toBe('7.3');
    });

    it('labels rightward/rearward offsets correctly', () => {
        objects.push(boxAt(0.3, 0.1, 0.5, 10)); // +x, +z
        refreshCenterOfGravity();
        expect(document.getElementById('cog-info').textContent).toMatch(/rechts/);
        expect(document.getElementById('cog-info').textContent).toMatch(/hinten/);
    });

    it('labels leftward/forward offsets correctly', () => {
        objects.push(boxAt(-0.3, 0.1, -0.5, 10)); // -x, -z
        refreshCenterOfGravity();
        expect(document.getElementById('cog-info').textContent).toMatch(/links/);
        expect(document.getElementById('cog-info').textContent).toMatch(/vorne/);
    });

    it('does not throw when the DOM readout elements are missing', () => {
        document.body.innerHTML = '';
        objects.push(boxAt(0, 0.1, 0, 5));
        expect(() => refreshCenterOfGravity()).not.toThrow();
    });

    it('moves the marker to the computed X/Z position', () => {
        objects.push(boxAt(0.4, 0.1, -0.6, 5));
        refreshCenterOfGravity();
        expect(cogMarker.position.x).toBeCloseTo(0.4);
        expect(cogMarker.position.z).toBeCloseTo(-0.6);
    });
});
