import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import type { CityMonsterKind } from '../src/game/city/CityConfig';
import { CITY_MONSTERS, CITY_BASE_GIANT_HEIGHT } from '../src/game/city/CityConfig';

test('city enemy sizes and defensive tuning are centrally configured', () => {
  expect(CITY_MONSTERS.ordinary.height).toBe(1.7);
  expect(CITY_MONSTERS.giant.height).toBe(CITY_BASE_GIANT_HEIGHT);
  expect(CITY_MONSTERS.large.height).toBe(CITY_BASE_GIANT_HEIGHT * 1.5);
  expect(CITY_MONSTERS.armored.height).toBe(CITY_BASE_GIANT_HEIGHT * 2);
  expect(CITY_MONSTERS.beast.height).toBe(CITY_BASE_GIANT_HEIGHT * 3);
  expect(CITY_MONSTERS.armored.defense).toBeGreaterThan(CITY_MONSTERS.giant.defense);
  expect(CITY_MONSTERS.armored.maxHealth).toBeGreaterThan(CITY_MONSTERS.large.maxHealth);
  expect(CITY_MONSTERS.ordinary.speed).toBeGreaterThan(CITY_MONSTERS.giant.speed);
});

test('original sentinels have real size differences, telegraphed combat, perception/search and ranged skills', async ({ page }) => {
  await page.goto('/monkeytest/');
  const r = await page.evaluate(async () => {
    const systemURL = '/monkeytest/src/game/city/CityMonsterSystem.ts';
    const configURL = '/monkeytest/src/game/city/CityConfig.ts';
    const gridURL = '/monkeytest/src/game/LevelPath.ts';
    const materialURL = '/monkeytest/src/assets/MaterialLibrary.ts';
    const { CityMonsterSystem } = await import(systemURL) as typeof import('../src/game/city/CityMonsterSystem');
    const { CITY_MONSTERS } = await import(configURL) as typeof import('../src/game/city/CityConfig');
    const { ColliderGrid } = await import(gridURL) as typeof import('../src/game/LevelPath');
    const { MaterialLibrary } = await import(materialURL) as typeof import('../src/assets/MaterialLibrary');
    const mats = new MaterialLibrary(), grid = new ColliderGrid();
    const system = new CityMonsterSystem(mats, grid, []);
    const vector = () => system.enemies[0].position.clone().set(0, 0, 0);
    const ctx = { playerPosition: vector().set(0, 0, -18), playerForward: vector().set(0, 0, -1), moving: false, sprinting: false, noise: false, playing: true };
    let time = 0;
    const advance = (seconds: number): number => {
      let damage = 0;
      for (let i = 0; i < Math.ceil(seconds * 60); i++) { time += 1 / 60;damage += system.update(1 / 60, time, ctx).damage; }
      return damage;
    };
    const isolate = (kind: CityMonsterKind) => {
      system.reset(123);
      for (const enemy of system.enemies) { enemy.state = 'dead';enemy.health = 0; }
      const enemy = system.enemies.find(e => e.kind === kind)!;
      enemy.state = 'patrol';enemy.health = enemy.maxHealth;enemy.cooldown = 0;
      enemy.position.set(0, 0, -20);enemy.home.copy(enemy.position);enemy.patrolTarget.copy(enemy.position);enemy.root.rotation.y = 0;
      return enemy;
    };
    const heights = system.enemies.map(enemy => {
      enemy.root.updateMatrixWorld(true);
      let bounds: THREE.Box3 | null = null;
      enemy.root.traverse(object => {
        if ((object as THREE.Mesh).isMesh) {
          const mesh = object as THREE.Mesh;mesh.geometry.computeBoundingBox();
          const b = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
          if (bounds) bounds.union(b);else bounds = b;
        }
      });
      const b = bounds as unknown as THREE.Box3;
      return { kind: enemy.kind, actual: b.max.y - b.min.y, expected: enemy.height };
    });
    let enemy = isolate('ordinary');enemy.position.z = -22;ctx.playerPosition.set(0, 0, -20);
    const first = system.attackFromPlayer(ctx.playerPosition, ctx.playerForward);
    const cooldown = system.attackFromPlayer(ctx.playerPosition, ctx.playerForward);
    advance(0.5);const second = system.attackFromPlayer(ctx.playerPosition, ctx.playerForward);
    const deadDamage = advance(2);
    enemy = isolate('ordinary');ctx.playerPosition.set(4, 0, -20);ctx.moving = false;
    system.update(1 / 60, time, ctx);const unseen = enemy.state as string;
    ctx.moving = true;system.update(1 / 60, time, ctx);const heard = enemy.state as string;
    ctx.moving = false;ctx.playerPosition.set(1000, 0, 1000);advance(2.4);const searching = enemy.state as string;
    advance(7.5);const disengaged = enemy.state as string;
    enemy = isolate('giant');ctx.playerPosition.set(0, 0, -18);system.update(1 / 60, time, ctx);
    const windup = enemy.state as string, stompDamage = advance(1.4);
    enemy = isolate('giant');ctx.playerPosition.set(0, 0, -18);system.update(1 / 60, time, ctx);advance(0.5);
    ctx.playerPosition.set(12, 0, -18);const dodgeDamage = advance(1);
    enemy = isolate('armored');ctx.playerPosition.set(0, 0, -18);
    const armorHit = system.attackFromPlayer(ctx.playerPosition, ctx.playerForward);
    enemy = isolate('beast');enemy.position.set(0, 0, -40);enemy.home.copy(enemy.position);ctx.playerPosition.set(0, 0, -20);
    system.update(1 / 60, time, ctx);advance(1.9);const projectiles = system.projectiles.filter(p => p.active).length;
    const rangedDamage = advance(2);
    enemy = isolate('beast');ctx.playerPosition.set(0, 0, -15);enemy.attackCount = 2;system.update(1 / 60, time, ctx);
    const special = enemy.attackMode, specialDamage = advance(3);
    const wallGrid = new ColliderGrid();
    for (let x = -2; x <= 2; x += 0.3) wallGrid.add({ x, z: -19, r: 0.22, sight: true, wall: true });
    const covered = new CityMonsterSystem(mats, wallGrid, []);
    for (const e of covered.enemies) { e.state = 'dead';e.health = 0; }
    const giant = covered.enemies.find(e => e.kind === 'giant')!;
    giant.position.set(0, 0, -20);giant.state = 'windup';giant.stateTime = CITY_MONSTERS.giant.windup - 0.01;
    giant.attackMode = 'stomp';giant.attackTarget.set(0, 0, -18);giant.root.rotation.y = 0;ctx.playerPosition.set(0, 0, -18);
    const blockedDamage = covered.update(0.03, 1, ctx).damage;
    const blockedStrike = covered.attackFromPlayer(ctx.playerPosition, ctx.playerForward).hit;
    system.reset(123);const reset = system.enemies.every(e => e.health === e.maxHealth && e.state === 'patrol') && system.projectiles.every(p => !p.active);
    covered.dispose();system.dispose();mats.dispose();
    return { heights, first, cooldown, second, deadDamage, unseen, heard, searching, disengaged, windup, stompDamage, dodgeDamage, armorHit, projectiles, rangedDamage, special, specialDamage, blockedDamage, blockedStrike, reset };
  });
  for (const height of r.heights) expect(height.actual, height.kind).toBeCloseTo(height.expected, 2);
  expect(r.first.hit).toBe(true);expect(r.first.killed).toBe(false);expect(r.cooldown.hit).toBe(false);expect(r.second.killed).toBe(true);
  expect(r.deadDamage).toBe(0);expect(r.unseen).toBe('patrol');expect(r.heard).toBe('chase');expect(r.searching).toBe('search');
  expect(['return', 'patrol']).toContain(r.disengaged);expect(r.windup).toBe('windup');expect(r.stompDamage).toBe(30);expect(r.dodgeDamage).toBe(0);
  expect(r.armorHit.damage!).toBeLessThan(r.first.damage!);expect(r.projectiles).toBeGreaterThan(0);expect(r.rangedDamage).toBe(24);
  expect(r.special).toBe('shockwave');expect(r.specialDamage).toBe(32);expect(r.blockedDamage).toBe(0);expect(r.blockedStrike).toBe(false);expect(r.reset).toBe(true);
});

