import { Box3, Vector3 } from 'three';
import { ProjectResult, type RideSurface } from '../Surface';
import type { Bounds2D, UV } from './Bounds';

/**
 * Bounded plane: flat ground, banks, ledge tops, decks, vert extensions.
 * origin + u·U + v·V, normal N = U × V points toward the skater side.
 * Holes let one big ground plane exclude ramp footprints so seams stay exact and non-overlapping.
 */
export class PlaneSurface implements RideSurface {
  readonly normal: Vector3;
  readonly aabb = new Box3();
  private readonly d = new Vector3();
  private readonly uv: UV = { u: 0, v: 0 };

  constructor(
    readonly id: string,
    readonly origin: Vector3,
    readonly U: Vector3,
    readonly V: Vector3,
    readonly bounds: Bounds2D,
    readonly holes: Bounds2D[] = [],
    /** Extent used for the AABB when bounds are large. */
    aabbExtent = 200,
  ) {
    this.normal = new Vector3().crossVectors(U, V).normalize();
    // AABB from sampling the bounds' clamp on a wide grid: cheap and primitive-agnostic.
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        this.uv.u = (i / 4) * aabbExtent;
        this.uv.v = (j / 4) * aabbExtent;
        bounds.clamp(this.uv);
        this.d.copy(origin).addScaledVector(U, this.uv.u).addScaledVector(V, this.uv.v);
        this.aabb.expandByPoint(this.d);
      }
    }
    this.aabb.expandByScalar(0.5);
    // A plane claims points above it, so its broadphase box reaches up to skater height.
    this.aabb.max.addScaledVector(this.normal, 1.5);
    this.aabb.min.addScaledVector(this.normal, -0.2);
  }

  /** Signed inside-margin for a (u, v), accounting for holes. */
  marginUV(u: number, v: number): number {
    let m = this.bounds.margin(u, v);
    for (let i = 0; i < this.holes.length; i++) {
      const hm = -this.holes[i].margin(u, v);
      if (hm < m) m = hm;
    }
    return m;
  }

  project(p: Vector3, out: ProjectResult): void {
    this.d.subVectors(p, this.origin);
    let u = this.d.dot(this.U);
    let v = this.d.dot(this.V);
    out.h = this.d.dot(this.normal);

    let margin = this.bounds.margin(u, v);
    let worstHole = -1;
    let worstHoleM = 0;
    for (let i = 0; i < this.holes.length; i++) {
      const hm = -this.holes[i].margin(u, v);
      if (hm < margin) margin = hm;
      if (hm < worstHoleM) {
        worstHoleM = hm;
        worstHole = i;
      }
    }
    out.margin = margin;
    if (margin < 0) {
      this.uv.u = u;
      this.uv.v = v;
      if (this.bounds.margin(u, v) < 0) this.bounds.clamp(this.uv);
      else if (worstHole >= 0) this.holes[worstHole].pushOut(this.uv);
      u = this.uv.u;
      v = this.uv.v;
    }
    out.u = u;
    out.v = v;
    out.point.copy(this.origin).addScaledVector(this.U, u).addScaledVector(this.V, v);
    out.normal.copy(this.normal);
  }

  curvature(): number {
    return 0;
  }
}
