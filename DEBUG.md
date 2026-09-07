# DEBUG.md — Coping

Running log of what each phase chose and why. Newest phase on top. Read alongside the debug
overlay (4-finger tap, backquote key, or `?debug=1`).

---

## Phase 0 — Skeleton & Instrumentation

**Status:** complete. Typecheck clean, production build 150 KB gzipped (budget 8 MB),
determinism test passes, draw calls 5 (main) / 7 (playground) of 80.

### What was built

| Area | File | Note |
|---|---|---|
| Fixed-step loop | `src/core/Loop.ts` | 120 Hz accumulator, render-rate draw, `alpha` for interpolation |
| Sim contract | `src/core/Sim.ts` | `SimWorld` interface, `KinematicBody` with prev/curr transforms, transform hashing |
| Input | `src/core/Input.ts` | Floating stick (left half), single button (right half), 4-finger tap, keyboard fallback, scripted replay source |
| Scratch pool | `src/core/Pool.ts` | Module-level Vector3/Quaternion registers; the sim never allocates |
| Renderer | `src/render/Renderer.ts` | DPR cap 2, 0.85 render scale, FXAA, one 1024 shadow map |
| Camera | `src/render/CameraRig.ts` | Rigid follow stub. No orbit controls, ever |
| Overlay | `src/debug/Overlay.ts` | Frame graph, sim/render counters, draw calls, tris, heap, key/value panel, action buttons |
| Determinism | `src/debug/Determinism.ts` | Same scripted input through two fresh worlds, per-step hash compare |
| Scenes | `src/scenes/MainScene.ts`, `PlaygroundScene.ts` | Grey box on grey plane; flat + quarter pipe + rail + bowl corner |
| Placeholder sim | `src/sim/StubWorld.ts` | Drives a box around so the loop has something to move. **Deleted in Phase 1.** |
| Gates | `scripts/perf-check.mjs`, `scripts/screenshot.mjs` | Headless Chromium: throttled sampling, budgets, determinism, screenshots |

### Decisions

**Sim reads exactly one struct.** `InputFrame { stickX, stickY, button }` is the only thing the
sim sees from the outside. Touch, keyboard and the scripted replay all fill the same struct. This
is what makes determinism testable and later replay/ghost features free. The sim is banned from
`Date`, `Math.random`, `performance.now` and the DOM.

**Interpolation is prev→curr, one step behind.** Each body keeps the transform at the start and
end of the most recent step. The renderer displays `lerp(prev, curr, accumulator/dt)`. This costs
one sim step (8.3 ms) of latency and removes all temporal aliasing between the 120 Hz sim and a
60/90/120 Hz display. Slerp for rotation, not nlerp, since we will be spinning boards.

**Stall handling: drop, don't spiral.** Max 8 steps per frame. If the accumulator holds more than
that (tab switch, GC pause, software rasteriser) the excess whole steps are discarded and counted
in `droppedSteps`. Frame deltas above 250 ms are clamped before reaching the accumulator. The
loop also stops on `visibilitychange` so returning to the tab doesn't burn a catch-up burst.

**Draw-call counting spans the post chain.** `renderer.info.autoReset = false`, reset manually at
the top of `GameRenderer.render`, so the overlay's call count includes RenderPass + OutputPass +
FXAA, not just the scene. The post chain costs 3 calls; the scene is the rest.

**8-bit intermediate target, not HalfFloat.** EffectComposer defaults to a HalfFloat target,
which doubles bandwidth on a tile-based mobile GPU. Toon-cel with 3 bands does not need 16-bit
precision in the darks. If banding shows up in Phase 8, this is a one-line change in `Renderer.ts`.

**Pass order: render → OutputPass → FXAA.** FXAA runs on the final sRGB image, which is where its
luma edge detection is designed to operate. Running it on linear HDR first gives worse edges.

**Overlay throttles DOM text to 10 Hz.** The graph canvas redraws every frame (cheap 2D), but
`textContent` writes cause layout, so stats/kv text updates are limited. The kv panel is a
`Map`, so later phases can `overlay.set('surface', id)` from anywhere without touching the overlay.

**Determinism hash is bitwise on the float64s.** FNV-1a over the raw bits of every pos/rot
component, chained across steps, so any difference at any step is caught. The test runs the
sequences *sequentially* (A fully, then B), not interleaved, which is the stronger check: it also
catches state that leaks between instances through module scope (e.g. a misused Pool register).

**Playground dimensions are a contract.** `PLAYGROUND` in `PlaygroundScene.ts` holds the radii,
widths and positions. Phase 2 fits analytic primitives to exactly these numbers; the visual meshes
must not drift from them. Bowl corner parametrisation is documented inline:
`d(φ) = R − r + r·sinφ, y(φ) = r − r·cosφ`, so the floor tangent and the vertical wall come out
exact at φ = 0 and φ = π/2.

**Placeholder body is a box, not a capsule.** The document asks for a capsule-and-sticks
placeholder *from Phase 1*. Phase 0 explicitly says "a grey box on a grey plane", so that is what
this is. Phase 1 introduces the capsule + height spring + leg sticks with the real controller.

### Measurements

Headless Chromium 141, WebGL via SwiftShader (software). GPU-side numbers are **not** a phone.
CPU-side JS numbers, draw calls, triangles and determinism are exact.

| Run | Scene | CPU work / frame | Draw calls | Tris | Dropped steps | Determinism |
|---|---|---|---|---|---|---|
| 4× CPU throttle, 390×844 @3× | main | 3.1 ms | 5 | 28 | many (software raster stalls) | OK, 2400 steps |
| 4× CPU throttle, 390×844 @3× | playground | 3.7 ms | 7 | 272 | many | OK |
| unthrottled, 200×432 @1× | main | 0.36 ms | 5 | 28 | 14 (load) | OK |
| unthrottled, 200×432 @1× | playground | 0.41 ms | 7 | 272 | 10 (load) | OK |

Unthrottled runs are vsync-locked at 16.7 ms intervals with no drops after load. The 4× throttled
run stalls because SwiftShader rasterises a 663×1435 framebuffer on the CPU, which is precisely the
thing a phone GPU does for free. The loop behaved correctly under that stall: it dropped steps
instead of spiralling, and sim time stayed a clean multiple of `SIM_DT`.

Triangle counts are low partly because the follow camera in portrait has a narrow horizontal FOV
and culls most props. Wide diagnostic shot of the playground: 13 calls, 1528 tris.

### Open items carried to Phase 1

- **Real-device frame time.** The 60 fps / 14 ms acceptance needs a Pixel 6a class device, which
  this environment does not have. The harness exists (`npm run check:perf`); run the dev server
  on the LAN and open `?debug=1` on the phone. The overlay turns yellow above 14 ms and red above 16.7.
- **GC in the sim loop.** The heap readout in the overlay is a proxy (Chrome only). A flat heap
  line during play means zero allocation; a sawtooth means something allocates. Currently flat.
- **Camera.** The rigid follow shows frame-to-frame turning as a hard camera yaw. Phase 1 replaces
  it with the spring rig; do not tune anything against this camera.

### How to run

```
npm install
npm run dev            # http://localhost:5173  (add ?scene=playground, ?debug=1)
npm run build          # typecheck + production build → dist/
npm run check:perf     # headless budgets + determinism (LOW_RES=1 CPU_THROTTLE=1 for the JS-cost view)
npm run screenshot     # both scenes with overlay → scratch/*.png
```
