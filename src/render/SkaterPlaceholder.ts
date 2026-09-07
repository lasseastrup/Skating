import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyInterpolated } from '../core/Interp';
import type { SkateWorld } from '../sim/SkateWorld';
import { TUNING as T } from '../sim/Tuning';

const DECK_MAT = new MeshLambertMaterial({ color: 0x3a3a3a });
const BODY_MAT = new MeshLambertMaterial({ color: 0xc8c8c8 });
const LEG_MAT = new MeshLambertMaterial({ color: 0x9a9a9a });

const Y_AXIS = new Vector3(0, 1, 0);

/**
 * Placeholder skater, Phase 1 through Phase 4. A capsule pelvis riding the height spring and two
 * stick legs from hips to board-space foot goals. The board is a separate object and the
 * authority: the body is solved onto it every frame, never the other way round.
 *
 * Deliberately crude. You must be able to feel weight before you can see a character.
 */
export class SkaterPlaceholder {
  readonly group = new Group();
  readonly board: Mesh;
  readonly pelvis: Mesh;
  private readonly legs: [Mesh, Mesh];

  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly fwd = new Vector3();
  private readonly hip = new Vector3();
  private readonly foot = new Vector3();
  private readonly dir = new Vector3();
  private readonly q = new Quaternion();

  constructor(private readonly world: SkateWorld) {
    // Deck + trucks + wheels as one merged geometry: one draw call for the whole board.
    const deck = new BoxGeometry(0.82, 0.018, 0.21);
    const wheel = new CylinderGeometry(0.028, 0.028, 0.035, 10, 1);
    wheel.rotateZ(Math.PI / 2);
    const parts: BufferGeometry[] = [deck];
    for (const x of [-0.3, 0.3]) {
      for (const z of [-0.11, 0.11]) {
        const w = wheel.clone();
        w.translate(x, -0.05, z);
        parts.push(w);
      }
    }
    const boardGeo = mergeGeometries(parts, false)!;
    // Board space: X = right, Y = up, -Z = forward. Deck's long axis needs to run along Z.
    boardGeo.rotateY(Math.PI / 2);
    for (const p of parts) p.dispose();
    this.board = new Mesh(boardGeo, DECK_MAT);
    this.board.castShadow = true;
    this.group.add(this.board);

    this.pelvis = new Mesh(new CapsuleGeometry(0.11, 0.22, 4, 10), BODY_MAT);
    this.pelvis.castShadow = true;
    this.group.add(this.pelvis);

    const legGeo = new CylinderGeometry(0.035, 0.03, 1, 7, 1);
    legGeo.translate(0, 0.5, 0); // origin at the foot, extends +Y one unit
    this.legs = [new Mesh(legGeo, LEG_MAT), new Mesh(legGeo, LEG_MAT)];
    for (const l of this.legs) {
      l.castShadow = true;
      this.group.add(l);
    }
  }

  /** Solve the visual body onto the interpolated board. Render-side, allocation-free. */
  sync(alpha: number): void {
    const w = this.world;
    applyInterpolated(w.board, this.board, alpha);
    applyInterpolated(w.pelvis, this.pelvis, alpha);

    // Board-space axes from the displayed (interpolated) board rotation.
    const bq = this.board.quaternion;
    this.right.set(1, 0, 0).applyQuaternion(bq);
    this.up.set(0, 1, 0).applyQuaternion(bq);
    this.fwd.set(0, 0, -1).applyQuaternion(bq);

    // Front foot = +along (regular stance, left foot forward). Back foot does the pushing.
    this.solveLeg(0, T.footAlong, -T.footAcross, 0.09, 0);
    this.solveLeg(1, -T.footAlong, T.footAcross, -0.09, w.pushPhase);
  }

  /**
   * One leg: a stick from the hip (pelvis ± lateral) to a foot goal expressed in board space.
   * `push` (0..1) swings the foot off the deck to the ground and strokes it back.
   */
  private solveLeg(i: number, along: number, across: number, hipSide: number, push: number): void {
    const bp = this.board.position;
    this.foot.copy(bp).addScaledVector(this.fwd, along).addScaledVector(this.right, across).addScaledVector(this.up, 0.01);

    if (push > 0) {
      // lift 0..0.22, stroke 0.22..0.5, return 0.5..1
      const lift = smooth01(push / 0.22);
      const stroke = smooth01((push - 0.22) / 0.28);
      const ret = smooth01((push - 0.5) / 0.5);
      const onGround = Math.min(lift, 1 - ret);
      const strokeAlong = 0.45 - 0.95 * stroke;
      this.dir
        .copy(bp)
        .addScaledVector(this.right, 0.32)
        .addScaledVector(this.up, -T.rideHeight)
        .addScaledVector(this.fwd, strokeAlong);
      this.foot.lerp(this.dir, onGround);
    }

    this.hip.copy(this.pelvis.position).addScaledVector(this.right, hipSide).addScaledVector(this.up, -0.08);

    this.dir.subVectors(this.hip, this.foot);
    const len = Math.max(0.05, this.dir.length());
    this.dir.divideScalar(len);
    const leg = this.legs[i];
    leg.position.copy(this.foot);
    leg.scale.set(1, len, 1);
    leg.quaternion.copy(this.q.setFromUnitVectors(Y_AXIS, this.dir));
  }

  dispose(): void {
    this.board.geometry.dispose();
    this.pelvis.geometry.dispose();
    this.legs[0].geometry.dispose();
  }
}

function smooth01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}
