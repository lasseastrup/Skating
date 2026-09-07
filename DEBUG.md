# DEBUG.md — Coping

Running log of what each phase chose and why. Newest phase on top. Read alongside the debug
overlay (4-finger tap, backquote key, or `?debug=1`).

---

## Phase 3 — Air

**Status:** complete. Ollie, trick rose, spin, grab, coyote time, predictive landing alignment,
auto-revert and a minimal bail. Determinism holds. Scripted: 40/40 half-pipe airs with held spin,
48/48 trick pops off the lip, every flat trick lands at 0° misalignment.

### What was built

| Area | File | Note |
|---|---|---|
| States | `src/sim/SkateWorld.ts` | Riding, Pushing, **Pop**, **Air**, **Bailed** (Skater XL names; Setup/BeginPop/Release/Impact split comes in Phase 6) |
| Ollie | | Release after a hold ≥ 120 ms. Height 0.4 + 1.0·charge (clamped 0.4–1.4 m). 40 ms pop with tail-down pitch, then leave along the surface normal |
| Trick rose | | 8 wedges by stick angle at takeoff: fs/bs 180, kickflip, 360 shuv and the four diagonal combos. Deadzone 0.35 = plain ollie |
| Channels | | Body **spin** about the frame normal; board-relative **flip** (long axis), **shuv** (normal) and **pitch** (right axis). Rates set so the trick completes in 80% of predicted air time |
| Held spin | | Stick held in the air after the trick adds 360°/s until the landing assist starts |
| Grab | | Button pressed in the air: halves held spin, tucks the pelvis. Never damps the trick's own spin |
| Coyote | | 100 ms after leaving a lip without popping, a release still pops along the last ground normal |
| Landing | | Two horizons: heading aligns to velocity (mod 180) from 250 ms out, frame normal and flip/shuv catch from 120 ms out. Snap ≤ 45°, scrub 45–70°, bail > 70° or inverted |
| Auto-revert | | Landing fakie silently turns the board round unless the button is held |
| Bail | | 0.9 s down: speed ×0.3 then decays, pelvis drops, lean 70°. Phase 6 replaces with a weight ramp |
| Placeholder | `src/render/SkaterPlaceholder.ts` | Mid-trick the feet hold the body frame instead of the flipping board |

### Decisions

**Tap vs ollie.** The brief has the button double as the manual pump (press timing) and the ollie
(release). Taken literally every pump tap is also a 0.4 m hop off the bottom of the transition.
Resolution: a release after a hold shorter than 120 ms is a tap and does not pop. The effective
ollie range is therefore 0.74–1.37 m (charge is 0.34 at 120 ms). Flag if the 0.4 m floor matters.

**Spin is about the frame normal, not world up.** On the flat that is the same axis. Off a vert
wall the body axis is the wall normal, and spinning about it is what turns "up the wall" into
"down the wall" (a 180 air comes back in forward). Spinning about world up on a wall tipped the
board instead and no alignment could undo it.

**The frame normal is frozen in the air.** A gentle levelling toward world up looked plausible
but, combined with spin about the tilted normal and the rotation back onto the wall, it twisted
the heading by an unpredictable amount (the composition of the two rotations has a net twist about
the normal). Freezing it removed the twist; the last 120 ms blend puts the board on the surface.

**Two landing horizons.** The brief's 120 ms is right for the *normal* blend: touchdown looks
intentional and not corrected. Heading needs longer: a held spin frozen 120 ms out can be 90° from
the nearest 0/180 and a 750°/s snap reads as a glitch. Heading alignment starts 250 ms out at
360°/s, which covers any residual ≤ 90°. When it starts it also takes over any rotation the trick
still owes; running both pushed past 180 and overshot.

**Prediction penetration scales with fall speed.** Both horizons rejected a surface once the
predicted point was more than 0.6 m below it. At 10 u/s the 250 ms point is 2.5 m below the
ground, so the assist switched off precisely when falls got fast, the held spin resumed, and the
skater landed wherever the spin left it. Every bail in the diagnostic log had "no assist active"
on the step before contact. Penetration allowance is now 1.5× the distance travelled in the
look-ahead, and the broadphase reach grew to match.

**Steep surfaces count for heading, not for landing.** Coming back down a vert wall you cannot
land on it (n.y < 0.15), but it is the surface you are aligning to, so the heading horizon sees it
and alignment starts on time.

