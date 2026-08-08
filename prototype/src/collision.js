import * as THREE from 'three';
import { vanState, objects } from './state.js';

// ==========================================
// PHYSICS & COLLISION SYSTEM
// ==========================================
// Cached Box3 instances to prevent GC spikes during drag
const tempBox1 = new THREE.Box3();
const tempBox2 = new THREE.Box3();

export function clampToVan(obj, pos) {
    // A "parked" object (see parkObject()/returnObjectToVan() in objects.js)
    // is deliberately staged outside the van — nothing to clamp it into.
    if (obj.userData.parked) return;

    const w = obj.geometry.parameters.width;
    const h = obj.geometry.parameters.height;
    const d = obj.geometry.parameters.depth;

    const zSplitLine = -(vanState.length / 2) + vanState.frontLength;
    const objBottom = pos.y - (h / 2);
    const objRear = pos.z + (d / 2); // Z grows backwards

    let activeWidth = vanState.maxWidth;

    // Constraint: Object is in rear section and below arch height
    if (objRear > zSplitLine + 0.01 && objBottom < vanState.archHeight - 0.01) {
        activeWidth = vanState.narrowWidth;

        // If it's physically too wide for the narrow section, force it UP
        if (w > vanState.narrowWidth + 0.02) {
            pos.y = Math.max(vanState.archHeight + h / 2, pos.y);
            activeWidth = vanState.maxWidth;
        }
    }

    const limitX = Math.max(0, activeWidth / 2 - w / 2);
    const limitY = Math.max(h / 2, vanState.maxHeight - h / 2);
    const limitZ = Math.max(0, vanState.length / 2 - d / 2);

    pos.x = Math.max(-limitX, Math.min(limitX, pos.x));
    pos.y = Math.max(h / 2, Math.min(limitY, pos.y));
    pos.z = Math.max(-limitZ, Math.min(limitZ, pos.z));
}

// `exclude` (optional Set) skips additional objects beyond obj itself — used
// during a rigid group drag (controls.js's dragGroup()) so members of the
// same moving group don't "collide" with each other.
export function checkCollision(obj, exclude = null) {
    // A parked object occupies no space in the van's packed layout — it
    // neither collides with anything itself nor blocks other objects (the
    // `other.userData.parked` check below).
    if (obj.userData.parked) return false;

    obj.updateMatrixWorld();
    tempBox1.setFromObject(obj);
    tempBox1.expandByScalar(-0.005); // Tiny tolerance for sliding

    for (let i = 0; i < objects.length; i++) {
        const other = objects[i];
        if (other === obj) continue;
        if (exclude && exclude.has(other)) continue;
        if (other.userData.parked) continue;

        tempBox2.setFromObject(other);
        tempBox2.expandByScalar(-0.005);

        if (tempBox1.intersectsBox(tempBox2)) return true;
    }
    return false;
}

// ==========================================
// FACE / STACK SNAPPING
// ==========================================
// Looser than the 5cm grid on purpose — this is a "magnet" for nudging a box
// close to a neighbor until it catches, not a precision grid.
export const FACE_SNAP_TOLERANCE = 0.04; // 4cm
// Two footprints/sides only touching near a corner shouldn't count as
// "adjacent" — require a bit of genuine overlap first.
const FACE_SNAP_MIN_OVERLAP = 0.02; // 2cm

function overlap(aMin, aMax, bMin, bMax) {
    return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

// Given `obj` being dragged and the axis currently being tested ('x', 'y', or
// 'z'), looks for a neighboring object whose adjacent face `obj`'s face on
// that axis could snap to — the top of a box below it for 'y' (stacking), or
// a side face for 'x'/'z' (side-by-side) — using obj's CURRENT position on
// the other two axes to require the footprints actually overlap there.
// Returns the snapped coordinate for `axis`, or null if nothing is close
// enough to snap to.
export function findFaceSnap(obj, axis, proposedValue) {
    const { width: w, height: h, depth: d } = obj.geometry.parameters;
    const ox = obj.position.x;
    const oy = obj.position.y;
    const oz = obj.position.z;

    let best = null;
    let bestDist = Infinity;
    const consider = (value) => {
        const dist = Math.abs(value - proposedValue);
        if (dist <= FACE_SNAP_TOLERANCE && dist < bestDist) {
            best = value;
            bestDist = dist;
        }
    };

    for (let i = 0; i < objects.length; i++) {
        const other = objects[i];
        if (other === obj) continue;
        const { width: ow, height: oh, depth: od } = other.geometry.parameters;

        if (axis === 'y') {
            const overlapsFootprint = overlap(ox - w / 2, ox + w / 2, other.position.x - ow / 2, other.position.x + ow / 2) > FACE_SNAP_MIN_OVERLAP
                && overlap(oz - d / 2, oz + d / 2, other.position.z - od / 2, other.position.z + od / 2) > FACE_SNAP_MIN_OVERLAP;
            if (!overlapsFootprint) continue;

            consider(other.position.y + oh / 2 + h / 2); // stack on top of other
            consider(other.position.y - oh / 2 - h / 2); // stack underneath other
        } else if (axis === 'x') {
            const overlapsSide = overlap(oy - h / 2, oy + h / 2, other.position.y - oh / 2, other.position.y + oh / 2) > FACE_SNAP_MIN_OVERLAP
                && overlap(oz - d / 2, oz + d / 2, other.position.z - od / 2, other.position.z + od / 2) > FACE_SNAP_MIN_OVERLAP;
            if (!overlapsSide) continue;

            consider(other.position.x + ow / 2 + w / 2); // to the right of other
            consider(other.position.x - ow / 2 - w / 2); // to the left of other
        } else if (axis === 'z') {
            const overlapsSide = overlap(oy - h / 2, oy + h / 2, other.position.y - oh / 2, other.position.y + oh / 2) > FACE_SNAP_MIN_OVERLAP
                && overlap(ox - w / 2, ox + w / 2, other.position.x - ow / 2, other.position.x + ow / 2) > FACE_SNAP_MIN_OVERLAP;
            if (!overlapsSide) continue;

            consider(other.position.z + od / 2 + d / 2); // behind other
            consider(other.position.z - od / 2 - d / 2); // in front of other
        }
    }

    return best;
}
