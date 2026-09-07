import { Matrix4, Quaternion, Vector3 } from 'three';

const _x = new Vector3();
const _z = new Vector3();
const _m = new Matrix4();
const _d = new Vector3();
const _pole = new Vector3();

/**
 * Quaternion whose local +Y points along `dir` and whose local +X points as close to `front`
 * as possible. Bones are authored with +Y along the bone, +X toward their "front" (toes,
 * chest, face).
 */
export function quatFromDirFront(dir: Vector3, front: Vector3, out: Quaternion): Quaternion {
  _x.copy(front).addScaledVector(dir, -front.dot(dir));
  if (_x.lengthSq() < 1e-8) {
    // Front is parallel to the bone: pick any perpendicular.
    _x.set(dir.y, dir.z, dir.x).cross(dir);
  }
  _x.normalize();
  _z.crossVectors(_x, dir).normalize();
  _m.makeBasis(_x, dir, _z);
  return out.setFromRotationMatrix(_m);
}

/**
 * Closed-form two-bone IK (law of cosines). Given the root and a target, lengths L1 and L2,
 * and a pole direction the middle joint should bend toward, write the middle joint position.
 * Never reaches full extension (maxReach fraction), so knees and elbows never lock or invert.
 * Returns the reach fraction actually used (1 = at the limit) so callers can handle over-reach.
 */
export function solveTwoBone(
  root: Vector3,
  target: Vector3,
  L1: number,
  L2: number,
  pole: Vector3,
  maxReach: number,
  outMid: Vector3,
  outEnd: Vector3,
): number {
  _d.subVectors(target, root);
  let dist = _d.length();
  if (dist < 1e-6) {
    _d.set(0, -1, 0);
    dist = 1e-6;
  }
  _d.divideScalar(dist);
  const maxD = (L1 + L2) * maxReach;
  const minD = Math.abs(L1 - L2) + 1e-3;
  const used = dist / maxD;
  if (dist > maxD) dist = maxD;
  if (dist < minD) dist = minD;
  // Angle at the root between the chain axis and the first bone.
  let cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
  if (cosA > 1) cosA = 1;
  else if (cosA < -1) cosA = -1;
  const a = Math.acos(cosA);
  _pole.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_pole.lengthSq() < 1e-8) _pole.set(_d.y, _d.z, _d.x).cross(_d);
  _pole.normalize();
  outMid.copy(root).addScaledVector(_d, L1 * Math.cos(a)).addScaledVector(_pole, L1 * Math.sin(a));
  outEnd.copy(root).addScaledVector(_d, dist);
  return used;
}
