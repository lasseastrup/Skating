import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Mesh,
  Scene,
  Shape,
  Vector3,
} from 'three';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import type { CameraTarget } from '../render/CameraRig';
import { fillCameraTarget } from './SceneBase';
import { SkaterRig } from '../render/rig/SkaterRig';
import type { QuarterPipeSpec } from '../sim/Park';
import { buildPlaygroundPark, PLAYGROUND } from '../sim/Playground';
import { SkateWorld } from '../sim/SkateWorld';
import type { PlaneSurface } from '../sim/surfaces/Plane';
import type { TroughSurface } from '../sim/surfaces/Trough';
import { buildLighting, SUN_OFFSET, type GameScene } from './SceneBase';
import { levelMesh, LEVEL_MAT, paintFlat, PALETTE } from '../render/Toon';


/**
 * The physics test bench. Surfaces come from `buildPlaygroundPark()`; the meshes here are fitted
 * to the same spec numbers. The primitive is the truth, the mesh is the picture.
 */
export class PlaygroundScene implements GameScene {
  readonly name = 'playground';
  readonly three = new Scene();
  readonly world: SkateWorld;
  readonly skater: SkaterRig;
  private readonly sun;
  private readonly owned: Mesh[] = [];
  private readonly target: CameraTarget;

  constructor() {
    const park = buildPlaygroundPark();
    this.world = new SkateWorld(park.builder.compound, PLAYGROUND.spawn);
    this.sun = buildLighting(this.three, 14);

    const ground = park.builder.compound.surfaces[park.builder.ground] as PlaneSurface;
    this.buildGroundWithHoles(ground, PLAYGROUND.groundHalfSize);

    this.skater = new SkaterRig(this.world);
    this.three.add(this.skater.group);
    this.target = { pos: this.skater.board.position, forward: this.world.tangent, up: this.world.normal, vel: new Vector3(), speed: 0, lean: 0, mode: 'ride', floorY: 0, floorAt: (p) => this.world.compound.floorHeightAt(p) };

    const P = PLAYGROUND;
    this.buildQuarterPipe(P.quarterPipe);
    const hp = P.halfPipe;
    const common = { zCenter: hp.zCenter, width: hp.width, radius: hp.radius, vertExt: hp.vertExt, deckDepth: hp.deckDepth };
    this.buildQuarterPipe({ wallX: park.halfPipe.leftWallX, facing: 1, ...common });
    this.buildQuarterPipe({ wallX: park.halfPipe.rightWallX, facing: -1, ...common });
    this.buildRail();
    this.buildLedge();
    this.buildBowlCorner();
    for (const t of park.builder.troughs) this.buildTrough(t);
  }

  private add(m: Mesh): Mesh {
    m.receiveShadow = true;
    this.three.add(m);
    this.owned.push(m);
    return m;
  }

  /** Ground as a 2 m grid with cells inside any ride-surface hole removed, so channels show. */
  private buildGroundWithHoles(ground: PlaneSurface, half: number): void {
    const cell = 2;
    const n = Math.ceil((2 * half) / cell);
    const positions: number[] = [];
    const index: number[] = [];
    let vi = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const u0 = -half + i * cell;
        const v0 = -half + j * cell;
        // Sample 4 points inside the cell; skip cells entirely inside a hole.
        let inside = 0;
        for (const [a, b] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          if (ground.marginUV(u0 + a * cell, v0 + b * cell) > 0) inside++;
        }
        if (inside === 0) continue;
        // u = x, v = -z
        positions.push(u0, 0, -v0, u0 + cell, 0, -v0, u0 + cell, 0, -(v0 + cell), u0, 0, -(v0 + cell));
        // Counter-clockwise seen from above (+Y) so the ground faces up.
        index.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        vi += 4;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setIndex(index);
    g.computeVertexNormals();
    this.add(new Mesh(paintFlat(g, PALETTE.concrete), LEVEL_MAT));
  }

  private buildQuarterPipe(s: QuarterPipeSpec): void {
    const { radius: r, width, vertExt, deckDepth, facing: f } = s;
    // Profile in the XY plane, mirrored through the shape itself (a negative scale would flip
    // the triangle winding and cull the ramp inside-out).
    const sh = new Shape();
    sh.moveTo(-f * deckDepth, 0);
    sh.lineTo(f * r, 0);
    if (f > 0) sh.absarc(r, r, r, -Math.PI / 2, Math.PI, true);
    else sh.absarc(-r, r, r, -Math.PI / 2, 0, false);
    sh.lineTo(0, r + vertExt);
    sh.lineTo(-f * deckDepth, r + vertExt);
    sh.closePath();
    const g = new ExtrudeGeometry(sh, { depth: width, bevelEnabled: false, curveSegments: 24 });
    g.translate(0, 0, -width / 2);
    const m = this.add(levelMesh(g, 'prop'));
    m.position.set(s.wallX, 0, s.zCenter);
  }

