import { serializeState, applyState } from './persistence.js';

const MAX_HISTORY = 50;
const undoStack = [];
const redoStack = [];

// Call this BEFORE performing a mutating action (add/remove/move/rotate/
// duplicate/config change/load) to record a restore point. Any new capture
// invalidates the redo stack, matching standard undo/redo semantics — once
// you branch off with a new action, the old "future" is gone.
export function captureUndoPoint() {
    undoStack.push(serializeState());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
}

export function canUndo() {
    return undoStack.length > 0;
}

export function canRedo() {
    return redoStack.length > 0;
}

export function undo() {
    if (undoStack.length === 0) return false;
    const prev = undoStack.pop();
    redoStack.push(serializeState());
    applyState(prev);
    return true;
}

export function redo() {
    if (redoStack.length === 0) return false;
    const next = redoStack.pop();
    undoStack.push(serializeState());
    applyState(next);
    return true;
}

// Test/reset helper — also useful for a future "new project" action.
export function clearHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
}
