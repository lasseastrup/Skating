# DEBUG.md — Coping

Running log of what each phase chose and why. Newest phase on top. Read alongside the debug
overlay (4-finger tap, backquote key, or `?debug=1`).

---

## Phase 8 — Toon-Cel Render & Juice

**Status:** complete. Three toon materials with a three-band gradient map and a rim term, colour
and ambient occlusion baked into vertex colours, inverted-hull outlines on the skater and the board,
a gradient sky with four clouds and a low sun for long shadows, and the whole juice ladder: landing
hitch and trick time dilation, speed lines, grind sparks with a ribbon trail, wheel dust, a blob
shadow, camera kick, haptics. A hair tail on the cap for secondary motion. 38 draw calls, 28k
triangles, 11 materials, determinism holds.

### What was built

| Area | File | Note |
|---|---|---|
| Toon materials | `src/render/Toon.ts` | `MeshToonMaterial` + 3-band `DataTexture` gradient; rim band injected via `onBeforeCompile`; `LEVEL_MAT` (double-sided), `SKATER_MAT`, `BOARD_MAT`, all vertex-coloured |
| Baked colour/AO | `src/render/Toon.ts` | `paint(geo, kind)`: concave surfaces darken toward their crease, props get a contact-shadow band, steel and wood flat; `paintFlat` |
| Outlines | `src/render/Toon.ts` | `outlineMaterial(width)`: back-face hull pushed along the normal before skinning; `addOutline` shares geometry and skeleton |
| Sky | `src/render/Toon.ts` | Inverted gradient sphere, four sprite clouds on one canvas texture |
| Lighting | `src/scenes/SceneBase.ts` | Sun at 24° elevation, warm; sky/ground hemisphere fill; fog to the horizon colour |
| Skater paint | `src/render/rig/Skeleton.ts` | Per-bone vertex colours: shirt with short sleeves, trousers, shoes, skin, cap |
| Hair | `src/render/rig/SkaterRig.ts` | Two Verlet particles off the back of the cap, a 30-triangle tail rewritten per pose solve |
| Juice | `src/render/Juice.ts` | Speed lines (full-screen quad), 192-particle pool for sparks and dust, grind ribbon, blob shadow, camera kick, haptics; diffs sim counters, never writes the sim |
| Loop | `src/core/Loop.ts` | `hitch(s)` freezes sim time, `dilate(scale, s)` scales it; both in wall seconds |
| Sim hooks | `src/sim/SkateWorld.ts` | `pops`, `trickLands`, `lastImpact`, `grindPoint` |

### Decisions

**Three lit materials, colour in the vertices.** Every level mesh shares one double-sided toon
material; the ground's alternating 2 m slabs, the dark creases at the bottom of transitions and
the contact band at the foot of ledges are all vertex colours baked when the mesh is built. The
skater is painted per bone (a cap, a shirt with short sleeves, trousers, shoes), the board per part.
Twelve was the material budget; the scene runs eleven including outlines, sky, clouds and effects.

**Rim as a band, not a glow.** The rim term is a hard `smoothstep` on the fresnel so it reads as
a cel highlight along the silhouette rather than a soft bloom; strength 0.5 on the skater, 0.3 on
the board, 0.12 on the level so concrete stays matte.

**Outlines on the hero only.** Inverted hulls: the same geometry drawn back-faced with vertices
pushed 14 mm (body) / 6 mm (board) along their normals, before the skinning chunk so the hull
follows the bones for free. Two draw calls. The level gets its creases from vertex colour, per the
brief; no edge-detect pass.

**Juice reads counters, never state.** The director diffs `landings`, `trickLands`, `pops`,
`bails` each frame and reads `lastImpact` (absorbed normal speed) to grade the landing: above 4.5
m/s is a hard landing (60 ms hitch, camera kick, a dozen dust puffs, a 30 ms buzz); above 2 m/s a
soft one. A landed trick (anything but a plain ollie, 0.3 s+ of air) dilates time to 0.85× for
200 ms. The hitch and dilation live in the loop as wall-time modifiers of the accumulator, so the
sim still steps at exactly 120 Hz and determinism is untouched.

**Sparks and dust are one Points draw.** A 192-slot ring pool with per-particle kind: sparks are
small, bright, gravity-heavy and short-lived; dust is large, grows, drifts and fades. Sparks come
off the grind contact point three per frame with the ribbon behind them; dust comes off the rear
wheels on hard carves (yaw rate above 0.9 rad/s) and bursts on landings and bails.

**Blob shadow is honest.** On the ground it sits on the ride surface under the board, oriented to
the surface normal. In the air it projects to the floor probe under the skater, shrinking and
fading with height, so you can read where you will land.