  private buildRail(): void {
    const { length, height, radius, pos } = PLAYGROUND.rail;
    const bar = new CylinderGeometry(radius, radius, length, 10, 1);
    bar.rotateX(Math.PI / 2);
    const m = this.add(levelMesh(bar, 'steel'));
    m.castShadow = true;
    m.position.copy(pos).y = height;
    const post = new CylinderGeometry(radius * 0.8, radius * 0.8, height, 8, 1);
    for (const z of [-length * 0.4, length * 0.4]) {
      const p = this.add(levelMesh(post, 'steel'));
      p.position.set(pos.x, height / 2, pos.z + z);
    }
  }

  private buildLedge(): void {
    const l = PLAYGROUND.ledge;
    const m = this.add(levelMesh(new BoxGeometry(l.length, l.height, l.width), 'prop'));
    m.castShadow = true;
    m.position.set(l.x, l.height / 2, l.z);
  }

  /**
   * Bowl corner: torus transition, vertical lip, deck ring. Same parametrisation as the
   * TorusSurface: d(ψ) = Rmaj + r·cosψ, y = r + r·sinψ, ψ ∈ [-π/2, 0].
   */
  private buildBowlCorner(): void {
    const s = PLAYGROUND.bowlCorner;
    const r = s.transRadius;
    const Rmaj = s.wallRadius - r;
    const R = s.wallRadius;
    const pos = new Vector3(s.x, 0, s.z);
    const span = s.th1 - s.th0;
    const surf = new ParametricGeometry(
      (u, v, out) => {
        const th = s.th0 + u * span;
        const ps = -Math.PI / 2 + (v * Math.PI) / 2;
        const d = Rmaj + r * Math.cos(ps);
        out.set(d * Math.cos(th), r + r * Math.sin(ps), d * Math.sin(th));
      },
      32,
      16,
    );
    this.add(levelMesh(surf, 'concave')).position.copy(pos);
    const lip = new ParametricGeometry(
      (u, v, out) => {
        const th = s.th0 + u * span;
        out.set(R * Math.cos(th), r + v * s.vertExt, R * Math.sin(th));
      },
      32,
      1,
    );
    this.add(levelMesh(lip, 'concave')).position.copy(pos);
    const deck = new ParametricGeometry(
      (u, v, out) => {
        const th = s.th0 + u * span;
        const d = R + v * s.deckWidth;
        out.set(d * Math.cos(th), r + s.vertExt, d * Math.sin(th));
      },
      32,
      1,
    );
    this.add(levelMesh(deck, 'concave')).position.copy(pos);
  }

  /** Channel mesh sampled straight from the trough primitive. */
  private buildTrough(t: TroughSurface): void {
    const P = new Vector3();
    const T = new Vector3();
    const K = new Vector3();
    const up = new Vector3();
    const right = new Vector3();
    const Y = new Vector3(0, 1, 0);
    const g = new ParametricGeometry(
      (u, v, out) => {
        t.path.frame(u, P, T, K);
        up.copy(Y).addScaledVector(T, -Y.dot(T)).normalize();
        right.crossVectors(T, up).normalize();
        const phi = -t.phiMax + 2 * t.phiMax * v;
        out.copy(P).addScaledVector(up, t.rho).addScaledVector(right, t.rho * Math.sin(phi)).addScaledVector(up, -t.rho * Math.cos(phi));
      },
      96,
      16,
    );
    this.add(levelMesh(g, 'concave'));
  }

  syncVisuals(alpha: number, dt: number): void {
    this.skater.sync(alpha, dt);
    this.sun.target.position.copy(this.skater.board.position);
    this.sun.position.copy(this.skater.board.position).add(SUN_OFFSET);
  }

  cameraTarget(): CameraTarget {
    fillCameraTarget(this.target, this.world);
    return this.target;
  }

  dispose(): void {
    this.skater.dispose();
    for (const m of this.owned) m.geometry.dispose();
  }
}
