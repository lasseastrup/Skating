import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import type { Loop } from '../core/Loop';
import { SkateState, type SkateWorld } from '../sim/SkateWorld';
import { TUNING as T } from '../sim/Tuning';
import type { CameraRig, CameraTarget } from './CameraRig';
import { PALETTE } from './Toon';

/**
 * The juice ladder (Phase 8). Everything here is display: it reads the sim and never writes it.
 *   - frame hitch on hard landings, time dilation after a landed trick
 *   - speed lines above 70% of top speed
 *   - grind sparks with a ribbon trail, wheel dust on hard carves and landings
 *   - a hard blob shadow under the board
 *   - camera kick on impact
 *   - haptics where the browser allows them
 * Five draw calls in total (speed lines, blob, particles, ribbon; the sky is elsewhere).
 */

const UP = new Vector3(0, 1, 0);

// --- speed lines -------------------------------------------------------------------------------

class SpeedLines {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private level = 0;

  constructor() {
    this.mat = new ShaderMaterial({
      uniforms: { intensity: { value: 0 }, time: { value: 0 }, aspect: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: `
        uniform float intensity; uniform float time; uniform float aspect; varying vec2 vUv;
        float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
        void main(){
          vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
          float r = length(p);
          float a = atan(p.y, p.x) / 6.2831853 + 0.5;
          float acc = 0.0;
          for (int layer = 0; layer < 2; layer++) {
            float n = layer == 0 ? 44.0 : 31.0;
            float k = a * n + float(layer) * 0.37;
            float id = floor(k);
            float f = fract(k);
            float rnd = hash(id + float(layer) * 91.0);
            float thin = smoothstep(0.44, 0.5, f) * smoothstep(0.56, 0.5, f);
            float start = 0.32 + 0.3 * rnd + 0.06 * sin(time * (5.0 + 4.0 * rnd) + id);
            float fade = smoothstep(start, start + 0.22, r);
            acc += thin * fade * (0.6 + 0.4 * hash(id * 3.1));
          }
          float alpha = acc * intensity * 0.6;
          gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
  }

  update(speed: number, aspect: number, dt: number, time: number): void {
    const target = Math.max(0, Math.min(1, (Math.abs(speed) / T.topSpeedRef - 0.7) / 0.3));
    this.level += (target - this.level) * Math.min(1, 6 * dt);
    this.mat.uniforms.intensity.value = this.level;
    this.mat.uniforms.time.value = time;
    this.mat.uniforms.aspect.value = aspect;
    this.mesh.visible = this.level > 0.01;
  }
}

// --- particles ---------------------------------------------------------------------------------

const MAX_PARTICLES = 192;

class Particles {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly aux: Float32Array; // size, alpha
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly kind = new Uint8Array(MAX_PARTICLES); // 0 spark, 1 dust
  private next = 0;
  private readonly spark = new Color(PALETTE.spark);
  private readonly dust = new Color(PALETTE.dust);

  constructor() {
    const g = new BufferGeometry();
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.aux = new Float32Array(MAX_PARTICLES * 2);
    g.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('color', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('aux', new BufferAttribute(this.aux, 2).setUsage(DynamicDrawUsage));
    const mat = new ShaderMaterial({
      uniforms: { scale: { value: 400 } },
      vertexShader: `
        attribute vec2 aux; varying vec3 vColor; varying float vAlpha; uniform float scale;
        void main(){
          vColor = color; vAlpha = aux.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aux.x * scale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.3, d) * vAlpha;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    this.points = new Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  setScale(heightPx: number): void {
    (this.points.material as ShaderMaterial).uniforms.scale.value = heightPx * 0.9;
  }

  emit(kind: 0 | 1, p: Vector3, v: Vector3, size: number, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.kind[i] = kind;
    const c = kind === 0 ? this.spark : this.dust;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.aux[i * 2] = size;
    this.aux[i * 2 + 1] = 1;
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) {
        this.aux[i * 2 + 1] = 0;
        continue;
      }
      any = true;
      this.life[i] -= dt;
      const k = this.kind[i];
      const g = k === 0 ? -9.8 : -1.2;
      const drag = k === 0 ? 0.6 : 2.5;
      this.vel[i * 3] *= 1 - drag * dt;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * (1 - drag * dt) + g * dt;
      this.vel[i * 3 + 2] *= 1 - drag * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.aux[i * 2 + 1] = k === 0 ? t : 0.55 * t;
      if (k === 1) this.aux[i * 2] += 0.35 * dt; // dust grows
    }
    const geo = this.points.geometry;
    (geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aux') as BufferAttribute).needsUpdate = true;
    this.points.visible = any;
  }
}

// --- grind ribbon ------------------------------------------------------------------------------

const RIBBON_N = 28;

class Ribbon {
  readonly mesh: Mesh;
  private readonly pts: Float32Array = new Float32Array(RIBBON_N * 3);
  private readonly age: Float32Array = new Float32Array(RIBBON_N).fill(9);
  private head = 0;
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly side = new Vector3();
  private readonly tmp = new Vector3();
  private spacing = 0;

  constructor() {
    const g = new BufferGeometry();
    this.pos = new Float32Array(RIBBON_N * 2 * 3);
    this.alpha = new Float32Array(RIBBON_N * 2);
    g.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('alpha', new BufferAttribute(this.alpha, 1).setUsage(DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < RIBBON_N - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    g.setIndex(idx);
    const mat = new ShaderMaterial({
      uniforms: { color: { value: new Color(PALETTE.spark) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vA; void main(){ if (vA < 0.02) discard; gl_FragColor = vec4(color, vA); }',
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: 2,
    });
    this.mesh = new Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 19;
  }

  /** Feed the contact point while grinding; `dir` is the travel direction. */
  push(p: Vector3, dir: Vector3, dt: number): void {
    this.spacing += dt;
    if (this.spacing < 1 / 60) return;
    this.spacing = 0;
    this.head = (this.head + 1) % RIBBON_N;
    this.pts[this.head * 3] = p.x;
    this.pts[this.head * 3 + 1] = p.y;
    this.pts[this.head * 3 + 2] = p.z;
    this.age[this.head] = 0;
    this.side.crossVectors(dir, UP).normalize();
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < RIBBON_N; i++) {
      this.age[i] += dt;
      const k = (this.head - i + RIBBON_N) % RIBBON_N; // newest first
      const a = Math.max(0, 1 - this.age[k] / 0.45) * (1 - i / RIBBON_N);
      if (a > 0.02) any = true;
      const w = 0.035 + 0.05 * (i / RIBBON_N);
      this.tmp.set(this.pts[k * 3], this.pts[k * 3 + 1], this.pts[k * 3 + 2]);
      const o = i * 6;
      this.pos[o] = this.tmp.x + this.side.x * w;
      this.pos[o + 1] = this.tmp.y + 0.02;
      this.pos[o + 2] = this.tmp.z + this.side.z * w;
      this.pos[o + 3] = this.tmp.x - this.side.x * w;
      this.pos[o + 4] = this.tmp.y + 0.02;
      this.pos[o + 5] = this.tmp.z - this.side.z * w;
      this.alpha[i * 2] = a;
      this.alpha[i * 2 + 1] = a;
    }
    (this.mesh.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('alpha') as BufferAttribute).needsUpdate = true;
    this.mesh.visible = any;
  }
}

// --- the director ------------------------------------------------------------------------------

export class Juice {
  private readonly speedLines = new SpeedLines();
  private readonly particles = new Particles();
  private readonly ribbon = new Ribbon();
  private readonly blob: Mesh;
  private readonly blobMat: MeshBasicMaterial;
  private scene: Scene | null = null;
  private lastLandings = 0;
  private lastPops = 0;
  private lastTrickLands = 0;
  private lastBails = 0;
  private wasGrinding = false;
  private rumbleClock = 0;
  private time = 0;
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly q = new Quaternion();
  private readonly travel = new Vector3();

  constructor(private readonly loop: Loop) {
    this.blobMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.blob = new Mesh(new CircleGeometry(0.42, 18), this.blobMat);
    this.blob.renderOrder = 5;
  }

  attach(scene: Scene, world: SkateWorld): void {
    if (this.scene) {
      this.scene.remove(this.speedLines.mesh, this.particles.points, this.ribbon.mesh, this.blob);
    }
    this.scene = scene;
    scene.add(this.speedLines.mesh, this.particles.points, this.ribbon.mesh, this.blob);
    this.lastLandings = world.landings;
    this.lastPops = world.pops;
    this.lastTrickLands = world.trickLands;
    this.lastBails = world.bails;
  }

  update(w: SkateWorld, t: CameraTarget, rig: CameraRig, dt: number, aspect: number, heightPx: number): void {
    this.time += dt;
    const grounded = w.state === SkateState.Riding || w.state === SkateState.Pushing;
    const grinding = w.state === SkateState.Grinding;

    // --- events ---
    if (w.landings !== this.lastLandings) {
      this.lastLandings = w.landings;
      const impact = w.lastImpact;
      if (impact > 4.5) {
        this.loop.hitch(0.06);
        rig.kick(Math.min(12, impact) * 0.11);
        vibrate(30);
        this.dustBurst(t.pos, w.tangent, 12, 1.4);
      } else if (impact > 2) {
        rig.kick(impact * 0.06);
        vibrate(14);
        this.dustBurst(t.pos, w.tangent, 6, 0.9);
      }
    }
    if (w.trickLands !== this.lastTrickLands) {
      this.lastTrickLands = w.trickLands;
      this.loop.dilate(0.85, 0.2);
    }
    if (w.pops !== this.lastPops) {
      this.lastPops = w.pops;
      vibrate(8);
    }
    if (w.bails !== this.lastBails) {
      this.lastBails = w.bails;
      vibrate(40);
      this.dustBurst(t.pos, w.tangent, 14, 1.6);
    }

    // --- grinding: sparks, ribbon, rumble ---
    if (grinding) {
      const gp = w.grindPoint;
      this.travel.copy(w.tangent).multiplyScalar(Math.sign(w.speed) || 1);
      for (let i = 0; i < 3; i++) {
        this.tmp2.set((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 2.2, (Math.random() - 0.5) * 1.2).addScaledVector(this.travel, -(1 + Math.random() * 2.5) * Math.min(1, Math.abs(w.speed) / 6));
        this.tmp.copy(gp).addScaledVector(this.travel, -0.05 * i);
        this.particles.emit(0, this.tmp, this.tmp2, 0.045 + Math.random() * 0.03, 0.22 + Math.random() * 0.25);
      }
      this.ribbon.push(gp, this.travel, dt);
      this.rumbleClock += dt;
      if (this.rumbleClock > 0.12) {
        this.rumbleClock = 0;
        vibrate(18);
      }
    } else if (this.wasGrinding) {
      this.rumbleClock = 0;
    }
    this.wasGrinding = grinding;

    // --- wheel dust on hard carves ---
    if (grounded && Math.abs(w.speed) > 2.5 && Math.abs(w.yawRate) > 0.9) {
      this.travel.copy(w.tangent).multiplyScalar(Math.sign(w.speed) || 1);
      // Rear wheels: behind the board centre, either side.
      for (const side of [-1, 1]) {
        this.tmp.copy(t.pos).addScaledVector(this.travel, -0.3).addScaledVector(w.binormal, side * 0.11).addScaledVector(w.normal, -T.rideHeight + 0.02);
        this.tmp2.copy(this.travel).multiplyScalar(-0.6 * Math.min(1, Math.abs(w.speed) / 8)).addScaledVector(w.normal, 0.35).addScaledVector(w.binormal, side * 0.3);
        this.particles.emit(1, this.tmp, this.tmp2, 0.18, 0.45 + Math.random() * 0.3);
      }
    }

    // --- blob shadow ---
    if (grounded || grinding) {
      this.blob.position.copy(t.pos).addScaledVector(w.normal, -(T.rideHeight - 0.02));
      this.q.setFromUnitVectors(UP, w.normal);
      this.blob.quaternion.copy(this.q).multiply(FLAT);
      this.blob.scale.setScalar(1);
      this.blobMat.opacity = 0.38;
      this.blob.visible = true;
    } else {
      const f = t.floorAt ? t.floorAt(t.pos) : null;
      if (f === null) this.blob.visible = false;
      else {
        const h = Math.max(0, t.pos.y - f);
        const s = Math.max(0.35, 1 - h / 6);
        this.blob.position.set(t.pos.x, f + 0.02, t.pos.z);
        this.blob.quaternion.copy(FLAT);
        this.blob.scale.setScalar(s);
        this.blobMat.opacity = 0.38 * s;
        this.blob.visible = true;
      }
    }

    this.particles.setScale(heightPx);
    this.particles.update(dt);
    this.ribbon.update(dt);
    this.speedLines.update(w.speed, aspect, dt, this.time);
  }

  private dustBurst(p: Vector3, tangent: Vector3, n: number, spread: number): void {
    for (let i = 0; i < n; i++) {
      this.tmp.copy(p).addScaledVector(tangent, (Math.random() - 0.5) * 0.7);
      this.tmp.y -= T.rideHeight - 0.03;
      this.tmp2.set((Math.random() - 0.5) * spread, 0.3 + Math.random() * 0.8, (Math.random() - 0.5) * spread);
      this.particles.emit(1, this.tmp, this.tmp2, 0.16 + Math.random() * 0.14, 0.5 + Math.random() * 0.4);
    }
  }
}

/** CircleGeometry faces +Z; lay it flat. */
const FLAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

function vibrate(ms: number): void {
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate === 'function') {
    try {
      nav.vibrate(ms);
    } catch {
      /* not allowed here */
    }
  }
}
