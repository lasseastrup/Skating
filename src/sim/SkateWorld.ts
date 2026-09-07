import { Matrix4, Quaternion, Vector3 } from 'three';
import type { InputFrame } from '../core/Input';
import { KinematicBody, type SimWorld } from '../core/Sim';
import { PlaneSurface, type RideSurface } from './Surface';
import { TUNING as T } from './Tuning';

/** Skater XL's state list, trimmed to what Phase 1 can express. Grows per phase. */
export enum SkateState {
  Riding = 'Riding',
  Pushing = 'Pushing',
}

/**
 * The kinematic character controller. Not a rigid body. Position, velocity and a surface frame
 * (normal, tangent, binormal) constrained to an analytic ride surface at ride height.
 *
 * The board is the authority: `board` is the transform the surface controller computes.
 * The skater (`pelvis`) is solved onto it every step. The placeholder renderer solves legs onto
 * board-space foot goals at render time.
 *
 * Energy rules on flat ground (Phase 1):
 *  - rolling friction is a small exponential decay
 *  - lateral velocity never exists: speed is preserved and re-aimed along the heading (carving)
 *  - tight carves scrub speed proportional to yaw rate (carveDrag)
 *  - pushing adds speed in a fixed window of an automatic cycle
 */
export class SkateWorld implements SimWorld {
  readonly board = new KinematicBody();
  readonly pelvis = new KinematicBody();
  readonly bodies: readonly KinematicBody[] = [this.board, this.pelvis];

  surface: RideSurface = new PlaneSurface(0);

  // --- controller state ------------------------------------------------------------------------
  /** Board centre, world space, already at ride height. */
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  /** Surface frame. tangent = forward along the deck, normal = up off the surface, binormal = right. */
  readonly tangent = new Vector3(0, 0, -1);
  readonly normal = new Vector3(0, 1, 0);
  readonly binormal = new Vector3(1, 0, 0);
  /** Speed along the tangent. Never negative in Phase 1 (switch comes with air). */
  speed = 0;
  yawRate = 0;
  state = SkateState.Riding;
  grounded = true;

  /** Push cycle 0..1 while pushing, else 0. Animation hook. */
  pushPhase = 0;
  private pushCooldown = 0;
  /** Crouch charge 0..1 from holding the button. */
  charge = 0;
  /** Lean into the carve, radians, positive = leaning left (turning left). */
  lean = 0;
  /** Fore/aft weight from stick Y, -1..1, smoothed. */
  weight = 0;

  /** Pelvis height spring above the deck. */
  pelvisH: number = T.pelvisStand;
  private pelvisV = 0;

  /** Total distance rolled, for the overlay's odometer. */
  distance = 0;

  private readonly spawn = { x: 0, z: 0, heading: 0 };

  // Private scratch. Allocated once; the step never allocates.
  private readonly pNose = new Vector3();
  private readonly pTail = new Vector3();
  private readonly pCenter = new Vector3();
  private readonly nNose = new Vector3();
  private readonly nTail = new Vector3();
  private readonly nCenter = new Vector3();
  private readonly nProbe = new Vector3();
  private readonly tmp = new Vector3();
  private readonly mat = new Matrix4();
  private readonly qRoll = new Quaternion();

  constructor(spawn?: { x: number; z: number; heading: number }) {
    if (spawn) Object.assign(this.spawn, spawn);
    this.reset();
  }

  reset(): void {
    const h = this.spawn.heading;
    this.tangent.set(-Math.sin(h), 0, -Math.cos(h));
    this.normal.set(0, 1, 0);
    this.binormal.crossVectors(this.tangent, this.normal).normalize();
    this.pos.set(this.spawn.x, T.rideHeight, this.spawn.z);
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.yawRate = 0;
    this.state = SkateState.Riding;
    this.grounded = true;
    this.pushPhase = 0;
    this.pushCooldown = 0;
    this.charge = 0;
    this.lean = 0;
    this.weight = 0;
    this.pelvisH = T.pelvisStand;
    this.pelvisV = 0;
    this.distance = 0;
    this.writeBodies();
    this.board.teleport();
    this.pelvis.teleport();
  }

  /** Debug only: set speed directly to test the high end without a hill. */
  debugSetSpeed(v: number): void {
    this.speed = v;
    this.vel.copy(this.tangent).multiplyScalar(v);
  }

