import * as THREE from 'three';
import { MaterialLibrary, TIER_COLORS } from '../assets/MaterialLibrary';
import { Input } from '../core/Input';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { LOW_SPEC } from '../core/Quality';
import { Caller, Grabber, Howler, type MonsterContext } from '../entities/Monsters';
import { PeachField, TIER_HARVEST_TIME, TIER_VALUE, type Peach } from '../entities/PeachField';
import { Player, PLAYER } from '../entities/Player';
import { TreasureChests } from '../entities/TreasureChests';
import { AudioSystem } from '../systems/AudioSystem';
import { BurstVfx, RenderPipeline } from '../systems/RenderPipeline';
import { Hud } from '../ui/Hud';
import { applyStaticI18n, fmt, getLang, onLangChange, t, toggleLang, type I18nKey } from '../ui/i18n';
import { createSeededRandom } from '../utils/random';
import { Level, pathPoint, type ShrineKind, type ShrineSite } from './Level';
import { zoneAt } from './LevelPath';
import { NIGHT_COLOR, NIGHT_HUNT_COLOR, LANTERN_FOG_DENSITY, nightFogDensity } from './NightVisibility';

type GameState = 'title' | 'playing' | 'paused' | 'dead' | 'extracted';
type DeathCause = 'grabber' | 'caller';

const MAX_DPR = LOW_SPEC ? 0.7 : 1.25;
const HARVEST_REACH = 3.0;
const EXTRACT_TIME = 3.6;
const EXTRACT_RADIUS = 3.1;
const HUNT_DURATION = 45;
const GRABBER_HIT = 50;
/** After a bait shrine fires, it cannot be charged again for this long. */
const BAIT_LOCKOUT = 8;
/** Bait penalty during a hunt: drag the nearest 紫陌 this much closer. */
const BAIT_LURCH = 8;
const BEST_KEY = 'monkeybro.best';
const FOG_NORMAL = new THREE.Color(NIGHT_COLOR);
const FOG_HUNT = new THREE.Color(NIGHT_HUNT_COLOR);
/** Shrine candidate indices by zone pool (Level places 2 per zone: 0,1 | 2,3 | 4,5). */
const POOL_I_II = [0, 1, 2, 3];
const POOL_II_III = [2, 3, 4, 5];
/** Grabber layout: [zone t-range] per grabber. Zone I → 2, II → 3, III → 3 (faster). */
const GRABBER_PLAN: { zone: number; t0: number; t1: number }[] = [
  { zone: 0, t0: 48, t1: 80 },
  { zone: 0, t0: 85, t1: 120 },
  { zone: 1, t0: 132, t1: 165 },
  { zone: 1, t0: 170, t1: 205 },
  { zone: 1, t0: 210, t1: 250 },
  { zone: 2, t0: 262, t1: 300 },
  { zone: 2, t0: 305, t1: 340 },
  { zone: 2, t0: 345, t1: 375 },
];

