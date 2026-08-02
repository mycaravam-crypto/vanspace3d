import * as THREE from 'three';
import { scene } from './scene.js';
import { objects } from './state.js';

// A small floor marker showing the weighted center of gravity (X/Z plan
// position) of all placed objects. Not part of vanGroup — it must survive
// van rebuilds, so it's added straight to the scene and just repositioned.
const markerGeo = new THREE.RingGeometry(0.05, 0.09, 24);
const markerMat = new THREE.MeshBasicMaterial({
    color: 0xef4444, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
});
export const cogMarker = new THREE.Mesh(markerGeo, markerMat);
cogMarker.rotation.x = -Math.PI / 2;
cogMarker.position.y = 0.015;
cogMarker.visible = false;
scene.add(cogMarker);

// Weighted average X/Z position across all placed objects. Returns null when
// there is nothing placed yet or every object has zero/invalid weight.
export function computeCenterOfGravity() {
    let totalWeight = 0;
    let sumX = 0;
    let sumZ = 0;

    for (const obj of objects) {
        const w = obj.userData.weight;
        if (!Number.isFinite(w) || w <= 0) continue;
        totalWeight += w;
        sumX += obj.position.x * w;
        sumZ += obj.position.z * w;
    }

    if (totalWeight <= 0) return null;
    return { x: sumX / totalWeight, z: sumZ / totalWeight, totalWeight };
}

// Recomputes the center of gravity and refreshes the 3D marker plus the
// #total-weight / #cog-info DOM readouts (no-ops if those elements aren't
// present, same defensive pattern as updateStats() in objects.js).
export function refreshCenterOfGravity() {
    const cog = computeCenterOfGravity();

    const weightEl = document.getElementById('total-weight');
    if (weightEl) weightEl.textContent = (cog ? cog.totalWeight : 0).toFixed(1);

    const cogEl = document.getElementById('cog-info');

    if (cog) {
        cogMarker.position.x = cog.x;
        cogMarker.position.z = cog.z;
        cogMarker.visible = true;
        if (cogEl) {
            const lr = cog.x >= 0 ? `${Math.round(cog.x * 100)}cm rechts` : `${Math.round(-cog.x * 100)}cm links`;
            const fb = cog.z >= 0 ? `${Math.round(cog.z * 100)}cm hinten` : `${Math.round(-cog.z * 100)}cm vorne`;
            cogEl.textContent = `${lr}, ${fb} von Fahrzeugmitte`;
        }
    } else {
        cogMarker.visible = false;
        if (cogEl) cogEl.textContent = '–';
    }

    return cog;
}
