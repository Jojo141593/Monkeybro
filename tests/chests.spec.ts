import { expect, test, type Page } from '@playwright/test';
import type { Player } from '../src/entities/Player';
import type { TreasureChests } from '../src/entities/TreasureChests';
import type { Grabber } from '../src/entities/Monsters';
import type { Level } from '../src/game/Level';
import type { Input } from '../src/core/Input';

type ChestGame = {
  loop: { stop(): void };
  prepareRun(seed: number): void;
  setState(state: string): void;
  update(dt: number, elapsed: number): void;
  elapsed: number;
  state: string;
  player: Player;
  level: Level;
  input: Input;
  chests: TreasureChests;
  grabbers: Grabber[];
  haul: number;
  satchel: number[];
  bestScore: number;
  forceSanctuary(index?: number): { index: number; kind: string } | null;
};

const SEED = 845;

async function bootAtChest(page: Page, throughWall = false): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __MONKEYBRO__?: unknown }).__MONKEYBRO__);
  await page.evaluate(({ seed, throughWall }) => {
    const g = (window as unknown as { __MONKEYBRO__: ChestGame }).__MONKEYBRO__;
    g.loop.stop();
    g.prepareRun(seed);
    g.setState('playing');
    // Isolate chest interaction from unrelated patrol RNG. The real world colliders remain active.
    g.grabbers.forEach((monster, i) => monster.respawn(g.player.position.clone().set(70 + i, 0, -350)));
    const room = g.level.interiors[0];
    const localX = throughWall ? -3.85 : 0.5;
    const position = room.chestApproach.clone();
    position.x += Math.cos(room.rotationY) * localX;
    position.z -= Math.sin(room.rotationY) * localX;
    const chest = g.chests.chests[0];
    const yaw = Math.atan2(-(chest.position.x - position.x), -(chest.position.z - position.z));
    g.player.reset(position, yaw);
    g.update(1 / 60, 1 / 60);
  }, { seed: SEED, throughWall });
}

async function advance(page: Page, frames: number): Promise<void> {
  await page.evaluate(frames => {
    const g = (window as unknown as { __MONKEYBRO__: ChestGame }).__MONKEYBRO__;
    for (let i = 0; i < frames; i++) g.update(1 / 60, g.elapsed + 1 / 60);
  }, frames);
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const g = (window as unknown as { __MONKEYBRO__: ChestGame }).__MONKEYBRO__;
    const search = g.chests as unknown as { searchProgress: number };
    return {
      state: g.state,
      haul: g.haul,
      best: g.bestScore,
      satchel: [...g.satchel],
      progress: search.searchProgress,
      opened: g.chests.chests[0].opened,
      lidAngle: g.chests.chests[0].lid.rotation.x,
      rewards: g.chests.debugState().map(chest => chest.rewardTier),
      openedCount: g.chests.debugState().filter(chest => chest.opened).length,
    };
  });
}

/** Trusted keyboard events on desktop, a captured real touch pointer on the mobile harvest control. */
async function holdSearch(page: Page, mobile: boolean): Promise<() => Promise<void>> {
  if (!mobile) {
    await page.keyboard.down('KeyE');
    return () => page.keyboard.up('KeyE');
  }
  const button = page.locator('#touch-harvest');
  await expect(button).toBeVisible();
  const bounds = await button.boundingBox();
  if (!bounds) throw new Error('Touch search control has no bounds');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
}

