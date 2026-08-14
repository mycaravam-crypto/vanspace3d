import { vanState } from './state.js';

// Shared geometry for the wheel arches (Radkästen) — both van.js (the 3D
// dome mesh) and collision.js (obstacle avoidance) derive the SAME left/right
// bounding boxes from vanState here, so the drawn shape and what's actually
// off-limits to cargo can never drift apart.
//
// This is deliberately independent of narrowWidth/archHeight, which now only
// drive the translucent "narrow zone" indicator drawn in van.js — a rough,
// at-a-glance area warning the user asked to keep, even though the arches
// themselves (and what cargo placement actually respects) are sized and
// positioned by wheelWidth/wheelHeight/wheelLength instead.
//
// Returns [] when there's no rear section at all, or the configured wheel
// width is negligible (no arches to draw or collide with).
export function getWheelArchBounds() {
    const rearLength = Math.max(0, vanState.length - vanState.frontLength);
    if (rearLength < 0.01 || vanState.wheelWidth < 0.01) return [];

    const zRearCenter = -(vanState.length / 2) + vanState.frontLength + rearLength / 2;
    const length = Math.min(rearLength, vanState.wheelLength);
    const zMin = zRearCenter - length / 2;
    const zMax = zRearCenter + length / 2;
    const yMin = 0;
    const yMax = vanState.wheelHeight;
    const width = vanState.wheelWidth;

    return [
        { // left, against the -X wall
            xMin: -vanState.maxWidth / 2, xMax: -vanState.maxWidth / 2 + width, yMin, yMax, zMin, zMax,
        },
        { // right, against the +X wall
            xMin: vanState.maxWidth / 2 - width, xMax: vanState.maxWidth / 2, yMin, yMax, zMin, zMax,
        },
    ];
}
