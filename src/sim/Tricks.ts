/**
 * Tricks are points in a continuous channel space, not branches. The rose picks channel targets;
 * the name is a label the classifier derives afterwards from what actually happened.
 */
const D = Math.PI / 180;

export interface TrickTargets {
  /** Body spin about the frame normal (rad). Negative = frontside for a regular skater. */
  spin: number;
  /** Board rotation about its long axis (rad). Positive = kickflip direction. */
  flip: number;
  /** Board rotation about its normal relative to the body (rad). Positive = frontside scoop. */
  scoop: number;
}

export const OLLIE: TrickTargets = { spin: 0, flip: 0, scoop: 0 };

/** Rose indexed by stick angle / 45°: E, NE, N, NW, W, SW, S, SE. Eight distinct tricks. */
export const ROSE: TrickTargets[] = [
  { spin: -180 * D, flip: 0, scoop: 0 }, // E   fs 180
  { spin: -180 * D, flip: 360 * D, scoop: 0 }, // NE  fs kickflip
  { spin: 0, flip: 360 * D, scoop: 0 }, // N   kickflip
  { spin: 0, flip: -360 * D, scoop: 0 }, // NW  heelflip
  { spin: 180 * D, flip: 0, scoop: 0 }, // W   bs 180
  { spin: 0, flip: 0, scoop: 180 * D }, // SW  pop shuv
  { spin: 0, flip: 0, scoop: 360 * D }, // S   360 shuv
  { spin: 0, flip: 360 * D, scoop: 180 * D }, // SE  varial kickflip
];

/** Nearest multiple of `period` to `a`, as a count. */
function turns(a: number, period: number): number {
  return Math.round(a / period);
}

/**
 * Name what happened from the accumulated channels at landing. Sign conventions follow the
 * rose above. Anything not covered gets a generic but honest label.
 */
export function classifyTrick(spin: number, flip: number, scoop: number): string {
  const f = turns(flip, 360 * D); // full flips
  const s = turns(scoop, 180 * D); // half scoops
  const b = turns(spin, 180 * D); // half body spins
  const parts: string[] = [];
  let board = '';
  const flipName = f > 0 ? 'kickflip' : 'heelflip';
  const nf = Math.abs(f);
  const ns = Math.abs(s);
  if (nf === 0 && ns === 0) board = parts.length ? '' : 'ollie';
  else if (nf === 0) board = ns === 1 ? 'pop shuv' : ns === 2 ? '360 shuv' : `${ns * 180} shuv`;
  else if (ns === 0) board = nf === 1 ? flipName : nf === 2 ? `double ${flipName}` : `${nf}x ${flipName}`;
  else if (nf === 1 && ns === 1) board = f > 0 ? (s > 0 ? 'varial kickflip' : 'hardflip') : s > 0 ? 'inward heelflip' : 'varial heelflip';
  else if (nf === 1 && ns === 2) board = f > 0 ? '360 flip' : 'laser flip';
  else board = `${nf}x ${flipName} ${ns * 180} shuv`;
  // "fs kickflip" reads better than "fs 180 kickflip"; the number stays when there is no board trick
  // or the spin is more than a 180.
  if (b !== 0) parts.push(`${b < 0 ? 'fs' : 'bs'}${board && Math.abs(b) === 1 ? '' : ` ${Math.abs(b) * 180}`}`);
  if (board) parts.push(board);
  return parts.join(' ') || 'ollie';
}

/** Six board contact targets along the deck (metres from centre, nose positive). */
export const CONTACTS = {
  nose: 0.41,
  frontTruck: 0.3,
  center: 0,
  backTruck: -0.3,
  tail: -0.41,
} as const;
export type Contact = keyof typeof CONTACTS;

/**
 * Grind classification from board yaw on the edge (rad, |yaw| ≤ π/2), pitch (rad, nose up
 * positive) and which contact carries the board. Labels, not animations.
 */
export function classifyGrind(yaw: number, pitch: number, contact: Contact): string {
  const ay = Math.abs(yaw);
  if (ay > 60 * D) return yaw > 0 ? 'fs boardslide' : 'bs boardslide';
  if (ay < 20 * D) {
    if (contact === 'backTruck') return '5-0';
    if (contact === 'tail') return 'tailslide';
    if (contact === 'frontTruck') return 'nosegrind';
    if (contact === 'nose') return 'noseslide';
    return '50-50';
  }
  // Angled: front-heavy is crooked / overcrook, back-heavy is smith / feeble.
  if (pitch < 0) return yaw > 0 ? 'crooked' : 'overcrook';
  return yaw > 0 ? 'smith' : 'feeble';
}

/**
 * Which contact point carries the board for a given pitch: nose-up puts the tail end down.
 */
export function pivotForPitch(pitch: number): Contact {
  if (pitch > 25 * D) return 'tail';
  if (pitch > 8 * D) return 'backTruck';
  if (pitch < -25 * D) return 'nose';
  if (pitch < -8 * D) return 'frontTruck';
  return 'center'; // both trucks: 50-50 or boardslide
}
