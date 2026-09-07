import { Vector3 } from 'three';

/**
 * Uniform Catmull-Rom path through control points, with a dense sample table for closest-point
 * search. Closest point = coarse scan of the table, then Newton refinement on |P(t) - p|².
 * Not "exact" in closed form (no spline is), but converged to ~1e-6 m, which is exact enough.
 */
export class SplinePath {
  readonly segments: number;
  /** Samples per segment in the table. */
  readonly density = 12;
  /** Arc length at each table sample. */
  readonly arcLength: Float64Array;
  readonly totalLength: number;
  private readonly table: Float64Array;
  private readonly count: number;

  private readonly P = new Vector3();
  private readonly dP = new Vector3();
  private readonly ddP = new Vector3();
  private readonly tmp = new Vector3();

  constructor(readonly points: Vector3[]) {
    if (points.length < 2) throw new Error('SplinePath needs at least 2 points');
    this.segments = points.length - 1;
    this.count = this.segments * this.density + 1;
    this.table = new Float64Array(this.count * 3);
    this.arcLength = new Float64Array(this.count);
    let len = 0;
    for (let i = 0; i < this.count; i++) {
      const t = i / (this.count - 1);
      this.evaluate(t, this.P);
      if (i > 0) {
        len += Math.hypot(this.P.x - this.table[(i - 1) * 3], this.P.y - this.table[(i - 1) * 3 + 1], this.P.z - this.table[(i - 1) * 3 + 2]);
      }
      this.table[i * 3] = this.P.x;
      this.table[i * 3 + 1] = this.P.y;
      this.table[i * 3 + 2] = this.P.z;
      this.arcLength[i] = len;
    }
    this.totalLength = len;
  }

  private control(i: number): Vector3 {
    const n = this.points.length;
    return this.points[i < 0 ? 0 : i >= n ? n - 1 : i];
  }

  /**
   * Position and optionally first/second derivative (w.r.t. global t ∈ [0,1]) at t.
   */
  evaluate(t: number, outP: Vector3, outD?: Vector3, outDD?: Vector3): void {
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const s = t * this.segments;
    let i = Math.floor(s);
    if (i >= this.segments) i = this.segments - 1;
    const x = s - i;
    const a = this.control(i - 1);
    const b = this.control(i);
    const c = this.control(i + 1);
    const d = this.control(i + 2);
    // Catmull-Rom basis (tension 0.5).
    const x2 = x * x;
    const x3 = x2 * x;
    const w0 = -0.5 * x3 + x2 - 0.5 * x;
    const w1 = 1.5 * x3 - 2.5 * x2 + 1;
    const w2 = -1.5 * x3 + 2 * x2 + 0.5 * x;
    const w3 = 0.5 * x3 - 0.5 * x2;
    outP.set(
      a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3,
      a.y * w0 + b.y * w1 + c.y * w2 + d.y * w3,
      a.z * w0 + b.z * w1 + c.z * w2 + d.z * w3,
    );
    if (outD) {
      const k = this.segments; // d/dt = d/dx · segments
      const d0 = (-1.5 * x2 + 2 * x - 0.5) * k;
      const d1 = (4.5 * x2 - 5 * x) * k;
      const d2 = (-4.5 * x2 + 4 * x + 0.5) * k;
      const d3 = (1.5 * x2 - x) * k;
      outD.set(
        a.x * d0 + b.x * d1 + c.x * d2 + d.x * d3,
        a.y * d0 + b.y * d1 + c.y * d2 + d.y * d3,
        a.z * d0 + b.z * d1 + c.z * d2 + d.z * d3,
      );
    }
    if (outDD) {
      const k2 = this.segments * this.segments;
      const e0 = (-3 * x + 2) * k2;
      const e1 = (9 * x - 5) * k2;
      const e2 = (-9 * x + 4) * k2;
      const e3 = (3 * x - 1) * k2;
      outDD.set(
        a.x * e0 + b.x * e1 + c.x * e2 + d.x * e3,
        a.y * e0 + b.y * e1 + c.y * e2 + d.y * e3,
        a.z * e0 + b.z * e1 + c.z * e2 + d.z * e3,
      );
    }
  }

  /** Parameter t of the closest point on the path to p. */
  closestT(p: Vector3): number {
    let best = 0;
    let bestD = Infinity;
    const tb = this.table;
    for (let i = 0; i < this.count; i++) {
      const dx = tb[i * 3] - p.x;
      const dy = tb[i * 3 + 1] - p.y;
      const dz = tb[i * 3 + 2] - p.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    let t = best / (this.count - 1);
    // Newton on f(t) = |P - p|²: f' = 2(P-p)·P', f'' = 2(P'·P' + (P-p)·P'').
    for (let it = 0; it < 4; it++) {
      this.evaluate(t, this.P, this.dP, this.ddP);
      this.tmp.subVectors(this.P, p);
      const f1 = 2 * this.tmp.dot(this.dP);
      const f2 = 2 * (this.dP.dot(this.dP) + this.tmp.dot(this.ddP));
      if (Math.abs(f2) < 1e-9) break;
      let nt = t - f1 / f2;
      if (nt < 0) nt = 0;
      else if (nt > 1) nt = 1;
      if (Math.abs(nt - t) < 1e-7) {
        t = nt;
        break;
      }
      t = nt;
    }
    return t;
  }

  /** Arc length from the start to parameter t (table interpolation). */
  arcAt(t: number): number {
    const s = t * (this.count - 1);
    const i = Math.min(this.count - 2, Math.max(0, Math.floor(s)));
    const f = s - i;
    return this.arcLength[i] * (1 - f) + this.arcLength[i + 1] * f;
  }

  /** Unit tangent and curvature vector (dT/ds) at t. */
  frame(t: number, outP: Vector3, outT: Vector3, outK: Vector3): void {
    this.evaluate(t, outP, this.dP, this.ddP);
    const speed2 = Math.max(1e-9, this.dP.lengthSq());
    outT.copy(this.dP).normalize();
    // κ = (P'' - (P''·T)T) / |P'|²
    outK.copy(this.ddP).addScaledVector(outT, -this.ddP.dot(outT)).divideScalar(speed2);
  }
}
