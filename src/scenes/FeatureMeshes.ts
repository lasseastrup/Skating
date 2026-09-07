import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Mesh,
  MeshLambertMaterial,
  Shape,
  ShapeGeometry,
  Vector3,
  type Material,
} from 'three';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import type { BowlRoomSpec, KickerSpec, LedgeSpec, PlatformSpec, QuarterPipeSpec, RollerSpec } from '../sim/Park';
import type { PlaneSurface } from '../sim/surfaces/Plane';
import type { TroughSurface } from '../sim/surfaces/Trough';
import { DARK_PROP, GREY_GROUND, GREY_PROP } from './SceneBase';

export const CONCAVE = new MeshLambertMaterial({ color: 0x8a8a8a, side: DoubleSide });
const STAIR = new MeshLambertMaterial({ color: 0x7d7d7d });

/** The picture is fitted to the primitive: every mesh here reads the same spec the sim used. */

export function groundGridMesh(ground: PlaneSurface, half: number, cell = 2): Mesh {
  const n = Math.ceil((2 * half) / cell);
  const positions: number[] = [];
  const index: number[] = [];
  let vi = 0;
  const emit = (u0: number, v0: number, size: number) => {
    positions.push(u0, 0, -v0, u0 + size, 0, -v0, u0 + size, 0, -(v0 + size), u0, 0, -(v0 + size));
    index.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  };
  // Cells fully inside are emitted whole; cells that straddle a hole edge are cut finer (0.25 m)
  // so rims of bowls, channels and ramp footprints read as curves, not staircases.
  const cellState = (u0: number, v0: number, size: number): number => {
    let inside = 0;
    for (const [a, b] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.5]]) {
      if (ground.marginUV(u0 + a * size, v0 + b * size) > 0) inside++;
    }
    return inside === 5 ? 1 : inside === 0 ? -1 : 0;
  };
  const sub = (u0: number, v0: number, size: number, depth: number) => {
    const st = cellState(u0, v0, size);
    if (st === 1) return emit(u0, v0, size);
    if (st === -1) return;
    if (depth === 0) {
      if (ground.marginUV(u0 + size / 2, v0 + size / 2) > 0) emit(u0, v0, size);
      return;
    }
    const h = size / 2;
    sub(u0, v0, h, depth - 1);
    sub(u0 + h, v0, h, depth - 1);
    sub(u0, v0 + h, h, depth - 1);
    sub(u0 + h, v0 + h, h, depth - 1);
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) sub(-half + i * cell, -half + j * cell, cell, 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(index);
  g.computeVertexNormals();
  const m = new Mesh(g, GREY_GROUND);
  m.receiveShadow = true;
  return m;
}

export function quarterPipeMesh(s: QuarterPipeSpec, mat: Material = GREY_PROP): Mesh[] {
  const { radius: r, width, vertExt, deckDepth, facing: f } = s;
  const sh = new Shape();
  sh.moveTo(-f * deckDepth, 0);
  sh.lineTo(f * r, 0);
  if (f > 0) sh.absarc(r, r, r, -Math.PI / 2, Math.PI, true);
  else sh.absarc(-r, r, r, -Math.PI / 2, 0, false);
  sh.lineTo(0, r + vertExt);
  sh.lineTo(-f * deckDepth, r + vertExt);
  sh.closePath();
  const g = new ExtrudeGeometry(sh, { depth: width, bevelEnabled: false, curveSegments: 24 });
  g.translate(0, 0, -width / 2);
  const m = new Mesh(g, mat);
  m.position.set(s.wallX, 0, s.zCenter);
  m.receiveShadow = true;
  const out: Mesh[] = [m];
  if (s.extension) {
    const e = s.extension;
    const ext = new Mesh(new BoxGeometry(deckDepth, e.height, e.z1 - e.z0), mat);
    ext.position.set(s.wallX - (f * deckDepth) / 2, r + vertExt + e.height / 2, (e.z0 + e.z1) / 2);
    ext.receiveShadow = true;
    out.push(ext);
  }
  return out;
}

