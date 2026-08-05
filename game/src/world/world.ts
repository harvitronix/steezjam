import * as THREE from "three";
import {
  COURSE_HW,
  GAP,
  LIP_HW,
  LIP_LEN,
  RAIL_H0,
  RAIL_LEN,
  RAIL_SLOPE,
  RAIL_X,
  SEG,
  SLOPE,
  featureLipZ,
  lipLateral,
  lipProfile,
  rollHeight,
  FEATURE_Z0,
} from "./course";
import { makeRng } from "../core/util";

const SKY_TOP = "#1d6fd6";
const SKY_BOTTOM = "#c9e8ff";
const SNOW = "#eef7ff";

// Two feature spacings per tile keeps the roller phase identical in every tile.
const TILE_LEN = 144;
const TILE_COUNT = 6;
const TILE_HALF_W = 90;
const TREE_COUNT = 84;
const TREE_SPAN = 620;

function corduroyTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = SNOW;
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = "rgba(178,208,235,0.55)";
    g.fillRect(i * 16, 0, 3, 64);
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.fillRect(i * 16 + 4, 0, 6, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Builds the sloped, corduroy-groomed base plane for one recycled tile. */
function tileGeometry(): THREE.BufferGeometry {
  const nx = 28;
  const nz = 96;
  const g = new THREE.PlaneGeometry(TILE_HALF_W * 2, TILE_LEN, nx, nz);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    // Bake the fall line and the roller in, so a tile can be moved by whole
    // tile lengths and still line up exactly with groundY().
    pos.setY(i, SLOPE * z + rollHeight(z));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Shaped snow take-off built from the exact same profile the physics uses. */
function lipGeometry(): THREE.BufferGeometry {
  const nz = 18;
  const nx = 22;
  const halfW = LIP_HW + 0.6;
  const verts: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    const d = (j / nz) * LIP_LEN;
    for (let i = 0; i <= nx; i++) {
      const x = -halfW + (i / nx) * halfW * 2;
      const h = lipProfile(d) * lipLateral(x + RAIL_X);
      verts.push(x + RAIL_X, -SLOPE * d + h, -d);
    }
  }
  const row = nx + 1;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d2 = c + 1;
      idx.push(a, b, c, b, d2, c);
    }
  }
  // Vertical end wall so the take-off reads as a real lip edge.
  const base = verts.length / 3;
  for (let i = 0; i <= nx; i++) {
    const x = -halfW + (i / nx) * halfW * 2;
    const h = lipProfile(LIP_LEN) * lipLateral(x + RAIL_X);
    verts.push(x + RAIL_X, -SLOPE * LIP_LEN + h, -LIP_LEN);
    verts.push(x + RAIL_X, -SLOPE * LIP_LEN - 0.35, -LIP_LEN);
  }
  for (let i = 0; i < nx; i++) {
    const a = base + i * 2;
    idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function makeRail(): THREE.Group {
  const g = new THREE.Group();
  // Phong with a hot specular reads as polished steel without needing an
  // environment map, which a metalness workflow would require here.
  // Dark steel with a hot specular: reads clearly against bright snow, which
  // a light chrome finish does not.
  const metal = new THREE.MeshPhongMaterial({
    color: "#5b6773",
    specular: "#ffffff",
    shininess: 120,
  });
  const dark = new THREE.MeshPhongMaterial({
    color: "#343b44",
    specular: "#8a94a0",
    shininess: 40,
  });

  const tilt = Math.atan(RAIL_SLOPE);
  const railLen = RAIL_LEN / Math.cos(tilt);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, railLen), metal);
  bar.castShadow = true;
  // Yellow coping stripe along the slide surface, park-marking style.
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.05, railLen),
    new THREE.MeshLambertMaterial({ color: "#ffc21a" }),
  );
  stripe.position.y = -0.085;
  const barGroup = new THREE.Group();
  barGroup.add(bar);
  barGroup.add(stripe);
  // Rail runs from local z = 0 downhill to z = -RAIL_LEN, top at RAIL_H0.
  barGroup.position.set(RAIL_X, RAIL_H0 - 0.08 - (RAIL_SLOPE * RAIL_LEN) / 2, -RAIL_LEN / 2);
  barGroup.rotation.x = -tilt;
  g.add(barGroup);

  for (let i = 0; i <= 3; i++) {
    const d = (i / 3) * RAIL_LEN;
    const top = RAIL_H0 - RAIL_SLOPE * d;
    const snow = -SLOPE * d;
    const h = Math.max(0.2, top - snow - 0.08);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, h, 8), dark);
    post.position.set(RAIL_X, snow + h / 2, -d);
    post.castShadow = true;
    g.add(post);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.7), dark);
    foot.position.set(RAIL_X, snow + 0.06, -d);
    g.add(foot);
  }
  return g;
}

