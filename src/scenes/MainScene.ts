import { BoxGeometry, Mesh, Scene, Vector3 } from 'three';
import { applyInterpolated } from '../core/Interp';
import { StubWorld } from '../sim/StubWorld';
import { buildGround, buildLighting, GREY_HERO, type GameScene } from './SceneBase';

const SUN_OFFSET = new Vector3(18, 30, 12);

/** The game scene. Phase 0: a grey box on a grey plane. The real park arrives in Phase 7. */
export class MainScene implements GameScene {
  readonly name = 'main';
  readonly three = new Scene();
  readonly world = new StubWorld();
  private readonly boxMesh: Mesh;
  private readonly sun;

  constructor() {
    this.sun = buildLighting(this.three, 12);
    buildGround(this.three, 200);
    this.world.bounds = 95;

    this.boxMesh = new Mesh(new BoxGeometry(1, 1, 1), GREY_HERO);
    this.boxMesh.castShadow = true;
    this.boxMesh.receiveShadow = true;
    this.three.add(this.boxMesh);
  }

  syncVisuals(alpha: number): void {
    applyInterpolated(this.world.box, this.boxMesh, alpha);
    // Keep the single shadow frustum centred on the hero.
    this.sun.target.position.copy(this.boxMesh.position);
    this.sun.position.copy(this.boxMesh.position).add(SUN_OFFSET);
  }

  cameraTarget(): { pos: Vector3; heading: number } {
    return { pos: this.boxMesh.position, heading: this.world.heading };
  }

  dispose(): void {
    this.boxMesh.geometry.dispose();
  }
}