export function boxMesh(s: LedgeSpec, mat: Material = GREY_PROP): Mesh {
  const m = new Mesh(new BoxGeometry(s.length, s.height, s.width), mat);
  m.position.set(s.x, s.height / 2, s.z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function kickerMesh(s: KickerSpec): Mesh {
  const f = s.facing;
  const a = s.angle;
  const rT = s.transRadius;
  // Profile in local x (toward the bank, -f direction is "up the kicker") and y.
  const sh = new Shape();
  sh.moveTo(0, 0);
  // arc from the toe, centre (0, rT), from bottom toward the bank angle
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const th = (a * i) / steps;
    sh.lineTo(-rT * Math.sin(th), rT * (1 - Math.cos(th)));
  }
  const sx = -rT * Math.sin(a), sy = rT * (1 - Math.cos(a));
  const ex = sx - s.bankLength * Math.cos(a), ey = sy + s.bankLength * Math.sin(a);
  sh.lineTo(ex, ey);
  sh.lineTo(ex, 0);
  sh.closePath();
  const g = new ExtrudeGeometry(sh, { depth: s.width, bevelEnabled: false });
  g.translate(0, 0, -s.width / 2);
  if (f < 0) g.scale(-1, 1, 1); // mirror; fix winding by flipping index order
  if (f < 0 && g.index) {
    const idx = g.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.computeVertexNormals();
  }
  const m = new Mesh(g, GREY_PROP);
  m.position.set(s.toeX, 0, s.zCenter);
  m.receiveShadow = true;
  m.castShadow = true;
  return m;
}

export function rollerMesh(s: RollerSpec): Mesh {
  const alpha = s.angle;
  const R = s.height / (2 * (1 - Math.cos(alpha)));
  const x0 = -2 * R * Math.sin(alpha);
  const sh = new Shape();
  sh.moveTo(x0, 0);
  const N = 12;
  // concave up: centre (x0, R)
  for (let i = 1; i <= N; i++) {
    const th = (alpha * i) / N;
    sh.lineTo(x0 + R * Math.sin(th), R * (1 - Math.cos(th)));
  }
  // convex crest: centre (0, h - R), from -alpha to alpha
  for (let i = 0; i <= N; i++) {
    const th = -alpha + (2 * alpha * i) / N;
    sh.lineTo(R * Math.sin(th), s.height - R + R * Math.cos(th));
  }
  // concave down: centre (-x0, R)
  for (let i = N; i >= 0; i--) {
    const th = (alpha * i) / N;
    sh.lineTo(-x0 - R * Math.sin(th), R * (1 - Math.cos(th)));
  }
  sh.closePath();
  const g = new ExtrudeGeometry(sh, { depth: s.width, bevelEnabled: false });
  g.translate(0, 0, -s.width / 2);
  const m = new Mesh(g, GREY_PROP);
  m.position.set(s.xCenter, 0, s.zCenter);
  m.receiveShadow = true;
  return m;
}

export function platformMeshes(s: PlatformSpec): Mesh[] {
  const out: Mesh[] = [];
  const body = new Mesh(new BoxGeometry(s.length, s.height, s.width), GREY_PROP);
  body.position.set(s.x, s.height / 2, s.z);
  body.castShadow = true;
  body.receiveShadow = true;
  out.push(body);
  // Stairs down the +X side: 6 steps.
  const steps = 6;
  const x1 = s.x + s.length / 2;
  for (let i = 0; i < steps; i++) {
    const h = s.height * (1 - (i + 1) / steps);
    if (h <= 0.01) continue;
    const run = s.stairRun / steps;
    const st = new Mesh(new BoxGeometry(run, h, s.width), STAIR);
    st.position.set(x1 + run * (i + 0.5), h / 2, s.z);
    st.receiveShadow = true;
    out.push(st);
  }
  // Hubba: a sloped box along the +z side.
  const hz = s.z + s.width / 2 + s.hubbaWidth / 2;
  const len = Math.hypot(s.stairRun, s.height - s.hubbaEndHeight);
  const hub = new Mesh(new BoxGeometry(len, 0.3, s.hubbaWidth), GREY_PROP);
  hub.position.set(x1 + s.stairRun / 2, (s.height + s.hubbaEndHeight) / 2 - 0.15, hz);
  hub.rotation.z = -Math.atan2(s.height - s.hubbaEndHeight, s.stairRun);
  hub.castShadow = true;
  hub.receiveShadow = true;
  out.push(hub);
  // Hubba support down to the ground.
  const sup = new Mesh(new BoxGeometry(s.stairRun, s.hubbaEndHeight, s.hubbaWidth), GREY_PROP);
  sup.position.set(x1 + s.stairRun / 2, s.hubbaEndHeight / 2 - 0.05, hz);
  out.push(sup);
  return out;
}

/** Pool room: corners (torus + vertical cylinder), straight walls (cylinder + vert), floor. */
export function bowlRoomMeshes(s: BowlRoomSpec): Mesh[] {
  const out: Mesh[] = [];
  const r = s.transRadius;
  const floorY = -(r + s.vertExt);
  const Rc = s.cornerRadius;
  const R = Rc + r;
  const corners: [number, number, number, number][] = [
    [s.x + s.hx, s.z + s.hz, 0, Math.PI / 2],
    [s.x - s.hx, s.z + s.hz, Math.PI / 2, Math.PI],
    [s.x - s.hx, s.z - s.hz, Math.PI, (3 * Math.PI) / 2],
    [s.x + s.hx, s.z - s.hz, (3 * Math.PI) / 2, 2 * Math.PI],
  ];
  for (const [cx, cz, th0, th1] of corners) {
    const span = th1 - th0;
    const surf = new ParametricGeometry(
      (u, v, o) => {
        const th = th0 + u * span;
        const ps = -Math.PI / 2 + (v * Math.PI) / 2;
        const d = Rc + r * Math.cos(ps);
        o.set(cx + d * Math.cos(th), floorY + r + r * Math.sin(ps), cz + d * Math.sin(th));
      },
      16,
      10,
    );
    out.push(new Mesh(surf, CONCAVE));
    const lip = new ParametricGeometry((u, v, o) => {
      const th = th0 + u * span;
      o.set(cx + R * Math.cos(th), floorY + r + v * s.vertExt, cz + R * Math.sin(th));
    }, 16, 1);
    out.push(new Mesh(lip, CONCAVE));
  }
  const sides: { key: keyof BowlRoomSpec['open']; d: Vector3; len: number; center: Vector3 }[] = [
    { key: 'east', d: new Vector3(1, 0, 0), len: 2 * s.hz, center: new Vector3(s.x + s.hx + Rc, 0, s.z) },
    { key: 'west', d: new Vector3(-1, 0, 0), len: 2 * s.hz, center: new Vector3(s.x - s.hx - Rc, 0, s.z) },
    { key: 'south', d: new Vector3(0, 0, 1), len: 2 * s.hx, center: new Vector3(s.x, 0, s.z + s.hz + Rc) },
    { key: 'north', d: new Vector3(0, 0, -1), len: 2 * s.hx, center: new Vector3(s.x, 0, s.z - s.hz - Rc) },
  ];
  for (const side of sides) {
    if (s.open[side.key]) continue;
    const along = new Vector3(-side.d.z, 0, side.d.x);
    const C = side.center.clone().setY(floorY + r);
    const g = new ParametricGeometry(
      (u, v, o) => {
        const th = (v * Math.PI) / 2; // 0 floor → π/2 wall
        const t = (u - 0.5) * side.len;
        o.copy(C).addScaledVector(along, t);
        o.y += -r * Math.cos(th);
        o.addScaledVector(side.d, r * Math.sin(th));
      },
      8,
      12,
    );
    out.push(new Mesh(g, CONCAVE));
    const vg = new ParametricGeometry((u, v, o) => {
      const t = (u - 0.5) * side.len;
      o.copy(C).addScaledVector(along, t).addScaledVector(side.d, r);
      o.y = floorY + r + v * s.vertExt;
    }, 2, 1);
    out.push(new Mesh(vg, CONCAVE));
  }
  // Floor: rounded rectangle shape, flat.
  const sh = new Shape();
  const hx = s.hx, hz = s.hz;
  sh.moveTo(-hx - Rc, -hz);
  sh.lineTo(-hx - Rc, hz);
  sh.absarc(-hx, hz, Rc, Math.PI, Math.PI / 2, true);
  sh.lineTo(hx, hz + Rc);
  sh.absarc(hx, hz, Rc, Math.PI / 2, 0, true);
  sh.lineTo(hx + Rc, -hz);
  sh.absarc(hx, -hz, Rc, 0, -Math.PI / 2, true);
  sh.lineTo(-hx, -hz - Rc);
  sh.absarc(-hx, -hz, Rc, -Math.PI / 2, -Math.PI, true);
  sh.closePath();
  const fg = new ShapeGeometry(sh, 12);
  fg.rotateX(-Math.PI / 2); // shape (x, y) → (x, 0, -y)
  fg.scale(1, 1, -1); // flip z so shape-y maps to +z
  fg.computeVertexNormals();
  const floor = new Mesh(fg, CONCAVE);
  floor.position.set(s.x, floorY, s.z);
  floor.receiveShadow = true;
  out.push(floor);
  for (const m of out) m.receiveShadow = true;
  return out;
}

/** A flat quad between two heights over a rectangle along X. */
export function bankMesh(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([x0, y0, z0, x1, y1, z0, x1, y1, z1, x0, y0, z1]), 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  g.computeVertexNormals();
  const m = new Mesh(g, CONCAVE);
  m.receiveShadow = true;
  return m;
}

/** A vertical face between the ground and a sunken bank's side edge (the chute or bank walls). */
export function sideFaceMesh(x0: number, y0: number, x1: number, y1: number, z: number): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([x0, y0, z, x1, y1, z, x1, 0, z, x0, 0, z]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  const m = new Mesh(g, CONCAVE);
  m.receiveShadow = true;
  return m;
}

/** Sunken bank with its two side faces up to the ground, optionally only over x ∈ [xa, xb]. */
export function sunkenBankMeshes(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, xa = x0, xb = x1): Mesh[] {
  const yAt = (x: number) => y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  return [bankMesh(x0, y0, x1, y1, z0, z1), sideFaceMesh(xa, yAt(xa), xb, yAt(xb), z0), sideFaceMesh(xa, yAt(xa), xb, yAt(xb), z1)];
}

/**
 * The vertical cap on a channel's dead end: its cross-section (a circular segment under the
 * ground line) minus the chute that feeds it. Built in the plane x = const, facing -X.
 */
export function troughCapMesh(t: TroughSurface, chuteZ0: number, chuteZ1: number, chuteY: number): Mesh {
  const P = new Vector3(), T = new Vector3(), K = new Vector3();
  t.path.frame(0, P, T, K);
  const rim = t.rho * Math.sin(t.phiMax);
  const top = P.y + t.rho * (1 - Math.cos(t.phiMax)); // ground line
  const yAt = (dz: number) => P.y + t.rho - Math.sqrt(Math.max(0, t.rho * t.rho - dz * dz));
  const sh = new Shape();
  const N = 24;
  sh.moveTo(P.z - rim, top);
  for (let i = 0; i <= N; i++) {
    const dz = -rim + ((chuteZ0 - P.z + rim) * i) / N;
    sh.lineTo(P.z + dz, yAt(dz));
  }
  sh.lineTo(chuteZ0, chuteY);
  sh.lineTo(chuteZ1, chuteY);
  for (let i = 0; i <= N; i++) {
    const dz = chuteZ1 - P.z + ((rim - (chuteZ1 - P.z)) * i) / N;
    sh.lineTo(P.z + dz, yAt(dz));
  }
  sh.lineTo(P.z + rim, top);
  sh.closePath();
  const g = new ShapeGeometry(sh, 4);
  // Shape (z, y) → world (x0, y, z): rotate so shape-x lies along +Z.
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  const m = new Mesh(g, CONCAVE);
  m.position.x = P.x;
  m.receiveShadow = true;
  return m;
}

export function troughMesh(t: TroughSurface): Mesh {
  const P = new Vector3(), T = new Vector3(), K = new Vector3(), up = new Vector3(), right = new Vector3(), Y = new Vector3(0, 1, 0);
  const g = new ParametricGeometry(
    (u, v, out) => {
      t.path.frame(u, P, T, K);
      up.copy(Y).addScaledVector(T, -Y.dot(T)).normalize();
      right.crossVectors(T, up).normalize();
      const phi = -t.phiMax + 2 * t.phiMax * v;
      out.copy(P).addScaledVector(up, t.rho).addScaledVector(right, t.rho * Math.sin(phi)).addScaledVector(up, -t.rho * Math.cos(phi));
    },
    96,
    16,
  );
  const m = new Mesh(g, CONCAVE);
  m.receiveShadow = true;
  return m;
}

export function railMesh(a: Vector3, b: Vector3, radius: number): Mesh[] {
  const len = a.distanceTo(b);
  const bar = new CylinderGeometry(radius, radius, len, 10, 1);
  const m = new Mesh(bar, DARK_PROP);
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  const out = [m];
  for (const p of [a.clone().lerp(b, 0.15), a.clone().lerp(b, 0.85)]) {
    const post = new Mesh(new CylinderGeometry(radius * 0.8, radius * 0.8, p.y, 8, 1), DARK_PROP);
    post.position.set(p.x, p.y / 2, p.z);
    out.push(post);
  }
  return out;
}
