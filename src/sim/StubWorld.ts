import type { InputFrame } from '../core/Input';
import { UP, v0 } from '../core/Pool';
import { KinematicBody, type SimWorld } from '../core/Sim';

/**
 * PHASE 0 PLACEHOLDER. Not skating. A box that drives around a plane so the loop,
 * interpolation, overlay and determinism harness have something to move.
 * Phase 1 replaces this with the real surface-riding character controller.
 *
 * Kept deliberately dumb: heading from stick X, speed from stick Y, a bob on the button.
 */
export class StubWorld implements SimWorld {
  readonly box = new KinematicBody();
  readonly bodies: readonly KinematicBody[] = [this.box];

  private _heading = 0;
  /** Yaw about +Y, radians. Read by the camera rig. */
  get heading(): number {
    return this._heading;
  }
  private speed = 0;
  private bob = 0;

  /** Half-extent of the drivable area. Box is clamped inside. */
  bounds = 40;

  constructor(private readonly spawn = { x: 0, z: 0, heading: 0 }) {
    this.reset();
  }

  reset(): void {
    this._heading = this.spawn.heading;
    this.speed = 0;
    this.bob = 0;
    this.box.curr.pos.set(this.spawn.x, 0.5, this.spawn.z);
    this.box.curr.rot.setFromAxisAngle(UP, this._heading);
    this.box.teleport();
  }

  step(input: InputFrame, dt: number): void {
    const b = this.box;
    b.beginStep();

    const TURN_RATE = 2.4; // rad/s at full stick
    const MAX_SPEED = 8; // units/s
    const ACCEL = 12;

    this._heading -= input.stickX * TURN_RATE * dt;
    const targetSpeed = input.stickY * MAX_SPEED;
    const dv = targetSpeed - this.speed;
    const maxDv = ACCEL * dt;
    this.speed += dv > maxDv ? maxDv : dv < -maxDv ? -maxDv : dv;

    // Forward is -Z at heading 0, rotated about +Y.
    v0.set(-Math.sin(this._heading), 0, -Math.cos(this._heading));
    b.curr.pos.addScaledVector(v0, this.speed * dt);

    const lim = this.bounds;
    if (b.curr.pos.x > lim) b.curr.pos.x = lim;
    else if (b.curr.pos.x < -lim) b.curr.pos.x = -lim;
    if (b.curr.pos.z > lim) b.curr.pos.z = lim;
    else if (b.curr.pos.z < -lim) b.curr.pos.z = -lim;

    // Button squashes the box down a little; release lets it spring back.
    const bobTarget = input.button ? -0.2 : 0;
    this.bob += (bobTarget - this.bob) * Math.min(1, 18 * dt);
    b.curr.pos.y = 0.5 + this.bob;

    b.curr.rot.setFromAxisAngle(UP, this._heading);
  }

  debugReport(kv: (key: string, value: string | number) => void): void {
    kv('speed', this.speed.toFixed(2));
    kv('heading', ((this._heading * 180) / Math.PI).toFixed(1) + '°');
    kv('pos', `${this.box.curr.pos.x.toFixed(2)}, ${this.box.curr.pos.z.toFixed(2)}`);
  }
}
