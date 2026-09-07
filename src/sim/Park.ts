import { Vector3 } from 'three';
import { AnnularSectorBounds, RectBounds, type Bounds2D } from './surfaces/Bounds';
import { Compound } from './surfaces/Compound';
import { CylinderSurface } from './surfaces/Cylinder';
import { PlaneSurface } from './surfaces/Plane';
import { SplinePath } from './surfaces/Spline';
import { TorusSurface } from './surfaces/Torus';
import { SplineStripHole, TroughSurface } from './surfaces/Trough';

/**
 * Builders that turn feature specs into analytic surfaces with exact shared seams.
 * The primitive is the truth; the scene fits meshes to these same specs.
 */

export interface QuarterPipeSpec {
  /** X of the wall face. */
  wallX: number;
  /** +1: ramp opens toward +X (skater approaches travelling -X). -1: mirrored. */
  facing: 1 | -1;
  zCenter: number;
  width: number;
  radius: number;
  vertExt: number;
  deckDepth: number;
}

export interface BowlCornerSpec {
  /** Corner axis position (x, z) on the ground. */
  x: number;
  z: number;
  /** Wall radius from the axis and transition radius. */
  wallRadius: number;
  transRadius: number;
  vertExt: number;
  deckWidth: number;
  /** Angular range of the corner around the axis. */
  th0: number;
  th1: number;
}

export interface TroughSpec {
  points: Vector3[];
  radius: number;
  /** Half-angle of the profile; π/2 gives vertical rims at ground level. */
  phiMax: number;
}

export class ParkBuilder {
  readonly compound = new Compound(4);
  private readonly groundHoles: Bounds2D[] = [];
  private readonly groundLinks: number[] = [];
  private groundIdx = -1;
  private readonly groundOrigin = new Vector3(0, 0, 0);
  private readonly groundU = new Vector3(1, 0, 0);
  private readonly groundV = new Vector3(0, 0, -1);
  /** Extra visual data the scene can use. */
  readonly troughs: TroughSurface[] = [];

  /**
   * Ground plane in u = x, v = -z so that U × V = +Y. Call last: features register holes.
   */
  private addGround(halfSize: number): void {
    const plane = new PlaneSurface(
      'ground',
      this.groundOrigin,
      this.groundU,
      this.groundV,
      new RectBounds(-halfSize, halfSize, -halfSize, halfSize),
      this.groundHoles,
      halfSize,
    );
    this.groundIdx = this.compound.add(plane);
    for (const idx of this.groundLinks) this.compound.connect(this.groundIdx, idx);
  }

  /** Ground-plane (u, v) of a world (x, z). */
  private uv(x: number, z: number): [number, number] {
    return [x, -z];
  }

  quarterPipe(name: string, s: QuarterPipeSpec): { trans: number; vert: number; deck: number } {
    const f = s.facing;
    const r = s.radius;
    const zc = s.zCenter;
    const hw = s.width / 2;
    // Transition: circle centre at (wallX + f·r, r), θ from floor (0) up the wall (π/2).
    const C = new Vector3(s.wallX + f * r, r, zc);
    const E1 = new Vector3(0, -1, 0);
    const E2 = new Vector3(-f, 0, 0);
    const trans = new CylinderSurface(`${name}.trans`, C, E1, E2, r, 0, Math.PI / 2, -hw, hw, true);
    // Axis A = E1 × E2 = (0, 0, -f): t range symmetric so the sign doesn't matter.
    const vert = new PlaneSurface(
      `${name}.vert`,
      new Vector3(s.wallX, r, zc),
      f > 0 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1),
      f > 0 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0),
      f > 0 ? new RectBounds(0, s.vertExt, -hw, hw) : new RectBounds(-hw, hw, 0, s.vertExt),
    );
    const deckY = r + s.vertExt;
    const deck = new PlaneSurface(
      `${name}.deck`,
      new Vector3(s.wallX, deckY, zc),
      new Vector3(1, 0, 0),
      new Vector3(0, 0, -1),
      f > 0 ? new RectBounds(-s.deckDepth, 0, -hw, hw) : new RectBounds(0, s.deckDepth, -hw, hw),
    );
    const ti = this.compound.add(trans);
    const vi = this.compound.add(vert);
    const di = this.compound.add(deck);
    this.compound.connect(ti, vi);
    this.groundLinks.push(ti);
    // Footprint hole: from the deck's back edge to the transition toe.
    const xa = f > 0 ? s.wallX - s.deckDepth : s.wallX - r;
    const xb = f > 0 ? s.wallX + r : s.wallX + s.deckDepth;
    const [ua] = this.uv(xa, 0);
    const [ub] = this.uv(xb, 0);
    const [, va] = this.uv(0, zc + hw);
    const [, vb] = this.uv(0, zc - hw);
    this.groundHoles.push(new RectBounds(Math.min(ua, ub), Math.max(ua, ub), Math.min(va, vb), Math.max(va, vb)));
    return { trans: ti, vert: vi, deck: di };
  }

  bowlCorner(name: string, s: BowlCornerSpec): { trans: number; wall: number; deck: number } {
    const r = s.transRadius;
    const Rmaj = s.wallRadius - r;
    const Cc = new Vector3(s.x, r, s.z);
    const trans = new TorusSurface(`${name}.trans`, Cc, Rmaj, r, s.th0, s.th1, -Math.PI / 2, 0, true);
    // Vertical wall above the transition: cylinder about the axis, radius = wallRadius.
    const wall = new CylinderSurface(
      `${name}.wall`,
      new Vector3(s.x, 0, s.z),
      new Vector3(1, 0, 0),
      new Vector3(0, 0, 1),
      s.wallRadius,
      s.th0,
      s.th1,
      r,
      r + s.vertExt,
      true,
    );
    const deckY = r + s.vertExt;
    // Deck plane in u = x, v = -z: the angle in (u, v) is -θ, so the sector flips sign.
    const deck = new PlaneSurface(
      `${name}.deck`,
      new Vector3(0, deckY, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 0, -1),
      new AnnularSectorBounds(s.x, -s.z, s.wallRadius, s.wallRadius + s.deckWidth, -s.th1, -s.th0),
    );
    const ti = this.compound.add(trans);
    const wi = this.compound.add(wall);
    const di = this.compound.add(deck);
    this.compound.connect(ti, wi);
    this.groundLinks.push(ti);
    this.groundHoles.push(new AnnularSectorBounds(s.x, -s.z, Rmaj, s.wallRadius + s.deckWidth, -s.th1, -s.th0));
    return { trans: ti, wall: wi, deck: di };
  }

  trough(name: string, s: TroughSpec): number {
    const path = new SplinePath(s.points);
    const t = new TroughSurface(name, path, s.radius, s.phiMax);
    const idx = this.compound.add(t);
    this.troughs.push(t);
    // Rim half-width on the ground: ρ·sin(φmax).
    this.groundHoles.push(new SplineStripHole(path, s.radius * Math.sin(s.phiMax), this.groundOrigin, this.groundU, this.groundV));
    return idx;
  }

  /** Finish: add the ground with all holes, link it, build the broadphase. */
  finish(groundHalfSize: number): Compound {
    this.addGround(groundHalfSize);
    this.compound.build();
    return this.compound;
  }

  get ground(): number {
    return this.groundIdx;
  }
}