**Landing rewards transitions.** A sliver of absorbed normal speed (12%, scaled by how un-flat
the surface is) rolls forward. Nothing on the flat, a little extra in a bowl.

**Bails are rare by construction.** With a 250 ms heading assist reaching 88°, the 70° contact
rule only fires when contact was not predicted (an edge, a coping seam) or a flip is still
mid-rotation at such a contact. That is the Assist Charter's intent: bail when genuinely upside
down, otherwise land.

### Measurements (scripted, 120 Hz, playground manifold)

| Test | Result |
|---|---|
| Ollie, hold 0.08 / 0.15 / 0.35 / 0.6 s | no pop / 0.80 m / 1.37 m / 1.37 m. Air 0.54–0.71 s. Max per-step move 8 cm (no teleport) |
| Kickflip, fs 180, 360 shuv, fs/bs kickflip on the flat at 7 u/s | all land, 0° misalignment, speed 6.69 preserved |
| fs 180 with button held through landing | lands fakie at −6.69 (auto-revert suppressed) |
| fs 180 then stick held for extra spin | lands at 0° via the assist |
| Coyote: roll off the deck holding, release 60 ms later | pops (v_y −1.5 → +2.7); release at 250 ms does not |
| Half-pipe, 40 airs, stick held half the time / always | **40/40** and **40/40** clean |
| Half-pipe, 48 random trick pops off the lip (4 seeds) | **48/48** clean, worst misalignment 30° |
| Vert launch at 14.5, hold spin whole air | lands back in the transition at 10.9 u/s |
| 40 random drops over the park | 47 landings, 0 bails, 0 fall-throughs |

### Known gaps, on purpose

- **A pop off a vert lip is horizontal.** The pop goes along the surface normal, so at the lip it
  fires you toward the flat and you land on it. Real lip tricks are coping states (Phase 4/6).
- **Bail is a stub.** Speed drop, pelvis drop, 70° lean, 0.9 s. The per-group weight ramp is Phase 6.
- **Feet mid-trick** hover at the body frame rather than leaving per foot (Phase 6 IK weights).
- **Camera** still clips through ramp bodies on walls and has no air behaviour yet.

### Phone checklist for this phase

1. Roll on the flat, hold the right half, release. You should pop cleanly; longer hold, higher.
   A quick tap should do nothing but pump.
2. Release with the stick pushed up: kickflip. Right: frontside 180, and you keep rolling forward.
   Down: 360 shuv. Diagonals combine.
3. Hold right through a big half-pipe air. You should spin and always come back in.
4. Roll off a deck holding the button and release just after: you pop off the edge.
5. Press and hold the button in the air: the capsule tucks and spin slows.

---

## Phase 2 — The Surface Manifold ★

**Status:** complete. All four acceptance cases pass in scripted runs. Determinism holds with the
full playground manifold. Draw calls 13, tris 8.2k in the playground.

### What was built

| Area | File | Note |
|---|---|---|
| Surface contract | `src/sim/Surface.ts` | `project(p, out) → {point, normal, u, v, h, margin}` and `curvature(u, v, dir)` |
| Plane | `src/sim/surfaces/Plane.ts` | Bounded, with holes. Ground, decks, vert extensions, ledge tops |
| Cylinder section | `src/sim/surfaces/Cylinder.ts` | Quarter pipes, half-pipe transitions, bowl walls. Concave or convex |
| Torus section | `src/sim/surfaces/Torus.ts` | Bowl corners. Two principal curvatures |
| Spline extrusion | `src/sim/surfaces/Spline.ts`, `Trough.ts` | Catmull-Rom path, Newton closest-point, circular trough profile |
| Bounds | `src/sim/surfaces/Bounds.ts` | Rect and annular-sector parametric bounds, used for edges and holes |
| Compound | `src/sim/surfaces/Compound.ts` | Surfaces + declared adjacency + spatial hash of AABBs |
| Park builder | `src/sim/Park.ts` | Quarter pipe / bowl corner / trough specs → surfaces with exact shared seams and ground holes |
| Playground data | `src/sim/Playground.ts` | Shapes as numbers. Sim and visuals both build from it |
| Controller | `src/sim/SkateWorld.ts` | Riding on the manifold, handoff, detach, air, landing, pumping |
| Visuals | `src/scenes/PlaygroundScene.ts` | Ground grid with holes, half-pipe, trough mesh sampled from the primitive |

