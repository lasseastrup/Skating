import { Matrix4, Quaternion, Vector3 } from 'three';
import type { InputFrame } from '../core/Input';
import { KinematicBody, type SimWorld } from '../core/Sim';
import type { ProjectResult } from './Surface';
import type { Compound } from './surfaces/Compound';
import { TUNING as T } from './Tuning';

/** Skater XL's state list, trimmed to what the current phase can express. */
export enum SkateState {
  Riding = 'Riding',
  Pushing = 'Pushing',
  Air = 'Air',
}

const MAX_CAND = 24;

/**
 * The kinematic character controller. Not a rigid body. Position, signed speed and a surface
 * frame (normal, tangent, binormal) constrained to one analytic ride surface of a Compound at
 * ride height, or ballistic when nothing claims it.
 *
 * The board is the authority: `board` is the transform the surface controller computes.
 * The skater (`pelvis`) is solved onto it every step.
 *
 * Energy rules:
 *  - gravity is split: the tangential part accelerates, the normal part is absorbed
 *  - rolling friction is a small exponential decay; carving costs ∝ yawRate²
 *  - there is no lateral velocity: speed is preserved and re-aimed along the heading
 *  - pumping injects pumpEff·κ·v² in transitions, ×0.7 automatically, ×1.0 when timed
 *  - you leave the surface when κ·v² + g·n.y < 0 (the normal force would have to pull)
 */
export class SkateWorld implements SimWorld {
  readonly board = new KinematicBody();
  readonly pelvis = new KinematicBody();
  readonly bodies: readonly KinematicBody[] = [this.board, this.pelvis];

  // --- controller state ------------------------------------------------------------------------
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly tangent = new Vector3(0, 0, -1);
  readonly normal = new Vector3(0, 1, 0);
  readonly binormal = new Vector3(1, 0, 0);
  /** Signed speed along the tangent. Negative = rolling fakie. */
  speed = 0;
  yawRate = 0;
  state = SkateState.Riding;
  /** Index of the surface we ride, -1 in the air. */
  current = -1;
  /** Normal curvature along the tangent at the contact point. */
  curvature = 0;
  /** Normal force proxy κv² + g·n.y (m/s²). Negative would mean detached. */
  normalForce = 0;
  airTime = 0;
  simTime = 0;

  pushPhase = 0;
  private pushCooldown = 0;
  charge = 0;
  lean = 0;
  weight = 0;
  pelvisH: number = T.pelvisStand;
  private pelvisV = 0;
  distance = 0;

  /** Pumping. */
  inTransition = false;
  pumpFactor = 0;
  private lastPress = -10;
  private transitionEntry = -10;
  private prevButton = 0;
  /** Count of completed transition passes, for tests. */
  transitions = 0;
  landings = 0;

  private readonly spawn = { x: 0, z: 0, heading: 0 };
  /** Height the spawn search starts from; surfaces within 2 m below are candidates. */
  private spawnY: number = T.rideHeight;

  // Private scratch. Allocated once; the step never allocates.
  private readonly cand = new Int32Array(MAX_CAND);
  private readonly probe = new Vector3();
  private readonly pNose = new Vector3();
  private readonly pTail = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly axis = new Vector3();
  private readonly mat = new Matrix4();
  private readonly q = new Quaternion();

  constructor(
    readonly compound: Compound,
    spawn?: { x: number; z: number; heading: number },
  ) {
    if (spawn) Object.assign(this.spawn, spawn);
    this.reset();
  }