  step(input: InputFrame, dt: number): void {
    this.board.beginStep();
    this.pelvis.beginStep();

    this.stepSteering(input, dt);
    this.stepEnergy(input, dt);
    this.stepPush(input, dt);
    this.stepMove(dt);
    this.stepProbes(dt);
    this.stepBody(input, dt);
    this.writeBodies();
  }

  // --- steering: heading follows the stick, velocity follows heading ---------------------------
  private stepSteering(input: InputFrame, dt: number): void {
    const authority =
      T.turnMinAuthority + (1 - T.turnMinAuthority) * Math.min(1, this.speed / T.turnAuthoritySpeed);
    const rate = (T.turnRateBase / (1 + this.speed / T.turnSpeedRef)) * authority;
    // Stick right = turn right = negative yaw about the up normal.
    this.yawRate = -input.stickX * rate;
    if (this.yawRate !== 0) {
      this.rotateFrameAboutNormal(this.yawRate * dt);
      // Carving costs: the tighter the arc, the more speed goes into the ground.
      this.speed *= Math.max(0, 1 - T.carveDrag * this.yawRate * this.yawRate * dt);
    }
  }

  private rotateFrameAboutNormal(angle: number): void {
    this.qRoll.setFromAxisAngle(this.normal, angle);
    this.tangent.applyQuaternion(this.qRoll).normalize();
    this.binormal.crossVectors(this.tangent, this.normal).normalize();
  }

  // --- energy: friction, weight shift, tangential gravity ---------------------------------------
  private stepEnergy(input: InputFrame, dt: number): void {
    // Gravity split: the component along the tangent accelerates, the normal component is
    // absorbed by the surface. On the flat this is exactly zero; it is here so slopes are free.
    const gTan = -T.gravity * this.tangent.y;
    this.speed += gTan * dt;

    // Weight forward/back: tiny speed effect, big pose effect.
    this.speed += input.stickY * T.weightShiftAccel * dt;

    // Rolling friction as exponential decay, then a hard stop near rest.
    this.speed -= this.speed * T.rollFriction * dt;
    if (this.speed < T.restSpeed && this.speed > -T.restSpeed) this.speed = 0;
    if (this.speed < 0) this.speed = 0; // no switch in Phase 1
  }

  // --- push: automatic when slow --------------------------------------------------------------
  private stepPush(input: InputFrame, dt: number): void {
    if (this.pushCooldown > 0) this.pushCooldown -= dt;

    if (this.state === SkateState.Pushing) {
      this.pushPhase += dt / T.pushDuration;
      if (this.pushPhase >= T.pushContactStart && this.pushPhase < T.pushContactEnd) {
        this.speed += T.pushAccel * dt;
      }
      if (this.pushPhase >= 1) {
        this.pushPhase = 0;
        this.state = SkateState.Riding;
        this.pushCooldown = T.pushCooldown;
      }
      return;
    }

    const wantsPush =
      this.grounded &&
      this.speed < T.pushThreshold &&
      this.pushCooldown <= 0 &&
      this.charge < 0.05 &&
      input.stickY > T.pushSuppressStickY &&
      this.isFlat();
    if (wantsPush) {
      this.state = SkateState.Pushing;
      this.pushPhase = 0;
      this.pelvisV += T.pelvisPushDip;
    }
  }

  private isFlat(): boolean {
    return this.normal.y > 0.97;
  }

  // --- move along the tangent, then constrain to the surface ------------------------------------
  private stepMove(dt: number): void {
    this.vel.copy(this.tangent).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    this.distance += this.speed * dt;
  }

  /**
   * Three probes: nose, centre, tail. Pitch comes from nose vs tail, the normal from the filtered
   * blend of all three. Project first, then offset along the normal by ride height, never the reverse.
   */
  private stepProbes(dt: number): void {
    const s = this.surface;
    this.tmp.copy(this.pos).addScaledVector(this.tangent, T.probeReach);
    s.project(this.tmp, this.pNose, this.nNose);
    this.tmp.copy(this.pos).addScaledVector(this.tangent, -T.probeReach);
    s.project(this.tmp, this.pTail, this.nTail);
    s.project(this.pos, this.pCenter, this.nCenter);

    this.nProbe.copy(this.nCenter).multiplyScalar(2).add(this.nNose).add(this.nTail).normalize();

    // Filter the normal over ~80 ms. exp(-dt/tau) is exact for a first-order low-pass at any dt.
    const k = 1 - Math.exp(-dt / T.normalFilterTau);
    this.normal.lerp(this.nProbe, k).normalize();

    // Tangent from the nose-tail chord, re-orthogonalised against the filtered normal.
    this.tmp.subVectors(this.pNose, this.pTail);
    this.tmp.addScaledVector(this.normal, -this.tmp.dot(this.normal));
    if (this.tmp.lengthSq() > 1e-8) this.tangent.copy(this.tmp).normalize();
    this.binormal.crossVectors(this.tangent, this.normal).normalize();

    this.pos.copy(this.pCenter).addScaledVector(this.normal, T.rideHeight);
    this.grounded = true;
  }

