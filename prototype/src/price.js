import { objects } from './state.js';

// Plain sum of every placed object's price — unlike weight/COG (cog.js),
// this deliberately does NOT exclude parked or fixed objects: parking is
// just temporary staging (you still own/paid for the item) and a fixed
// fixture's price is real money spent building it in, even though it
// carries no payload weight.
export function computeTotalPrice() {
    return objects.reduce((sum, obj) => {
        const price = obj.userData.price;
        return sum + (Number.isFinite(price) && price > 0 ? price : 0);
    }, 0);
}

// Recomputes the total price and refreshes the #total-price DOM readout
// (a no-op if that element isn't present, same defensive pattern as
// refreshCenterOfGravity() in cog.js). Returns the computed total.
export function refreshTotalPrice() {
    const total = computeTotalPrice();
    const el = document.getElementById('total-price');
    if (el) el.textContent = total.toFixed(2);
    return total;
}
