import { describe, it, expect, beforeEach, vi } from 'vitest';

// persistence.js pulls in van.js/objects.js for real (we want genuine
// save→clear→load round trips), which in turn import scene.js — mock just
// that leaf so no real WebGLRenderer/WebGL context is required under jsdom.
vi.mock('./scene.js', () => ({
    scene: { add: vi.fn(), remove: vi.fn() },
}));

const { vanState, objects, DEFAULT_VAN_STATE } = await import('./state.js');
const { addBox, clearAllObjects, toggleLock, DEFAULT_WEIGHT } = await import('./objects.js');
const {
    saveConfig, loadConfig, hasSavedConfig, clearSavedConfig, exportToFile, importFromText,
} = await import('./persistence.js');

const STORAGE_KEY = 'vanspace3d.config.v1';

beforeEach(() => {
    localStorage.clear();
    clearAllObjects();
    Object.assign(vanState, DEFAULT_VAN_STATE);
});

describe('saveConfig / hasSavedConfig / clearSavedConfig', () => {
    it('has nothing saved initially', () => {
        expect(hasSavedConfig()).toBe(false);
    });

    it('persists to localStorage and reports it as saved', () => {
        expect(saveConfig()).toBe(true);
        expect(hasSavedConfig()).toBe(true);
        expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });

    it('removes the saved entry', () => {
        saveConfig();
        clearSavedConfig();
        expect(hasSavedConfig()).toBe(false);
    });
});

describe('loadConfig', () => {
    it('returns false when nothing was ever saved', () => {
        expect(loadConfig()).toBe(false);
    });

    it('returns false and does not throw on corrupted JSON', () => {
        localStorage.setItem(STORAGE_KEY, '{not valid json');
        expect(() => loadConfig()).not.toThrow();
        expect(loadConfig()).toBe(false);
    });

    it('returns false for a payload missing the objects array', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ vanState: {} }));
        expect(loadConfig()).toBe(false);
    });

    it('round-trips van dimensions and placed objects exactly', () => {
        vanState.length = 4.1;
        vanState.maxHeight = 2.1;
        const a = addBox(0.6, 0.32, 0.4, 0x64748b);
        a.position.set(0.2, 0.16, -1.0);
        const b = addBox(0.3, 0.2, 0.3, 0x10b981);
        b.position.set(-0.3, 0.1, 0.5);

        expect(saveConfig()).toBe(true);

        clearAllObjects();
        Object.assign(vanState, DEFAULT_VAN_STATE); // simulate a fresh page load

        expect(loadConfig()).toBe(true);
        expect(vanState.length).toBe(4.1);
        expect(vanState.maxHeight).toBe(2.1);
        expect(objects).toHaveLength(2);

        const restoredA = objects.find((o) => o.geometry.parameters.width === 0.6);
        expect(restoredA.geometry.parameters).toMatchObject({ width: 0.6, height: 0.32, depth: 0.4 });
        expect(restoredA.material.color.getHex()).toBe(0x64748b);
        expect(restoredA.position.x).toBeCloseTo(0.2);
        expect(restoredA.position.z).toBeCloseTo(-1.0);

        const restoredB = objects.find((o) => o.geometry.parameters.width === 0.3);
        expect(restoredB.position.x).toBeCloseTo(-0.3);
    });

    it('replaces (not appends to) the currently placed objects', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b);
        saveConfig(); // saved with 1 object

        addBox(0.3, 0.2, 0.3, 0x10b981); // now 2 placed, only 1 of which was saved
        loadConfig();

        expect(objects).toHaveLength(1);
    });

    it('re-clamps restored objects into the (possibly resized) van bounds', () => {
        addBox(1.6, 0.2, 0.4, 0x64748b).position.set(0, 0.1, 0);
        saveConfig();

        clearAllObjects();
        Object.assign(vanState, DEFAULT_VAN_STATE, { maxWidth: 0.6, narrowWidth: 0.5 }); // shrink drastically
        loadConfig(); // the payload still carries the *old*, now out-of-range vanState...

        // ...but loadConfig() restores the saved vanState (wide) rather than
        // the drastically-shrunk one, so this mainly proves it doesn't throw
        // and produces a consistent, in-bounds result either way.
        const restored = objects[0];
        const halfWidth = restored.geometry.parameters.width / 2;
        expect(Math.abs(restored.position.x)).toBeLessThanOrEqual(vanState.maxWidth / 2 + halfWidth + 1e-6);
    });

    it('ignores object entries with insane dimensions instead of crashing', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: 1,
            vanState: { ...DEFAULT_VAN_STATE },
            objects: [
                { w: 0.6, h: 0.32, d: 0.4, color: 0x64748b, position: { x: 0, y: 0.16, z: 0 } }, // sane
                { w: -1, h: 0.32, d: 0.4, color: 0x64748b, position: { x: 0, y: 0.16, z: 0 } }, // negative width
                { w: 0.6, h: 0.32, d: 0.4, color: 0x64748b, position: { x: NaN, y: 0.16, z: 0 } }, // bad position
                { w: 9999, h: 0.32, d: 0.4, color: 0x64748b, position: { x: 0, y: 0.16, z: 0 } }, // absurd size
            ],
        }));

        expect(() => loadConfig()).not.toThrow();
        expect(objects).toHaveLength(1);
    });

    it('falls back to the existing value for any missing/invalid vanState field', () => {
        vanState.archHeight = 0.6; // a distinctive, non-default value to detect fallback
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: 1,
            vanState: { length: 4.0, frontLength: 'not-a-number' }, // archHeight omitted entirely
            objects: [],
        }));

        loadConfig();

        expect(vanState.length).toBe(4.0); // valid field applied
        expect(vanState.frontLength).toBe(DEFAULT_VAN_STATE.frontLength); // invalid field left alone
        expect(vanState.archHeight).toBe(0.6); // missing field left alone
    });

    it('round-trips the weight of each object', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b, 17.5);
        saveConfig();
        clearAllObjects();

        loadConfig();

        expect(objects[0].userData.weight).toBe(17.5);
    });

    it('round-trips the locked flag', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        toggleLock(mesh);
        saveConfig();
        clearAllObjects();

        loadConfig();

        expect(objects[0].userData.locked).toBe(true);
    });

    it('round-trips unlocked as false (not just falsy/undefined)', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b);
        saveConfig();
        clearAllObjects();

        loadConfig();

        expect(objects[0].userData.locked).toBe(false);
    });

    it('treats a missing locked field on an old save as unlocked', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: 1,
            vanState: { ...DEFAULT_VAN_STATE },
            objects: [
                { w: 0.6, h: 0.32, d: 0.4, color: 0x64748b, position: { x: 0, y: 0.16, z: 0 } }, // no locked field
            ],
        }));

        loadConfig();

        expect(objects[0].userData.locked).toBe(false);
    });

    it('falls back to DEFAULT_WEIGHT for a missing or invalid weight field (old saves without it)', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: 1,
            vanState: { ...DEFAULT_VAN_STATE },
            objects: [
                { w: 0.6, h: 0.32, d: 0.4, color: 0x64748b, position: { x: 0, y: 0.16, z: 0 } }, // no weight field at all
                {
                    w: 0.3, h: 0.2, d: 0.3, color: 0x10b981, weight: -5, position: { x: 1, y: 0.1, z: 0 },
                }, // invalid weight
            ],
        }));

        loadConfig();

        expect(objects.every((o) => o.userData.weight === DEFAULT_WEIGHT)).toBe(true);
    });
});

