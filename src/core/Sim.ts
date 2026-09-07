import { Quaternion, Vector3 } from 'three';
import type { InputFrame } from './Input';

/** A transform snapshot. Bodies keep two so the renderer can interpolate between steps. */
export class TransformState {
  readonly pos = new Vector3();
  readonly rot = new Quaternion();

  copy(o: TransformState): this {
    this.pos.copy(o.pos);
    this.rot.copy(o.rot);
    return this;
  }
}

/**
 * Anything the sim moves and the renderer draws. `prev` is the state at the start of
 * the most recent step, `curr` the state at its end. The renderer displays a blend.
 */
export class KinematicBody {
  readonly prev = new TransformState();
  readonly curr = new TransformState();

  /** Call at the top of every step before integrating. */
  beginStep(): void {
    this.prev.copy(this.curr);
  }

  /** Snap both states (spawn/reset) so there is no interpolation smear. */
  teleport(): void {
    this.prev.copy(this.curr);
  }
}

/**
 * The whole simulation behind one interface. Rules:
 *  - `step` is pure with respect to (state, input, dt). No Date, no Math.random, no DOM.
 *  - `step` allocates nothing. Use Pool scratch registers.
 *  - Everything the renderer needs is reachable from `bodies`.
 */
export interface SimWorld {
  readonly bodies: readonly KinematicBody[];
  reset(): void;
  step(input: InputFrame, dt: number): void;
  /** Append live sim state to the debug key/value panel. Render-rate, may allocate strings. */
  debugReport(kv: (key: string, value: string | number) => void): void;
}

// --- Transform hashing for determinism checks ---------------------------------------------

const hashBuf = new DataView(new ArrayBuffer(8));

function mixF64(h: number, v: number): number {
  hashBuf.setFloat64(0, v);
  // FNV-1a over the two 32-bit halves, then a final avalanche. Stays in uint32.
  h ^= hashBuf.getUint32(0);
  h = Math.imul(h, 16777619) >>> 0;
  h ^= hashBuf.getUint32(4);
  h = Math.imul(h, 16777619) >>> 0;
  return h;
}

/** Bitwise-exact hash of every body's current transform. Two equal hashes ⇒ identical sim. */
export function hashWorld(world: SimWorld, h = 2166136261): number {
  const bodies = world.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const t = bodies[i].curr;
    h = mixF64(h, t.pos.x);
    h = mixF64(h, t.pos.y);
    h = mixF64(h, t.pos.z);
    h = mixF64(h, t.rot.x);
    h = mixF64(h, t.rot.y);
    h = mixF64(h, t.rot.z);
    h = mixF64(h, t.rot.w);
  }
  return h >>> 0;
}
