import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from './MaterialLibrary';
import type { Circle } from '../game/LevelPath';

export interface AncientHall {
  root: THREE.Group;
  colliders: Circle[];
  chest: THREE.Vector3;
  entries: THREE.Vector3[];
  /** Full reserved courtyard footprint, including door approaches. */
  halfWidth: number;
  halfDepth: number;
  materials: THREE.Material[];
}

/** Enterable timber hall in a four-opening plaster courtyard. Local north/south doors align. */
export function buildAncientHall(mats: MaterialLibrary): AncientHall {
  const root = new THREE.Group();
  root.name = 'ancient-courtyard-hall';
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const plaster = new THREE.MeshStandardMaterial({ color: '#a6a192', map: mats.stoneTex, roughness: 0.98 });
  const masonry = new THREE.MeshStandardMaterial({ color: '#545a57', map: mats.stoneTex, roughness: 0.95 });
  const paper = new THREE.MeshStandardMaterial({ color: '#605c45', roughness: 1 });
  const add = (geo: THREE.BufferGeometry, material: THREE.Material): void => {
    const list = batches.get(material) ?? [];
    list.push(geo.toNonIndexed());
    geo.dispose();
    batches.set(material, list);
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material): void => {
    add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), mat);
  };
  const cylinder = (r: number, h: number, x: number, y: number, z: number, mat: THREE.Material): void => {
    add(new THREE.CylinderGeometry(r, r * 1.08, h, 8).translate(x, y, z), mat);
  };
  const colliders: Circle[] = [];
  const wallCollision = (x0: number, z0: number, x1: number, z1: number): void => {
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.35);
    for (let i = 0; i <= steps; i++) {
      const u = i / Math.max(1, steps);
      colliders.push({ x: x0 + (x1 - x0) * u, z: z0 + (z1 - z0) * u, r: 0.22, sight: true, wall: true });
    }
  };
  // Flush floor: the player's fixed-height controller must never climb a hidden step.
  box(6.4, 0.04, 8, 0, 0.015, 0, mats.stone);
  for (const x of [-3.2, 3.2]) {
    box(0.28, 2.85, 8, x, 1.43, 0, plaster);
    box(0.38, 0.36, 8.2, x, 0.18, 0, masonry);
    wallCollision(x, -4, x, 4);
    // Opaque lattice windows are readable facade detail, not fake walkable openings.
    for (const z of [-1.7, 1.7]) {
      box(0.32, 1.18, 1.5, x, 1.9, z, mats.darkWood);
      box(0.34, 0.9, 1.26, x, 1.9, z, paper);
      for (let k = -2; k <= 2; k++) box(0.38, 1.05, 0.045, x, 1.9, z + k * 0.25, mats.darkWood);
      for (const y of [1.55, 1.9, 2.25]) box(0.38, 0.045, 1.4, x, y, z, mats.darkWood);
    }
  }
  for (const z of [-4, 4]) {
    for (const sign of [-1, 1]) {
      box(1.95, 2.85, 0.28, sign * 2.225, 1.43, z, plaster);
      box(2.02, 0.36, 0.4, sign * 2.225, 0.18, z, masonry);
      wallCollision(sign * 1.25, z, sign * 3.2, z);
      cylinder(0.15, 3.25, sign * 1.3, 1.625, z + Math.sign(z) * 0.18, mats.lacquer);
    }
    box(6.7, 0.26, 0.42, 0, 3.12, z, mats.darkWood);
    box(2.8, 0.12, 0.48, 0, 2.88, z, mats.lacquer);
  }
  for (const x of [-3.45, 3.45]) for (const z of [-4.12, 4.12]) {
    cylinder(0.18, 3.45, x, 1.725, z, mats.lacquer);
    box(0.54, 0.16, 0.54, x, 0.08, z, masonry);
    // Layered bracket arms under each roof corner.
    for (let i = 0; i < 3; i++) {
      box(0.6 + i * 0.18, 0.1, 0.65 + i * 0.15, x, 3.08 + i * 0.15, z, mats.darkWood);
    }
  }
  // Curved gable roof, upturned corners, ceramic seams, ridge finials.
  const profile = [[-4.25, 3.77], [-3.5, 3.55], [-2.4, 4.03], [0, 5.02], [2.4, 4.03], [3.5, 3.55], [4.25, 3.77]];
  const verts: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const rows = 13;
  for (let j = 0; j <= rows; j++) {
    const z = -5.15 + j / rows * 10.3;
    for (const [x, y] of profile) {
      verts.push(x, y + Math.pow(Math.abs(z) / 5.15, 6) * Math.pow(Math.abs(x) / 4.25, 2) * 0.42, z);
      uv.push((x + 4.25) / 2, z / 2);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < profile.length - 1; i++) {
    const a = j * profile.length + i;
    index.push(a, a + profile.length, a + 1, a + 1, a + profile.length, a + profile.length + 1);
  }
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  roof.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roof.setIndex(index);
  roof.computeVertexNormals();
  const ceiling = roof.clone();
  const underside = ceiling.getIndex()!;
  for (let i = 0; i < underside.count; i += 3) {
    const b = underside.getX(i + 1);
    underside.setX(i + 1, underside.getX(i + 2));
    underside.setX(i + 2, b);
  }
  ceiling.computeVertexNormals();
  add(ceiling, mats.darkWood);
  add(roof, mats.roofTile);
  for (let z = -5.1; z <= 5.1; z += 0.5) {
    const points = profile.map(([x, y]) => new THREE.Vector3(x, y + 0.04 + Math.pow(Math.abs(z) / 5.15, 6) * Math.pow(Math.abs(x) / 4.25, 2) * 0.42, z));
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 12, 0.045, 4, false), mats.roofTile);
  }
  add(new THREE.CylinderGeometry(0.13, 0.13, 10.7, 8).rotateX(Math.PI / 2).translate(0, 5.09, 0), mats.roofTile);
  for (const sign of [-1, 1]) {
    const finial = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 5.1, sign * 4.8), new THREE.Vector3(0, 5.3, sign * 5.25), new THREE.Vector3(0, 5.75, sign * 5.45)]);
    add(new THREE.TubeGeometry(finial, 6, 0.1, 5, false), mats.roofTile);
  }
  // Courtyard walls have four generous gaps; alternate halls turn the openings east/west.
  for (const z of [-7.2, 7.2]) for (const sign of [-1, 1]) {
    box(3.5, 2.1, 0.3, sign * 3.75, 1.05, z, plaster);
    box(3.68, 0.12, 0.6, sign * 3.75, 2.16, z, mats.roofTile);
    box(3.6, 0.3, 0.4, sign * 3.75, 0.15, z, masonry);
    wallCollision(sign * 2, z, sign * 5.5, z);
  }
  for (const x of [-5.5, 5.5]) for (const sign of [-1, 1]) {
    box(0.3, 2.1, 5.4, x, 1.05, sign * 4.5, plaster);
    box(0.6, 0.12, 5.55, x, 2.16, sign * 4.5, mats.roofTile);
    box(0.4, 0.3, 5.5, x, 0.15, sign * 4.5, masonry);
    wallCollision(x, sign * 1.8, x, sign * 7.2);
  }
  for (const [material, geometries] of batches) {
    const geo = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!geo) throw new Error('Could not merge ancient architecture geometry');
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = material === plaster ? 'hall-plaster-walls' : material === mats.roofTile ? 'hall-tiled-eaves' : 'hall-timber-detail';
    root.add(mesh);
  }
  return {
    root, colliders, chest: new THREE.Vector3(-1.65, 0, 0),
    entries: [new THREE.Vector3(0, 0, 8.5), new THREE.Vector3(0, 0, -8.5), new THREE.Vector3(6.5, 0, 0), new THREE.Vector3(-6.5, 0, 0)],
    halfWidth: 6.5, halfDepth: 8.5, materials: [plaster, masonry, paper],
  };
}
