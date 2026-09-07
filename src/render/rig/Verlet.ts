import { Vector3 } from 'three';

/**
 * One Verlet particle pulled toward a target. Because it lags and overshoots, the body gets
 * anticipation and follow-through for free. Never reduce the lag to fix jitter: raise stiffness
 * or add a constraint. The lag is the point.
 */
export class Particle {
  readonly pos = new Vector3();
  readonly prev = new Vector3();
  private readonly tmp = new Vector3();

  reset(p: Vector3): void {
    this.pos.copy(p);
    this.prev.copy(p);
  }

  /** Semi-implicit Verlet step toward `target` with local gravity. */
  step(target: Vector3, gravity: Vector3, stiffness: number, drag: number, dt: number): void {
    this.tmp.subVectors(this.pos, this.prev).multiplyScalar(1 - drag);
    this.prev.copy(this.pos);
    this.pos.add(this.tmp);
    this.tmp.subVectors(target, this.pos).multiplyScalar(stiffness * dt * dt);
    this.pos.add(this.tmp).addScaledVector(gravity, dt * dt);
  }

  /** Keep exactly `len` from an anchor. */
  constrainDistance(anchor: Vector3, len: number): void {
    this.tmp.subVectors(this.pos, anchor);
    const d = this.tmp.length();
    if (d < 1e-6) {
      this.pos.copy(anchor).y -= len;
      return;
    }
    this.pos.copy(anchor).addScaledVector(this.tmp, len / d);
  }

  /** Keep within [minLen, maxLen] of an anchor. */
  constrainRange(anchor: Vector3, minLen: number, maxLen: number): void {
    this.tmp.subVectors(this.pos, anchor);
    const d = this.tmp.length();
    if (d < 1e-6) {
      this.pos.copy(anchor).y -= minLen;
      return;
    }
    if (d > maxLen) this.pos.copy(anchor).addScaledVector(this.tmp, maxLen / d);
    else if (d < minLen) this.pos.copy(anchor).addScaledVector(this.tmp, minLen / d);
  }
}
