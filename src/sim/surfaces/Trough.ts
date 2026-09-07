import { Box3, Vector3 } from 'three';
import { ProjectResult, type RideSurface } from '../Surface';
import type { Bounds2D, UV } from './Bounds';
import type { SplinePath } from './Spline';

const Y = new Vector3(0, 1, 0);

/**
 * SplineExtrusion with a circular-trough profile: snake runs, curved channels. The profile
 * circle of radius `rho` is centred `rho` above the path, so the path is the channel floor.
 * φ ∈ [-phiMax, phiMax] across the channel; φ = ±π/2 is a vertical rim.
 * Frame along the path: T from the spline, up = Y made perpendicular to T, right = T × up.
 */
export class TroughSurface implements RideSurface {
  readonly aabb = new Box3();
  private readonly P = new Vector3();
  private readonly T = new Vector3();
  private readonly K = new Vector3();
  private readonly up = new Vector3();
  private readonly right = new Vector3();
  private readonly Pc = new Vector3();
  private readonly e = new Vector3();
  private readonly tauPhi = new Vector3();

  constructor(
    readonly id: string,
    readonly path: SplinePath,
    readonly rho: number,
    readonly phiMax: number,
  ) {
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      path.frame(t, this.P, this.T, this.K);
      this.frameAt();
      for (let j = 0; j <= 4; j++) {
        const phi = -phiMax + (2 * phiMax * j) / 4;
        this.e.copy(this.Pc).addScaledVector(this.right, rho * Math.sin(phi)).addScaledVector(this.up, -rho * Math.cos(phi));
        this.aabb.expandByPoint(this.e);
      }
    }
    this.aabb.expandByScalar(0.5);
  }

  /** up/right/Pc from the current P/T. */
  private frameAt(): void {
    this.up.copy(Y).addScaledVector(this.T, -Y.dot(this.T)).normalize();
    this.right.crossVectors(this.T, this.up).normalize();
    this.Pc.copy(this.P).addScaledVector(this.up, this.rho);
  }

  project(p: Vector3, out: ProjectResult): void {
    const t = this.path.closestT(p);
    this.path.frame(t, this.P, this.T, this.K);
    this.frameAt();
    this.e.subVectors(p, this.Pc);
    const er = this.e.dot(this.right);
    const eu = this.e.dot(this.up);
    let phi = Math.atan2(er, -eu);
    const s = this.path.arcAt(t);
    out.margin = Math.min(this.rho * (this.phiMax - Math.abs(phi)), s, this.path.totalLength - s);
    if (phi < -this.phiMax) phi = -this.phiMax;
    else if (phi > this.phiMax) phi = this.phiMax;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    out.point.copy(this.Pc).addScaledVector(this.right, this.rho * sp).addScaledVector(this.up, -this.rho * cp);
    out.normal.copy(this.right).multiplyScalar(-sp).addScaledVector(this.up, cp);
    out.h = this.rho - Math.hypot(er, eu);
    out.u = t;
    out.v = phi;
  }

  curvature(u: number, v: number, dir: Vector3): number {
    this.path.frame(u, this.P, this.T, this.K);
    this.frameAt();
    const sp = Math.sin(v);
    const cp = Math.cos(v);
    this.tauPhi.copy(this.right).multiplyScalar(cp).addScaledVector(this.up, sp);
    const a = dir.dot(this.tauPhi);
    const b = dir.dot(this.T);
    // Normal at (v): -(sinφ right) + cosφ up. Path curvature contributes its component along it.
    this.e.copy(this.right).multiplyScalar(-sp).addScaledVector(this.up, cp);
    return (a * a) / this.rho + b * b * this.K.dot(this.e);
  }
}

/**
 * Ground-plane hole shaped as a strip of half-width `halfWidth` around a spline path.
 * Works in the plane's (u, v) by reconstructing the 3D point.
 */
export class SplineStripHole implements Bounds2D {
  private readonly p = new Vector3();
  private readonly q = new Vector3();
  constructor(
    readonly path: SplinePath,
    readonly halfWidth: number,
    readonly origin: Vector3,
    readonly U: Vector3,
    readonly V: Vector3,
  ) {}

  private dist(u: number, v: number): number {
    this.p.copy(this.origin).addScaledVector(this.U, u).addScaledVector(this.V, v);
    const t = this.path.closestT(this.p);
    this.path.evaluate(t, this.q);
    // Distance in the plane only (the path may sit below the plane).
    this.q.sub(this.p);
    const du = this.q.dot(this.U);
    const dv = this.q.dot(this.V);
    return Math.hypot(du, dv);
  }

  margin(u: number, v: number): number {
    return this.halfWidth - this.dist(u, v);
  }

  clamp(uv: UV): void {
    // Not used as outer bounds. Move onto the path.
    this.p.copy(this.origin).addScaledVector(this.U, uv.u).addScaledVector(this.V, uv.v);
    const t = this.path.closestT(this.p);
    this.path.evaluate(t, this.q);
    this.q.sub(this.origin);
    uv.u = this.q.dot(this.U);
    uv.v = this.q.dot(this.V);
  }

  pushOut(uv: UV): void {
    this.p.copy(this.origin).addScaledVector(this.U, uv.u).addScaledVector(this.V, uv.v);
    const t = this.path.closestT(this.p);
    this.path.evaluate(t, this.q);
    this.q.sub(this.origin);
    const cu = this.q.dot(this.U);
    const cv = this.q.dot(this.V);
    let du = uv.u - cu;
    let dv = uv.v - cv;
    const d = Math.hypot(du, dv);
    if (d < 1e-6) {
      du = 1;
      dv = 0;
    } else {
      du /= d;
      dv /= d;
    }
    uv.u = cu + du * this.halfWidth;
    uv.v = cv + dv * this.halfWidth;
  }
}
