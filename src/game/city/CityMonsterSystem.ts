import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from '../../assets/MaterialLibrary';
import type { ColliderGrid } from '../LevelPath';
import { createSeededRandom } from '../../utils/random';
import { CITY_MONSTERS, CITY_MONSTER_ROSTER, CITY_PLAYER_COMBAT, type CityAttackMode, type CityMonsterKind, type CityMonsterState } from './CityConfig';

export interface CityMonsterFrame {
  playerPosition: THREE.Vector3;
  playerForward: THREE.Vector3;
  moving: boolean;
  sprinting: boolean;
  noise: boolean;
  playing: boolean;
}

export interface CityEnemy {
  id: number;
  kind: CityMonsterKind;
  height: number;
  root: THREE.Group;
  position: THREE.Vector3;
  state: CityMonsterState;
  health: number;
  maxHealth: number;
  home: THREE.Vector3;
  lastSeen: THREE.Vector3;
  patrolTarget: THREE.Vector3;
  attackTarget: THREE.Vector3;
  attackMode: CityAttackMode;
  stateTime: number;
  cooldown: number;
  unseenTime: number;
  attackCount: number;
  attackHit: boolean;
  routeCooldown: number;
  route: { x: number; z: number }[];
  routeIndex: number;
  routeGoal: THREE.Vector3;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  telegraph: THREE.Mesh;
  stride: number;
}

export interface CityProjectile {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  active: boolean;
  age: number;
  owner: number;
}

interface Shockwave {
  mesh: THREE.Mesh;
  owner: number;
  active: boolean;
  radius: number;
  previousRadius: number;
  maxRadius: number;
  hit: boolean;
}

/** Original stone/cloth/iron sentinels. State and combat data do not depend on renderer state. */
export class CityMonsterSystem {
  readonly root = new THREE.Group();
  readonly enemies: CityEnemy[] = [];
  readonly projectiles: CityProjectile[] = [];
  private readonly waves: Shockwave[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private rng = createSeededRandom(1);
  private playerAttackCooldown = 0;
  private readonly avoid = { x: 0, z: 0 };
  private readonly scratch = new THREE.Vector3();
  private readonly sites: THREE.Vector3[];

  constructor(mats: MaterialLibrary, private readonly colliders: ColliderGrid, patrolSites: readonly THREE.Vector3[], private readonly giantColliders: ColliderGrid = colliders) {
    this.root.name = 'city-monsters';
    this.sites = (patrolSites.length ? patrolSites : [new THREE.Vector3(0, 0, -26), new THREE.Vector3(0, 0, -60), new THREE.Vector3(0, 0, -100)]).map(p => p.clone());
    const prototypes = new Map<CityMonsterKind, THREE.Group>();
    for (const kind of new Set(CITY_MONSTER_ROSTER)) prototypes.set(kind, this.makeModel(mats, kind));
    const ringGeo = this.own(new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2));
    const rockGeo = this.own(new THREE.IcosahedronGeometry(0.42, 1));
    const rockMat = new THREE.MeshStandardMaterial({ color: '#5c625c', roughness: 0.95, map: mats.stoneTex });
    this.materials.add(rockMat);
    const waveMat = new THREE.MeshBasicMaterial({ color: '#e9b05a', transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false });
    this.materials.add(waveMat);
    CITY_MONSTER_ROSTER.forEach((kind, id) => {
      const root = prototypes.get(kind)!.clone(true);
      const stats = CITY_MONSTERS[kind];
      root.name = `city-enemy-${kind}-${id}`;
      root.scale.setScalar(stats.height);
      root.userData.monsterKind = kind;
      root.userData.height = stats.height;
      this.root.add(root);
      const warnMat = new THREE.MeshBasicMaterial({ color: '#e4b45a', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      this.materials.add(warnMat);
      const telegraph = new THREE.Mesh(ringGeo, warnMat);
      telegraph.visible = false;this.root.add(telegraph);
      this.enemies.push({
        id, kind, height: stats.height, root, position: root.position, state: 'patrol', health: stats.maxHealth,
        maxHealth: stats.maxHealth, home: new THREE.Vector3(), lastSeen: new THREE.Vector3(), patrolTarget: new THREE.Vector3(),
        attackTarget: new THREE.Vector3(), attackMode: 'melee', stateTime: 0, cooldown: 0, unseenTime: 0,
        attackCount: 0, attackHit: false, routeCooldown: 0, route: [], routeIndex: 0, routeGoal: new THREE.Vector3(),
        legs: ['leg-left', 'leg-right'].map(n => root.getObjectByName(n)!),
        arms: ['arm-left', 'arm-right'].map(n => root.getObjectByName(n)!), telegraph, stride: 0,
      });
    });
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(rockGeo, rockMat);mesh.visible = false;this.root.add(mesh);
      this.projectiles.push({ mesh, position: mesh.position, velocity: new THREE.Vector3(), active: false, age: 0, owner: -1 });
    }
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(ringGeo, waveMat);mesh.visible = false;this.root.add(mesh);
      this.waves.push({ mesh, owner: -1, active: false, radius: 0, previousRadius: 0, maxRadius: 0, hit: false });
    }
    this.reset(1);
  }

