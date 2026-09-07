import { PerspectiveCamera, Vector3 } from 'three';

/**
 * PHASE 0 STUB. Rigid follow camera: fixed offset behind and above a target, looking at it.
 * No orbit controls, ever. Phase 1 replaces the rigid follow with the spring-damped rig.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly offset = new Vector3(0, 3.2, 6.5);
  readonly lookOffset = new Vector3(0, 0.6, 0);

  private readonly tmp = new Vector3();
  private readonly tmpLook = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(60, aspect, 0.1, 300);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Follow a world-space target position and heading (radians about +Y). */
  update(targetPos: Vector3, heading: number): void {
    const c = this.camera;
    // Rotate the offset by heading so the camera sits behind the target.
    const s = Math.sin(heading);
    const co = Math.cos(heading);
    this.tmp.set(
      this.offset.x * co + this.offset.z * s,
      this.offset.y,
      -this.offset.x * s + this.offset.z * co,
    );
    c.position.copy(targetPos).add(this.tmp);
    this.tmpLook.copy(targetPos).add(this.lookOffset);
    c.lookAt(this.tmpLook);
  }
}
