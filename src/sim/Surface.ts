import type { Box3, Vector3 } from 'three';

/**
 * Result of projecting a point onto a bounded analytic surface. Preallocated by the caller;
 * `project` never allocates.
 */
export class ProjectResult {
  /** Closest point on the bounded surface. */
  readonly point: Vector3;
  /** Surface normal at `point`, pointing toward the side the skater rides on. */
  readonly normal: Vector3;
  /** Parametric coordinates of `point` (primitive-specific). */
  u = 0;
  v = 0;
  /** Signed height of the query point above the surface along the normal. Negative = inside the concrete. */
  h = 0;
  /**
   * Distance (metres, approximately) from the *unclamped* projection to the nearest parametric
   * edge. Positive = inside the primitive's bounds, negative = past an edge. Drives handoff.
   */
  margin = 0;
  /** Index of the surface this result came from, set by Compound. */
  surface = -1;

  constructor(point: Vector3, normal: Vector3) {
    this.point = point;
    this.normal = normal;
  }
}

/**
 * A ride surface answers two questions exactly: where is the closest point on me and what is
 * the normal there; and how curved am I along a given tangent direction. Never triangle soup.
 */
export interface RideSurface {
  readonly id: string;
  readonly aabb: Box3;
  project(p: Vector3, out: ProjectResult): void;
  /**
   * Normal curvature (1/m) at (u, v) along unit tangent direction `dir`.
   * Positive = concave (centre of curvature on the normal side: bowls, transitions).
   * Negative = convex (humps, spines' outer faces). Zero on planes.
   */
  curvature(u: number, v: number, dir: Vector3): number;
}
