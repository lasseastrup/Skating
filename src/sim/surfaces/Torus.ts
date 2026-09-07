import { Box3, Vector3 } from 'three';
import { ProjectResult, type RideSurface } from '../Surface';
import { wrapAngle } from './Bounds';


/**
 * Torus section with a vertical axis: bowl corners, pool corners.
 * Tube centre circle: Cc + Rmaj·(cosθ, 0, sinθ). Surface: + r·(cosψ·radial + sinψ·Y).
 * θ ∈ [th0, th1] around the axis, ψ ∈ [ps0, ps1] around the tube (ψ = -π/2 is the floor
 * tangent, ψ = 0 is vertical wall). `concave` = riding the inside of the tube.
 */
export class TorusSurface implements RideSurface {
  readonly aabb = new Box3();
  private readonly thMid: number;
  private readonly psMid: number;
  private readonly d = new Vector3();
  private readonly radial = new Vector3();
  private readonly T = new Vector3();
  private readonly e = new Vector3();
  private readonly tau = new Vector3();
  private readonly eth = new Vector3();

  constructor(
    readonly id: string,
    readonly Cc: Vector3,
    readonly Rmaj: number,
    readonly r: number,
    readonly th0: number,
    readonly th1: number,
    readonly ps0: number,
    readonly ps1: number,
    readonly concave = true,
  ) {
    this.thMid = (th0 + th1) / 2;
    this.psMid = (ps0 + ps1) / 2;
    for (let i = 0; i <= 8; i++) {
      const th = th0 + ((th1 - th0) * i) / 8;
      for (let j = 0; j <= 4; j++) {
        const ps = ps0 + ((ps1 - ps0) * j) / 4;
        const rho = Rmaj + r * Math.cos(ps);
        this.d.set(Cc.x + rho * Math.cos(th), Cc.y + r * Math.sin(ps), Cc.z + rho * Math.sin(th));
        this.aabb.expandByPoint(this.d);
      }
    }
    this.aabb.expandByScalar(0.5);
  }

  project(p: Vector3, out: ProjectResult): void {
    this.d.subVectors(p, this.Cc);
    let th = wrapAngle(Math.atan2(this.d.z, this.d.x), this.thMid);
    const thClamped = th < this.th0 ? this.th0 : th > this.th1 ? this.th1 : th;
    this.radial.set(Math.cos(thClamped), 0, Math.sin(thClamped));
    this.T.copy(this.Cc).addScaledVector(this.radial, this.Rmaj);
    this.e.subVectors(p, this.T);
    const er = this.e.dot(this.radial);
    const ey = this.e.y;
    const rhoE = Math.hypot(er, ey);
    let ps = wrapAngle(Math.atan2(ey, er), this.psMid);

    const rhoAxis = this.Rmaj + this.r * Math.cos(ps < this.ps0 ? this.ps0 : ps > this.ps1 ? this.ps1 : ps);
    out.margin = Math.min(
      this.r * (ps - this.ps0),
      this.r * (this.ps1 - ps),
      rhoAxis * (th - this.th0),
      rhoAxis * (this.th1 - th),
    );
    if (ps < this.ps0) ps = this.ps0;
    else if (ps > this.ps1) ps = this.ps1;
    th = thClamped;

    const cp = Math.cos(ps);
    const sp = Math.sin(ps);
    out.point.copy(this.T).addScaledVector(this.radial, this.r * cp);
    out.point.y += this.r * sp;
    out.normal.copy(this.radial).multiplyScalar(cp);
    out.normal.y += sp;
    if (this.concave) {
      out.normal.negate();
      out.h = this.r - rhoE;
    } else {
      out.h = rhoE - this.r;
    }
    out.u = th;
    out.v = ps;
  }

  curvature(u: number, v: number, dir: Vector3): number {
    const cp = Math.cos(v);
    const sp = Math.sin(v);
    this.radial.set(Math.cos(u), 0, Math.sin(u));
    // Tube direction and parallel direction at (θ, ψ).
    this.tau.copy(this.radial).multiplyScalar(-sp);
    this.tau.y += cp;
    this.eth.set(-Math.sin(u), 0, Math.cos(u));
    const a = dir.dot(this.tau);
    const b = dir.dot(this.eth);
    const rho = this.Rmaj + this.r * cp;
    const k = (a * a) / this.r + (b * b * cp) / rho;
    return this.concave ? k : -k;
  }
}
