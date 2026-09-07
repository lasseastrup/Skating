import { Vector3 } from 'three';
import { ParkBuilder, type BowlRoomSpec, type KickerSpec, type LedgeSpec, type PlatformSpec, type QuarterPipeSpec, type RollerSpec, type TroughSpec } from './Park';

/**
 * The island. One continuous, loopable park. Zones are connected so every exit feeds another
 * entry at a speed that works:
 *   plaza → kicker → snake run roll-in → snake run → shallow end → deep end → climb out →
 *   vert half-pipe → rollers → back into the plaza.
 * Every number here is the truth the meshes are fitted to.
 */
const D = Math.PI / 180;

export const ISLAND = {
  groundHalfSize: 90,
  spawn: { x: -14, z: 0, heading: -Math.PI / 2 }, // facing +X into the plaza

  // --- Plaza -----------------------------------------------------------------------------------
  ledges: [
    { x: -16, z: -7, length: 5, width: 0.5, height: 0.3 },
    { x: -6, z: -10, length: 5, width: 0.5, height: 0.45 },
    { x: 2, z: -6, length: 4, width: 0.5, height: 0.6 },
  ] as LedgeSpec[],
  manualPad: { x: -6, z: 4, length: 6, width: 1.6, height: 0.25 } as LedgeSpec,
  kickers: [
    // 0.37 m tall: at 2× gravity a kicker this size needs ~4 u/s to clear and launches ~1.5 m.
    { toeX: 4.5, facing: -1, zCenter: 10, width: 3, transRadius: 1.5, angle: 22 * D, bankLength: 0.7 },
    { toeX: -20, facing: 1, zCenter: 9, width: 3, transRadius: 1.5, angle: 22 * D, bankLength: 0.7 },
  ] as KickerSpec[],
  platform: { x: -26, z: 0, length: 5, width: 4, height: 1.2, stairRun: 2.4, hubbaWidth: 0.6, hubbaEndHeight: 0.35 } as PlatformSpec,

  // --- Mini-ramp with spine (north of the plaza), along X ----------------------------------------
  mini: { zCenter: -24, width: 5, radius: 1.2, vertExt: 0.1, flat: 3.5, spineDeck: 0.15, deck: 1.0, x0: -18 },

  // --- Snake run: roll-in from the plaza, S-curve into the shallow end -------------------------
  /** A walled chute 2 m wide: narrower than the channel so its flat floor meets the channel's
   *  bottom within the hand-off tolerance (0.3 m at the chute's edges). */
  rollIn: { x0: 8.5, x1: 11.2, z0: 9, z1: 11, depth: 1.8 },
  snake: {
    // Starts straight along +X so the roll-in feeds along the channel axis, not into a wall, and
    // runs 1 m into the shallow end's floor so the hand-off is seamless. Bends are wide (radius
    // ≥ 8 m, the rim half-width is 2.9 m) so the surface never folds.
    points: [new Vector3(11.2, -1.8, 10), new Vector3(16, -1.8, 10), new Vector3(20, -1.8, 13), new Vector3(21, -1.8, 18), new Vector3(18.5, -1.8, 23), new Vector3(19.5, -1.8, 27.5), new Vector3(23, -1.8, 30), new Vector3(28, -1.8, 30)],
    // ρ(1 − cos φmax) = 1.8 m deep with 64° banks: a rider carried to the rim rolls onto the
    // deck instead of being fired out of a vertical wall.
    radius: 3.2,
    phiMax: Math.acos(1 - 1.8 / 3.2), // 64°, rim half-width 2.88 m
  } as TroughSpec,

  // --- The bowl: shallow end fed by the snake run, deep end toward the vert wall ----------------
  // Rooms are 5.8 m wide between their corners: the snake run's rim (5.75 m) enters the shallow
  // end through its straight west edge, clear of the corner transitions.
  shallow: { x: 30, z: 30, hx: 3, hz: 2.9, transRadius: 1.6, vertExt: 0.2, cornerRadius: 2.0, open: { west: true, east: true } } as BowlRoomSpec,
  deep: { x: 45, z: 30, hx: 2.5, hz: 2.9, transRadius: 2.4, vertExt: 0.2, cornerRadius: 1.6, open: { west: true } } as BowlRoomSpec,
  /** Bank in the floor between the two ends (shallow floor edge x = 35 → deep floor edge x = 40.9),
   *  exactly as wide as the rooms' straight edges so no void opens beside it. */
  bowlBank: { x0: 35, y0: -1.8, x1: 40.9, y1: -2.6, z0: 27.1, z1: 32.9 },
  /** The bank's side walls exist only where deck lies beside it: between the shallow end's east
   *  lip (x + hx + Rc + r = 36.6) and the deep end's west lip (x − hx − Rc − r = 38.5). Either
   *  side of that the pool corners' transitions are the walls. */
  bowlBankSides: { x0: 36.6, x1: 38.5 },

  // --- Vert wall: a half-pipe with an extension on the east wall --------------------------------
  vert: { zCenter: 30, width: 8, radius: 3, vertExt: 0.6, flat: 6, deck: 1.5, xCenter: 64, extension: { z0: 30, z1: 34, height: 0.6 } },

  // --- Return: rollers back toward the plaza ----------------------------------------------------
  rollers: [
    { xCenter: 56, zCenter: 18, width: 4, height: 0.3, angle: 16 * D },
    { xCenter: 48, zCenter: 17, width: 4, height: 0.3, angle: 16 * D },
    { xCenter: 40, zCenter: 16, width: 4, height: 0.3, angle: 16 * D },
    { xCenter: 32, zCenter: 14, width: 4, height: 0.3, angle: 16 * D },
    { xCenter: 26, zCenter: 10, width: 4, height: 0.3, angle: 16 * D },
  ] as RollerSpec[],
} as const;

