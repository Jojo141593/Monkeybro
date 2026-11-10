import { expect, test, type Page, type CDPSession } from '@playwright/test';
import type { CityGame } from '../src/game/city/CityGame';
import { INTEL_RARITIES, rollIntel } from '../src/game/city/IntelBlueprints';
import { createSeededRandom } from '../src/utils/random';

async function enterCity(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.level-card[data-level="city"]').click();
  await page.locator('#start-button').click();
  await page.waitForFunction(()=>!!(window as unknown as {__CITY__?:CityGame}).__CITY__);
  await expect(page.locator('body')).toHaveAttribute('data-level','city');
  await expect(page.locator('body')).toHaveAttribute('data-state','playing');
}
async function step(page: Page, frames: number): Promise<void> {
  await page.evaluate(frames=>{const g=(window as unknown as {__CITY__:CityGame}).__CITY__;for(let i=0;i<frames;i++)g.update(1/60,i/60);},frames);
}

test('intel rarity weights, colors and values match the configured four-tier economy',()=>{
  expect(INTEL_RARITIES.map(i=>i.value)).toEqual([10,100,1000,10000]);
  expect(INTEL_RARITIES.map(i=>i.color)).toEqual(['#55c878','#55a6ff','#b77aff','#ff9f43']);
  const rng=createSeededRandom(149),counts=[0,0,0,0];for(let i=0;i<20000;i++)counts[rollIntel(rng)]++;
  expect(counts[0]).toBeGreaterThan(counts[1]);expect(counts[1]).toBeGreaterThan(counts[2]);expect(counts[2]).toBeGreaterThan(counts[3]);
  for(let i=0;i<4;i++)expect(Math.abs(counts[i]/20000-INTEL_RARITIES[i].weight)).toBeLessThan(.02);
});

test('menu selects independent levels and switching back restores first-level functionality',async({page})=>{
  test.setTimeout(60000);
  await page.goto('/');await expect(page.locator('.level-card')).toHaveCount(2);
  await page.locator('#start-button').click();
  await expect(page.locator('body')).toHaveAttribute('data-state','playing');
  await page.keyboard.press('KeyP');await expect(page.locator('body')).toHaveAttribute('data-state','paused');
  await page.locator('#level-menu-button').click();
  await page.locator('.level-card[data-level="city"]').click();await page.locator('#start-button').click();
  await page.waitForFunction(()=>!!(window as unknown as {__CITY__?:CityGame}).__CITY__);
  expect(await page.evaluate(()=>(window as unknown as {__MONKEYBRO__?:unknown}).__MONKEYBRO__===undefined)).toBe(true);
  await page.keyboard.press('KeyP');await expect(page.locator('body')).toHaveAttribute('data-state','paused');
  await page.locator('#level-menu-button').click();
  await page.locator('.level-card[data-level="orchard"]').click();await page.locator('#start-button').click();
  await expect(page.locator('body')).toHaveAttribute('data-level','orchard');await expect(page.locator('body')).toHaveAttribute('data-state','playing');
  const state=await page.evaluate(()=>{
    const w=window as unknown as {__CITY__?:CityGame;__MONKEYBRO__:{debugState():{state:string;health:number}}};
    return {cityAbsent:!w.__CITY__,original:w.__MONKEYBRO__.debugState()};
  });
  expect(state.cityAbsent).toBe(true);expect(state.original.health).toBe(100);
});

