import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('./scene.js', () => ({
    scene: { add: vi.fn(), remove: vi.fn() },
}));

const { vanState, objects } = await import('./state.js');
const { vanGroup, buildVanGeometry } = await import('./van.js');

beforeEach(() => {
    Object.assign(vanState, {
        length: 3.3, frontLength: 1.6, maxHeight: 1.9, maxWidth: 1.8, narrowWidth: 1.3, archHeight: 0.45,
    });
    objects.length = 0;
});

describe('buildVanGeometry', () => {
    it('builds front zone, rear zones, floor and wheel arches for the default van', () => {
        buildVanGeometry();
        // frontBox + frontFloor + rearLower + rearUpper + rearFloor + 2 arches
        expect(vanGroup.children).toHaveLength(7);
    });

    it('omits the front zone entirely when frontLength is 0', () => {
        vanState.frontLength = 0;
        buildVanGeometry();
        // rearLower + rearUpper + rearFloor + 2 arches, no front pieces
        expect(vanGroup.children).toHaveLength(5);
    });

    it('omits the rear zone entirely when frontLength equals the full length', () => {
        vanState.frontLength = vanState.length;
        buildVanGeometry();
        // frontBox + frontFloor only
        expect(vanGroup.children).toHaveLength(2);
    });

    it('omits the wheel arches when narrowWidth equals maxWidth', () => {
        vanState.narrowWidth = vanState.maxWidth;
        buildVanGeometry();
        // frontBox + frontFloor + rearLower + rearUpper + rearFloor, no arches
        expect(vanGroup.children).toHaveLength(5);
    });

    it('disposes previous geometry/material instead of leaking on rebuild', () => {
        buildVanGeometry();
        const firstChild = vanGroup.children[0];
        const disposeSpy = vi.spyOn(firstChild.geometry, 'dispose');

        buildVanGeometry();

        expect(disposeSpy).toHaveBeenCalled();
        expect(vanGroup.children).not.toContain(firstChild);
    });

    it('treats a frontLength at/below the 0.01 threshold as "no front zone"', () => {
        vanState.frontLength = 0.005; // below the > 0.01 guard in buildVanGeometry
        buildVanGeometry();
        // rearLower + rearUpper + rearFloor + 2 arches, no front pieces
        expect(vanGroup.children).toHaveLength(5);
    });

    it('treats a rearLength at/below the 0.01 threshold as "no rear zone"', () => {
        vanState.frontLength = vanState.length - 0.005; // rearLength ~0.005, below the guard
        buildVanGeometry();
        // frontBox + frontFloor only
        expect(vanGroup.children).toHaveLength(2);
    });

    it('omits the wheel arches when narrowWidth is within 0.01 of maxWidth', () => {
        vanState.narrowWidth = vanState.maxWidth - 0.019; // archWidth = 0.0095, below the guard
        buildVanGeometry();
        expect(vanGroup.children).toHaveLength(5); // no arches
    });

    it('sizes the front zone box from maxWidth/maxHeight/frontLength', () => {
        buildVanGeometry();
        const frontBox = vanGroup.children[0];
        expect(frontBox.geometry.parameters).toMatchObject({
            width: vanState.maxWidth,
            height: vanState.maxHeight,
            depth: vanState.frontLength,
        });
    });

    it('sizes the rear-upper zone height as maxHeight minus archHeight', () => {
        buildVanGeometry();
        // Order of insertion: frontBox, frontFloor, rearLower, rearUpper, ...
        const rearUpper = vanGroup.children[3];
        expect(rearUpper.geometry.parameters.height).toBeCloseTo(vanState.maxHeight - vanState.archHeight);
        expect(rearUpper.position.y).toBeCloseTo(vanState.archHeight + (vanState.maxHeight - vanState.archHeight) / 2);
    });

    it('re-clamps existing placed objects into the rebuilt van bounds', () => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.4), new THREE.MeshStandardMaterial());
        mesh.position.set(0, 0.1, 0); // valid for the current (wide) van
        objects.push(mesh);

        // Shrink the van drastically so the object's old position no longer fits.
        vanState.maxWidth = 0.6;
        vanState.narrowWidth = 0.5;
        buildVanGeometry();

        expect(Math.abs(mesh.position.x)).toBeLessThanOrEqual(vanState.maxWidth / 2 - 0.5 / 2 + 1e-9);
    });

    it('refreshes the weight/COG readouts, since maxWidth/maxPayload changes affect their warnings too', () => {
        document.body.innerHTML = '<span id="total-weight"></span><span id="cog-info"></span>';
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.4), new THREE.MeshStandardMaterial());
        mesh.position.set(0, 0.1, 0);
        mesh.userData.weight = 12.5;
        objects.push(mesh);

        buildVanGeometry();

        expect(document.getElementById('total-weight').textContent).toBe('12.5');
    });
});
