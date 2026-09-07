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
    // A particle that has blown up (NaN or absurdly far) is snapped back to its target.
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.prev.x + this.prev.y + this.prev.z) || this.pos.distanceToSquared(target) > 100) this.reset(target);
    this.tmp.subVectors(this.pos, this.prev).multiplyScalar(1 - drag);
    this.prev.copy(this.pos);
    this.pos.add(this.tmp);
    this.tmp.subVectors(target, this.pos).multiplyScalar(stiffness * dt * dt);
    this.pos.add(this.tmp).addScaledVector(gravity, dt * dt);
  }

  /**
   * Keep exactly `len` from an anchor. The correction moves `prev` by the same amount: a
   * constraint must not turn into velocity, or every correction is thrown back into the next
   * step and the particle rings harder each solve until it flips through the anchor.
   */
  constrainDistance(anchor: Vector3, len: number): void {
    this.tmp.subVectors(this.pos, anchor);
    const d = this.tmp.length();
    if (d < 1e-6) {
      this.moveTo(anchor.x, anchor.y - len, anchor.z);
      return;
    }
    const s = len / d;
    this.moveTo(anchor.x + this.tmp.x * s, anchor.y + this.tmp.y * s, anchor.z + this.tmp.z * s);
  }

  /** Keep within [minLen, maxLen] of an anchor (velocity-preserving, as above). */
  constrainRange(anchor: Vector3, minLen: number, maxLen: number): void {
    this.tmp.subVectors(this.pos, anchor);
    const d = this.tmp.length();
    if (d < 1e-6) {
      this.moveTo(anchor.x, anchor.y - minLen, anchor.z);
      return;
    }
    const s = d > maxLen ? maxLen / d : d < minLen ? minLen / d : 1;
    if (s !== 1) this.moveTo(anchor.x + this.tmp.x * s, anchor.y + this.tmp.y * s, anchor.z + this.tmp.z * s);
  }

  /** Move the particle without changing its velocity. */
  private moveTo(x: number, y: number, z: number): void {
    this.prev.x += x - this.pos.x;
    this.prev.y += y - this.pos.y;
    this.prev.z += z - this.pos.z;
    this.pos.set(x, y, z);
  }
}
