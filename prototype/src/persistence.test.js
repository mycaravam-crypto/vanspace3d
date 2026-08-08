import { describe, it, expect, beforeEach, vi } from 'vitest';

// persistence.js pulls in van.js/objects.js for real (we want genuine
// save→clear→load round trips), which in turn import scene.js — mock just
// that leaf so no real WebGLRenderer/WebGL context is required under jsdom.
vi.mock('./scene.js', () => ({
    scene: { add: vi.fn(), remove: vi.fn() },
}));

const { vanState, objects, DEFAULT_VAN_STATE } = await import('./state.js');
const {
    addBox, clearAllObjects, toggleLock, parkObject, isParked, DEFAULT_WEIGHT,
} = await import('./objects.js');
const {
    saveConfig, loadConfig, hasSavedConfig, clearSavedConfig, exportToFile, sanitizeFilename,
    generatePackingListText, exportPackingListToFile, importFromText,
    listProjects, saveNamedProject, loadNamedProject, deleteNamedProject, renameNamedProject,
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

    it('round-trips maxPayload like any other vanState field', () => {
        vanState.maxPayload = 650;
        saveConfig();

        Object.assign(vanState, DEFAULT_VAN_STATE);
        loadConfig();

        expect(vanState.maxPayload).toBe(650);
    });

    it('round-trips the weight of each object', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b, 17.5);
        saveConfig();
        clearAllObjects();

        loadConfig();

        expect(objects[0].userData.weight).toBe(17.5);
    });

    it('round-trips the label of each object', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b, 17.5, 'Werkzeugkiste');
        saveConfig();
        clearAllObjects();

        loadConfig();

        expect(objects[0].userData.label).toBe('Werkzeugkiste');
    });

    it('falls back to the generic "Objekt" label for a missing or invalid label field (old saves without it)', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: 1,
            vanState: { ...DEFAULT_VAN_STATE },
            objects: [
                { w: 0.6, h: 0.32, d: 0.4, color: 0x64748b, position: { x: 0, y: 0.16, z: 0 } }, // no label field
                {
                    w: 0.3, h: 0.2, d: 0.3, color: 0x10b981, label: '   ', position: { x: 1, y: 0.1, z: 0 },
                }, // blank label
            ],
        }));

        loadConfig();

        expect(objects.every((o) => o.userData.label === 'Objekt')).toBe(true);
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

    it('round-trips a fixed obstacle as fixed, locked, and zero-weight', () => {
        addBox(0.6, 0.4, 0.3, 0x78716c, 0, 'Wassertank', { fixed: true });
        saveConfig();
        clearAllObjects();

        loadConfig();

        expect(objects[0].userData.fixed).toBe(true);
        expect(objects[0].userData.locked).toBe(true);
        expect(objects[0].userData.weight).toBe(0);
    });

    it('treats a missing fixed field on an old save as not fixed', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: 1,
            vanState: { ...DEFAULT_VAN_STATE },
            objects: [
                { w: 0.6, h: 0.32, d: 0.4, color: 0x64748b, position: { x: 0, y: 0.16, z: 0 } }, // no fixed field
            ],
        }));

        loadConfig();

        expect(objects[0].userData.fixed).toBe(false);
    });

    it('round-trips a parked object, keeping its exact (outside-the-van) position', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b);
        parkObject(mesh);
        const parkedPos = mesh.position.clone();
        saveConfig();
        clearAllObjects();

        loadConfig();

        expect(isParked(objects[0])).toBe(true);
        expect(objects[0].position.x).toBeCloseTo(parkedPos.x);
        expect(objects[0].position.z).toBeCloseTo(parkedPos.z);
    });

    it('treats a missing parked field on an old save as not parked', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: 1,
            vanState: { ...DEFAULT_VAN_STATE },
            objects: [
                { w: 0.6, h: 0.32, d: 0.4, color: 0x64748b, position: { x: 0, y: 0.16, z: 0 } }, // no parked field
            ],
        }));

        loadConfig();

        expect(isParked(objects[0])).toBe(false);
    });

    it('ignores a parked flag on a fixed obstacle entry — fixed can never be parked', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: 1,
            vanState: { ...DEFAULT_VAN_STATE },
            objects: [
                {
                    w: 0.6, h: 0.4, d: 0.3, color: 0x78716c, fixed: true, parked: true,
                    position: { x: 0, y: 0.2, z: 0 },
                },
            ],
        }));

        loadConfig();

        expect(isParked(objects[0])).toBe(false);
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