/** Death screen copy lives in the locale tables (ui/i18n.ts); ZH keeps 紫陌掠命 / 青鸾点名. */
const DEATH_COPY: Record<DeathCause, { glyph: I18nKey; title: I18nKey; reason: I18nKey }> = {
  grabber: { glyph: 'death.grabber.glyph', title: 'death.grabber.title', reason: 'death.grabber.reason' },
  caller: { glyph: 'death.caller.glyph', title: 'death.caller.title', reason: 'death.caller.reason' },
};
const tierName = (tier: number): string => t(`tier.name.${tier}` as I18nKey);

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.08, 120);
  private readonly mats = new MaterialLibrary();
  private readonly level: Level;
  private readonly peachField: PeachField;
  private readonly player: Player;
  private readonly chests: TreasureChests;
  private searchingChest = false;
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly pipeline: RenderPipeline;
  private readonly burst: BurstVfx;
  private readonly input: Input;
  private readonly grabbers: Grabber[] = [];
  private readonly callers: Caller[] = [];
  private readonly howler: Howler;
  private readonly fog = new THREE.FogExp2(NIGHT_COLOR, LANTERN_FOG_DENSITY);
  private readonly loop = new Loop(
    (dt, elapsed) => this.update(dt, elapsed),
    () => this.render(),
  );
  private readonly cleanup: (() => void)[] = [];

  // Route ALL gameplay randomness through this.rng (never Math.random) so the
  // seed() test hook keeps screenshot baselines and bot playtests deterministic.
  private seedValue = 1;
  private rng = createSeededRandom(1);

  private state: GameState = 'title';
  private frame = 0;
  private elapsed = 0;
  private runTime = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;

  // run state
  private readonly satchel = [0, 0, 0, 0];
  private haul = 0;
  private realShrines: number[] = [];
  private baitShrines: number[] = [];
  /** Shrine whose charge `extractProgress` currently belongs to. */
  private chargeSite: ShrineSite | null = null;
  /** 圣地护体: real shrine, progress > 0, player inside its radius. */
  private sanctuary = false;
  private readonly sanctuaryCircle = { x: 0, z: 0, r: EXTRACT_RADIUS };
  private sanctuaryBannerShown = false;
  private readonly baitLock: number[] = [];
  /** Short danger pulse after a bait fires (0..1). */
  private scare = 0;
  private hunt = false;
  private huntTimer = 0;
  private harvestTarget: Peach | null = null;
  private harvestProgress = 0;
  private harvestTime = 0;
  private harvesting = false;
  private extractProgress = 0;
  private damage = 0;
  private deadDelay = 0;
  private bestScore = 0;
  /** Set when pointer-lock loss itself paused the game, so that same Escape does not resume. */
  private suppressEscapeResume = false;
  private lockRequestId = 0;
  /** Last end-of-run screens, kept so a language switch can re-render them. */
  private lastDeath: { cause: DeathCause; lost: number } | null = null;
  private lastResult: { counts: number[]; haul: number; newBest: boolean } | null = null;

  // scratch
  private readonly flat = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly mctx: MonsterContext;
  private readonly spawnTmp = new THREE.Vector3();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas, { antialias: !LOW_SPEC, shadows: !LOW_SPEC });
    // Beyond this plane the dense night fog is already opaque.
    this.camera.far = 45;
    this.renderer.setClearColor(FOG_NORMAL);
    this.scene.background = FOG_NORMAL.clone();
    this.scene.fog = this.fog;
    this.scene.add(this.camera);

    // Moonlit ink night: violet sky fill over pine-smoke ground bounce, a cool key moon
    // (matches the sky-dome moon direction) and a faint warm peach-gold counter rim.
    const hemi = new THREE.HemisphereLight('#68728e', '#101715', 0.11);
    const moon = new THREE.DirectionalLight('#8296b8', 0.17);
    moon.position.set(-0.35, 0.55, -0.75).multiplyScalar(60);
    const rim = new THREE.DirectionalLight('#aa7245', 0.025);
    rim.position.set(20, 12, 30);
    this.scene.add(hemi, moon, rim);

    this.level = new Level(this.mats);
    this.scene.add(this.level.root);
    this.chests = new TreasureChests(this.mats, this.level.chestSites);
    this.scene.add(this.chests.root);
    for (const collider of this.chests.colliders) this.level.colliders.add(collider);
    this.peachField = new PeachField(this.mats);
    this.scene.add(this.peachField.root);
    this.player = new Player(this.camera, this.scene);
    this.burst = new BurstVfx(this.mats.sparkle);
    this.scene.add(this.burst.points);

    this.howler = new Howler(this.mats);
    this.scene.add(this.howler.root);
    for (let z = 0; z < 3; z++) {
      const c = new Caller(this.mats, z);
      this.callers.push(c);
      this.scene.add(c.root);
    }
    for (const plan of GRABBER_PLAN) {
      const g = new Grabber(this.mats, pathPoint((plan.t0 + plan.t1) / 2, 0), this.grabbers.length);
      this.grabbers.push(g);
      this.scene.add(g.root);
    }

    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera);
    this.input = new Input(canvas, this.el('#touch-stick'), this.el('#touch-knob'), {
      light: this.el('#touch-light'),
      harvest: this.el('#touch-harvest'),
      sprint: this.el('#touch-sprint'),
      look: this.el('#touch-look'),
    });
    this.input.modeChanged = () => this.onInputModeChanged();

    this.mctx = {
      playerPos: this.player.position,
      eye: this.player.eye,
      forward: this.player.forward,
      lightOn: true,
      sprinting: false,
      moving: false,
      harvesting: false,
      hunt: false,
      sanctuary: null,
      colliders: this.level.colliders,
      audio: this.audio,
      rng: () => this.rng(),
    };

    try {
      this.bestScore = Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      this.bestScore = 0;
    }

    this.bindUi();
    applyStaticI18n();
    this.hud.relocalize();
    this.cleanup.push(onLangChange(() => this.relocalize()));
    this.prepareRun(1);
    this.setState('title');
    this.updateBestLine();
    this.fitRenderer();
    this.installTestHooks();
    if (import.meta.env.DEV) (window as unknown as { __MONKEYBRO__?: Game }).__MONKEYBRO__ = this;
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    for (const c of this.cleanup) c();
    this.input.dispose();
    this.audio.dispose();
    this.pipeline.dispose();
    this.player.dispose();
    this.scene.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    this.peachField.dispose();
    this.chests.dispose();
    this.level.dispose();
    this.mats.dispose();
    this.renderer.dispose();
    delete (window as unknown as { __MONKEYBRO__?: Game }).__MONKEYBRO__;
    delete window.__THREE_GAME_TEST_HOOKS__;
    delete window.__THREE_GAME_DIAGNOSTICS__;
  }

  // ------------------------------------------------------------------ UI

  private el<T extends HTMLElement = HTMLElement>(sel: string): T {
    const e = document.querySelector<T>(sel);
    if (!e) throw new Error(`Missing element ${sel}`);
    return e;
  }

  private on<K extends keyof HTMLElementEventMap>(sel: string, type: K, fn: () => void): void {
    const e = this.el(sel);
    const handler = () => fn();
    e.addEventListener(type, handler);
    this.cleanup.push(() => e.removeEventListener(type, handler));
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.cleanup.push(() => target.removeEventListener(type, fn));
  }

  private bindUi(): void {
    this.on('#start-button', 'click', () => {
      void this.audio.unlock();
      this.audio.uiClick();
      this.startRun();
    });
    this.on('#resume-button', 'click', () => {
      this.audio.uiClick();
      this.resume();
    });
    this.on('#mute-button', 'click', () => {
      this.audio.setMuted(!this.audio.muted);
      this.updateMuteLabel();
      this.audio.uiClick();
    });
    for (const id of ['#lang-button', '#title-lang-button']) {
      this.on(id, 'click', () => {
        toggleLang();
        this.audio.uiClick();
      });
    }
    for (const id of ['#restart-button', '#retry-button', '#again-button']) {
      this.on(id, 'click', () => {
        void this.audio.unlock();
        this.audio.uiClick();
        this.startRun();
      });
    }
    this.on('#touch-pause', 'click', () => this.pause());

    this.listen(document, 'pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) {
        this.hud.setLockPrompt(false);
        return;
      }
      // Lock loss while playing pauses. State is set before releaseLock(), so a
      // pause that we initiated does not land here and cannot swallow the next Esc.
      if (this.state === 'playing' && !this.input.touchMode) {
        this.pause();
        this.suppressEscapeResume = true;
        window.setTimeout(() => {
          this.suppressEscapeResume = false;
        }, 500);
      }
      this.hud.setLockPrompt(false);
    });
    this.listen(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      if (ev.code !== 'Escape' && ev.code !== 'KeyP') return;
      if (this.state === 'paused' && ev.code === 'Escape' && this.suppressEscapeResume) {
        this.suppressEscapeResume = false;
        return;
      }
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    });
    this.listen(this.canvas, 'click', () => {
      if (this.state === 'playing' && !this.input.touchMode && document.pointerLockElement !== this.canvas) this.requestLock();
    });
    this.listen(window, 'blur', () => {
      if (this.state === 'playing') this.pause();
    });
    this.listen(window, 'resize', () => this.fitRenderer());
  }

  private needsMouseLock(): boolean {
    return this.state === 'playing' && !this.input.touchMode && document.pointerLockElement !== this.canvas;
  }

  private requestLock(): void {
    if (this.input.touchMode) {
      this.hud.setLockPrompt(false);
      return;
    }
    const id = ++this.lockRequestId;
    let settled = false;
    const showIfNeeded = () => {
      if (settled || id !== this.lockRequestId) return;
      settled = true;
      this.hud.setLockPrompt(this.needsMouseLock());
    };
    try {
      // Do NOT use unadjustedMovement: on high-DPI Windows mice it makes look spin wildly.
      const pending = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (pending && typeof pending.then === 'function') {
        void pending.then(
          () => {
            settled = true;
            this.hud.setLockPrompt(false);
          },
          () => showIfNeeded(),
        );
      }
    } catch {
      showIfNeeded();
    }
    window.setTimeout(() => {
      if (id !== this.lockRequestId || settled) return;
      if (document.pointerLockElement === this.canvas) {
        this.hud.setLockPrompt(false);
        return;
      }
      if (this.needsMouseLock()) this.hud.setLockPrompt(true);
    }, 400);
  }

  private releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private updateBestLine(): void {
    this.el('#best-line').textContent = this.bestScore > 0 ? t('title.best', { n: this.bestScore }) : '';
  }

  private updateMuteLabel(): void {
    this.el('#mute-button').textContent = t(this.audio.muted ? 'pause.soundOff' : 'pause.soundOn');
  }

  /** Language switched (title / pause button): re-render everything set from code. */
  private relocalize(): void {
    this.hud.relocalize();
    this.updateMuteLabel();
    this.updateBestLine();
    this.renderDeath();
    this.renderResult();
    document.body.dataset.lang = getLang();
  }

  // --------------------------------------------------------------- states

  private setState(s: GameState): void {
    if (s !== 'playing') {
      this.chests?.cancelSearch();
      this.searchingChest = false;
      this.player.rooted = false;
    }
    this.state = s;
    document.body.dataset.state = s;
    this.hud.setVisible(s === 'playing' || s === 'paused');
    const touchEl = this.el('#touch-controls');
    const showTouch = s === 'playing';
    touchEl.classList.toggle('active', showTouch);
    touchEl.setAttribute('aria-hidden', showTouch && (this.input?.touchMode ?? false) ? 'false' : 'true');
    document.body.classList.toggle('touch', this.input?.touchMode ?? false);
    if (s !== 'playing' || this.input?.touchMode) this.hud.setLockPrompt(false);
    this.hud.showScreen(s === 'title' ? 'title' : s === 'paused' ? 'pause' : s === 'dead' ? (this.deadDelay <= 0 ? 'dead' : null) : s === 'extracted' ? 'extracted' : null);
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.audio.harvestStop();
    this.endHarvest();
    // Mark paused before releasing the lock so the lock-loss handler does not
    // treat this Escape as a fresh pause and then resume on the same keydown.
    this.setState('paused');
    this.releaseLock();
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    // The Escape that dropped pointer lock must not swallow a later press
    // after the player has already resumed with P.
    this.suppressEscapeResume = false;
    this.setState('playing');
    if (!this.input.touchMode) this.requestLock();
  }

  /** Keep the touch chrome and the pointer-lock path in step with Input. */
  private onInputModeChanged(): void {
    const touch = this.input.touchMode;
    document.body.classList.toggle('touch', touch);
    const playing = this.state === 'playing';
    this.el('#touch-controls').setAttribute('aria-hidden', playing && touch ? 'false' : 'true');
    if (touch) {
      this.hud.setLockPrompt(false);
      return;
    }
    if (playing) this.requestLock();
  }

  private harvestHint(): () => string {
    const touch = this.input.touchMode;
    return () => t(touch ? 'hint.harvest.touch' : 'hint.harvest.mouse');
  }

  /** Reset the world for a fresh night. Does not change the visible state. */
  private prepareRun(seed: number): void {
    this.seedValue = seed;
    this.rng = createSeededRandom(seed);
    const rng = this.rng;

    const gate = pathPoint(8, 0);
    this.player.reset(gate, 0);
    this.player.yaw = this.pathHeading(8);
    this.player.syncCamera(0);

    this.peachField.reset(this.level.peachSpots, rng);
    this.chests.reset(seed);
    this.searchingChest = false;

    const a = POOL_I_II[Math.floor(rng() * POOL_I_II.length)];
    let b = POOL_II_III[Math.floor(rng() * POOL_II_III.length)];
    if (b === a) b = POOL_II_III[(POOL_II_III.indexOf(b) + 1) % POOL_II_III.length];
    this.realShrines = [a, b];

    this.grabbers.forEach((g, i) => {
      const plan = GRABBER_PLAN[i];
      const t = plan.t0 + rng() * (plan.t1 - plan.t0);
      g.respawn(pathPoint(t, (rng() - 0.5) * 12, this.spawnTmp));
    });

    // Baits are drawn after the grabber spawns so the existing RNG sequence (and baselines) is unchanged.
    this.baitShrines = this.pickBaits(this.realShrines, rng);
    this.level.setShrineKinds(this.realShrines, this.baitShrines);
    this.baitLock.length = 0;
    for (let i = 0; i < this.level.shrines.length; i++) this.baitLock.push(0);
    this.chargeSite = null;
    this.sanctuary = false;
    this.sanctuaryBannerShown = false;
    this.scare = 0;
    for (const c of this.callers) c.reset();
    this.howler.reset();
    this.burst.clear();

    this.satchel.fill(0);
    this.haul = 0;
    this.hunt = false;
    this.huntTimer = 0;
    this.harvestTarget = null;
    this.harvestProgress = 0;
    this.harvesting = false;
    this.extractProgress = 0;
    this.damage = 0;
    this.deadDelay = 0;
    this.runTime = 0;
    this.fog.color.copy(FOG_NORMAL);
    this.fog.density = LANTERN_FOG_DENSITY;
    (this.scene.background as THREE.Color).copy(FOG_NORMAL);
    this.hud.clearTransient();
    this.hud.setSatchel(this.satchel, 0, true);
    this.input.consumeLook();
    this.input.consumeLightToggle();
    this.huntVis = 0;
    this.darkAmt = 0;
    this.danger = 0;
    const u = this.pipeline.grade.uniforms;
    u.uRed.value = u.uDark.value = u.uDesat.value = u.uHunt.value = 0;
    this.audio.harvestStop();
    this.audio.extractCharge(0);
  }

  /** Two baits from the non-real candidates, preferring different zones. */
  private pickBaits(reals: number[], rng: () => number): number[] {
    const rest = this.level.shrines.map((s) => s.index).filter((i) => !reals.includes(i));
    const first = rest.splice(Math.floor(rng() * rest.length), 1)[0];
    const zone = this.level.shrines[first].zone;
    const otherZone = rest.filter((i) => this.level.shrines[i].zone !== zone);
    const pool = otherZone.length > 0 ? otherZone : rest;
    const second = pool[Math.floor(rng() * pool.length)];
    return second === undefined ? [first] : [first, second];
  }

  /** Lit shrine the player stands in; real wins if radii ever overlap. */
  private shrineUnderPlayer(): ShrineSite | null {
    const p = this.player.position;
    let found: ShrineSite | null = null;
    for (const s of this.level.shrines) {
      if (!s.active) continue;
      if (Math.hypot(s.position.x - p.x, s.position.z - p.z) >= EXTRACT_RADIUS) continue;
      if (s.kind === 'real') return s;
      found ??= s;
    }
    return found;
  }

  private pathHeading(t: number): number {
    const p0 = pathPoint(t, 0);
    const p1 = pathPoint(t + 4, 0);
    // forward is (-sin yaw, -cos yaw)
    return Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z));
  }

  startRun(seed?: number): void {
    const s = seed ?? (Math.floor(Math.random() * 0x7fffffff) | 0) + 1;
    this.prepareRun(s);
    this.hud.showScreen(null);
    this.setState('playing');
    this.hud.setVisible(true);
    this.hud.setVitals(1, 1, 1, true);
    this.hud.showHint(this.harvestHint(), 9);
    this.hud.showBanner(() => t('banner.start.title'), () => t('banner.start.sub'), 'info', 4);
    if (!this.input.touchMode) this.requestLock();
  }

  private die(cause: DeathCause): void {
    if (this.state !== 'playing') return;
    this.player.frozen = true;
    this.player.rooted = true;
    this.sanctuary = false;
    this.endHarvest();
    this.audio.death(cause);
    this.audio.extractCharge(0);
    this.releaseLock();
    this.damage = 1;
    this.hud.flash(cause === 'caller' ? '#e9f3ff' : '#8a0610', 0.9);
    if (cause === 'caller') {
      const c = this.callers.find((k) => k.state === 'calling') ?? this.callers[0];
      c.lunge(this.player.eye, this.player.forward);
    }
    this.lastDeath = { cause, lost: this.haul };
    this.renderDeath();
    this.deadDelay = cause === 'caller' ? 1.1 : 1.5;
    this.setState('dead');
  }

  private extract(): void {
    if (this.state !== 'playing') return;
    const newBest = this.haul > this.bestScore;
    if (newBest) {
      this.bestScore = this.haul;
      try {
        localStorage.setItem(BEST_KEY, String(this.bestScore));
      } catch {
        /* storage unavailable */
      }
    }
    this.audio.extractSuccess();
    this.audio.harvestStop();
    this.releaseLock();
    this.lastResult = { counts: [...this.satchel], haul: this.haul, newBest };
    this.renderResult();
    this.updateBestLine();
    this.hud.clearTransient();
    this.player.frozen = true;
    this.setState('extracted');
  }

  private renderDeath(): void {
    const d = this.lastDeath;
    if (!d) return;
    const copy = DEATH_COPY[d.cause];
    this.el('#dead-glyph').textContent = t(copy.glyph);
    this.el('#dead-title').textContent = t(copy.title);
    this.el('#dead-reason').textContent = t(copy.reason);
    this.el('#dead-lost').textContent = d.lost > 0 ? t('dead.lost', { n: d.lost }) : t('dead.empty');
  }

  private renderResult(): void {
    const r = this.lastResult;
    if (!r) return;
    const rows = this.el('#result-rows');
    rows.replaceChildren();
    for (let tier = 0; tier < 4; tier++) {
      if (r.counts[tier] === 0) continue;
      const row = document.createElement('div');
      row.className = 'result-row';
      row.style.color = TIER_COLORS[tier];
      row.textContent = t('won.row', { tier: tierName(tier), count: r.counts[tier], value: r.counts[tier] * TIER_VALUE[tier] });
      rows.appendChild(row);
    }
    if (r.haul === 0) rows.textContent = t('won.empty');
    this.el('#result-total').textContent = fmt(r.haul);
    this.el('#result-best').textContent = r.newBest ? t('won.newBest') : t('won.best', { n: this.bestScore });
  }

  // ----------------------------------------------------------------- loop

  private update(dt: number, elapsed: number): void {
    this.elapsed = elapsed;
    this.frame++;
    if (!this.pausedForScreenshot) {
      switch (this.state) {
        case 'playing':
          this.updatePlaying(dt, elapsed);
          break;
        case 'title':
          this.updateTitle(elapsed);
          break;
        case 'dead':
          this.updateDead(dt, elapsed);
          break;
        case 'extracted':
        case 'paused':
          break;
      }
      this.level.update(elapsed, this.camera.position, this.hunt ? 1 : 0, this.sanctuary ? 0.3 + 0.7 * this.extractProgress : 0);
      this.peachField.update(dt, this.reducedMotion ? 0 : elapsed);
      this.burst.update(dt);
    }
    this.hud.tick(dt);
    this.updateAudio(dt);
    this.publishDiagnostics();
  }

  private updateTitle(elapsed: number): void {
    // slow idle look around the moonlit gate
    const base = this.pathHeading(8);
    this.player.yaw = base + (this.reducedMotion ? 0 : Math.sin(elapsed * 0.18) * 0.35);
    this.player.pitch = -0.04;
    this.player.syncCamera(this.reducedMotion ? 0 : elapsed);
  }

  private updateDead(dt: number, elapsed: number): void {
    this.player.syncCamera(elapsed);
    this.damage = Math.max(0.5, this.damage - dt * 0.2);
    if (this.deadDelay > 0) {
      this.deadDelay -= dt;
      if (this.deadDelay <= 0) this.hud.showScreen('dead');
    }
    // monsters keep moving a little so the freeze-frame feels alive
    this.fillContext(false);
    for (const g of this.grabbers) g.animate(dt, elapsed, this.mctx);
  }

  private fillContext(harvesting: boolean): void {
    const c = this.mctx;
    c.lightOn = this.player.lightOn;
    c.sprinting = this.player.sprinting;
    c.moving = Math.hypot(this.player.velocity.x, this.player.velocity.z) > 0.6;
    c.harvesting = harvesting;
    c.hunt = this.hunt;
    c.sanctuary = this.sanctuary ? this.sanctuaryCircle : null;
  }

  private updatePlaying(dt: number, elapsed: number): void {
    const p = this.player;
    this.runTime += dt;

    this.input.poll();
    const lightToggle = this.input.consumeLightToggle();
    document.body.classList.toggle('touch', this.input.touchMode);

    // ---- harvest targeting (uses last frame's camera orientation; look is applied in update)
    const toggled = p.update(dt, elapsed, this.input, this.level.colliders, lightToggle);
    if (toggled) this.audio.flashlight(p.lightOn);

    // ---- Shrine charge (real and bait share radius/time; only real grants 圣地护体)
    this.updateShrineCharge(dt);

    // The shared hold action searches a nearby chest before targeting loose peaches.
    const wasWorking = this.harvesting || this.searchingChest;
    const canSearch = !this.sanctuary && !p.frozen;
    const wantsHarvest = this.input.harvest && !p.sprinting && canSearch;
    const chest = this.chests.update(dt, p.eye, p.forward, this.level.colliders, wantsHarvest, canSearch);
    this.searchingChest = chest.target !== null && wantsHarvest && !chest.justOpened;
    const target = chest.target === null ? this.peachField.findTarget(p.eye, p.forward, HARVEST_REACH, this.level.colliders) : null;
    if (wantsHarvest && target) {
      if (this.harvestTarget !== target) {
        this.harvestTarget = target;
        this.harvestProgress = 0;
        this.harvestTime = TIER_HARVEST_TIME[target.tier];
      }
      this.harvesting = true;
      p.rooted = true;
      this.harvestProgress += dt / this.harvestTime;
      if (this.harvestProgress >= 1) this.completeHarvest(target);
    } else {
      this.harvesting = false;
      p.rooted = this.searchingChest;
      this.harvestProgress = Math.max(0, this.harvestProgress - dt * 2.5);
      if (this.harvestProgress === 0) this.harvestTarget = null;
    }

    if (chest.justOpened && chest.rewardTier !== null && chest.target !== null) {
      this.hud.showBanner(() => t('chest.opened'), () => t('chest.loot', { tier: tierName(chest.rewardTier!) }), 'info', 2.5);
      this.awardLoot(chest.rewardTier, this.chests.chests[chest.target].position);
    }
    const working = this.harvesting || this.searchingChest;
    if (working && !wasWorking) this.audio.harvestStart(target?.tier ?? 0);
    else if (!working && wasWorking) this.audio.harvestStop();

    this.fillContext(working);
    const ctx = this.mctx;

    // ---- Callers
    const zone = zoneAt(-p.position.z);
    this.syncFlat();
    for (const c of this.callers) {
      if (working && c.zone === zone && this.runTime > 12 && this.callers.every((k) => k.state !== 'calling') && c.canCall()) {
        c.beginCall(ctx, this.flat);
      }
      const ev = c.update(dt, elapsed, ctx, this.hunt);
      if (ev === 'voice') {
        // The call is always the Chinese 「猴哥——」, never romanised.
        this.hud.showSubtitle('猴哥——', 2.2);
        this.hud.showBanner(() => t('banner.caller.title'), () => t('banner.caller.sub'), 'caller', 2.6);
      }
      // 圣地护体: her call still plays outside the circle, but looking is safe inside it.
      if (c.armed && !this.sanctuary && this.state === 'playing' && this.isLookingAt(c)) {
        this.die('caller');
        return;
      }
    }

    // ---- Grabbers
    let danger = 0;
    let grabbedThisFrame = false;
    for (const g of this.grabbers) {
      const bonus = g.zone === 2 ? 0.8 : 0;
      const caught = g.update(dt, ctx, bonus, this.grabbers);
      g.animate(dt, elapsed, ctx);
      if (g.state === 'chase') {
        const d = Math.hypot(g.position.x - p.position.x, g.position.z - p.position.z);
        danger = Math.max(danger, 1 - THREE.MathUtils.clamp(d / 28, 0, 1));
      }
      // One source of grab damage per frame. Overlapping grabbers still retreat,
      // but a stack cannot spend GRABBER_HIT twice before the player can react.
      if (caught && !grabbedThisFrame) {
        grabbedThisFrame = true;
        this.onGrabbed(g);
        if (this.state !== 'playing') return;
      }
    }
    if (this.input.touchMode) this.hud.setLockPrompt(false);
    this.scare = Math.max(0, this.scare - dt * 0.9);
    this.danger = Math.max(danger, this.scare);

    // ---- Howler / hunt
    if (this.howler.update(dt, elapsed, ctx)) this.audio.summonerHowl(this.howler.root.position);
    if (this.hunt) {
      this.huntTimer -= dt;
      if (this.huntTimer <= 0) {
        this.hunt = false;
        this.howler.dismiss();
        this.hud.setHunt(null);
        this.hud.showBanner(() => t('banner.howlerLeave.title'), () => t('banner.howlerLeave.sub'), 'info', 2.5);
      } else this.hud.setHunt(this.huntTimer / HUNT_DURATION);
    }
    const huntTarget = this.hunt ? 1 : 0;
    this.huntVis += (huntTarget - this.huntVis) * Math.min(1, dt * 2);
    this.fog.color.copy(FOG_NORMAL).lerp(FOG_HUNT, this.huntVis);
    this.fog.density += (nightFogDensity(p.lightOn, this.huntVis) - this.fog.density) * Math.min(1, dt * 6);
    (this.scene.background as THREE.Color).copy(this.fog.color);

    // ---- Extraction
    this.audio.extractCharge(this.extractProgress);
    this.hud.setExtract(this.extractProgress > 0.001 ? this.extractProgress : null);
    if (this.extractProgress >= 1 && this.chargeSite) {
      if (this.chargeSite.kind === 'real') {
        this.extract();
        return;
      }
      this.springBait(this.chargeSite);
    }

    // ---- Damage feel
    this.damage = Math.max(0, this.damage - dt * 0.9);
    const low = p.health <= PLAYER.healthMax * 0.5;

    // ---- HUD
    this.hud.setVitals(p.health / PLAYER.healthMax, p.stamina / PLAYER.staminaMax, p.battery / PLAYER.batteryMax, p.lightOn);
    this.hud.setSatchel(this.satchel, this.haul);
    if (chest.target !== null && !chest.justOpened) {
      this.hud.setPrompt({ text: t(this.searchingChest ? 'chest.searching' : 'chest.hold'), value: '', key: this.input.touchMode ? t('prompt.keyTouch') : 'E' }, chest.progress);
    } else if (this.harvesting && target) {
      this.hud.setPrompt(null, 0);
      this.hud.setPrompt({ text: t('prompt.picking', { tier: tierName(target.tier) }), value: `+${fmt(TIER_VALUE[target.tier])}`, key: this.input.touchMode ? t('prompt.keyTouch') : 'E' }, this.harvestProgress);
    } else if (target) {
      this.hud.setPrompt({ text: t('prompt.hold', { tier: tierName(target.tier) }), value: `+${fmt(TIER_VALUE[target.tier])}`, key: this.input.touchMode ? t('prompt.keyTouch') : 'E' }, 0);
    } else {
      this.hud.setPrompt(null, 0);
    }
    if (low && Math.floor(elapsed * 2) % 6 === 0) this.damage = Math.max(this.damage, 0.12);

    // ---- Pipeline grade
    const calling = this.callers.some((c) => c.state === 'calling');
    this.darkAmt += ((calling ? 1 : 0) - this.darkAmt) * Math.min(1, dt * 3);
    const u = this.pipeline.grade.uniforms;
    u.uRed.value = Math.max(this.damage, low ? 0.12 : 0);
    u.uDark.value = this.darkAmt;
    u.uDesat.value = low ? 0.35 : 0;
    u.uHunt.value = this.huntVis * (0.6 + 0.4 * Math.sin(elapsed * 4));
  }

  private updateShrineCharge(dt: number): void {
    for (let i = 0; i < this.baitLock.length; i++) this.baitLock[i] = Math.max(0, this.baitLock[i] - dt);
    const site = this.shrineUnderPlayer();
    if (site && site !== this.chargeSite) {
      // progress never carries between shrines
      this.extractProgress = 0;
      this.chargeSite = site;
    }
    const locked = site !== null && site.kind === 'bait' && this.baitLock[site.index] > 0;
    if (site && !locked && !this.harvesting) this.extractProgress = Math.min(1, this.extractProgress + dt / EXTRACT_TIME);
    else this.extractProgress = Math.max(0, this.extractProgress - dt * 0.8);

    const wasSanctuary = this.sanctuary;
    this.sanctuary = site !== null && site.kind === 'real' && this.extractProgress > 0;
    if (this.sanctuary && site) {
      this.sanctuaryCircle.x = site.position.x;
      this.sanctuaryCircle.z = site.position.z;
      if (!wasSanctuary && !this.sanctuaryBannerShown) {
        this.sanctuaryBannerShown = true;
        this.hud.showBanner(() => t('banner.sanctuary.title'), () => t('banner.sanctuary.sub'), 'info', 1.5);
      }
    }
  }

  /** A bait shrine charged full: no escape, a jolt, and the orchard closes in. */
  private springBait(site: ShrineSite): void {
    this.extractProgress = 0;
    this.baitLock[site.index] = BAIT_LOCKOUT;
    this.audio.extractCharge(0);
    this.hud.setExtract(null);
    this.hud.showBanner(() => t('banner.bait.title'), () => t('banner.bait.sub'), 'howl', 2.5);
    this.hud.flash('#7a1a0c', 0.55);
    this.player.addShake(0.6);
    this.damage = Math.max(this.damage, 0.5);
    this.scare = 1;
    // Never starts a hunt on its own; during one, the nearest 紫陌 lunges closer.
    if (!this.hunt) return;
    const p = this.player.position;
    let nearest: Grabber | null = null;
    let best = Infinity;
    for (const g of this.grabbers) {
      const d = Math.hypot(g.position.x - p.x, g.position.z - p.z);
      if (d < best) {
        best = d;
        nearest = g;
      }
    }
    if (nearest) {
      nearest.lurch(p, BAIT_LURCH, this.level.colliders);
      this.audio.zimoVoice(nearest.position, 'attack');
    }
  }

  private danger = 0;
  private huntVis = 0;
  private darkAmt = 0;

  private syncFlat(): void {
    this.player.flatForward(this.flat);
  }

  private isLookingAt(c: Caller): boolean {
    const p = this.player;
    if (this.level.colliders.blocksWallSegment(p.eye.x, p.eye.z, c.position.x, c.position.z)) return false;
    this.tmp.set(c.position.x - p.eye.x, 0, c.position.z - p.eye.z);
    const d = this.tmp.length();
    if (d < 0.01) return true;
    this.tmp.divideScalar(d);
    // horizontal alignment with the view direction (ignores pitch so looking up/down at her still counts)
    this.flat.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    return this.tmp.dot(this.flat) > Math.cos(THREE.MathUtils.degToRad(38));
  }

  private endHarvest(): void {
    this.chests.cancelSearch();
    this.searchingChest = false;
    this.harvesting = false;
    this.harvestTarget = null;
    this.harvestProgress = 0;
    this.player.rooted = false;
  }

  private completeHarvest(peach: Peach): void {
    this.peachField.collect(peach);
    this.awardLoot(peach.tier, peach.position);
  }

  private awardLoot(tier: Peach['tier'], position: THREE.Vector3): void {
    this.audio.harvestStop();
    this.audio.pickup(tier);
    this.satchel[tier]++;
    this.haul += TIER_VALUE[tier];
    this.hud.bumpSlot(tier);
    this.hud.toast(`${tierName(tier)}  +${fmt(TIER_VALUE[tier])}`, tier);
    this.burst.emit(position, new THREE.Color(TIER_COLORS[tier]), 14 + tier * 10, 1.4, this.rng);
    this.endHarvest();

    if (tier >= 2) {
      // Ancient peach: the Howler wakes and the whole orchard hunts.
      const fresh = !this.hunt;
      this.hunt = true;
      this.huntTimer = HUNT_DURATION;
      if (this.howler.state === 'dormant' || this.howler.state === 'leaving') {
        this.fillContext(false);
        this.howler.appear(this.mctx);
      }
      if (fresh) {
        this.hud.showBanner(() => t('banner.hunt.title'), () => t('banner.hunt.sub'), 'howl', 4);
        this.hud.flash('#ffcf4a', 0.5);
      }
    }
  }

  private onGrabbed(g: Grabber): void {
    const p = this.player;
    p.health = Math.max(0, p.health - GRABBER_HIT);
    p.knockback(g.position, 7);
    p.addShake(0.9);
    this.damage = 1;
    this.endHarvest();
    this.audio.harvestStop();
    this.audio.chaserHit();
    this.audio.zimoVoice(g.position, 'attack');
    this.audio.playerHurt();
    this.hud.flash('#a00a14', 0.7);
    const grabSub: I18nKey = p.health > 0 ? 'banner.grab.half' : 'banner.grab.dead';
    this.hud.showBanner(() => t('banner.grab.title'), () => t(grabSub), 'danger', 2.2);
    if (p.health <= 0) this.die('grabber');
  }

  private updateAudio(dt: number): void {
    const p = this.player;
    const speed01 = Math.min(1, Math.hypot(p.velocity.x, p.velocity.z) / PLAYER.sprintSpeed);
    this.audio.setListener(this.camera.position, p.forward);
    this.audio.update(dt, {
      moveSpeed01: this.state === 'playing' ? speed01 : 0,
      sprinting: this.state === 'playing' && p.sprinting,
      danger01: this.state === 'playing' ? this.danger : 0,
      hunt: this.hunt && this.state === 'playing',
      health01: p.health / PLAYER.healthMax,
      playing: this.state === 'playing',
    });
    this.audio.updateMonsterSteps(dt, [
      ...this.grabbers.map((g, i) => ({ id: `grabber-${i}`, kind: 'grabber' as const, position: g.position, active: g.root.visible })),
      ...this.callers.map((c, i) => ({ id: `caller-${i}`, kind: 'caller' as const, position: c.position, active: c.root.visible && c.state !== 'dormant' })),
      { id: 'howler', kind: 'howler', position: this.howler.root.position, active: this.howler.state === 'watching' },
    ], this.state === 'playing');
  }

  private fitRenderer(): void {
    resizeRenderer(this.renderer, this.camera, MAX_DPR);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.pipeline.resize(Math.max(1, this.canvas.clientWidth), Math.max(1, this.canvas.clientHeight), dpr);
  }

  private render(): void {
    this.fitRenderer();
    this.pipeline.render(this.elapsed);
  }

  // ---------------------------------------------------- tests/diagnostics

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.haul,
      targetScore: 10000,
      complete: this.state === 'extracted',
      player: {
        position: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
        speed: Math.hypot(this.player.velocity.x, this.player.velocity.z),
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: window.devicePixelRatio || 1,
      },
    };
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value) => {
        this.seedValue = value;
        this.rng = createSeededRandom(value);
      },
      setState: (name) => {
        switch (name) {
          case 'title':
            this.prepareRun(this.seedValue);
            this.setState('title');
            break;
          case 'active-play':
          case 'playing':
            this.startRunNoLock(this.seedValue);
            break;
          case 'orchard': {
            this.startRunNoLock(this.seedValue);
            this.player.reset(pathPoint(52, 0), this.pathHeading(52));
            this.input.releaseAll();
            this.updatePlaying(1 / 60, 0);
            this.player.flashlight.intensity = 62;
            this.level.update(0, this.camera.position, 0);
            break;
          }
          case 'courtyard-2':
          case 'courtyard-3':
          case 'courtyard':
          case 'unlit':
          case 'chest-ready':
          case 'chest-open': {
            this.startRunNoLock(this.seedValue);
            const hallIndex = name === 'courtyard-2' ? 1 : name === 'courtyard-3' ? 2 : 0;
            const hall = this.level.interiors[hallIndex];
            if (!hall) throw new Error('No courtyard available');
            const offset = name.startsWith('chest-') ? this.level.chestSites[0].position.clone().sub(hall.center).applyAxisAngle(new THREE.Vector3(0, 1, 0), -hall.rotationY).add(new THREE.Vector3(0, 0, 2.1)) : new THREE.Vector3(0, 0, 9.5);
            offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), hall.rotationY).add(hall.center);
            this.player.reset(offset, hall.rotationY);
            if (name === 'unlit') this.player.lightOn = false;
            this.input.releaseAll();
            this.input.setKey('KeyE', name === 'chest-open');
            for (let i = 0; i < (name === 'chest-open' ? 125 : 1); i++) this.updatePlaying(1 / 60, i / 60);
            this.input.releaseAll();
            this.fog.density = nightFogDensity(this.player.lightOn, this.huntVis);
            this.player.flashlight.intensity = this.player.lightOn ? 62 : 0;
            this.level.update(0, this.camera.position, this.hunt ? 1 : 0);
            break;
          }
          case 'paused':
            if (this.state !== 'playing') this.startRunNoLock(this.seedValue);
            this.pause();
            break;
          case 'dead':
            if (this.state !== 'playing') this.startRunNoLock(this.seedValue);
            this.deadDelay = 0;
            this.die('grabber');
            this.deadDelay = 0;
            this.hud.showScreen('dead');
            break;
          case 'extracted':
            if (this.state !== 'playing') this.startRunNoLock(this.seedValue);
            this.extract();
            break;
          default:
            throw new Error(`Unknown state: ${name}`);
        }
        return { state: name };
      },
      setPausedForScreenshot: (paused) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: () => undefined,
    };
  }

  // ---------------------------------------------------- DEV / QA hooks (window.__MONKEYBRO__)

  /** QA: every candidate with its kind for this run. */
  listShrines(): { index: number; kind: ShrineKind }[] {
    return this.level.shrines.map((s) => ({ index: s.index, kind: s.kind }));
  }

  /**
   * QA: put the player on a shrine (default: first real) and start charging so
   * 圣地护体 is live this frame. Pass a bait index to test the lure instead.
   */
  forceSanctuary(index?: number): { index: number; kind: ShrineKind } | null {
    if (this.state !== 'playing') this.startRunNoLock(this.seedValue);
    const site = index === undefined ? this.level.shrines.find((s) => s.kind === 'real') : this.level.shrines[index];
    if (!site || !site.active) return null;
    this.endHarvest();
    this.player.position.set(site.position.x, this.player.position.y, site.position.z);
    this.player.velocity.set(0, 0, 0);
    this.chargeSite = site;
    this.extractProgress = 0.001;
    this.updateShrineCharge(0);
    return { index: site.index, kind: site.kind };
  }

  /** QA snapshot of the run. */
  debugState(): { state: GameState; haul: number; best: number; health: number; extractProgress: number; sanctuary: boolean; hunt: boolean; chargeSite: number | null; nearestGrabber: number } {
    const p = this.player.position;
    return {
      nearestGrabber: Math.min(...this.grabbers.map((g) => Math.hypot(g.position.x - p.x, g.position.z - p.z))),
      state: this.state,
      haul: this.haul,
      best: this.bestScore,
      health: this.player.health,
      extractProgress: this.extractProgress,
      sanctuary: this.sanctuary,
      hunt: this.hunt,
      chargeSite: this.chargeSite?.index ?? null,
    };
  }

  /** QA: put a peach in the satchel (tier >= 2 also starts the hunt, as in play). */
  debugGivePeach(tier: number): void {
    const t = THREE.MathUtils.clamp(Math.floor(tier), 0, 3);
    this.satchel[t]++;
    this.haul += TIER_VALUE[t];
    if (t >= 2 && !this.hunt) {
      this.hunt = true;
      this.huntTimer = HUNT_DURATION;
      this.fillContext(false);
      this.howler.appear(this.mctx);
    }
  }

  private startRunNoLock(seed: number): void {
    this.prepareRun(seed);
    this.hud.showScreen(null);
    this.setState('playing');
    this.hud.setVisible(true);
  }
}
