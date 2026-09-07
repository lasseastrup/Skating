import type { Object3D } from 'three';
import type { KinematicBody } from './Sim';

/**
 * Write the interpolated transform of a body into a display object.
 * alpha = 0 shows the start of the last sim step, alpha = 1 its end.
 */
export function applyInterpolated(body: KinematicBody, target: Object3D, alpha: number): void {
  target.position.lerpVectors(body.prev.pos, body.curr.pos, alpha);
  target.quaternion.slerpQuaternions(body.prev.rot, body.curr.rot, alpha);
}
