import * as THREE from 'three';
import { vanState, objects } from './state.js';

// ==========================================
// PHYSICS & COLLISION SYSTEM
// ==========================================
// Cached Box3 instances to prevent GC spikes during drag
const tempBox1 = new THREE.Box3();
const tempBox2 = new THREE.Box3();

export function clampToVan(obj, pos) {
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

export function checkCollision(obj) {
    obj.updateMatrixWorld();
    tempBox1.setFromObject(obj);
    tempBox1.expandByScalar(-0.005); // Tiny tolerance for sliding

    for (let i = 0; i < objects.length; i++) {
        const other = objects[i];
        if (other === obj) continue;

        tempBox2.setFromObject(other);
        tempBox2.expandByScalar(-0.005);

        if (tempBox1.intersectsBox(tempBox2)) return true;
    }
    return false;
}