function makeMarkers(): THREE.Group {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshLambertMaterial({ color: "#ff7a18" });
  const flagMat = new THREE.MeshLambertMaterial({
    color: "#ff2e63",
    side: THREE.DoubleSide,
  });
  const padMat = new THREE.MeshLambertMaterial({ color: "#1d3f8f" });
  const positions: Array<[number, number]> = [
    [-6.5, 6],
    [6.5, 6],
    [-6.5, -4],
    [6.5, -4],
    [-6.5, -18],
    [6.5, -18],
  ];
  // Feature-local z maps onto the roller phase the same way in every feature.
  const deck = (z: number) => SLOPE * z + rollHeight(FEATURE_Z0 + z);
  for (const [x, z] of positions) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), poleMat);
    pole.position.set(x, deck(z) + 0.75, z);
    g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), flagMat);
    flag.position.set(x + (x > 0 ? -0.35 : 0.35), deck(z) + 1.3, z);
    g.add(flag);
  }
  // Padded takeoff markers either side of the lip.
  for (const s of [-1, 1]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 2.4), padMat);
    pad.position.set(s * (LIP_HW + 1.1), deck(-3) + 0.25, -3);
    g.add(pad);
  }
  return g;
}

export interface Feature {
  group: THREE.Group;
  index: number;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  private tiles: THREE.Mesh[] = [];
  private features: Feature[] = [];
  private trees: { trunks: THREE.InstancedMesh; tops: THREE.InstancedMesh; z: number[]; x: number[]; s: number[] };
  private skyRig = new THREE.Group();
  private rng = makeRng(20051013);

  constructor() {
    this.scene.background = new THREE.Color(SKY_BOTTOM);
    this.scene.fog = new THREE.Fog(new THREE.Color("#cfe8fb"), 150, 430);

    const hemi = new THREE.HemisphereLight(0xdff1ff, 0x9fb6cc, 1.5);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff6e0, 2.4);
    sun.position.set(28, 46, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    const s = 26;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    this.scene.add(this.skyRig);
    this.skyRig.add(this.makeSky());
    this.skyRig.add(this.makeMountains());

    const snowMat = new THREE.MeshLambertMaterial({ color: SNOW });
    const tex = corduroyTexture();
    tex.repeat.set(TILE_HALF_W * 2 / 2.4, TILE_LEN / 24);
    tex.anisotropy = 8;
    snowMat.map = tex;

    const tileGeo = tileGeometry();
    for (let i = 0; i < TILE_COUNT; i++) {
      const m = new THREE.Mesh(tileGeo, snowMat);
      m.receiveShadow = true;
      m.position.set(0, 0, 0);
      this.tiles.push(m);
      this.scene.add(m);
    }

    const lipMat = new THREE.MeshLambertMaterial({
      color: "#f4fbff",
      side: THREE.DoubleSide,
    });
    const lipGeo = lipGeometry();
    const railProto = makeRail();
    const markerProto = makeMarkers();
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const lip = new THREE.Mesh(lipGeo, lipMat);
      lip.receiveShadow = true;
      lip.castShadow = true;
      g.add(lip);
      const rail = railProto.clone(true);
      rail.position.z = -(LIP_LEN + GAP);
      rail.position.y = -SLOPE * (LIP_LEN + GAP);
      g.add(rail);
      g.add(markerProto.clone(true));
      this.scene.add(g);
      this.features.push({ group: g, index: -999 });
    }

    this.trees = this.makeTrees();
    this.scene.add(this.trees.trunks);
    this.scene.add(this.trees.tops);

