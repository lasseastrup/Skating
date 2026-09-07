import { Scene, Vector3 } from 'three';
import type { CameraTarget } from '../render/CameraRig';
import { SkaterPlaceholder } from '../render/SkaterPlaceholder';
import { SkateWorld } from '../sim/SkateWorld';
import { buildGround, buildLighting, type GameScene } from './SceneBase';

const SUN_OFFSET = new Vector3(18, 30, 12);

/** The game scene. Phase 1: a skater on an endless grey plane. The park arrives in Phase 7. */
export class MainScene implements GameScene {
  readonly name = 'main';
  readonly three = new Scene();
  readonly world = new SkateWorld();
  private readonly skater: SkaterPlaceholder;
  private readonly sun;
  private readonly target: CameraTarget;

  constructor() {
    this.sun = buildLighting(this.three, 12);
    buildGround(this.three, 400);
    this.skater = new SkaterPlaceholder(this.world);
    this.three.add(this.skater.group);
    this.target = {
      pos: this.skater.board.position,
      forward: this.world.tangent,
      up: this.world.normal,
      speed: 0,
      lean: 0,
    };
  }

  syncVisuals(alpha: number): void {
    this.skater.sync(alpha);
    this.sun.target.position.copy(this.skater.board.position);
    this.sun.position.copy(this.skater.board.position).add(SUN_OFFSET);
  }

  cameraTarget(): CameraTarget {
    this.target.speed = this.world.speed;
    this.target.lean = this.world.lean;
    return this.target;
  }

  dispose(): void {
    this.skater.dispose();
  }
}