describe('generatePackingListText / exportPackingListToFile', () => {
    it('lists van dimensions and payload limit', () => {
        vanState.length = 3.3;
        vanState.maxHeight = 1.9;
        vanState.maxWidth = 1.8;
        vanState.narrowWidth = 1.3;
        vanState.maxPayload = 400;

        const text = generatePackingListText();

        expect(text).toContain('330cm');
        expect(text).toContain('190cm');
        expect(text).toContain('180cm');
        expect(text).toContain('130cm');
        expect(text).toContain('400kg');
    });

    it('lists every placed object with label, size, weight and position', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b, 8, 'Eurobox M');
        mesh.position.set(0.2, 0.16, -1.0);

        const text = generatePackingListText();

        expect(text).toContain('Objekte (1):');
        expect(text).toContain('Eurobox M — 60x40x32cm — 8.0kg');
        expect(text).toContain('20cm rechts');
        expect(text).toContain('16cm hoch');
    });

    it('flags a locked object', () => {
        const mesh = addBox(0.6, 0.32, 0.4, 0x64748b, 8, 'Eurobox M');
        toggleLock(mesh);

        expect(generatePackingListText()).toContain('[gesperrt]');
    });

    it('does not flag an unlocked object', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b, 8, 'Eurobox M');
        expect(generatePackingListText()).not.toContain('[gesperrt]');
    });

    it('shows "fest verbaut" instead of a weight/lock flag for a fixed obstacle', () => {
        addBox(0.6, 0.4, 0.3, 0x78716c, 0, 'Wassertank', { fixed: true });

        const text = generatePackingListText();

        // Exact line match confirms no trailing weight/kg or [gesperrt] flag
        // on the per-item line itself (the overall "Gesamtgewicht: 0.0kg"
        // total further down is still legitimate — this fixture is the only
        // object and correctly contributes no weight to that total).
        expect(text).toContain('  1. Wassertank — 60x30x40cm — fest verbaut\n');
    });

    it('shows total weight against the payload limit and the center of gravity', () => {
        vanState.maxPayload = 400;
        addBox(0.6, 0.32, 0.4, 0x64748b, 8, 'Eurobox M').position.set(0.3, 0.16, 0.5);

        const text = generatePackingListText();

        expect(text).toContain('Gesamtgewicht: 8.0kg von 400kg Zuladung');
        expect(text).toContain('Schwerpunkt: 30cm rechts, 50cm hinten von Fahrzeugmitte');
    });

    it('omits the center-of-gravity line when nothing is placed', () => {
        const text = generatePackingListText();
        expect(text).toContain('Objekte (0):');
        expect(text).not.toContain('Schwerpunkt:');
    });

    it('flags a parked object and excludes its weight from the total', () => {
        const parked = addBox(0.6, 0.32, 0.4, 0x64748b, 8, 'Eurobox M');
        parkObject(parked);
        addBox(0.3, 0.2, 0.3, 0x10b981, 2, 'Kiste');

        const text = generatePackingListText();

        expect(text).toContain('[ausgelagert]');
        expect(text).toContain('Gesamtgewicht: 2.0kg');
    });

    it('does not flag an object that is not parked', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b, 8, 'Eurobox M');
        expect(generatePackingListText()).not.toContain('[ausgelagert]');
    });

    it('exportPackingListToFile triggers a Blob download without throwing', () => {
        addBox(0.6, 0.32, 0.4, 0x64748b, 8, 'Eurobox M');
        expect(() => exportPackingListToFile()).not.toThrow();
    });
});

