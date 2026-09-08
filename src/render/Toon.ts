import {
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
} from 'three';

/**
 * The toon-cel look on a mobile budget: MeshToonMaterial with a three-band gradient map and a rim
 * term injected into the fragment shader, one directional light, colour and ambient occlusion baked
 * into vertex colours. Three materials cover every lit thing in the game (level, skater, board);
 * everything else here is unlit.
 */

export const PALETTE = {
  concrete: 0xbcb6a8,
  concreteCrease: 0x66625b,
  concreteAlt: 0xb1ab9d,
  /** Ledges, pads, ramp bodies: a shade lighter than the ground so low props separate from it. */
  prop: 0xcbc4b3,
  steel: 0xe2dfd7,
  wood: 0x8a6a48,
  skyTop: 0x2f6fc4,
  skyHorizon: 0xd3e6f8,
  cloud: 0xffffff,
  shirt: 0x2fb3a5,
  pants: 0x2d3757,
  skin: 0xe9b58e,
  shoe: 0x1d1d22,
  cap: 0xe94f37,
  hair: 0x3b2417,
  deck: 0x2a2521,
  deckBottom: 0xd5484f,
  truck: 0x9a9a9a,
  wheel: 0xf3f0ea,
  outline: 0x141216,
  spark: 0xffc860,
  dust: 0xd8d2c4,
} as const;

/** Three hard bands. Values are the lit fraction per band. */
function gradientMap(): DataTexture {
  const data = new Uint8Array([0x52, 0xa8, 0xff]);
  const tex = new DataTexture(data, 3, 1, RedFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
const GRADIENT = gradientMap();

function toonMaterial(opts: { doubleSide?: boolean; rim?: number; rimColor?: number }): MeshToonMaterial {
  const m = new MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: GRADIENT, side: opts.doubleSide ? DoubleSide : FrontSide });
  const rim = opts.rim ?? 0.35;
  const rimColor = new Color(opts.rimColor ?? 0xffffff);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = { value: rim };
    shader.uniforms.rimColor = { value: rimColor };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float rimStrength;\nuniform vec3 rimColor;')
      .replace(
        '#include <opaque_fragment>',
        // Rim: a hard-edged fresnel band for silhouette separation against the level.
        'float rimF = 1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0);\n' +
          'rimF = smoothstep(0.62, 0.72, rimF) * rimStrength;\n' +
          'outgoingLight += rimColor * rimF * (0.35 + 0.65 * max(dot(normal, normalize(vViewPosition)), 0.0));\n' +
          '#include <opaque_fragment>',
      );
  };
  return m;
}

/** The three lit materials. Level geometry is double-sided (thin parametric shells). */
export const LEVEL_MAT = toonMaterial({ doubleSide: true, rim: 0.12 });
export const SKATER_MAT = toonMaterial({ rim: 0.5 });
export const BOARD_MAT = toonMaterial({ rim: 0.3 });

export type PaintKind = 'prop' | 'concave' | 'steel' | 'wood';

const c0 = new Color();
const c1 = new Color();

/** Bake a colour (and a cheap ambient occlusion) into a geometry's vertex colours. */
export function paint(geo: BufferGeometry, kind: PaintKind): BufferGeometry {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const yMin = bb.min.y;
  const ySpan = Math.max(0.01, bb.max.y - bb.min.y);
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    let ao = 1;
    switch (kind) {
      case 'concave': {
        // Dark in the crease at the bottom, full colour toward the lip.
        const h = (y - yMin) / Math.min(ySpan, 1.6);
        ao = 0.55 + 0.45 * smooth(Math.min(1, h));
        c0.setHex(PALETTE.concreteCrease).lerp(c1.setHex(PALETTE.concrete), ao);
        break;
      }
      case 'prop': {
        // Contact shadow on the bottom 12 cm; ledge tops read bright.
        const h = y - yMin;
        ao = 0.62 + 0.38 * smooth(Math.min(1, h / 0.12));
        c0.setHex(PALETTE.prop).multiplyScalar(ao);
        break;
      }
      case 'steel':
        c0.setHex(PALETTE.steel);
        break;
      case 'wood':
        c0.setHex(PALETTE.wood);
        break;
    }
    colors[i * 3] = c0.r;
    colors[i * 3 + 1] = c0.g;
    colors[i * 3 + 2] = c0.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geo;
}