  reset(): void {
    const h = this.spawn.heading;
    this.tangent.set(-Math.sin(h), 0, -Math.cos(h));
    this.normal.set(0, 1, 0);
    this.binormal.crossVectors(this.tangent, this.normal).normalize();
    this.pos.set(this.spawn.x, this.spawnY, this.spawn.z);
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.yawRate = 0;
    this.state = SkateState.Riding;
    this.curvature = 0;
    this.normalForce = T.gravity;
    this.airTime = 0;
    this.simTime = 0;
    this.pushPhase = 0;
    this.pushCooldown = 0;
    this.charge = 0;
    this.lean = 0;
    this.weight = 0;
    this.pelvisH = T.pelvisStand;
    this.pelvisV = 0;
    this.distance = 0;
    this.inTransition = false;
    this.pumpFactor = 0;
    this.lastPress = -10;
    this.transitionEntry = -10;
    this.prevButton = 0;
    this.transitions = 0;
    this.landings = 0;

    // Find the surface under the spawn point.
    this.current = -1;
    this.probe.copy(this.pos);
    const n = this.compound.query(this.probe, this.cand);
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const r = this.compound.project(this.cand[i], this.probe, i);
      if (r.margin >= 0 && r.h > -0.3 && r.h < 0.6 && Math.abs(r.h) < best) {
        best = Math.abs(r.h);
        this.current = r.surface;
        this.pos.copy(r.point).addScaledVector(r.normal, T.rideHeight);
        this.normal.copy(r.normal);
      }
    }
    if (this.current < 0) this.state = SkateState.Air;
    this.writeBodies();
    this.board.teleport();
    this.pelvis.teleport();
  }

  /** Debug only: set speed directly. */
  debugSetSpeed(v: number): void {
    this.speed = v;
    this.vel.copy(this.tangent).multiplyScalar(v);
  }

  /** Debug/test: respawn grounded at a new point (surface found under it). */
  debugSpawnAt(x: number, z: number, heading: number, y = T.rideHeight): void {
    Object.assign(this.spawn, { x, z, heading });
    this.spawnY = y;
    this.reset();
  }

  /** Debug/test: teleport to a point above the park and drop. */
  debugPlace(x: number, y: number, z: number, heading: number): void {
    this.reset();
    this.pos.set(x, y, z);
    this.tangent.set(-Math.sin(heading), 0, -Math.cos(heading));
    this.normal.set(0, 1, 0);
    this.binormal.crossVectors(this.tangent, this.normal).normalize();
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.current = -1;
    this.state = SkateState.Air;
    this.writeBodies();
    this.board.teleport();
    this.pelvis.teleport();
  }

  get surfaceId(): string {
    return this.current >= 0 ? this.compound.surfaces[this.current].id : 'air';
  }

  step(input: InputFrame, dt: number): void {
    this.board.beginStep();
    this.pelvis.beginStep();
    this.simTime += dt;
    if (input.button && !this.prevButton) this.lastPress = this.simTime;
    this.prevButton = input.button;

    if (this.state === SkateState.Air) {
      this.stepAir(dt);
    } else {
      this.stepSteering(input, dt);
      this.stepEnergy(input, dt);
      this.stepPush(input, dt);
      this.pos.addScaledVector(this.tangent, this.speed * dt);
      this.distance += Math.abs(this.speed) * dt;
      if (this.constrain(dt)) this.checkDetach();
    }
    this.stepBody(input, dt);
    this.writeBodies();
  }

  // --- steering: heading follows the stick, velocity follows heading ---------------------------
  private stepSteering(input: InputFrame, dt: number): void {
    const sp = Math.abs(this.speed);
    const authority = T.turnMinAuthority + (1 - T.turnMinAuthority) * Math.min(1, sp / T.turnAuthoritySpeed);
    const rate = (T.turnRateBase / (1 + sp / T.turnSpeedRef)) * authority;
    this.yawRate = -input.stickX * rate;
    if (this.yawRate !== 0) {
      this.q.setFromAxisAngle(this.normal, this.yawRate * dt);
      this.tangent.applyQuaternion(this.q).normalize();
      this.binormal.crossVectors(this.tangent, this.normal).normalize();
      this.speed *= Math.max(0, 1 - T.carveDrag * this.yawRate * this.yawRate * dt);
    }
  }

  // --- energy: gravity, weight shift, friction, pump ------------------------------------------
  private stepEnergy(input: InputFrame, dt: number): void {
    // Gravity split: only the tangential component acts. This is what makes dropping in work.
    this.speed += -T.gravity * this.tangent.y * dt;
    this.speed += input.stickY * T.weightShiftAccel * dt;
    this.speed -= this.speed * T.rollFriction * dt;
    if (this.normal.y > 0.99 && Math.abs(this.speed) < T.restSpeed) this.speed = 0;

    // Pumping. A pass begins when curvature rises above the threshold; a button press within
    // the window around that moment earns the full factor, otherwise the auto factor.
    const k = this.curvature;
    const inTrans = k > T.pumpCurvatureMin;
    if (inTrans && !this.inTransition) {
      this.transitionEntry = this.simTime;
      this.pumpFactor = this.simTime - this.lastPress <= T.pumpWindow ? T.pumpTimedFactor : T.pumpAutoFactor;
    } else if (
      inTrans &&
      this.pumpFactor < T.pumpTimedFactor &&
      this.lastPress > this.transitionEntry &&
      this.lastPress - this.transitionEntry <= T.pumpWindow
    ) {
      this.pumpFactor = T.pumpTimedFactor;
    }
    if (!inTrans && this.inTransition) this.transitions++;
    this.inTransition = inTrans;
    if (inTrans) {
      // Energy injected per second ∝ κ·v (the document's rule), so acceleration ∝ κ alone: every
      // pass through a transition adds a fixed amount of energy regardless of speed. Rolling
      // friction (∝ v) then gives a stable equilibrium instead of a runaway. Faded out near rest
      // so a stalled skater high on the wall isn't shoved.
      const sp = Math.abs(this.speed);
      const ramp = sp >= T.pumpMinSpeed ? 1 : sp / T.pumpMinSpeed;
      const a = T.pumpEff * Math.min(k, T.pumpCurvatureCap) * this.pumpFactor * ramp;
      this.speed += (this.speed >= 0 ? 1 : -1) * a * dt;
    }
  }

  // --- push: automatic when slow on the flat ----------------------------------------------------
  private stepPush(input: InputFrame, dt: number): void {
    if (this.pushCooldown > 0) this.pushCooldown -= dt;
    if (this.state === SkateState.Pushing) {
      this.pushPhase += dt / T.pushDuration;
      if (this.pushPhase >= T.pushContactStart && this.pushPhase < T.pushContactEnd) this.speed += T.pushAccel * dt;
      if (this.pushPhase >= 1) {
        this.pushPhase = 0;
        this.state = SkateState.Riding;
        this.pushCooldown = T.pushCooldown;
      }
      return;
    }
    const wantsPush =
      this.speed < T.pushThreshold &&
      this.speed > -0.3 &&
      this.pushCooldown <= 0 &&
      this.charge < 0.05 &&
      input.stickY > T.pushSuppressStickY &&
      this.normal.y > 0.97 &&
      this.curvature < T.pushMaxCurvature;
    if (wantsPush) {
      this.state = SkateState.Pushing;
      this.pushPhase = 0;
      this.pelvisV += T.pelvisPushDip;
    }
  }

  // --- constrain to the manifold ----------------------------------------------------------------
  /**
   * Project the centre onto the current surface and its declared neighbours; pick who claims
   * us; clamp the frame's rotation; offset by ride height along the normal; read pitch from
   * nose/tail probes. Project first, then offset. Never the reverse.
   */
  private constrain(dt: number): boolean {
    const c = this.compound;
    const nb = c.neighbours[this.current];
    const cur = c.project(this.current, this.pos, 0);
    let chosen: ProjectResult | null = null;

    if (cur.margin >= -T.boundsSlack) {
      chosen = cur;
      // Overlap case: a neighbour we have sunk into by the hysteresis depth takes over.
      for (let i = 0; i < nb.length; i++) {
        const r = c.project(nb[i], this.pos, i + 1);
        if (r.margin >= -T.boundsSlack && r.h < chosen.h - T.handoffPenetration && r.h > -T.landMaxPenetration) chosen = r;
      }
    } else {
      // Past our edge: hand off to the neighbour that claims us most confidently.
      let bestMargin = -Infinity;
      for (let i = 0; i < nb.length; i++) {
        const r = c.project(nb[i], this.pos, i + 1);
        if (r.margin >= -T.boundsSlack && r.margin > bestMargin && Math.abs(r.h) < T.landMaxPenetration) {
          bestMargin = r.margin;
          chosen = r;
        }
      }
    }

    if (!chosen) {
      this.toAir();
      return false;
    }
    this.current = chosen.surface;

    // Rotate the frame normal toward the surface normal, at most frameMaxRate·dt.
    this.rotateNormalToward(chosen.normal, T.frameMaxRate * dt);
    this.pos.copy(chosen.point).addScaledVector(this.normal, T.rideHeight);

    // Pitch from nose/tail probes, each projected onto whichever candidate claims it best.
    this.probePoint(T.probeReach, this.pNose);
    this.probePoint(-T.probeReach, this.pTail);
    this.tmp.subVectors(this.pNose, this.pTail);
    this.tmp.addScaledVector(this.normal, -this.tmp.dot(this.normal));
    if (this.tmp.lengthSq() > 1e-8) this.tangent.copy(this.tmp).normalize();
    else {
      this.tangent.addScaledVector(this.normal, -this.tangent.dot(this.normal)).normalize();
    }
    this.binormal.crossVectors(this.tangent, this.normal).normalize();

    this.curvature = c.surfaces[this.current].curvature(chosen.u, chosen.v, this.tangent);
    this.vel.copy(this.tangent).multiplyScalar(this.speed);
    return true;
  }

  /** Probe point along the tangent, projected onto the best-claiming surface among current + neighbours. */
  private probePoint(along: number, out: Vector3): void {
    const c = this.compound;
    this.probe.copy(this.pos).addScaledVector(this.tangent, along);
    const nb = c.neighbours[this.current];
    const best = c.project(this.current, this.probe, MAX_CAND - 1);
    let bestMargin = best.margin;
    out.copy(best.point);
    for (let i = 0; i < nb.length; i++) {
      const r = c.project(nb[i], this.probe, MAX_CAND - 2);
      if (r.margin > bestMargin && r.margin >= -T.boundsSlack && Math.abs(r.h) < 0.5) {
        bestMargin = r.margin;
        out.copy(r.point);
      }
    }
  }

  private rotateNormalToward(target: Vector3, maxAngle: number): void {
    const d = Math.min(1, Math.max(-1, this.normal.dot(target)));
    const angle = Math.acos(d);
    if (angle < 1e-6) return;
    this.axis.crossVectors(this.normal, target);
    if (this.axis.lengthSq() < 1e-12) {
      // Antiparallel: pick any perpendicular axis.
      this.axis.crossVectors(this.normal, this.tangent);
    }
    this.axis.normalize();
    const a = Math.min(angle, maxAngle);
    this.q.setFromAxisAngle(this.axis, a);
    this.normal.applyQuaternion(this.q).normalize();
    this.tangent.applyQuaternion(this.q);
  }

  /** Detach when the surface would have to pull on us to keep us on it. */
  private checkDetach(): void {
    this.normalForce = this.curvature * this.speed * this.speed + T.gravity * this.normal.y;
    if (this.normalForce < -T.detachSlack) this.toAir();
  }

  private toAir(): void {
    this.state = SkateState.Air;
    this.current = -1;
    this.vel.copy(this.tangent).multiplyScalar(this.speed);
    this.airTime = 0;
    this.pushPhase = 0;
    this.inTransition = false;
    this.curvature = 0;
    this.normalForce = 0;
  }

  // --- air: ballistic, then land on whatever we hit --------------------------------------------
  private stepAir(dt: number): void {
    this.vel.y -= T.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.airTime += dt;
    if (this.pos.y < -30) {
      this.reset();
      return;
    }
    if (this.airTime < 0.02) return;

    const c = this.compound;
    const n = c.query(this.pos, this.cand);
    let best: ProjectResult | null = null;
    for (let i = 0; i < n; i++) {
      const r = c.project(this.cand[i], this.pos, i);
      if (r.margin < -T.boundsSlack) continue;
      if (r.h > T.landMaxHeight || r.h < -T.landMaxPenetration) continue;
      if (r.normal.y < T.landMinNormalY) continue;
      // Land if we are moving into the surface, or have already crossed it (a grazing approach
      // can have velocity pointing away from a concave surface while still passing through it).
      if (r.h >= 0 && this.vel.dot(r.normal) >= 0) continue;
      if (!best || r.h > best.h) best = r;
    }
    if (best) this.land(best);
  }

  private land(r: ProjectResult): void {
    this.current = r.surface;
    this.landings++;
    const n = r.normal;
    const vn = this.vel.dot(n);
    // Tangential velocity survives; the normal part is absorbed (Phase 3 refines this).
    this.tmp.copy(this.vel).addScaledVector(n, -vn);
    const vt = this.tmp.length();
    // Old heading projected onto the new plane decides regular vs fakie.
    this.tmp2.copy(this.tangent).addScaledVector(n, -this.tangent.dot(n));
    if (this.tmp2.lengthSq() < 1e-6) this.tmp2.copy(this.tmp);
    this.tmp2.normalize();
    if (vt > 0.3) {
      this.tmp.divideScalar(vt);
      if (this.tmp.dot(this.tmp2) >= 0) {
        this.tangent.copy(this.tmp);
        this.speed = vt;
      } else {
        this.tangent.copy(this.tmp).negate();
        this.speed = -vt;
      }
    } else {
      this.tangent.copy(this.tmp2);
      this.speed = 0;
    }
    this.normal.copy(n);
    this.binormal.crossVectors(this.tangent, this.normal).normalize();
    this.pos.copy(r.point).addScaledVector(n, T.rideHeight);
    this.vel.copy(this.tangent).multiplyScalar(this.speed);
    this.curvature = this.compound.surfaces[this.current].curvature(r.u, r.v, this.tangent);
    this.state = SkateState.Riding;
    this.airTime = 0;
    this.pelvisV += vn * T.landPelvisKick;
  }

  // --- body on the board: charge, lean, weight, pelvis spring -----------------------------------
  private stepBody(input: InputFrame, dt: number): void {
    if (input.button) this.charge = Math.min(1, this.charge + dt / T.chargeUpTime);
    else this.charge = Math.max(0, this.charge - dt / T.chargeDownTime);

    const centripetal = this.speed * this.yawRate;
    let leanTarget = Math.atan2(centripetal, 9.81);
    if (leanTarget > T.leanMax) leanTarget = T.leanMax;
    else if (leanTarget < -T.leanMax) leanTarget = -T.leanMax;
    if (this.state === SkateState.Air) leanTarget = 0;
    this.lean += (leanTarget - this.lean) * Math.min(1, T.leanRate * dt);

    this.weight += (input.stickY - this.weight) * Math.min(1, 12 * dt);

    // Pelvis spring: crouch, speed, and centripetal load through transitions.
    const load = this.state === SkateState.Air ? 0 : Math.min(0.3, Math.max(0, this.curvature * this.speed * this.speed * T.pelvisCurvatureCrouch));
    const target = T.pelvisStand - this.charge * T.pelvisCrouch - Math.abs(this.speed) * T.pelvisSpeedCrouch - load;
    const w = T.pelvisOmega;
    const accel = w * w * (target - this.pelvisH) - 2 * T.pelvisZeta * w * this.pelvisV;
    this.pelvisV += accel * dt;
    this.pelvisH += this.pelvisV * dt;
    if (this.pelvisH < 0.2) {
      this.pelvisH = 0.2;
      if (this.pelvisV < 0) this.pelvisV = 0;
    }
  }

  private writeBodies(): void {
    const b = this.board.curr;
    b.pos.copy(this.pos);
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
    this.q.setFromAxisAngle(this.tangent, this.lean);
    p.rot.copy(this.q).multiply(b.rot);
  }

  debugReport(kv: (key: string, value: string | number) => void): void {
    kv('state', this.state);
    kv('surface', this.surfaceId);
    kv('speed', `${this.speed.toFixed(2)} u/s`);
    kv('curv', `${this.curvature.toFixed(3)} /m`);
    kv('N', `${this.normalForce.toFixed(1)} m/s²`);
    kv('pump', this.inTransition ? `${this.pumpFactor.toFixed(1)} (${this.transitions})` : `— (${this.transitions})`);
    kv('air', `${this.airTime.toFixed(2)} s  landings ${this.landings}`);
    kv('yawRate', `${this.yawRate.toFixed(2)} rad/s`);
    kv('normal', `${this.normal.x.toFixed(2)} ${this.normal.y.toFixed(2)} ${this.normal.z.toFixed(2)}`);
    kv('tangent', `${this.tangent.x.toFixed(2)} ${this.tangent.y.toFixed(2)} ${this.tangent.z.toFixed(2)}`);
    kv('charge', this.charge.toFixed(2));
    kv('push', this.pushPhase.toFixed(2));
    kv('lean', `${((this.lean * 180) / Math.PI).toFixed(1)}°`);
    kv('pelvis', this.pelvisH.toFixed(2));
    kv('odometer', `${this.distance.toFixed(0)} m`);
  }
}