export interface IslandPark {
  builder: ParkBuilder;
  quarterPipes: QuarterPipeSpec[];
}

export function buildIslandPark(): IslandPark {
  const b = new ParkBuilder();
  const L = ISLAND;
  const qps: QuarterPipeSpec[] = [];

  // Plaza
  L.ledges.forEach((l, i) => b.ledge(`ledge${i}`, l));
  b.manualPad('pad', L.manualPad);
  L.kickers.forEach((k, i) => b.kicker(`kicker${i}`, k));
  b.platform('stairs', L.platform);

  // Mini-ramp: HP1 [wall, flat, spine-left] spine [spine-right, flat, wall] HP2
  const m = L.mini;
  const w1 = m.x0;
  const spineL = w1 + m.radius * 2 + m.flat;
  const spineR = spineL + 2 * m.spineDeck;
  const w2 = spineR + m.radius * 2 + m.flat;
  const common = { zCenter: m.zCenter, width: m.width, radius: m.radius, vertExt: m.vertExt };
  qps.push({ wallX: w1, facing: 1, deckDepth: m.deck, ...common });
  qps.push({ wallX: spineL, facing: -1, deckDepth: m.spineDeck, noSideWalls: true, ...common });
  qps.push({ wallX: spineR, facing: 1, deckDepth: m.spineDeck, noSideWalls: true, ...common });
  qps.push({ wallX: w2, facing: -1, deckDepth: m.deck, ...common });
  qps.forEach((q, i) => b.quarterPipe(`mini${i}`, q));
  // Spine side caps as one wall each side across both spine decks.
  for (const z of [m.zCenter - m.width / 2, m.zCenter + m.width / 2]) {
    b.compound.addWall({ ax: spineL - m.radius, az: z, bx: spineR + m.radius, bz: z, yBottom: 0, yTop: m.radius + m.vertExt, kind: 'wall' });
  }

  // Snake run and its roll-in
  const snakeIdx = b.trough('snake', L.snake);
  const ri = L.rollIn;
  const rollIn = b.bankX('rollIn', ri.x0, 0, ri.x1, -ri.depth, ri.z0, ri.z1, [snakeIdx]);
  b.linkGround(rollIn);
  b.linkGround(snakeIdx); // the rim is at ground level: you can drop in anywhere along it
  b.groundHoleRect(ri.x0, ri.x1, ri.z0, ri.z1);
  for (const z of [ri.z0, ri.z1]) b.compound.addWall({ ax: ri.x0, az: z, bx: ri.x1, bz: z, yBottom: -ri.depth, yTop: 0, kind: 'wall' });
  // The channel dead-ends at the chute: cap the rest of its start face.
  const rimHalf = L.snake.radius * Math.sin(L.snake.phiMax);
  const s0 = L.snake.points[0];
  b.compound.addWall({ ax: s0.x, az: s0.z - rimHalf, bx: s0.x, bz: ri.z0, yBottom: -ri.depth, yTop: 0, kind: 'wall' });
  b.compound.addWall({ ax: s0.x, az: ri.z1, bx: s0.x, bz: s0.z + rimHalf, yBottom: -ri.depth, yTop: 0, kind: 'wall' });

  // Bowl rooms and the bank between
  const shallow = b.bowlRoom('shallow', L.shallow);
  const deep = b.bowlRoom('deep', L.deep);
  const bk = L.bowlBank;
  b.bankX('bowlBank', bk.x0, bk.y0, bk.x1, bk.y1, bk.z0, bk.z1, [shallow.floor, deep.floor]);
  b.groundHoleRect(bk.x0, bk.x1, bk.z0, bk.z1);
  const bs = L.bowlBankSides;
  for (const z of [bk.z0, bk.z1]) b.compound.addWall({ ax: bs.x0, az: z, bx: bs.x1, bz: z, yBottom: Math.min(bk.y0, bk.y1), yTop: 0, kind: 'wall' });
  // The snake run's end opens onto the shallow floor.
  b.compound.connect(snakeIdx, shallow.floor);

  // Vert half-pipe with an extension on the east wall
  const v = L.vert;
  const vL: QuarterPipeSpec = { wallX: v.xCenter - v.flat / 2 - v.radius, facing: 1, zCenter: v.zCenter, width: v.width, radius: v.radius, vertExt: v.vertExt, deckDepth: v.deck };
  const vR: QuarterPipeSpec = { wallX: v.xCenter + v.flat / 2 + v.radius, facing: -1, zCenter: v.zCenter, width: v.width, radius: v.radius, vertExt: v.vertExt, deckDepth: v.deck, extension: v.extension };
  qps.push(vL, vR);
  b.quarterPipe('vertL', vL);
  b.quarterPipe('vertR', vR);

  // Return rollers
  L.rollers.forEach((r, i) => b.roller(`roller${i}`, r));

  b.finish(L.groundHalfSize);
  return { builder: b, quarterPipes: qps };
}
