import { describe, it, expect } from 'vitest';
import { vanState, objects } from './state.js';

describe('initial state', () => {
    it('exposes the documented default van dimensions', () => {
        expect(vanState).toEqual({
            length: 3.3,
            frontLength: 1.6,
            maxHeight: 1.9,
            maxWidth: 1.8,
            narrowWidth: 1.3,
            archHeight: 0.45,
            maxPayload: 400,
        });
    });

    it('starts with an empty, mutable objects list', () => {
        expect(Array.isArray(objects)).toBe(true);
        expect(objects).toHaveLength(0);
    });
});
