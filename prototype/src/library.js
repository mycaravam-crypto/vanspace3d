// Standard object library. Data-driven so the UI can render an arbitrary
// number of entries without a hand-written button + listener per item —
// dimensions are the common Eurobehälter (Euro stacking container) sizes
// built on the 600x400mm footprint (ISO 6780), plus a 400x300mm half-size.
// All dimensions in meters. `weight` is an illustrative default payload
// weight in kg (empty box + typical contents) — actual placed objects can
// be given a different weight via the "Gewicht neuer Objekte" field.
export const STANDARD_LIBRARY = [
    {
        id: 'eb-s', label: 'Eurobox S', w: 0.6, h: 0.17, d: 0.4, color: 0x94a3b8, accent: 'sky', weight: 3,
    },
    {
        id: 'eb-m', label: 'Eurobox M', w: 0.6, h: 0.32, d: 0.4, color: 0x64748b, accent: 'blue', weight: 8,
    },
    {
        id: 'eb-l', label: 'Eurobox L', w: 0.6, h: 0.42, d: 0.4, color: 0x475569, accent: 'indigo', weight: 12,
    },
    {
        id: 'eb-m-half', label: 'Eurobox M (halb)', w: 0.4, h: 0.32, d: 0.3, color: 0x3b82f6, accent: 'cyan', weight: 5,
    },
    {
        id: 'wood-small', label: 'Bodenplatte', w: 1.2, h: 0.02, d: 0.8, color: 0xd97706, accent: 'amber', weight: 4,
    },
];
