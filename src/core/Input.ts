/**
 * One sample of player intent, consumed by the sim once per step.
 * This is the ONLY thing the simulation is allowed to read from the outside world,
 * which is what makes replay and determinism testing possible.
 */
export interface InputFrame {
  /** Floating stick, -1..1, deadzone already applied. Right is +X, up is +Y. */
  stickX: number;
  stickY: number;
  /** 1 while the single button is held, else 0. */
  button: number;
}

export function makeInputFrame(): InputFrame {
  return { stickX: 0, stickY: 0, button: 0 };
}

export function copyInputFrame(dst: InputFrame, src: InputFrame): void {
  dst.stickX = src.stickX;
  dst.stickY = src.stickY;
  dst.button = src.button;
}

/** Anything that can fill an InputFrame. Touch/keyboard live device, or a scripted replay. */
export interface InputSource {
  sample(out: InputFrame): void;
}

const STICK_RADIUS_PX = 60;
const STICK_DEADZONE = 0.12;
const MULTI_TAP_FINGERS = 4;
const MULTI_TAP_DEBOUNCE_MS = 600;

/**
 * Live device input per the Control Scheme:
 *  - Floating stick on the left half. Origin spawns where the thumb lands.
 *  - Single button on the right half. Whole half is the hit area.
 *  - Hidden 4-finger tap for the debug overlay.
 * Keyboard (WASD/arrows + space) is a desktop dev convenience and maps onto the same frame.
 */
export class TouchInput implements InputSource {
  private stickId = -1;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private stickX = 0;
  private stickY = 0;

  private buttonId = -1;
  private buttonDown = false;

  private keys = new Set<string>();
  private lastMultiTap = 0;

  /** Debug-only read of the stick origin for the on-screen indicator. -1 when idle. */
  get stickOrigin(): { x: number; y: number; id: number } {
    return { x: this.stickOriginX, y: this.stickOriginY, id: this.stickId };
  }
  get isButtonDown(): boolean {
    return this.buttonDown || this.keys.has('Space');
  }

  constructor(
    private readonly el: HTMLElement,
    private readonly onMultiTap: () => void,
  ) {
    const opts: AddEventListenerOptions = { passive: false };
    el.addEventListener('touchstart', this.onTouchStart, opts);
    el.addEventListener('touchmove', this.onTouchMove, opts);
    el.addEventListener('touchend', this.onTouchEnd, opts);
    el.addEventListener('touchcancel', this.onTouchEnd, opts);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener('touchstart', this.onTouchStart);
    el.removeEventListener('touchmove', this.onTouchMove);
    el.removeEventListener('touchend', this.onTouchEnd);
    el.removeEventListener('touchcancel', this.onTouchEnd);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
  }

  sample(out: InputFrame): void {
    let x = this.stickX;
    let y = this.stickY;
    if (this.stickId < 0) {
      // Keyboard fallback.
      x = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      y = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
        (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    }
    out.stickX = x;
    out.stickY = y;
    out.button = this.isButtonDown ? 1 : 0;
  }

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    if (e.touches.length >= MULTI_TAP_FINGERS) {
      const now = performance.now();
      if (now - this.lastMultiTap > MULTI_TAP_DEBOUNCE_MS) {
        this.lastMultiTap = now;
        this.onMultiTap();
      }
      return;
    }
    const halfW = window.innerWidth * 0.5;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.clientX < halfW) {
        if (this.stickId < 0) {
          this.stickId = t.identifier;
          this.stickOriginX = t.clientX;
          this.stickOriginY = t.clientY;
          this.stickX = 0;
          this.stickY = 0;
        }
      } else if (this.buttonId < 0) {
        this.buttonId = t.identifier;
        this.buttonDown = true;
      }
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== this.stickId) continue;
      let dx = (t.clientX - this.stickOriginX) / STICK_RADIUS_PX;
      let dy = -(t.clientY - this.stickOriginY) / STICK_RADIUS_PX;
      let len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
        len = 1;
      }
      if (len < STICK_DEADZONE) {
        this.stickX = 0;
        this.stickY = 0;
      } else {
        // Rescale so the deadzone edge maps to 0 and the rim to 1.
        const k = (len - STICK_DEADZONE) / (1 - STICK_DEADZONE) / len;
        this.stickX = dx * k;
        this.stickY = dy * k;
      }
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const id = e.changedTouches[i].identifier;
      if (id === this.stickId) {
        this.stickId = -1;
        this.stickX = 0;
        this.stickY = 0;
      } else if (id === this.buttonId) {
        this.buttonId = -1;
        this.buttonDown = false;
      }
    }
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.stickId = -1;
    this.buttonId = -1;
    this.buttonDown = false;
    this.stickX = 0;
    this.stickY = 0;
  };
}

/**
 * Deterministic scripted input for tests. Generates a fixed pseudo-random sequence
 * from a seed (LCG, integer math) so two instances with the same seed produce
 * byte-identical frames in the same order.
 */
export class ScriptedInput implements InputSource {
  private state: number;
  private step = 0;
  private holdX = 0;
  private holdY = 0;
  private holdB = 0;

  constructor(seed = 1337) {
    this.state = seed >>> 0;
  }

  private next(): number {
    // Numerical Recipes LCG. Math.imul keeps it in 32-bit integer space.
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  sample(out: InputFrame): void {
    // Change intent every 30 steps (~250ms) so the sequence looks like thumbs, not noise.
    if (this.step % 30 === 0) {
      this.holdX = this.next() * 2 - 1;
      this.holdY = this.next() * 2 - 1;
      this.holdB = this.next() < 0.3 ? 1 : 0;
    }
    this.step++;
    out.stickX = this.holdX;
    out.stickY = this.holdY;
    out.button = this.holdB;
  }
}
