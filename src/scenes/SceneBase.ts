import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  PlaneGeometry,
  Scene,
  Vector3,
} from 'three';
import { clouds, LEVEL_MAT, paintFlat, PALETTE, skyDome } from '../render/Toon';
import type { SimWorld } from '../core/Sim';
import type { CameraTarget } from '../render/CameraRig';
import { SkateState, type SkateWorld } from '../sim/SkateWorld';
import { TUNING as T } from '../sim/Tuning';


export interface GameScene {
  readonly name: string;
  readonly three: Scene;
  readonly world: SimWorld;
  /** Push interpolated sim state into display objects. Called once per render frame. */
  syncVisuals(alpha: number, dt: number): void;
  /** What the camera follows: the displayed board, its frame, speed and lean. */
  cameraTarget(): CameraTarget;
  dispose(): void;
}

/** Sun direction. Low (24° elevation) for the long, exaggerated shadows of the brief. */
export const SUN_OFFSET = new Vector3(30, 16, 20);

/**
 * One directional light with a single 1024 shadow map, a sky/ground hemisphere fill, the sky dome
 * and four clouds. That's the whole lighting budget.
 */
export function buildLighting(scene: Scene, shadowRadius: number): DirectionalLight {
  scene.background = new Color(PALETTE.skyHorizon);
  scene.fog = new Fog(PALETTE.skyHorizon, 70, 190);
  scene.add(skyDome(240));
  scene.add(clouds(new Vector3(20, 0, 15)));

  const hemi = new HemisphereLight(0xbfd6f0, 0x6b6357, 0.75);
  scene.add(hemi);
  scene.add(new AmbientLight(0xffffff, 0.12));

  const sun = new DirectionalLight(0xfff2dc, 2.4);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const cam = sun.shadow.camera;
  cam.near = 2;
  cam.far = 90;
  cam.left = -shadowRadius;
  cam.right = shadowRadius;
  cam.top = shadowRadius;
  cam.bottom = -shadowRadius;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  return sun;
}

export function buildGround(scene: Scene, size: number): Mesh {
  const g = new PlaneGeometry(size, size, 1, 1);
  g.rotateX(-Math.PI / 2);
  const m = new Mesh(paintFlat(g, PALETTE.concrete), LEVEL_MAT);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

/** Fill the per-frame camera target fields from the sim: travel velocity, mode and floor reference. */
export function fillCameraTarget(t: CameraTarget, w: SkateWorld): void {
  t.speed = w.speed;
  t.lean = w.lean;
  if (w.state === SkateState.Air || w.state === SkateState.Pop) {
    t.vel.copy(w.vel);
    t.mode = 'air';
  } else {
    t.vel.copy(w.tangent).multiplyScalar(w.speed);
    t.mode = w.state === SkateState.Grinding ? 'grind' : w.state === SkateState.Bailed ? 'bail' : 'ride';
    // Reference floor: the last roughly level ground the skater stood on. Walls and steep
    // transitions do not count, so the camera stays at the bottom of a ramp and pitches up
    // instead of climbing the wall with the skater.
    if (w.normal.y > 0.8) t.floorY = w.pos.y - T.rideHeight;
  }
}
