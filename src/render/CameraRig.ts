import { PerspectiveCamera, Vector3 } from 'three';
import { TUNING as T } from '../sim/Tuning';

const CAM = {
  /** Behind and above the board, in board frame. Grows a little with speed. */
  offsetBack: 4.6,
  offsetUp: 2.1,
  offsetBackPerSpeed: 0.06,
  /** Look-at point above the deck, plus lead along velocity (seconds) and up. */
  lookUp: 0.55,
  leadTime: 0.35,
  leadUp: 0.25,
  /** Springs: position is softer than look, so the framing floats while the aim stays honest. */
  posOmega: 5.5,
  lookOmega: 9,
  zeta: 1.0,
  /** Max angular rate of the look direction, rad/s. This is the whip clamp. */
  lookMaxRate: 2.4,
  fovMin: 60,
  fovMax: 78,
  fovRate: 4,
  /** Roll into carves: fraction of skater lean, capped at 6°. */
  rollFromLean: 0.35,
  rollMax: (6 * Math.PI) / 180,
  rollRate: 6,
} as const;

export interface CameraTarget {
  /** Displayed (interpolated) board position. */
  pos: Vector3;
  /** Forward tangent and up normal of the board. */
  forward: Vector3;
  up: Vector3;
  speed: number;
  /** Skater lean, radians, positive = left. */
  lean: number;
}

/**
 * Spring-damped follow camera. Two independent springs (position, look-at), FOV that widens
 * with speed, a slight roll into carves, and a lead so you see where you are going.
 * Runs at render rate on render dt; it is display, not simulation. No orbit controls, ever.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;

  private readonly pos = new Vector3();
  private readonly posVel = new Vector3();
  private readonly look = new Vector3();
  private readonly lookVel = new Vector3();
  private readonly posTarget = new Vector3();
  private readonly lookTarget = new Vector3();
  private readonly tmp = new Vector3();
  private readonly prevDir = new Vector3();
  private readonly newDir = new Vector3();
  private readonly upRolled = new Vector3();
  private readonly camRight = new Vector3();
  private fov = CAM.fovMin;
  private roll = 0;
  private primed = false;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(CAM.fovMin, aspect, 0.1, 300);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Snap to the target with no spring history (spawn, reset, scene switch). */
  snap(t: CameraTarget): void {
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
    this.computeTargets(t);

    spring(this.pos, this.posVel, this.posTarget, CAM.posOmega, CAM.zeta, dt);

    // Look spring, then clamp how fast the look *direction* may swing. Clamping the direction and
    // not the position spring is what stops the whip without making the framing sluggish.
    this.prevDir.subVectors(this.look, this.pos).normalize();
    spring(this.look, this.lookVel, this.lookTarget, CAM.lookOmega, CAM.zeta, dt);
    this.newDir.subVectors(this.look, this.pos);
    const dist = this.newDir.length();
    this.newDir.divideScalar(dist);
    const angle = Math.acos(Math.min(1, Math.max(-1, this.prevDir.dot(this.newDir))));
    const maxAngle = CAM.lookMaxRate * dt;
    if (angle > maxAngle) {
      // Slerp the direction back toward the previous one and rebuild the look point.
      const k = maxAngle / angle;
      this.newDir.copy(this.prevDir).lerp(this.newDir, k).normalize();
      this.look.copy(this.pos).addScaledVector(this.newDir, dist);
      this.lookVel.multiplyScalar(0.5);
    }

    const fovTarget = CAM.fovMin + (CAM.fovMax - CAM.fovMin) * Math.min(1, t.speed / T.topSpeedRef);
    this.fov += (fovTarget - this.fov) * Math.min(1, CAM.fovRate * dt);

    let rollTarget = t.lean * CAM.rollFromLean;
    if (rollTarget > CAM.rollMax) rollTarget = CAM.rollMax;
    else if (rollTarget < -CAM.rollMax) rollTarget = -CAM.rollMax;
    this.roll += (rollTarget - this.roll) * Math.min(1, CAM.rollRate * dt);

    this.apply();
  }

  private computeTargets(t: CameraTarget): void {
    // Flatten the forward onto the horizontal so the camera doesn't dive when the board pitches.
    this.tmp.copy(t.forward);
    this.tmp.y = 0;
    if (this.tmp.lengthSq() < 1e-6) this.tmp.set(0, 0, -1);
    this.tmp.normalize();
    const back = CAM.offsetBack + t.speed * CAM.offsetBackPerSpeed;
    this.posTarget.copy(t.pos).addScaledVector(this.tmp, -back);
    this.posTarget.y += CAM.offsetUp;

    this.lookTarget
      .copy(t.pos)
      .addScaledVector(this.tmp, t.speed * CAM.leadTime)
      .addScaledVector(t.up, CAM.lookUp + Math.min(1, t.speed / T.topSpeedRef) * CAM.leadUp);
  }

  private apply(): void {
    const c = this.camera;
    c.position.copy(this.pos);
    // Roll: tilt the up vector about the view axis before lookAt.
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
