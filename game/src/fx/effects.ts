import * as THREE from "three";

function dotTexture(soft: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  if (soft) {
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.75)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
  } else {
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,240,180,0.9)");
    grad.addColorStop(1, "rgba(255,140,0,0)");
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** Fixed-size particle pool; never allocates after construction. */
export class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private base: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private cursor = 0;
  private count: number;
  private gravity: number;
  private drag: number;
  private fade: boolean;

  constructor(count: number, size: number, soft: boolean, gravity: number, drag: number) {
    this.count = count;
    this.gravity = gravity;
    this.drag = drag;
    this.fade = !soft;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -9999;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size,
      sizeAttenuation: true,
      map: dotTexture(soft),
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: soft ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    color: THREE.Color,
    spread: number,
  ) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    const o = i * 3;
    this.pos[o] = x + (Math.random() - 0.5) * spread;
    this.pos[o + 1] = y + (Math.random() - 0.5) * spread * 0.6;
    this.pos[o + 2] = z + (Math.random() - 0.5) * spread;
    this.vel[o] = vx + (Math.random() - 0.5) * spread * 2.4;
    this.vel[o + 1] = vy + Math.random() * spread * 1.4;
    this.vel[o + 2] = vz + (Math.random() - 0.5) * spread * 2.4;
    this.col[o] = this.base[o] = color.r;
    this.col[o + 1] = this.base[o + 1] = color.g;
    this.col[o + 2] = this.base[o + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  burst(
    n: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    color: THREE.Color,
    spread: number,
  ) {
    for (let k = 0; k < n; k++) this.spawn(x, y, z, vx, vy, vz, life, color, spread);
  }

  update(dt: number) {
    const g = this.geoAttrs();
    const d = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      if (this.life[i] <= 0) {
        this.pos[o + 1] = -9999;
        continue;
      }
      this.vel[o + 1] -= this.gravity * dt;
      this.vel[o] *= d;
      this.vel[o + 1] *= d;
      this.vel[o + 2] *= d;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.fade) {
        // Additive pools fade out cleanly by dimming toward black.
        const f = this.life[i] / this.maxLife[i];
        this.col[o] = this.base[o] * f;
        this.col[o + 1] = this.base[o + 1] * f;
        this.col[o + 2] = this.base[o + 2] * f;
      }
    }
    g.position.needsUpdate = true;
    g.color.needsUpdate = true;
  }

  private geoAttrs() {
    const geo = this.points.geometry;
    return {
      position: geo.attributes.position as THREE.BufferAttribute,
      color: geo.attributes.color as THREE.BufferAttribute,
    };
  }
}

export class Effects {
  readonly snow = new ParticlePool(520, 0.26, true, 6.5, 1.2);
  readonly sparks = new ParticlePool(220, 0.12, false, 9.5, 0.6);
  private white = new THREE.Color("#ffffff");
  private blue = new THREE.Color("#cfe6ff");
  private spark = new THREE.Color("#ffb03a");

  constructor(scene: THREE.Scene) {
    scene.add(this.snow.points);
    scene.add(this.sparks.points);
  }

  carve(x: number, y: number, z: number, side: number, power: number) {
    this.snow.spawn(
      x - side * 0.25,
      y + 0.06,
      z,
      -side * (1.4 + power * 3.2),
      1.1 + power * 1.9,
      1.6 + power * 2.2,
      0.5 + Math.random() * 0.25,
      Math.random() > 0.4 ? this.white : this.blue,
      0.24,
    );
  }

  landing(x: number, y: number, z: number, power: number) {
    this.snow.burst(22, x, y + 0.1, z, 0, 1.6 + power, 2.2, 0.6, this.white, 0.8);
  }

  bail(x: number, y: number, z: number) {
    this.snow.burst(34, x, y + 0.2, z, 0, 2.4, 2.6, 0.8, this.white, 1.4);
  }

  railSparks(x: number, y: number, z: number, n: number) {
    this.sparks.burst(n, x, y, z, 0, 1.1, 2.4, 0.34, this.spark, 0.22);
  }

  update(dt: number) {
    this.snow.update(dt);
    this.sparks.update(dt);
  }
}
