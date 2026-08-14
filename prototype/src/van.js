import * as THREE from 'three';
import { scene } from './scene.js';
import { vanState, objects } from './state.js';
import { clampToVan } from './collision.js';
import { refreshCenterOfGravity } from './cog.js';
import { getWheelArchBounds } from './wheelArch.js';

// ==========================================
// VAN CONFIGURATION & GEOMETRY
// ==========================================
export const vanGroup = new THREE.Group();
scene.add(vanGroup);

// Safe disposal to prevent memory leaks
function disposeGroup(group) {
    const children = [...group.children];
    for (const child of children) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
            else child.material.dispose();
        }
        if (child.children.length > 0) disposeGroup(child);
        group.remove(child);
    }
}

// A real wheel arch is a rounded dome the tire housing pushes up into the
// cargo area, sized to the tire it covers — a localized bump, not a ridge
// running the full depth of the rear section. Built as the top half of an
// ellipsoid (THREE.SphereGeometry restricted to thetaLength=PI/2, i.e. from
// the north pole down to the equator) so it's rounded in every direction —
// width, height AND length — unlike a swept half-ellipse, which is only
// rounded in cross-section and reads as a wall. The equator (its flat
// circular/elliptical base) sits on the floor at local y=0 and is left
// uncapped, same reasoning as every other zone mesh here: it's flush against
// the hidden floor, so there's nothing to see there anyway.
// `width`/`height`/`length` come from getWheelArchBounds() (wheelArch.js),
// i.e. the wheelWidth/wheelHeight/wheelLength sliders — independent of the
// narrowWidth/archHeight "narrow zone" indicator drawn elsewhere in this file.
function createWheelArchGeometry(width, height, length) {
    const geo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.scale(width / 2, height, length / 2);
    return geo;
}

// Reusable function for transparent bounding boxes
function createVanZone(w, h, l, yPos, colorHex) {
    const geo = new THREE.BoxGeometry(w, h, l);
    const mat = new THREE.MeshStandardMaterial({
        color: colorHex, transparent: true, opacity: 0.08,
        side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = yPos;

    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
        color: colorHex, linewidth: 2, transparent: true, opacity: 0.4,
    }));
    mesh.add(line);
    return mesh;
}

export function buildVanGeometry() {
    disposeGroup(vanGroup);

    const zFrontStart = -vanState.length / 2;
    const zSplit = zFrontStart + vanState.frontLength;
    const rearLength = Math.max(0, vanState.length - vanState.frontLength);
    const hasFront = vanState.frontLength > 0.01;
    const hasRear = rearLength > 0.01;

    const zFrontCenter = zFrontStart + (vanState.frontLength / 2);
    const zRearCenter = zSplit + (rearLength / 2);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 });

    // Front Area. When a rear zone also exists, the front box only needs to
    // cover up to the wheel-arch line — the space above that is the same
    // full-width volume as the rear's upper zone, so it's drawn once below
    // as a single box spanning the van's full length. Two adjacent
    // transparent boxes sharing that face would otherwise double-render it
    // into a fake seam down the middle of the van.
    if (hasFront) {
        const frontHeight = hasRear ? vanState.archHeight : vanState.maxHeight;
        const frontBox = createVanZone(vanState.maxWidth, frontHeight, vanState.frontLength, frontHeight / 2, 0x3b82f6);
        frontBox.position.z = zFrontCenter;
        vanGroup.add(frontBox);

        const frontFloor = new THREE.Mesh(new THREE.PlaneGeometry(vanState.maxWidth, vanState.frontLength), floorMat);
        frontFloor.rotation.x = -Math.PI / 2;
        frontFloor.position.set(0, 0.01, zFrontCenter);
        frontFloor.receiveShadow = true;
        vanGroup.add(frontFloor);
    }

    // Rear Area (Narrow bottom, wide top)
    if (hasRear) {
        // Lower narrow area
        const rearLower = createVanZone(vanState.narrowWidth, vanState.archHeight, rearLength, vanState.archHeight / 2, 0x10b981);
        rearLower.position.z = zRearCenter;
        vanGroup.add(rearLower);

        // Upper wide area — spans the van's FULL length (front + rear
        // together), not just the rear span; see comment above.
        const upperHeight = Math.max(0.01, vanState.maxHeight - vanState.archHeight);
        const upperZone = createVanZone(vanState.maxWidth, upperHeight, vanState.length, vanState.archHeight + upperHeight / 2, 0x3b82f6);
        vanGroup.add(upperZone);

        // Rear floor
        const rearFloor = new THREE.Mesh(new THREE.PlaneGeometry(vanState.narrowWidth, rearLength), floorMat);
        rearFloor.rotation.x = -Math.PI / 2;
        rearFloor.position.set(0, 0.01, zRearCenter);
        rearFloor.receiveShadow = true;
        vanGroup.add(rearFloor);

        // Wheel arch solid representation — a rounded dome (see
        // createWheelArchGeometry() above) sized and positioned from
        // getWheelArchBounds() (wheelArch.js), the SAME bounds
        // clampToVan() (collision.js) treats as off-limits, so the drawn
        // shape and the actual cargo restriction always agree. This is
        // independent of narrowWidth/archHeight — the rearLower zone above
        // remains the "narrow zone" indicator regardless of the arches'
        // real size.
        const archMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 });
        getWheelArchBounds().forEach((arch) => {
            const archGeo = createWheelArchGeometry(arch.xMax - arch.xMin, arch.yMax - arch.yMin, arch.zMax - arch.zMin);
            const archMesh = new THREE.Mesh(archGeo, archMat);
            archMesh.position.set((arch.xMin + arch.xMax) / 2, arch.yMin, (arch.zMin + arch.zMax) / 2);
            archMesh.receiveShadow = true; archMesh.castShadow = true;
            vanGroup.add(archMesh);
        });
    }

    // Re-validate object positions when van changes
    objects.forEach((obj) => {
        clampToVan(obj, obj.position);
    });

    // maxWidth/maxPayload changes affect the payload-limit and off-center
    // warnings even when no object moved, so refresh them here too.
    refreshCenterOfGravity();
}
