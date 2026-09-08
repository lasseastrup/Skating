import { Vector3 } from 'three';
import { GrindPath } from './Grind';
import { AnnularSectorBounds, RectBounds, RoundedRectBounds, type Bounds2D } from './surfaces/Bounds';
import type { WallSeg } from './Walls';
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
  /** Optional taller section of the wall over a z-range: the "extension". */
  extension?: { z0: number; z1: number; height: number };
  /** Skip the side-cap walls (when another feature butts up against them). */
  noSideWalls?: boolean;
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

export interface LedgeSpec {
  x: number;
  z: number;
  length: number;
  width: number;
  height: number;
}

export interface KickerSpec {
  toeX: number;
  facing: 1 | -1;
  zCenter: number;
  width: number;
  transRadius: number;
  angle: number;
  bankLength: number;
}

export interface RollerSpec {
  xCenter: number;
  zCenter: number;
  width: number;
  height: number;
  angle: number;
}

export interface PlatformSpec {
  x: number;
  z: number;
  length: number;
  width: number;
  height: number;
  stairRun: number;
  hubbaWidth: number;
  hubbaEndHeight: number;
}

export interface BowlRoomSpec {
  x: number;
  z: number;
  /** Half sizes of the flat floor's straight part. */
  hx: number;
  hz: number;
  transRadius: number;
  vertExt: number;
  cornerRadius: number;
  open: { east?: boolean; west?: boolean; north?: boolean; south?: boolean };
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
    // Coping: straight grind paths along the lip, tilted a little over the transition. Split
    // around an extension, whose lip gets its own coping higher up.
    const copingRanges: [number, number, number][] = [];
    if (s.extension) {
      const e = s.extension;
      if (e.z0 > zc - hw) copingRanges.push([zc - hw, e.z0, deckY]);
      if (e.z1 < zc + hw) copingRanges.push([e.z1, zc + hw, deckY]);
      copingRanges.push([e.z0, e.z1, deckY + e.height]);
      // Extension wall: a taller vert plane over the range, adjacent to the main vert, plus its deck.
      const ext = new PlaneSurface(
        `${name}.ext`,
        new Vector3(s.wallX, deckY, zc),
        f > 0 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1),
        f > 0 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0),
        f > 0 ? new RectBounds(0, e.height, e.z0 - zc, e.z1 - zc) : new RectBounds(e.z0 - zc, e.z1 - zc, 0, e.height),
      );
      const ei = this.compound.add(ext);
      this.compound.connect(vi, ei);
      const extDeck = new PlaneSurface(
        `${name}.extDeck`,
        new Vector3(s.wallX, deckY + e.height, zc),
        new Vector3(1, 0, 0),
        new Vector3(0, 0, -1),
        f > 0 ? new RectBounds(-s.deckDepth, 0, -(e.z1 - zc), -(e.z0 - zc)) : new RectBounds(0, s.deckDepth, -(e.z1 - zc), -(e.z0 - zc)),
      );
      this.compound.add(extDeck);
    } else {
      copingRanges.push([zc - hw, zc + hw, deckY]);
    }
    for (const [z0, z1, y] of copingRanges) {
      if (z1 - z0 < 0.5) continue;
      this.compound.addGrind(
        new GrindPath(
          `${name}.coping`,
          new SplinePath([new Vector3(s.wallX, y, z0), new Vector3(s.wallX, y, (z0 + z1) / 2), new Vector3(s.wallX, y, z1)]),
          'coping',
          0.09,
          { dir: new Vector3(f, 0, 0), amount: 0.35 },
        ),
      );
    }
    // Side caps: the ramp body's two ends are walls from the toe to the deck.
    if (!s.noSideWalls) {
      const xToe = s.wallX + f * r;
      const xBack = s.wallX - f * s.deckDepth;
      for (const z of [zc - hw, zc + hw]) {
        this.compound.addWall({ ax: xToe, az: z, bx: xBack, bz: z, yBottom: 0, yTop: deckY, kind: 'wall', owner: `${name}.` });
      }
      // Back of the deck is a wall too (from the far side).
      this.compound.addWall({ ax: xBack, az: zc - hw, bx: xBack, bz: zc + hw, yBottom: 0, yTop: deckY, kind: 'wall', owner: `${name}.` });
    }
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
    // Pool coping around the lip, tilted toward the bowl axis.
    const pts: Vector3[] = [];
    const segs = 10;
    for (let i = 0; i <= segs; i++) {
      const th = s.th0 + ((s.th1 - s.th0) * i) / segs;
      pts.push(new Vector3(s.x + s.wallRadius * Math.cos(th), deckY, s.z + s.wallRadius * Math.sin(th)));
    }
    this.compound.addGrind(new GrindPath(`${name}.coping`, new SplinePath(pts), 'coping', 0.09, { toward: new Vector3(s.x, 0, s.z), amount: 0.35 }));
    return { trans: ti, wall: wi, deck: di };
  }

  /** A straight steel rail between two points. Visual-only until Phase 7 adds collision. */
  rail(name: string, a: Vector3, b: Vector3, radius: number): void {
    const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
    this.compound.addGrind(new GrindPath(name, new SplinePath([a.clone(), mid, b.clone()]), 'steel', radius + 0.08));
  }

  /**
   * A rectangular concrete ledge: a rideable top plane plus a grind path along each long edge.
   * Centre (x, z), length along X, width along Z.
   */
  ledge(name: string, s: LedgeSpec): number {
    const top = new PlaneSurface(
      `${name}.top`,
      new Vector3(s.x, s.height, s.z),
      new Vector3(1, 0, 0),
      new Vector3(0, 0, -1),
      new RectBounds(-s.length / 2, s.length / 2, -s.width / 2, s.width / 2),
    );
    const idx = this.compound.add(top);
    this.boxWalls(s.x - s.length / 2, s.x + s.length / 2, s.z - s.width / 2, s.z + s.width / 2, 0, s.height);
    for (const side of [-1, 1]) {
      const z = s.z + (side * s.width) / 2;
      this.compound.addGrind(
        new GrindPath(
          `${name}.edge${side > 0 ? 'S' : 'N'}`,
          new SplinePath([new Vector3(s.x - s.length / 2, s.height, z), new Vector3(s.x, s.height, z), new Vector3(s.x + s.length / 2, s.height, z)]),
          'concrete',
          0.09,
        ),
      );
    }
    return idx;
  }

  /** Four walls around an axis-aligned box footprint. */
  boxWalls(x0: number, x1: number, z0: number, z1: number, yBottom: number, yTop: number, kind: WallSeg['kind'] = 'wall'): void {
    this.compound.addWall({ ax: x0, az: z0, bx: x1, bz: z0, yBottom, yTop, kind });
    this.compound.addWall({ ax: x1, az: z0, bx: x1, bz: z1, yBottom, yTop, kind });
    this.compound.addWall({ ax: x1, az: z1, bx: x0, bz: z1, yBottom, yTop, kind });
    this.compound.addWall({ ax: x0, az: z1, bx: x0, bz: z0, yBottom, yTop, kind });
  }

  /**
   * A low box you can ride onto and manual across: rideable top, walls all round (mercy pops you
   * onto it), grind edges on the two long sides.
   */
  manualPad(name: string, s: LedgeSpec): number {
    return this.ledge(name, s);
  }

  /**
   * Kicker facing +X (facing = 1) or -X: a small concave transition from the ground into a flat
   * bank that ends in the air at the lip. Seams are tangent-matched at the toe and the crest.
   */
  kicker(name: string, s: KickerSpec): void {
    const f = s.facing;
    const hw = s.width / 2;
    const a = s.angle;
    // Concave transition of radius rT from flat to the bank angle, then a plane at that angle.
    const rT = s.transRadius;
    const C = new Vector3(s.toeX, rT, s.zCenter);
    // Circle centre above the toe; the arc runs from the bottom (θ=0) toward the bank direction.
    const E1 = new Vector3(0, -1, 0);
    const E2 = new Vector3(-f, 0, 0);
    const trans = new CylinderSurface(`${name}.trans`, C, E1, E2, rT, 0, a, -hw, hw, true);
    const ti = this.compound.add(trans);
    this.groundLinks.push(ti);
    // Bank plane starts where the arc ends.
    const startX = s.toeX - f * rT * Math.sin(a);
    const startY = rT * (1 - Math.cos(a));
    const L = s.bankLength;
    const U = new Vector3(-f * Math.cos(a), Math.sin(a), 0); // up the bank
    const V = f > 0 ? new Vector3(0, 0, 1) : new Vector3(0, 0, -1);
    // Normal U × V must point up-and-toward the skater (+f X, +Y): check by construction below.
    const bank = new PlaneSurface(`${name}.bank`, new Vector3(startX, startY, s.zCenter), U, V, new RectBounds(0, L, -hw, hw));
    if (bank.normal.y < 0) throw new Error('kicker bank normal flipped');
    const bi = this.compound.add(bank);
    this.compound.connect(ti, bi);
    const endX = startX - f * L * Math.cos(a);
    const endY = startY + L * Math.sin(a);
    // Footprint hole and walls on the sides and back.
    const [ua] = this.uv(Math.min(s.toeX, endX), 0);
    const [ub] = this.uv(Math.max(s.toeX, endX), 0);
    this.groundHoles.push(new RectBounds(ua, ub, -(s.zCenter + hw), -(s.zCenter - hw)));
    for (const z of [s.zCenter - hw, s.zCenter + hw]) this.compound.addWall({ ax: s.toeX, az: z, bx: endX, bz: z, yBottom: 0, yTop: endY, kind: 'wall' });
    this.compound.addWall({ ax: endX, az: s.zCenter - hw, bx: endX, bz: s.zCenter + hw, yBottom: 0, yTop: endY, kind: 'wall' });
  }

  /**
   * A roller (pump bump) along X: concave up, convex over the crest, concave down. All three arcs
   * meet tangent to tangent. Rideable in both directions; sides are walls.
   */
  roller(name: string, s: RollerSpec): void {
    const hw = s.width / 2;
    const alpha = s.angle;
    const R = s.height / (2 * (1 - Math.cos(alpha))); // equal radii for the concave and convex arcs
    const x0 = s.xCenter - 2 * R * Math.sin(alpha); // start of the roller on the -X side
    // Concave up (approaching from -X): centre above x0.
    const c1 = new CylinderSurface(`${name}.up`, new Vector3(x0, R, s.zCenter), new Vector3(0, -1, 0), new Vector3(1, 0, 0), R, 0, alpha, -hw, hw, true);
    // Convex crest: centre below the crest at height h - R.
    const crestY = s.height;
    const cv = new CylinderSurface(`${name}.crest`, new Vector3(s.xCenter, crestY - R, s.zCenter), new Vector3(0, 1, 0), new Vector3(-1, 0, 0), R, -alpha, alpha, -hw, hw, false);
    // Concave down.
    const x1 = s.xCenter + 2 * R * Math.sin(alpha);
    const c2 = new CylinderSurface(`${name}.down`, new Vector3(x1, R, s.zCenter), new Vector3(0, -1, 0), new Vector3(-1, 0, 0), R, 0, alpha, -hw, hw, true);
    const i1 = this.compound.add(c1);
    const iv = this.compound.add(cv);
    const i2 = this.compound.add(c2);
    this.compound.connect(i1, iv);
    this.compound.connect(iv, i2);
    this.groundLinks.push(i1, i2);
    const [ua] = this.uv(x0, 0);
    const [ub] = this.uv(x1, 0);
    this.groundHoles.push(new RectBounds(ua, ub, -(s.zCenter + hw), -(s.zCenter - hw)));
    for (const z of [s.zCenter - hw, s.zCenter + hw]) this.compound.addWall({ ax: x0, az: z, bx: x1, bz: z, yBottom: 0, yTop: s.height, kind: 'wall' });
  }

  /**
   * Raised platform with a stair set down one side (+X) and a hubba ledge along the stairs.
   * The platform top and hubba top are rideable; the stair face is a 'stairs' wall (mercy pops
   * you up it if you are fast enough, otherwise you slide along it).
   */
  platform(name: string, s: PlatformSpec): void {
    const top = new PlaneSurface(
      `${name}.top`,
      new Vector3(s.x, s.height, s.z),
      new Vector3(1, 0, 0),
      new Vector3(0, 0, -1),
      new RectBounds(-s.length / 2, s.length / 2, -s.width / 2, s.width / 2),
    );
    const topIdx = this.compound.add(top);
    const x0 = s.x - s.length / 2, x1 = s.x + s.length / 2, z0 = s.z - s.width / 2, z1 = s.z + s.width / 2;
    this.compound.addWall({ ax: x0, az: z0, bx: x1, bz: z0, yBottom: 0, yTop: s.height, kind: 'wall' });
    this.compound.addWall({ ax: x0, az: z1, bx: x0, bz: z0, yBottom: 0, yTop: s.height, kind: 'wall' });
    this.compound.addWall({ ax: x1, az: z1, bx: x0, bz: z1, yBottom: 0, yTop: s.height, kind: 'wall' });
    // Stairs: physically a bank from the platform edge down to the ground (the steps are visual).
    // Rolling off the top lands you on it; rolling into it from below is a 27° climb you either
    // make with speed or roll back down. No hole to fall through either way.
    const stairEnd = x1 + s.stairRun;
    const Us = new Vector3(s.stairRun, -s.height, 0).normalize();
    const stairs = new PlaneSurface(`${name}.stairs`, new Vector3(x1, s.height, s.z), Us, new Vector3(0, 0, -1), new RectBounds(0, Math.hypot(s.stairRun, s.height), -s.width / 2, s.width / 2));
    if (stairs.normal.y < 0) throw new Error('stairs normal flipped');
    const stairsIdx = this.compound.add(stairs);
    this.compound.connect(topIdx, stairsIdx);
    this.groundLinks.push(stairsIdx);
    this.groundHoles.push(new RectBounds(x0, stairEnd, -z1, -z0));
    // Hubba: a sloped ledge along the +z side of the stairs, top rideable, both edges grindable.
    const hz0 = z1, hz1 = z1 + s.hubbaWidth;
    const yTopStart = s.height, yEnd = s.hubbaEndHeight;
    const hubbaLen = Math.hypot(s.stairRun, yTopStart - yEnd);
    const U = new Vector3(s.stairRun, yEnd - yTopStart, 0).normalize();
    const hub = new PlaneSurface(`${name}.hubba`, new Vector3(x1, yTopStart, (hz0 + hz1) / 2), U, new Vector3(0, 0, -1), new RectBounds(0, hubbaLen, -s.hubbaWidth / 2, s.hubbaWidth / 2));
    if (hub.normal.y < 0) throw new Error('hubba normal flipped');
    this.compound.add(hub);
    this.groundHoles.push(new RectBounds(x1, stairEnd, -hz1, -hz0));
    for (const z of [hz0, hz1]) {
      this.compound.addGrind(new GrindPath(`${name}.hubba${z === hz0 ? 'N' : 'S'}`, new SplinePath([new Vector3(x1, yTopStart, z), new Vector3((x1 + stairEnd) / 2, (yTopStart + yEnd) / 2, z), new Vector3(stairEnd, yEnd, z)]), 'concrete', 0.09));
    }
    this.compound.addWall({ ax: x1, az: hz1, bx: stairEnd, bz: hz1, yBottom: 0, yTop: yTopStart, kind: 'wall' });
    this.compound.addWall({ ax: stairEnd, az: hz0, bx: stairEnd, bz: hz1, yBottom: 0, yTop: yEnd, kind: 'wall' });
    // Platform top edge along the hubba side is also grindable (a ledge at height).
    this.compound.addGrind(new GrindPath(`${name}.edge`, new SplinePath([new Vector3(x0, s.height, z0), new Vector3(s.x, s.height, z0), new Vector3(x1, s.height, z0)]), 'concrete', 0.09));
  }

  /**
   * Sunken pool room: a rounded-rectangle bowl with its deck at ground level. Floor at
   * -(r + vertExt). Four torus corners, straight cylinder walls (any may be omitted for an
   * opening), vert planes and pool coping around the lip. The ground itself is the deck.
   */
  bowlRoom(name: string, s: BowlRoomSpec): { floor: number } {
    const r = s.transRadius;
    const depth = r + s.vertExt;
    const floorY = -depth;
    const Rc = s.cornerRadius; // floor-edge corner radius = torus major radius
    const R = Rc + r; // wall radius at the corners
    // Floor: rounded rect in ground (u = x, v = -z) coordinates.
    const floor = new PlaneSurface(`${name}.floor`, new Vector3(0, floorY, 0), new Vector3(1, 0, 0), new Vector3(0, 0, -1), new RoundedRectBounds(s.x, -s.z, s.hx, s.hz, Rc));
    const fi = this.compound.add(floor);
    // Corners: axes at the floor rect's corners; θ ranges per quadrant (x+,z+) etc.
    const corners: [number, number, number, number][] = [
      [s.x + s.hx, s.z + s.hz, 0, Math.PI / 2],
      [s.x - s.hx, s.z + s.hz, Math.PI / 2, Math.PI],
      [s.x - s.hx, s.z - s.hz, Math.PI, (3 * Math.PI) / 2],
      [s.x + s.hx, s.z - s.hz, (3 * Math.PI) / 2, 2 * Math.PI],
    ];
    corners.forEach(([cx, cz, th0, th1], i) => {
      const Cc = new Vector3(cx, floorY + r, cz);
      const trans = new TorusSurface(`${name}.c${i}`, Cc, Rc, r, th0, th1, -Math.PI / 2, 0, true);
      const wall = new CylinderSurface(`${name}.cw${i}`, new Vector3(cx, 0, cz), new Vector3(1, 0, 0), new Vector3(0, 0, 1), R, th0, th1, floorY + r, 0, true);
      const ti = this.compound.add(trans);
      const wi = this.compound.add(wall);
      this.compound.connect(fi, ti);
      this.compound.connect(ti, wi);
      const pts: Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const th = th0 + ((th1 - th0) * k) / 6;
        pts.push(new Vector3(cx + R * Math.cos(th), 0, cz + R * Math.sin(th)));
      }
      this.compound.addGrind(new GrindPath(`${name}.coping`, new SplinePath(pts), 'coping', 0.09, { toward: new Vector3(cx, 0, cz), amount: 0.35 }));
    });
    // Straight walls: +x, -x, +z, -z sides unless opened.
    const sides: { key: keyof BowlRoomSpec['open']; dir: Vector3; wallPos: number; len: number; center: Vector3 }[] = [
      { key: 'east', dir: new Vector3(1, 0, 0), wallPos: s.x + s.hx + Rc + r, len: 2 * s.hz, center: new Vector3(s.x + s.hx + Rc, 0, s.z) },
      { key: 'west', dir: new Vector3(-1, 0, 0), wallPos: s.x - s.hx - Rc - r, len: 2 * s.hz, center: new Vector3(s.x - s.hx - Rc, 0, s.z) },
      { key: 'south', dir: new Vector3(0, 0, 1), wallPos: s.z + s.hz + Rc + r, len: 2 * s.hx, center: new Vector3(s.x, 0, s.z + s.hz + Rc) },
      { key: 'north', dir: new Vector3(0, 0, -1), wallPos: s.z - s.hz - Rc - r, len: 2 * s.hx, center: new Vector3(s.x, 0, s.z - s.hz - Rc) },
    ];
    for (const side of sides) {
      if (s.open[side.key]) continue;
      const d = side.dir; // outward horizontal direction toward the wall
      // Transition cylinder: axis horizontal along the wall, centre at floor edge + r up, r in from the wall.
      const along = new Vector3(-d.z, 0, d.x); // along the wall
      const C = new Vector3().copy(side.center).addScaledVector(d, -r + r).setY(floorY + r); // floor edge is at distance Rc from the rect; circle centre sits above it
      // Floor edge line is at the rounded-rect boundary: centre + d·Rc; the circle centre is above that point.
      C.copy(side.center).setY(floorY + r);
      const E1 = new Vector3(0, -1, 0);
      const E2 = d.clone(); // θ=π/2 puts the surface point at C + r·d = the wall
      const trans = new CylinderSurface(`${name}.w${side.key}`, C, E1, E2, r, 0, Math.PI / 2, -side.len / 2, side.len / 2, true);
      // A = E1 × E2 gives the axis direction; make sure it equals ±along (it does by construction).
      const ti = this.compound.add(trans);
      this.compound.connect(fi, ti);
      // Vert plane above it: origin at the wall base, U up, V along; normal must point inward (-d).
      const wallBase = new Vector3().copy(side.center).addScaledVector(d, r).setY(floorY + r);
      const U = new Vector3(0, 1, 0);
      let V = along.clone();
      let vert = new PlaneSurface(`${name}.v${side.key}`, wallBase, U, V, new RectBounds(0, s.vertExt, -side.len / 2, side.len / 2));
      if (vert.normal.dot(d) > 0) {
        V = along.clone().negate();
        vert = new PlaneSurface(`${name}.v${side.key}`, wallBase, U, V, new RectBounds(0, s.vertExt, -side.len / 2, side.len / 2));
      }
      const vi = this.compound.add(vert);
      this.compound.connect(ti, vi);
      const a = new Vector3().copy(wallBase).addScaledVector(along, -side.len / 2).setY(0);
      const b = new Vector3().copy(wallBase).addScaledVector(along, side.len / 2).setY(0);
      this.compound.addGrind(new GrindPath(`${name}.coping`, new SplinePath([a, a.clone().lerp(b, 0.5), b]), 'coping', 0.09, { dir: d.clone().negate(), amount: 0.35 }));
    }
    // Ground hole: the bowl's rim footprint (rounded rect grown by r). Openings are covered by the caller.
    this.groundHoles.push(new RoundedRectBounds(s.x, -s.z, s.hx, s.hz, Rc + r));
    return { floor: fi };
  }

  /**
   * A flat ramp plane between two heights over a rectangle along X (a bank in a pool floor or a
   * roll-in). Ends meet the neighbours at a normal change of the slope angle; small slopes only.
   */
  bankX(name: string, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, neighbours: number[]): number {
    const U = new Vector3(x1 - x0, y1 - y0, 0).normalize();
    const L = Math.hypot(x1 - x0, y1 - y0);
    const plane = new PlaneSurface(`${name}`, new Vector3(x0, y0, (z0 + z1) / 2), U, new Vector3(0, 0, -1), new RectBounds(0, L, -(z1 - z0) / 2, (z1 - z0) / 2));
    if (plane.normal.y < 0) throw new Error(`${name} normal flipped`);
    const idx = this.compound.add(plane);
    for (const n of neighbours) this.compound.connect(idx, n);
    return idx;
  }

  /** Add a ground hole for a rectangle (world x/z). */
  groundHoleRect(x0: number, x1: number, z0: number, z1: number): void {
    this.groundHoles.push(new RectBounds(Math.min(x0, x1), Math.max(x0, x1), -Math.max(z0, z1), -Math.min(z0, z1)));
  }

  /** Link an existing surface to the ground (it shares an edge with it). */
  linkGround(idx: number): void {
    this.groundLinks.push(idx);
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