test('street pursuit routes around walls with bounded planning; low doorways exclude giants', async ({ page }) => {
  await page.goto('/monkeytest/');
  const report = await page.evaluate(async () => {
    const systemURL = '/monkeytest/src/game/city/CityMonsterSystem.ts', gridURL = '/monkeytest/src/game/LevelPath.ts', materialURL = '/monkeytest/src/assets/MaterialLibrary.ts';
    const { CityMonsterSystem } = await import(systemURL) as typeof import('../src/game/city/CityMonsterSystem');
    const { ColliderGrid } = await import(gridURL) as typeof import('../src/game/LevelPath');
    const { MaterialLibrary } = await import(materialURL) as typeof import('../src/assets/MaterialLibrary');
    const mats = new MaterialLibrary(), grid = new ColliderGrid();
    for (let z = -27; z <= -13; z += 0.3) grid.add({ x: 0, z, r: 0.22, sight: true, wall: true });
    const system = new CityMonsterSystem(mats, grid, []);
    for (const e of system.enemies) { e.state = 'dead';e.health = 0; }
    const ordinary = system.enemies[0];ordinary.health = ordinary.maxHealth;ordinary.state = 'chase';ordinary.cooldown = 0;
    ordinary.position.set(-4, 0, -20);ordinary.home.copy(ordinary.position);ordinary.lastSeen.set(4, 0, -20);
    const ctx = { playerPosition: ordinary.position.clone().set(4, 0, -20), playerForward: ordinary.position.clone().set(0, 0, -1), moving: false, sprinting: false, noise: false, playing: true };
    let calls = 0;const original = grid.routeAroundWalls.bind(grid);grid.routeAroundWalls = (...args) => { calls++;return original(...args); };
    let detour = 0, damage = 0;
    for (let i = 0; i < 600; i++) { damage += system.update(1 / 60, i / 60, ctx).damage;detour = Math.max(detour, Math.abs(ordinary.position.z + 20)); }
    const distance = ordinary.position.distanceTo(ctx.playerPosition);
    const doorway = new ColliderGrid(), giantDoorway = new ColliderGrid();
    const add = (x: number, z: number, toNormal = true): void => { const c = { x, z, r: 0.22, sight: true, wall: true };if (toNormal) doorway.add(c);giantDoorway.add(c); };
    for (let x = -4; x <= 4; x += 0.25) { add(x, -24);add(x, -16, Math.abs(x) > 1.3); }
    for (let z = -24; z <= -16; z += 0.25) { add(-4, z);add(4, z); }
    const lowDoor = new CityMonsterSystem(mats, doorway, [], giantDoorway);
    for (const e of lowDoor.enemies) { e.state = 'dead';e.health = 0; }
    const giant = lowDoor.enemies.find(e => e.kind === 'giant')!;giant.state = 'chase';giant.health = giant.maxHealth;giant.position.set(0, 0, -13);giant.home.copy(giant.position);giant.lastSeen.set(0, 0, -20);
    ctx.playerPosition.set(0, 0, -20);
    let minimumZ = giant.position.z;
    for (let i = 0; i < 240; i++) { lowDoor.update(1 / 60, i / 60, ctx);minimumZ = Math.min(minimumZ, giant.position.z); }
    for(const e of lowDoor.enemies){e.state='dead';e.health=0;}
    const armored=lowDoor.enemies.find(e=>e.kind==='armored')!;armored.state='attack';armored.health=armored.maxHealth;armored.attackMode='charge';armored.stateTime=0;armored.cooldown=5;armored.position.set(0,0,-13);armored.root.rotation.y=Math.PI;
    let chargeMinimumZ=armored.position.z;
    for(let i=0;i<30;i++){lowDoor.update(1/60,i/60,ctx);chargeMinimumZ=Math.min(chargeMinimumZ,armored.position.z);}
    const normalDoorOpen = !doorway.blocksWallSegment(0, -13, 0, -20, 0.38);
    const giantDoorClosed = giantDoorway.blocksWallSegment(0, -13, 0, -20, 0.65);
    system.dispose();lowDoor.dispose();mats.dispose();
    return { calls, detour, damage, distance, minimumZ, chargeMinimumZ, normalDoorOpen, giantDoorClosed };
  });
  expect(report.detour).toBeGreaterThan(7);expect(report.distance).toBeLessThan(2);expect(report.damage).toBeGreaterThan(0);
  expect(report.calls).toBeGreaterThan(0);expect(report.calls).toBeLessThanOrEqual(8);
  expect(report.normalDoorOpen).toBe(true);expect(report.giantDoorClosed).toBe(true);expect(report.minimumZ).toBeGreaterThan(-16);expect(report.chargeMinimumZ).toBeGreaterThan(-14.8);
});

