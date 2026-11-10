import * as THREE from 'three';
import { MaterialLibrary } from '../../assets/MaterialLibrary';
import { Input } from '../../core/Input';
import { Loop } from '../../core/Loop';
import { createRenderer, resizeRenderer } from '../../core/Renderer';
import { Player, PLAYER } from '../../entities/Player';
import { TreasureChests } from '../../entities/TreasureChests';
import { AudioSystem } from '../../systems/AudioSystem';
import { RenderPipeline } from '../../systems/RenderPipeline';
import { Hud } from '../../ui/Hud';
import { applyStaticI18n, getLang, onLangChange, toggleLang } from '../../ui/i18n';
import { CityWorld } from './CityWorld';
import { CityMonsterSystem } from './CityMonsterSystem';
import { CITY_MONSTERS, CITY_PLAYER_COMBAT } from './CityConfig';
import { INTEL_RARITIES, rollIntel, type ExtractionSettlement } from './IntelBlueprints';

type State = 'title' | 'playing' | 'paused' | 'dead' | 'extracted';
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.querySelector<T>(id)!;
const label = (zh: string,en: string): string => getLang()==='zh'?zh:en;
/** Independent second scene; shared controller, inputs, audio, HUD and search system. */
export class CityGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72,1,.08,210);
  readonly mats = new MaterialLibrary();
  readonly renderer: THREE.WebGLRenderer;
  readonly world: CityWorld;
  readonly player: Player;
  readonly input: Input;
  readonly supplies: TreasureChests;
  readonly monsters: CityMonsterSystem;
  readonly audio = new AudioSystem();
  readonly hud = new Hud();
  readonly pipeline: RenderPipeline;
  readonly inventory = [0,0,0,0];
  readonly loop: Loop;
  state: State = 'title';
  seed = 1;
  haul = 0;
  extractionProgress = 0;
  settlement: ExtractionSettlement | null = null;
  private elapsed = 0;
  private frame = 0;
  private invulnerability = 0;
  private attackCooldown = 0;
  private attackQueued = false;
  private searching = false;
  private suppressEscapeResume = false;
  private frozenForCapture = false;
  private readonly cleanup: (()=>void)[] = [];
  private readonly sun: THREE.DirectionalLight;
  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas,{antialias:true,shadows:true});
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.setClearColor('#7f8d90');this.scene.background=new THREE.Color('#7f8d90');
    this.scene.fog=new THREE.FogExp2('#7f8d90',.010);
    this.scene.add(new THREE.HemisphereLight('#d9e2df','#646957',1.25));
    this.sun=new THREE.DirectionalLight('#ffe0ad',2.2);this.sun.position.set(-40,85,10);
    this.sun.target.position.set(0,0,-58);this.sun.castShadow=true;
    this.sun.shadow.mapSize.set(1024,1024);this.sun.shadow.camera.left=-70;this.sun.shadow.camera.right=70;
    this.sun.shadow.camera.top=80;this.sun.shadow.camera.bottom=-80;this.sun.shadow.camera.far=190;
    this.sun.shadow.bias=-.0002;this.sun.shadow.normalBias=.10;this.scene.add(this.sun,this.sun.target);
    this.world=new CityWorld(this.mats);this.scene.add(this.world.root);
    this.player=new Player(this.camera,this.scene,(p,margin=0)=>{
      p.x=THREE.MathUtils.clamp(p.x,-54+margin,54-margin);p.z=THREE.MathUtils.clamp(p.z,-130+margin,8-margin);
    });
    this.player.lanternIntensity=8;
    this.scene.add(this.camera);
    this.supplies=new TreasureChests(this.mats,this.world.supplySites,{roll:rollIntel,blueprints:true});
    this.scene.add(this.supplies.root);for(const c of this.supplies.colliders){this.world.colliders.add(c);this.world.giantColliders.add(c);}
    this.monsters=new CityMonsterSystem(this.mats,this.world.colliders,this.world.patrolSites,this.world.giantColliders);this.scene.add(this.monsters.root);
    this.input=new Input(canvas,$('#touch-stick'),$('#touch-knob'),{light:$('#touch-light'),harvest:$('#touch-harvest'),sprint:$('#touch-sprint'),look:$('#touch-look')});
    this.pipeline=new RenderPipeline(this.renderer,this.scene,this.camera);
    this.loop=new Loop((dt,t)=>this.update(dt,t),()=>this.render());
    this.bind();this.reset(1);this.setState('title');this.configureHud();this.installHooks();
    if(import.meta.env.DEV)(window as unknown as {__CITY__?:CityGame}).__CITY__=this;
  }
  start(): void { this.loop.start(); }
  startRun(seed = Math.floor(Math.random()*0x7fffffff)): void {
    this.reset(seed);this.setState('playing');void this.audio.unlock();
    this.hud.showHint(()=>label('E 搜索 · Q / 空格 / 右键反击 · F 灯笼 · 抵达远端信号城门撤离','E search · Q / Space / right click strike · F lantern · Escape at the far signal gate'),9);
    if(!this.input.touchMode)this.requestLock();
  }
  reset(seed: number): void {
    this.seed=seed;this.input.releaseAll();this.player.reset(this.world.spawn,0);
    this.player.flashlight.intensity=this.player.lanternIntensity;
    this.supplies.reset(seed);this.monsters.reset(seed);this.inventory.fill(0);this.haul=0;
    this.extractionProgress=0;this.attackCooldown=0;this.attackQueued=false;this.invulnerability=0;this.searching=false;this.settlement=null;
    this.hud.clearTransient();this.hud.relocalize();this.hud.setSatchel(this.inventory,0,true);this.audio.stopAll();this.configureHud();
  }
  private on(target: EventTarget,type: string,fn: EventListener): void {
    target.addEventListener(type,fn);this.cleanup.push(()=>target.removeEventListener(type,fn));
  }
  private bind(): void {
    for(const id of ['#restart-button','#retry-button','#again-button'])this.on($(id),'click',()=>this.startRun());
    this.on($('#resume-button'),'click',()=>this.resume());
    this.on($('#touch-pause'),'click',()=>this.pause());
    this.on($('#mute-button'),'click',()=>{this.audio.setMuted(!this.audio.muted);this.configureHud();});
    this.on($('#lang-button'),'click',()=>toggleLang());
    this.cleanup.push(onLangChange(()=>{applyStaticI18n();this.hud.relocalize();this.configureHud();}));
    this.on(window,'keydown',(event)=>{
      const e=event as KeyboardEvent;
      if(e.repeat)return;
      if(e.code==='Escape'||e.code==='KeyP'){e.preventDefault();if(e.code==='Escape'&&this.suppressEscapeResume){this.suppressEscapeResume=false;return;}if(this.state==='playing')this.pause();else if(this.state==='paused')this.resume();}
      if((e.code==='KeyQ'||e.code==='Space')&&this.state==='playing'){e.preventDefault();this.attackQueued=true;}
    });
    this.on(this.canvas,'mousedown',event=>{if((event as MouseEvent).button===2&&this.state==='playing'){event.preventDefault();this.attackQueued=true;}});
    this.on(this.canvas,'contextmenu',event=>event.preventDefault());
    this.on($('#touch-attack'),'pointerdown',event=>{event.preventDefault();this.attackQueued=true;void this.audio.unlock();});
    this.on(this.canvas,'click',()=>{void this.audio.unlock();if(this.state==='playing'&&!this.input.touchMode)this.requestLock();});
    this.on(document,'pointerlockchange',()=>{if(document.pointerLockElement===this.canvas)this.hud.setLockPrompt(false);if(!document.pointerLockElement&&this.state==='playing'&&!this.input.touchMode){this.suppressEscapeResume=true;this.pause();}});
    this.input.modeChanged=()=>{document.body.classList.toggle('touch',this.input.touchMode);if(this.input.touchMode)this.hud.setLockPrompt(false);};
    this.on(document,'visibilitychange',()=>{if(document.hidden)this.pause();});
  }
  private requestLock(): void {
    try{const p=this.canvas.requestPointerLock?.();if(p&&typeof p.catch==='function')void p.catch(()=>this.hud.setLockPrompt(true));}catch{this.hud.setLockPrompt(true);}
  }
  pause(): void {
    if(this.state!=='playing')return;this.supplies.cancelSearch();this.player.rooted=false;this.input.releaseAll();this.audio.stopAll();this.setState('paused');
    if(document.pointerLockElement===this.canvas)document.exitPointerLock();
  }
  private resume(): void {
    if(this.state!=='paused')return;this.suppressEscapeResume=false;this.input.releaseAll();this.setState('playing');if(!this.input.touchMode)this.requestLock();
  }
  private setState(state: State): void {
    this.state=state;document.body.dataset.state=state;
    this.hud.setVisible(state==='playing'||state==='paused');this.hud.showScreen(state==='playing'?null:state==='paused'?'pause':state);
    $('#touch-controls').classList.toggle('active',state==='playing');
    $('#touch-controls').setAttribute('aria-hidden',String(state!=='playing'||!this.input.touchMode));
    document.body.classList.toggle('touch',this.input.touchMode);
    if(state!=='playing'){this.supplies.cancelSearch();this.searching=false;this.player.rooted=false;this.hud.setLockPrompt(false);this.attackQueued=false;}
  }
  private configureHud(): void {
    document.title=label('灰墙情报 · 第二关','Greywall Intelligence · Level II');
    document.body.dataset.lang=getLang();
    this.canvas.setAttribute('aria-label',label('灰墙城第一人称视角','First-person view of Greywall city'));
    $('#satchel').setAttribute('aria-label',label('情报图纸背包','Intel blueprint backpack'));
    $('#screen-pause .muted').textContent=label('石墙外的脚步暂时停下。','Footsteps outside the stone walls fall silent.');
    $('#restart-button').textContent=label('重新行动','Restart expedition');
    $('#again-button').textContent=label('再次行动','Another expedition');
    $('#screen-extracted .result-total small').textContent=label('情报结算','Intel banked');
    if(this.state==='dead')this.renderDefeat();
    if(this.state==='extracted')this.renderSettlement();
    $('.slot[data-tier="0"] small').textContent=label('普通','Common');$('.slot[data-tier="1"] small').textContent=label('稀有','Rare');
    $('.slot[data-tier="2"] small').textContent=label('史诗','Epic');$('.slot[data-tier="3"] small').textContent=label('传说','Legend');
    INTEL_RARITIES.forEach(r=>$(`.slot[data-tier="${r.tier}"]`).style.setProperty('--intel-color',r.color));
    $('#haul small').textContent=label('情报价值','INTEL');
    $('#mute-button').textContent=label('声音','Sound')+(this.audio.muted?' · OFF':' · ON');
    $('#touch-harvest').setAttribute('aria-label',label('搜索物资','Search supplies'));
    $('#touch-attack').setAttribute('aria-label',label('近战反击','Melee strike'));
    $('#city-objective').textContent=label('灰墙城 · 搜集情报图纸\n远端信号城门可撤离 · Q / 空格反击','GREYWALL · Search intel caches\nExtract at the far signal gate · Q / Space to strike');
    $('#city-objective').style.whiteSpace='pre-line';
  }
  update(dt: number,elapsed: number): void {
    this.elapsed=elapsed;this.frame++;
    if(this.state==='playing'&&!this.frozenForCapture){
      this.input.poll();this.attackCooldown=Math.max(0,this.attackCooldown-dt);this.invulnerability=Math.max(0,this.invulnerability-dt);
      this.player.update(dt,elapsed,this.input,this.world.colliders,this.input.consumeLightToggle());
      const attack=this.attackQueued;this.attackQueued=false;
      if(attack&&this.attackCooldown<=0){
        this.supplies.cancelSearch();this.player.rooted=false;this.attackCooldown=CITY_PLAYER_COMBAT.cooldown;this.player.strike();
        const hit=this.monsters.attackFromPlayer(this.player.eye,this.player.forward);
        this.audio.chaserHit();this.hud.flash(hit.hit?'#ffd99a':'#d1d9d9',hit.hit?.17:.06);
        if(hit.killed)this.hud.showBanner(()=>label('威胁已清除','Threat eliminated'),()=>label('继续搜集情报并寻找撤离点','Continue searching and reach extraction'),'info',1.8);
      }
      const chest=this.supplies.update(dt,this.player.eye,this.player.forward,this.world.colliders,this.input.harvest&&!attack,this.attackCooldown<.3);
      const working=chest.target!==null&&this.input.harvest&&!chest.justOpened&&!attack;
      if(working&&!this.searching)this.audio.harvestStart(0);
      else if(!working&&this.searching)this.audio.harvestStop();
      this.searching=working;this.player.rooted=working;
      if(chest.justOpened&&chest.rewardTier!==null){
        const loot=INTEL_RARITIES[chest.rewardTier];this.inventory[loot.tier]++;this.haul+=loot.value;
        this.audio.pickup(loot.tier);this.hud.bumpSlot(loot.tier);
        this.hud.toast(`${getLang()==='zh'?loot.name:loot.en} +${loot.value.toLocaleString()}`,loot.tier);
        const toast=$('#toast-layer').lastElementChild as HTMLElement|null;if(toast)toast.style.color=loot.color;
        this.hud.showBanner(()=>label('发现情报图纸','Intel blueprint found'),()=>`${getLang()==='zh'?loot.name:loot.en} · ${loot.value.toLocaleString()}`,'info',2);
      }
      if(chest.target!==null&&!chest.justOpened)this.hud.setPrompt({text:label(working?'正在搜索物资…':'长按搜索物资',working?'Searching supply cache…':'Hold to search supplies'),value:'',key:this.input.touchMode?label('按住','Hold'):'E'},chest.progress);
      else this.hud.setPrompt(null,0);
      const result=this.monsters.update(dt,elapsed,{playerPosition:this.player.position,playerForward:this.player.forward,moving:this.player.velocity.length()>0.6,sprinting:this.player.sprinting,noise:working||attack,playing:true});
      if(result.damage>0&&this.invulnerability<=0){
        this.player.health=Math.max(0,this.player.health-result.damage);this.invulnerability=CITY_PLAYER_COMBAT.invulnerabilitySeconds;
        this.supplies.cancelSearch();this.player.rooted=false;this.audio.playerHurt();this.hud.flash('#a92316',.3);
        if(this.player.health<=0)this.die();
      }
      const exit=this.world.extraction;
      const inside=Math.hypot(this.player.position.x-exit.position.x,this.player.position.z-exit.position.z)<exit.radius;
      this.extractionProgress=inside?Math.min(1,this.extractionProgress+dt/3.2):0;
      this.hud.setExtract(this.extractionProgress>0?this.extractionProgress:null);
      if(this.extractionProgress>=1&&this.state==='playing')this.extract();
      this.world.update(elapsed,this.player.position);
      this.hud.setVitals(this.player.health/PLAYER.healthMax,this.player.stamina/PLAYER.staminaMax,this.player.battery/PLAYER.batteryMax,this.player.lightOn);
      this.hud.setSatchel(this.inventory,this.haul);
      const living=this.monsters.enemies.filter(e=>e.health>0).sort((a,b)=>a.position.distanceToSquared(this.player.position)-b.position.distanceToSquared(this.player.position));
      const nearest=living[0];
      $('#city-combat-status').textContent=nearest&&nearest.position.distanceTo(this.player.position)<22?
        `${label(CITY_MONSTERS[nearest.kind].name,CITY_MONSTERS[nearest.kind].nameEn)} · ${nearest.health.toFixed(0)} HP · ${label({patrol:'巡逻',chase:'追击',windup:'蓄力',attack:'攻击',search:'搜寻',return:'撤回',dead:'倒下'}[nearest.state],{patrol:'Patrolling',chase:'Pursuing',windup:'Preparing attack',attack:'Attacking',search:'Searching',return:'Returning',dead:'Defeated'}[nearest.state])}`:label('Q / 空格 / 右键：近战反击','Q / Space / right click: melee strike');
    }
    this.hud.tick(dt);this.updateAudio(dt);this.publish();
  }
  private updateAudio(dt: number): void {
    const playing=this.state==='playing'&&!this.frozenForCapture;
    this.audio.setListener(this.camera.position,this.player.forward);
    this.audio.update(dt,{moveSpeed01:playing?Math.min(1,this.player.velocity.length()/PLAYER.sprintSpeed):0,sprinting:this.player.sprinting,danger01:0,hunt:false,health01:this.player.health/100,playing});
    this.audio.updateMonsterSteps(dt,this.monsters.enemies.map((e,i)=>({id:`city-${i}`,kind:e.kind==='ordinary'?'grabber' as const:'howler' as const,position:e.position,active:e.health>0})),playing);
  }
  private die(): void {
    this.player.frozen=true;this.setState('dead');this.audio.death('grabber');this.renderDefeat();
    if(document.pointerLockElement===this.canvas)document.exitPointerLock();
  }
  private renderDefeat(): void {
    $('#dead-title').textContent=label('行动失败','Expedition lost');$('#dead-glyph').textContent='✕';
    $('#dead-reason').textContent=label('巨人的攻击击倒了你。本局未撤离的情报已经遗失。','The giants overwhelmed you. Unextracted intel was lost.');
    $('#dead-lost').textContent=`${label('遗失情报价值','Intel lost')}: ${this.haul.toLocaleString()}`;
  }
  extract(): void {
    if(this.state!=='playing')return;
    this.settlement={levelId:'city',seed:this.seed,counts:[...this.inventory],totalValue:this.haul,extractedAt:new Date().toISOString()};
    try{localStorage.setItem('greywall.last-extraction',JSON.stringify(this.settlement));}catch{/* storage optional */}
    window.dispatchEvent(new CustomEvent<ExtractionSettlement>('game:extraction',{detail:this.settlement}));
    this.setState('extracted');this.audio.extractSuccess();this.renderSettlement();
    if(document.pointerLockElement===this.canvas)document.exitPointerLock();
  }
  private renderSettlement(): void {
    $('#screen-extracted h2').textContent=label('成功撤离灰墙城','Escaped Greywall');
    $('#result-rows').replaceChildren();
    for(const item of INTEL_RARITIES)if(this.inventory[item.tier]){const row=document.createElement('div');row.className='result-row';row.style.color=item.color;row.textContent=`${getLang()==='zh'?item.name:item.en} × ${this.inventory[item.tier]} = ${(item.value*this.inventory[item.tier]).toLocaleString()}`;$('#result-rows').append(row);}
    $('#result-total').textContent=this.haul.toLocaleString();$('#result-best').textContent=label('情报已结算并保存。','Intel settlement saved.');
  }
  private render(): void {
    resizeRenderer(this.renderer,this.camera,1);this.pipeline.resize(this.canvas.clientWidth,this.canvas.clientHeight,Math.min(devicePixelRatio,1));this.pipeline.render(this.elapsed);
  }
  private publish(): void {
    const info=this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__={frame:this.frame,elapsed:this.elapsed,score:this.haul,targetScore:1000,complete:this.state==='extracted',player:{position:{x:this.player.position.x,y:this.player.position.y,z:this.player.position.z},speed:this.player.velocity.length()},renderer:{calls:info.render.calls,triangles:info.render.triangles,geometries:info.memory.geometries,textures:info.memory.textures},canvas:{clientWidth:this.canvas.clientWidth,clientHeight:this.canvas.clientHeight,width:this.canvas.width,height:this.canvas.height,dpr:devicePixelRatio}};
  }
  debugState() { return {levelId:'city',state:this.state,health:this.player.health,haul:this.haul,inventory:[...this.inventory],supplies:this.supplies.debugState(),monsters:this.monsters.debugState(),settlement:this.settlement}; }
  private installHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__={seed:value=>{this.seed=value;},setState:name=>{
      this.frozenForCapture=false;this.reset(this.seed);this.setState('playing');
      if(name==='city-supply'||name==='city-chest-open'){
        const site=this.world.supplySites[0];const p=site.position.clone().add(new THREE.Vector3(Math.sin(site.rotationY)*2.1,0,Math.cos(site.rotationY)*2.1));
        this.player.reset(p,site.rotationY);
        if(name==='city-chest-open'){this.input.setKey('KeyE',true);for(let i=0;i<125;i++)this.update(1/60,i/60);this.input.releaseAll();}
      }else if(name==='city-extracted')this.extract();else if(name==='city-dead')this.die();else if(name==='city-paused')this.pause();
      else if(!['city-active','active-play','playing'].includes(name))throw new Error(`Unknown city state: ${name}`);
      this.player.update(0,this.elapsed,this.input,this.world.colliders,false);if(this.state==='playing')this.update(0,this.elapsed);this.world.update(0,this.player.position);return {state:name};
    },setPausedForScreenshot:paused=>{this.frozenForCapture=paused;},setReducedMotion:()=>{},hideDebugUi:()=>{}};
  }
  dispose(): void {
    this.loop.stop();this.player.dispose();this.input.dispose();for(const fn of this.cleanup)fn();this.audio.dispose();this.pipeline.dispose();this.supplies.dispose();this.monsters.dispose();this.world.dispose();
    this.scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Points)o.geometry.dispose();});
    this.mats.dispose();this.sun.shadow.map?.dispose();this.renderer.dispose();delete window.__THREE_GAME_TEST_HOOKS__;delete window.__THREE_GAME_DIAGNOSTICS__;delete (window as unknown as {__CITY__?:CityGame}).__CITY__;
    for(const slot of document.querySelectorAll<HTMLElement>('.slot'))slot.style.removeProperty('--intel-color');
  }
}