    this.update(0);
  }

  private makeSky(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(SKY_TOP) },
        uBottom: { value: new THREE.Color(SKY_BOTTOM) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uTop;
        uniform vec3 uBottom;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y * 1.6 + 0.08, 0.0, 1.0);
          gl_FragColor = vec4(mix(uBottom, uTop, pow(h, 0.85)), 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 16), mat);
    mesh.renderOrder = -10;
    return mesh;
  }

  private makeMountains(): THREE.Group {
    const g = new THREE.Group();
    const rng = makeRng(77123);
    const far = new THREE.MeshBasicMaterial({ color: "#b6cfe8", fog: false });
    const near = new THREE.MeshBasicMaterial({ color: "#96b6d8", fog: false });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng() * 0.12;
      const dist = 780 + rng() * 340;
      const h = 130 + rng() * 190;
      const r = 150 + rng() * 170;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(r, h, 5 + Math.floor(rng() * 3), 1),
        rng() > 0.5 ? far : near,
      );
      cone.position.set(Math.sin(a) * dist, h * 0.3 - 74, Math.cos(a) * dist);
      cone.rotation.y = rng() * 3;
      g.add(cone);
    }
    return g;
  }

  private makeTrees() {
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.4, 5);
    trunkGeo.translate(0, 0.7, 0);
    const topGeo = new THREE.ConeGeometry(1.5, 5.2, 7);
    topGeo.translate(0, 3.4, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: "#4a3524" });
    const topMat = new THREE.MeshLambertMaterial({ color: "#1f5137" });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
    const tops = new THREE.InstancedMesh(topGeo, topMat, TREE_COUNT);
    tops.castShadow = true;
    // Instances are repositioned as the run recycles, so the pre-computed
    // bounding sphere would cull the whole pool once it drifts.
    trunks.frustumCulled = false;
    tops.frustumCulled = false;
    trunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const z: number[] = [];
    const x: number[] = [];
    const s: number[] = [];
    for (let i = 0; i < TREE_COUNT; i++) {
      z.push(0);
      x.push(0);
      s.push(1);
    }
    const t = { trunks, tops, z, x, s };
    for (let i = 0; i < TREE_COUNT; i++) {
      this.placeTree(t, i, 40 - (i / TREE_COUNT) * TREE_SPAN);
    }
    return t;
  }

  private placeTree(t: World["trees"], i: number, z: number) {
    const side = this.rng() > 0.5 ? 1 : -1;
    const off = COURSE_HW + 3 + this.rng() * 42;
    t.z[i] = z;
    t.x[i] = side * off;
    t.s[i] = 0.7 + this.rng() * 0.9;
    this.writeTree(t, i);
  }

  private writeTree(t: World["trees"], i: number) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3(t.s[i], t.s[i], t.s[i]);
    const p = new THREE.Vector3(t.x[i], SLOPE * t.z[i] + rollHeight(t.z[i]) - 0.2, t.z[i]);
    m.compose(p, q, sc);
    t.trunks.setMatrixAt(i, m);
    t.tops.setMatrixAt(i, m);
    t.trunks.instanceMatrix.needsUpdate = true;
    t.tops.instanceMatrix.needsUpdate = true;
  }

  /** Recycles the bounded pools so the world never grows. */
  update(skierZ: number) {
    const baseTile = Math.round((skierZ + TILE_LEN * 0.6) / TILE_LEN);
    for (let i = 0; i < TILE_COUNT; i++) {
      const tz = (baseTile - i) * TILE_LEN;
      const t = this.tiles[i];
      if (t.position.z !== tz) {
        t.position.set(0, SLOPE * tz, tz);
      }
    }

    const first = Math.max(0, Math.floor((featureLipZ(0) - skierZ) / SEG) - 1);
    for (let k = 0; k < this.features.length; k++) {
      const idx = first + k;
      const f = this.features[k];
      if (f.index !== idx) {
        f.index = idx;
        const lz = featureLipZ(idx);
        f.group.position.set(0, SLOPE * lz, lz);
      }
    }

    const t = this.trees;
    for (let i = 0; i < TREE_COUNT; i++) {
      if (t.z[i] > skierZ + 55) {
        this.placeTree(t, i, t.z[i] - TREE_SPAN);
      }
    }

    this.skyRig.position.z = skierZ;
    this.skyRig.position.y = SLOPE * skierZ;
  }

  /** Keeps the shadow frustum around the skier. */
  focusShadows(x: number, y: number, z: number) {
    this.sun.position.set(x + 28, y + 46, z + 18);
    this.sun.target.position.set(x, y, z);
    this.sun.target.updateMatrixWorld();
  }
}
