import {
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Mesh,
  MeshLambertMaterial,
  Scene,
  Shape,
  Vector3,
} from 'three';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import type { CameraTarget } from '../render/CameraRig';
import { SkaterPlaceholder } from '../render/SkaterPlaceholder';
import { SkateWorld } from '../sim/SkateWorld';
import { buildGround, buildLighting, DARK_PROP, GREY_PROP, type GameScene } from './SceneBase';

const SUN_OFFSET = new Vector3(18, 30, 12);
const CONCAVE = new MeshLambertMaterial({ color: 0x8a8a8a, side: DoubleSide });

/**
 * The physics test bench. Separate from the game: a flat plane, one quarter pipe, one rail,
 * one bowl corner. Every surface phase is validated here before touching the real park.
 *
 * Phase 0: visual meshes only. Phase 2 fits analytic primitives to exactly these dimensions,
 * so the constants below are the contract, not decoration.
 */
export const PLAYGROUND = {
  quarterPipe: { radius: 2.4, width: 6, vertExt: 0.3, deckDepth: 1.2, pos: new Vector3(-12, 0, 0) },
  rail: { length: 5, height: 0.45, radius: 0.03, pos: new Vector3(4, 0, -8) },
  bowlCorner: { wallRadius: 6, transRadius: 1.8, vertExt: 0.2, pos: new Vector3(10, 0, 10) },
} as const;

export class PlaygroundScene implements GameScene {
  readonly name = 'playground';
  readonly three = new Scene();
  /** Spawn on the flat, looking across the rail toward the quarter pipe so the props are in frame. */
  readonly world = new SkateWorld({ x: 2, z: 8, heading: 0.95 });
  private readonly skater: SkaterPlaceholder;
  private readonly sun;
  private readonly owned: Mesh[] = [];
  private readonly target: CameraTarget;

  constructor() {
    this.sun = buildLighting(this.three, 14);
    buildGround(this.three, 120);
    this.skater = new SkaterPlaceholder(this.world);
    this.three.add(this.skater.group);
    this.target = {
      pos: this.skater.board.position,
      forward: this.world.tangent,
      up: this.world.normal,
      speed: 0,
      lean: 0,
    };

    this.buildQuarterPipe();
    this.buildRail();
    this.buildBowlCorner();
  }

  private add(m: Mesh): Mesh {
    m.receiveShadow = true;
    this.three.add(m);
    this.owned.push(m);
    return m;
  }

  /** Quarter pipe facing +X. Skater approaches travelling -X and rides up the wall at local x=0. */
  private buildQuarterPipe(): void {
    const { radius: r, width, vertExt, deckDepth, pos } = PLAYGROUND.quarterPipe;
    const s = new Shape();
    s.moveTo(-deckDepth, 0);
    s.lineTo(r, 0); // floor toe
    s.absarc(r, r, r, -Math.PI / 2, Math.PI, true); // transition, clockwise up to (0, r)
    s.lineTo(0, r + vertExt); // vert extension
    s.lineTo(-deckDepth, r + vertExt); // deck
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 24 });
    g.translate(0, 0, -width / 2);
    const m = this.add(new Mesh(g, GREY_PROP));
    m.position.copy(pos);
  }

  /** Flat steel rail on two posts, running along Z. */
  private buildRail(): void {
    const { length, height, radius, pos } = PLAYGROUND.rail;
    const bar = new CylinderGeometry(radius, radius, length, 10, 1);
    bar.rotateX(Math.PI / 2);
    const m = this.add(new Mesh(bar, DARK_PROP));
    m.castShadow = true;
    m.position.copy(pos).y = height;
    const post = new CylinderGeometry(radius * 0.8, radius * 0.8, height, 8, 1);
    for (const z of [-length * 0.4, length * 0.4]) {
      const p = this.add(new Mesh(post, DARK_PROP));
      p.position.set(pos.x, height / 2, pos.z + z);
    }
  }

  /**
   * Bowl corner: a quarter of a torus, inner lower surface. Wall is a vertical cylinder of
   * radius R around the corner axis; transition radius r blends floor to wall.
   *   d(φ) = R - r + r·sinφ,  y(φ) = r - r·cosφ,  φ∈[0,π/2]  (floor → vertical)
   *   p(θ,φ) = (d·cosθ, y, d·sinθ),                θ∈[0,π/2]
   */
  private buildBowlCorner(): void {
    const { wallRadius: R, transRadius: r, vertExt, pos } = PLAYGROUND.bowlCorner;
    const surf = new ParametricGeometry(
      (u, v, out) => {
        const theta = u * (Math.PI / 2);
        const phi = v * (Math.PI / 2);
        const d = R - r + r * Math.sin(phi);
        const y = r - r * Math.cos(phi);
        out.set(d * Math.cos(theta), y, d * Math.sin(theta));
      },
      32,
      16,
    );
    const m = this.add(new Mesh(surf, CONCAVE));
    m.position.copy(pos);

    // Vertical lip above the transition, then a flat deck ring outside the wall. Same (θ) convention
    // as the transition surface so the three pieces share edges exactly.
    const lip = new ParametricGeometry(
      (u, v, out) => {
        const theta = u * (Math.PI / 2);
        out.set(R * Math.cos(theta), r + v * vertExt, R * Math.sin(theta));
      },
      32,
      1,
    );
    this.add(new Mesh(lip, CONCAVE)).position.copy(pos);

    const DECK_W = 1.5;
    const deck = new ParametricGeometry(
      (u, v, out) => {
        const theta = u * (Math.PI / 2);
        const d = R + v * DECK_W;
        out.set(d * Math.cos(theta), r + vertExt, d * Math.sin(theta));
      },
      32,
      1,
    );
    this.add(new Mesh(deck, CONCAVE)).position.copy(pos);
  }

  syncVisuals(alpha: number): void {
    this.skater.sync(alpha);
    this.sun.target.position.copy(this.skater.board.position);
    this.sun.position.copy(this.skater.board.position).add(SUN_OFFSET);
  }

  cameraTarget(): CameraTarget {
    this.target.speed = this.world.speed;
    this.target.lean = this.world.lean;
    return this.target;
  }

  dispose(): void {
    this.skater.dispose();
    for (const m of this.owned) m.geometry.dispose();
  }
}
