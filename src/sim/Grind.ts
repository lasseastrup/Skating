import { Vector3 } from 'three';
import type { SplinePath } from './surfaces/Spline';

export type GrindMaterial = 'steel' | 'concrete' | 'coping';

/** Friction per material, fraction of speed lost per second. All lower than rolling friction (0.15). */
export const GRIND_FRICTION: Record<GrindMaterial, number> = {
  steel: 0.06,
  coping: 0.09,
  concrete: 0.12,
};

const Y = new Vector3(0, 1, 0);

/**
 * A grindable edge: a spline the board locks onto. Rails, ledge edges and transition coping are
 * all the same thing with different friction and a different "up" (coping tilts the board a
 * little over the transition it belongs to).
 */
export class GrindPath {
  private readonly tmp = new Vector3();

  constructor(
    readonly id: string,
    readonly path: SplinePath,
    readonly material: GrindMaterial,
    /** Board centre sits this far above the edge along `up`. */
    readonly height: number,
    /**
     * Optional inward tilt: a point on the ground the "up" leans toward (bowl axis), or a fixed
     * direction. Null = world up.
     */
    private readonly tilt: { toward?: Vector3; dir?: Vector3; amount: number } | null = null,
  ) {}

  get friction(): number {
    return GRIND_FRICTION[this.material];
  }

  /** Up vector at a point on the path. */
  upAt(P: Vector3, out: Vector3): void {
    out.copy(Y);
    if (!this.tilt) return;
    if (this.tilt.dir) {
      out.addScaledVector(this.tilt.dir, this.tilt.amount).normalize();
    } else if (this.tilt.toward) {
      this.tmp.subVectors(this.tilt.toward, P);
      this.tmp.y = 0;
      if (this.tmp.lengthSq() > 1e-6) out.addScaledVector(this.tmp.normalize(), this.tilt.amount).normalize();
    }
  }
}
