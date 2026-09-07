import { Vector3 } from 'three';
import { ParkBuilder, type BowlCornerSpec, type QuarterPipeSpec, type TroughSpec } from './Park';

/**
 * The physics test bench, as data. Phase 0 shapes plus a half-pipe (Phase 2 pumping acceptance)
 * and an S-channel (spline extrusion). Both the sim and the visuals build from these numbers.
 */
export const PLAYGROUND = {
  groundHalfSize: 60,
  quarterPipe: { wallX: -12, facing: 1, zCenter: 0, width: 6, radius: 2.4, vertExt: 0.3, deckDepth: 1.2 } as QuarterPipeSpec,
  halfPipe: {
    zCenter: -18,
    width: 6,
    flat: 5,
    radius: 2.4,
    vertExt: 0.3,
    deckDepth: 1.2,
  },
  rail: { length: 5, height: 0.45, radius: 0.03, pos: new Vector3(4, 0, -8) },
  bowlCorner: { x: 10, z: 10, wallRadius: 6, transRadius: 1.8, vertExt: 0.2, deckWidth: 1.5, th0: 0, th1: Math.PI / 2 } as BowlCornerSpec,
  trough: {
    points: [new Vector3(-10, 0, 20), new Vector3(-4, 0, 22.5), new Vector3(3, 0, 19.5), new Vector3(10, 0, 22.5), new Vector3(16, 0, 20)],
    radius: 1.5,
    phiMax: Math.PI / 2,
  } as TroughSpec,
  spawn: { x: 2, z: 8, heading: 0.95 },
} as const;

export interface PlaygroundPark {
  builder: ParkBuilder;
  halfPipe: { leftWallX: number; rightWallX: number };
}

export function buildPlaygroundPark(): PlaygroundPark {
  const b = new ParkBuilder();
  const P = PLAYGROUND;
  b.quarterPipe('qp', P.quarterPipe);
  const hp = P.halfPipe;
  const leftWallX = -(hp.flat / 2 + hp.radius);
  const rightWallX = hp.flat / 2 + hp.radius;
  b.quarterPipe('hpL', { wallX: leftWallX, facing: 1, zCenter: hp.zCenter, width: hp.width, radius: hp.radius, vertExt: hp.vertExt, deckDepth: hp.deckDepth });
  b.quarterPipe('hpR', { wallX: rightWallX, facing: -1, zCenter: hp.zCenter, width: hp.width, radius: hp.radius, vertExt: hp.vertExt, deckDepth: hp.deckDepth });
  b.bowlCorner('bowl', P.bowlCorner);
  b.trough('snake', P.trough);
  b.finish(P.groundHalfSize);
  return { builder: b, halfPipe: { leftWallX, rightWallX } };
}

/** The main scene: nothing but ground until Phase 7. */
export function buildFlatPark(): ParkBuilder {
  const b = new ParkBuilder();
  b.finish(200);
  return b;
}
