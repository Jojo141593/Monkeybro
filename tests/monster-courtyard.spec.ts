import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import type { MaterialLibrary } from '../src/assets/MaterialLibrary';
import type { MonsterContext } from '../src/entities/Monsters';
import type { Level } from '../src/game/Level';
import type { AudioSystem } from '../src/systems/AudioSystem';

test('hunters route through hall doors from either solid side and outside the courtyard', async ({ page }) => {
  await page.goto('/monkeytest/');
  await page.waitForFunction(() => !!(window as unknown as { __MONKEYBRO__?: unknown }).__MONKEYBRO__);
  const report = await page.evaluate(async () => {
    const source = '/monkeytest/src/entities/Monsters.ts';
    const { Grabber } = await import(source) as typeof import('../src/entities/Monsters');
    const g = (window as unknown as { __MONKEYBRO__: {
      loop: { stop(): void }; level: Level; mats: MaterialLibrary;
    } }).__MONKEYBRO__;
    g.loop.stop();
    const audio = new Proxy({}, { get: () => () => undefined }) as AudioSystem;
    const axis = g.level.interiors[0].center.clone().set(0, 1, 0);
    const context = (target: THREE.Vector3): MonsterContext => ({
      playerPos: target, eye: target.clone().setY(1.65), forward: target.clone().set(-1, 0, 0),
      lightOn: false, sprinting: false, moving: false, harvesting: false, hunt: true,
      sanctuary: null, colliders: g.level.colliders, audio, rng: () => 0.5,
    });
    let routeCalls = 0;
    const original = g.level.colliders.routeAroundWalls.bind(g.level.colliders);
    g.level.colliders.routeAroundWalls = (...args) => { routeCalls++; return original(...args); };
    const cases = [];
    for (const [i, hall] of g.level.interiors.entries()) {
      // x=4.3 is in the lane against a solid side wall; x=7.2 starts beyond the courtyard wall.
      for (const x of [-4.3, 4.3, ...(i === 0 ? [-7.2, 7.2] : [])]) {
        const start = hall.center.clone().set(x, 0, 0).applyAxisAngle(axis, hall.rotationY).add(hall.center);
        const hunter = new Grabber(g.mats, start, 100 + i);
        hunter.state = 'chase';
        const ctx = context(hall.chestApproach.clone());
        const callsBefore = routeCalls;
        let caught = false, entered = false, maxDoorDetour = 0, frames = 0;
        for (; frames < 600; frames++) {
          caught = hunter.update(1 / 60, ctx, 0);
          const local = hunter.position.clone().sub(hall.center).applyAxisAngle(axis, -hall.rotationY);
          maxDoorDetour = Math.max(maxDoorDetour, Math.abs(local.z));
          entered ||= Math.abs(local.x) < 2.5 && Math.abs(local.z) < 3.6;
          if (caught) break;
        }
        cases.push({ hall: i, x, caught, entered, maxDoorDetour, frames, routeCalls: routeCalls - callsBefore });
      }
    }
    // A close player across plaster must neither be grabbed nor shine through the wall.
    const hall = g.level.interiors[0];
    const start = hall.center.clone().add(hall.center.clone().set(2.55, 0, 0));
    const hunter = new Grabber(g.mats, start, 200);
    hunter.state = 'chase';
    const ctx = context(hall.center.clone().add(hall.center.clone().set(3.75, 0, 0)));
    ctx.lightOn = true;
    const blocked = g.level.colliders.blocksWallSegment(start.x, start.z, ctx.playerPos.x, ctx.playerPos.z);
    const closeDistance = start.distanceTo(ctx.playerPos);
    const caughtThroughWall = hunter.update(0, ctx, 0);
    return { cases, blocked, closeDistance, caughtThroughWall, litThroughWall: hunter.lit };
  });
  expect(report.cases).toHaveLength(14);
  for (const result of report.cases) {
    expect(result.caught, JSON.stringify(result)).toBe(true);
    expect(result.entered, JSON.stringify(result)).toBe(true);
    expect(result.maxDoorDetour).toBeGreaterThan(4);
    expect(result.frames).toBeLessThan(240);
    // Cached route: an unchanged indoor target must not trigger a new planner every frame.
    expect(result.routeCalls).toBeGreaterThanOrEqual(1);
    expect(result.routeCalls).toBeLessThanOrEqual(3);
  }
  expect(report.blocked).toBe(true);
  expect(report.closeDistance).toBeLessThan(1.25);
  expect(report.caughtThroughWall).toBe(false);
  expect(report.litThroughWall).toBe(false);
});