test('real hold search cancels, pays once, updates colored inventory, and settles only on extraction',async({page},info)=>{
  await enterCity(page);
  await page.evaluate(()=>{
    const g=(window as unknown as {__CITY__:CityGame}).__CITY__;g.loop.stop();
    window.__THREE_GAME_TEST_HOOKS__!.seed(42);window.__THREE_GAME_TEST_HOOKS__!.setState('city-supply');
  });
  await expect(page.locator('#prompt')).toBeVisible();
  let touch: CDPSession | undefined;
  const box=await page.locator('#touch-harvest').boundingBox();
  const down=async()=>{
    if(info.project.name.includes('mobile')){
      if(!box)throw Error('Missing mobile search control');touch=await page.context().newCDPSession(page);
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
    }else await page.keyboard.down('KeyE');
  };
  const up=async()=>{if(touch){await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();touch=undefined;}else await page.keyboard.up('KeyE');};
  await down();await step(page,35);await up();await step(page,1);
  expect(await page.evaluate(()=>(window as unknown as {__CITY__:CityGame}).__CITY__.haul)).toBe(0);
  await down();await step(page,100);await up();
  const looted=await page.evaluate(()=>{
    const g=(window as unknown as {__CITY__:CityGame}).__CITY__;return {haul:g.haul,counts:[...g.inventory],opened:g.supplies.chests.filter(c=>c.opened).length};
  });
  expect(looted.haul).toBeGreaterThan(0);expect(looted.counts.reduce((a,b)=>a+b,0)).toBe(1);expect(looted.opened).toBe(1);
  expect(await page.evaluate(()=>localStorage.getItem('greywall.last-extraction'))).toBeNull();
  await down();await step(page,100);await up();
  expect(await page.evaluate(()=>(window as unknown as {__CITY__:CityGame}).__CITY__.haul)).toBe(looted.haul);
  await page.evaluate(()=>{
    const g=(window as unknown as {__CITY__:CityGame}).__CITY__;
    for(const enemy of g.monsters.enemies){enemy.health=0;enemy.state='dead';}
    g.player.reset(g.world.extraction.position.clone(),0);
  });
  await step(page,200);
  await expect(page.locator('body')).toHaveAttribute('data-state','extracted');
  const settlement=await page.evaluate(()=>JSON.parse(localStorage.getItem('greywall.last-extraction')!));
  expect(settlement.totalValue).toBe(looted.haul);expect(settlement.counts).toEqual(looted.counts);expect(settlement.levelId).toBe('city');
});

test('combat input damages targets and player death/retry resets city state',async({page},info)=>{
  await enterCity(page);
  await page.evaluate(()=>{
    const g=(window as unknown as {__CITY__:CityGame}).__CITY__;g.loop.stop();g.reset(55);
    const e=g.monsters.enemies[0];e.position.copy(g.player.position).add(g.player.forward.clone().multiplyScalar(2));e.home.copy(e.position);e.cooldown=5;
  });
  if(info.project.name.includes('mobile'))await page.locator('#touch-attack').dispatchEvent('pointerdown');else await page.keyboard.press('KeyQ');
  await step(page,1);
  const health=await page.evaluate(()=>(window as unknown as {__CITY__:CityGame}).__CITY__.monsters.enemies[0].health);
  expect(health).toBe(15);
  await step(page,35);await page.keyboard.press('Space');await step(page,1);
  expect(await page.evaluate(()=>(window as unknown as {__CITY__:CityGame}).__CITY__.monsters.enemies[0].health)).toBe(0);
  await page.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__!.setState('city-dead'));
  await expect(page.locator('#screen-dead')).toBeVisible();await page.locator('#retry-button').click();
  const reset=await page.evaluate(()=>(window as unknown as {__CITY__:CityGame}).__CITY__.debugState());
  expect(reset.state).toBe('playing');expect(reset.health).toBe(100);expect(reset.haul).toBe(0);expect(reset.inventory).toEqual([0,0,0,0]);
});


test('city language changes refresh dynamic HUD, pause text and completed settlement',async({page})=>{
  await enterCity(page);
  await page.evaluate(()=>(window as unknown as {__CITY__:CityGame}).__CITY__.loop.stop());
  await page.keyboard.press('KeyP');await page.locator('#lang-button').click();
  await expect(page.locator('#light-state')).toHaveText('明');
  await expect(page.locator('#screen-pause .muted')).toHaveText('石墙外的脚步暂时停下。');
  await page.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__!.setState('city-chest-open'));
  await page.keyboard.press('KeyP');await page.locator('#lang-button').click();
  await expect(page.locator('#light-state')).toHaveText('LIT');
  await expect(page.locator('#banner-title')).toHaveText('Intel blueprint found');
  await page.evaluate(()=>window.__THREE_GAME_TEST_HOOKS__!.setState('city-extracted'));
  await expect(page.locator('#screen-extracted h2')).toHaveText('Escaped Greywall');
});


test('scene renderer reuse preserves canvas colors across an explicit graphics-state reset',async({page})=>{
 await enterCity(page);
 const difference=await page.evaluate(()=>{
  const g=(window as unknown as {__CITY__:CityGame}).__CITY__;g.loop.stop();
  const sample=()=>{
   g.renderer.render(g.scene,g.camera);const gl=g.renderer.getContext(),data:number[]=[];
   for(let row=1;row<=5;row++)for(let col=1;col<=5;col++){const pixel=new Uint8Array(4);gl.readPixels(Math.floor(gl.drawingBufferWidth*col/6),Math.floor(gl.drawingBufferHeight*row/6),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);data.push(...pixel.slice(0,3));}return data;
  };
  const before=sample();g.renderer.resetState();const after=sample();return before.reduce((sum,v,i)=>sum+Math.abs(v-after[i]),0)/before.length;
 });
 expect(difference).toBeLessThan(5);
});