test('real hold input searches a chest, cancels on release or pause, and banks its loot only after extraction', async ({ page }, testInfo) => {
  await bootAtChest(page);
  const mobile = testInfo.project.name.includes('mobile');
  const before = await snapshot(page);
  const stance = await page.evaluate(() => {
    const g = (window as unknown as { __MONKEYBRO__: ChestGame }).__MONKEYBRO__;
    return { free: g.level.colliders.isFree(g.player.position.x, g.player.position.z, 0.35), target: g.chests.findTarget(g.player.eye, g.player.forward, g.level.colliders)?.index };
  });
  expect(stance).toEqual({ free: true, target: 0 });
  expect(before.opened).toBe(false);
  await expect(page.locator('#prompt-text')).toContainText(/chest/i);

  let release = await holdSearch(page, mobile);
  await advance(page, 30);
  const partial = await snapshot(page);
  expect(partial.progress).toBeGreaterThan(0.3);
  expect(partial.opened).toBe(false);
  expect(partial.haul).toBe(0);
  await release();
  await advance(page, 1);
  expect((await snapshot(page)).progress).toBe(0);

  release = await holdSearch(page, mobile);
  await advance(page, 30);
  await page.keyboard.press('KeyP');
  const paused = await snapshot(page);
  expect(paused.state).toBe('paused');
  expect(paused.progress).toBe(0);
  await release();
  await advance(page, 100);
  expect((await snapshot(page)).opened).toBe(false);
  await page.keyboard.press('KeyP');
  expect((await snapshot(page)).state).toBe('playing');

  release = await holdSearch(page, mobile);
  await advance(page, 80);
  expect((await snapshot(page)).opened).toBe(false); // canceled partial work never carries over
  await advance(page, 10);
  await release();
  await advance(page, 30);
  const looted = await snapshot(page);
  const tier = before.rewards[0];
  const expectedValue = [10, 100, 1000][tier];
  expect(looted.opened).toBe(true);
  expect(looted.openedCount).toBe(1);
  expect(looted.lidAngle).toBeLessThan(-1);
  expect(looted.satchel).toEqual([0, 1, 2, 3].map(index => index === tier ? 1 : 0));
  expect(looted.haul).toBe(expectedValue);
  expect(looted.best).toBe(0);
  release = await holdSearch(page, mobile);
  await advance(page, 110);
  await release();
  expect((await snapshot(page)).haul).toBe(expectedValue); // an opened chest cannot pay twice

  const extracted = await page.evaluate(() => {
    const g = (window as unknown as { __MONKEYBRO__: ChestGame }).__MONKEYBRO__;
    const shrine = g.forceSanctuary();
    for (let i = 0; i < 300 && g.state === 'playing'; i++) g.update(1 / 60, g.elapsed + 1 / 60);
    return { kind: shrine?.kind, state: g.state, best: g.bestScore };
  });
  expect(extracted).toEqual({ kind: 'real', state: 'extracted', best: expectedValue });

  await page.evaluate(seed => {
    const g = (window as unknown as { __MONKEYBRO__: ChestGame }).__MONKEYBRO__;
    g.prepareRun(seed);
  }, SEED);
  const reset = await snapshot(page);
  expect(reset.rewards).toEqual(before.rewards);
  expect(reset.openedCount).toBe(0);
  expect(reset.lidAngle).toBe(0);
  expect(reset.haul).toBe(0);
  expect(reset.satchel).toEqual([0, 0, 0, 0]);
});

test('a nearby chest cannot be searched through a solid hall wall', async ({ page }, testInfo) => {
  await bootAtChest(page, true);
  const relation = await page.evaluate(() => {
    const g = (window as unknown as { __MONKEYBRO__: ChestGame }).__MONKEYBRO__;
    const p = g.player.position;
    const chest = g.chests.chests[0];
    return {
      free: g.level.colliders.isFree(p.x, p.z, 0.35),
      distance: Math.hypot(p.x - chest.position.x, p.z - chest.position.z),
      occluded: g.level.colliders.blocksSegment(p.x, p.z, chest.position.x, chest.position.z, 0),
      target: g.chests.findTarget(g.player.eye, g.player.forward, g.level.colliders)?.index ?? null,
    };
  });
  expect(relation.free).toBe(true);
  expect(relation.distance).toBeLessThan(2.6);
  expect(relation.occluded).toBe(true);
  expect(relation.target).toBeNull();
  const release = await holdSearch(page, testInfo.project.name.includes('mobile'));
  await advance(page, 110);
  await release();
  const after = await snapshot(page);
  expect(after.openedCount).toBe(0);
  expect(after.haul).toBe(0);
});
