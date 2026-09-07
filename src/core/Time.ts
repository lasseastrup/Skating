/** Simulation runs at a fixed 120Hz regardless of display rate. */
export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;

/**
 * If the browser stalls (tab hidden, GC pause), never try to catch up more than
 * this many steps in a single frame. Excess time is dropped, not simulated.
 */
export const MAX_STEPS_PER_FRAME = 8;

/** Frame deltas above this are treated as a stall and clamped. */
export const MAX_FRAME_DT = 0.25;

/** Perf budget constants (from the Constitution). Overlay colours against these. */
export const BUDGET_FRAME_MS = 14;
export const BUDGET_DRAW_CALLS = 80;
export const BUDGET_TRIANGLES = 120_000;