**Readability pushes.** Pelvis crouch range 0.34 → 0.40, pop kick 3.2 → 4.2, landing absorb
0.18 → 0.26, so squash and stretch read at thumbnail size; arm arcs widened (air 0.38 → 0.5 out,
0.12 → 0.2 up; riding 0.14 → 0.2 out; balance swing 0.25 → 0.35). The 12 fps stepped sampling
holds up against the outlines: the hull is the same skinned geometry, so it steps with the pose.

### Measurements (island, SwiftShader, 390×844)

| Metric | Value | Budget |
|---|---|---|
| Draw calls | 38 | ≤ 80 |
| Triangles | 28.3k | ≤ 120k |
| Materials | 11 | ≤ 12 |
| Shadow maps | 1 × 1024 | 1 × 1024 |
| Determinism (2400 steps) | OK | |

### Vert control (after the first island sessions)

On a wall the controller behaved like a bead on a wire: the heading was a line on the surface, gravity
only changed the signed speed along it, so an oblique run up a quarter pipe went up its line, stopped,
and rolled back down the *same* line fakie, landing you where you started (0.6 m of travel along the
wall from a 30° entry at 8 u/s). Steering on the wall had the flat's authority, so a carve was 40° at
best, and riding off the end of a transition slammed into the ramp's own side cap. That is the "loss
of control" on vert. What the reference games do, and what the controller now does:

