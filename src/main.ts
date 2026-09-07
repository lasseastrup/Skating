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
import { buildIslandPark, ISLAND } from './sim/ParkLayout';
import { buildPlaygroundPark, PLAYGROUND } from './sim/Playground';
import { SkateWorld } from './sim/SkateWorld';
import { TUNING } from './sim/Tuning';

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
        scene.syncVisuals(1, 1 / 60);
        rig.snap(scene.cameraTarget());
      },
      boost: () => (scene.world as SkateWorld).debugSetSpeed(14),
      cycleCharacterHz: () => {
        const rates = [8, 12, 15, 24, 0];
        const sk = (scene as unknown as { skater: { characterHz: number } }).skater;
        sk.characterHz = rates[(rates.indexOf(sk.characterHz) + 1) % rates.length];
        return sk.characterHz === 0 ? 'every frame' : `${sk.characterHz} fps`;
      },
      switchScene: (name) => {
        const make = SCENES[name];
        if (!make || name === scene.name) return;
        scene.dispose();
        scene = make();
        scene.syncVisuals(1, 1 / 60);
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
      const dt = Math.min(stats.frameMs, 100) / 1000;
      scene.syncVisuals(alpha, dt);
      rig.update(scene.cameraTarget(), dt);
      gfx.render(scene.three, rig.camera);

      if (overlay.isVisible) {
        scene.world.debugReport(overlay.set);
        overlay.set('scene', scene.name);
        overlay.set('charHz', (scene as unknown as { skater: { characterHz: number } }).skater.characterHz || 'display');
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
    makePlaygroundWorld,
    simDt: SIM_DT,
    input,
    frame,
    tuning: TUNING as Record<string, number>,
  };
  (window as unknown as { __coping: unknown }).__coping = hook;
}

/** Fresh world factory for determinism testing: the full island manifold, no display. */
function makeWorld(): SimWorld {
  return new SkateWorld(buildIslandPark().builder.compound, ISLAND.spawn);
}

/** The playground world, for the test bench scripts. */
function makePlaygroundWorld(): SimWorld {
  return new SkateWorld(buildPlaygroundPark().builder.compound, PLAYGROUND.spawn);
}

boot();
