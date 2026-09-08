import { Matrix4, Quaternion, Vector3 } from 'three';
import type { InputFrame } from '../core/Input';
import { KinematicBody, type SimWorld } from '../core/Sim';
import type { ProjectResult } from './Surface';
import type { GrindPath } from './Grind';
import { crossesWall } from './Walls';
import { classifyGrind, classifyTrick, CONTACTS, OLLIE, pivotForPitch, ROSE, type Contact, type TrickTargets } from './Tricks';
import type { Compound } from './surfaces/Compound';
import { TUNING as T } from './Tuning';

/** Skater XL's state list, trimmed to what the current phase can express. */
export enum SkateState {
  Riding = 'Riding',
  Pushing = 'Pushing',
  Pop = 'Pop',
  Air = 'Air',
  Grinding = 'Grinding',
  Bailed = 'Bailed',
}

/**
 * The animation state machine, Skater XL's list. Derived from the physics state every step:
 * the pop is three states, the landing two, coping enter/exit are first class.
 */
export enum AnimState {
  Riding = 'Riding',
  Pushing = 'Pushing',
  Braking = 'Braking',
  Setup = 'Setup',
  BeginPop = 'BeginPop',
  Pop = 'Pop',
  InAir = 'InAir',
  Release = 'Release',
  Impact = 'Impact',
  Powerslide = 'Powerslide',
  Manual = 'Manual',
  Grinding = 'Grinding',
  EnterCoping = 'EnterCoping',
  ExitCoping = 'ExitCoping',
  Grabs = 'Grabs',
  Bailed = 'Bailed',
}

const D = Math.PI / 180;

const MAX_CAND = 24;

/** Residual of `a` to the nearest multiple of `period`, in [-period/2, period/2]. */
function residual(a: number, period: number): number {
  return a - Math.round(a / period) * period;
}

/**
 * The kinematic character controller. Not a rigid body. Position, signed speed and a surface
 * frame (normal, tangent, binormal) constrained to one analytic ride surface of a Compound at
 * ride height, or ballistic when nothing claims it.
 *
 * The board is the authority: `board` is the transform the surface controller computes, the
 * frame plus board-relative pitch/flip/scoop. The skater (`pelvis`) is solved onto the frame.
 *
 * Energy rules:
 *  - gravity is split: the tangential part accelerates, the normal part is absorbed
 *  - rolling friction is a small exponential decay; carving costs ∝ yawRate²
 *  - there is no lateral velocity: speed is preserved and re-aimed along the heading
 *  - pumping injects pumpEff·κ in transitions, ×0.7 automatically, ×1.0 when timed
 *  - you leave the surface when κ·v² + g·n.y < 0, or when you pop
 *  - landing keeps tangential velocity, snaps heading within 45°, bails past 70°
 */
export class SkateWorld implements SimWorld {
  readonly board = new KinematicBody();
  readonly pelvis = new KinematicBody();
  /** The body frame: board position, frame rotation only (no lean, flip, scoop or pitch). The rig
   *  hangs its stepped pose off this, so the body rides the board smoothly. */
  readonly frame = new KinematicBody();
  readonly bodies: readonly KinematicBody[] = [this.board, this.pelvis, this.frame];

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
  current = -1;
  curvature = 0;
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

  inTransition = false;
  pumpFactor = 0;
  private lastPress = -10;
  private transitionEntry = -10;
  private prevButton = 0;
  transitions = 0;
  landings = 0;
  bails = 0;

  // --- air state -------------------------------------------------------------------------------
  /** Button hold duration, for tap-vs-ollie and charge. */
  holdTime = 0;
  private popTimer = 0;
  private popCharge = 0;
  /** Time left in which a release still pops after leaving a lip without popping. */
  coyote = 0;
  private readonly lastGroundNormal = new Vector3(0, 1, 0);
  trick: TrickTargets = OLLIE;
  /** Derived label: provisional at takeoff, final at landing from what actually rotated. */
  trickName = 'ollie';
  /** Body spin about world up, rad/s, and how much of the trick's spin is still owed. */
  spinRate = 0;
  private spinRemaining = 0;
  private spinDir = 0;
  private trickRate = 0;
  /** Predicted air time at takeoff; the pose library's timeline runs over it. */
  airPredicted = 0.5;
  /** Board-relative angles (rad): pitch about right, flip about long axis, scoop about normal. */
  pitch = 0;
  flip = 0;
  scoop = 0;
  private flipTarget = 0;
  private scoopTarget = 0;
  grabbing = false;
  /** Landing prediction. */
  landingPredicted = false;
  private headingAssisting = false;
  private readonly predNormal = new Vector3();
  predSurface = -1;
  lastMisalignDeg = 0;
  private bailTimer = 0;

  // --- Phase 6: animation state, steeze, catch, manual, bail ramp ------------------------------
  animState = AnimState.Riding;
  /** Style channel per foot, 0..1, from how cleanly the pop was input. Decays after landing. */
  steezeL = 0;
  steezeR = 0;
  /** Per-foot catch: false while a foot is off the flipping board. */
  caughtL = true;
  caughtR = true;
  private catchDelayR = 0;
  /** Accumulated body spin since takeoff, for the classifier. */
  spinTotal = 0;
  /** Manual: -1 nose manual … +1 tail manual (board pitch nose-up). */
  manual = 0;
  private impactTimer = 0;
  /** Bail ramp 0..1: 0 fully posed, 1 fully ragdoll. Smoothstepped both ways. */
  bailRamp = 0;

  // --- grind state -----------------------------------------------------------------------------
  grindPath: GrindPath | null = null;
  /** Board yaw on the edge (stick X × 90°) and pitch (stick Y × 25°), and the carrying contact. */
  grindYaw = 0;
  grindPitch = 0;
  grindContact: Contact = 'center';
  grindName = '50-50';
  private grindT = 0;
  /** +1 when the board's nose points along the path's parameter direction, -1 when against. */
  private grindDir = 1;
  private grindBlend = 1;
  private readonly grindOffset = new Vector3();
  private grindDropTimer = 0;
  private grindStallTimer = 0;
  private lastGrindExit = -10;
  private reattachDelay: number = T.grindReattachDelay;
  grinds = 0;
  grindDistance = 0;
  private readonly gP = new Vector3();
  private readonly gT = new Vector3();
  private readonly gK = new Vector3();
  private readonly gUp = new Vector3();

  private readonly spawn = { x: 0, z: 0, heading: 0 };
  private spawnY: number = T.rideHeight;

