import type { Vector3 } from 'three';

/**
 * A ride surface answers one question: for a point in space, where is the closest point on me
 * and what is the normal there. Phase 1 has only the plane. Phase 2 adds cylinder, torus, spline
 * and compound primitives behind this same interface. Never triangle soup.
 */
export interface RideSurface {
  readonly id: string;
  project(p: Vector3, outPoint: Vector3, outNormal: Vector3): void;
}

/** Infinite horizontal plane at a fixed height. */
export class PlaneSurface implements RideSurface {
  readonly id = 'plane';
  constructor(readonly height = 0) {}

  project(p: Vector3, outPoint: Vector3, outNormal: Vector3): void {
    outPoint.set(p.x, this.height, p.z);
    outNormal.set(0, 1, 0);
  }
}
