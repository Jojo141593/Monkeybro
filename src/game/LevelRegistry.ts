export interface PlayableScene { start(): void; startRun(seed?: number): void; dispose(): void; }
export interface LevelDefinition {
  id: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  load: (canvas: HTMLCanvasElement) => Promise<PlayableScene>;
}
const definitions = new Map<string, LevelDefinition>();
/** Later levels register a factory without changing the menu or either existing scene. */
export function registerLevel(level: LevelDefinition): void {
  if (definitions.has(level.id)) throw new Error(`Duplicate level: ${level.id}`);
  definitions.set(level.id, level);
}
export function listLevels(): LevelDefinition[] { return [...definitions.values()]; }
export function getLevel(id: string): LevelDefinition {
  const level=definitions.get(id);if(!level)throw new Error(`Unknown level: ${id}`);return level;
}
registerLevel({ id:'orchard',name:{zh:'第一关 · 偷桃夜',en:'I · Peach Heist Night'},description:{zh:'灯影下的蟠桃园 · 古院搜箱 · 妖仙追猎',en:'Haunted orchard · hidden courtyards · fairy-demons'},load:async canvas=>{const {Game}=await import('./Game');return new Game(canvas);} });
registerLevel({ id:'city',name:{zh:'第二关 · 灰墙情报',en:'II · Intelligence of the Greywall'},description:{zh:'红瓦石城 · 原创巨人 · 搜集情报图纸并撤离',en:'Walled medieval city · original giants · intel extraction'},load:async canvas=>{const {CityGame}=await import('./city/CityGame');return new CityGame(canvas);} });