  // Private scratch. Allocated once; the step never allocates.
  private readonly cand = new Int32Array(MAX_CAND);
  private readonly wallCand = new Int32Array(32);
  private readonly prevPos = new Vector3();
  mercies = 0;
  slams = 0;
  /** Juice hooks: pops so far, tricks (not plain ollies) landed, and the last landing's absorbed
   *  normal speed (m/s). The display layer diffs the counters; the sim never knows about juice. */
  pops = 0;
  trickLands = 0;
  kickturns = 0;
  /** Kickturn in progress: angle left to pivot (rad) and its direction about the normal. */
  kickturnLeft = 0;
  private kickturnDir = 1;
  private kickturnCooldown = 0;
  lastImpact = 0;
  /** Grind contact point on the edge, world space (valid while grinding). */
  get grindPoint(): Vector3 {
    return this.gP;
  }
  /** Test hook: the "no pushing" loop acceptance. */
  debugNoPush = false;
  pushes = 0;
  private readonly probe = new Vector3();
  private readonly pNose = new Vector3();
  private readonly pTail = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly axis = new Vector3();
  private readonly mat = new Matrix4();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly q3 = new Quaternion();

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
    this.bails = 0;
    this.holdTime = 0;
    this.popTimer = 0;
    this.popCharge = 0;
    this.coyote = 0;
    this.lastGroundNormal.set(0, 1, 0);
    this.trick = OLLIE;
    this.spinRate = 0;
    this.spinRemaining = 0;
    this.spinDir = 0;
    this.trickRate = 0;
    this.pitch = 0;
    this.flip = 0;
    this.scoop = 0;
    this.flipTarget = 0;
    this.scoopTarget = 0;
    this.grabbing = false;
    this.landingPredicted = false;
    this.predSurface = -1;
    this.lastMisalignDeg = 0;
    this.bailTimer = 0;
    this.animState = AnimState.Riding;
    this.trickName = 'ollie';
    this.steezeL = 0;
    this.steezeR = 0;
    this.caughtL = true;
    this.caughtR = true;
    this.catchDelayR = 0;
    this.spinTotal = 0;
    this.manual = 0;
    this.impactTimer = 0;
    this.bailRamp = 0;
    this.grindYaw = 0;
    this.grindPitch = 0;
    this.grindContact = 'center';
    this.grindName = '50-50';
    this.mercies = 0;
    this.slams = 0;
    this.pops = 0;
    this.trickLands = 0;
    this.kickturns = 0;
    this.kickturnLeft = 0;
    this.kickturnCooldown = 0;
    this.lastImpact = 0;
    this.pushes = 0;
    this.grindPath = null;
    this.grindT = 0;
    this.grindDir = 1;
    this.grindBlend = 1;
    this.grindOffset.set(0, 0, 0);
    this.grindDropTimer = 0;
    this.grindStallTimer = 0;
    this.lastGrindExit = -10;
    this.reattachDelay = T.grindReattachDelay;
    this.grinds = 0;
    this.grindDistance = 0;

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
    this.frame.teleport();
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
    this.frame.teleport();
  }

  get surfaceId(): string {
    return this.current >= 0 ? this.compound.surfaces[this.current].id : 'air';
  }

  get grounded(): boolean {
    return this.state === SkateState.Riding || this.state === SkateState.Pushing;
  }

  step(input: InputFrame, dt: number): void {
    this.board.beginStep();
    this.pelvis.beginStep();
    this.frame.beginStep();
    this.simTime += dt;

    // Button edges. Press timing feeds the pump; release length decides tap vs ollie.
    const pressed = input.button && !this.prevButton;
    const released = !input.button && this.prevButton;
    this.prevButton = input.button;
    if (pressed) {
      this.lastPress = this.simTime;
      this.holdTime = 0;
      if (this.state === SkateState.Air) this.grabbing = true;
    }
    if (input.button) this.holdTime += dt;
    if (released) {
      this.grabbing = false;
      if (this.holdTime >= T.tapHold) {
        if (this.grounded || this.state === SkateState.Grinding) this.startPop(input);
        else if (this.state === SkateState.Air && this.coyote > 0) this.coyotePop(input);
      }
    }

    switch (this.state) {
      case SkateState.Riding:
      case SkateState.Pushing:
        this.stepSteering(input, dt);
        this.stepEnergy(input, dt);
        this.stepManual(input, dt);
        this.stepPush(input, dt);
        this.prevPos.copy(this.pos);
        this.pos.addScaledVector(this.tangent, this.speed * dt);
        this.distance += Math.abs(this.speed) * dt;
        if (this.checkWalls(dt)) break;
        if (this.constrain(dt)) this.checkDetach();
        break;
      case SkateState.Pop:
        this.stepPop(dt);
        break;
      case SkateState.Air:
        this.stepAir(input, dt);
        break;
      case SkateState.Grinding:
        this.stepGrind(input, dt);
        break;
      case SkateState.Bailed:
        this.stepBail(dt);
        break;
    }
    if (this.impactTimer > 0) this.impactTimer -= dt;
    if (this.grounded || this.state === SkateState.Grinding) {
      this.steezeL = Math.max(0, this.steezeL - dt / 1.2);
      this.steezeR = Math.max(0, this.steezeR - dt / 1.2);
    }
    // Bail ramp: smoothstepped toward 1 while down, back toward 0 on recovery.
    const rampTarget = this.state === SkateState.Bailed ? 1 : 0;
    const rampRate = rampTarget > this.bailRamp ? 1 / T.bailRampIn : 1 / T.bailRampOut;
    this.bailRamp = approach(this.bailRamp, rampTarget, rampRate * dt);

    this.stepBody(input, dt);
    this.deriveAnimState(input);
    this.writeBodies();
  }

  /** Skater XL's state list, derived from the physics state and its timers. */
  private deriveAnimState(input: InputFrame): void {
    let a: AnimState;
    switch (this.state) {
      case SkateState.Pushing:
        a = AnimState.Pushing;
        break;
      case SkateState.Riding:
        if (Math.abs(this.manual) > 0.3) a = AnimState.Manual;
        else if (this.impactTimer > 0) a = AnimState.Impact;
        else if (input.button && this.holdTime >= T.tapHold) a = AnimState.Setup;
        else a = AnimState.Riding;
        break;
      case SkateState.Pop:
        a = AnimState.BeginPop;
        break;
      case SkateState.Air:
        if (this.airTime < T.popAnimTime) a = AnimState.Pop;
        else if (this.grabbing) a = AnimState.Grabs;
        else if (this.landingPredicted) a = AnimState.Release;
        else if (this.simTime - this.lastGrindExit < 0.2) a = AnimState.ExitCoping;
        else a = AnimState.InAir;
        break;
      case SkateState.Grinding:
        a = this.grindBlend < 1 ? AnimState.EnterCoping : AnimState.Grinding;
        break;
      default:
        a = AnimState.Bailed;
    }
    this.animState = a;
  }

  // --- manual: weight hard forward or back at speed lifts a truck. Never fails. ----------------
  private stepManual(input: InputFrame, dt: number): void {
    const wants = Math.abs(input.stickY) > T.manualStick && Math.abs(this.speed) > T.manualMinSpeed && this.charge < 0.05 && this.state === SkateState.Riding;
    const target = wants ? -Math.sign(input.stickY) : 0; // stick back = tail manual = nose up
    this.manual += (target - this.manual) * Math.min(1, T.manualRate * dt);
    if (Math.abs(this.manual) < 0.01) this.manual = 0;
    this.pitch = this.manual * T.manualPitch;
    if (Math.abs(this.manual) > 0.5) this.speed -= this.speed * T.manualDrag * dt;
  }

  // --- steering: heading follows the stick, velocity follows heading ---------------------------
  private stepSteering(input: InputFrame, dt: number): void {
    if (this.kickturnLeft > 0) {
      const d = Math.min(T.kickturnRate * dt, this.kickturnLeft);
      this.kickturnLeft -= d;
      this.yawRate = this.kickturnDir * T.kickturnRate;
      this.q.setFromAxisAngle(this.normal, d * this.kickturnDir);
      this.tangent.applyQuaternion(this.q).normalize();
      this.binormal.crossVectors(this.tangent, this.normal).normalize();
      if (this.kickturnLeft <= 0) {
        this.speed = T.kickturnExitSpeed;
        this.kickturnCooldown = 0.5;
      }
      return;
    }
    const sp = Math.abs(this.speed);
    const authority = T.turnMinAuthority + (1 - T.turnMinAuthority) * Math.min(1, sp / T.turnAuthoritySpeed);
    // Steepness 0 on the flat → 1 on a vertical wall. Transitions are where you turn the most in
    // real skating (a carve around a bowl is a 180° in under a second), so authority grows here.
    const steep = Math.min(1, Math.max(0, (0.75 - this.normal.y) / 0.5));
    const rate = (T.turnRateBase / (1 + sp / T.turnSpeedRef)) * authority * (1 + T.wallTurnBoost * steep);
    this.yawRate = -input.stickX * rate;
    if (this.yawRate !== 0) {
      this.q.setFromAxisAngle(this.normal, this.yawRate * dt);
      this.tangent.applyQuaternion(this.q).normalize();
      this.binormal.crossVectors(this.tangent, this.normal).normalize();
      this.speed *= Math.max(0, 1 - T.carveDrag * this.yawRate * this.yawRate * dt);
    }
    // Carve: a held stick on a wall lets gravity swing the path downhill as well.
    this.gravityTurn(dt, Math.abs(input.stickX) * steep * T.carveGravity);
    if (steep > 0.4 && Math.abs(input.stickX) < 0.1) this.vertAlign(dt, steep);
  }

  /**
   * Tony Hawk's rule: going up a wall fast enough to air with a neutral stick, the heading is
   * eased toward straight up the wall, so the air comes back down onto the ramp. A held stick
   * overrides it (that's a carve), and slow riders are left alone (that's a kickturn coming).
   */
  private vertAlign(dt: number, steep: number): void {
    const n = this.normal;
    // Uphill direction in the tangent plane.
    this.tmp.set(-n.x * n.y, 1 - n.y * n.y, -n.z * n.y);
    if (this.tmp.lengthSq() < 1e-6) return;
    this.tmp.normalize();
    const dir = this.speed >= 0 ? 1 : -1;
    // Only while climbing with enough speed to clear the lip (heading up, speed above ~1.5 m of rise).
    if (this.tangent.dot(this.tmp) * dir < 0.3 || this.speed * this.speed < 2 * T.gravity * 1.5) return;
    this.tmp.multiplyScalar(dir);
    const cross = this.tmp.dot(this.binormal); // positive: uphill lies toward +binormal
    const ang = Math.atan2(cross, this.tangent.dot(this.tmp));
    const step = Math.max(-T.vertAlignRate * steep * dt, Math.min(T.vertAlignRate * steep * dt, ang));
    if (Math.abs(step) < 1e-5) return;
    this.q.setFromAxisAngle(this.normal, -step);
    this.tangent.applyQuaternion(this.q).normalize();
    this.binormal.crossVectors(this.tangent, this.normal).normalize();
  }

  /**
   * Gravity turn. The wheels grip sideways only while they are pressed into the surface. When
   * the normal force fades (riding along a near-vertical wall, hanging at a trough's rim) the
   * lateral part of gravity is allowed to swing the velocity downhill, so a skater can never
   * park on a wall. Full strength at zero normal force, nothing above `gravityTurnForce`.
   */
  private gravityTurn(dt: number, extraWeight = 0): void {
    const sp = Math.abs(this.speed);
    if (sp < 0.5) return;
    const w = Math.max(extraWeight, 1 - Math.min(1, Math.max(0, this.normalForce / T.gravityTurnForce)));
    if (w <= 0) return;
    // Downhill in the tangent plane, projected on the binormal: lateral gravity per unit mass.
    const lateral = -T.gravity * this.binormal.y * w;
    if (Math.abs(lateral) < 1e-4) return;
    // v = speed·tangent; v' = v + lateral·b·dt → tangent turns by lateral·dt/speed toward b.
    const turn = Math.max(-T.gravityTurnMaxRate * dt, Math.min(T.gravityTurnMaxRate * dt, (lateral * dt) / this.speed));
    this.tangent.addScaledVector(this.binormal, turn).normalize();
    this.binormal.crossVectors(this.tangent, this.normal).normalize();
  }

  // --- energy: gravity, weight shift, friction, pump ------------------------------------------
  private stepEnergy(input: InputFrame, dt: number): void {
    const before = this.speed;
    this.speed += -T.gravity * this.tangent.y * dt;
    this.speed += input.stickY * T.weightShiftAccel * dt;
    this.speed -= this.speed * T.rollFriction * dt;
    // Kickturn: run out of speed while climbing a steep wall and the board pivots 180° to come
    // back down forwards, the way every skater and every Tony Hawk's game does it, instead of
    // rolling back down the same line fakie.
    if (this.kickturnCooldown > 0) this.kickturnCooldown -= dt;
    if (this.kickturnLeft > 0) {
      // Pivoting on the wall: the board is parked at the apex until the nose points back down.
      this.speed = 0;
    } else if (this.kickturnCooldown <= 0 && this.normal.y < T.kickturnMaxNormalY && before * this.speed <= 0 && before !== 0 && this.tangent.y * Math.sign(before) > 0.2) {
      this.kickturnLeft = Math.PI;
      this.kickturnDir = input.stickX > 0.1 ? -1 : input.stickX < -0.1 ? 1 : this.binormal.y > 0 ? 1 : -1;
      this.speed = 0;
      this.kickturns++;
    }
    if (this.normal.y > 0.99 && Math.abs(this.speed) < T.restSpeed) this.speed = 0;

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
      const sp = Math.abs(this.speed);
      const ramp = sp >= T.pumpMinSpeed ? 1 : sp / T.pumpMinSpeed;
      const a = (T.pumpEff * Math.min(k, T.pumpCurvatureCap) + T.pumpBase) * this.pumpFactor * ramp;
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
      Math.abs(this.manual) < 0.3 &&
      input.stickY > T.pushSuppressStickY &&
      this.normal.y > 0.97 &&
      this.curvature < T.pushMaxCurvature;
    if (wantsPush && !this.debugNoPush) {
      this.state = SkateState.Pushing;
      this.pushPhase = 0;
      this.pushes++;
      this.pelvisV += T.pelvisPushDip;
    }
  }

  // --- walls: collision mercy or a slide along it ---------------------------------------------
  /**
   * Did this step's move cross a wall? Assist Charter: a lip or ledge you would have slammed into
   * head-on auto-pops you over it if you had the speed to clear it. Otherwise the heading is
   * deflected along the wall and you keep rolling, slower. Returns true if the state left the ground.
   */
  private checkWalls(dt: number): boolean {
    const c = this.compound;
    const n = c.queryWalls(this.pos, this.wallCand);
    for (let i = 0; i < n; i++) {
      const w = c.walls[this.wallCand[i]];
      // A feature's own side caps don't stop a rider on its surfaces: you ride off the side.
      if (w.owner && this.current >= 0 && c.surfaces[this.current].id.startsWith(w.owner)) continue;
      const t = crossesWall(this.prevPos, this.pos, w);
      if (t < 0) continue;
      const height = w.yTop - (this.prevPos.y - T.rideHeight);
      if (height <= 0.03) continue;
      const need = T.mercyMinSpeed + T.mercySpeedPerMetre * height;
      if (height <= T.mercyMaxHeight && Math.abs(this.speed) >= need) {
        // Mercy: pop over it. Plain ollie, feet stay on, keep speed.
        this.mercies++;
        this.pos.copy(this.prevPos).addScaledVector(this.tangent, this.speed * dt * Math.max(0, t - 0.05));
        this.trick = OLLIE;
        this.trickName = 'ollie';
        const vPop = Math.sqrt(2 * T.gravity * (height + T.mercyClearance));
        this.toAir(false);
        this.vel.copy(this.tangent).multiplyScalar(this.speed).addScaledVector(this.normal, vPop);
        this.pitch = T.popPitch;
        this.pelvisV += T.pelvisPopKick;
    this.pops++;
        this.armTrick();
        return true;
      }
      // Slam: slide along the wall.
      this.slams++;
      this.tmp.set(w.bx - w.ax, 0, w.bz - w.az).normalize();
      const along = this.tangent.dot(this.tmp);
      this.tmp.multiplyScalar(along >= 0 ? 1 : -1);
      this.pos.copy(this.prevPos);
      this.tangent.copy(this.tmp).addScaledVector(this.normal, -this.tmp.dot(this.normal)).normalize();
      this.binormal.crossVectors(this.tangent, this.normal).normalize();
      this.speed *= T.wallSlideFactor * Math.abs(along);
      this.pelvisV -= 1.5;
      return false;
    }
    return false;
  }

  // --- constrain to the manifold ----------------------------------------------------------------
  private constrain(dt: number): boolean {
    const c = this.compound;
    const nb = c.neighbours[this.current];
    const cur = c.project(this.current, this.pos, 0);
    let chosen: ProjectResult | null = null;

    if (cur.margin >= -T.boundsSlack) {
      chosen = cur;
      for (let i = 0; i < nb.length; i++) {
        const r = c.project(nb[i], this.pos, i + 1);
        if (r.margin >= -T.boundsSlack && r.h < chosen.h - T.handoffPenetration && r.h > -T.landMaxPenetration) chosen = r;
      }
    } else {
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
      this.toAir(true);
      return false;
    }
    this.current = chosen.surface;
    this.rotateNormalToward(chosen.normal, T.frameMaxRate * dt);
    this.pos.copy(chosen.point).addScaledVector(this.normal, T.rideHeight);

    this.probePoint(T.probeReach, this.pNose);
    this.probePoint(-T.probeReach, this.pTail);
    this.tmp.subVectors(this.pNose, this.pTail);
    this.tmp.addScaledVector(this.normal, -this.tmp.dot(this.normal));
    // While pivoting on the spot the probes would drag the heading back (a probe that falls off
    // the surface's edge is clamped to it), so the pivoted tangent is kept and only re-planed.
    if (this.tmp.lengthSq() > 1e-8 && this.kickturnLeft <= 0) this.tangent.copy(this.tmp).normalize();
    else this.tangent.addScaledVector(this.normal, -this.tangent.dot(this.normal)).normalize();
    this.binormal.crossVectors(this.tangent, this.normal).normalize();

    this.curvature = c.surfaces[this.current].curvature(chosen.u, chosen.v, this.tangent);
    this.vel.copy(this.tangent).multiplyScalar(this.speed);
    return true;
  }

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

  /** Rotate the whole frame so that `normal` moves toward `target`, at most `maxAngle`. */
  private rotateNormalToward(target: Vector3, maxAngle: number): void {
    const d = Math.min(1, Math.max(-1, this.normal.dot(target)));
    const angle = Math.acos(d);
    if (angle < 1e-6) return;
    this.axis.crossVectors(this.normal, target);
    if (this.axis.lengthSq() < 1e-12) this.axis.crossVectors(this.normal, this.tangent);
    this.axis.normalize();
    this.q.setFromAxisAngle(this.axis, Math.min(angle, maxAngle));
    this.normal.applyQuaternion(this.q).normalize();
    this.tangent.applyQuaternion(this.q);
    this.binormal.crossVectors(this.tangent, this.normal).normalize();
  }

  private checkDetach(): void {
    this.normalForce = this.curvature * this.speed * this.speed + T.gravity * this.normal.y;
    if (this.normalForce < -T.detachSlack) this.toAir(true);
  }

  /** Leave the surface. `withCoyote` when it wasn't a pop, so a late release still pops. */
  private toAir(withCoyote: boolean): void {
    this.kickturnLeft = 0;
    this.lastGroundNormal.copy(this.normal);
    this.state = SkateState.Air;
    this.current = -1;
    this.vel.copy(this.tangent).multiplyScalar(this.speed);
    this.airTime = 0;
    this.pushPhase = 0;
    this.inTransition = false;
    this.curvature = 0;
    this.normalForce = 0;
    this.coyote = withCoyote ? T.coyoteTime : 0;
    this.landingPredicted = false;
    this.headingAssisting = false;
    this.spinRate = 0;
    this.spinRemaining = 0;
  }

  // --- pop: tail down, then leave along the normal ----------------------------------------------
  private startPop(input: InputFrame): void {
    if (this.state === SkateState.Grinding) {
      this.lastGrindExit = this.simTime;
      this.reattachDelay = T.grindReattachDelay;
      this.grindPath = null;
      this.grindYaw = 0;
      this.grindPitch = 0;
    }
    this.state = SkateState.Pop;
    this.popTimer = 0;
    this.popCharge = this.charge;
    this.selectTrick(input);
    this.vel.copy(this.tangent).multiplyScalar(this.speed);
    this.pushPhase = 0;
  }

  private stepPop(dt: number): void {
    this.popTimer += dt;
    this.pitch = T.popPitch * Math.min(1, this.popTimer / T.popDuration);
    this.pos.addScaledVector(this.tangent, this.speed * dt);
    if (this.popTimer >= T.popDuration) {
      this.lastGroundNormal.copy(this.normal);
      const h = T.ollieMinHeight + (T.ollieMaxHeight - T.ollieMinHeight) * this.popCharge;
      const vPop = Math.sqrt(2 * T.gravity * h);
      this.vel.copy(this.tangent).multiplyScalar(this.speed).addScaledVector(this.normal, vPop);
      this.current = -1;
      this.state = SkateState.Air;
      this.airTime = 0;
      this.coyote = 0;
      this.inTransition = false;
      this.curvature = 0;
      this.landingPredicted = false;
      this.headingAssisting = false;
      this.pelvisV += T.pelvisPopKick;
    this.pops++;
      this.armTrick();
    }
  }

  /** A release inside the coyote window after leaving a lip without popping. */
  private coyotePop(input: InputFrame): void {
    this.selectTrick(input);
    const h = T.ollieMinHeight + (T.ollieMaxHeight - T.ollieMinHeight) * this.charge;
    const vPop = Math.sqrt(2 * T.gravity * h);
    this.vel.addScaledVector(this.lastGroundNormal, vPop);
    this.pitch = T.popPitch;
    this.coyote = 0;
    this.pelvisV += T.pelvisPopKick;
    this.pops++;
    this.armTrick();
  }

  /** Stick direction at the moment of takeoff picks from the 8-way rose. */
  private selectTrick(input: InputFrame): void {
    const mag = Math.hypot(input.stickX, input.stickY);
    // Steeze: how cleanly the input was executed. Front foot from wedge accuracy, back foot from
    // charge. Clean input → more steeze → tweaked poses. Skill made visible for free.
    this.steezeR = Math.min(1, Math.max(0, (this.charge - 0.3) / 0.6));
    if (mag < T.trickDeadzone) {
      this.trick = OLLIE;
      this.steezeL = 0.5;
    } else {
      let a = Math.atan2(input.stickY, input.stickX);
      if (a < 0) a += 2 * Math.PI;
      const wedge = Math.PI / 4;
      const idx = Math.round(a / wedge) % 8;
      let err = Math.abs(a - idx * wedge);
      if (err > Math.PI) err = 2 * Math.PI - err;
      this.steezeL = Math.max(0, 1 - err / (wedge / 2));
      this.trick = ROSE[idx];
    }
    this.trickName = classifyTrick(this.trick.spin, this.trick.flip, this.trick.scoop);
  }

  /** Set rotation rates so the trick completes inside the predicted air time. */
  private armTrick(): void {
    const tAir = Math.max(T.minTrickTime, (2 * Math.max(0, this.vel.y)) / T.gravity);
    this.airPredicted = tAir;
    const tTrick = Math.max(T.minTrickTime, tAir * T.trickTimeFraction);
    const t = this.trick;
    this.trickRate = (Math.max(Math.abs(t.spin), Math.abs(t.flip), Math.abs(t.scoop), Math.PI) / tTrick);
    this.spinRemaining = Math.abs(t.spin);
    this.spinDir = Math.sign(t.spin);
    this.flip = 0;
    this.flipTarget = t.flip;
    // Popping out of a grind starts from the grind yaw: straighten to the nearest 180, then scoop.
    this.scoopTarget = this.scoop - residual(this.scoop, Math.PI) + t.scoop;
    this.spinTotal = 0;
    // Feet leave the board only when it rotates under them.
    const boardMoves = t.flip !== 0 || t.scoop !== 0;
    this.caughtL = !boardMoves;
    this.caughtR = !boardMoves;
    this.catchDelayR = (1 - this.steezeR) * T.catchSloppyDelay;
  }

  // --- air: ballistic, spin, predict the landing, land ----------------------------------------
  private stepAir(input: InputFrame, dt: number): void {
    this.vel.y -= T.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.airTime += dt;
    if (this.coyote > 0) this.coyote -= dt;
    if (this.pos.y < -30) {
      this.reset();
      return;
    }

    // Body spin about world up: first the trick's own spin, then whatever the stick asks for.
    // The trick's own spin is owed and always completes; a grab only damps the extra spin the
    // stick asks for, and nothing extra is added once a landing is predicted.
    let rate = 0;
    if (this.spinRemaining > 0) {
      rate = this.spinDir * this.trickRate;
      this.spinRemaining -= this.trickRate * dt;
    } else if (Math.abs(input.stickX) > 0.5 && !this.headingAssisting) {
      rate = -Math.sign(input.stickX) * T.heldSpinRate * (this.grabbing ? T.grabSpinDamping : 1);
    }
    this.spinRate = rate;
    this.spinTotal += rate * dt;
    if (rate !== 0) {
      // Spin about the body axis (the frame normal). On the flat that is world up; off a vert
      // wall it is the wall normal, which is what turns "up the wall" into "down the wall".
      this.q.setFromAxisAngle(this.normal, rate * dt);
      this.tangent.applyQuaternion(this.q);
      this.binormal.crossVectors(this.tangent, this.normal).normalize();
    }

    // Board-relative trick channels advance toward their targets and stop (the catch).
    this.flip = approach(this.flip, this.flipTarget, this.trickRate * dt);
    this.scoop = approach(this.scoop, this.scoopTarget, this.trickRate * dt);
    this.pitch *= Math.exp(-dt / T.pitchDecayTau);
    // Catch, per foot: the front foot seats as soon as the board is done rotating; a sloppy
    // trick (low back-foot steeze) seats the back foot a beat later.
    const boardDone = Math.abs(this.flip - this.flipTarget) < 0.05 && Math.abs(this.scoop - this.scoopTarget) < 0.05;
    if (boardDone && !this.caughtL) this.caughtL = true;
    if (this.caughtL && !this.caughtR) {
      this.catchDelayR -= dt;
      if (this.catchDelayR <= 0) this.caughtR = true;
    }

    // Landing prediction. Two horizons: the heading assist starts early so a spin can finish to
    // the nearest 0/180 at a sane rate; the frame normal blends onto the surface in the last
    // 120 ms so the touchdown looks intentional. The normal is otherwise frozen in the air:
    // levelling it toward world-up and then rotating it back onto a wall twisted the heading.
    // Steep surfaces count here: coming back down a vert wall you cannot land on it, but it is
    // still the surface you are aligning to.
    const headingAhead = this.predictSurface(T.headingLookahead, true);
    this.landingPredicted = false;
    this.headingAssisting = headingAhead !== null;
    if (headingAhead) {
      this.predSurface = headingAhead.surface;
      // The assist takes over any rotation still owed by the trick, or the two would overshoot.
      this.spinRemaining = 0;
      // Rate-based: any residual inside the reach closes within the lookahead.
      this.alignHeadingToVelocity(headingAhead.normal, ((Math.PI / 2) / T.headingLookahead) * dt);
    }
    const ahead = this.predictSurface(T.landLookahead);
    if (ahead) {
      this.landingPredicted = true;
      this.predNormal.copy(ahead.normal);
      this.predSurface = ahead.surface;
      const step = (Math.PI / T.landLookahead) * dt;
      this.rotateNormalToward(this.predNormal, step);
      this.flip = approach(this.flip, this.flip - residual(this.flip, 2 * Math.PI), step);
      this.scoop = approach(this.scoop, this.scoop - residual(this.scoop, Math.PI), step);
      this.flipTarget = this.flip;
      this.scoopTarget = this.scoop;
      this.pitch *= Math.exp(-dt / (T.pitchDecayTau * 0.5));
    }

    if (this.tryAttachGrind()) return;

    if (this.airTime < 0.02) return;
    const n = this.compound.query(this.pos, this.cand);
    let best: ProjectResult | null = null;
    for (let i = 0; i < n; i++) {
      const r = this.compound.project(this.cand[i], this.pos, i);
      if (r.margin < -T.boundsSlack) continue;
      if (r.h > T.landMaxHeight || r.h < -T.landMaxPenetration) continue;
      if (r.normal.y < T.landMinNormalY) continue;
      if (r.h >= 0 && this.vel.dot(r.normal) >= 0) continue;
      if (!best || r.h > best.h) best = r;
    }
    if (best) this.land(best, input);
  }

  /** The surface we would touch `tau` seconds from now on the current ballistic arc, or null. */
  private predictSurface(tau: number, allowSteep = false): ProjectResult | null {
    this.tmp.copy(this.pos).addScaledVector(this.vel, tau);
    this.tmp.y -= 0.5 * T.gravity * tau * tau;
    // The predicted point may be well below the surface we are about to hit: allow as much
    // penetration as we travel in the look-ahead. A fixed 0.6 m switched the assist off exactly
    // when falls got fast.
    const travel = this.vel.length() * tau + 0.5 * T.gravity * tau * tau;
    const maxPen = Math.max(T.landMaxPenetration, travel * 1.5 + 0.3);
    const n = this.compound.query(this.tmp, this.cand);
    let best: ProjectResult | null = null;
    for (let i = 0; i < n; i++) {
      const r = this.compound.project(this.cand[i], this.tmp, i);
      if (r.margin < -T.boundsSlack) continue;
      if (!allowSteep && r.normal.y < T.landMinNormalY) continue;
      if (r.h > T.landMaxHeight || r.h < -maxPen) continue;
      if (r.h >= 0 && this.vel.dot(r.normal) >= 0) continue;
      if (!best || r.h > best.h) best = r;
    }
    return best;
  }

  /**
   * Landing alignment, started early: rotate the heading about `n` toward the direction of
   * travel (mod 180°, so fakie landings stay fakie) by at most `maxStep`, but only when the
   * residual is inside the assist reach. Beyond it the skater is genuinely sideways and will bail.
   */
  private alignHeadingToVelocity(n: Vector3, maxStep: number): void {
    this.tmp.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
    if (this.tmp.lengthSq() < 0.09) return;
    this.tmp.normalize();
    this.tmp2.copy(this.tangent).addScaledVector(n, -this.tangent.dot(n));
    if (this.tmp2.lengthSq() < 1e-6) return;
    this.tmp2.normalize();
    let d = this.tmp.dot(this.tmp2);
    if (d < 0) {
      this.tmp.negate();
      d = -d;
    }
    const angle = Math.acos(Math.min(1, d));
    if (angle < 1e-4 || angle > T.headingAssistMax) return;
    // Signed angle about n from heading to travel direction.
    this.axis.crossVectors(this.tmp2, this.tmp);
    const sgn = this.axis.dot(n) >= 0 ? 1 : -1;
    this.q.setFromAxisAngle(n, sgn * Math.min(angle, maxStep));
    this.tangent.applyQuaternion(this.q);
    this.normal.applyQuaternion(this.q);
    this.binormal.crossVectors(this.tangent, this.normal).normalize();
  }

  private land(r: ProjectResult, input: InputFrame): void {
    const n = r.normal;
    const vn = this.vel.dot(n);
    // Tangential velocity survives; the normal part is absorbed.
    this.tmp.copy(this.vel).addScaledVector(n, -vn);
    const vt = this.tmp.length();
    // Board heading projected onto the new plane.
    this.tmp2.copy(this.tangent).addScaledVector(n, -this.tangent.dot(n));
    if (this.tmp2.lengthSq() < 1e-6) this.tmp2.copy(this.tmp);
    this.tmp2.normalize();

    // Misalignment between the board's long axis and the direction of travel, mod 180°.
    let mis = 0;
    let fakie = false;
    if (vt > 0.3) {
      this.tmp.divideScalar(vt);
      const d = this.tmp.dot(this.tmp2);
      fakie = d < 0;
      mis = Math.acos(Math.min(1, Math.abs(d)));
    }
    const flipRes = Math.abs(residual(this.flip, 2 * Math.PI));
    const scoopRes = Math.abs(residual(this.scoop, Math.PI));
    this.lastMisalignDeg = mis / D;

    if (mis > T.landBailAngle || flipRes > T.landBailAngle || scoopRes > T.landBailAngle) {
      this.bail(r, vt > 0.3 ? this.tmp : this.tmp2, n);
      return;
    }

    this.current = r.surface;
    this.landings++;
    this.lastImpact = Math.abs(vn);
    if (this.trickName !== 'ollie' && this.airTime > 0.3) this.trickLands++;
    this.impactTimer = T.impactTime;
    this.caughtL = true;
    this.caughtR = true;
    // The name is what actually rotated, not what the rose promised.
    this.trickName = classifyTrick(this.spinTotal, this.flip, this.scoop);
    // Catch: board seats on the nearest clean orientation.
    this.flip -= residual(this.flip, 2 * Math.PI);
    this.scoop -= residual(this.scoop, Math.PI);
    this.flipTarget = this.flip;
    this.scoopTarget = this.scoop;
    this.pitch = 0;

    let speed: number;
    if (vt > 0.3) {
      // Heading snaps to velocity. Past the snap angle the landing is sketchy and scrubs speed.
      this.tangent.copy(this.tmp);
      if (fakie) this.tangent.negate();
      // Horizontal speed is preserved (the brief), and so is the tangential projection when it is
      // larger (coming down a wall). Hitting a transition steeply no longer eats your speed.
      const vh = Math.hypot(this.vel.x, this.vel.z);
      const kept = Math.max(vt, vh);
      speed = fakie ? -kept : kept;
      if (mis > T.landSnapAngle) {
        speed *= 1 - (0.5 * (mis - T.landSnapAngle)) / (T.landBailAngle - T.landSnapAngle);
      }
    } else {
      this.tangent.copy(this.tmp2);
      speed = 0;
    }
    // Landing in a transition rewards you: a sliver of the absorbed normal speed rolls forward.
    speed += Math.sign(speed || 1) * Math.abs(vn) * T.landVerticalToForward * (1 - Math.max(0, n.y));

    // Auto-revert: landing fakie silently turns the board round unless the button is held.
    if (speed < 0 && !input.button) {
      this.tangent.negate();
      speed = -speed;
    }
    this.speed = speed;
    this.normal.copy(n);
    this.tangent.addScaledVector(n, -this.tangent.dot(n)).normalize();
    this.binormal.crossVectors(this.tangent, this.normal).normalize();
    this.pos.copy(r.point).addScaledVector(n, T.rideHeight);
    this.vel.copy(this.tangent).multiplyScalar(this.speed);
    this.curvature = this.compound.surfaces[this.current].curvature(r.u, r.v, this.tangent);
    this.state = SkateState.Riding;
    this.airTime = 0;
    this.grabbing = false;
    this.spinRate = 0;
    this.landingPredicted = false;
    this.headingAssisting = false;
    this.pelvisV += vn * T.landPelvisKick;
  }

  // --- grinds: a 1D constraint on a spline, never a failure -----------------------------------
  /**
   * Assist Charter: auto-attach to an edge within 0.35 m and 35° of its tangent while descending.
   * No button, no balance minigame.
   */
  private tryAttachGrind(): boolean {
    if (this.vel.y > T.grindMaxRise || this.airTime < 0.05) return false;
    if (this.simTime - this.lastGrindExit < this.reattachDelay) return false;
    const cosMax = Math.cos(T.grindSnapAngle);
    const grinds = this.compound.grinds;
    for (let i = 0; i < grinds.length; i++) {
      const g = grinds[i];
      const t = g.path.closestT(this.pos);
      g.path.frame(t, this.gP, this.gT, this.gK);
      // Within reach sideways, and above the edge but not by more than a short fall.
      const dy = this.pos.y - this.gP.y;
      if (dy < -0.05 || dy > T.grindSnapAbove) continue;
      if (Math.hypot(this.pos.x - this.gP.x, this.pos.z - this.gP.z) > T.grindSnapDistance) continue;
      // The board has to be roughly level to sit on an edge; a board pointing up a wall whose
      // tiny horizontal component happens to run along the coping is not a grind.
      if (Math.abs(this.tangent.y) > T.grindMaxTangentY) continue;
      // Board heading vs edge tangent, horizontal, mod 180 (grinding backwards is fine).
      this.tmp.set(this.tangent.x, 0, this.tangent.z);
      this.tmp2.set(this.gT.x, 0, this.gT.z);
      if (this.tmp.lengthSq() < 1e-6 || this.tmp2.lengthSq() < 1e-6) continue;
      this.tmp.normalize();
      this.tmp2.normalize();
      if (Math.abs(this.tmp.dot(this.tmp2)) < cosMax) continue;
      this.attachGrind(g, t);
      return true;
    }
    return false;
  }

  private attachGrind(g: GrindPath, t: number): void {
    this.state = SkateState.Grinding;
    this.grindPath = g;
    this.grindT = t;
    this.grinds++;
    g.path.frame(t, this.gP, this.gT, this.gK);
    g.upAt(this.gP, this.gUp);
    this.grindDir = this.tangent.dot(this.gT) >= 0 ? 1 : -1;
    // The board keeps the angle it arrived at while the body frame aligns to the edge, so there is
    // no visible snap; the yaw then relaxes to what the stick asks for.
    this.tmp.copy(this.gT).multiplyScalar(this.grindDir);
    this.tmp.y = 0;
    this.tmp2.set(this.tangent.x, 0, this.tangent.z);
    if (this.tmp.lengthSq() > 1e-6 && this.tmp2.lengthSq() > 1e-6) {
      this.tmp.normalize();
      this.tmp2.normalize();
      const c = Math.min(1, Math.max(-1, this.tmp.dot(this.tmp2)));
      const sgn = this.tmp.x * this.tmp2.z - this.tmp.z * this.tmp2.x >= 0 ? 1 : -1;
      this.grindYaw = sgn * Math.acos(c);
    } else this.grindYaw = 0;
    this.grindPitch = 0;
    this.scoop = this.grindYaw;
    this.scoopTarget = this.grindYaw;
    // Velocity along the edge survives; the rest is absorbed into the pelvis spring.
    this.speed = this.vel.dot(this.gT) * this.grindDir;
    const vUp = this.vel.dot(this.gUp);
    if (vUp < 0) this.pelvisV += vUp * T.landPelvisKick;
    // Remember where we were relative to the constraint and blend that away over 80 ms.
    this.tmp.copy(this.gP).addScaledVector(this.gUp, g.height);
    this.grindOffset.subVectors(this.pos, this.tmp);
    this.grindBlend = 0;
    this.grindDropTimer = 0;
    this.grindStallTimer = 0;
    // Catch the board.
    this.flip -= residual(this.flip, 2 * Math.PI);
    this.scoop -= residual(this.scoop, Math.PI);
    this.flipTarget = this.flip;
    this.scoopTarget = this.scoop;
    this.pitch = 0;
    this.spinRate = 0;
    this.spinRemaining = 0;
    this.grabbing = false;
    this.landingPredicted = false;
    this.headingAssisting = false;
    this.current = -1;
    this.curvature = 0;
    this.normalForce = 0;
    this.inTransition = false;
    this.coyote = 0;
    this.airTime = 0;
  }

  private stepGrind(input: InputFrame, dt: number): void {
    const g = this.grindPath!;
    const path = g.path;

    // Energy: material friction (always below rolling friction) and gravity along a sloped edge.
    this.speed -= this.speed * g.friction * dt;
    this.speed += -T.gravity * this.tangent.y * dt;

    // Advance along the spline: arc speed → parameter speed.
    path.evaluate(this.grindT, this.gP, this.gT);
    const dpdt = Math.max(1e-6, this.gT.length());
    this.grindT += (this.grindDir * this.speed * dt) / dpdt;
    this.grindDistance += Math.abs(this.speed) * dt;
    this.distance += Math.abs(this.speed) * dt;
    if (this.grindT < 0 || this.grindT > 1) {
      // Off the end: launch along the tangent, keeping speed. Coyote so a late ollie still pops.
      this.exitGrind(T.grindReattachDelay);
      return;
    }

    // Frame chases the edge frame; the position offset blends away.
    path.frame(this.grindT, this.gP, this.gT, this.gK);
    g.upAt(this.gP, this.gUp);
    const step = (Math.PI / T.grindBlendTime) * dt;
    this.rotateNormalToward(this.gUp, step);
    this.tmp.copy(this.gT).multiplyScalar(this.grindDir);
    this.rotateTangentToward(this.tmp, step);
    this.grindBlend = Math.min(1, this.grindBlend + dt / T.grindBlendTime);

    // Grind pose is computed, never authored: stick X yaws the board on the edge, stick Y pitches
    // it, and the nearest of the six contact points becomes the pivot that sits on the edge.
    this.grindYaw += (input.stickX * T.grindYawMax - this.grindYaw) * Math.min(1, T.grindPoseRate * dt);
    this.grindPitch += (-input.stickY * T.grindPitchMax - this.grindPitch) * Math.min(1, T.grindPoseRate * dt);
    this.scoop = this.grindYaw;
    this.scoopTarget = this.grindYaw;
    this.pitch = this.grindPitch;
    this.grindContact = pivotForPitch(this.grindPitch);
    this.grindName = classifyGrind(this.grindYaw, this.grindPitch, this.grindContact);
    // Board centre = pivot on the edge minus the pivot's offset along the (yawed, pitched) deck.
    this.tmp.copy(this.tangent).negate();
    this.mat.makeBasis(this.binormal, this.normal, this.tmp);
    this.q.setFromRotationMatrix(this.mat);
    this.q2.set(0, Math.sin(this.scoop / 2), 0, Math.cos(this.scoop / 2));
    this.q3.set(Math.sin(this.pitch / 2), 0, 0, Math.cos(this.pitch / 2));
    this.q2.multiply(this.q3);
    this.tmp.set(0, 0, -CONTACTS[this.grindContact]).applyQuaternion(this.q2).applyQuaternion(this.q);
    this.pos.copy(this.gP).addScaledVector(this.gUp, g.height).sub(this.tmp).addScaledVector(this.grindOffset, 1 - this.grindBlend);
    this.vel.copy(this.tangent).multiplyScalar(this.speed);

    // Drop off the side: hold the stick sideways.
    if (Math.abs(input.stickX) > 0.7) {
      this.grindDropTimer += dt;
      if (this.grindDropTimer >= T.grindDropHold) {
        const side = Math.sign(input.stickX);
        this.exitGrind(T.grindReattachDelay);
        this.vel.addScaledVector(this.binormal, side * T.grindDropPush);
        return;
      }
    } else {
      this.grindDropTimer = 0;
    }

    // A stall (no speed along the edge) is a pose, not a resting state: after a moment the
    // skater drops off toward the side the edge tilts to (into the transition for coping), or
    // toward the stick, or to the right. Grinding never fails, but it always ends.
    if (Math.abs(this.speed) < T.grindStallSpeed) {
      this.grindStallTimer += dt;
      if (this.grindStallTimer >= T.grindStallTime) {
        // Tilt side = the horizontal part of the edge's up vector.
        this.tmp.set(this.gUp.x, 0, this.gUp.z);
        let side: number;
        if (this.tmp.lengthSq() > 1e-4) side = Math.sign(this.tmp.dot(this.binormal)) || 1;
        else side = input.stickX !== 0 ? Math.sign(input.stickX) : 1;
        // Pivot the board to face the drop before leaving, like rocking off a stall.
        this.tmp2.copy(this.binormal).multiplyScalar(side);
        this.exitGrind(T.grindReattachDelayAfterStall);
        this.vel.addScaledVector(this.tmp2, T.grindStallPush);
        this.vel.y -= 0.5;
        this.tangent.copy(this.tmp2);
        this.binormal.crossVectors(this.tangent, this.normal).normalize();
        this.vel.copy(this.tmp2).multiplyScalar(T.grindStallPush);
        this.vel.y = -0.5;
      }
    } else {
      this.grindStallTimer = 0;
    }
  }

  private exitGrind(reattachDelay: number): void {
    this.lastGrindExit = this.simTime;
    this.reattachDelay = reattachDelay;
    this.grindPath = null;
    this.grindBlend = 1;
    // The board turns back from its grind yaw to the nearest straight orientation in the air.
    this.scoopTarget = this.scoop - residual(this.scoop, Math.PI);
    this.trickRate = Math.max(this.trickRate, Math.PI / 0.35);
    this.grindYaw = 0;
    this.grindPitch = 0;
    this.toAir(true);
  }

  /** Rotate the tangent about the normal toward `dir` (projected), by at most `maxStep`. */
  private rotateTangentToward(dir: Vector3, maxStep: number): void {
    this.tmp2.copy(dir).addScaledVector(this.normal, -dir.dot(this.normal));
    if (this.tmp2.lengthSq() < 1e-8) return;
    this.tmp2.normalize();
    const d = Math.min(1, Math.max(-1, this.tangent.dot(this.tmp2)));
    const angle = Math.acos(d);
    if (angle < 1e-5) return;
    this.axis.crossVectors(this.tangent, this.tmp2);
    const sgn = this.axis.dot(this.normal) >= 0 ? 1 : -1;
    this.q.setFromAxisAngle(this.normal, sgn * Math.min(angle, maxStep));
    this.tangent.applyQuaternion(this.q).normalize();
    this.binormal.crossVectors(this.tangent, this.normal).normalize();
  }

  // --- bail: down for a moment, then back on the board ---------------------------------------
  private bail(r: ProjectResult, dir: Vector3, n: Vector3): void {
    this.state = SkateState.Bailed;
    this.bails++;
    this.bailTimer = 0;
    this.current = r.surface;
    this.normal.copy(n);
    this.tangent.copy(dir).addScaledVector(n, -dir.dot(n)).normalize();
    this.binormal.crossVectors(this.tangent, this.normal).normalize();
    this.pos.copy(r.point).addScaledVector(n, T.rideHeight);
    this.speed = this.vel.length() * 0.3;
    this.vel.copy(this.tangent).multiplyScalar(this.speed);
    this.flip = 0;
    this.scoop = 0;
    this.flipTarget = 0;
    this.scoopTarget = 0;
    this.pitch = 0;
    this.grabbing = false;
    this.spinRate = 0;
    this.caughtL = true;
    this.caughtR = true;
    this.trickName = classifyTrick(this.spinTotal, this.flip, this.scoop) + ' (bail)';
    this.landingPredicted = false;
    this.headingAssisting = false;
    this.pelvisV = -3;
  }

  private stepBail(dt: number): void {
    this.bailTimer += dt;
    this.speed *= Math.max(0, 1 - T.bailDecay * dt);
    this.speed += -T.gravity * this.tangent.y * dt;
    this.pos.addScaledVector(this.tangent, this.speed * dt);
    if (this.constrain(dt) && this.bailTimer >= T.bailDuration) {
      this.state = SkateState.Riding;
      this.charge = 0;
    }
  }

  // --- body on the board: charge, lean, weight, pelvis spring -----------------------------------
  private stepBody(input: InputFrame, dt: number): void {
    const inAir = this.state === SkateState.Air;
    if (input.button && !inAir) this.charge = Math.min(1, this.charge + dt / T.chargeUpTime);
    else this.charge = Math.max(0, this.charge - dt / T.chargeDownTime);

    const centripetal = this.speed * this.yawRate;
    let leanTarget = Math.atan2(centripetal, 9.81);
    if (leanTarget > T.leanMax) leanTarget = T.leanMax;
    else if (leanTarget < -T.leanMax) leanTarget = -T.leanMax;
    if (inAir || this.state === SkateState.Pop) leanTarget = 0;
    if (this.state === SkateState.Grinding) {
      // Cosmetic wobble; the button is the lock. Grinding never fails either way.
      leanTarget = input.button ? 0 : T.grindWobble * Math.sin(2 * Math.PI * T.grindWobbleHz * this.simTime);
    }
    if (this.state === SkateState.Bailed) leanTarget = 0.35;
    this.lean += (leanTarget - this.lean) * Math.min(1, T.leanRate * dt);

    this.weight += (input.stickY - this.weight) * Math.min(1, 12 * dt);

    let target: number;
    if (this.state === SkateState.Bailed) {
      target = 0.3;
    } else if (inAir) {
      target = T.pelvisStand - (this.grabbing ? T.grabTuck : 0);
    } else if (this.state === SkateState.Grinding) {
      target = T.pelvisStand - 0.06 - this.charge * T.pelvisCrouch - Math.abs(this.speed) * T.pelvisSpeedCrouch;
    } else {
      const load = Math.min(0.3, Math.max(0, this.curvature * this.speed * this.speed * T.pelvisCurvatureCrouch));
      target = T.pelvisStand - this.charge * T.pelvisCrouch - Math.abs(this.speed) * T.pelvisSpeedCrouch - load;
    }
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
    this.q.setFromRotationMatrix(this.mat); // frame
    this.frame.curr.pos.copy(this.pos);
    this.frame.curr.rot.copy(this.q);
    // Board-relative: scoop about local Y, pitch about local X, flip about local Z (long axis).
    this.q2.set(0, Math.sin(this.scoop / 2), 0, Math.cos(this.scoop / 2));
    this.q3.set(Math.sin(this.pitch / 2), 0, 0, Math.cos(this.pitch / 2));
    this.q2.multiply(this.q3);
    this.q3.set(0, 0, Math.sin(this.flip / 2), Math.cos(this.flip / 2));
    this.q2.multiply(this.q3);
    b.rot.copy(this.q).multiply(this.q2);

    const p = this.pelvis.curr;
    const h = this.pelvisH;
    const side = -Math.sin(this.lean) * h * T.leanShift;
    p.pos
      .copy(this.pos)
      .addScaledVector(this.normal, h * Math.cos(this.lean))
      .addScaledVector(this.binormal, side)
      .addScaledVector(this.tangent, this.weight * T.weightShiftPelvis);
    // Roll about the forward axis so the pelvis tilts the same way it shifts (left for a left lean).
    this.q2.setFromAxisAngle(this.tangent, -this.lean);
    p.rot.copy(this.q2).multiply(this.q);
  }

  debugReport(kv: (key: string, value: string | number) => void): void {
    kv('state', `${this.state}  anim ${this.animState}`);
    kv('trickName', `${this.trickName}  steeze ${this.steezeL.toFixed(2)}/${this.steezeR.toFixed(2)}  caught ${this.caughtL ? 'L' : '-'}${this.caughtR ? 'R' : '-'}`);
    kv('surface', this.surfaceId);
    kv('speed', `${this.speed.toFixed(2)} u/s`);
    kv('trick', `spin ${(this.spinRate / D).toFixed(0)}°/s  total ${(this.spinTotal / D).toFixed(0)}°`);
    kv('board', `flip ${(this.flip / D).toFixed(0)}°  scoop ${(this.scoop / D).toFixed(0)}°  pitch ${(this.pitch / D).toFixed(0)}°`);
    kv('air', `${this.airTime.toFixed(2)} s  coyote ${this.coyote > 0 ? this.coyote.toFixed(2) : '—'}  land→ ${this.landingPredicted ? this.compound.surfaces[this.predSurface].id : '—'}`);
    kv('landings', `${this.landings}  bails ${this.bails}  last mis ${this.lastMisalignDeg.toFixed(0)}°`);
    kv('grind', this.grindPath ? `${this.grindName}  ${this.grindPath.id}  yaw ${(this.grindYaw / D).toFixed(0)}° pitch ${(this.grindPitch / D).toFixed(0)}°${this.prevButton ? '  lock' : ''}` : `—  (${this.grinds}, ${this.grindDistance.toFixed(0)} m)`);
    kv('manual', `${this.manual.toFixed(2)}  bailRamp ${this.bailRamp.toFixed(2)}`);
    kv('walls', `mercy ${this.mercies}  slams ${this.slams}  kickturns ${this.kickturns}`);
    kv('curv', `${this.curvature.toFixed(3)} /m  N ${this.normalForce.toFixed(1)}`);
    kv('pump', this.inTransition ? `${this.pumpFactor.toFixed(1)} (${this.transitions})` : `— (${this.transitions})`);
    kv('yawRate', `${this.yawRate.toFixed(2)} rad/s`);
    kv('normal', `${this.normal.x.toFixed(2)} ${this.normal.y.toFixed(2)} ${this.normal.z.toFixed(2)}`);
    kv('charge', `${this.charge.toFixed(2)}  hold ${this.holdTime.toFixed(2)}`);
    kv('push', this.pushPhase.toFixed(2));
    kv('lean', `${(this.lean / D).toFixed(1)}°`);
    kv('pelvis', this.pelvisH.toFixed(2));
    kv('odometer', `${this.distance.toFixed(0)} m`);
  }
}

/** Move `a` toward `target` by at most `step`. */
function approach(a: number, target: number, step: number): number {
  const d = target - a;
  if (Math.abs(d) <= step) return target;
  return a + Math.sign(d) * step;
}