  reset(seed: number): void {
    this.rng = createSeededRandom(seed ^ 0x43495459);
    this.playerAttackCooldown = 0;
    this.enemies.forEach((enemy, i) => {
      const index = Math.round(i * (this.sites.length - 1) / Math.max(1, this.enemies.length - 1));
      enemy.home.copy(this.sites[index]);this.freePoint(enemy.home, CITY_MONSTERS[enemy.kind].radius);
      enemy.position.copy(enemy.home);enemy.position.y = 0;
      enemy.root.rotation.set(0, this.rng() * Math.PI * 2, 0);enemy.root.visible = true;
      enemy.health = CITY_MONSTERS[enemy.kind].maxHealth;enemy.maxHealth = enemy.health;
      enemy.state = 'patrol';enemy.stateTime = 0;enemy.cooldown = 1 + this.rng();enemy.unseenTime = 0;
      enemy.lastSeen.copy(enemy.home);enemy.attackTarget.copy(enemy.home);enemy.attackCount = 0;enemy.attackHit = false;
      enemy.route = [];enemy.routeIndex = 0;enemy.routeCooldown = 0;enemy.stride = 0;enemy.telegraph.visible = false;
      enemy.arms.forEach(arm => arm.rotation.set(0, 0, 0));enemy.legs.forEach(leg => leg.rotation.set(0, 0, 0));
      this.choosePatrol(enemy);
    });
    for (const p of this.projectiles) { p.active = false;p.mesh.visible = false;p.age = 0; }
    for (const wave of this.waves) { wave.active = false;wave.mesh.visible = false;wave.hit = false; }
  }

  update(dt: number, elapsed: number, ctx: CityMonsterFrame): { damage: number; attacks: number } {
    if (!ctx.playing) return { damage: 0, attacks: 0 };
    const delta = THREE.MathUtils.clamp(dt, 0, 0.05);
    this.playerAttackCooldown = Math.max(0, this.playerAttackCooldown - delta);
    let damage = 0, attacks = 0;
    for (const enemy of this.enemies) {
      const stats = CITY_MONSTERS[enemy.kind];
      const castShadow=enemy.state!=='dead'&&enemy.position.distanceToSquared(ctx.playerPosition)<35*35;
      if(enemy.root.userData.castShadow!==castShadow){enemy.root.userData.castShadow=castShadow;enemy.root.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=castShadow;});}
      enemy.stateTime += delta;enemy.cooldown = Math.max(0, enemy.cooldown - delta);enemy.routeCooldown = Math.max(0, enemy.routeCooldown - delta);
      if (enemy.state === 'dead') {
        enemy.root.rotation.z = Math.min(1.45, enemy.stateTime * 1.4);
        enemy.root.visible = enemy.stateTime < 3;enemy.telegraph.visible = false;continue;
      }
      const beforeX = enemy.position.x, beforeZ = enemy.position.z;
      const dx = ctx.playerPosition.x - beforeX, dz = ctx.playerPosition.z - beforeZ;
      const distance = Math.hypot(dx, dz);
      const clear = !this.colliders.blocksSegment(beforeX, beforeZ, ctx.playerPosition.x, ctx.playerPosition.z, 0);
      const facing = distance < 0.01 ? 1 : (Math.sin(enemy.root.rotation.y) * dx + Math.cos(enemy.root.rotation.y) * dz) / distance;
      const seen = clear && distance <= stats.vision && (distance < 2.5 || facing > Math.cos(stats.fieldOfView * Math.PI / 360));
      const hearing = stats.hearing * (ctx.sprinting ? 1.65 : ctx.noise ? 1.25 : 0.7) * (clear ? 1 : 0.35);
      const heard = (ctx.moving || ctx.sprinting || ctx.noise) && distance < hearing;
      if (seen || heard) {
        enemy.lastSeen.copy(ctx.playerPosition);enemy.unseenTime = 0;
        if (enemy.state !== 'windup' && enemy.state !== 'attack') this.setState(enemy, 'chase');
      } else enemy.unseenTime += delta;

