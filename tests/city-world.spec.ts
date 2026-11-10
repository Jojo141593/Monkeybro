import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import type { CityWorld } from '../src/game/city/CityWorld';

type CityHarness = { world: CityWorld; loop: { stop(): void } };
async function boot(page: Page): Promise<void> {
  await page.goto('/monkeytest/');
  await page.locator('[data-level="city"]').click();
  await page.locator('#start-button').click();
  await page.waitForFunction(() => !!(window as unknown as { __CITY__?: CityHarness }).__CITY__);
  await page.evaluate(() => (window as unknown as { __CITY__: CityHarness }).__CITY__.loop.stop());
}

test('city contains original varied architecture, tall instanced foliage and appropriately sized doorways', async ({ page }) => {
  await boot(page);
  const report = await page.evaluate(() => {
    const w = (window as unknown as { __CITY__: CityHarness }).__CITY__.world;
    const house = w.buildings[0], axis = house.center.clone().set(Math.sin(house.root.rotation.y), 0, Math.cos(house.root.rotation.y));
    const outside = house.doorway.clone().addScaledVector(axis, 1.5), inside = house.doorway.clone().addScaledVector(axis, -1.5);
    const trees: { height: number; smooth: boolean; alpha: number; count: number }[] = [];
    w.root.traverse(object => {
      if (object.name !== 'city-instanced-natural-canopy') return;
      const mesh = object as THREE.InstancedMesh;
      mesh.geometry.computeBoundingBox();
      const matrix = house.root.matrix.clone();mesh.getMatrixAt(0, matrix);
      const bounds = mesh.geometry.boundingBox!.clone().applyMatrix4(matrix);
      const material = mesh.material as THREE.MeshStandardMaterial;
      trees.push({ height: bounds.max.y, smooth: !material.flatShading, alpha: material.alphaTest, count: mesh.count });
    });
    return {
      families: w.root.userData.buildingFamilies as string[], styles: [...new Set(w.buildings.map(b => b.root.userData.style))],
      houses: w.buildings.length, supplies: w.supplySites.length, trees,
      road: !!w.root.getObjectByName('city-cobblestone-ground'),
      humanDoor: !w.colliders.blocksWallSegment(outside.x, outside.z, inside.x, inside.z, .35),
      giantDoor: w.giantColliders.blocksWallSegment(outside.x, outside.z, inside.x, inside.z, .65),
      towerOrWall: !!w.root.getObjectByName('city-wall-and-street-kit'),
    };
  });
  expect(report.houses).toBeGreaterThanOrEqual(12);
  expect(report.supplies).toBeGreaterThanOrEqual(10);
  expect(report.families).toHaveLength(3);expect(report.styles).toHaveLength(3);
  expect(report.road).toBe(true);expect(report.towerOrWall).toBe(true);
  expect(report.humanDoor).toBe(true);expect(report.giantDoor).toBe(true);
  expect(report.trees).toHaveLength(3);
  for (const tree of report.trees) { expect(tree.height).toBeGreaterThan(8);expect(tree.smooth).toBe(true);expect(tree.alpha).toBeGreaterThan(.2);expect(tree.count).toBeGreaterThan(0); }
});

test('all city supply approaches, patrol sites and extraction connect to the safe spawn', async ({ page }) => {
  await boot(page);
  const report = await page.evaluate(() => {
    const w = (window as unknown as { __CITY__: CityHarness }).__CITY__.world;
    const free = new Set<string>();
    for (let iz = -14; iz <= 254; iz++) for (let ix = -108; ix <= 108; ix++) {
      if (w.colliders.isFree(ix / 2, -iz / 2, .35)) free.add(`${ix},${iz}`);
    }
    const queue = [[Math.round(w.spawn.x * 2), Math.round(-w.spawn.z * 2)]];
    const seen = new Set([`${queue[0][0]},${queue[0][1]}`]);
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${x + dx},${z + dz}`;
        if (!free.has(key) || seen.has(key) || !w.colliders.isFree((x + dx / 2) / 2, -(z + dz / 2) / 2, .35)) continue;
        seen.add(key);queue.push([x + dx, z + dz]);
      }
    }
    const reachable = (p: { x: number; z: number }): boolean => {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (seen.has(`${Math.round(p.x * 2) + dx},${Math.round(-p.z * 2) + dz}`)) return true;
      return false;
    };
    return {
      connected: seen.size,
      supplies: w.supplySites.map(s => {
        const p = s.position.clone();p.x += Math.sin(s.rotationY) * 1.7;p.z += Math.cos(s.rotationY) * 1.7;
        return reachable(p);
      }),
      patrol: w.patrolSites.map(reachable), extraction: reachable(w.extraction.position), spawnSafe: w.colliders.isFree(w.spawn.x, w.spawn.z, .35),
    };
  });
  expect(report.connected).toBeGreaterThan(10000);expect(report.spawnSafe).toBe(true);expect(report.extraction).toBe(true);
  expect(report.supplies.every(Boolean)).toBe(true);expect(report.patrol.every(Boolean)).toBe(true);
});

test('city LOD removes distant facade detail and compacts instanced trees without changing collisions', async ({ page }) => {
  await boot(page);
  const report = await page.evaluate(() => {
    const w = (window as unknown as { __CITY__: CityHarness }).__CITY__.world;
    const b = w.buildings[0];
    const camera = b.center.clone().setY(1.62);w.update(0, camera);
    const near = b.root.visible && b.detail.visible;
    camera.z += 80;w.update(1, camera);const mid = b.root.visible && !b.detail.visible;
    camera.set(500, 1.62, 500);w.update(2, camera);
    let distantInstances = 0;w.root.traverse(o => { if (o.name.startsWith('city-instanced-')) distantInstances += (o as THREE.InstancedMesh).count; });
    const far = !b.root.visible, sameSpawn = w.colliders.isFree(w.spawn.x, w.spawn.z, .35);
    w.update(3, w.spawn);let restoredInstances = 0;w.root.traverse(o => { if (o.name.startsWith('city-instanced-')) restoredInstances += (o as THREE.InstancedMesh).count; });
    return { near, mid, far, distantInstances, restoredInstances, sameSpawn };
  });
  expect(report.near).toBe(true);expect(report.mid).toBe(true);expect(report.far).toBe(true);
  expect(report.distantInstances).toBe(0);expect(report.restoredInstances).toBeGreaterThan(0);expect(report.sameSpawn).toBe(true);
});
