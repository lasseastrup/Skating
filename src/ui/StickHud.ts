/**
 * Always-on control feedback. The Control Scheme's floating stick has no visible base until
 * touched; this draws that base where the thumb landed, a knob at the live stick vector, and a
 * pill on the right half while the button is held. A one-line readout underneath shows the
 * exact values the sim receives and how many touch events the page has seen, so "is my input
 * arriving?" can be answered on the device without the debug overlay.
 */
import type { InputFrame } from '../core/Input';

const RADIUS = 60;

export class StickHud {
  private readonly root: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly button: HTMLDivElement;
  private readonly readout: HTMLDivElement;
  private touches = 0;
  private lastText = '';

  constructor(parent: HTMLElement, listenOn: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;';
    this.base = this.el(
      `width:${RADIUS * 2}px;height:${RADIUS * 2}px;border-radius:50%;border:2px solid rgba(255,255,255,.55);background:rgba(255,255,255,.08);box-sizing:border-box;`,
    );
    this.knob = this.el('width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 2px 8px rgba(0,0,0,.35);');
    this.button = this.el(
      'right:18px;bottom:calc(env(safe-area-inset-bottom,0px) + 60px);width:70px;height:70px;border-radius:50%;border:2px solid rgba(255,255,255,.55);background:rgba(255,255,255,.08);box-sizing:border-box;',
    );
    this.readout = this.el(
      'left:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 8px);font:600 11px/1.3 ui-monospace,Menlo,Consolas,monospace;color:rgba(255,255,255,.85);text-shadow:0 1px 2px rgba(0,0,0,.6);white-space:pre;',
    );
    this.base.hidden = true;
    this.knob.hidden = true;
    this.button.style.display = 'block';
    parent.appendChild(this.root);
    const count = (): void => {
      this.touches++;
    };
    listenOn.addEventListener('touchstart', count, { passive: true });
    listenOn.addEventListener('touchmove', count, { passive: true });
  }

  private el(css: string): HTMLDivElement {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;${css}`;
    this.root.appendChild(d);
    return d;
  }

  update(frame: InputFrame, stick: { x: number; y: number; id: number }, buttonDown: boolean): void {
    const active = stick.id >= 0;
    this.base.hidden = !active;
    this.knob.hidden = !active;
    if (active) {
      this.base.style.transform = `translate(${stick.x - RADIUS}px, ${stick.y - RADIUS}px)`;
      const kx = stick.x + frame.stickX * RADIUS - 22;
      const ky = stick.y - frame.stickY * RADIUS - 22;
      this.knob.style.transform = `translate(${kx}px, ${ky}px)`;
    }
    this.button.style.background = buttonDown ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.08)';
    const text = `stick ${frame.stickX >= 0 ? ' ' : ''}${frame.stickX.toFixed(2)} ${frame.stickY >= 0 ? ' ' : ''}${frame.stickY.toFixed(2)}  btn ${frame.button}  touches ${this.touches}`;
    if (text !== this.lastText) {
      this.lastText = text;
      this.readout.textContent = text;
    }
  }
}