The playground gained a **half-pipe** (two 2.4 m transitions, 5 m flat) for the pumping acceptance
and an **S-channel** for the spline extrusion. The rail is still visual only until Phase 4.

### Decisions

**`margin` is the handoff signal, `h` is the contact signal.** Every projection reports a signed
distance to the primitive's nearest parametric edge (positive inside) and a signed height above
the surface. Grounded handoff: while the current surface's margin is ≥ −1 cm it keeps us, unless a
neighbour is inside its bounds *and* we have sunk 5 cm into it (the hysteresis from the brief).
Once past our edge, the neighbour with the largest margin takes over; if none claims us we are in
the air. This makes seams exact when primitives are bounded exactly at the shared edge, which the
park builder guarantees, and still tolerates overlaps.

**Both rules also require |h| to be small.** A cylinder's angular range or a trough's φ range is
"inside bounds" for points miles away radially, so without a height window a distant channel could
claim the skater through the overlap rule. First run did exactly that.

**Ground is one plane with holes.** Each ramp footprint and the channel strip are holes in the
ground plane's bounds, so the ground never overlaps a transition and the flat→transition seam is a
true shared edge with a matching normal. The visual ground is a 2 m grid with holed cells removed.

**Lips are edges, not seams.** Vert extension → deck is a 90° corner. They are not declared
adjacent. Riding up past the lip leaves the vert's bounds with nothing to hand off to: air. Rolling
off the deck edge: air. Dropping in is therefore "fall a bit, land on the transition, keep the
tangential velocity", which is what the drop-in test shows (0.39 s in the air, land at 7.8 u/s,
roll out at 6.3). Phase 3 will make the body sell it; the physics is already right.

**Detach is one inequality.** `N = κ·v² + g·n.y`. Attached while N ≥ −0.6 m/s² (the slack keeps
vertical walls, where N is exactly 0, attached so you can roll up a vert, stop and roll back
fakie). Launching off a lip and getting spat out past vertical both fall out of this.

**Speed is a signed scalar; fakie is negative speed.** The frame keeps pointing where the nose
points; coming back down a wall reverses the sign. Pushing is gated to speed ≥ −0.3 so it doesn't
fight a fakie roll (first run: it did, and the half-pipe start was chaos).

**Frame transport is projection plus a rate clamp.** New normal from the analytic projection,
rotated toward at most 20 rad/s; tangent from the nose–tail probe chord re-orthogonalised. No
80 ms low-pass any more: on analytic surfaces there is no probe jitter to filter, and a time
constant that long lagged the normal by 20°+ in a 2.4 m transition at speed. The rate clamp is
the anti-fling guard the brief asks for.

**Pumping is constant energy per pass.** The brief says energy ∝ curvature × speed. Read as a
power (energy per second) that gives acceleration `a = pumpEff·κ·factor`, independent of speed.
Two other readings were tried and rejected by measurement: `a ∝ κ·v²` ran away to 44 u/s with no
input; `a ∝ κ·v` still ran away because there is no friction in the air. With `a ∝ κ`, friction
(∝ v) balances the pump and the half-pipe has a stable equilibrium. Timing: a pass begins when κ
rises above 0.12/m; a press within 150 ms of that moment gives factor 1.0, otherwise 0.7.
Curvature is capped at 0.45/m for pumping so a tight channel is not a free energy source.

**Landing (Phase 2 version).** Accept a surface when the board centre is within [−0.6, +0.09] m of
it, inside its bounds by the same 1 cm slack as grounded riding (a looser landing tolerance
re-caught the lip edge and froze the skater there), not steeper than n.y ≥ 0.15, and either moving
into it or already below it. The "already below it" clause matters: a skater that pushes off a
deck approaches the transition at a grazing angle with velocity pointing *away* from the concave
surface while still passing through it. Without it the drop-in fell through the world.
Tangential velocity survives, the normal part is absorbed into the pelvis spring. Frame snaps;
Phase 3 blends it 120 ms early.

### Measurements (scripted, 120 Hz, playground manifold)

