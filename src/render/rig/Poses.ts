import type { TrickTargets } from '../../sim/Tricks';

/**
 * A pose is ~30 floats: board-space foot goal offsets, a pelvis offset, chest pitch/twist,
 * hand offsets (chest frame: front, up, side) and a head yaw. Tricks are 2–5 keyed poses
 * blended along a normalized timeline. Forty tricks cost kilobytes.
 *
 * Nothing here is authored per trick name. Keys are composed from the trick's channel signs
 * (flip direction, scoop direction, spin direction), so every point in the continuous channel
 * space gets a coherent pose, including half-caught combinations.
 */
export interface Pose {
  fL: [number, number, number];
  fR: [number, number, number];
  yawL: number;
  yawR: number;
  pelvis: [number, number, number];
  chestPitch: number;
  chestTwist: number;
  hL: [number, number, number];
  hR: [number, number, number];
  headYaw: number;
}

export function makePose(): Pose {
  return { fL: [0, 0, 0], fR: [0, 0, 0], yawL: 0, yawR: 0, pelvis: [0, 0, 0], chestPitch: 0, chestTwist: 0, hL: [0, 0, 0], hR: [0, 0, 0], headYaw: 0 };
}

export function zeroPose(p: Pose): Pose {
  p.fL[0] = p.fL[1] = p.fL[2] = 0;
  p.fR[0] = p.fR[1] = p.fR[2] = 0;
  p.yawL = p.yawR = 0;
  p.pelvis[0] = p.pelvis[1] = p.pelvis[2] = 0;
  p.chestPitch = p.chestTwist = 0;
  p.hL[0] = p.hL[1] = p.hL[2] = 0;
  p.hR[0] = p.hR[1] = p.hR[2] = 0;
  p.headYaw = 0;
  return p;
}

function lerp3(a: [number, number, number], b: [number, number, number], t: number, out: [number, number, number]): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

export function blendPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  lerp3(a.fL, b.fL, t, out.fL);
  lerp3(a.fR, b.fR, t, out.fR);
  out.yawL = a.yawL + (b.yawL - a.yawL) * t;
  out.yawR = a.yawR + (b.yawR - a.yawR) * t;
  lerp3(a.pelvis, b.pelvis, t, out.pelvis);
  out.chestPitch = a.chestPitch + (b.chestPitch - a.chestPitch) * t;
  out.chestTwist = a.chestTwist + (b.chestTwist - a.chestTwist) * t;
  lerp3(a.hL, b.hL, t, out.hL);
  lerp3(a.hR, b.hR, t, out.hR);
  out.headYaw = a.headYaw + (b.headYaw - a.headYaw) * t;
  return out;
}

/** Scale a pose's offsets by w (for weight ramps). */
export function scalePose(p: Pose, w: number): Pose {
  for (const k of ['fL', 'fR', 'pelvis', 'hL', 'hR'] as const) {
    p[k][0] *= w;
    p[k][1] *= w;
    p[k][2] *= w;
  }
  p.yawL *= w;
  p.yawR *= w;
  p.chestPitch *= w;
  p.chestTwist *= w;
  p.headYaw *= w;
  return p;
}

const KEY_T = [0, 0.12, 0.5, 0.8, 1.0]; // setup, pop, peak, catch, land
const keys: Pose[] = [makePose(), makePose(), makePose(), makePose(), makePose()];

/**
 * Compose the five keys for a trick from its channel signs and the steeze channels, then sample
 * at t ∈ [0, 1]. Steeze: cleaner input → bigger flick, more foot turn, higher tuck.
 */
