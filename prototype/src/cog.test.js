import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('./scene.js', () => ({
    scene: { add: vi.fn(), remove: vi.fn() },
}));

const { vanState, objects, DEFAULT_VAN_STATE } = await import('./state.js');
const { computeCenterOfGravity, refreshCenterOfGravity, cogMarker } = await import('./cog.js');

function boxAt(x, y, z, weight, extra = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), new THREE.MeshStandardMaterial());
    mesh.position.set(x, y, z);
    mesh.userData.weight = weight;
    Object.assign(mesh.userData, extra);
    return mesh;
}

beforeEach(() => {
    objects.length = 0;
    Object.assign(vanState, DEFAULT_VAN_STATE);
    document.body.innerHTML = `
        <span id="total-weight"></span>
        <span id="cog-info"></span>
        <span id="max-payload-label"></span>
        <p id="payload-warning" class="hidden"></p>
    `;
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

    it('excludes parked objects from the weight/COG total, even though they carry a weight', () => {
        objects.push(
            boxAt(-1, 0.1, 0, 5),
            boxAt(1000, 0.1, 1000, 50, { parked: true }),
        );
        const cog = computeCenterOfGravity();
        expect(cog.x).toBeCloseTo(-1);
        expect(cog.totalWeight).toBe(5);
    });

    it('returns null when every remaining object is parked', () => {
        objects.push(boxAt(1, 0.1, 1, 20, { parked: true }));
        expect(computeCenterOfGravity()).toBeNull();
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

    it('shows the configured max payload label', () => {
        vanState.maxPayload = 650;
        refreshCenterOfGravity();
        expect(document.getElementById('max-payload-label').textContent).toBe('650');
    });
});

describe('payload / off-center warning', () => {
    it('shows no warning and no red styling under the payload limit, centered', () => {
        vanState.maxPayload = 400;
        objects.push(boxAt(0, 0.1, 0, 50));
        refreshCenterOfGravity();

        expect(document.getElementById('total-weight').classList.contains('text-red-400')).toBe(false);
        expect(document.getElementById('payload-warning').classList.contains('hidden')).toBe(true);
    });

    it('flags overload and tints the weight red when total weight exceeds maxPayload', () => {
        vanState.maxPayload = 100;
        objects.push(boxAt(0, 0.1, 0, 150));
        refreshCenterOfGravity();

        expect(document.getElementById('total-weight').classList.contains('text-red-400')).toBe(true);
        const warning = document.getElementById('payload-warning');
        expect(warning.classList.contains('hidden')).toBe(false);
        expect(warning.textContent).toMatch(/150.*100/);
    });

    it('flags an off-center load even when under the payload limit', () => {
        vanState.maxPayload = 400;
        vanState.maxWidth = 1.8; // off-center threshold = 0.25 * 1.8 = 0.45
        objects.push(boxAt(0.6, 0.1, 0, 20)); // well past the threshold
        refreshCenterOfGravity();

        expect(document.getElementById('total-weight').classList.contains('text-red-400')).toBe(false);
        expect(document.getElementById('payload-warning').classList.contains('hidden')).toBe(false);
    });

    it('does not flag off-center for a load within the threshold', () => {
        vanState.maxWidth = 1.8;
        objects.push(boxAt(0.1, 0.1, 0, 20)); // well within the threshold
        refreshCenterOfGravity();

        expect(document.getElementById('payload-warning').classList.contains('hidden')).toBe(true);
    });

    it('does not throw when the payload-warning elements are missing from the DOM', () => {
        document.body.innerHTML = '';
        objects.push(boxAt(0, 0.1, 0, 500));
        expect(() => refreshCenterOfGravity()).not.toThrow();
    });
});
