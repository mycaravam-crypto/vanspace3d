// Standard object library. Data-driven so the UI can render an arbitrary
// number of entries without a hand-written button + listener per item —
// dimensions are the common Eurobehälter (Euro stacking container) sizes
// built on the 600x400mm footprint (ISO 6780), plus a 400x300mm half-size.
// All dimensions in meters. `weight` is an illustrative default payload
// weight in kg (empty box + typical contents) — actual placed objects can
// be given a different weight via the "Gewicht neuer Objekte" field.
// 3D colors are picked to be distinct from each other *and* from the van's
// own structural geometry (van.js's zone/arch materials are slate grays and
// 0x3b82f6 blue) — the old near-monochrome slate palette made crates read as
// indistinguishable dark silhouettes against the van and against each other.
// Each color is a saturated shade from its `accent`'s Tailwind family so the
// 3D box and its sidebar list entry read as the same color.
export const STANDARD_LIBRARY = [
    {
        id: 'eb-s', label: 'Eurobox S', w: 0.6, h: 0.17, d: 0.4, color: 0x0ea5e9, accent: 'sky', weight: 3,
    },
    {
        id: 'eb-m', label: 'Eurobox M', w: 0.6, h: 0.32, d: 0.4, color: 0x2563eb, accent: 'blue', weight: 8,
    },
    {
        id: 'eb-l', label: 'Eurobox L', w: 0.6, h: 0.42, d: 0.4, color: 0x6366f1, accent: 'indigo', weight: 12,
    },
    {
        id: 'eb-m-half', label: 'Eurobox M (halb)', w: 0.4, h: 0.32, d: 0.3, color: 0x06b6d4, accent: 'cyan', weight: 5,
    },
    {
        id: 'wood-small', label: 'Bodenplatte', w: 1.2, h: 0.02, d: 0.8, color: 0xd97706, accent: 'amber', weight: 4,
    },
];
