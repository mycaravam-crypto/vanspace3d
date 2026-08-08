import * as THREE from 'three';
import { scene } from './scene.js';
import { vanState, objects } from './state.js';

// Fraction of the van's max width beyond which the load is flagged as
// off-center. A rough packing heuristic, not a real axle-load calculation —
// this app doesn't model axle positions.
const OFF_CENTER_WIDTH_FRACTION = 0.25;

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
        if (obj.userData.parked) continue; // set aside, not currently loaded — excluded from weight/COG
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
// #total-weight / #cog-info / #payload-warning DOM readouts (no-ops if those
// elements aren't present, same defensive pattern as updateStats() in
// objects.js).
export function refreshCenterOfGravity() {
    const cog = computeCenterOfGravity();
    const totalWeight = cog ? cog.totalWeight : 0;

    const weightEl = document.getElementById('total-weight');
    if (weightEl) {
        weightEl.textContent = totalWeight.toFixed(1);
        weightEl.classList.toggle('text-red-400', totalWeight > vanState.maxPayload);
    }

    const payloadLabelEl = document.getElementById('max-payload-label');
    if (payloadLabelEl) payloadLabelEl.textContent = vanState.maxPayload;

    const cogEl = document.getElementById('cog-info');

    if (cog) {
        cogMarker.position.x = cog.x;
        cogMarker.position.z = cog.z;
        cogMarker.visible = true;
        if (cogEl) {
            const lr = cog.x >= 0 ? `${Math.round(cog.x * 100)}cm rechts` : `${Math.round(-cog.x * 100)}cm links`;
            const fb = cog.z >= 0 ? `${Math.round(cog.z * 100)}cm hinten` : `${Math.round(-cog.z * 100)}cm vorne`;
            cogEl.textContent = `${lr}, ${fb} von Fahrzeugmitte`;
            cogEl.title = cogEl.textContent; // full text on hover in case the chip truncates it
        }
    } else {
        cogMarker.visible = false;
        if (cogEl) { cogEl.textContent = '–'; cogEl.title = ''; }
    }

    const warningEl = document.getElementById('payload-warning');
    if (warningEl) {
        const overloaded = totalWeight > vanState.maxPayload;
        const offCenter = !!cog && Math.abs(cog.x) > vanState.maxWidth * OFF_CENTER_WIDTH_FRACTION;

        if (overloaded) {
            warningEl.textContent = `Überladen: ${totalWeight.toFixed(1)}kg von ${vanState.maxPayload}kg Zuladung.`;
        } else if (offCenter) {
            warningEl.textContent = 'Schwerpunkt weit außermittig – Ladung ggf. umverteilen.';
        }
        warningEl.classList.toggle('hidden', !overloaded && !offCenter);
    }

    return cog;
}
