import type { WebGLRenderer } from 'three';
import type { LoopStats } from '../core/Loop';
import { BUDGET_DRAW_CALLS, BUDGET_FRAME_MS, BUDGET_TRIANGLES } from '../core/Time';

const GRAPH_W = 240;
const GRAPH_H = 64;
const GRAPH_MAX_MS = 40;
const HISTORY = 120;
const TEXT_HZ = 10;

const COLOR_OK = '#4ade80';
const COLOR_WARN = '#facc15';
const COLOR_BAD = '#f87171';

export interface OverlayActions {
  runDeterminism(): string;
  resetWorld(): void;
  /** Debug: set speed to the top of the range, to test the camera without a hill. */
  boost(): void;
  switchScene(name: string): void;
}

/**
 * Debug overlay. Frame time graph, sim/render counters, draw calls, triangles, and a
 * key/value panel that later phases append to (speed, surface id, tangent frame, grounded/air,
 * energy...). Hidden by default; toggled by a 4-finger tap, the backquote key, or ?debug=1.
 *
 * DOM writes are throttled to TEXT_HZ. The graph canvas redraws every frame (cheap, 2D).
 */
export class DebugOverlay {
  readonly root: HTMLDivElement;
  private readonly graph: HTMLCanvasElement;
  private readonly gctx: CanvasRenderingContext2D;
  private readonly statsEl: HTMLPreElement;
  private readonly kvEl: HTMLPreElement;
  private readonly resultEl: HTMLDivElement;
  private readonly stickRing: HTMLDivElement;

  private readonly history = new Float32Array(HISTORY);
  private head = 0;
  private lastText = 0;
  private visible = false;

  private readonly kv = new Map<string, string | number>();
  private readonly sceneButtons = new Map<string, HTMLButtonElement>();
  private frameAcc = 0;
  private frameMax = 0;
  private frameN = 0;
  private avgMs = 0;
  private maxMs = 0;

  /** Bound setter, hand this to sims so they can report. */
  readonly set = (key: string, value: string | number): void => {
    this.kv.set(key, value);
  };

  constructor(
    private readonly renderer: WebGLRenderer,
    actions: OverlayActions,
    scenes: readonly string[],
    currentScene: string,
  ) {
    const root = (this.root = document.createElement('div'));
    root.id = 'debug-overlay';
    root.style.cssText = [
      'position:fixed;top:0;left:0;z-index:1000',
      'padding:calc(env(safe-area-inset-top,0px) + 6px) 8px 8px calc(env(safe-area-inset-left,0px) + 8px)',
      'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#e5e5e5',
      'background:rgba(0,0,0,.55);border-bottom-right-radius:8px',
      'pointer-events:none;user-select:none;display:none',
    ].join(';');

    this.graph = document.createElement('canvas');
    this.graph.width = GRAPH_W;
    this.graph.height = GRAPH_H;
    this.graph.style.cssText = `display:block;width:${GRAPH_W}px;height:${GRAPH_H}px;background:rgba(0,0,0,.35)`;
    root.appendChild(this.graph);
    this.gctx = this.graph.getContext('2d')!;

    this.statsEl = document.createElement('pre');
    this.statsEl.style.cssText = 'margin:6px 0 0;white-space:pre';
    root.appendChild(this.statsEl);

    this.kvEl = document.createElement('pre');
    this.kvEl.style.cssText = 'margin:6px 0 0;white-space:pre;color:#93c5fd';
    root.appendChild(this.kvEl);

    const bar = document.createElement('div');
    bar.style.cssText = 'margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;pointer-events:auto';
    const btn = (label: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText =
        'font:inherit;padding:6px 8px;background:#333;color:#eee;border:1px solid #555;border-radius:4px;touch-action:manipulation';
      b.addEventListener('click', fn);
      bar.appendChild(b);
      return b;
    };
    btn('determinism', () => {
      this.resultEl.textContent = actions.runDeterminism();
    });
    btn('reset', () => actions.resetWorld());
    btn('boost 14', () => actions.boost());
    for (const s of scenes) {
      const b = btn(`${s}`, () => actions.switchScene(s));
      this.sceneButtons.set(s, b);
    }
    root.appendChild(bar);
    this.setScene(currentScene);

    this.resultEl = document.createElement('div');
    this.resultEl.style.cssText = 'margin-top:4px;white-space:pre;color:#fde68a';
    root.appendChild(this.resultEl);

    // Floating stick indicator. Debug only: the shipping game shows no stick base.
    this.stickRing = document.createElement('div');
    this.stickRing.style.cssText =
      'position:fixed;width:120px;height:120px;margin:-60px 0 0 -60px;border:2px solid rgba(255,255,255,.35);border-radius:50%;pointer-events:none;display:none;z-index:999';
    document.body.appendChild(this.stickRing);
    document.body.appendChild(root);
  }

