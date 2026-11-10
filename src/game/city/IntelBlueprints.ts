export type IntelTier = 0 | 1 | 2 | 3;
export const INTEL_RARITIES = [
  { tier: 0, name: '普通情报图纸', en: 'Common Intel Blueprint', color: '#55c878', value: 10, weight: 0.65 },
  { tier: 1, name: '稀有情报图纸', en: 'Rare Intel Blueprint', color: '#55a6ff', value: 100, weight: 0.25 },
  { tier: 2, name: '史诗情报图纸', en: 'Epic Intel Blueprint', color: '#b77aff', value: 1000, weight: 0.085 },
  { tier: 3, name: '传说情报图纸', en: 'Legendary Intel Blueprint', color: '#ff9f43', value: 10000, weight: 0.015 },
] as const;
export function rollIntel(rng: () => number): IntelTier {
  let value=rng();
  for(const rarity of INTEL_RARITIES){value-=rarity.weight;if(value<0)return rarity.tier;}
  return 3;
}
export interface IntelInventory { counts: number[]; totalValue: number; }
export interface ExtractionSettlement { levelId: string; seed: number; counts: number[]; totalValue: number; extractedAt: string; }
