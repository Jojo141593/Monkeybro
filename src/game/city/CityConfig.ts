/** Level-two combat tuning. Heights are world metres; the player's eye is 1.62m. */
export type CityMonsterKind = 'ordinary' | 'giant' | 'large' | 'armored' | 'beast';
export type CityMonsterState = 'patrol' | 'chase' | 'windup' | 'attack' | 'search' | 'return' | 'dead';
export type CityAttackMode = 'melee' | 'stomp' | 'sweep' | 'charge' | 'ranged' | 'shockwave';

export interface CityMonsterStats {
  name: string;
  nameEn: string;
  height: number;
  radius: number;
  maxHealth: number;
  defense: number;
  speed: number;
  patrolSpeed: number;
  patrolRadius: number;
  vision: number;
  fieldOfView: number;
  hearing: number;
  attackRange: number;
  damage: number;
  windup: number;
  cooldown: number;
  loseSightAfter: number;
  searchSeconds: number;
  leash: number;
  projectileSpeed: number;
  specialRadius: number;
  specialDamage: number;
  waveSpeed: number;
  chargeSpeed: number;
  chargeSeconds: number;
  recoverySeconds: number;
  projectileLifetime: number;
  color: string;
}

export const CITY_BASE_GIANT_HEIGHT = 4;
export const CITY_PLAYER_COMBAT = { damage: 45, reach: 3.2, cooldown: 0.48, invulnerabilitySeconds: 0.75 } as const;

const common = {
  patrolRadius: 7, fieldOfView: 120, loseSightAfter: 2.2, searchSeconds: 7,
  leash: 75, projectileSpeed: 15, specialRadius: 0, specialDamage: 32, waveSpeed: 11,
  chargeSpeed: 8.5, chargeSeconds: 0.85, recoverySeconds: 0.5, projectileLifetime: 5,
};

export const CITY_MONSTERS: Record<CityMonsterKind, CityMonsterStats> = {
  ordinary: {
    ...common, name: '灰巷哨卫', nameEn: 'Ashlane Warden', height: 1.7, radius: 0.38,
    maxHealth: 60, defense: 0, speed: 7, patrolSpeed: 1.8, vision: 20, hearing: 12,
    attackRange: 1.65, damage: 12, windup: 0.42, cooldown: 1.3, color: '#666e75',
  },
  giant: {
    ...common, name: '荒垣巨像', nameEn: 'Ruin Colossus', height: CITY_BASE_GIANT_HEIGHT, radius: 0.65,
    maxHealth: 160, defense: 0.1, speed: 3.7, patrolSpeed: 1.2, vision: 27, hearing: 20,
    attackRange: 3.1, damage: 30, windup: 1.15, cooldown: 3.3, color: '#8a8172',
  },
  large: {
    ...common, name: '钟脊巨像', nameEn: 'Bellback Colossus', height: CITY_BASE_GIANT_HEIGHT * 1.5, radius: 0.85,
    maxHealth: 230, defense: 0.15, speed: 3.2, patrolSpeed: 1.05, vision: 32, hearing: 24,
    attackRange: 4.5, damage: 39, windup: 1.4, cooldown: 4.1, color: '#7d858a',
  },
  armored: {
    ...common, name: '铁垒巨像', nameEn: 'Iron Bastion', height: CITY_BASE_GIANT_HEIGHT * 2, radius: 1,
    maxHealth: 420, defense: 0.55, speed: 2.9, patrolSpeed: 0.9, vision: 35, hearing: 27,
    attackRange: 5.6, damage: 43, windup: 1.65, cooldown: 5, color: '#677379',
  },
  beast: {
    ...common, name: '苔角巨兽', nameEn: 'Moss-Horn Behemoth', height: CITY_BASE_GIANT_HEIGHT * 3, radius: 1.1,
    maxHealth: 520, defense: 0.2, speed: 2.8, patrolSpeed: 0.85, vision: 48, hearing: 32,
    attackRange: 30, damage: 24, windup: 1.8, cooldown: 5.6, specialRadius: 13,
    searchSeconds: 10, color: '#4c6554',
  },
};

/** The early street teaches ordinary combat; the largest silhouettes occupy the deeper city. */
export const CITY_MONSTER_ROSTER: readonly CityMonsterKind[] = [
  'ordinary', 'ordinary', 'giant', 'ordinary', 'large', 'armored', 'giant', 'beast',
];
