import { Fog, Scene, Vector3, type Mesh } from 'three';
import type { CameraTarget } from '../render/CameraRig';
import { fillCameraTarget } from './SceneBase';
import { SkaterRig } from '../render/rig/SkaterRig';
import { buildIslandPark, ISLAND } from '../sim/ParkLayout';
import { SkateWorld } from '../sim/SkateWorld';
import type { PlaneSurface } from '../sim/surfaces/Plane';
import { bowlRoomMeshes, boxMesh, groundGridMesh, kickerMesh, platformMeshes, quarterPipeMesh, rollerMesh, sunkenBankMeshes, troughCapMesh, troughMesh } from './FeatureMeshes';
import { buildLighting, type GameScene } from './SceneBase';

const SUN_OFFSET = new Vector3(18, 30, 12);

/** The game: one continuous, loopable island. Surfaces from `buildIslandPark()`, meshes fitted here. */
export class MainScene implements GameScene {
  readonly name = 'main';
  readonly three = new Scene();
  readonly world: SkateWorld;
  readonly skater: SkaterRig;
  private readonly sun;
  private readonly owned: Mesh[] = [];
  private readonly target: CameraTarget;

  constructor() {
    const park = buildIslandPark();
    const b = park.builder;
    this.world = new SkateWorld(b.compound, ISLAND.spawn);
    this.sun = buildLighting(this.three, 16);
    this.three.fog = new Fog(0x5a5a5a, 90, 220);

    const add = (m: Mesh | Mesh[]) => {
      for (const x of Array.isArray(m) ? m : [m]) {
        this.three.add(x);
        this.owned.push(x);
      }
    };
    add(groundGridMesh(b.compound.surfaces[b.ground] as PlaneSurface, ISLAND.groundHalfSize));
    for (const q of park.quarterPipes) add(quarterPipeMesh(q));
    for (const l of ISLAND.ledges) add(boxMesh(l));
    add(boxMesh(ISLAND.manualPad));
    for (const k of ISLAND.kickers) add(kickerMesh(k));
    add(platformMeshes(ISLAND.platform));
    for (const t of b.troughs) add(troughMesh(t));
    const ri = ISLAND.rollIn;
    add(sunkenBankMeshes(ri.x0, 0, ri.x1, -ri.depth, ri.z0, ri.z1));
    add(troughCapMesh(b.troughs[0], ri.z0, ri.z1, -ri.depth));
    add(bowlRoomMeshes(ISLAND.shallow));
    add(bowlRoomMeshes(ISLAND.deep));
    const bk = ISLAND.bowlBank;
    add(sunkenBankMeshes(bk.x0, bk.y0, bk.x1, bk.y1, bk.z0, bk.z1, ISLAND.bowlBankSides.x0, ISLAND.bowlBankSides.x1));
    for (const r of ISLAND.rollers) add(rollerMesh(r));

    this.skater = new SkaterRig(this.world);
    this.three.add(this.skater.group);
    this.target = { pos: this.skater.board.position, forward: this.world.tangent, up: this.world.normal, vel: new Vector3(), speed: 0, lean: 0, mode: 'ride', floorY: 0, floorAt: (p) => this.world.compound.floorHeightAt(p) };
  }

  syncVisuals(alpha: number, dt: number): void {
    this.skater.sync(alpha, dt);
    this.sun.target.position.copy(this.skater.board.position);
    this.sun.position.copy(this.skater.board.position).add(SUN_OFFSET);
  }

  cameraTarget(): CameraTarget {
    fillCameraTarget(this.target, this.world);
    return this.target;
  }

  dispose(): void {
    this.skater.dispose();
    for (const m of this.owned) m.geometry.dispose();
  }
}
