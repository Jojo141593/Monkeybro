import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import type { Level } from '../src/game/Level';
import type { Player } from '../src/entities/Player';
import { nightFogDensity } from '../src/game/NightVisibility';

test('unlit visibility falls off much sooner than lantern visibility', () => {
  const lit = nightFogDensity(true, 0), dark = nightFogDensity(false, 0);
  const transmission = (density: number, metres: number) => Math.exp(-((density * metres) ** 2));
  expect(transmission(lit, 10)).toBeGreaterThan(0.5);
  expect(transmission(dark, 10)).toBeLessThan(0.03);
  expect(nightFogDensity(false, 1)).toBeGreaterThan(dark);
});

test('roads and navigation identifiers are absent; lantern changes the actual rendered view', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__THREE_GAME_TEST_HOOKS__);
  await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__!;
    hooks.setState('courtyard');hooks.setPausedForScreenshot(true);
  });
  const objects = await page.evaluate(() => {
    const g = (window as unknown as { __MONKEYBRO__: { level: Level; player: Player } }).__MONKEYBRO__;
    const markers: string[] = [];
    g.level.root.traverse(o => { if (/^trail(?:-|$)|direction-marker/.test(o.name)) markers.push(o.name); });
    return { markers, halls: g.level.interiors.length };
  });
  expect(objects.markers).toEqual([]);
  expect(objects.halls).toBeGreaterThanOrEqual(6);
  await expect(page.locator('#compass, #zone-panel')).toHaveCount(0);
  const luminance = (buffer: Buffer): { mean: number; visible: number } => {
    const png = PNG.sync.read(buffer);let sum = 0, count = 0, visible = 0;
    for (let y = Math.floor(png.height * 0.32); y < png.height * 0.7; y++) {
      for (let x = Math.floor(png.width * 0.16); x < png.width * 0.8; x++) {
        const i = (y * png.width + x) * 4;
        const light = png.data[i] * 0.2126 + png.data[i + 1] * 0.7152 + png.data[i + 2] * 0.0722;
        sum += light;count++;if (light > 12) visible++;
      }
    }
    return { mean: sum / count, visible };
  };
  await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
  const lit = luminance(await page.locator('#game-canvas').screenshot());
  await page.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__!.setState('unlit');window.__THREE_GAME_TEST_HOOKS__!.setPausedForScreenshot(true); });
  await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
  const dark = luminance(await page.locator('#game-canvas').screenshot());
  expect(lit.mean).toBeGreaterThan(dark.mean);
  // Compare readable scene pixels, rather than letting the intentionally black border dominate the mean.
  expect(lit.visible).toBeGreaterThan(dark.visible * 2);
  expect(lit.mean).toBeGreaterThan(3);
});

test('all halls, entrances and chest approaches are reachable around solid walls', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __MONKEYBRO__?: unknown }).__MONKEYBRO__);
  const result = await page.evaluate(async moduleURL => {
    const map = await import(moduleURL) as typeof import('../src/game/LevelPath');
    const g = (window as unknown as { __MONKEYBRO__: { level: Level; player: Player; loop: { stop(): void } } }).__MONKEYBRO__;
    g.loop.stop();
    const free = new Set<string>();
    for (let iz = -4; iz <= 760; iz++) for (let ix = -50; ix <= 130; ix++) {
      const x = ix / 2, z = -iz / 2, p = { x, z };
      map.clampToCorridor(p, 0.35);
      if (Math.abs(p.x - x) > 1e-6 || Math.abs(p.z - z) > 1e-6) continue;
      if (g.level.colliders.isFree(x, z, 0.35)) free.add(`${ix},${iz}`);
    }
    const x0 = Math.round(g.player.position.x * 2), z0 = Math.round(-g.player.position.z * 2);
    const queue = [[x0, z0]], visited = new Set([`${x0},${z0}`]);
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${x + dx},${z + dz}`;
        if (!free.has(key) || visited.has(key)) continue;
        if (!g.level.colliders.isFree((x + dx / 2) / 2, -(z + dz / 2) / 2, 0.35)) continue;
        visited.add(key);queue.push([x + dx, z + dz]);
      }
    }
    const reachable = (p: { x: number; z: number }): boolean => {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (visited.has(`${Math.round(p.x * 2) + dx},${Math.round(-p.z * 2) + dz}`)) return true;
      }
      return false;
    };
    return {
      visited: visited.size,
      halls: g.level.interiors.map(h => ({ approach: reachable(h.chestApproach), entries: h.entries.map(reachable), doors: h.doorways.map(reachable) })),
    };
  }, '/monkeytest/src/game/LevelPath.ts');
  expect(result.visited).toBeGreaterThan(1000);
  for (const hall of result.halls) {
    expect(hall.approach).toBe(true);
    expect(hall.entries.every(Boolean)).toBe(true);
    expect(hall.doors.every(Boolean)).toBe(true);
  }
});

test('chest feedback stays clear of survival meters on narrow screens', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'phone layout');
  await page.goto('/');
  await page.waitForFunction(() => !!window.__THREE_GAME_TEST_HOOKS__);
  await page.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__!.setState('chest-open');window.__THREE_GAME_TEST_HOOKS__!.setPausedForScreenshot(true); });
  const vitals = await page.locator('#vitals').boundingBox();
  const banner = await page.locator('#banner').boundingBox();
  expect(vitals).not.toBeNull();expect(banner).not.toBeNull();
  expect(vitals!.y + vitals!.height).toBeLessThan(banner!.y);
});
