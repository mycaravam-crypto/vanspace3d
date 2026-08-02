import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('./scene.js', () => ({
    scene: { add: vi.fn(), remove: vi.fn() },
}));

const { vanState, objects, DEFAULT_VAN_STATE } = await import('./state.js');
const { addBox, clearAllObjects } = await import('./objects.js');
const {
    captureUndoPoint, undo, redo, canUndo, canRedo, clearHistory,
} = await import('./history.js');

beforeEach(() => {
    clearHistory();
    clearAllObjects();
    Object.assign(vanState, DEFAULT_VAN_STATE);
});

describe('canUndo / canRedo', () => {
    it('are both false with an empty history', () => {
        expect(canUndo()).toBe(false);
        expect(canRedo()).toBe(false);
    });

    it('canUndo becomes true after a capture', () => {
        captureUndoPoint();
        expect(canUndo()).toBe(true);
    });

    it('canRedo becomes true only after an undo', () => {
        captureUndoPoint();
        expect(canRedo()).toBe(false);
        undo();
        expect(canRedo()).toBe(true);
    });
});

describe('undo / redo round trip', () => {
    it('undo() restores object placement to the captured point', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b);
        captureUndoPoint(); // "before adding the second object"
        addBox(0.3, 0.2, 0.3, 0x10b981);
        expect(objects).toHaveLength(2);

        expect(undo()).toBe(true);
        expect(objects).toHaveLength(1);
        expect(objects[0].geometry.parameters).toMatchObject({ width: 0.6 });
    });

    it('redo() re-applies the undone action', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b);
        captureUndoPoint();
        addBox(0.3, 0.2, 0.3, 0x10b981);

        undo();
        expect(objects).toHaveLength(1);

        expect(redo()).toBe(true);
        expect(objects).toHaveLength(2);
    });

    it('undo() restores vanState fields too', () => {
        vanState.length = 3.3;
        captureUndoPoint();
        vanState.length = 4.9;

        undo();
        expect(vanState.length).toBe(3.3);
    });

    it('undo() with an empty stack is a no-op that returns false', () => {
        expect(undo()).toBe(false);
        expect(objects).toHaveLength(0);
    });

    it('redo() with an empty stack is a no-op that returns false', () => {
        expect(redo()).toBe(false);
    });

    it('a new capture after an undo clears the redo stack (no history branching)', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b);
        captureUndoPoint();
        addBox(0.3, 0.2, 0.3, 0x10b981);
        undo();
        expect(canRedo()).toBe(true);

        captureUndoPoint(); // user does something new instead of redoing
        expect(canRedo()).toBe(false);
    });

    it('supports multiple sequential undos back through several steps', () => {
        captureUndoPoint();
        addBox(0.6, 0.32, 0.4, 0x64748b); // step 1: 1 object
        captureUndoPoint();
        addBox(0.3, 0.2, 0.3, 0x10b981); // step 2: 2 objects
        captureUndoPoint();
        addBox(0.2, 0.2, 0.2, 0xffffff); // step 3: 3 objects

        expect(objects).toHaveLength(3);
        undo();
        expect(objects).toHaveLength(2);
        undo();
        expect(objects).toHaveLength(1);
        undo();
        expect(objects).toHaveLength(0);
        expect(canUndo()).toBe(false);
    });

    it('preserves object weight/color/position through an undo/redo cycle', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b, 12);
        mesh.position.set(0.2, 0.16, -0.5);
        captureUndoPoint();
        clearAllObjects();

        undo();
        const restored = objects[0];
        expect(restored.userData.weight).toBe(12);
        expect(restored.material.color.getHex()).toBe(0x64748b);
        expect(restored.position.x).toBeCloseTo(0.2);
    });
});

describe('captureUndoPoint history size limit', () => {
    it('caps the undo stack so it cannot grow without bound', () => {
        for (let i = 0; i < 60; i++) {
            captureUndoPoint();
        }
        // Undo 60 times; more than the 50-entry cap should have been dropped.
        let count = 0;
        while (undo()) count++;
        expect(count).toBeLessThanOrEqual(50);
        expect(count).toBeGreaterThan(0);
    });
});