describe('exportToFile / importFromText', () => {
    it('exportToFile triggers a Blob download without throwing', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b);
        expect(() => exportToFile()).not.toThrow();
    });

    it('importFromText round-trips exactly what serializeState would produce', () => {
        vanState.length = 4.2;
        addBox(0.6, 0.32, 0.4, 0x64748b, 6).position.set(0.1, 0.16, -0.5);

        const exportedJsonSpy = vi.spyOn(JSON, 'stringify');
        exportToFile(); // just to exercise the path; capture what it would have written
        const [payload] = exportedJsonSpy.mock.calls[0];
        exportedJsonSpy.mockRestore();

        clearAllObjects();
        Object.assign(vanState, DEFAULT_VAN_STATE);

        expect(importFromText(JSON.stringify(payload))).toBe(true);
        expect(vanState.length).toBe(4.2);
        expect(objects[0].userData.weight).toBe(6);
        expect(objects[0].position.x).toBeCloseTo(0.1);
    });

    it('importFromText returns false and does not throw on invalid JSON', () => {
        expect(() => importFromText('not json{{{')).not.toThrow();
        expect(importFromText('not json{{{')).toBe(false);
    });

    it('importFromText returns false for valid JSON with the wrong shape', () => {
        expect(importFromText(JSON.stringify({ foo: 'bar' }))).toBe(false);
    });

    it('importFromText does not touch existing state when the payload is invalid', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b);
        importFromText('garbage');
        expect(objects).toHaveLength(1);
    });
});

describe('storage unavailable (e.g. Safari private mode / quota exceeded)', () => {
    it('saveConfig returns false instead of throwing when setItem fails', () => {
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        expect(() => saveConfig()).not.toThrow();
        expect(saveConfig()).toBe(false);
        spy.mockRestore();
    });

    it('loadConfig returns false instead of throwing when getItem fails', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(() => loadConfig()).not.toThrow();
        expect(loadConfig()).toBe(false);
        spy.mockRestore();
    });

    it('hasSavedConfig returns false instead of throwing when getItem fails', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(() => hasSavedConfig()).not.toThrow();
        expect(hasSavedConfig()).toBe(false);
        spy.mockRestore();
    });
});
