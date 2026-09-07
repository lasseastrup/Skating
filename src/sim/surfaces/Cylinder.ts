import { Box3, Vector3 } from 'three';
import { ProjectResult, type RideSurface } from '../Surface';
import { wrapAngle } from './Bounds';

/**
 * Cylinder section: quarter pipes, half-pipe transitions, spines, bowl walls.
 * Points: C + r·(cosθ·E1 + sinθ·E2) + t·A, with A = E1 × E2, θ ∈ [th0, th1], t ∈ [t0, t1].
 * `concave` = the skater rides the inside (normal points toward the axis).
 */
export class CylinderSurface implements RideSurface {
  readonly A: Vector3;
  readonly aabb = new Box3();
  private readonly mid: number;
  private readonly d = new Vector3();
  private readonly radial = new Vector3();
  private readonly circ = new Vector3();

  constructor(
    readonly id: string,
    readonly C: Vector3,
    readonly E1: Vector3,
    readonly E2: Vector3,
    readonly r: number,
    readonly th0: number,
    readonly th1: number,
    readonly t0: number,
    readonly t1: number,
    readonly concave = true,
  ) {
    this.A = new Vector3().crossVectors(E1, E2).normalize();
    this.mid = (th0 + th1) / 2;
    for (let i = 0; i <= 8; i++) {
      const th = th0 + ((th1 - th0) * i) / 8;
      for (const t of [t0, t1]) {
        this.d.copy(C).addScaledVector(E1, r * Math.cos(th)).addScaledVector(E2, r * Math.sin(th)).addScaledVector(this.A, t);
        this.aabb.expandByPoint(this.d);
      }
    }
    this.aabb.expandByScalar(0.5);
  }

  project(p: Vector3, out: ProjectResult): void {
    this.d.subVectors(p, this.C);
    let t = this.d.dot(this.A);
    const d1 = this.d.dot(this.E1);
    const d2 = this.d.dot(this.E2);
    const rho = Math.hypot(d1, d2);
    let th = wrapAngle(Math.atan2(d2, d1), this.mid);

    out.margin = Math.min(this.r * (th - this.th0), this.r * (this.th1 - th), t - this.t0, this.t1 - t);
    if (th < this.th0) th = this.th0;
    else if (th > this.th1) th = this.th1;
    if (t < this.t0) t = this.t0;
    else if (t > this.t1) t = this.t1;

    const c = Math.cos(th);
    const s = Math.sin(th);
    this.radial.copy(this.E1).multiplyScalar(c).addScaledVector(this.E2, s);
    out.point.copy(this.C).addScaledVector(this.radial, this.r).addScaledVector(this.A, t);
    if (this.concave) {
      out.normal.copy(this.radial).negate();
      out.h = this.r - rho;
    } else {
      out.normal.copy(this.radial);
      out.h = rho - this.r;
    }
    out.u = th;
    out.v = t;
  }

  curvature(u: number, _v: number, dir: Vector3): number {
    this.circ.copy(this.E1).multiplyScalar(-Math.sin(u)).addScaledVector(this.E2, Math.cos(u));
    const c = dir.dot(this.circ);
    const k = (c * c) / this.r;
    return this.concave ? k : -k;
  }
}