test('contact targets remain hittable and ordinary enemies keep melee standoff during cooldown', async ({ page }) => {
  await page.goto('/monkeytest/');
  const report = await page.evaluate(async () => {
    const systemURL = '/monkeytest/src/game/city/CityMonsterSystem.ts', gridURL = '/monkeytest/src/game/LevelPath.ts', materialURL = '/monkeytest/src/assets/MaterialLibrary.ts';
    const { CityMonsterSystem } = await import(systemURL) as typeof import('../src/game/city/CityMonsterSystem');
    const { ColliderGrid } = await import(gridURL) as typeof import('../src/game/LevelPath');
    const { MaterialLibrary } = await import(materialURL) as typeof import('../src/assets/MaterialLibrary');
    const mats = new MaterialLibrary(), system = new CityMonsterSystem(mats, new ColliderGrid(), []);
    const player = system.enemies[0].position.clone().set(0, 0, -20), forward = player.clone().set(0, 0, -1);
    const ctx = { playerPosition: player, playerForward: forward, moving: false, sprinting: false, noise: false, playing: true };
    const setup = (z: number) => {
      system.reset(9);for (const e of system.enemies) { e.state = 'dead';e.health = 0; }
      const enemy = system.enemies[0];enemy.state = 'chase';enemy.health = enemy.maxHealth;enemy.cooldown = 2;
      enemy.position.set(0, 0, z);enemy.home.copy(enemy.position);enemy.lastSeen.copy(player);enemy.root.rotation.y = 0;return enemy;
    };
    let enemy = setup(-22);
    const first = system.attackFromPlayer(player, forward);
    let closest = Infinity;
    for (let frame = 0; frame < 36; frame++) { system.update(1 / 60, frame / 60, ctx);closest = Math.min(closest, enemy.position.distanceTo(player)); }
    const second = system.attackFromPlayer(player, forward);
    enemy = setup(-20);
    const exactContact = system.attackFromPlayer(player, forward);
    for (let frame = 0; frame < 36; frame++) system.update(1 / 60, frame / 60, ctx);
    const easedDistance = enemy.position.distanceTo(player);
    const followUp = system.attackFromPlayer(player, forward);
    system.dispose();mats.dispose();
    return { first, second, closest, exactContact, easedDistance, followUp };
  });
  expect(report.first.hit).toBe(true);expect(report.first.killed).toBe(false);
  expect(report.closest).toBeGreaterThan(0.75);expect(report.second.killed).toBe(true);
  expect(report.exactContact.hit).toBe(true);expect(report.easedDistance).toBeGreaterThan(0.5);
  expect(report.followUp.killed).toBe(true);
});