| Acceptance | Result |
|---|---|
| Flat → transition seam at 8 u/s | max normal change 1.67°/step vs 1.39°/step steady-state on the cylinder; up to 1.37 m, back down fakie |
| Drop in from the QP deck at 1.5 u/s | 0.39 s air, land on transition at 7.8 u/s, roll out onto the flat at 6.3 |
| Half-pipe from a standing start, timed pumps | above coping after **3 oscillations** (10.8 s) |
| Half-pipe from a standing start, no button | above coping after 10.5 oscillations; equilibrium just at the lip |
| Half-pipe, no input, from 9 u/s (speed floor) | settles 10.5–11.3 u/s, peaks 2.84 m (coping 2.7). Keeps oscillating forever |
| Half-pipe, timed pumps, from 9 u/s | settles 13.5–14.5 u/s, peaks 2 m above coping |
| Torus bowl corner, shallow entry at 7.9 u/s | exits at 9.0 u/s (+14%, auto-pump), heading turned 40°, max frame step 2.2° |
| Lip launch at 14 u/s | peak 1.35 m above coping, lands in the transition, rolls out fakie at 8.9 |
| S-channel, no input 20 s | bounded: max 9.3 u/s, 1.2 s airborne total, no NaN |

Pump gain sweep (auto / timed equilibrium flat speed): 8 → 10.5 / 12.7; 12 → 13.4 / 17.2;
16 → 16.5 / 21. Chose 9: auto sits at the coping, timing earns the air.

### Known gaps, on purpose

- **Landing pose.** Frame snaps on touchdown and the board stays level in the air. Phase 3.
- **The bowl corner ends in air.** The quarter-torus has straight θ edges with nothing beyond them.
  A real bowl continues into a wall; Phase 7's park will. Approach it from inside the corner.
- **No collision with the sides of ramps or the rail.** Riding into a QP's extrusion cap passes
  through it. Collision mercy is Phase 3+.
- **Spline projection is Newton-refined, not closed-form.** Converges to ~1e-6 m in 4 iterations
  from a 12-samples-per-segment table. Good enough to call exact.

### Phone checklist for this phase

1. Ride at the quarter pipe from the flat. The transition should feel like one surface, no bump.
2. Ride up, stall, roll back fakie. The board should not spin round.
3. Spawn faces the props; go left of the rail to the half-pipe (z ≈ −18). Do nothing: you should
   keep oscillating at about coping height forever. Tap the button as you enter each transition:
   you should start flying out above the coping.
4. Roll off a deck. You fall, land in the transition, and roll out fast.
5. Ride into the bowl corner from inside it at a shallow angle. It should carry you round.

---

## Phase 1 — Rolling

**Status:** complete on flat ground. Typecheck clean, determinism passes with the real controller,
draw calls 11 (main) / 13 (playground) of 80. Feel has been checked numerically and needs a phone.

### What was built

| Area | File | Note |
|---|---|---|
| Controller | `src/sim/SkateWorld.ts` | Kinematic: position, velocity, surface frame (normal/tangent/binormal), three probes, filtered normal |
| Surface | `src/sim/Surface.ts` | `RideSurface.project(point) → closest point + normal`. Only `PlaneSurface` so far |
| Tuning | `src/sim/Tuning.ts` | Every feel constant, commented with units |
| Placeholder skater | `src/render/SkaterPlaceholder.ts` | Capsule pelvis on the height spring, two stick legs to board-space foot goals, one-call board mesh |
| Camera | `src/render/CameraRig.ts` | Position spring + look spring, FOV 60→78, roll ≤6°, lead, look-rate clamp |
| Overlay | | New rows: state, speed, yawRate, surface, grounded, normal, tangent, charge, push, lean, pelvis, odometer. New `boost 14` button |

The Phase 0 `StubWorld` is deleted. Both scenes run `SkateWorld`.

### Decisions

**Board is the authority; the pelvis is a second body solved onto it.** `SkateWorld` owns the
board transform. The pelvis is its own `KinematicBody` whose transform is computed from the board
frame, the pelvis spring height, lean and weight shift, every step. Both are hashed for
determinism. Legs are solved render-side from the *interpolated* board and pelvis, so they never
lag the display.

