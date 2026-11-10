import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from '../assets/MaterialLibrary';
import type { Circle, ColliderGrid } from '../game/LevelPath';
import { createSeededRandom } from '../utils/random';

export interface ChestSite {
  position: THREE.Vector3;
  rotationY: number;
}

export interface ChestInteraction {
  target: number | null;
  progress: number;
  justOpened: boolean;
  rewardTier: 0 | 1 | 2 | 3 | null;
}

export interface TreasureChest {
  readonly index: number;
  readonly position: THREE.Vector3;
  readonly rotationY: number;
  readonly root: THREE.Group;
  readonly lid: THREE.Group;
  readonly contents: THREE.Group;
  opened: boolean;
  rewardTier: 0 | 1 | 2 | 3;
  openAmount: number;
}

const SEARCH_SECONDS = 1.4;
const REACH = 2.6;
const EMPTY: ChestInteraction = { target: null, progress: 0, justOpened: false, rewardTier: null };

/** Lacquered storage chests: horizontal targeting, hold-to-search, one seeded reward per run. */
export class TreasureChests {
  readonly root = new THREE.Group();
  readonly chests: TreasureChest[] = [];
  /** Add these footprints to the level grid once; resetting a run does not add colliders. */
  readonly colliders: Circle[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials: THREE.Material[] = [];
  private searchTarget: number | null = null;
  private searchProgress = 0;

  constructor(mats: MaterialLibrary, sites: readonly ChestSite[], private readonly options: { roll?: (rng: () => number) => 0 | 1 | 2 | 3; blueprints?: boolean } = {}) {
    this.root.name = 'treasure-chests';
    const model = this.buildModel(mats);
    sites.forEach((site, index) => {
      const root = model.clone(true);
      root.name = `treasure-chest-${index}`;
      root.position.copy(site.position);
      root.rotation.y = site.rotationY;
      const position = site.position.clone();
      const lid = root.getObjectByName('chest-lid') as THREE.Group;
      const contents = root.getObjectByName('chest-contents') as THREE.Group;
      this.root.add(root);
      this.chests.push({ index, position, rotationY: site.rotationY, root, lid, contents, opened: false, rewardTier: 0, openAmount: 0 });
      this.colliders.push({ x: position.x, z: position.z, r: 0.56, sight: false });
    });
    this.reset(1);
  }

  reset(seed: number): void {
    const rng = createSeededRandom((seed ^ 0x43484553) >>> 0);
    this.cancelSearch();
    for (const chest of this.chests) {
      chest.opened = false;
      chest.rewardTier = this.options.roll ? this.options.roll(rng) : rng() < 0.18 ? 2 : rng() < 0.55 ? 1 : 0;
      chest.openAmount = 0;
      chest.lid.rotation.x = 0;
      chest.contents.visible = false;
    }
  }

  cancelSearch(): void {
    this.searchTarget = null;
    this.searchProgress = 0;
  }

  /** Vertical look is locked in this game, so proximity and aim are tested on the ground plane. */
  findTarget(eye: THREE.Vector3, forward: THREE.Vector3, colliders: ColliderGrid): TreasureChest | null {
    let target: TreasureChest | null = null;
    let nearest = Infinity;
    const forwardLength = Math.hypot(forward.x, forward.z);
    if (forwardLength < 1e-6) return null;
    for (const chest of this.chests) {
      if (chest.opened) continue;
      const dx = chest.position.x - eye.x;
      const dz = chest.position.z - eye.z;
      const distance = Math.hypot(dx, dz);
      if (distance > REACH || distance < 0.1) continue;
      const alignment = (dx * forward.x + dz * forward.z) / (distance * forwardLength);
      if (alignment < 0.83) continue;
      // No end slack: a wall next to the chest must still stop interaction through it.
      if (colliders.blocksSegment(eye.x, eye.z, chest.position.x, chest.position.z, 0)) continue;
      const score = distance + (1 - alignment) * 0.75;
      if (score < nearest) { nearest = score; target = chest; }
    }
    return target;
  }

  update(
    dt: number,
    eye: THREE.Vector3,
    forward: THREE.Vector3,
    colliders: ColliderGrid,
    holding: boolean,
    enabled: boolean,
  ): ChestInteraction {
    const delta = Math.max(0, Math.min(dt, 0.1));
    for (const chest of this.chests) {
      const wanted = chest.opened ? 1 : 0;
      chest.openAmount += (wanted - chest.openAmount) * (1 - Math.exp(-delta * 8));
      // Rear hinge opens away from the player-facing front; no camera motion is introduced.
      chest.lid.rotation.x = -chest.openAmount * 2.15;
      chest.contents.visible = chest.opened;
    }
    if (!enabled) { this.cancelSearch(); return EMPTY; }
    const target = this.findTarget(eye, forward, colliders);
    if (!target) { this.cancelSearch(); return EMPTY; }
    if (this.searchTarget !== target.index) {
      this.searchTarget = target.index;
      this.searchProgress = 0;
    }
    if (!holding) this.searchProgress = 0;
    else this.searchProgress = Math.min(1, this.searchProgress + delta / SEARCH_SECONDS);
    if (this.searchProgress >= 1) {
      target.opened = true;
      target.contents.visible = true;
      return { target: target.index, progress: 1, justOpened: true, rewardTier: target.rewardTier };
    }
    return { target: target.index, progress: this.searchProgress, justOpened: false, rewardTier: null };
  }

  debugState(): { index: number; position: { x: number; y: number; z: number }; opened: boolean; rewardTier: 0 | 1 | 2 | 3; openAmount: number }[] {
    return this.chests.map(chest => ({
      index: chest.index,
      position: { x: chest.position.x, y: chest.position.y, z: chest.position.z },
      opened: chest.opened,
      rewardTier: chest.rewardTier,
      openAmount: chest.openAmount,
    }));
  }

  dispose(): void {
    this.root.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    this.root.removeFromParent();
    this.root.clear();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.length = 0;
    this.chests.length = 0;
    this.colliders.length = 0;
  }

  private buildModel(mats: MaterialLibrary): THREE.Group {
    const root = new THREE.Group();
    const wood = mats.lacquer.clone();
    wood.color.set(this.options.blueprints ? '#624832' : '#5c2021');
    wood.roughness = 0.64;
    const inside = new THREE.MeshStandardMaterial({ color: '#17110b', roughness: 0.95 });
    this.materials.push(wood, inside);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry =>
      new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const merged = (parts: THREE.BufferGeometry[], material: THREE.Material, parent: THREE.Group, name: string): THREE.Mesh => {
      const geometry = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      if (!geometry) throw new Error(`Unable to build ${name}`);
      this.geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Hollow cabinet: a visible dark tray and four timber panels, not a solid reward cube.
    const timber = [
      box(1.24, 0.12, 0.88, 0, 0.18, 0),
      box(1.24, 0.5, 0.08, 0, 0.47, 0.4),
      box(1.24, 0.5, 0.08, 0, 0.47, -0.4),
      box(0.08, 0.5, 0.72, -0.58, 0.47, 0),
      box(0.08, 0.5, 0.72, 0.58, 0.47, 0),
    ];
    for (const x of [-0.48, 0.48]) for (const z of [-0.3, 0.3]) timber.push(box(0.15, 0.17, 0.15, x, 0.075, z));
    merged(timber, wood, root, 'chest-lacquered-cabinet');
    merged([box(1.06, 0.06, 0.65, 0, 0.25, 0)], inside, root, 'chest-inner-tray');

    const fittings: THREE.BufferGeometry[] = [];
    for (const x of [-0.45, 0.45]) for (const z of [-0.445, 0.445]) fittings.push(box(0.075, 0.51, 0.024, x, 0.46, z));
    for (const y of [0.24, 0.69]) {
      for (const z of [-0.446, 0.446]) fittings.push(box(1.26, 0.04, 0.025, 0, y, z));
      for (const x of [-0.625, 0.625]) fittings.push(box(0.025, 0.04, 0.88, x, y, 0));
    }
    for (const x of [-0.625, 0.625]) {
      const handle = new THREE.TorusGeometry(0.1, 0.015, 4, 10);
      handle.rotateY(Math.PI / 2).translate(x, 0.48, 0);
      fittings.push(handle);
      fittings.push(box(0.035, 0.07, 0.15, x, 0.56, 0));
    }
    for (const x of [-0.45, 0.45]) {
      const hinge = new THREE.CylinderGeometry(0.033, 0.033, 0.12, 6);
      hinge.rotateZ(Math.PI / 2).translate(x, 0.73, -0.45);
      fittings.push(hinge);
    }
    merged(fittings, mats.gold, root, 'chest-bronze-fittings');

    const lid = new THREE.Group();
    lid.name = 'chest-lid';
    lid.position.set(0, 0.73, -0.44);
    root.add(lid);
    // Barrel-domed lid, with a true rear hinge and a slightly oversized eave-like lip.
    const dome = new THREE.CylinderGeometry(0.46, 0.46, 1.29, 12, 1, false, 0, Math.PI);
    dome.rotateZ(Math.PI / 2);
    dome.scale(1, 0.42, 1);
    dome.translate(0, 0, 0.44);
    merged([dome, box(1.3, 0.045, 0.94, 0, 0.015, 0.44)], wood, lid, 'chest-domed-lid');
    const lidFittings = [
      box(1.31, 0.035, 0.025, 0, 0.018, 0.915),
      box(1.31, 0.035, 0.025, 0, 0.018, -0.035),
      box(0.12, 0.18, 0.055, 0, -0.055, 0.92),
    ];
    for (const x of [-0.45, 0.45]) {
      const strap = new THREE.TorusGeometry(0.46, 0.024, 4, 12, Math.PI);
      strap.rotateY(Math.PI / 2).scale(1, 0.42, 1).translate(x, 0.02, 0.44);
      lidFittings.push(strap);
    }
    merged(lidFittings, mats.gold, lid, 'chest-lid-straps-and-lock');
    const keyhole = new THREE.Mesh(new THREE.CircleGeometry(0.018, 8), inside);
    this.geometries.add(keyhole.geometry);
    keyhole.position.set(0, -0.035, 0.95);
    keyhole.name = 'chest-keyhole';
    lid.add(keyhole);

    const contents = new THREE.Group();
    contents.name = 'chest-contents';
    contents.visible = false;
    root.add(contents);
    const coinGeo = this.options.blueprints ? new THREE.BoxGeometry(0.26, 0.015, 0.19) : new THREE.CylinderGeometry(0.085, 0.085, 0.025, 10);
    this.geometries.add(coinGeo);
    const treasureGold = mats.gold.clone();
    treasureGold.metalness = 0.6;
    treasureGold.roughness = 0.45;
    treasureGold.emissive.set('#4d2a04');
    treasureGold.emissiveIntensity = 0.08;
    if (this.options.blueprints) { treasureGold.color.set('#c9ddc8');treasureGold.metalness=0;treasureGold.emissive.set('#10251a'); }
    this.materials.push(treasureGold);
    const coins = new THREE.InstancedMesh(coinGeo, treasureGold, 16);
    const matrix = new THREE.Matrix4();
    const rng = createSeededRandom(518);
    for (let i = 0; i < 16; i++) {
      matrix.makeRotationFromEuler(new THREE.Euler((rng() - 0.5) * 0.6, rng() * Math.PI, (rng() - 0.5) * 0.4));
      matrix.setPosition((rng() - 0.5) * 0.8, 0.62 + rng() * 0.12, (rng() - 0.5) * 0.42);
      coins.setMatrixAt(i, matrix);
    }
    coins.computeBoundingSphere();
    coins.name = 'chest-treasure-coins';
    contents.add(coins);
    return root;
  }
}
