import type { Vector3 } from 'three';

/**
 * A vertical wall segment the skater can slam into: ledge sides, ramp caps, stair faces. Only the
 * grounded controller tests these. The Assist Charter's collision mercy lives on top of them.
 */
export interface WallSeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  yBottom: number;
  yTop: number;
  /** 'stairs' faces are steeper to clear (you land on the platform) but otherwise the same. */
  kind: 'wall' | 'stairs';
}

/**
 * Does the move from p0 to p1 (XZ) cross segment w while the board is within its height range?
 * Returns the parameter along the move (0..1) or -1.
 */
export function crossesWall(p0: Vector3, p1: Vector3, w: WallSeg): number {
  const y = Math.min(p0.y, p1.y);
  if (y > w.yTop - 0.02 || Math.max(p0.y, p1.y) < w.yBottom - 0.3) return -1;
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const ex = w.bx - w.ax;
  const ez = w.bz - w.az;
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return -1;
  const fx = w.ax - p0.x;
  const fz = w.az - p0.z;
  const t = (fx * ez - fz * ex) / den;
  const s = (fx * dz - fz * dx) / den;
  if (t < 0 || t > 1 || s < 0 || s > 1) return -1;
  return t;
}
