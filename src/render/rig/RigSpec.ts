/**
 * The skater's proportions and the bone contract. A GLTF artist asset replaces the procedural
 * mesh by matching these bone names and this hierarchy; everything downstream (IK, Verlet,
 * look-at, stepped sampling) works off bone names, not the mesh.
 *
 * Body frame axes: X = right of travel (binormal), Y = up (normal), Z = back (-tangent).
 * A regular skater stands sideways: hips and shoulders are spread along Z, the chest faces +X.
 */
export const RIG = {
  hipHalfWidth: 0.09,
  hipDrop: 0.05,
  upperLeg: 0.44,
  lowerLeg: 0.43,
  ankleHeight: 0.08,
  footLength: 0.22,
  spine: 0.12, // ×3: pelvis → spine1 → spine2 → chest base
  chest: 0.12, // chest bone: chest base → neck base
  neck: 0.07,
  head: 0.13,
  headRadius: 0.105,
  shoulderHalfWidth: 0.19,
  clavicleDrop: 0.02,
  upperArm: 0.3,
  foreArm: 0.28,
  hand: 0.08,
  /** Never let a two-bone chain reach past this fraction of its length (no locked knees). */
  maxReach: 0.995,
  /** Over-reach hysteresis: engage above, release below (metres of excess). */
  overreachOn: 0.01,
  overreachOff: 0.003,
  /** Stance: feet across the deck, front foot opened toward the nose by this much. */
  frontFootAngle: (25 * Math.PI) / 180,
  backFootAngle: (5 * Math.PI) / 180,
  /** Character pose sample rate. Board, camera and world run at display rate. */
  characterHz: 12,
  /** Verlet: stiffness toward pose targets, velocity retention per 60 Hz step, local gravity. */
  verletStiffness: 140,
  verletDrag: 0.10,
  verletGravity: 4,
  verletIterations: 2,
  /** Head look-at limits. */
  headYawMax: (70 * Math.PI) / 180,
  headPitchMax: (35 * Math.PI) / 180,
} as const;

export type BoneName =
  | 'pelvis' | 'spine1' | 'spine2' | 'chest' | 'neck' | 'head'
  | 'clavL' | 'upperArmL' | 'foreArmL' | 'handL'
  | 'clavR' | 'upperArmR' | 'foreArmR' | 'handR'
  | 'upperLegL' | 'lowerLegL' | 'footL'
  | 'upperLegR' | 'lowerLegR' | 'footR';

export interface BoneDef {
  name: BoneName;
  parent: BoneName | null;
  /** Bind-pose offset from the parent's origin, in the parent's bind frame (metres). */
  offset: [number, number, number];
  /** Bind-pose direction of the bone (world, unit). The bone's local +Y. */
  dir: [number, number, number];
  length: number;
  /** Capsule radius for the procedural mesh. 0 = no geometry. */
  radius: number;
}

const R = RIG;
/** Left = front for a regular skater (toward -Z). */
export const BONES: BoneDef[] = [
  { name: 'pelvis', parent: null, offset: [0, 0, 0], dir: [0, 1, 0], length: 0.1, radius: 0.13 },
  { name: 'spine1', parent: 'pelvis', offset: [0, 0.06, 0], dir: [0, 1, 0], length: R.spine, radius: 0.1 },
  { name: 'spine2', parent: 'spine1', offset: [0, R.spine, 0], dir: [0, 1, 0], length: R.spine, radius: 0.105 },
  { name: 'chest', parent: 'spine2', offset: [0, R.spine, 0], dir: [0, 1, 0], length: R.chest, radius: 0.12 },
  { name: 'neck', parent: 'chest', offset: [0, R.chest, 0], dir: [0, 1, 0], length: R.neck, radius: 0.05 },
  { name: 'head', parent: 'neck', offset: [0, R.neck, 0], dir: [0, 1, 0], length: R.head, radius: 0 },
  { name: 'clavL', parent: 'chest', offset: [0, R.chest - R.clavicleDrop, -0.04], dir: [0, 0, -1], length: R.shoulderHalfWidth - 0.04, radius: 0.045 },
  { name: 'upperArmL', parent: 'clavL', offset: [0, 0, -(R.shoulderHalfWidth - 0.04)], dir: [0, -1, 0], length: R.upperArm, radius: 0.045 },
  { name: 'foreArmL', parent: 'upperArmL', offset: [0, -R.upperArm, 0], dir: [0, -1, 0], length: R.foreArm, radius: 0.038 },
  { name: 'handL', parent: 'foreArmL', offset: [0, -R.foreArm, 0], dir: [0, -1, 0], length: R.hand, radius: 0.035 },
  { name: 'clavR', parent: 'chest', offset: [0, R.chest - R.clavicleDrop, 0.04], dir: [0, 0, 1], length: R.shoulderHalfWidth - 0.04, radius: 0.045 },
  { name: 'upperArmR', parent: 'clavR', offset: [0, 0, R.shoulderHalfWidth - 0.04], dir: [0, -1, 0], length: R.upperArm, radius: 0.045 },
  { name: 'foreArmR', parent: 'upperArmR', offset: [0, -R.upperArm, 0], dir: [0, -1, 0], length: R.foreArm, radius: 0.038 },
  { name: 'handR', parent: 'foreArmR', offset: [0, -R.foreArm, 0], dir: [0, -1, 0], length: R.hand, radius: 0.035 },
  { name: 'upperLegL', parent: 'pelvis', offset: [0, -R.hipDrop, -R.hipHalfWidth], dir: [0, -1, 0], length: R.upperLeg, radius: 0.065 },
  { name: 'lowerLegL', parent: 'upperLegL', offset: [0, -R.upperLeg, 0], dir: [0, -1, 0], length: R.lowerLeg, radius: 0.05 },
  { name: 'footL', parent: 'lowerLegL', offset: [0, -R.lowerLeg, 0], dir: [1, 0, 0], length: R.footLength, radius: 0.04 },
  { name: 'upperLegR', parent: 'pelvis', offset: [0, -R.hipDrop, R.hipHalfWidth], dir: [0, -1, 0], length: R.upperLeg, radius: 0.065 },
  { name: 'lowerLegR', parent: 'upperLegR', offset: [0, -R.upperLeg, 0], dir: [0, -1, 0], length: R.lowerLeg, radius: 0.05 },
  { name: 'footR', parent: 'lowerLegR', offset: [0, -R.lowerLeg, 0], dir: [1, 0, 0], length: R.footLength, radius: 0.04 },
];