- **Steering authority grows with steepness** (Skate, Tony Hawk's). The yaw rate is multiplied by
  up to 1.9× on a vertical wall. A carve around a bowl is a 180° in under a second in every skate
  game; the flat's turn rate was never meant for it.
- **A held stick is a carve** (Skate). Lateral gravity is allowed to bend the path downhill in
  proportion to how hard the stick is held and how steep the wall is, so leaning into a wall swings
  you around it instead of drawing a straight line up it. Head-on at 8 u/s, stick held on the wall:
  the run now turns 125° on the wall and comes back down *forwards*; a 45° entry with the stick held
  carves 5 m along the wall.
- **A neutral stick going up fast aligns to straight up** (Tony Hawk's). Above the speed needed to
  clear 1.5 m of wall, with no stick input, the heading eases toward straight up the wall at
  1.6 rad/s so the air comes back down onto the ramp. Any stick input overrides it.
- **Running out of speed on a wall is a kickturn** (every game, every skater). When the speed
  along the wall passes through zero on a surface steeper than 57°, the board pivots 180° about the
  normal in 0.15 s (toward the stick, or toward the downhill side) and rolls away forwards. Before,
  the rider came down fakie, which then auto-reverted at the bottom: two silent flips the player
  never asked for.
- **A ramp's own side caps don't stop a rider on that ramp.** Walls carry an owner tag; a rider on
  one of that feature's surfaces ignores them and rides off the side onto the ground instead of
  slamming to a halt against an invisible wall.

The loop tests still pass (plaza → snake → shallow end in 16 s with no bail, roller return with no
pushing), determinism holds.

### Known gaps, on purpose

- Haptics use `navigator.vibrate`, which iOS Safari does not implement; Android gets them.
- The chest-high rim on the level is nearly invisible by design; creases carry the level's form.
- The hair is one tail. Clothes have no separate jiggle: the shirt is the torso mesh.
- Clouds are static billboards; the sky does not change with time of day.

### Phone checklist for this phase

1. Stand still and look: the still should read as a shipped game. Skater outlined, cap, hair tail.
2. Push to top speed: speed lines fade in past 70%. Carve hard: dust off the rear wheels.
3. Ollie off the kicker and land flat: the frame hitches once, the camera dips.
4. Grind the plaza ledge: sparks and an orange ribbon off the edge; phone buzzes if Android.
5. Drop into the bowl: the blob shadow follows you down the wall.

---

## Phase 7 — The Island: One Loopable Park

**Status:** complete. The main scene is now the island: plaza, mini-ramp with spine, kicker, a walled
roll-in chute into a 64°-banked snake run, a two-room sunken pool with a bank between the ends, a vert
half-pipe with an extension, and a roller track back to the plaza. 77 ride surfaces, 31 grind edges,
58 wall segments, 25 draw calls, 25.5k triangles, determinism holds. The loop rides end to end in
scripted tests: plaza → kicker → chute → snake run → shallow end in 11 s with no bail, the rollers
carry the return leg with no pushing, and both pool rooms pump out to the deck.

### What was built

| Area | File | Note |
|---|---|---|
| Park builder | `src/sim/Park.ts` | `kicker`, `roller`, `platform` (stairs + hubba), `bowlRoom` (rounded-rect pool: torus corners, cylinder walls, coping), `bankX`, `trough`, `groundHoleRect`, `linkGround`; quarter pipes take an `extension` |
| Layout | `src/sim/ParkLayout.ts` | `ISLAND`: every number the sim and the meshes share. `buildIslandPark()` wires adjacency and walls |
| Walls | `src/sim/Walls.ts` | `WallSeg` + `crossesWall` segment test; `Compound.walls` in the spatial hash |
| Collision mercy | `src/sim/SkateWorld.ts` | `checkWalls` after the grounded move: pop over a wall you can clear, else slide along it and lose speed |
| Gravity turn | `src/sim/SkateWorld.ts` | Lateral gravity swings the heading downhill as the normal force fades — you can't park on a wall |
| Bounds | `src/sim/surfaces/Bounds.ts` | `RoundedRectBounds` (SDF) for pool floors |
| Channel | `src/sim/surfaces/Trough.ts` | Along-path margin goes negative past the ends; the ground hole strip stops dead at the ends too |
| Meshes | `src/scenes/FeatureMeshes.ts` | Kicker, roller, platform, pool room, bank + side faces, channel cap, adaptive ground grid around holes |
| Scene | `src/scenes/MainScene.ts` | Builds the island once from the spec; fog to hide the horizon |

### Decisions

**The deck is the ground.** Sunken features (pool, snake run, roll-in, bank) cut holes in the ground
plane rather than adding decks on top. Coping sits at y = 0, so anything you roll off the edge of drops
you into a transition, and the ground grid's adaptive subdivision (0.25 m at hole edges) makes the rims
read as curves.

**The snake run is banked, not vertical.** The first channel had a semicircular profile with vertical
rims (ρ = 1.8). Energy conservation made it unrideable: you enter from the deck at ground-level energy,
so every wall climb returns you to the rim, and the auto-pump then fired you out into the plaza. The
channel is now ρ = 3.2, φmax = 64° (still 1.8 m deep): a rider carried to the rim rolls onto the deck
instead of flying, and steering along the channel keeps you in it. Bends have radius ≥ 8 m against a
rim half-width of 2.9 m so the surface never folds. The roll-in feeds along the channel axis, not into
a wall.

**The roll-in is a walled chute.** A flat bank cannot meet a curved channel across its full width, so
the chute is 2 m wide (mismatch at the edges 0.3 m, inside the hand-off tolerance), walled on both
sides, and the rest of the channel's start face is a capped wall. Riding the chute's very edge at
4 u/s hands off cleanly to the channel.

**Pool rooms are as wide as the channel.** The snake run enters the shallow end through its straight
west edge, so both rooms are 5.8 m wide between their corners and the bank between them is exactly
that wide: no void opens beside the bank, and the bank's side walls exist only over the 1.9 m of deck
that actually lies beside it.

**Gravity turn.** The controller has no lateral velocity by design, which let a skater ride along a
vertical rim forever at zero normal force. Now the lateral part of gravity swings the velocity
downhill, weighted from 0 at 11 m/s² normal force to 1 at zero. Riding straight up a wall (binormal
horizontal) is untouched; hanging on a wall is not.

**Collision mercy is a wall test, not a surface test.** Walls are vertical segments (ledge sides, ramp
caps, chute and bank sides, stair faces). After the grounded move, a crossed wall you have the speed to
clear (2.5 u/s + 3 u/s per metre, up to 1.3 m) becomes an ollie with your speed kept; anything else is
a slide along the wall at 55% × |cos| of your speed. The mercy never fires from a stop.

**Kickers are small.** At 2× gravity a 0.65 m kicker needs 5.4 u/s just to reach its lip, which is
near max push speed. They are now 0.37 m (22°, 0.7 m bank): clear at 4 u/s, land 1.5 m out, roll
into the chute.

**Pump efficiency 9 → 11.** With the pool rooms widened, timed pumps across the deep end only just
reached the deck at 9. At 11: auto-pumping in either room slowly builds instead of draining (Assist
Charter: the speed floor), timed pumps climb out of both rooms, the vert wall reaches coping in eight
timed pumps from 4 u/s and stays below it on auto-pump alone. The cost is the mini-ramp: an unsteered
rider ends up 1.5 m above its coping. A `pumpBase` knob (extra accel independent of curvature) exists
at 0 for later balancing.

### Measurements (scripted, 120 Hz)

| Test | Result |
|---|---|
| Plaza → kicker → chute → snake → shallow end (autopilot steering, timed taps) | 10.7 s, arrives at 10.4 u/s, 0 bails, 0 slams |
| Chute edge (z offset 0.9 of 1.0) at 4 u/s | hands off to the channel at 9.1 u/s |
| Roller return, 6 u/s start, no pushing | plaza in 13.7 s at ~5 u/s |
| Deep end across Z, timed pumps from 3 u/s | above deck (+1.33 m) in 13 oscillations |
| Shallow end across Z, timed / auto | +0.63 m in 12 / slowly climbing from −1.48 |
| Vert half-pipe from 4 u/s, timed / auto | coping (3.6 m) in 8 / plateau 2.7 m |
| Mini-ramp from 3 u/s, auto | 2.8 m peak (coping 1.3 m) after 14 oscillations |
| Kicker at 7 u/s | launches at 5.0 u/s, lands 1.3 m out at 4.6 u/s |
| Draw calls / tris (island) | 25 / 25.5k |
| Determinism (2400 steps) | OK |

### Fixed after the first phone test

**The torso flipped through the pelvis every pose solve.** The chest is a Verlet particle held at
a fixed distance from the pelvis anchor. The distance constraint moved `pos` but not `prev`, so every
correction became velocity in the next solve, the ringing grew by roughly 3× per solve, and within a
second the chest was snapping between straight up and straight down on every solve. This was
present since Phase 5 and independent of frame rate; the fix is that constraints move `prev` by the
same delta (a constraint is a displacement, never a velocity), plus a guard that resets a particle that
has blown up. `constrainRange` (hands) got the same treatment.

### Camera rework (after the first island sessions)

The Phase 1 rig sprang the camera's *position* toward a point behind the board's nose. On the
island that showed three faults the playground never exposed: riding fakie put the camera in front
of the skater, the camera climbed vert walls and bowl transitions with the skater (looking down at
them from above the coping), and a half-pipe reversal ran the skater straight through the camera.
The rig is rebuilt around what the reference games do:

- **Heading follows the direction of travel, not the nose** (Skate, Tony Hawk's). The camera's
  yaw is a damped spring on the travel heading with a rate cap: 2.6 rad/s for carves, rising to
  7.5 rad/s when travel reverses so a rider rolling back down a wall is orbited, not overtaken.
  Below 1.2 u/s the heading holds. Spins, boardslides and fakie never swing the camera.
- **Rigid horizontal offset, soft vertical.** The camera sits exactly `back` metres behind the
  heading (only the distance eases), so the skater can never pass through it. Height is a slow
  spring (ω 2.2) off the last *level* floor the skater stood on: airs, wall rides and vert are
  framed by pitching up from the bottom of the ramp, like a filmer on the flat, not by bobbing
  with the jump (Journey's rule: never move the camera for something the player didn't do).
- **Never inside the concrete.** A floor probe over the compound lifts the camera 0.7 m above
  whatever rideable surface is under it, applied to the target (so the spring does the lifting)
  and as a hard clamp. Behind a skater in a bowl the camera rides the wall up onto the deck.
- **Look leads along velocity** (capped at 3.2 m), whip clamp kept, but the clamp never fights
  the heading swing itself.
- **Per-state framing:** air pulls back 0.5 m and looks a little higher; grinds drop 0.3 m and
  pull back 0.3 m (the Phase 8 brief); bails pull back 1.2 m and up 0.4 m. Roll into carves stays,
  gated off in the air and in bails.

Measured on the island (portrait 390×700, skater's normalised screen position): carving ±0.17
horizontally, kicker air and chute drop within ±0.32 vertically, a full vert wall ride and
reversal peaks at 0.30 horizontally with the skater never leaving the frame (it was off-screen
by 9–37 screen widths before), fakie riding centred with the camera behind the travel direction.

**Stairs are a bank now.** The stair set had a ground hole under the steps and a wall only at
the top edge, so rolling into the stairs from below, or off the platform slowly, dropped the
skater into the void. The steps are a 27° bank surface joined to the platform top and the ground:
roll off the top and you land on it; ride into it and you climb or roll back.

### Known gaps, on purpose

- The autopilot used for the loop test steers crudely; a straight unsteered rider through the snake
  run still climbs to the rim and rolls onto the deck at the bends. A player carving stays in.
- The channel end inside the shallow end overlaps the room's floor for 1 m; the hand-off is exact
  on the centre line and a small drop off-centre.
- Rooms ridden along their long axis (15 m of floor) drain; pump across the short axis.
- The vert half-pipe is meant to be entered from the deep end's deck or a drop-in; from a standing
  start on the flat it takes eight timed pumps.
- No decoration, props or paint: the island is grey concrete until Phase 8.

### Phone checklist for this phase

1. Push across the plaza, hit the kicker, land, roll down the chute into the snake run. Steer with
   the channel through the S; you should arrive in the shallow end still rolling.
2. Pump across the shallow end, roll over the bank into the deep end, pump out onto the deck.
3. Drop into the vert half-pipe from the deck. Two or three timed pumps should put you above coping.
4. Roll off the deck onto the roller track. Tap the button on each roller face; you should reach the
   plaza without pushing.
5. Aim at a ledge side at speed: you pop over it. Roll into it slowly: you slide along it.

---

## Phase 6 — Tricks, Poses & Bails

**Status:** complete. Sixteen-state animation machine, flip/scoop channels with a classifier, per-foot
catch, steeze, a pose library of five composed keys, computed grind poses with a grind classifier and
styling table, manuals, and bails as a per-body-group weight ramp. Determinism holds. Eight tricks
land and read in silhouette; the classifier names what the player did on both board and edge.

### What was built

| Area | File | Note |
|---|---|---|
| Channels & classifiers | `src/sim/Tricks.ts` | Rose as channel targets; `classifyTrick(spin, flip, scoop)`; six board contacts; `classifyGrind(yaw, pitch, contact)`; `pivotForPitch` |
| State machine | `src/sim/SkateWorld.ts` | `AnimState` (Skater XL's 16) derived every step from the physics state and its timers |
| Steeze, catch | | Per-foot style channel from input cleanliness; per-foot `caughtL/R` with a sloppy-input delay |
| Grind pose | | Stick X yaws the board on the edge (±90°), stick Y pitches it (±25°), the pivot contact sits on the edge |
| Manual | | Stick hard back/forward at speed lifts a truck; never fails; disables pushing |
| Bail ramp | | `bailRamp` smoothstepped 0→1 in 150 ms, back in 350 ms |
| Pose library | `src/render/rig/Poses.ts` | 30-float `Pose`; five keys (setup, pop, peak, catch, land) composed from channel signs; grind styling table; manual pose |
| Rig | `src/render/rig/SkaterRig.ts` | Pose offsets on the procedural base, per-foot position weights, six group weights into the Verlet layers |

### Decisions

**The trick is a point in channel space; the name is derived afterwards.** The rose sets targets
for spin, flip and scoop. At landing the classifier reads the accumulated rotations and names them:
"kickflip", "heelflip", "pop shuv", "360 shuv", "varial kickflip", "fs kickflip", "fs 180",
"bs 180", and unplanned combinations ("hardflip", "360 flip", "laser flip") come out of the same
function. A grind that pops into a trick starts its scoop from the grind yaw, so a boardslide-to-
shuv is one continuous number.

**Anim state is derived, physics state is not.** The controller keeps six physics states. The
sixteen animation states are computed from them and their timers each step: Setup while charging,
BeginPop for the 40 ms tail-down, Pop for the first 80 ms of flight, Release once a landing is
predicted, Impact for 150 ms after touchdown, EnterCoping while the grind blend is under one,
ExitCoping for 200 ms after leaving an edge. The rig reads the animation state; the physics never
has to know about anticipation.

**Feet leave the board with a position weight, not a pose.** On pop, if the board will rotate,
both feet's position weight goes to 0: the foot hangs from its hip (knee bent) plus the pose
library's flick, while its rotation still follows the board frame. The front foot catches when the
channels finish; the back foot catches up to 120 ms later, scaled by (1 − back-foot steeze). On an
ollie or a 180 the board does not rotate under the feet, so they stay planted.

**Steeze is input cleanliness, one number per foot.** Front foot: how close the stick was to the
wedge centre. Back foot: how full the charge was. Clean → bigger flick, more foot turn, higher
tuck. Sloppy → less, and the late back-foot catch. Decays over 1.2 s after landing.

**Poses are composed, not authored per trick.** Five keys are built from the trick's channel
signs: the front foot flicks toward the toe side for a kickflip and the heel side for a heelflip,
the back foot scoops for a shuv, shoulders wind against a spin. Every point in the channel space
gets a coherent pose, including half-caught combinations, from about 60 lines.

**Grind poses are computed.** Board yaw from stick X, pitch from stick Y, and the contact that
carries the board (nose, front truck, centre, back truck, tail) chosen by pitch. The board centre
is placed so that contact sits on the edge. Attach keeps whatever angle the board arrived at as the
initial yaw while the body frame aligns to the edge, so there is no snap, and the yaw then relaxes
to the stick. Classification: |yaw| > 60° boardslide; < 20° 50-50 / 5-0 / nosegrind / tail- and
noseslide by contact; in between, crooked/overcrook nose-down and smith/feeble tail-down. Eleven
labels index a small styling table of pelvis/arm/head offsets. That is all the per-grind data.

**Bails are a weight ramp.** `bailRamp` feeds six body-group weights with a stagger (legs first,
head last). Weight scales each Verlet particle's pull toward its pose target, so at 0 gravity and
the distance constraints take over: the chest slumps forward, the arms flail, the head droops. The
pelvis pitches forward and falls back behind the board, the feet trail behind. Recovery runs the
ramp in reverse. No ragdoll physics was added; the Phase 5 springs and particles are the ragdoll.

**Side-drop hold lengthened to 0.6 s.** Holding the stick sideways now yaws the board into a
boardslide, which conflicted with Phase 4's 150 ms side-drop. Drop-off still exists; it takes a
deliberate hold.

### Measurements (scripted)

| Test | Result |
|---|---|
| Eight rose directions from the flat at 7 u/s | all land, 0 bails; names: fs 180, fs kickflip, kickflip, heelflip, bs 180, pop shuv, 360 shuv, varial kickflip |
| Anim state sequence on a kickflip | Riding → Setup → BeginPop → Pop → InAir → Release → Impact → Riding |
| Catch sequence on flips/shuvs | both feet off, both catch; 180s and ollie: feet never leave |
| Sloppy kickflip (off-centre wedge, short charge) | steeze 0.06 / 0.29, back foot catches 83 ms after the front |
| Grind with stick neutral / back / fwd / right / left | 50-50 / 5-0 / nosegrind / fs boardslide / bs boardslide; diagonals give smith / overcrook |
| Attach at 30° to the rail | yaw starts at −30°, relaxes to 0, no snap, lands |
| Boardslide exit | board straightens in the air, lands at 0° |
| Manual, stick back at 7 u/s | pitch 18°, no pushing during, ends on release |
| Bail | ramp reaches 1, 0.9 s down, ramp back to 0 on recovery |

### Known gaps, on purpose

- Braking and Powerslide are in the enum but unmapped: the control scheme has no input left for
  them, and the brief says "nothing else".
- The score does not yet read the classifier (Phase 10).
- One bail shape (the trip). Variety by impact direction is a Phase 8 juice pass.

### Phone checklist for this phase

1. Pop with the stick up, then up-left: kickflip and heelflip should flick opposite ways and the
   feet should visibly leave and re-catch. A quick, off-centre pop should look sloppier.
2. Pop with the stick down: the board spins flat under lifted feet.
3. Grind the rail and push the stick sideways: the board turns to a boardslide and the body faces
   down the rail. Pull back: 5-0. Push forward: nosegrind. Watch the `grind` row name each.
4. Pull the stick hard back at speed on the flat: tail manual.
5. Land sideways off something: one trip-and-faceplant, then back on the board.

---

## Phase 5 — The Skater: Rig, IK & Procedural Motion

**Status:** complete. A 20-bone skeleton with one procedurally skinned mesh, closed-form two-bone
IK for legs and arms, Verlet chest and hands, lean, gated head look-at, and a board with trucks,
wheels and deck flex. **Zero animation clips.** Pose sampled stepped at a tunable rate (12 fps
default) while the board and camera stay at display rate. Determinism unchanged (render-side only).

### What was built

| Area | File | Note |
|---|---|---|
| Bone contract | `src/render/rig/RigSpec.ts` | 20 bones, names, hierarchy, bind offsets, lengths, proportions. A GLTF asset replaces the mesh by matching these names |
| Skeleton + mesh | `src/render/rig/Skeleton.ts` | Bones from the spec; one `SkinnedMesh` built as capsules per bone, 2 influences at joints. 2.1k triangles |
| IK | `src/render/rig/IK.ts` | `solveTwoBone` (law of cosines, pole vector, 99.5% max reach) and `quatFromDirFront` |
| Verlet | `src/render/rig/Verlet.ts` | One particle class: step toward a target with local gravity, distance / range constraints |
| Rig | `src/render/rig/SkaterRig.ts` | The five layers, foot goals in board space, over-reach, stepped sampling, board group |
| Sim | `src/sim/SkateWorld.ts` | New `frame` body: board position + frame rotation only. Pelvis roll sign fixed to match its shift |
| Overlay | | `pose N fps` button cycles 8 / 12 / 15 / 24 / every frame; `charHz` row |

The Phase 1 placeholder is gone.

### Decisions

**Everything is solved in the body frame, then hung off the smooth frame.** The pose (bone local
rotations plus the pelvis offset from the board) is computed at `characterHz` in board space:
X right, Y up, Z back, origin at the board centre. Each display frame the root is placed at the
*interpolated* body frame. So the body rides the board smoothly at display rate while its pose
steps, and the feet never slide between samples because the pelvis offset steps with the legs.
Placing the root at the interpolated pelvis instead would have let a crouch move the pelvis
between pose samples and lifted the feet off the deck.

**Foot goals live in board space, exactly as the Rig Contract says.** ±0.2 m along the deck,
±0.06 m across, plus ankle height. Front foot opened 25° toward the nose, back foot 5°. Knees are
pole-vectored over the toes. Everything about "feet planted on a deck that rotates, tilts and
flips" fell out of this one decision; there is no foot-planting code.

**Two-bone IK, nothing fancier.** Legs hip→knee→ankle, arms shoulder→elbow→hand. Max reach 99.5%
so knees and elbows never lock or invert. Over-reach never stretches the limb: the pelvis moves
toward the goal by the excess, with a 10 mm / 3 mm hysteresis band. **The pushing foot is exempt**:
its ground goal is beyond leg reach by design, and letting it tilt the pelvis dragged the whole
torso into a hunch on every push (first screenshots). It now hovers short of the goal, which reads
fine, and the body stays up on the carrying leg.

**Verlet chest and hands, 60 Hz substeps.** Stiffness 140, drag 0.10 per step, local gravity
4 m/s² so arms hang toward real down even on a wall. Substepped at 60 Hz inside each pose sample
so stability does not depend on the sample rate. Shoulders are rigid on the chest rather than
particles: two fewer things to wobble, and the arm lag alone gives the follow-through (arms fly
up on the pop, drop through a landing) with no code for either.

**Lean drives three things.** Pelvis shifts and rolls into the carve, the chest counter-rolls
halfway back toward world up, the hands swing against the lean and rise with its magnitude.

**Head look-at is gated, not blended.** Allowed: riding, grinding, plain air. Off during flips,
shuvs, grabs and bails, when the head simply follows the chest. Target is where the line goes:
along the nose (tail when fakie) from over the front shoulder, clamped to ±70° yaw. The "next
feature" query the brief describes needs Phase 7's park; this is the velocity fallback until then.

**Board is five separate pieces.** Deck, two trucks, four wheels as children of one group so
Layer 5 can steer the trucks ±12° with yaw rate (opposite to each other), spin the wheels by
distance, and sag the deck up to 12 mm under the pelvis spring's compression. Tail scrape is the
sim's pitch channel. Eight draw calls for skater plus board.

**Procedural mesh instead of a GLTF.** There is no modelling tool in this environment. The mesh
is capsules along bones with joint blending, authored at build time in the bind pose, bound with
`SkinnedMesh.bind`. It is a mannequin, not the final character, but it is one skinned mesh under
22 bones with ≤2 influences, and the bone contract is the interface a real asset plugs into.

### Measurements

| Metric | Value |
|---|---|
| Bones | 20 (budget ≤ 22) |
| Skinned mesh triangles | 2116 |
| Influences per vertex | 1, 2 at joints (budget 2 typical / 4 max) |
| Draw calls, playground | 16 (was 13 with the placeholder) |
| Pose sample rate | 12 fps default, tunable live |
| CPU work per frame, headless | ~5 ms incl. GL submit (unchanged) |

### Acceptance, by eye (screenshots in the thread)

- **Riding:** upright, knees soft, arms relaxed at the hips, chest opened toward the nose.
- **Carving:** body leans into the turn, chest counter-rolls, outside arm rises.
- **Charging:** deep crouch, arms swing back. You can see the pop coming.
- **Pop / air:** arms fly up from the inertia, legs tuck.
- **Grab:** hunched, back hand on the tail.
- **Landing:** knees absorb, arms out wide.
- **Push:** back leg down beside the deck, torso stays up.
- **Grind:** balance pose, arms out.
- **Vert wall:** body along the wall normal, knees bent, arms out.

### Known gaps, on purpose

- The spine is three straight segments (reads as stacked discs); a curved spine is a Phase 8
  readability pass along with the real silhouette work.
- Feet stay planted mid-trick; per-foot IK weights and catch are Phase 6.
- Grind pose is the riding pose plus balance arms. Grind styling table is Phase 6.
- Head aims along velocity, not at the next feature (Phase 7).

### Phone checklist for this phase

1. Watch the skater carve a figure-eight: the lean, counter-roll and arm swing should sell the
   turn without any of it looking keyframed.
2. Hold the button: the crouch should read as winding up. Release: the arms should fly up a beat
   after the board leaves.
3. Land hard from a big ollie: knees fold, arms out, then recover.
4. Tap `pose 12 fps` in the overlay to cycle 8 / 12 / 15 / 24 / every-frame and pick the rate
   that reads best against the smooth board. 12 is the default; try 8 and 15 seriously.

---

## Phase 4 — Grinds

**Status:** complete. Rails, ledge edges and coping are one system. Determinism holds. Scripted:
attach works to 34° and refuses at 40°, a bowl's coping grinds end to end, a ledge grind ollies
into the quarter pipe at full speed, and the Phase 3 half-pipe regression is still 40/40.

### What was built

| Area | File | Note |
|---|---|---|
| Grind path | `src/sim/Grind.ts` | A `SplinePath` plus material (steel / concrete / coping), sit height, and an optional inward tilt for coping |
| Registry | `src/sim/surfaces/Compound.ts` | `grinds[]`; few enough to test all of them every air step |
| Builders | `src/sim/Park.ts` | Quarter pipes and bowl corners now emit coping along their lips; `rail()` and `ledge()` (top plane + two edges) |
| Playground | `src/sim/Playground.ts` | The rail is grindable; a 4 m concrete ledge sits on the run-up to the quarter pipe |
| Controller | `src/sim/SkateWorld.ts` | **Grinding** state: auto-attach, 1D constraint, 80 ms blend, friction, three exits, stall timeout, wobble/lock |
| Overlay | | `grind` row: path, material, parameter, lock; totals |

### Decisions

**A grind is a 1D constraint, not a surface.** Position is `P(t) + up·height`, speed is signed
along the path tangent, `t` advances by `speed·dt / |P'(t)|`. The frame chases the edge frame at
the same rate the position offset blends away (80 ms), so the snap is a settle, not a jump: max
per-step movement at attach is the same 6 cm as free flight.

**Auto-attach per the Charter, plus two guards.** Within 0.35 m horizontally, between 5 cm below
and 45 cm above the edge, heading within 35° of the tangent (mod 180: grinding backwards is
fine), and descending. Two additions from testing: "descending" allows up to 1 u/s of rise so
crossing a rail at the apex of an ollie catches it; and the board must be within ~50° of level.
Without the second, a board pointing straight up a vert wall whose tiny horizontal component ran
along the coping caught the lip on every air.

**Grinding never fails, but it always ends.** Three exits from the brief: off the end (launch
along the tangent, keep speed, coyote armed), ollie (release pops along the edge's up), drop off
the side (stick held sideways 150 ms). One more was needed: a **stall**. A coping catch with no
speed along the edge sat there forever, crept off the end at 0.08 u/s after 17 s and pushed off
the edge of the world. Now |speed| < 0.6 for 0.6 s drops the skater toward the tilt side (into the
transition for coping), with the board pivoted to face the drop, and a 0.6 s re-attach delay so
the same edge cannot catch them on the way down. It reads as rock-to-fakie / drop-in.

**Friction below rolling friction.** Steel 0.06/s, coping 0.09/s, concrete 0.12/s, ground 0.15/s.
Measured over 5 m from 6 u/s: rail keeps 5.7, ground keeps 5.0. Grinding feels fast.

**Landing preserves horizontal speed.** Found through the ledge test. The Phase 3 landing kept
only the tangential projection of velocity, which is physically right and game-wrong: an ollie
from the ledge into the transition hit the concave surface steeply and kept 2.7 of 5.8 u/s. The
brief says preserve horizontal speed, so landing speed is now `max(tangential, horizontal)`.
Coming down a wall the tangential term still wins, so vert airs are unchanged (regression 40/40,
equilibrium speed rose from 13.5–14.5 to 14–15.4).

**Coping tilt.** Coping paths carry an `up` leaned 0.35 toward the transition (bowl axis or the
quarter pipe's facing), so the board hangs over the lip instead of sitting flat on the deck edge.

### Measurements (scripted, 120 Hz, playground)

| Test | Result |
|---|---|
| Descend onto the rail at 0 / 20 / 30 / 34° to its tangent | attach, board aligns to 0° |
| Same at 40 / 60 / 90° | no attach (falls past) |
| Ollie from the flat onto the rail at 0 / 15 / 25° approach | attach, grind, land |
| Bowl coping from θ = 8° at 5 u/s, button held (lock) | 8.33 m of the 8.59 m arc, exit at the end at 4.3 u/s, land |
| Half-pipe coping along the lip at 4 u/s | 5.3 m grind, exit, land on the deck side |
| Coping stall (level board, zero speed) | 0.6 s stall, drop in, land in the transition at 7.9 u/s, no bail |
| Ledge grind 2 m, ollie off, into the quarter pipe | land on the transition at **5.8 u/s** (2.7 before the landing fix), line kept |
| Drop off the rail's side | lands on the ground beside it |
| 5 m at 6 u/s: rail vs ground | 5.70 vs 5.01 |
| Half-pipe regression, 3 seeds × 40 airs with spin | 40/40 each, 0 coping catches |
| 40 random drops | 47 landings, 0 bails, 0 fall-throughs |

### Known gaps, on purpose

- **No collision with rail posts, ledge sides or ramp bodies.** Riding into a ledge from the
  ground passes through it. Collision mercy (auto-pop over a ledge you would slam) needs Phase 7
  geometry and lands with it.
- **Grind pose is a straight 50-50.** Board yaw on the edge, the six contact targets and the
  classifier (5-0, nose, crooked…) are Phase 6, as the brief says.
- **The bowl corner's coping ends in air**, like its transition (quarter of a bowl).
- **Camera** has no grind behaviour yet (Phase 8: pull back, drop 0.3 m).

### Phone checklist for this phase

1. Ollie onto the rail ahead of the spawn from any reasonable angle. You should lock on and slide
   with a little wobble; hold the button to steady it. Off the end you launch and land.
2. Push the stick sideways mid-grind: you drop off that side.
3. Grind the ledge on the way to the quarter pipe, hold, release near the end: you fly into the
   transition and keep your speed.
4. Fly out of the half-pipe and spin a quarter turn at the lip: you should catch the coping and
   slide it. Stop on it and you drop back in on your own.
5. Carve up the bowl and catch the coping: it should carry you round the whole corner.

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
