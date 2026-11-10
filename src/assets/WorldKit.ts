import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSeededRandom } from '../utils/random';
import type { MaterialLibrary } from './MaterialLibrary';
import { plaqueTexture } from './ProceduralTextures';

const UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

/** Tapered open cylinder from p0 to p1 with bark-friendly UVs. */
export function limb(p0: THREE.Vector3, p1: THREE.Vector3, r0: number, r1: number, radial = 7): THREE.BufferGeometry {
  tmpDir.subVectors(p1, p0);
  const len = tmpDir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 2, true);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, r0 * 8), uv.getY(i) * len * 0.8);
  g.translate(0, len / 2, 0);
  tmpQuat.setFromUnitVectors(UP, tmpDir.normalize());
  g.applyQuaternion(tmpQuat);
  g.translate(p0.x, p0.y, p0.z);
  return g;
}

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Lumpy faceted blob with per-face colour (leaf/blossom clusters, rocks). */
export function lumpyBlob(
  radius: number,
  detail: number,
  jitter: number,
  colorFn: ((rng: () => number) => THREE.Color) | null,
  rng: () => number,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = hash3(Math.round(v.x * 50), Math.round(v.y * 50), Math.round(v.z * 50));
    v.multiplyScalar(1 + (h - 0.5) * jitter);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  if (colorFn) {
    const colors = new Float32Array(pos.count * 3);
    for (let f = 0; f < pos.count; f += 3) {
      const c = colorFn(rng);
      for (let k = 0; k < 3; k++) {
        colors[(f + k) * 3] = c.r;
        colors[(f + k) * 3 + 1] = c.g;
        colors[(f + k) * 3 + 2] = c.b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  g.computeVertexNormals();
  return g;
}

export interface TreeTemplate {
  trunk: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
  /** Local hang points for peaches (under branches, reachable height). */
  anchors: THREE.Vector3[];
  trunkRadius: number;
}

/** A smooth curved branch, with continuous radial normals and longitudinal bark UVs. */
function curvedBranch(points: THREE.Vector3[], startRadius: number, endRadius: number, segments: number, radial: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const n = new THREE.Vector3();
  const length = curve.getLength();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, p = curve.getPointAt(t);
    const radius = THREE.MathUtils.lerp(startRadius, endRadius, t);
    for (let j = 0; j <= radial; j++) {
      const angle = j / radial * Math.PI * 2;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(angle)).addScaledVector(frames.binormals[i], Math.sin(angle));
      // Subtle fluting gives the bark a living, asymmetric surface without flat facets.
      const r = radius * (1 + 0.045 * Math.sin(angle * 3 + t * 2.4));
      positions.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      n.addScaledVector(frames.tangents[i], (startRadius - endRadius) / Math.max(length, 0.01)).normalize();
      normals.push(n.x, n.y, n.z);
      uvs.push(j / radial * Math.max(0.35, startRadius * 5), t * length * 1.1);
      if (i < segments && j < radial) {
        const a = i * (radial + 1) + j, b = a + radial + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** Pruned orchard peach tree with curved wood and individual leafy spray silhouettes. */
export function buildTreeTemplate(seed: number): TreeTemplate {
  const rng = createSeededRandom(seed);
  const limbs: THREE.BufferGeometry[] = [];
  const anchors: THREE.Vector3[] = [];
  const leafPositions: number[] = [], leafNormals: number[] = [], leafUvs: number[] = [], leafColors: number[] = [], leafIndices: number[] = [];
  let cardCount = 0;
  const rotation = new THREE.Quaternion(), euler = new THREE.Euler();
  const local = new THREE.Vector3(), normal = new THREE.Vector3();

  // Each small, gently folded card carries a sparse leafy twig, never a solid canopy shell.
  const leafSpray = (center: THREE.Vector3, size: number, blossom: boolean): void => {
    const base = leafPositions.length / 3;
    euler.set((rng() - 0.5) * 2.0, rng() * Math.PI * 2, (rng() - 0.5) * 1.5);
    rotation.setFromEuler(euler);
    const variant = blossom ? 3 : Math.floor(rng() * 3);
    const tileX = variant % 2, tileY = Math.floor(variant / 2);
    const tint = new THREE.Color().setHSL(0.20 + rng() * 0.045, 0.15 + rng() * 0.1, 0.68 + rng() * 0.18);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
      const x = (col / 2 - 0.5) * size;
      const y = (row - 0.5) * size * 0.8;
      local.set(x, y, col === 1 ? size * 0.085 : 0).applyQuaternion(rotation).add(center);
      leafPositions.push(local.x, local.y, local.z);
      // Continuous rounded normals avoid a planar flash as the lantern sweeps across a spray.
      normal.set(x * 0.8, y * 0.6, size * 0.8).normalize().applyQuaternion(rotation);
      leafNormals.push(normal.x, normal.y, normal.z);
      leafUvs.push((tileX + 0.015 + col / 2 * 0.97) / 2, (tileY + 0.015 + row * 0.97) / 2);
      leafColors.push(tint.r, tint.g, tint.b);
    }
    leafIndices.push(base, base + 1, base + 3, base + 1, base + 4, base + 3, base + 1, base + 2, base + 4, base + 2, base + 5, base + 4);
    cardCount++;
  };
  const crown = (at: THREE.Vector3, radius: number, sprays: number): void => {
    for (let i = 0; i < sprays; i++) {
      const azimuth = rng() * Math.PI * 2;
      const distance = Math.sqrt(rng()) * radius;
      const center = at.clone().add(new THREE.Vector3(Math.cos(azimuth) * distance, (rng() - 0.25) * radius * 0.65, Math.sin(azimuth) * distance));
      leafSpray(center, 0.64 + rng() * 0.34, rng() < 0.045);
    }
  };

  const height = 1.6 + rng() * 0.35;
  const leanX = (rng() - 0.5) * 0.38, leanZ = (rng() - 0.5) * 0.38;
  const trunkR = 0.24 + rng() * 0.08;
  const trunkPoints = [
    new THREE.Vector3(0, -0.06, 0),
    new THREE.Vector3(-leanX * 0.25, height * 0.32, leanZ * 0.4),
    new THREE.Vector3(leanX * 0.5, height * 0.7, leanZ),
    new THREE.Vector3(leanX, height, leanZ * 0.75),
  ];
  limbs.push(curvedBranch(trunkPoints, trunkR * 1.22, trunkR * 0.42, 12, 16));
  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * Math.PI * 2 + rng() * 0.45;
    const rootEnd = new THREE.Vector3(Math.cos(angle) * (0.65 + rng() * 0.18), -0.04, Math.sin(angle) * (0.65 + rng() * 0.18));
    const mid = rootEnd.clone().multiplyScalar(0.45).setY(0.16);
    limbs.push(curvedBranch([new THREE.Vector3(0, 0.32, 0), mid, rootEnd], trunkR * 0.42, 0.02, 4, 7));
  }

  const branches = 5 + Math.floor(rng() * 2), azimuth0 = rng() * Math.PI * 2;
  for (let i = 0; i < branches; i++) {
    const azimuth = azimuth0 + i / branches * Math.PI * 2 + (rng() - 0.5) * 0.3;
    const length = 1.45 + rng() * 0.6;
    const start = trunkPoints[2].clone().lerp(trunkPoints[3], 0.35 + rng() * 0.55);
    const spread = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
    const mid = start.clone().addScaledVector(spread, length * 0.55).add(new THREE.Vector3(0, 0.12 + rng() * 0.15, 0));
    const end = start.clone().addScaledVector(spread, length).add(new THREE.Vector3(0, 0.7 + rng() * 0.25, 0));
    const tip = end.clone().addScaledVector(spread, 0.25).add(new THREE.Vector3(0, 0.2, 0));
    limbs.push(curvedBranch([start, mid, end, tip], 0.115 + rng() * 0.025, 0.018, 9, 10));
    // Forks and terminal twigs support open, irregular volumes of foliage.
    for (const side of [-1, 1]) {
      const branchStart = mid.clone().lerp(end, 0.25 + rng() * 0.2);
      const sideways = new THREE.Vector3(-spread.z, 0, spread.x).multiplyScalar(side);
      const twigMid = branchStart.clone().addScaledVector(sideways, 0.4).addScaledVector(spread, 0.13).add(new THREE.Vector3(0, 0.15, 0));
      const twigEnd = twigMid.clone().addScaledVector(sideways, 0.25 + rng() * 0.12).add(new THREE.Vector3(0, 0.28, 0));
      limbs.push(curvedBranch([branchStart, twigMid, twigEnd], 0.042, 0.008, 5, 6));
      crown(twigEnd, 0.55, 13);
    }
    crown(end.clone().lerp(tip, 0.5), 0.72, 21);
    crown(mid.clone().lerp(end, 0.4).add(new THREE.Vector3(0, 0.2, 0)), 0.5, 10);
    for (const at of [mid, mid.clone().lerp(end, 0.58)]) {
      const hang = at.clone().add(new THREE.Vector3(0, -0.3, 0));
      if (hang.y > 1.25 && hang.y < 2.45) anchors.push(hang);
    }
  }
  crown(trunkPoints[3].clone().add(new THREE.Vector3(0, 0.7, 0)), 0.68, 28);

  const trunk = mergeGeometries(limbs);
  for (const geometry of limbs) geometry.dispose();
  if (!trunk) throw new Error('Unable to merge natural tree branches');
  const canopy = new THREE.BufferGeometry();
  canopy.setAttribute('position', new THREE.Float32BufferAttribute(leafPositions, 3));
  canopy.setAttribute('normal', new THREE.Float32BufferAttribute(leafNormals, 3));
  canopy.setAttribute('uv', new THREE.Float32BufferAttribute(leafUvs, 2));
  canopy.setAttribute('color', new THREE.Float32BufferAttribute(leafColors, 3));
  canopy.setIndex(leafIndices);
  canopy.userData.foliage = 'alpha-leaf-sprays';
  canopy.userData.sprayCount = cardCount;
  trunk.userData.branching = 'curved-tapered';
  trunk.computeBoundingSphere();
  canopy.computeBoundingSphere();
  return { trunk, canopy, anchors, trunkRadius: trunkR };
}

/** Flat "donut" peach (pan-tao) lathe with tier-specific blush vertex colours. */
export function buildPeachGeometry(tier: number): THREE.BufferGeometry {
  const s = 1.25;
  const profile = [
    [0.0, -0.032],
    [0.02, -0.04],
    [0.05, -0.05],
    [0.09, -0.046],
    [0.118, -0.026],
    [0.127, 0.0],
    [0.12, 0.022],
    [0.096, 0.044],
    [0.06, 0.054],
    [0.03, 0.046],
    [0.012, 0.036],
    [0.0, 0.03],
  ].map(([r, y]) => new THREE.Vector2(r * s, y * s));
  const g = new THREE.LatheGeometry(profile, 28);
  // suture groove: pinch along one meridian
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const palettes: [string, string, string][] = [
    ['#e8d6a0', '#e48a6a', '#b84a4a'],
    ['#f5d0b4', '#ff6f8f', '#d42a5c'],
    ['#ffe08a', '#ffb43a', '#ff7a2a'],
    ['#f4fbff', '#c8f2ff', '#ffd6f4'],
  ];
  const [base, blush, deep] = palettes[tier].map((c) => new THREE.Color(c));
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const groove = Math.exp(-Math.pow(Math.sin(ang * 0.5), 2) * 60);
    const r = Math.sqrt(x * x + z * z);
    if (r > 0.02) {
      const k = 1 - groove * 0.06;
      pos.setX(i, x * k);
      pos.setZ(i, z * k);
    }
    const side = 0.5 + 0.5 * Math.cos(ang - 1.2);
    const top = THREE.MathUtils.clamp((y / s + 0.05) / 0.1, 0, 1);
    c.copy(base).lerp(blush, side * 0.85).lerp(deep, Math.pow(side, 3) * top * 0.6);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Stem + two leaves sitting on top of a peach. */
export function buildPeachLeafGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.05, 0.05, 0, 0.16);
  shape.quadraticCurveTo(-0.05, 0.05, 0, 0);
  const a = new THREE.ShapeGeometry(shape, 4);
  a.rotateX(-1.1);
  a.rotateY(0.4);
  a.translate(0, 0.07, 0);
  const b = a.clone().rotateY(Math.PI * 0.9);
  const stem = new THREE.CylinderGeometry(0.008, 0.012, 0.32, 4);
  stem.translate(0, 0.2, 0);
  stem.deleteAttribute('uv');
  a.deleteAttribute('uv');
  b.deleteAttribute('uv');
  return mergeGeometries([a, b, stem.toNonIndexed()].map((g) => (g.index ? g.toNonIndexed() : g)));
}

/** Clump of curved grass blades with vertex-colour gradient. */
export function buildGrassClump(rng: () => number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const base = new THREE.Color('#1c3026');
  const tip = new THREE.Color('#7aa070');
  const blades = 6;
  for (let i = 0; i < blades; i++) {
    const a = rng() * Math.PI * 2;
    const h = 0.25 + rng() * 0.35;
    const w = 0.035;
    const ox = (rng() - 0.5) * 0.25;
    const oz = (rng() - 0.5) * 0.25;
    const bend = 0.12 + rng() * 0.15;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz * w;
    const pz = dx * w;
    // two-segment blade
    const p = [
      [ox - px, 0, oz - pz],
      [ox + px, 0, oz + pz],
      [ox + dx * bend * 0.4 - px * 0.6, h * 0.55, oz + dz * bend * 0.4 - pz * 0.6],
      [ox + dx * bend * 0.4 + px * 0.6, h * 0.55, oz + dz * bend * 0.4 + pz * 0.6],
      [ox + dx * bend, h, oz + dz * bend],
    ];
    const tris = [
      [0, 1, 2],
      [1, 3, 2],
      [2, 3, 4],
    ];
    for (const tri of tris) {
      for (const k of tri) {
        positions.push(p[k][0], p[k][1], p[k][2]);
        const c = base.clone().lerp(tip, p[k][1] / h);
        colors.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export function buildRockGeometry(rng: () => number): THREE.BufferGeometry {
  const g = lumpyBlob(0.5, 1, 0.6, null, rng);
  g.scale(1, 0.55, 0.8);
  g.translate(0, 0.12, 0);
  return g;
}

/** Stone lantern (石灯笼): returns stone body and glowing firebox geometries. */
export function buildStoneLantern(): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(0.32, 0.4, 0.2, 6);
  base.translate(0, 0.1, 0);
  const post = new THREE.CylinderGeometry(0.11, 0.14, 0.75, 6);
  post.translate(0, 0.57, 0);
  const plate = new THREE.CylinderGeometry(0.3, 0.26, 0.1, 6);
  plate.translate(0, 0.99, 0);
  const pillarA = new THREE.BoxGeometry(0.06, 0.32, 0.06);
  const pillars: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    pillars.push(pillarA.clone().translate(Math.cos(a) * 0.19, 1.2, Math.sin(a) * 0.19));
  }
  const roof = new THREE.ConeGeometry(0.45, 0.3, 6);
  roof.translate(0, 1.5, 0);
  const knob = new THREE.SphereGeometry(0.07, 6, 4);
  knob.translate(0, 1.7, 0);
  parts.push(base, post, plate, ...pillars, roof, knob);
  const body = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  const glow = new THREE.BoxGeometry(0.28, 0.26, 0.28);
  glow.translate(0, 1.2, 0);
  return { body, glow };
}

/** Red paper lantern (lathe). */
export function buildPaperLantern(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const r = 0.04 + Math.sin(t * Math.PI) * 0.19;
    pts.push(new THREE.Vector2(r, t * 0.42 - 0.21));
  }
  return new THREE.LatheGeometry(pts, 14);
}

/** Paifang memorial archway with sweeping roof, plaque and paper lanterns. */
export function buildPaifang(
  mats: MaterialLibrary,
  opts: { width: number; height: number; text: string; lanterns: boolean },
): { root: THREE.Group; lanterns: THREE.Mesh[]; pillarOffsets: number[] } {
  const root = new THREE.Group();
  const { width: w, height: h } = opts;
  const pillarOffsets = [-w / 2, w / 2];
  for (const x of pillarOffsets) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, h, 10), mats.lacquer);
    pillar.position.set(x, h / 2, 0);
    pillar.castShadow = true;
    root.add(pillar);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.62), mats.stone);
    base.position.set(x, 0.25, 0);
    root.add(base);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 10), mats.gold);
    cap.position.set(x, 0.56, 0);
    root.add(cap);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.9, 0.26, 0.3), mats.lacquer);
  beam.position.y = h - 0.25;
  root.add(beam);
  const beam2 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.18, 0.26), mats.lacquer);
  beam2.position.y = h - 1.05;
  root.add(beam2);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.95, 0.05, 0.34), mats.gold);
  trim.position.y = h - 0.1;
  root.add(trim);

  // sweeping roof: extruded profile with upturned eaves
  const roofShape = new THREE.Shape();
  const rw = w / 2 + 1.0;
  roofShape.moveTo(-rw - 0.25, 0.35);
  roofShape.quadraticCurveTo(-rw + 0.4, -0.05, -rw + 1.0, 0.12);
  roofShape.lineTo(-0.6, 0.55);
  roofShape.lineTo(0.6, 0.55);
  roofShape.lineTo(rw - 1.0, 0.12);
  roofShape.quadraticCurveTo(rw - 0.4, -0.05, rw + 0.25, 0.35);
  roofShape.lineTo(rw - 0.2, 0.0);
  roofShape.lineTo(-rw + 0.2, 0.0);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 1.0, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
  roofGeo.translate(0, 0, -0.5);
  const roof = new THREE.Mesh(roofGeo, mats.roofTile);
  roof.position.y = h;
  roof.castShadow = true;
  root.add(roof);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.16), mats.gold);
  ridge.position.y = h + 0.62;
  root.add(ridge);

  // plaque
  const plaqueMat = new THREE.MeshStandardMaterial({ map: plaqueTexture(opts.text), roughness: 0.5, emissive: '#3a2a10', emissiveIntensity: 0.4 });
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.56, 0.08), [mats.darkWood, mats.darkWood, mats.darkWood, mats.darkWood, plaqueMat, plaqueMat]);
  plaque.position.set(0, h - 0.65, 0.18);
  root.add(plaque);

  const lanterns: THREE.Mesh[] = [];
  if (opts.lanterns) {
    const lg = buildPaperLantern();
    for (const x of [-w / 2 + 0.55, w / 2 - 0.55]) {
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 3), mats.darkWood);
      string.position.set(x, h - 1.4, 0.05);
      root.add(string);
      const lantern = new THREE.Mesh(lg, mats.lanternDark);
      lantern.position.set(x, h - 1.85, 0.05);
      root.add(lantern);
      const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 5), mats.gold);
      tassel.position.set(x, h - 2.16, 0.05);
      tassel.rotation.x = Math.PI;
      root.add(tassel);
      lanterns.push(lantern);
    }
  }
  return { root, lanterns, pillarOffsets };
}
