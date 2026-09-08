import { PerspectiveCamera, Vector3 } from 'three';
import { TUNING as T } from '../sim/Tuning';

/**
 * Camera tuning. The reference points are the skate games people actually film: EA's Skate sits
 * low and close behind the *direction of travel* with a level horizon; Tony Hawk's rides higher
 * and further back, never spins with the skater, and on vert stays at the bottom of the wall
 * looking up; Skater XL's follow camera lifts gently with a trick. Journey's camera rules apply on
 * top: never move the camera for something the player didn't do, never bob with a jump, lead the
 * look along velocity, keep the horizon.
 */
const CAM = {
  /** Behind the travel direction and above the reference floor, metres. Both grow with speed. */
  back: 4.2,
  backPerSpeed: 0.07,
  up: 1.9,
  upPerSpeed: 0.02,
  /** Look-at: above the deck, lead along velocity (seconds), extra height with speed. */
  lookUp: 0.6,
  leadTime: 0.32,
  leadMax: 3.2,
  leadUp: 0.2,
  /** Heading follows the travel direction: a damped spring on the yaw angle with a rate cap. */
  yawOmega: 4.5,
  /** Rate cap on the heading swing: gentle for small corrections, fast when the travel direction
   *  reverses (rolling back down a wall) so the skater is never overtaken by the camera. */
  yawMaxRate: 2.6,
  yawMaxRateReverse: 7.5,
  /** Below this speed the heading holds (slow rolls, stalls, standing still). */
  headingMinSpeed: 1.2,
  /** The horizontal offset behind the heading is rigid (the skater can never run through the
   *  camera on a reversal); only its length eases. The vertical spring is soft: the camera does
   *  not climb ramps or chase jumps, it lets the pitch do the work like a filmer on the deck. */
  backRate: 4,
  heightOmega: 2.2,
  lookOmega: 9,
  zeta: 1.0,
  /** Max angular rate of the look direction, rad/s. The whip clamp. */
  lookMaxRate: 2.4,
  /** The camera never sits closer than this above the concrete under it. */
  floorClearance: 0.7,
  fovMin: 60,
  fovMax: 78,
  fovRate: 4,
  /** Roll into carves: fraction of skater lean, capped at 6°. */
  rollFromLean: 0.35,
  rollMax: (6 * Math.PI) / 180,
  rollRate: 6,
  /** Per-state framing offsets: (back, up, lookUp) added to the base. */
  air: { back: 0.5, up: -0.1, lookUp: 0.15 },
  grind: { back: 0.3, up: -0.3, lookUp: -0.1 },
  bail: { back: 1.2, up: 0.4, lookUp: -0.3 },
  /** How fast the state offsets blend, 1/s. */
  stateRate: 5,
} as const;

export type CameraMode = 'ride' | 'air' | 'grind' | 'bail';

export interface CameraTarget {
  /** Displayed (interpolated) board position. */
  pos: Vector3;
  /** Forward tangent and up normal of the board. */
  forward: Vector3;
  up: Vector3;
  /** World velocity of the board (tangent × signed speed on the ground, the flight velocity in the air). */
  vel: Vector3;
  speed: number;
  /** Skater lean, radians, positive = left. */
  lean: number;
  mode: CameraMode;
  /** Ground level under the skater the last time they were on it. */
  floorY: number;
  /** Height of the highest concrete under a point, for keeping the camera out of ramps. */
  floorAt?: (p: Vector3) => number | null;
}

