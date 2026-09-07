import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  Vector3,
  PlaneGeometry,
  Scene,
} from 'three';
import type { SimWorld } from '../core/Sim';

/** Shared palette. Grey on grey, per Phase 0: no art yet. */
export const GREY_GROUND = new MeshLambertMaterial({ color: 0x6e6e6e });
export const GREY_PROP = new MeshLambertMaterial({ color: 0x8a8a8a });
export const GREY_HERO = new MeshLambertMaterial({ color: 0xb0b0b0 });
export const DARK_PROP = new MeshLambertMaterial({ color: 0x555555 });

export interface GameScene {
  readonly name: string;
  readonly three: Scene;
  readonly world: SimWorld;
  /** Push interpolated sim state into display objects. Called once per render frame. */
  syncVisuals(alpha: number): void;
  /** World-space position + heading the camera should follow. */
  cameraTarget(): { pos: Vector3; heading: number };
  dispose(): void;
}

/** One directional light with a single 1024 shadow map, one fill. That's the whole budget. */
export function buildLighting(scene: Scene, shadowRadius: number): DirectionalLight {
  scene.background = new Color(0x5a5a5a);
  scene.fog = new Fog(0x5a5a5a, 60, 160);

  const hemi = new HemisphereLight(0x9a9a9a, 0x3a3a3a, 0.9);
  scene.add(hemi);
  scene.add(new AmbientLight(0xffffff, 0.15));

  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(18, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const cam = sun.shadow.camera;
  cam.near = 5;
  cam.far = 80;
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
  const m = new Mesh(g, GREY_GROUND);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
