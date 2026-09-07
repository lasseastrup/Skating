import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  UnsignedByteType,
  WebGLRenderTarget,
  WebGLRenderer,
  type Camera,
  type Scene,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

/** Cap on devicePixelRatio. 3x phones render at 2x. */
const MAX_DPR = 2;
/** Render scale under the DPR cap. FXAA hides the softness; this is the biggest single perf lever. */
const RENDER_SCALE = 0.85;

/**
 * Owns the WebGLRenderer and the post chain. Phase 0 chain is:
 *   scene → 8-bit linear target → OutputPass (tonemap + sRGB) → FXAA → screen
 * MSAA is off on purpose; FXAA at 0.85 scale is the budgeted approach.
 */
export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly fxaa: FXAAPass;
  private width = 1;
  private height = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    const r = this.renderer;
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    // We count draw calls across the whole post chain, so reset manually per frame.
    r.info.autoReset = false;

    // 8-bit target: half the bandwidth of HalfFloat. Toon bands don't need the precision.
    const target = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: true, stencilBuffer: false });
    this.composer = new EffectComposer(r, target);
    this.renderPass = new RenderPass(undefined as unknown as Scene, undefined as unknown as Camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new OutputPass());
    this.fxaa = new FXAAPass();
    this.composer.addPass(this.fxaa);

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.composer.dispose();
    this.renderer.dispose();
  }

  get pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, MAX_DPR) * RENDER_SCALE;
  }

  resize = (): void => {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
    // FXAAPass.setSize expects the pass resolution in device pixels; EffectComposer gives it CSS
    // pixels times pixel ratio, which is correct, but make sure it happened after the ratio change.
    this.fxaa.setSize(this.width * pr, this.height * pr);
  };

  get aspect(): number {
    return this.width / this.height;
  }

  render(scene: Scene, camera: Camera): void {
    this.renderer.info.reset();
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render();
  }
}