/**
 * Follow camera. Heading is a smoothed yaw toward the direction of travel (not the board's nose:
 * riding fakie, spinning, or grinding sideways never swings the camera). Position sits behind
 * that heading, low, with a slow vertical spring anchored to the floor the skater last stood on,
 * so airs and wall rides are framed by pitching up rather than by the camera climbing. A floor
 * probe keeps it out of the concrete. Look-at leads along velocity with a whip clamp. Runs at
 * render rate; it is display, not simulation. No orbit controls, ever.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;

  private yaw = 0;
  private yawVel = 0;
  private readonly pos = new Vector3();
  private readonly posVel = new Vector3();
  private back: number = CAM.back;
  private readonly look = new Vector3();
  private readonly lookVel = new Vector3();
  private readonly posTarget = new Vector3();
  private readonly lookTarget = new Vector3();
  private readonly heading = new Vector3(0, 0, -1);
  private readonly tmp = new Vector3();
  private readonly prevDir = new Vector3();
  private readonly newDir = new Vector3();
  private readonly upRolled = new Vector3();
  private readonly camRight = new Vector3();
  private fov = CAM.fovMin;
  private roll = 0;
  private airW = 0;
  private grindW = 0;
  private bailW = 0;
  private primed = false;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(CAM.fovMin, aspect, 0.1, 300);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Landing impact: drop the camera a little; the height spring brings it back. */
  kick(amount: number): void {
    this.posVel.y -= amount;
  }

  /** Snap to the target with no spring history (spawn, reset, scene switch). */
  snap(t: CameraTarget): void {
    this.yaw = this.travelYaw(t, Math.atan2(-t.forward.x, -t.forward.z));
    this.yawVel = 0;
    this.airW = t.mode === 'air' ? 1 : 0;
    this.grindW = t.mode === 'grind' ? 1 : 0;
    this.bailW = t.mode === 'bail' ? 1 : 0;
    this.back = this.backTarget(t);
    this.computeTargets(t);
    this.pos.copy(this.posTarget);
    this.look.copy(this.lookTarget);
    this.posVel.set(0, 0, 0);
    this.lookVel.set(0, 0, 0);
    this.fov = CAM.fovMin;
    this.roll = 0;
    this.primed = true;
    this.apply();
  }

  update(t: CameraTarget, dt: number): void {
    if (!this.primed) {
      this.snap(t);
      return;
    }
    if (dt > 0.05) dt = 0.05;

    // Heading: spring the yaw toward the travel direction through the shortest arc, rate-capped.
    const targetYaw = this.travelYaw(t, this.yaw);
    let err = targetYaw - this.yaw;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    this.yawVel += (CAM.yawOmega * CAM.yawOmega * err - 2 * CAM.zeta * CAM.yawOmega * this.yawVel) * dt;
    const big = Math.min(1, Math.max(0, (Math.abs(err) - 0.8) / 1.7)); // 0 below 45°, 1 past ~145°
    const cap = CAM.yawMaxRate + (CAM.yawMaxRateReverse - CAM.yawMaxRate) * big * big * (3 - 2 * big);
    if (this.yawVel > cap) this.yawVel = cap;
    else if (this.yawVel < -cap) this.yawVel = -cap;
    this.yaw += this.yawVel * dt;

    // State blends.
    const k = Math.min(1, CAM.stateRate * dt);
    this.airW += ((t.mode === 'air' ? 1 : 0) - this.airW) * k;
    this.grindW += ((t.mode === 'grind' ? 1 : 0) - this.grindW) * k;
    this.bailW += ((t.mode === 'bail' ? 1 : 0) - this.bailW) * k;

    this.back += (this.backTarget(t) - this.back) * Math.min(1, CAM.backRate * dt);
    this.computeTargets(t);
    // Keep the *target* out of the concrete too, so the spring does the lifting smoothly and the
    // hard clamp below only ever catches the last few centimetres.
    if (t.floorAt) {
      const f = t.floorAt(this.posTarget);
      if (f !== null && this.posTarget.y < f + CAM.floorClearance) this.posTarget.y = f + CAM.floorClearance;
    }

    // Position: rigid horizontal offset (all the horizontal ease lives in the yaw and the back
    // distance), spring on the height only.
    this.pos.x = this.posTarget.x;
    this.pos.z = this.posTarget.z;
    springAxis(this.pos, this.posVel, this.posTarget, 'y', CAM.heightOmega, CAM.zeta, dt);
    // Hard floor: never inside the concrete, whatever the springs say.
    if (t.floorAt) {
      const f = t.floorAt(this.pos);
      if (f !== null && this.pos.y < f + CAM.floorClearance) {
        this.pos.y = f + CAM.floorClearance;
        if (this.posVel.y < 0) this.posVel.y = 0;
      }
    }

    // Look spring, then clamp how fast the look *direction* may swing. Clamping the direction and
    // not the position spring is what stops the whip without making the framing sluggish.
    this.prevDir.subVectors(this.look, this.pos).normalize();
    spring(this.look, this.lookVel, this.lookTarget, CAM.lookOmega, CAM.zeta, dt);
    this.newDir.subVectors(this.look, this.pos);
    const dist = this.newDir.length();
    this.newDir.divideScalar(dist);
    const angle = Math.acos(Math.min(1, Math.max(-1, this.prevDir.dot(this.newDir))));
    // The clamp never fights the heading swing itself: while the camera orbits fast on a
    // reversal the look must keep up or the skater leaves the frame.
    const maxAngle = Math.max(CAM.lookMaxRate, Math.abs(this.yawVel) * 1.25) * dt;
    if (angle > maxAngle) {
      const kk = maxAngle / angle;
      this.newDir.copy(this.prevDir).lerp(this.newDir, kk).normalize();
      this.look.copy(this.pos).addScaledVector(this.newDir, dist);
      this.lookVel.multiplyScalar(0.5);
    }

    const sp = Math.min(1, Math.abs(t.speed) / T.topSpeedRef);
    const fovTarget = CAM.fovMin + (CAM.fovMax - CAM.fovMin) * sp;
    this.fov += (fovTarget - this.fov) * Math.min(1, CAM.fovRate * dt);

    let rollTarget = t.lean * CAM.rollFromLean * (1 - this.airW) * (1 - this.bailW);
    if (rollTarget > CAM.rollMax) rollTarget = CAM.rollMax;
    else if (rollTarget < -CAM.rollMax) rollTarget = -CAM.rollMax;
    this.roll += (rollTarget - this.roll) * Math.min(1, CAM.rollRate * dt);

    this.apply();
  }

  /** Yaw of the direction of travel (horizontal), or `hold` when too slow to trust it. */
  private travelYaw(t: CameraTarget, hold: number): number {
    const vx = t.vel.x;
    const vz = t.vel.z;
    if (vx * vx + vz * vz < CAM.headingMinSpeed * CAM.headingMinSpeed) return hold;
    // Three.js: yaw 0 looks down -Z; a direction d has yaw atan2(-d.x, -d.z).
    return Math.atan2(-vx, -vz);
  }

  private backTarget(t: CameraTarget): number {
    const sp = Math.abs(t.speed);
    return CAM.back + sp * CAM.backPerSpeed + CAM.air.back * this.airW + CAM.grind.back * this.grindW + CAM.bail.back * this.bailW;
  }

  private computeTargets(t: CameraTarget): void {
    this.heading.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const sp = Math.abs(t.speed);
    const spn = Math.min(1, sp / T.topSpeedRef);
    const back = this.back;
    const up = CAM.up + sp * CAM.upPerSpeed + CAM.air.up * this.airW + CAM.grind.up * this.grindW + CAM.bail.up * this.bailW;
    const lookUp = CAM.lookUp + spn * CAM.leadUp + CAM.air.lookUp * this.airW + CAM.grind.lookUp * this.grindW + CAM.bail.lookUp * this.bailW;

    // Position: behind the heading; height off the reference floor, not the skater. On the ground
    // the floor is the skater's own ground, so this is the usual follow height; in the air it is
    // where they left from, so the camera holds and pitches up instead of bobbing with the jump.
    this.posTarget.copy(t.pos).addScaledVector(this.heading, -back);
    this.posTarget.y = t.floorY + up;

    // Lead along the horizontal velocity, capped so a fast run doesn't push the skater off-screen.
    this.tmp.set(t.vel.x, 0, t.vel.z).multiplyScalar(CAM.leadTime);
    const l = this.tmp.length();
    if (l > CAM.leadMax) this.tmp.multiplyScalar(CAM.leadMax / l);
    this.lookTarget.copy(t.pos).add(this.tmp);
    this.lookTarget.y += lookUp;
  }

  private apply(): void {
    const c = this.camera;
    c.position.copy(this.pos);
    this.newDir.subVectors(this.look, this.pos).normalize();
    this.camRight.crossVectors(this.newDir, this.upRolled.set(0, 1, 0)).normalize();
    this.upRolled.set(0, 1, 0).multiplyScalar(Math.cos(this.roll)).addScaledVector(this.camRight, Math.sin(this.roll));
    c.up.copy(this.upRolled);
    c.lookAt(this.look);
    if (Math.abs(c.fov - this.fov) > 0.01) {
      c.fov = this.fov;
      c.updateProjectionMatrix();
    }
  }
}

/** Semi-implicit damped spring on a Vector3. ω natural frequency, ζ damping ratio. */
function spring(p: Vector3, v: Vector3, target: Vector3, omega: number, zeta: number, dt: number): void {
  const k = omega * omega;
  const c = 2 * zeta * omega;
  v.x += (k * (target.x - p.x) - c * v.x) * dt;
  v.y += (k * (target.y - p.y) - c * v.y) * dt;
  v.z += (k * (target.z - p.z) - c * v.z) * dt;
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;
}

function springAxis(p: Vector3, v: Vector3, target: Vector3, axis: 'x' | 'y' | 'z', omega: number, zeta: number, dt: number): void {
  const k = omega * omega;
  const c = 2 * zeta * omega;
  v[axis] += (k * (target[axis] - p[axis]) - c * v[axis]) * dt;
  p[axis] += v[axis] * dt;
}
