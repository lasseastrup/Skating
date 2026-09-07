import { makeInputFrame, ScriptedInput } from '../core/Input';
import { hashWorld, type SimWorld } from '../core/Sim';
import { SIM_DT } from '../core/Time';

export interface DeterminismResult {
  ok: boolean;
  steps: number;
  hashA: string;
  hashB: string;
  /** First step index where the two runs diverged, or -1. */
  firstDivergence: number;
  ms: number;
}

function runOnce(world: SimWorld, seed: number, out: Uint32Array): number {
  const input = new ScriptedInput(seed);
  const frame = makeInputFrame();
  let h = 0;
  for (let i = 0; i < out.length; i++) {
    input.sample(frame);
    world.step(frame, SIM_DT);
    h = hashWorld(world, h);
    out[i] = h;
  }
  return h;
}

/**
 * Run the same scripted input sequence through two fresh worlds, one after the other, and
 * compare the running transform hash after every step. Any divergence means hidden state,
 * wall-clock, or randomness leaked into the sim.
 */
export function runDeterminismTest(makeWorld: () => SimWorld, steps = 2400, seed = 1337): DeterminismResult {
  const t0 = performance.now();
  const hashesA = new Uint32Array(steps);
  const hashesB = new Uint32Array(steps);
  const hashA = runOnce(makeWorld(), seed, hashesA);
  const hashB = runOnce(makeWorld(), seed, hashesB);

  let firstDivergence = -1;
  for (let i = 0; i < steps; i++) {
    if (hashesA[i] !== hashesB[i]) {
      firstDivergence = i;
      break;
    }
  }
  return {
    ok: firstDivergence < 0,
    steps,
    hashA: hashA.toString(16).padStart(8, '0'),
    hashB: hashB.toString(16).padStart(8, '0'),
    firstDivergence,
    ms: performance.now() - t0,
  };
}
