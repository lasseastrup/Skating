import { makeInputFrame, TouchInput } from './core/Input';
import { Loop } from './core/Loop';
import type { SimWorld } from './core/Sim';
import { SIM_DT } from './core/Time';
import { runDeterminismTest } from './debug/Determinism';
import { DebugOverlay } from './debug/Overlay';
import { CameraRig } from './render/CameraRig';
import { GameRenderer } from './render/Renderer';
import { MainScene } from './scenes/MainScene';
import { PlaygroundScene } from './scenes/PlaygroundScene';
import type { GameScene } from './scenes/SceneBase';
import { SkateWorld } from './sim/SkateWorld';

const SCENES: Record<string, () => GameScene> = {
  main: () => new MainScene(),
  playground: () => new PlaygroundScene(),
};

function boot(): void {
  const params = new URLSearchParams(location.search);
  const sceneName = params.get('scene') && SCENES[params.get('scene')!] ? params.get('scene')! : 'main';

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const gfx = new GameRenderer(canvas);
  let scene = SCENES[sceneName]();
  const rig = new CameraRig(gfx.aspect);
  window.addEventListener('resize', () => rig.setAspect(gfx.aspect));

  const overlay = new DebugOverlay(
    gfx.renderer,
    {
      runDeterminism: () => {
        const r = runDeterminismTest(makeWorld);
        return r.ok
          ? `determinism OK  ${r.steps} steps  hash ${r.hashA}  ${r.ms.toFixed(1)}ms`
          : `determinism FAIL at step ${r.firstDivergence}  ${r.hashA} ≠ ${r.hashB}`;
      },
      resetWorld: () => {
        scene.world.reset();
        scene.syncVisuals(1);
        rig.snap(scene.cameraTarget());
      },
      boost: () => (scene.world as SkateWorld).debugSetSpeed(14),
      switchScene: (name) => {
        const make = SCENES[name];
        if (!make || name === scene.name) return;
        scene.dispose();
        scene = make();
        scene.syncVisuals(1);
        rig.snap(scene.cameraTarget());
        overlay.setScene(name);
        hook.scene = scene;
      },
    },
    Object.keys(SCENES),
    sceneName,
  );
  if (params.get('debug') === '1') overlay.toggle(true);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') overlay.toggle();
  });

  const input = new TouchInput(canvas, () => overlay.toggle());
  const frame = makeInputFrame();

  const loop = new Loop({
    simStep(dt) {
      input.sample(frame);
      scene.world.step(frame, dt);
    },
    render(alpha, stats) {
      scene.syncVisuals(alpha);
      rig.update(scene.cameraTarget(), Math.min(stats.frameMs, 100) / 1000);
      gfx.render(scene.three, rig.camera);

      if (overlay.isVisible) {
        scene.world.debugReport(overlay.set);
        overlay.set('scene', scene.name);
        overlay.set('input', `${frame.stickX.toFixed(2)}, ${frame.stickY.toFixed(2)}  btn ${frame.button}`);
        const so = input.stickOrigin;
        overlay.setStick(so.id >= 0, so.x, so.y);
      }
      overlay.update(stats, performance.now());
    },
  });

  // Pause the sim when the tab is hidden so we don't burn 8 catch-up steps on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.stop();
    else loop.start();
  });

  loop.start();

  // Test hook for automated checks. Not part of the game surface.
  const hook = {
    loop,
    overlay,
    scene,
    rig,
    snapshot: () => overlay.snapshot(loop.stats),
    runDeterminism: (steps?: number, seed?: number) => runDeterminismTest(makeWorld, steps, seed),
    makeWorld,
    simDt: SIM_DT,
  };
  (window as unknown as { __coping: unknown }).__coping = hook;
}

/** Fresh world factory for determinism testing. Always the sim under test, never the display scene. */
function makeWorld(): SimWorld {
  return new SkateWorld();
}

boot();