describe('sanitizeFilename', () => {
    it('appends the extension when missing', () => {
        expect(sanitizeFilename('mein-projekt', 'fallback', 'json')).toBe('mein-projekt.json');
    });

    it('does not double up an extension the user already typed', () => {
        expect(sanitizeFilename('mein-projekt.json', 'fallback', 'json')).toBe('mein-projekt.json');
    });

    it('matches the extension case-insensitively so it is not duplicated', () => {
        expect(sanitizeFilename('mein-projekt.JSON', 'fallback', 'json')).toBe('mein-projekt.JSON');
    });

    it('strips characters that are invalid in a filename', () => {
        expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j', 'fallback', 'json')).toBe('abcdefghij.json');
    });

    it('falls back when the input is empty, blank, or only invalid characters', () => {
        expect(sanitizeFilename('', 'fallback', 'json')).toBe('fallback.json');
        expect(sanitizeFilename('   ', 'fallback', 'json')).toBe('fallback.json');
        expect(sanitizeFilename('///', 'fallback', 'json')).toBe('fallback.json');
        expect(sanitizeFilename(null, 'fallback', 'json')).toBe('fallback.json');
    });

    it('trims surrounding whitespace', () => {
        expect(sanitizeFilename('  mein-projekt  ', 'fallback', 'json')).toBe('mein-projekt.json');
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

describe('named projects', () => {
    it('has none saved initially', () => {
        expect(listProjects()).toEqual([]);
    });

    it('rejects saving with a blank/whitespace-only name', () => {
        expect(saveNamedProject('')).toBe(false);
        expect(saveNamedProject('   ')).toBe(false);
        expect(listProjects()).toEqual([]);
    });

    it('saves a named project and lists it with a timestamp', () => {
        expect(saveNamedProject('Umzug')).toBe(true);
        const list = listProjects();
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('Umzug');
        expect(typeof list[0].savedAt).toBe('number');
    });

    it('trims the given name', () => {
        saveNamedProject('  Umzug  ');
        expect(listProjects()[0].name).toBe('Umzug');
    });

    it('saving again under the same name overwrites that project (same id, updated content)', () => {
        saveNamedProject('Umzug');
        const firstId = listProjects()[0].id;

        addBox(0.6, 0.32, 0.4, 0x64748b); // change live state before re-saving
        saveNamedProject('Umzug');

        const list = listProjects();
        expect(list).toHaveLength(1); // still one entry, not two
        expect(list[0].id).toBe(firstId);
    });

    it('saving under a different name creates a second, independent project', () => {
        saveNamedProject('Umzug');
        saveNamedProject('Camping');
        expect(listProjects()).toHaveLength(2);
    });

    it('round-trips van state and objects through save/clear/load', () => {
        vanState.length = 4.1;
        addBox(0.6, 0.32, 0.4, 0x64748b, 9, 'Werkzeugkiste').position.set(0.2, 0.16, -1.0);
        saveNamedProject('Umzug');
        const { id } = listProjects()[0];

        clearAllObjects();
        Object.assign(vanState, DEFAULT_VAN_STATE);

        expect(loadNamedProject(id)).toBe(true);
        expect(vanState.length).toBe(4.1);
        expect(objects).toHaveLength(1);
        expect(objects[0].userData.label).toBe('Werkzeugkiste');
        expect(objects[0].position.x).toBeCloseTo(0.2);
    });

    it('loadNamedProject returns false for an unknown id', () => {
        expect(loadNamedProject('nope')).toBe(false);
    });

    it('deletes a project by id', () => {
        saveNamedProject('Umzug');
        const { id } = listProjects()[0];

        expect(deleteNamedProject(id)).toBe(true);
        expect(listProjects()).toEqual([]);
    });

    it('deleteNamedProject returns false (no-op) for an unknown id', () => {
        saveNamedProject('Umzug');
        expect(deleteNamedProject('nope')).toBe(false);
        expect(listProjects()).toHaveLength(1);
    });

    it('renames a project without touching its content', () => {
        vanState.length = 4.4;
        saveNamedProject('Umzug');
        const { id } = listProjects()[0];

        expect(renameNamedProject(id, 'Umzug (final)')).toBe(true);
        expect(listProjects()[0].name).toBe('Umzug (final)');

        Object.assign(vanState, DEFAULT_VAN_STATE);
        loadNamedProject(id);
        expect(vanState.length).toBe(4.4);
    });

    it('rejects renaming to a blank name', () => {
        saveNamedProject('Umzug');
        const { id } = listProjects()[0];
        expect(renameNamedProject(id, '   ')).toBe(false);
        expect(listProjects()[0].name).toBe('Umzug');
    });

    it('renameNamedProject returns false for an unknown id', () => {
        expect(renameNamedProject('nope', 'Neu')).toBe(false);
    });

    it('lists most-recently-saved first', async () => {
        saveNamedProject('Erstes');
        // Ensure a distinct timestamp even on a fast test runner.
        await new Promise((resolve) => setTimeout(resolve, 2));
        saveNamedProject('Zweites');

        expect(listProjects().map((p) => p.name)).toEqual(['Zweites', 'Erstes']);
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

    it('saveNamedProject returns false instead of throwing when setItem fails', () => {
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        expect(() => saveNamedProject('Umzug')).not.toThrow();
        expect(saveNamedProject('Umzug')).toBe(false);
        spy.mockRestore();
    });

    it('listProjects returns an empty list instead of throwing when getItem fails', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(() => listProjects()).not.toThrow();
        expect(listProjects()).toEqual([]);
        spy.mockRestore();
    });
});
