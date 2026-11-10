import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import type { Player } from '../src/entities/Player';
import type { Level } from '../src/game/Level';
import type { Input } from '../src/core/Input';
import { PATH_LENGTH, clampToCorridor, pathSlope, pathX } from '../src/game/LevelPath';

test('winding route stays continuous and inside the orchard', () => {
  let turns = 0;
  let length = 0;
  let lastSlope = pathSlope(1);
  for (let t = 1; t <= PATH_LENGTH; t++) {
    const x = pathX(t);
    const slope = pathSlope(t);
    if (lastSlope * slope < 0) turns++;
    lastSlope = slope;
    length += Math.hypot(x - pathX(t - 1), 1);
    expect(Math.abs(x - pathX(t - 1))).toBeLessThan(1.3);
    const point = { x, z: -t };
    clampToCorridor(point, 0.35);
    expect(point).toEqual({ x, z: -t });
    expect(slope).toBeCloseTo((pathX(t + 0.001) - pathX(t - 0.001)) / 0.002, 5);
  }
  expect(turns).toBeGreaterThanOrEqual(5);
  expect(length).toBeGreaterThan(PATH_LENGTH * 1.15);
});

test('walk and sprint keep the camera steady in the unmarked orchard', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __MONKEYBRO__?: unknown }).__MONKEYBRO__);
  const report = await page.evaluate(() => {
    const g = (window as unknown as { __MONKEYBRO__: {
      loop: { stop(): void }; player: Player; camera: THREE.PerspectiveCamera;
      input: Input; level: Level;
    } }).__MONKEYBRO__;
    g.loop.stop();
    const p = g.player;
    const start = p.position.clone();
    const heights: number[] = [];
    let maxOffset = 0;
    for (const sprint of [false, true]) {
      p.reset(start, 0);
      g.input.moveX = 0;
      g.input.moveY = 1;
      g.input.sprint = sprint;
      for (let frame = 0; frame < 90; frame++) {
        p.update(1 / 60, frame / 60, g.input, g.level.colliders, false);
        heights.push(g.camera.position.y);
        maxOffset = Math.max(maxOffset, g.camera.position.distanceTo(p.eye));
      }
    }
    let markings = 0;
    g.level.root.traverse(object => { if (/^trail(?:-|$)/.test(object.name)) markings++; });
    return { heightRange: Math.max(...heights) - Math.min(...heights), maxOffset, markings };
  });
  expect(report.heightRange).toBeLessThan(1e-8);
  expect(report.maxOffset).toBeLessThan(1e-8);
  expect(report.markings).toBe(0);
});


test('natural orchard tree LOD preserves smooth leaf detail, fruit and collision',async({page})=>{
 await page.goto('/');
 const r=await page.evaluate(()=>{
  const g=(window as unknown as {__MONKEYBRO__:{loop:{stop():void};level:Level;player:Player}}).__MONKEYBRO__;g.loop.stop();
  const level=g.level,fruit=level.peachSpots.length,point=g.player.position.clone();
  const free=level.colliders.isFree(point.x,point.z,.35);
  const count=()=>{let total=0;level.root.traverse(o=>{if(o.name==='orchard-natural-canopy')total+=(o as THREE.InstancedMesh).count;});return total;};
  level.update(0,point,0);const near=count();level.update(0,point.clone().set(5000,0,5000),0);const far=count();level.update(0,point,0);
  let detail=false;level.root.traverse(o=>{if(o.name==='orchard-natural-canopy'){const mat=(o as THREE.Mesh).material as THREE.MeshStandardMaterial;detail=!!mat.map&&mat.alphaTest>0&&!mat.flatShading;}});
  return {near,far,restored:count(),fruitSame:fruit===level.peachSpots.length,collisionSame:free===level.colliders.isFree(point.x,point.z,.35),detail};
 });
 expect(r.near).toBeGreaterThan(0);expect(r.far).toBe(0);expect(r.restored).toBe(r.near);expect(r.fruitSame).toBe(true);expect(r.collisionSame).toBe(true);expect(r.detail).toBe(true);
});
