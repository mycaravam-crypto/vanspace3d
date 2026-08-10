import { describe, it, expect } from 'vitest';
import { STANDARD_LIBRARY } from './library.js';

describe('STANDARD_LIBRARY', () => {
    it('has more than one Eurobox size to choose from', () => {
        const euroboxes = STANDARD_LIBRARY.filter((item) => item.id.startsWith('eb-'));
        expect(euroboxes.length).toBeGreaterThan(1);
    });

    it('gives every entry a unique id', () => {
        const ids = STANDARD_LIBRARY.map((item) => item.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('gives every entry sane, positive dimensions in meters', () => {
        STANDARD_LIBRARY.forEach((item) => {
            expect(item.w).toBeGreaterThan(0);
            expect(item.h).toBeGreaterThan(0);
            expect(item.d).toBeGreaterThan(0);
            // A prototype bug class we already hit once: cm/meter mixups.
            // Nothing in this library should be plausible only in centimeters.
            expect(item.w).toBeLessThan(3);
            expect(item.h).toBeLessThan(3);
            expect(item.d).toBeLessThan(3);
        });
    });

    it('gives every entry a valid 24-bit hex color', () => {
        STANDARD_LIBRARY.forEach((item) => {
            expect(item.color).toBeGreaterThanOrEqual(0);
            expect(item.color).toBeLessThanOrEqual(0xffffff);
        });
    });

    it('gives every entry a non-empty label and Tailwind accent name', () => {
        STANDARD_LIBRARY.forEach((item) => {
            expect(item.label.length).toBeGreaterThan(0);
            expect(item.accent.length).toBeGreaterThan(0);
        });
    });

    it('gives every entry a sane, positive illustrative weight in kg', () => {
        STANDARD_LIBRARY.forEach((item) => {
            expect(item.weight).toBeGreaterThan(0);
            expect(item.weight).toBeLessThan(100); // a single Eurobox-sized item, not a pallet
        });
    });

    it('gives every Eurobox a sane, positive price in EUR', () => {
        STANDARD_LIBRARY.filter((item) => item.id.startsWith('eb-')).forEach((item) => {
            expect(item.price).toBeGreaterThan(0);
            expect(item.price).toBeLessThan(100); // a single empty Eurobox, not a pallet of them
        });
    });
});