/** Flat colour into vertex colours. */
export function paintFlat(geo: BufferGeometry, hex: number, scale = 1): BufferGeometry {
  const n = geo.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  c0.setHex(hex).multiplyScalar(scale);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c0.r;
    colors[i * 3 + 1] = c0.g;
    colors[i * 3 + 2] = c0.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geo;
}

/** A level mesh: painted geometry on the shared level material. */
export function levelMesh(geo: BufferGeometry, kind: PaintKind): Mesh {
  const m = new Mesh(paint(geo, kind), LEVEL_MAT);
  m.receiveShadow = true;
  if (kind !== 'concave') m.castShadow = true;
  return m;
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

// --- outlines --------------------------------------------------------------------------------

/**
 * Inverted-hull outline material: back faces pushed out along the normal in object space. Works
 * on SkinnedMesh too because the offset is applied before the skinning chunk. One material per
 * width; hero objects only.
 */
export function outlineMaterial(width: number): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: PALETTE.outline, side: BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.outlineWidth = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineWidth;')
      .replace('#include <begin_vertex>', 'vec3 transformed = position + normalize(normal) * outlineWidth;');
  };
  return m;
}

/** Sibling mesh that draws the hull for `src`, sharing geometry (and skeleton, for skinned meshes). */
export function addOutline(src: Mesh, material: Material): Mesh {
  const hull = new (src.constructor as new (g: BufferGeometry, m: Material) => Mesh)(src.geometry, material);
  const skinned = src as Mesh & { isSkinnedMesh?: boolean; skeleton?: unknown; bindMatrix?: unknown; bindMatrixInverse?: unknown };
  if (skinned.isSkinnedMesh) {
    const h = hull as unknown as { skeleton: unknown; bindMatrix: unknown; bindMatrixInverse: unknown; bindMode: string };
    h.skeleton = skinned.skeleton;
    h.bindMatrix = skinned.bindMatrix;
    h.bindMatrixInverse = skinned.bindMatrixInverse;
    h.bindMode = 'attached';
  }
  hull.frustumCulled = src.frustumCulled;
  hull.castShadow = false;
  hull.receiveShadow = false;
  src.add(hull);
  return hull;
}

// --- sky -------------------------------------------------------------------------------------

/** Two-colour vertical gradient on an inverted sphere, drawn behind everything, no fog. */
export function skyDome(radius: number): Mesh {
  const mat = new ShaderMaterial({
    uniforms: { top: { value: new Color(PALETTE.skyTop) }, horizon: { value: new Color(PALETTE.skyHorizon) } },
    vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 horizon; varying float vY;\n' +
      'void main(){ float t = smoothstep(-0.02, 0.55, vY); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }',
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  const m = new Mesh(new SphereGeometry(radius, 24, 12), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

/** Four soft billboard clouds sharing one procedural texture. */
export function clouds(center: Vector3): Group {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = size * 2;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const blobs: [number, number, number][] = [[0.3, 0.6, 0.28], [0.5, 0.45, 0.36], [0.7, 0.58, 0.3], [0.42, 0.7, 0.22], [0.6, 0.72, 0.24]];
  for (const [x, y, r] of blobs) {
    const g = ctx.createRadialGradient(x * cv.width, y * cv.height, 0, x * cv.width, y * cv.height, r * size);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);
  }
  const tex = new CanvasTexture(cv);
  const mat = new SpriteMaterial({ map: tex, color: PALETTE.cloud, transparent: true, depthWrite: false, fog: false });
  const group = new Group();
  const placements: [number, number, number, number][] = [
    [-120, 48, -160, 70],
    [90, 55, -170, 90],
    [170, 40, 40, 60],
    [-160, 44, 120, 75],
  ];
  for (const [x, y, z, s] of placements) {
    const sp = new Sprite(mat);
    sp.position.set(center.x + x, y, center.z + z);
    sp.scale.set(s, s / 2, 1);
    sp.renderOrder = -9;
    group.add(sp);
  }
  return group;
}