**Carving preserves speed and re-aims it.** There is no lateral velocity state. Each step the
heading rotates by `yawRate·dt` and velocity is rebuilt as `tangent × speed`. The board cannot
drift by construction. The cost of a carve is a separate term, `speed *= 1 − carveDrag·yawRate²·dt`,
made quadratic after the first tuning pass so gentle carves are nearly free and tic-tacs are not.
Linear drag stalled a figure-eight in six seconds.

**Turn rate: `base / (1 + speed/ref)`, scaled by an authority ramp near rest.** Measured radii at
full stick: 1.6 m at 2 u/s, 3.9 m at 5, 5.2 m at 8, 13.2 m at 14. The authority ramp keeps 35% of
steering at a standstill so you can tic-tac out of a stop.

**Gravity is already split.** `speed += −g·tangent.y·dt`. On the flat this is exactly zero; on
Phase 2 transitions it is what makes dropping in work with no extra code. `g = 22`, per the
Phase 3 note that skate games run at roughly 2× real gravity.

**Auto-push is a state with a contact window.** Below 5.5 u/s on flat ground, stick not held
back, no crouch, the controller enters `Pushing` for 0.75 s and applies acceleration only between
22% and 50% of the cycle (~3 u/s per push). Cruise settles at 5.5–7 u/s. `pushPhase` is the
animation hook: the placeholder swings the back foot to the ground and strokes it.

**Three probes, filtered normal, project-then-offset.** Nose/centre/tail probes at ±0.4 m. Normal
is the weighted probe blend low-passed with `1 − exp(−dt/0.08)`; tangent is the nose–tail chord
re-orthogonalised against the filtered normal. Position is the centre projection plus ride height
along the normal, in that order.

**Lean uses real gravity.** `atan(speed·yawRate / 9.81)`, clamped to 0.6 rad. The board world
runs 2× gravity but the body should read like a person leaning.

**Camera whip is clamped on look direction, not position.** After the look spring updates, the
change in look *direction* is limited to 2.4 rad/s and the look point rebuilt at the same
distance. The position spring is untouched so framing stays soft. Camera runs on render dt,
clamped at 50 ms, because it is display, not simulation.

**Foot goals are ±0.2 m along the deck, ±0.06 m across.** The Rig Contract says ±8.5 cm along.
That reads as a typo for a standing stance (a real stance is 35–45 cm apart) and looks like
knock-knees on the placeholder. Flagging it: if ±8.5 cm was intentional, change `footAlong` in
`Tuning.ts`.

### Measurements (scripted, 120 Hz sim, no renderer)

| Test | Result |
|---|---|
| Coast from 8 u/s, stick back | 8.0 → 6.5 → 5.2 → 4.1 → 3.2 → 2.4 over 5 s |
| Cruise from rest, stick neutral | pushes to 6.7 by 4 s, holds 5.5–7.1 |
| Figure-eight, 70% stick alternating 3 s | holds 5.3–7.1 u/s indefinitely, 6 pushes / 12 s |
| Crouch 0.6 s then release | pelvis 0.91 → 0.56, back to 0.91 in ~0.3 s |
| NaN check after 12 s of figure-eight | none |

Headless render gate: cpu work ≈5 ms/frame under SwiftShader (mostly GL submit), determinism OK.

### Known gaps, on purpose

- **Props are not rideable.** The playground quarter pipe, rail and bowl are visual only. The
  skater rides through them. Phase 2 makes them surfaces.
- **No collision, no air, no ollie.** Button hold crouches; release drains the charge and nothing
  else. Phase 3.
- **Top speed on the flat is ~7 u/s.** There is no hill, so the 8-vs-14 speed read is only
  testable with the overlay's `boost 14` button until Phase 2 gives us transitions.

### Phone checklist for this phase

1. Carve a figure-eight with the stick at about 70%. It should hold speed without you doing
   anything else, with a push every couple of seconds.
2. Let go completely. You should coast for a long time, then push, then coast.
3. Pull the stick back. Pushing stops and you glide to a halt.
4. Tap `boost 14`, then carve. Turns should open up to wide arcs and the camera should widen and
   roll a few degrees into the turn without whipping.
5. Hold the button. The capsule sinks; release and it pops back with a small overshoot.

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
| Placeholder sim | `src/sim/StubWorld.ts` | Drove a box around so the loop had something to move. Deleted in Phase 1. |
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