  /** Highlight the active scene button. */
  setScene(name: string): void {
    for (const [s, b] of this.sceneButtons) {
      b.style.background = s === name ? '#2563eb' : '#333';
    }
  }

  get isVisible(): boolean {
    return this.visible;
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
    if (!this.visible) this.stickRing.style.display = 'none';
  }

  setStick(active: boolean, x: number, y: number): void {
    if (!this.visible) return;
    this.stickRing.style.display = active ? 'block' : 'none';
    if (active) {
      this.stickRing.style.left = `${x}px`;
      this.stickRing.style.top = `${y}px`;
    }
  }

  /** Call once per render frame after the scene has been drawn. */
  update(stats: LoopStats, now: number): void {
    const ms = stats.frameMs;
    this.history[this.head] = ms;
    this.head = (this.head + 1) % HISTORY;
    this.frameAcc += ms;
    this.frameN++;
    if (ms > this.frameMax) this.frameMax = ms;

    if (!this.visible) return;
    this.drawGraph();

    if (now - this.lastText < 1000 / TEXT_HZ) return;
    this.lastText = now;
    this.avgMs = this.frameN ? this.frameAcc / this.frameN : 0;
    this.maxMs = this.frameMax;
    this.frameAcc = 0;
    this.frameN = 0;
    this.frameMax = 0;

    const info = this.renderer.info;
    const calls = info.render.calls;
    const tris = info.render.triangles;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const lines = [
      `frame ${this.avgMs.toFixed(1)}ms avg  ${this.maxMs.toFixed(1)}ms max  (${(1000 / Math.max(this.avgMs, 0.01)).toFixed(0)} fps)`,
      `sim   ${stats.simMs.toFixed(2)}ms  ${stats.simStepsThisFrame} steps/frame  total ${stats.simStepsTotal}  dropped ${stats.droppedSteps}`,
      `draw  ${stats.renderMs.toFixed(2)}ms  frames ${stats.renderFramesTotal}  alpha ${stats.alpha.toFixed(2)}`,
      `calls ${calls}/${BUDGET_DRAW_CALLS}  tris ${(tris / 1000).toFixed(1)}k/${BUDGET_TRIANGLES / 1000}k  geo ${info.memory.geometries}  tex ${info.memory.textures}  prog ${info.programs?.length ?? 0}`,
      heap ? `heap  ${(heap.usedJSHeapSize / 1048576).toFixed(1)}MB` : 'heap  n/a',
    ];
    this.statsEl.textContent = lines.join('\n');
    this.statsEl.style.color = this.avgMs > 16.7 || calls > BUDGET_DRAW_CALLS || tris > BUDGET_TRIANGLES
      ? COLOR_BAD
      : this.avgMs > BUDGET_FRAME_MS
        ? COLOR_WARN
        : '#e5e5e5';

    let kvText = '';
    for (const [k, v] of this.kv) kvText += `${k.padEnd(10)} ${v}\n`;
    this.kvEl.textContent = kvText;
  }

  private drawGraph(): void {
    const c = this.gctx;
    c.clearRect(0, 0, GRAPH_W, GRAPH_H);
    const barW = GRAPH_W / HISTORY;
    const scale = GRAPH_H / GRAPH_MAX_MS;
    for (let i = 0; i < HISTORY; i++) {
      const ms = this.history[(this.head + i) % HISTORY];
      const h = Math.min(GRAPH_H, ms * scale);
      c.fillStyle = ms <= BUDGET_FRAME_MS ? COLOR_OK : ms <= 16.7 ? COLOR_WARN : COLOR_BAD;
      c.fillRect(i * barW, GRAPH_H - h, barW, h);
    }
    // Budget lines: 14ms (Pixel 6a budget) and 16.7ms (60Hz).
    c.fillStyle = 'rgba(255,255,255,.5)';
    c.fillRect(0, GRAPH_H - BUDGET_FRAME_MS * scale, GRAPH_W, 1);
    c.fillStyle = 'rgba(255,255,255,.25)';
    c.fillRect(0, GRAPH_H - 16.7 * scale, GRAPH_W, 1);
  }

  /** Snapshot for automated checks (perf script). Allocates; never call from the hot path. */
  snapshot(stats: LoopStats): Record<string, number> {
    const info = this.renderer.info;
    return {
      frameMsAvg: this.avgMs,
      frameMsMax: this.maxMs,
      simMs: stats.simMs,
      renderMs: stats.renderMs,
      simStepsTotal: stats.simStepsTotal,
      renderFramesTotal: stats.renderFramesTotal,
      droppedSteps: stats.droppedSteps,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
    };
  }
}