export function sampleTrickPose(trick: TrickTargets, t: number, steezeL: number, steezeR: number, out: Pose): Pose {
  const flip = Math.sign(trick.flip); // +1 kickflip (toe side, +X), -1 heelflip (-X)
  const scoop = Math.sign(trick.scoop);
  const spin = Math.sign(trick.spin);
  const flick = 0.16 * (1 + 0.6 * steezeL);
  const tuck = 0.1 + 0.05 * steezeR;
  const footTurn = (20 * Math.PI) / 180 * steezeL;

  // setup: weight on the tail, wound up
  const s = zeroPose(keys[0]);
  s.pelvis[1] = -0.04;
  s.pelvis[2] = 0.03;
  s.chestPitch = 0.2;
  s.chestTwist = -0.25 * spin;
  s.hL[0] = s.hR[0] = -0.12;
  s.hL[1] = s.hR[1] = -0.1;

  // pop: front foot slides up the nose (and out for a flip), back foot scoops
  const p = zeroPose(keys[1]);
  p.fL[0] = flick * flip * 0.5;
  p.fL[1] = 0.1;
  p.fL[2] = -0.14 * (flip ? 0.6 : 1);
  p.fR[0] = 0.1 * scoop;
  p.fR[1] = 0.12;
  p.fR[2] = 0.06 + 0.06 * Math.abs(scoop);
  p.pelvis[1] = 0.05;
  p.chestPitch = 0.05;
  p.chestTwist = -0.6 * spin;
  p.hL[1] = p.hR[1] = 0.25;
  p.hL[2] = -0.15;
  p.hR[2] = 0.15;
  p.headYaw = -0.5 * spin;

  // peak: the flick is out, knees tucked, arms out
  const k = zeroPose(keys[2]);
  k.fL[0] = flick * flip;
  k.fL[1] = tuck + 0.02;
  k.fL[2] = -0.08;
  k.yawL = footTurn * (flip ? 1 : 0.5);
  k.fR[0] = 0.06 * scoop;
  k.fR[1] = tuck;
  k.fR[2] = 0.04;
  k.pelvis[1] = 0.02;
  k.chestTwist = -0.5 * spin;
  k.hL[1] = k.hR[1] = 0.1;
  k.hL[2] = -0.3;
  k.hR[2] = 0.3;
  k.headYaw = -0.3 * spin;

  // catch: feet come back over the deck
  const c = zeroPose(keys[3]);
  c.fL[0] = 0.03 * flip;
  c.fL[1] = 0.06;
  c.fL[2] = -0.02;
  c.fR[1] = 0.06;
  c.hL[0] = c.hR[0] = 0.1;
  c.hL[2] = -0.2;
  c.hR[2] = 0.2;

  // land: absorb, arms forward
  const l = zeroPose(keys[4]);
  l.chestPitch = 0.15;
  l.hL[0] = l.hR[0] = 0.15;
  l.hL[1] = l.hR[1] = -0.1;

  if (t <= 0) return blendPose(s, s, 0, out);
  if (t >= 1) return blendPose(l, l, 0, out);
  for (let i = 0; i < KEY_T.length - 1; i++) {
    if (t <= KEY_T[i + 1]) {
      const u = (t - KEY_T[i]) / (KEY_T[i + 1] - KEY_T[i]);
      return blendPose(keys[i], keys[i + 1], u * u * (3 - 2 * u), out);
    }
  }
  return blendPose(l, l, 0, out);
}

/**
 * Per-grind styling: a small table of head/arm/body offsets indexed by the classifier's label.
 * Thirty named grinds are labels; this is the only per-grind data there is.
 */
const GRIND_STYLE: Record<string, Partial<Pose>> = {
  '50-50': { hL: [0.05, 0.1, -0.25], hR: [0.05, 0.1, 0.25] },
  '5-0': { pelvis: [0, -0.02, 0.1], chestPitch: -0.1, hL: [0.1, 0.25, -0.2], hR: [0, 0.05, 0.3] },
  tailslide: { pelvis: [0, -0.04, 0.14], chestPitch: -0.15, hL: [0.15, 0.3, -0.2], hR: [0, 0.1, 0.3] },
  nosegrind: { pelvis: [0, -0.02, -0.1], chestPitch: 0.25, hL: [0, 0.05, -0.3], hR: [0.1, 0.25, 0.2] },
  noseslide: { pelvis: [0, -0.04, -0.14], chestPitch: 0.3, hL: [0, 0.1, -0.3], hR: [0.15, 0.3, 0.2] },
  'fs boardslide': { chestTwist: 1.2, headYaw: 1.0, hL: [0.2, 0.15, -0.3], hR: [-0.1, 0.15, 0.3], pelvis: [0, -0.03, 0] },
  'bs boardslide': { chestTwist: -1.2, headYaw: -1.0, hL: [-0.1, 0.15, -0.3], hR: [0.2, 0.15, 0.3], pelvis: [0, -0.03, 0] },
  crooked: { chestTwist: 0.5, chestPitch: 0.2, pelvis: [0, -0.02, -0.08], hL: [0.1, 0.1, -0.3], hR: [0.1, 0.3, 0.2] },
  overcrook: { chestTwist: -0.5, chestPitch: 0.2, pelvis: [0, -0.02, -0.08], hL: [0.1, 0.3, -0.2], hR: [0.1, 0.1, 0.3] },
  smith: { chestTwist: 0.4, pelvis: [0, -0.02, 0.08], hL: [0.1, 0.3, -0.2], hR: [0, 0.05, 0.3] },
  feeble: { chestTwist: -0.4, pelvis: [0, -0.02, 0.08], hL: [0, 0.05, -0.3], hR: [0.1, 0.3, 0.2] },
};

export function grindStyle(name: string, out: Pose): Pose {
  zeroPose(out);
  const g = GRIND_STYLE[name];
  if (!g) return out;
  if (g.pelvis) (out.pelvis as number[]).splice(0, 3, ...g.pelvis);
  if (g.hL) (out.hL as number[]).splice(0, 3, ...g.hL);
  if (g.hR) (out.hR as number[]).splice(0, 3, ...g.hR);
  out.chestPitch = g.chestPitch ?? 0;
  out.chestTwist = g.chestTwist ?? 0;
  out.headYaw = g.headYaw ?? 0;
  return out;
}

/** Manual pose: weight over the lifted end, arms out. m ∈ [-1, 1], +1 = tail manual. */
export function manualPose(m: number, out: Pose): Pose {
  zeroPose(out);
  out.pelvis[2] = 0.12 * m;
  out.pelvis[1] = -0.03 * Math.abs(m);
  out.chestPitch = -0.12 * m;
  out.hL[2] = -0.3 * Math.abs(m);
  out.hR[2] = 0.3 * Math.abs(m);
  out.hL[1] = out.hR[1] = 0.1 * Math.abs(m);
  return out;
}

export function smoothstep(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}
