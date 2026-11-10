import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const dir='artifacts/greywall-20261109-r3';await mkdir(dir,{recursive:true});
const b=await chromium.launch(process.env.CHROME_EXECUTABLE_PATH?{executablePath:process.env.CHROME_EXECUTABLE_PATH}:{channel:'chromium'});
try {
 const p=await b.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:5188/monkeytest/');await p.locator('.level-card[data-level="city"]').click();await p.locator('#start-button').click();await p.waitForFunction(()=>!!window.__CITY__);
 await p.evaluate(()=>{const g=window.__CITY__;g.loop.stop();g.reset(42);});
 const sample=async(name,frames)=>{
  const state=await p.evaluate(frames=>{const g=window.__CITY__;for(let i=0;i<frames;i++)g.update(1/60,g.elapsed+1/60);g.render();const e=g.monsters.enemies.find(e=>e.kind==='giant');return {gameTime:g.elapsed,cameraHeight:g.camera.position.y,playerPosition:g.player.position.toArray(),health:g.player.health,enemy:{state:e.state,position:e.position.toArray(),health:e.health,armRotation:e.arms[0].rotation.x,legRotation:e.legs[0].rotation.x,telegraph:e.telegraph.visible},haul:g.haul,cache:g.supplies.debugState()[0]};},frames);
  await p.screenshot({path:`${dir}/motion-${name}.png`,scale:'css'});return {name,...state};
 };
 const samples=[];
 await p.keyboard.down('KeyW');samples.push(await sample('walk',45));await p.keyboard.up('KeyW');
 await p.evaluate(()=>{const g=window.__CITY__;for(const e of g.monsters.enemies){e.health=0;e.state='dead';e.stateTime=4;}const e=g.monsters.enemies.find(e=>e.kind==='giant');e.health=e.maxHealth;e.state='chase';e.stateTime=0;e.cooldown=0;e.position.copy(g.player.position).add(g.player.forward.clone().multiplyScalar(6));e.lastSeen.copy(g.player.position);e.home.copy(e.position);e.root.rotation.y=0;});
 samples.push(await sample('giant-approach',20));samples.push(await sample('giant-windup',35));samples.push(await sample('giant-contact',75));
 await p.keyboard.down('KeyW');await sample('close-distance',14);await p.keyboard.up('KeyW');await p.keyboard.press('KeyQ');samples.push(await sample('counterstrike',4));samples.push(await sample('recovery',25));
 await p.evaluate(()=>{window.__THREE_GAME_TEST_HOOKS__.seed(42);window.__THREE_GAME_TEST_HOOKS__.setState('city-supply');});
 await p.keyboard.down('KeyE');samples.push(await sample('cache-opening',90));samples.push(await sample('cache-open',35));await p.keyboard.up('KeyE');
 if(samples.some(s=>Math.abs(s.cameraHeight-1.62)>1e-8))throw Error('Camera height changed');
 if(!samples.at(-1).cache.opened||samples.at(-1).haul<=0)throw Error('Real input search failed');
 if(!samples.some(s=>s.enemy.telegraph))throw Error('No attack anticipation');
 await writeFile(`${dir}/motion.json`,JSON.stringify({runId:'greywall-20261109-r3',method:'Real keyboard W/Q/E events; unpaused playing state, simulation stepped at 1/60s and rendered at each sample. Setup isolates a giant; no FPS claim.',errors,samples},null,2));
 console.log(JSON.stringify({errors,samples:samples.map(s=>({name:s.name,health:s.health,enemy:s.enemy.state,enemyHP:s.enemy.health,haul:s.haul,cameraHeight:s.cameraHeight}))},null,2));
}finally{await b.close();}
