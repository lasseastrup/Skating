import { Vector3 } from 'three';
import { ProjectResult, type RideSurface } from '../Surface';

const MAX_CANDIDATES = 24;

/**
 * A zone's ride surfaces with declared adjacency and a coarse spatial hash of their AABBs.
 * Grounded, the skater tests only its current surface and that surface's declared neighbours.
 * Airborne, it asks the hash for everything under it.
 */
export class Compound {
  readonly surfaces: RideSurface[] = [];
  readonly neighbours: number[][] = [];
  /** Preallocated projection results, one per candidate slot. */
  readonly results: ProjectResult[] = [];
  private readonly cellSize: number;
  private readonly hash = new Map<number, number[]>();
  private readonly stamp: Int32Array;
  private stampValue = 0;
  private built = false;

  constructor(cellSize = 4) {
    this.cellSize = cellSize;
    for (let i = 0; i < MAX_CANDIDATES; i++) this.results.push(new ProjectResult(new Vector3(), new Vector3()));
    this.stamp = new Int32Array(1024);
  }

  add(s: RideSurface): number {
    if (this.built) throw new Error('Compound already built');
    this.surfaces.push(s);
    this.neighbours.push([]);
    return this.surfaces.length - 1;
  }

  /** Declare that a skater may roll directly between a and b (they share an edge). */
  connect(a: number, b: number): void {
    if (!this.neighbours[a].includes(b)) this.neighbours[a].push(b);
    if (!this.neighbours[b].includes(a)) this.neighbours[b].push(a);
  }

  byId(id: string): number {
    return this.surfaces.findIndex((s) => s.id === id);
  }

  build(): void {
    const cs = this.cellSize;
    for (let i = 0; i < this.surfaces.length; i++) {
      const b = this.surfaces[i].aabb;
      const x0 = Math.floor(b.min.x / cs);
      const x1 = Math.floor(b.max.x / cs);
      const z0 = Math.floor(b.min.z / cs);
      const z1 = Math.floor(b.max.z / cs);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = this.key(x, z);
          let list = this.hash.get(key);
          if (!list) {
            list = [];
            this.hash.set(key, list);
          }
          list.push(i);
        }
      }
    }
    this.built = true;
  }

  private key(x: number, z: number): number {
    return (x + 32768) * 65536 + (z + 32768);
  }

  /**
   * Broadphase: indices of surfaces whose AABB covers the cell containing p (and its 8
   * neighbours). Writes into `out`, returns the count. No allocation.
   */
  query(p: Vector3, out: Int32Array): number {
    const cs = this.cellSize;
    const cx = Math.floor(p.x / cs);
    const cz = Math.floor(p.z / cs);
    this.stampValue++;
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.hash.get(this.key(cx + dx, cz + dz));
        if (!list) continue;
        for (let i = 0; i < list.length && n < out.length; i++) {
          const idx = list[i];
          if (this.stamp[idx] === this.stampValue) continue;
          this.stamp[idx] = this.stampValue;
          if (!this.surfaces[idx].aabb.containsPoint(p) && this.surfaces[idx].aabb.distanceToPoint(p) > 1.0) continue;
          out[n++] = idx;
        }
      }
    }
    return n;
  }

  /** Project p onto surface `idx` into result slot `slot`. */
  project(idx: number, p: Vector3, slot: number): ProjectResult {
    const r = this.results[slot];
    this.surfaces[idx].project(p, r);
    r.surface = idx;
    return r;
  }
}