  // --- body on the board: charge, lean, weight, pelvis spring -----------------------------------
  private stepBody(input: InputFrame, dt: number): void {
    // Crouch charge. Release is an ollie in Phase 3; here it just drains.
    if (input.button) this.charge = Math.min(1, this.charge + dt / T.chargeUpTime);
    else this.charge = Math.max(0, this.charge - dt / T.chargeDownTime);

    // Lean into the carve: angle whose tangent is centripetal / real gravity. Real g here on
    // purpose: the body should read like a person, even if the board world is 2x.
    const centripetal = this.speed * this.yawRate;
    let leanTarget = Math.atan2(centripetal, 9.81);
    if (leanTarget > T.leanMax) leanTarget = T.leanMax;
    else if (leanTarget < -T.leanMax) leanTarget = -T.leanMax;
    this.lean += (leanTarget - this.lean) * Math.min(1, T.leanRate * dt);

    this.weight += (input.stickY - this.weight) * Math.min(1, 12 * dt);

    // Pelvis height spring. Everything downstream hangs off this scalar.
    const target = T.pelvisStand - this.charge * T.pelvisCrouch - this.speed * T.pelvisSpeedCrouch;
    const w = T.pelvisOmega;
    const accel = w * w * (target - this.pelvisH) - 2 * T.pelvisZeta * w * this.pelvisV;
    this.pelvisV += accel * dt;
    this.pelvisH += this.pelvisV * dt;
    if (this.pelvisH < 0.2) {
      this.pelvisH = 0.2;
      if (this.pelvisV < 0) this.pelvisV = 0;
    }
  }

  /** Board and pelvis transforms from the controller state. */
  private writeBodies(): void {
    const b = this.board.curr;
    b.pos.copy(this.pos);
    // Basis: X = right (binormal), Y = up (normal), Z = back (-tangent).
    this.tmp.copy(this.tangent).negate();
    this.mat.makeBasis(this.binormal, this.normal, this.tmp);
    b.rot.setFromRotationMatrix(this.mat);

    const p = this.pelvis.curr;
    const h = this.pelvisH;
    const side = -Math.sin(this.lean) * h * T.leanShift;
    p.pos
      .copy(this.pos)
      .addScaledVector(this.normal, h * Math.cos(this.lean))
      .addScaledVector(this.binormal, side)
      .addScaledVector(this.tangent, this.weight * T.weightShiftPelvis);
    // Pelvis rolls with the lean about the tangent axis.
    this.qRoll.setFromAxisAngle(this.tangent, this.lean);
    p.rot.copy(this.qRoll).multiply(b.rot);
  }

  debugReport(kv: (key: string, value: string | number) => void): void {
    kv('state', this.state);
    kv('speed', `${this.speed.toFixed(2)} u/s`);
    kv('yawRate', `${this.yawRate.toFixed(2)} rad/s`);
    kv('surface', this.surface.id);
    kv('grounded', this.grounded ? 'yes' : 'no');
    kv('normal', `${this.normal.x.toFixed(2)} ${this.normal.y.toFixed(2)} ${this.normal.z.toFixed(2)}`);
    kv('tangent', `${this.tangent.x.toFixed(2)} ${this.tangent.y.toFixed(2)} ${this.tangent.z.toFixed(2)}`);
    kv('charge', this.charge.toFixed(2));
    kv('push', this.pushPhase.toFixed(2));
    kv('lean', `${((this.lean * 180) / Math.PI).toFixed(1)}°`);
    kv('pelvis', this.pelvisH.toFixed(2));
    kv('odometer', `${this.distance.toFixed(0)} m`);
  }
}
