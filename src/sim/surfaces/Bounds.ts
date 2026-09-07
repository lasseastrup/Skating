/**
 * 2D parametric bounds for planar primitives. `margin` is positive inside, negative outside,
 * in the plane's own units (metres). `clamp` moves an outside point to the nearest inside point.
 * `pushOut` does the reverse, for use as a hole.
 */
export interface UV {
  u: number;
  v: number;
}

export interface Bounds2D {
  margin(u: number, v: number): number;
  clamp(uv: UV): void;
  pushOut(uv: UV): void;
}

export class RectBounds implements Bounds2D {
  constructor(
    readonly u0: number,
    readonly u1: number,
    readonly v0: number,
    readonly v1: number,
  ) {}

  margin(u: number, v: number): number {
    return Math.min(u - this.u0, this.u1 - u, v - this.v0, this.v1 - v);
  }

  clamp(uv: UV): void {
    if (uv.u < this.u0) uv.u = this.u0;
    else if (uv.u > this.u1) uv.u = this.u1;
    if (uv.v < this.v0) uv.v = this.v0;
    else if (uv.v > this.v1) uv.v = this.v1;
  }

  pushOut(uv: UV): void {
    const du0 = uv.u - this.u0;
    const du1 = this.u1 - uv.u;
    const dv0 = uv.v - this.v0;
    const dv1 = this.v1 - uv.v;
    const m = Math.min(du0, du1, dv0, dv1);
    if (m === du0) uv.u = this.u0;
    else if (m === du1) uv.u = this.u1;
    else if (m === dv0) uv.v = this.v0;
    else uv.v = this.v1;
  }
}

/** Wrap `a` into [ref - π, ref + π). */
export function wrapAngle(a: number, ref: number): number {
  let d = a - ref;
  d -= Math.floor((d + Math.PI) / (2 * Math.PI)) * 2 * Math.PI;
  return ref + d;
}

/**
 * Annular sector in polar coordinates about (cu, cv): radius in [r0, r1], angle in [a0, a1]
 * where angle = atan2(v - cv, u - cu). a1 - a0 must be ≤ 2π.
 */
export class AnnularSectorBounds implements Bounds2D {
  private readonly mid: number;
  constructor(
    readonly cu: number,
    readonly cv: number,
    readonly r0: number,
    readonly r1: number,
    readonly a0: number,
    readonly a1: number,
  ) {
    this.mid = (a0 + a1) / 2;
  }

  margin(u: number, v: number): number {
    const du = u - this.cu;
    const dv = v - this.cv;
    const r = Math.hypot(du, dv);
    const a = wrapAngle(Math.atan2(dv, du), this.mid);
    const rc = Math.max(r, 1e-6);
    return Math.min(r - this.r0, this.r1 - r, rc * (a - this.a0), rc * (this.a1 - a));
  }

  clamp(uv: UV): void {
    const du = uv.u - this.cu;
    const dv = uv.v - this.cv;
    let r = Math.hypot(du, dv);
    let a = wrapAngle(Math.atan2(dv, du), this.mid);
    if (r < this.r0) r = this.r0;
    else if (r > this.r1) r = this.r1;
    if (a < this.a0) a = this.a0;
    else if (a > this.a1) a = this.a1;
    uv.u = this.cu + r * Math.cos(a);
    uv.v = this.cv + r * Math.sin(a);
  }

  pushOut(uv: UV): void {
    const du = uv.u - this.cu;
    const dv = uv.v - this.cv;
    let r = Math.hypot(du, dv);
    let a = wrapAngle(Math.atan2(dv, du), this.mid);
    const rc = Math.max(r, 1e-6);
    const m0 = r - this.r0;
    const m1 = this.r1 - r;
    const ma0 = rc * (a - this.a0);
    const ma1 = rc * (this.a1 - a);
    const m = Math.min(m0, m1, ma0, ma1);
    if (m === m0) r = this.r0;
    else if (m === m1) r = this.r1;
    else if (m === ma0) a = this.a0;
    else a = this.a1;
    uv.u = this.cu + r * Math.cos(a);
    uv.v = this.cv + r * Math.sin(a);
  }
}
