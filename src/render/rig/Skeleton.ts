import {
  Bone,
  Color,
  BufferGeometry,
  Float32BufferAttribute,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  type Material,
} from 'three';
import { quatFromDirFront } from './IK';
import { BONES, RIG, type BoneDef, type BoneName } from './RigSpec';
import { PALETTE } from '../Toon';

/**
 * Builds the skeleton and a procedural one-piece skinned mesh in the bind pose. Every bone gets
 * a capsule; joints blend two influences. A GLTF asset can replace this by matching bone names.
 */
export class SkaterSkeleton {
  readonly mesh: SkinnedMesh;
  readonly bones = {} as Record<BoneName, Bone>;
  readonly defs = {} as Record<BoneName, BoneDef>;
  /** Bind-pose world quaternion per bone (the mesh is authored at the origin). */
  readonly bindQuat = {} as Record<BoneName, Quaternion>;
  /** Bind-pose world position of each bone origin. */
  readonly bindPos = {} as Record<BoneName, Vector3>;
  readonly triangles: number;

  constructor(material: Material) {
    const boneList: Bone[] = [];
    const front = new Vector3();
    const dir = new Vector3();
    for (const def of BONES) {
      this.defs[def.name] = def;
      const b = new Bone();
      b.name = def.name;
      this.bones[def.name] = b;
      boneList.push(b);
      dir.set(def.dir[0], def.dir[1], def.dir[2]);
      // Front hint: body front (+X) for vertical bones, up for the rest.
      if (Math.abs(dir.x) > 0.9) front.set(0, 1, 0);
      else front.set(1, 0, 0);
      const q = quatFromDirFront(dir, front, new Quaternion());
      this.bindQuat[def.name] = q;
      const parentPos = def.parent ? this.bindPos[def.parent] : new Vector3();
      this.bindPos[def.name] = new Vector3(def.offset[0], def.offset[1], def.offset[2]).add(parentPos);
      if (def.parent) {
        const p = this.bones[def.parent];
        p.add(b);
        // Local offset: the world offset expressed in the parent's bind frame.
        b.position.set(def.offset[0], def.offset[1], def.offset[2]).applyQuaternion(this.bindQuat[def.parent].clone().invert());
        b.quaternion.copy(this.bindQuat[def.parent]).invert().multiply(q);
      } else {
        b.position.copy(this.bindPos[def.name]);
        b.quaternion.copy(q);
      }
    }

    const geo = this.buildMesh(boneList);
    this.triangles = geo.index ? geo.index.count / 3 : 0;
    this.mesh = new SkinnedMesh(geo, material);
    this.mesh.add(this.bones.pelvis);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new Skeleton(boneList));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  private buildMesh(boneList: Bone[]): BufferGeometry {
    const positions: number[] = [];
    const skinIndex: number[] = [];
    const skinWeight: number[] = [];
    const colors: number[] = [];
    const index: number[] = [];
    const col = new Color();
    const pushColor = (hex: number) => {
      col.setHex(hex);
      colors.push(col.r, col.g, col.b);
    };
    const RADIAL = 8;
    const PROFILE: [number, number][] = [
      [0, 0.35],
      [0.1, 0.8],
      [0.3, 1],
      [0.7, 1],
      [0.9, 0.8],
      [1, 0.35],
    ];
    const axis = new Vector3();
    const u = new Vector3();
    const v = new Vector3();
    const p0 = new Vector3();
    const c = new Vector3();

    const boneIndex = (name: BoneName) => boneList.findIndex((b) => b.name === name);

    // Clothes are painted per bone: shirt over the torso and short sleeves, trousers on the
    // legs, shoes on the feet, skin elsewhere, a cap on top of the head.
    const colorFor = (name: BoneName, s: number): number => {
      if (name === 'pelvis' || name.startsWith('upperLeg') || name.startsWith('lowerLeg')) return PALETTE.pants;
      if (name.startsWith('foot')) return PALETTE.shoe;
      if (name.startsWith('spine') || name === 'chest' || name.startsWith('clav')) return PALETTE.shirt;
      if (name.startsWith('upperArm')) return s < 0.4 ? PALETTE.shirt : PALETTE.skin;
      return PALETTE.skin;
    };

    for (const def of BONES) {
      if (def.radius <= 0) continue;
      const bi = boneIndex(def.name);
      const parentDef = def.parent ? this.defs[def.parent] : null;
      const blendParent = parentDef && parentDef.radius > 0 && def.name !== 'pelvis' ? boneIndex(def.parent!) : -1;
      axis.set(def.dir[0], def.dir[1], def.dir[2]).normalize();
      // Perpendicular frame.
      u.set(1, 0, 0);
      if (Math.abs(u.dot(axis)) > 0.9) u.set(0, 0, 1);
      u.addScaledVector(axis, -u.dot(axis)).normalize();
      v.crossVectors(axis, u);
      p0.copy(this.bindPos[def.name]);
      const base = positions.length / 3;
      // Two pole vertices and RADIAL per ring.
      const ringStart = (ri: number) => base + 1 + ri * RADIAL;
      // Bottom pole
      positions.push(p0.x, p0.y, p0.z);
      pushWeights(skinIndex, skinWeight, bi, blendParent, blendParent >= 0 ? 0.5 : 0);
      pushColor(colorFor(def.name, 0));
      for (let ri = 0; ri < PROFILE.length; ri++) {
        const [s, rr] = PROFILE[ri];
        c.copy(p0).addScaledVector(axis, s * def.length);
        const r = def.radius * rr;
        const wParent = blendParent >= 0 && ri < 2 ? (ri === 0 ? 0.5 : 0.25) : 0;
        for (let k = 0; k < RADIAL; k++) {
          const a = (k / RADIAL) * Math.PI * 2;
          positions.push(c.x + (u.x * Math.cos(a) + v.x * Math.sin(a)) * r, c.y + (u.y * Math.cos(a) + v.y * Math.sin(a)) * r, c.z + (u.z * Math.cos(a) + v.z * Math.sin(a)) * r);
          pushWeights(skinIndex, skinWeight, bi, blendParent, wParent);
          pushColor(colorFor(def.name, s));
        }
      }
      // Top pole
      c.copy(p0).addScaledVector(axis, def.length);
      const topPole = positions.length / 3;
      positions.push(c.x, c.y, c.z);
      pushWeights(skinIndex, skinWeight, bi, -1, 0);
      pushColor(colorFor(def.name, 1));
      // Faces
      for (let k = 0; k < RADIAL; k++) {
        const k1 = (k + 1) % RADIAL;
        index.push(base, ringStart(0) + k1, ringStart(0) + k);
        for (let ri = 0; ri < PROFILE.length - 1; ri++) {
          const a0 = ringStart(ri) + k, a1 = ringStart(ri) + k1, b0 = ringStart(ri + 1) + k, b1 = ringStart(ri + 1) + k1;
          index.push(a0, a1, b1, a0, b1, b0);
        }
        index.push(topPole, ringStart(PROFILE.length - 1) + k, ringStart(PROFILE.length - 1) + k1);
      }
    }

    // Head: a sphere on the head bone.
    {
      const hi = boneIndex('head');
      const centre = this.bindPos.head.clone().add(new Vector3(0, RIG.head * 0.55, 0));
      const R = RIG.headRadius;
      const SEG = 8, RINGS = 6;
      const base = positions.length / 3;
      for (let i = 0; i <= RINGS; i++) {
        const phi = (i / RINGS) * Math.PI;
        for (let k = 0; k < SEG; k++) {
          const th = (k / SEG) * Math.PI * 2;
          positions.push(centre.x + R * Math.sin(phi) * Math.cos(th) * 0.95, centre.y - R * Math.cos(phi), centre.z + R * Math.sin(phi) * Math.sin(th));
          pushWeights(skinIndex, skinWeight, hi, -1, 0);
          // Cap: the top of the head, pulled a little further down at the back (+X is the face).
          pushColor(phi > Math.PI * (0.58 - 0.08 * Math.cos(th)) ? PALETTE.cap : PALETTE.skin);
        }
      }
      for (let i = 0; i < RINGS; i++) {
        for (let k = 0; k < SEG; k++) {
          const k1 = (k + 1) % SEG;
          const a0 = base + i * SEG + k, a1 = base + i * SEG + k1, b0 = base + (i + 1) * SEG + k, b1 = base + (i + 1) * SEG + k1;
          index.push(a0, b1, a1, a0, b0, b1);
        }
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  }
}

function pushWeights(idx: number[], w: number[], self: number, parent: number, parentWeight: number): void {
  if (parent >= 0 && parentWeight > 0) {
    idx.push(self, parent, 0, 0);
    w.push(1 - parentWeight, parentWeight, 0, 0);
  } else {
    idx.push(self, 0, 0, 0);
    w.push(1, 0, 0, 0);
  }
}
