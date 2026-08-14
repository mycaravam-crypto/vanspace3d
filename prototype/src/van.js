import * as THREE from 'three';
import { scene } from './scene.js';
import { vanState, objects } from './state.js';
import { clampToVan } from './collision.js';
import { refreshCenterOfGravity } from './cog.js';

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

// A real wheel arch is a rounded bump the tire housing pushes up into the
// cargo area — not a squared-off block — so its cross-section (looking from
// the rear, in the X/Y plane) is built as a half-ellipse: flat along the
// floor (y=0) from one edge of the arch to the other, curving up to a
// rounded peak of `height` at the center, then swept the full `depth` of the
// rear section along Z (capped at both ends by ExtrudeGeometry, unlike a
// plain half-cylinder sweep). Independent width/height radii (rather than a
// true circle) keep it fully driven by the same narrowWidth/archHeight
// config the old box used, so it still reshapes correctly as those sliders
// change — no new configuration needed.
function createWheelArchGeometry(width, height, depth) {
    const shape = new THREE.Shape();
    const segments = 24;
    shape.moveTo(-width / 2, 0);
    for (let i = 1; i < segments; i++) {
        const t = Math.PI * (1 - i / segments); // sweeps PI -> 0, left edge to right edge
        shape.lineTo(Math.cos(t) * (width / 2), Math.sin(t) * height);
    }
    shape.lineTo(width / 2, 0);
    shape.closePath(); // back along the floor (y=0) to the start

    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segments });
    geo.translate(0, 0, -depth / 2); // center on Z like every other geometry here (BoxGeometry is origin-centered)
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
        // createWheelArchGeometry() above), not a squared-off block. Its
        // bounding footprint (archWidth x archHeight, spanning the same
        // narrowWidth-to-maxWidth gap) is unchanged, so clampToVan()
        // (collision.js) keeps treating that footprint as off-limits —
        // conservative but safe, since the dome is always inscribed inside it.
        const archWidth = Math.max(0, (vanState.maxWidth - vanState.narrowWidth) / 2);
        if (archWidth > 0.01) {
            const archGeo = createWheelArchGeometry(archWidth, vanState.archHeight, rearLength);
            const archMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 });

            const leftArch = new THREE.Mesh(archGeo, archMat);
            leftArch.position.set(-vanState.narrowWidth / 2 - archWidth / 2, 0, zRearCenter);
            leftArch.receiveShadow = true; leftArch.castShadow = true;
            vanGroup.add(leftArch);

            const rightArch = new THREE.Mesh(archGeo, archMat);
            rightArch.position.set(vanState.narrowWidth / 2 + archWidth / 2, 0, zRearCenter);
            rightArch.receiveShadow = true; rightArch.castShadow = true;
            vanGroup.add(rightArch);
        }
    }

    // Re-validate object positions when van changes
    objects.forEach((obj) => {
        clampToVan(obj, obj.position);
    });

    // maxWidth/maxPayload changes affect the payload-limit and off-center
    // warnings even when no object moved, so refresh them here too.
    refreshCenterOfGravity();
}
