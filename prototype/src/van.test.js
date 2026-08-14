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
        wheelWidth: 0.25, wheelHeight: 0.45, wheelLength: 0.99,
    });
    objects.length = 0;
});

describe('buildVanGeometry', () => {
    it('builds front zone, rear zones, floor and wheel arches for the default van', () => {
        buildVanGeometry();
        // frontBox + frontFloor + rearLower + upperZone + rearFloor + 2 arches
        expect(vanGroup.children).toHaveLength(7);
    });

    it('omits the front zone entirely when frontLength is 0', () => {
        vanState.frontLength = 0;
        buildVanGeometry();
        // rearLower + upperZone + rearFloor + 2 arches, no front pieces
        expect(vanGroup.children).toHaveLength(5);
    });

    it('omits the rear zone entirely when frontLength equals the full length', () => {
        vanState.frontLength = vanState.length;
        buildVanGeometry();
        // frontBox + frontFloor only
        expect(vanGroup.children).toHaveLength(2);
    });

    it('omits the wheel arches when wheelWidth is 0', () => {
        vanState.wheelWidth = 0;
        buildVanGeometry();
        // frontBox + frontFloor + rearLower + upperZone + rearFloor, no arches
        expect(vanGroup.children).toHaveLength(5);
    });

    it('still draws the narrow-zone indicator even when wheelWidth is 0 — the two are independent', () => {
        vanState.wheelWidth = 0;
        buildVanGeometry();
        const rearLower = vanGroup.children[2];
        expect(rearLower.geometry.parameters.width).toBeCloseTo(vanState.narrowWidth);
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
        // rearLower + upperZone + rearFloor + 2 arches, no front pieces
        expect(vanGroup.children).toHaveLength(5);
    });

    it('treats a rearLength at/below the 0.01 threshold as "no rear zone"', () => {
        vanState.frontLength = vanState.length - 0.005; // rearLength ~0.005, below the guard
        buildVanGeometry();
        // frontBox + frontFloor only
        expect(vanGroup.children).toHaveLength(2);
    });

    it('omits the wheel arches when wheelWidth is within 0.01 of 0', () => {
        vanState.wheelWidth = 0.0095; // below the guard
        buildVanGeometry();
        expect(vanGroup.children).toHaveLength(5); // no arches
    });

    it('sizes the front zone box down to the wheel-arch line when a rear zone also exists', () => {
        buildVanGeometry();
        const frontBox = vanGroup.children[0];
        // Only up to archHeight, not the full maxHeight — the space above
        // that is covered once by the shared upper zone (see below) instead
        // of a second box whose face would double-render against it.
        expect(frontBox.geometry.parameters).toMatchObject({
            width: vanState.maxWidth,
            height: vanState.archHeight,
            depth: vanState.frontLength,
        });
    });

    it('sizes the front zone box at full maxHeight when there is no rear zone', () => {
        vanState.frontLength = vanState.length;
        buildVanGeometry();
        const frontBox = vanGroup.children[0];
        expect(frontBox.geometry.parameters).toMatchObject({
            width: vanState.maxWidth,
            height: vanState.maxHeight,
            depth: vanState.frontLength,
        });
    });

    it('sizes the upper zone height as maxHeight minus archHeight', () => {
        buildVanGeometry();
        // Order of insertion: frontBox, frontFloor, rearLower, upperZone, ...
        const upperZone = vanGroup.children[3];
        expect(upperZone.geometry.parameters.height).toBeCloseTo(vanState.maxHeight - vanState.archHeight);
        expect(upperZone.position.y).toBeCloseTo(vanState.archHeight + (vanState.maxHeight - vanState.archHeight) / 2);
    });

    it('spans the upper zone across the van\'s full length, not just the rear section, so it shares no seam with the front box', () => {
        buildVanGeometry();
        const upperZone = vanGroup.children[3];
        expect(upperZone.geometry.parameters.depth).toBeCloseTo(vanState.length);
    });

    it('sizes and positions the wheel arch dome from wheelWidth/wheelHeight/wheelLength, independent of narrowWidth/archHeight', () => {
        Object.assign(vanState, {
            narrowWidth: 1.3, archHeight: 0.45, wheelWidth: 0.1, wheelHeight: 0.2, wheelLength: 0.5,
        });
        buildVanGeometry();
        // Order of insertion: frontBox, frontFloor, rearLower, upperZone, rearFloor, leftArch, rightArch
        const rightArch = vanGroup.children[6];
        rightArch.geometry.computeBoundingBox();
        const { min, max } = rightArch.geometry.boundingBox;

        expect(max.x - min.x).toBeCloseTo(vanState.wheelWidth);
        expect(max.y - min.y).toBeCloseTo(vanState.wheelHeight);
        expect(max.z - min.z).toBeCloseTo(vanState.wheelLength);
        expect(rightArch.position.x + max.x).toBeCloseTo(vanState.maxWidth / 2);
        expect(rightArch.position.y + min.y).toBeCloseTo(0); // sits on the floor
    });

    it('caps the wheel arch length to the rear section on a short van', () => {
        vanState.frontLength = vanState.length - 0.3; // rearLength = 0.3, shorter than wheelLength
        vanState.wheelLength = 0.99;
        buildVanGeometry();
        const rightArch = vanGroup.children[6];
        rightArch.geometry.computeBoundingBox();
        const { min, max } = rightArch.geometry.boundingBox;
        expect(max.z - min.z).toBeCloseTo(0.3);
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

    it('leaves a parked object untouched, even when the van shrinks drastically', () => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.4), new THREE.MeshStandardMaterial());
        mesh.userData.parked = true;
        mesh.position.set(10, 0.1, 0); // staged well outside any van bounds
        objects.push(mesh);

        vanState.maxWidth = 0.6;
        vanState.narrowWidth = 0.5;
        buildVanGeometry();

        expect(mesh.position.x).toBe(10);
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
