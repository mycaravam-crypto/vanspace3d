# VanSpace 3D

A web app for planning the cargo/storage layout of a vehicle (van, camper, trailer, …) in 3D: pick or define a vehicle, drop objects into it, drag them around, check for collisions, and save the plan.

This repository currently contains two things:

| Path | What it is |
|---|---|
| [`PLAN.md`](PLAN.md) | The original technical concept for the full application (German) — target stack, data model, and the planned development phases. |
| [`prototype/`](prototype/) | A working, browser-based prototype that implements and validates the core 3D interaction model end to end. **Start here** — see [`prototype/README.md`](prototype/README.md). |

## Quick start

```bash
cd prototype
npm install
npm run dev
```

Then open the printed local URL. See [`prototype/README.md`](prototype/README.md) for features, keyboard shortcuts, architecture, and how to run the test suite.

## Relationship between the two

`PLAN.md` describes the intended production architecture: React + TypeScript + React Three Fiber on the frontend, an ASP.NET Core + EF Core backend, and a phased build-out (renderer → vehicle model → object library → collision → snapping → property panel → save/load → vehicle editor → pack optimization → AI assistant).

`prototype/` is a **framework-free vanilla-JS + Three.js + Vite** implementation built to de-risk the hardest part of that plan first — the 3D interaction model (drag & drop, collision detection, grid snapping, rotation) — before committing to the full stack. It already covers, in a browser-only form (no backend, `localStorage`/JSON-file instead of a database):

- Phase 1–2 (renderer + vehicle model): a parametric van shape (wheel arches, front/rear width split)
- Phase 3 (object library): a data-driven standard object library + custom object generator
- Phase 4–5 (collision + snapping): 5cm grid snapping with per-axis collision rollback
- Phase 6 (property panel, partial): weight per object, live center-of-gravity readout, lock flag
- Phase 7 (save/load, partial): `localStorage` autosave + JSON export/import instead of a backend/DB

Not yet implemented: the ASP.NET Core backend, multi-vehicle/multi-project management, a real vehicle editor UI, pack optimization, and the AI assistant (phases 8–10).

## Language note

The application UI and `PLAN.md` are in German; code, comments, commit messages, and this documentation are in English.