      switch (enemy.state) {
        case 'patrol':
          if (enemy.position.distanceTo(enemy.patrolTarget) < 1 || enemy.stateTime > 9) { this.choosePatrol(enemy);enemy.stateTime = 0; }
          this.move(enemy, enemy.patrolTarget, stats.patrolSpeed, delta);
          break;
        case 'chase':
          if (clear && distance <= stats.attackRange && enemy.cooldown <= 0 && (seen || heard)) {
            enemy.attackTarget.copy(ctx.playerPosition);enemy.attackHit = false;enemy.attackCount++;
            enemy.attackMode = enemy.kind === 'ordinary' ? 'melee' : enemy.kind === 'giant' ? 'stomp' : enemy.kind === 'large' ? 'sweep'
              : enemy.kind === 'armored' ? (enemy.attackCount % 2 ? 'charge' : 'melee')
                : (distance < stats.specialRadius * 0.8 && enemy.attackCount % 3 === 0 ? 'shockwave' : 'ranged');
            enemy.route = [];this.setState(enemy, 'windup');
          } else if (enemy.unseenTime > stats.loseSightAfter) {
            this.setState(enemy, 'search');
          } else if (clear && distance <= (enemy.kind === 'beast' ? stats.attackRange * 0.6 : Math.min(stats.attackRange * 0.82, stats.radius + 0.9))) {
            // Await the next strike at arm's length instead of walking into the player's centre.
            // If movement/knockback already caused overlap, ease backwards without crossing walls.
            if (distance < stats.radius + 0.5) {
              const backX = distance > 1e-5 ? -dx / distance : -Math.sin(enemy.root.rotation.y);
              const backZ = distance > 1e-5 ? -dz / distance : -Math.cos(enemy.root.rotation.y);
              const step = Math.min(stats.radius + 0.5 - distance, stats.speed * 0.5 * delta);
              const nx = enemy.position.x + backX * step, nz = enemy.position.z + backZ * step;
              const grid = enemy.height > 2.65 ? this.giantColliders : this.colliders;
              if (!grid.blocksWallSegment(enemy.position.x, enemy.position.z, nx, nz, stats.radius)) {
                enemy.position.x = nx;enemy.position.z = nz;grid.resolve(enemy.position, stats.radius);
              }
            }
            this.face(enemy, ctx.playerPosition, delta * 8);
          } else this.move(enemy, enemy.lastSeen, stats.speed, delta);
          break;
        case 'search':
          if (enemy.stateTime > stats.searchSeconds || enemy.position.distanceTo(enemy.home) > stats.leash) this.setState(enemy, 'return');
          else if (enemy.position.distanceTo(enemy.lastSeen) > 1.4) this.move(enemy, enemy.lastSeen, stats.speed * 0.65, delta);
          else enemy.root.rotation.y += delta * 0.8;
          break;
        case 'return':
          if (enemy.position.distanceTo(enemy.home) < 1.6) { this.choosePatrol(enemy);this.setState(enemy, 'patrol'); }
          else this.move(enemy, enemy.home, stats.patrolSpeed * 1.25, delta);
          break;
        case 'windup':
          this.face(enemy, enemy.attackTarget, delta * 8);
          if (enemy.stateTime >= stats.windup) {
            this.setState(enemy, 'attack');enemy.cooldown = stats.cooldown;attacks++;
            if (enemy.attackMode === 'ranged') this.throwRock(enemy, ctx.playerPosition);
            else if (enemy.attackMode === 'shockwave') this.startWave(enemy);
            else if (enemy.attackMode !== 'charge') {
              const toX = ctx.playerPosition.x - enemy.position.x, toZ = ctx.playerPosition.z - enemy.position.z;
              const range = stats.attackRange + (enemy.attackMode === 'sweep' ? 0.7 : 0);
              const angle = Math.hypot(toX, toZ) < 0.01 ? 1 : (Math.sin(enemy.root.rotation.y) * toX + Math.cos(enemy.root.rotation.y) * toZ) / Math.hypot(toX, toZ);
              const arc = enemy.attackMode === 'stomp' ? -1 : enemy.attackMode === 'sweep' ? 0.05 : 0.35;
              if (Math.hypot(toX, toZ) <= range && angle > arc && !this.colliders.blocksWallSegment(enemy.position.x, enemy.position.z, ctx.playerPosition.x, ctx.playerPosition.z)) damage += stats.damage;
            }
          }
          break;
        case 'attack':
          if (enemy.attackMode === 'charge' && enemy.stateTime < stats.chargeSeconds) {
            const nextX = enemy.position.x + Math.sin(enemy.root.rotation.y) * stats.chargeSpeed * delta;
            const nextZ = enemy.position.z + Math.cos(enemy.root.rotation.y) * stats.chargeSpeed * delta;
            const grid = enemy.height > 2.65 ? this.giantColliders : this.colliders;
            if (grid.blocksWallSegment(enemy.position.x, enemy.position.z, nextX, nextZ, stats.radius)) enemy.stateTime = 1;
            else { enemy.position.x = nextX;enemy.position.z = nextZ;grid.resolve(enemy.position, stats.radius); }
            const d = enemy.position.distanceTo(ctx.playerPosition);
            if (!enemy.attackHit && d < stats.radius + 0.85 && !this.colliders.blocksWallSegment(enemy.position.x, enemy.position.z, ctx.playerPosition.x, ctx.playerPosition.z)) { damage += stats.damage;enemy.attackHit = true; }
          }
          if (enemy.stateTime > (enemy.attackMode === 'charge' ? stats.chargeSeconds + 0.15 : stats.recoverySeconds)) this.setState(enemy, enemy.unseenTime > stats.loseSightAfter ? 'search' : 'chase');
          break;
      }
      const travelled = Math.hypot(enemy.position.x - beforeX, enemy.position.z - beforeZ);
      enemy.stride += travelled / Math.max(3.5, stats.height * 0.85);
      this.animate(enemy, elapsed, travelled / Math.max(delta, 0.001));
    }
    damage += this.updateProjectiles(delta, ctx.playerPosition);
    damage += this.updateWaves(delta, ctx.playerPosition);
    // Contact stacks may overlap, but a single frame cannot delete the player's entire health bar.
    return { damage: Math.min(55, damage), attacks };
  }

  attackFromPlayer(origin: THREE.Vector3, forward: THREE.Vector3): { hit: boolean; killed: boolean; kind?: CityMonsterKind; damage?: number; health?: number; maxHealth?: number } {
    if (this.playerAttackCooldown > 0) return { hit: false, killed: false };
    this.playerAttackCooldown = CITY_PLAYER_COMBAT.cooldown;
    let target: CityEnemy | null = null, nearest = Infinity;
    const length = Math.hypot(forward.x, forward.z);
    if (length < 1e-6) return { hit: false, killed: false };
    for (const enemy of this.enemies) {
      if (enemy.state === 'dead') continue;
      const dx = enemy.position.x - origin.x, dz = enemy.position.z - origin.z;
      const distance = Math.hypot(dx, dz), radius = CITY_MONSTERS[enemy.kind].radius;
      if (distance > CITY_PLAYER_COMBAT.reach + radius) continue;
      // At contact there is no stable bearing; an overlapping enemy must remain hittable.
      const alignment = distance < 0.05 ? 1 : (dx * forward.x + dz * forward.z) / (distance * length);
      if (alignment < 0.55) continue;
      if (this.colliders.blocksWallSegment(origin.x, origin.z, enemy.position.x, enemy.position.z)) continue;
      if (distance < nearest) { nearest = distance;target = enemy; }
    }
    if (!target) return { hit: false, killed: false };
    const damage = Math.max(1, Math.round(CITY_PLAYER_COMBAT.damage * (1 - CITY_MONSTERS[target.kind].defense)));
    target.health = Math.max(0, target.health - damage);
    target.root.userData.hitUntil = 0.12;
    if (target.health === 0) { this.setState(target, 'dead');target.telegraph.visible = false; }
    else {
      target.lastSeen.copy(origin);target.unseenTime = 0;
      // Giant windups are deliberate commitments; tapping their ankles cannot stun-lock them.
      if (target.kind === 'ordinary' || (target.state !== 'windup' && target.state !== 'attack')) this.setState(target, 'chase');
    }
    return { hit: true, killed: target.health === 0, kind: target.kind, damage, health: target.health, maxHealth: target.maxHealth };
  }

  debugState() {
    return this.enemies.map(e => ({ id: e.id, kind: e.kind, state: e.state, height: e.height, health: e.health, maxHealth: e.maxHealth, position: { x: e.position.x, y: e.position.y, z: e.position.z }, cooldown: e.cooldown, unseenTime: e.unseenTime, attackMode: e.attackMode }));
  }

  dispose(): void {
    this.root.removeFromParent();this.root.clear();
    for (const geo of this.geometries) geo.dispose();for (const material of this.materials) material.dispose();
    this.geometries.clear();this.materials.clear();this.enemies.length = 0;this.projectiles.length = 0;this.waves.length = 0;
  }

  private own<T extends THREE.BufferGeometry>(geometry: T): T { this.geometries.add(geometry);return geometry; }
  private setState(enemy: CityEnemy, state: CityMonsterState): void {
    if (enemy.state !== state) { enemy.state = state;enemy.stateTime = 0; }
  }

  private choosePatrol(enemy: CityEnemy): void {
    const stats = CITY_MONSTERS[enemy.kind];
    const grid = enemy.height > 2.65 ? this.giantColliders : this.colliders;
    let clear = false;
    // A giant must not choose a geometrically free point inside a low-roofed house.
    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = this.rng() * Math.PI * 2, distance = 2 + this.rng() * stats.patrolRadius;
      enemy.patrolTarget.copy(enemy.home).add(this.scratch.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance));
      this.freePoint(enemy.patrolTarget, stats.radius);
      if (!grid.blocksWallSegment(enemy.home.x, enemy.home.z, enemy.patrolTarget.x, enemy.patrolTarget.z, stats.radius + 0.05)) { clear = true;break; }
    }
    if (!clear) enemy.patrolTarget.copy(enemy.home);
    enemy.route = [];
  }

  private freePoint(point: THREE.Vector3, radius: number): void {
    point.x = THREE.MathUtils.clamp(point.x, -52 + radius, 52 - radius);
    point.z = THREE.MathUtils.clamp(point.z, -126 + radius, 5 - radius);point.y = 0;
    if (this.colliders.isFree(point.x, point.z, radius)) return;
    const x = point.x, z = point.z;
    for (let ring = 1; ring <= 8; ring++) for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const qx = THREE.MathUtils.clamp(x + Math.cos(angle) * ring * 0.6, -51, 51);
      const qz = THREE.MathUtils.clamp(z + Math.sin(angle) * ring * 0.6, -125, 4);
      if (this.colliders.isFree(qx, qz, radius)) { point.set(qx, 0, qz);return; }
    }
    this.colliders.resolve(point, radius);
  }

  private face(enemy: CityEnemy, target: THREE.Vector3, amount: number): void {
    const angle = Math.atan2(target.x - enemy.position.x, target.z - enemy.position.z);
    const difference = Math.atan2(Math.sin(angle - enemy.root.rotation.y), Math.cos(angle - enemy.root.rotation.y));
    enemy.root.rotation.y += difference * Math.min(1, amount);
  }

  private move(enemy: CityEnemy, target: THREE.Vector3, speed: number, dt: number): void {
    const radius = CITY_MONSTERS[enemy.kind].radius;
    const colliders = enemy.height > 2.65 ? this.giantColliders : this.colliders;
    let tx = target.x, tz = target.z;
    const blocked = colliders.blocksWallSegment(enemy.position.x, enemy.position.z, tx, tz, radius + 0.05);
    if (blocked) {
      if (enemy.routeCooldown <= 0 && (!enemy.route.length || enemy.routeGoal.distanceTo(target) > 2 || (enemy.routeIndex >= enemy.route.length - 1 && Math.hypot(enemy.route[enemy.routeIndex].x - enemy.position.x, enemy.route[enemy.routeIndex].z - enemy.position.z) < 0.8))) {
        // Limit a single planner's rectangle for distant targets; plan an intermediate street waypoint first.
        this.scratch.copy(target).sub(enemy.position);const distance = this.scratch.length();
        if (distance > 55) this.scratch.multiplyScalar(42 / distance);
        this.scratch.add(enemy.position);
        if (distance > 55) this.freePoint(this.scratch, radius);
        enemy.route = colliders.routeAroundWalls(enemy.position, this.scratch, radius);
        enemy.routeIndex = 0;enemy.routeGoal.copy(target);enemy.routeCooldown = 0.8;
      }
      while (enemy.routeIndex < enemy.route.length - 1 && Math.hypot(enemy.route[enemy.routeIndex].x - enemy.position.x, enemy.route[enemy.routeIndex].z - enemy.position.z) < 0.5) enemy.routeIndex++;
      for (let i = Math.min(enemy.routeIndex + 4, enemy.route.length - 1); i > enemy.routeIndex; i--) {
        const p = enemy.route[i];
        if (!colliders.blocksWallSegment(enemy.position.x, enemy.position.z, p.x, p.z, radius + 0.06)) { enemy.routeIndex = i;break; }
      }
      const point = enemy.route[enemy.routeIndex];if (point) { tx = point.x;tz = point.z; }
    } else enemy.route = [];
    let dx = tx - enemy.position.x, dz = tz - enemy.position.z;
    const distance = Math.hypot(dx, dz);if (distance < 0.08) return;
    dx /= distance;dz /= distance;
    colliders.avoid(enemy.position.x + dx * 0.8, enemy.position.z + dz * 0.8, radius + 0.6, this.avoid, false);
    dx += this.avoid.x * 0.85;dz += this.avoid.z * 0.85;
    const inv = 1 / Math.max(0.001, Math.hypot(dx, dz)), step = Math.min(distance, speed * dt);
    const nx = enemy.position.x + dx * inv * step, nz = enemy.position.z + dz * inv * step;
    if (!colliders.blocksWallSegment(enemy.position.x, enemy.position.z, nx, nz, radius)) {
      enemy.position.x = nx;enemy.position.z = nz;colliders.resolve(enemy.position, radius);
    } else if (enemy.routeCooldown <= 0) enemy.route = [];
    enemy.position.x = THREE.MathUtils.clamp(enemy.position.x, -52 + radius, 52 - radius);
    enemy.position.z = THREE.MathUtils.clamp(enemy.position.z, -126 + radius, 5 - radius);
    this.scratch.set(tx, 0, tz);this.face(enemy, this.scratch, dt * 7);
  }

  private animate(enemy: CityEnemy, elapsed: number, speed: number): void {
    const attacking = enemy.state === 'windup' || enemy.state === 'attack';
    const wind = enemy.state === 'windup' ? Math.min(1, enemy.stateTime / CITY_MONSTERS[enemy.kind].windup) : 0;
    enemy.arms.forEach((arm, i) => {
      const wave = Math.sin(enemy.stride * Math.PI * 2 + i * Math.PI);
      arm.rotation.x = attacking ? -1.7 * wind + (enemy.state === 'attack' ? 0.55 : 0) : wave * Math.min(0.35, speed * 0.05);
    });
    enemy.legs.forEach((leg, i) => leg.rotation.x = Math.sin(enemy.stride * Math.PI * 2 + i * Math.PI) * Math.min(0.35, speed * 0.055));
    const torso = enemy.root.getObjectByName('sentinel-torso');if (torso) torso.scale.y = 1 + Math.sin(elapsed * 1.7 + enemy.id) * 0.012;
    enemy.telegraph.visible = enemy.state === 'windup' || (enemy.state === 'attack' && enemy.attackMode === 'charge');
    enemy.telegraph.position.set(enemy.position.x, 0.035, enemy.position.z);
    const radius = enemy.attackMode === 'shockwave' ? CITY_MONSTERS[enemy.kind].specialRadius : enemy.attackMode === 'ranged' ? 2 : CITY_MONSTERS[enemy.kind].attackRange;
    enemy.telegraph.scale.setScalar(radius);
    const material = enemy.telegraph.material as THREE.MeshBasicMaterial;
    material.opacity = 0.22 + wind * 0.48;
    material.color.set(enemy.attackMode === 'charge' ? '#e9674f' : '#e8b856');
  }

  private throwRock(enemy: CityEnemy, target: THREE.Vector3): void {
    const projectile = this.projectiles.find(p => !p.active);if (!projectile) return;
    projectile.active = true;projectile.age = 0;projectile.owner = enemy.id;projectile.mesh.visible = true;
    projectile.position.copy(enemy.position).add(this.scratch.set(0, enemy.height * 0.72, 0));
    const distance = Math.hypot(target.x - enemy.position.x, target.z - enemy.position.z);
    const seconds = Math.max(0.45, distance / CITY_MONSTERS[enemy.kind].projectileSpeed);
    projectile.velocity.set((target.x - projectile.position.x) / seconds, (1 - projectile.position.y + 4.9 * seconds * seconds) / seconds, (target.z - projectile.position.z) / seconds);
    projectile.mesh.scale.setScalar(1.45);
  }

  private updateProjectiles(dt: number, player: THREE.Vector3): number {
    let damage = 0;
    for (const p of this.projectiles) {
      if (!p.active) continue;
      const x = p.position.x, z = p.position.z;
      p.age += dt;p.velocity.y -= 9.8 * dt;p.position.addScaledVector(p.velocity, dt);p.mesh.rotation.x += dt * 2.5;p.mesh.rotation.z += dt;
      const wall = this.colliders.blocksWallSegment(x, z, p.position.x, p.position.z, 0.25);
      const hit = Math.hypot(p.position.x - player.x, p.position.y - (player.y + 1), p.position.z - player.z) < 1.15;
      if (hit && !wall && !this.colliders.blocksWallSegment(p.position.x, p.position.z, player.x, player.z)) damage += CITY_MONSTERS[this.enemies[p.owner].kind].damage;
      if (hit || wall || p.age > CITY_MONSTERS[this.enemies[p.owner].kind].projectileLifetime || p.position.y < 0.25) { p.active = false;p.mesh.visible = false; }
    }
    return damage;
  }

  private startWave(enemy: CityEnemy): void {
    const wave = this.waves.find(w => !w.active);if (!wave) return;
    wave.active = true;wave.owner = enemy.id;wave.radius = 0.2;wave.previousRadius = 0;wave.maxRadius = CITY_MONSTERS[enemy.kind].specialRadius;wave.hit = false;
    wave.mesh.position.set(enemy.position.x, 0.055, enemy.position.z);wave.mesh.visible = true;
  }

  private updateWaves(dt: number, player: THREE.Vector3): number {
    let damage = 0;
    for (const wave of this.waves) {
      if (!wave.active) continue;
      wave.previousRadius = wave.radius;wave.radius += dt * CITY_MONSTERS[this.enemies[wave.owner].kind].waveSpeed;wave.mesh.scale.setScalar(wave.radius);
      const distance = Math.hypot(player.x - wave.mesh.position.x, player.z - wave.mesh.position.z);
      if (!wave.hit && distance >= wave.previousRadius - 0.6 && distance <= wave.radius + 0.6 && !this.colliders.blocksWallSegment(wave.mesh.position.x, wave.mesh.position.z, player.x, player.z)) { wave.hit = true;damage += CITY_MONSTERS[this.enemies[wave.owner].kind].specialDamage; }
      if (wave.radius > wave.maxRadius) { wave.active = false;wave.mesh.visible = false; }
    }
    return damage;
  }

  private makeModel(mats: MaterialLibrary, kind: CityMonsterKind): THREE.Group {
    const root = new THREE.Group(), body = new THREE.Group();root.add(body);body.name = 'sentinel-body';
    const stats = CITY_MONSTERS[kind];
    const skin = new THREE.MeshStandardMaterial({ color: stats.color, roughness: 0.95, map: mats.stoneTex });
    const cloth = new THREE.MeshStandardMaterial({ color: kind === 'beast' ? '#2d4534' : '#343a43', roughness: 1, map: mats.clothTex });
    const metal = new THREE.MeshStandardMaterial({ color: kind === 'armored' ? '#78878d' : '#8a7354', roughness: 0.55, metalness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: '#20252a', roughness: 0.85 });
    const eye = new THREE.MeshBasicMaterial({ color: kind === 'beast' ? '#b7d790' : '#edca7a' });
    for (const material of [skin, cloth, metal, dark, eye]) this.materials.add(material);
    const parts = new Map<THREE.Group, Map<THREE.Material, THREE.BufferGeometry[]>>();
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Group = body): void => {
      const map = parts.get(parent) ?? new Map<THREE.Material, THREE.BufferGeometry[]>();
      const list = map.get(material) ?? [];const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
      if (nonIndexed !== geometry) geometry.dispose();list.push(nonIndexed);map.set(material, list);parts.set(parent, map);
    };
    const ball = (x: number, y: number, z: number, sx: number, sy: number, sz: number, material: THREE.Material, parent = body): void => {
      add(new THREE.SphereGeometry(1, 12, 8).scale(sx, sy, sz).translate(x, y, z), material, parent);
    };
    const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, material: THREE.Material, parent = body): void => {
      add(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), material, parent);
    };
    const tube = (points: THREE.Vector3[], radius: number, material: THREE.Material): void => {
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 7, radius, 6, false), material);
    };
    const broad = kind === 'large' ? 1.25 : kind === 'armored' ? 1.2 : 1;
    const torso = new THREE.Group();torso.name = 'sentinel-torso';body.add(torso);
    ball(0, 0.62, 0, 0.15 * broad, 0.21, 0.09, skin, torso);
    ball(0, 0.40, 0, 0.115, 0.09, 0.08, cloth);
    ball(0, 0.88, 0.005, 0.083, 0.106, 0.072, skin);
    // Sculpted mask, central ridge, brow, cheek plates and recessed eye slit.
    box(0, 0.89, 0.067, 0.145, 0.028, 0.025, dark);
    for (const sign of [-1, 1]) {
      ball(sign * 0.043, 0.892, 0.083, 0.021, 0.009, 0.008, eye);
      box(sign * 0.075, 0.85, 0.055, 0.025, 0.09, 0.028, metal);
      box(sign * 0.04, 0.80, 0.06, 0.055, 0.019, 0.035, dark);
    }
    box(0, 0.89, 0.087, 0.022, 0.11, 0.025, metal);
    const mantle = new THREE.CylinderGeometry(0.18 * broad, 0.20 * broad, 0.065, 12, 1, true);
    mantle.translate(0, 0.765, 0);add(mantle, cloth);
    for (let i = 0; i < 5; i++) {
      const z = 0.083 + Math.abs(i - 2) * 0.003;
      box(0, 0.70 - i * 0.043, z, 0.23 * broad - i * 0.014, 0.012, 0.025, kind === 'armored' ? metal : dark, torso);
    }
    for (const sign of [-1, 1]) {
      const leg = new THREE.Group();leg.name = sign < 0 ? 'leg-left' : 'leg-right';leg.position.set(sign * 0.07, 0.40, 0);body.add(leg);
      ball(0, -0.09, 0, 0.055, 0.13, 0.06, skin, leg);
      ball(0, -0.23, 0.01, 0.045, 0.12, 0.044, skin, leg);
      ball(0, -0.36, 0.035, 0.056, 0.035, 0.09, dark, leg);
      ball(0, -0.19, 0.035, 0.047, 0.045, 0.035, metal, leg);
      const arm = new THREE.Group();arm.name = sign < 0 ? 'arm-left' : 'arm-right';arm.position.set(sign * 0.18 * broad, 0.75, 0);body.add(arm);
      const length = kind === 'beast' ? 1.35 : 1;
      ball(sign * 0.02, -0.09 * length, 0, 0.052, 0.13 * length, 0.05, skin, arm);
      ball(sign * 0.03, -0.24 * length, 0.01, 0.045, 0.12 * length, 0.043, skin, arm);
      ball(sign * 0.03, -0.36 * length, 0.025, 0.055, 0.06, 0.045, dark, arm);
      for (let finger = 0; finger < 3; finger++) box(sign * 0.03 + (finger - 1) * 0.025, -0.414 * length, 0.04, 0.017, 0.06, 0.025, metal, arm);
    }
    if (kind === 'armored') {
      for (let row = 0; row < 3; row++) for (const sign of [-1, 1]) {
        ball(sign * (0.11 - row * 0.008), 0.70 - row * 0.085, 0.08, 0.085, 0.062, 0.04, metal, torso);
        box(sign * 0.155, 0.43 - row * 0.025, 0, 0.055, 0.11, 0.19, metal);
      }
      for (const sign of [-1, 1]) ball(sign * 0.215, 0.765, 0, 0.10, 0.07, 0.115, metal);
      box(0, 0.985, 0, 0.04, 0.07, 0.08, metal);
    } else if (kind === 'large') {
      ball(0, 0.72, -0.1, 0.17, 0.15, 0.11, metal);
      for (const sign of [-1, 1]) {
        const bell = new THREE.CylinderGeometry(0.03, 0.065, 0.1, 10, 1, true);bell.translate(sign * 0.17, 0.66, 0);add(bell, metal);
        tube([new THREE.Vector3(sign * 0.1, 0.80, -0.04), new THREE.Vector3(sign * 0.18, 0.88, -0.1), new THREE.Vector3(sign * 0.20, 0.76, -0.14)], 0.019, cloth);
      }
    } else if (kind === 'beast') {
      for (const sign of [-1, 1]) {
        tube([new THREE.Vector3(sign * 0.06, 0.95, -0.01), new THREE.Vector3(sign * 0.13, 1.04, -0.035), new THREE.Vector3(sign * 0.20, 1.08, 0.01)], 0.018, dark);
        for (let j = 0; j < 4; j++) {
          const tassel = new THREE.ConeGeometry(0.025, 0.16, 6);tassel.rotateZ(sign * 0.25).translate(sign * (0.13 + j * 0.026), 0.72 - j * 0.02, -0.05);add(tassel, cloth);
        }
      }
      for (let j = 0; j < 4; j++) ball(0, 0.55 + j * 0.065, -0.105, 0.04, 0.045, 0.035, dark);
    } else if (kind === 'ordinary') {
      const hood = new THREE.SphereGeometry(0.104, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.65);hood.scale(1, 1.2, 1).translate(0, 0.89, -0.01);add(hood, cloth);
      for (const sign of [-1, 1]) box(sign * 0.13, 0.36, -0.01, 0.06, 0.18, 0.11, cloth);
    }
    for (const [parent, byMaterial] of parts) for (const [material, geometries] of byMaterial) {
      const geometry = mergeGeometries(geometries, false);for (const piece of geometries) piece.dispose();
      if (!geometry) throw new Error('Could not build city sentinel');this.own(geometry);
      const mesh = new THREE.Mesh(geometry, material);mesh.castShadow = true;mesh.receiveShadow = true;parent.add(mesh);
    }
    root.updateMatrixWorld(true);const bounds = new THREE.Box3().setFromObject(body);
    const scale = 1 / Math.max(0.001, bounds.max.y - bounds.min.y);
    body.scale.setScalar(scale);body.position.y = -bounds.min.y * scale;
    return root;
  }
}
