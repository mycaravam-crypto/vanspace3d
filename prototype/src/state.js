// Shared mutable state for the prototype. Kept deliberately plain (no store
// library) since this is a vanilla-JS prototype — see PLAN.md for the
// Zustand-based state model planned for the real app.

// Exposed separately (and frozen) so a "reset to defaults" action has
// something to copy from, and so its keys are the single source of truth
// for which fields make up a valid vanState (used by persistence.js).
export const DEFAULT_VAN_STATE = Object.freeze({
    length: 3.3,
    frontLength: 1.6,
    maxHeight: 1.9,
    maxWidth: 1.8,
    narrowWidth: 1.3,
    archHeight: 0.45,
    // The actual wheel arch (Radkasten) dimensions — independent of
    // narrowWidth/archHeight above, which now only draw the "narrow zone"
    // area indicator (see wheelArch.js). These drive both the 3D dome mesh
    // and what clampToVan() (collision.js) actually treats as off-limits.
    wheelWidth: 0.25,
    wheelHeight: 0.45,
    wheelLength: 0.99,
    // Illustrative default max payload (kg) — not a real vehicle spec, just a
    // starting point the user is meant to adjust for their actual vehicle.
    maxPayload: 400,
});

export const vanState = { ...DEFAULT_VAN_STATE };

// Placed objects (THREE.Mesh instances). Passed by reference into
// DragControls, so mutate in place (push/splice/length=0) rather than
// reassigning this binding.
export const objects = [];
