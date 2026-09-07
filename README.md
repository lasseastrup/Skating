# Coping

A mobile-first 3D skateboarding game in Three.js. Toon-cel art. One stick, one button.

- **Stack:** TypeScript, Vite, Three.js. No game engine, no physics engine for the skater.
- **Sim:** fixed 120 Hz, decoupled from render, interpolated for display, deterministic.
- **Controls:** floating stick on the left half of the screen, one button on the right half.
- **Debug overlay:** 4-finger tap, backquote key, or `?debug=1`.

```
npm install
npm run dev              # dev server on the LAN, open on a phone
npm run build            # typecheck + production build
npm run check:perf       # headless perf budgets + determinism gate
npm run build:single     # one-file dist/coping.html for hosting anywhere
```

Scenes: `?scene=playground` (physics test bench, the default until Phase 7) and `?scene=main` (the game, an empty plane for now).

See `DEBUG.md` for the per-phase decision log. Currently at **Phase 3 — Air**.
