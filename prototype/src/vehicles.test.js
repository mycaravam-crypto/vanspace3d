import { describe, it, expect } from 'vitest';
import { VEHICLE_PRESETS } from './vehicles.js';
import { DEFAULT_VAN_STATE } from './state.js';

// Mirrors the min/max on the van-* range inputs in index.html — a preset
// that falls outside these would silently clamp when applied via the
// sliders, so keep the two in sync.
const SLIDER_RANGES = {
    length: [2.0, 5.0],
    frontLength: [0.0, 5.0],
    maxHeight: [1.2, 2.5],
    maxWidth: [1.4, 2.4],
    narrowWidth: [0.8, 1.6],
    archHeight: [0.1, 0.8],
    wheelWidth: [0.0, 0.6],
    wheelHeight: [0.0, 0.8],
    wheelLength: [0.1, 2.0],
    maxPayload: [50, 2000],
};

describe('VEHICLE_PRESETS', () => {
    it('has more than one preset to choose from', () => {
        expect(VEHICLE_PRESETS.length).toBeGreaterThan(1);
    });

    it('gives every entry a unique id', () => {
        const ids = VEHICLE_PRESETS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('gives every entry a non-empty label', () => {
        VEHICLE_PRESETS.forEach((p) => expect(p.label.length).toBeGreaterThan(0));
    });

    it('gives every entry every field vanState needs, and nothing else', () => {
        const expectedKeys = new Set(Object.keys(DEFAULT_VAN_STATE));
        VEHICLE_PRESETS.forEach((p) => {
            const presetKeys = Object.keys(p).filter((k) => k !== 'id' && k !== 'label');
            expect(new Set(presetKeys)).toEqual(expectedKeys);
        });
    });

    it('keeps every dimension within the Laderaum sliders\' min/max range', () => {
        VEHICLE_PRESETS.forEach((p) => {
            Object.entries(SLIDER_RANGES).forEach(([key, [min, max]]) => {
                expect(p[key]).toBeGreaterThanOrEqual(min);
                expect(p[key]).toBeLessThanOrEqual(max);
            });
        });
    });

    it('never sets frontLength greater than the total length', () => {
        VEHICLE_PRESETS.forEach((p) => expect(p.frontLength).toBeLessThanOrEqual(p.length));
    });

    it('never sets narrowWidth greater than maxWidth', () => {
        VEHICLE_PRESETS.forEach((p) => expect(p.narrowWidth).toBeLessThanOrEqual(p.maxWidth));
    });

    it('never sets archHeight greater than maxHeight - 0.1 (the config-panel clamp)', () => {
        VEHICLE_PRESETS.forEach((p) => expect(p.archHeight).toBeLessThanOrEqual(p.maxHeight - 0.1));
    });
});
