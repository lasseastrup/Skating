import { MAX_FRAME_DT, MAX_STEPS_PER_FRAME, SIM_DT } from './Time';

/** Live counters, mutated in place every frame. The overlay reads these; nothing allocates. */
export class LoopStats {
  /** Wall-clock time between the last two frames, ms. */
  frameMs = 0;
  /** Sim steps executed during the last frame. */
  simStepsThisFrame = 0;
  /** Steps dropped because the frame was too far behind. */
  droppedSteps = 0;
  simStepsTotal = 0;
  renderFramesTotal = 0;
  /** Interpolation factor used for the last render, 0..1. */
  alpha = 0;
  /** Time spent inside sim steps during the last frame, ms. */
  simMs = 0;
  /** Time spent inside render during the last frame, ms. */
  renderMs = 0;
  /** Simulated time, seconds. Advances only by SIM_DT multiples. */
  simTime = 0;
}

export interface LoopHooks {
  /** Called once per sim step. Must not allocate. */
  simStep(dt: number): void;
  /** Called once per display frame with the interpolation factor. */
  render(alpha: number, stats: LoopStats): void;
}

/**
 * Fixed-timestep accumulator loop. Sim ticks at exactly SIM_DT; rendering happens at
 * whatever rate requestAnimationFrame gives us and interpolates between the two most
 * recent sim states using `alpha`.
 */
export class Loop {
  readonly stats = new LoopStats();
  private accumulator = 0;
  private lastTime = -1;
  private rafId = 0;
  private running = false;
  /** Juice: sim time scale (dilation) and a frozen-frame hitch, both in wall seconds. */
  private timeScale = 1;
  private dilateLeft = 0;
  private hitchLeft = 0;

  /** Freeze the sim for `seconds` of wall time (the frame hitch on a hard landing). */
  hitch(seconds: number): void {
    this.hitchLeft = Math.max(this.hitchLeft, seconds);
  }

  /** Run the sim at `scale` × real time for `seconds` of wall time. */
  dilate(scale: number, seconds: number): void {
    this.timeScale = scale;
    this.dilateLeft = seconds;
  }

  constructor(private readonly hooks: LoopHooks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = -1;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const s = this.stats;
    if (this.lastTime < 0) this.lastTime = now;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    s.frameMs = dt * 1000;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    if (this.hitchLeft > 0) {
      this.hitchLeft -= dt;
      dt = 0;
    } else if (this.dilateLeft > 0) {
      this.dilateLeft -= dt;
      dt *= this.timeScale;
      if (this.dilateLeft <= 0) this.timeScale = 1;
    }
    this.accumulator += dt;

    // --- simulate ---
    const t0 = performance.now();
    let steps = 0;
    while (this.accumulator >= SIM_DT) {
      if (steps >= MAX_STEPS_PER_FRAME) {
        // Drop the remainder rather than spiral. Keep the fractional part for smoothness.
        const dropped = Math.floor(this.accumulator / SIM_DT);
        s.droppedSteps += dropped;
        this.accumulator -= dropped * SIM_DT;
        break;
      }
      this.hooks.simStep(SIM_DT);
      this.accumulator -= SIM_DT;
      s.simTime += SIM_DT;
      steps++;
    }
    s.simStepsThisFrame = steps;
    s.simStepsTotal += steps;
    const t1 = performance.now();
    s.simMs = t1 - t0;

    // --- render ---
    const alpha = this.accumulator / SIM_DT;
    s.alpha = alpha;
    this.hooks.render(alpha, s);
    s.renderFramesTotal++;
    s.renderMs = performance.now() - t1;
  };
}
