import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./objects.js', () => ({ refreshObjectAppearance: vi.fn() }));

const { objects } = await import('./state.js');
const { refreshObjectAppearance } = await import('./objects.js');
const {
    isSelected, getSelected, selectOnly, toggleInSelection, addManyToSelection, clearSelection,
} = await import('./selection.js');

// Mirrors real objects: addBox() always initializes userData.selected = false
// explicitly (never leaves it undefined), which is what setFlag()'s
// no-redundant-refresh check relies on.
function makeObj() {
    return { userData: { selected: false } };
}

beforeEach(() => {
    objects.length = 0;
    refreshObjectAppearance.mockClear();
});

describe('isSelected / getSelected', () => {
    it('reports false/empty for untouched objects', () => {
        const a = makeObj();
        objects.push(a);
        expect(isSelected(a)).toBe(false);
        expect(getSelected()).toEqual([]);
    });

    it('reflects userData.selected directly', () => {
        const a = makeObj();
        a.userData.selected = true;
        objects.push(a);
        expect(isSelected(a)).toBe(true);
        expect(getSelected()).toEqual([a]);
    });

    it('isSelected is safe on null/undefined', () => {
        expect(isSelected(null)).toBe(false);
        expect(isSelected(undefined)).toBe(false);
    });
});

describe('selectOnly', () => {
    it('selects exactly the given object, deselecting any previous selection', () => {
        const a = makeObj();
        const b = makeObj();
        objects.push(a, b);

        selectOnly(a);
        expect(getSelected()).toEqual([a]);

        selectOnly(b);
        expect(getSelected()).toEqual([b]);
        expect(isSelected(a)).toBe(false);
    });

    it('clears the whole selection when called with null', () => {
        const a = makeObj();
        const b = makeObj();
        objects.push(a, b);
        addManyToSelection([a, b]);

        selectOnly(null);
        expect(getSelected()).toEqual([]);
    });

    it('only calls refreshObjectAppearance for objects whose flag actually changed', () => {
        const a = makeObj();
        const b = makeObj();
        objects.push(a, b);

        selectOnly(a);
        expect(refreshObjectAppearance).toHaveBeenCalledTimes(1);
        expect(refreshObjectAppearance).toHaveBeenCalledWith(a);

        refreshObjectAppearance.mockClear();
        selectOnly(a); // no-op: already the sole selection
        expect(refreshObjectAppearance).not.toHaveBeenCalled();
    });
});

describe('toggleInSelection', () => {
    it('adds an unselected object', () => {
        const a = makeObj();
        objects.push(a);
        toggleInSelection(a);
        expect(isSelected(a)).toBe(true);
    });

    it('removes an already-selected object', () => {
        const a = makeObj();
        objects.push(a);
        toggleInSelection(a);
        toggleInSelection(a);
        expect(isSelected(a)).toBe(false);
    });

    it('accumulates: toggling a second object keeps the first selected', () => {
        const a = makeObj();
        const b = makeObj();
        objects.push(a, b);

        toggleInSelection(a);
        toggleInSelection(b);

        expect(getSelected()).toEqual([a, b]);
    });

    it('is a no-op for null', () => {
        expect(() => toggleInSelection(null)).not.toThrow();
        expect(refreshObjectAppearance).not.toHaveBeenCalled();
    });
});

describe('addManyToSelection', () => {
    it('unions the given objects into an existing selection', () => {
        const a = makeObj();
        const b = makeObj();
        const c = makeObj();
        objects.push(a, b, c);

        selectOnly(a);
        addManyToSelection([b, c]);

        expect(getSelected()).toEqual([a, b, c]);
    });

    it('leaves already-selected objects untouched (no redundant refresh)', () => {
        const a = makeObj();
        objects.push(a);
        toggleInSelection(a);
        refreshObjectAppearance.mockClear();

        addManyToSelection([a]);
        expect(refreshObjectAppearance).not.toHaveBeenCalled();
    });
});

describe('clearSelection', () => {
    it('deselects every currently-selected object', () => {
        const a = makeObj();
        const b = makeObj();
        const c = makeObj();
        objects.push(a, b, c);
        addManyToSelection([a, c]);

        clearSelection();

        expect(getSelected()).toEqual([]);
        expect(isSelected(b)).toBe(false);
    });

    it('is a no-op (no refresh calls) when nothing is selected', () => {
        const a = makeObj();
        objects.push(a);
        clearSelection();
        expect(refreshObjectAppearance).not.toHaveBeenCalled();
    });
});
