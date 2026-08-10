import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';

const { objects } = await import('./state.js');
const { computeTotalPrice, refreshTotalPrice } = await import('./price.js');

function boxWithPrice(price, extra = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), new THREE.MeshStandardMaterial());
    mesh.userData.price = price;
    Object.assign(mesh.userData, extra);
    return mesh;
}

beforeEach(() => {
    objects.length = 0;
    document.body.innerHTML = '<span id="total-price"></span>';
});

describe('computeTotalPrice', () => {
    it('is 0 when there are no objects', () => {
        expect(computeTotalPrice()).toBe(0);
    });

    it('sums the price of every placed object', () => {
        objects.push(boxWithPrice(10), boxWithPrice(5.5));
        expect(computeTotalPrice()).toBe(15.5);
    });

    it('ignores non-finite or negative prices in the sum', () => {
        objects.push(boxWithPrice(10), boxWithPrice(NaN), boxWithPrice(-5));
        expect(computeTotalPrice()).toBe(10);
    });

    it('treats a missing price as 0 rather than throwing', () => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), new THREE.MeshStandardMaterial());
        objects.push(mesh); // no userData.price set at all
        expect(computeTotalPrice()).toBe(0);
    });

    it('includes a parked object\'s price, unlike weight/COG', () => {
        objects.push(boxWithPrice(20, { parked: true }));
        expect(computeTotalPrice()).toBe(20);
    });

    it('includes a fixed fixture\'s price, unlike its zero weight', () => {
        objects.push(boxWithPrice(300, { fixed: true, locked: true, weight: 0 }));
        expect(computeTotalPrice()).toBe(300);
    });
});

describe('refreshTotalPrice', () => {
    it('shows "0.00" when nothing is placed', () => {
        refreshTotalPrice();
        expect(document.getElementById('total-price').textContent).toBe('0.00');
    });

    it('formats the total to two decimals', () => {
        objects.push(boxWithPrice(19.999));
        refreshTotalPrice();
        expect(document.getElementById('total-price').textContent).toBe('20.00');
    });

    it('returns the computed total', () => {
        objects.push(boxWithPrice(12.34));
        expect(refreshTotalPrice()).toBeCloseTo(12.34);
    });

    it('does not throw when the DOM readout element is missing', () => {
        document.body.innerHTML = '';
        objects.push(boxWithPrice(5));
        expect(() => refreshTotalPrice()).not.toThrow();
    });
});
