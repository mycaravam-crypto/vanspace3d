// Vehicle presets — one-click starting points for the Laderaum sliders.
// All figures (cargo length/height/width, wheel-arch narrowing, typical
// payload) are illustrative approximations for common panel-van cargo
// compartments, not exact manufacturer spec sheets — actual dimensions vary
// by model year, roof height, and wheelbase variant. Same "illustrative
// default" spirit as STANDARD_LIBRARY's weights in library.js. Dimensions in
// meters, maxPayload in kg; keys match vanState (state.js) so a preset can be
// applied with a plain Object.assign.
export const VEHICLE_PRESETS = [
    {
        id: 'caddy-maxi',
        label: 'VW Caddy Maxi',
        length: 2.0,
        frontLength: 0.6,
        maxHeight: 1.25,
        maxWidth: 1.7,
        narrowWidth: 1.22,
        archHeight: 0.35,
        maxPayload: 650,
    },
    {
        id: 'transporter-t6',
        label: 'VW Transporter (kurz)',
        length: 2.6,
        frontLength: 1.0,
        maxHeight: 1.41,
        maxWidth: 1.7,
        narrowWidth: 1.24,
        archHeight: 0.35,
        maxPayload: 1000,
    },
    {
        id: 'ducato-l2h2',
        label: 'Fiat Ducato L2H2',
        length: 3.12,
        frontLength: 1.4,
        maxHeight: 1.94,
        maxWidth: 1.87,
        narrowWidth: 1.42,
        archHeight: 0.4,
        maxPayload: 1200,
    },
    {
        id: 'sprinter-l2h2',
        label: 'Mercedes Sprinter L2H2',
        length: 3.6,
        frontLength: 1.7,
        maxHeight: 1.93,
        maxWidth: 1.79,
        narrowWidth: 1.35,
        archHeight: 0.45,
        maxPayload: 1350,
    },
];
