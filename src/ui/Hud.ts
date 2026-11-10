import { TIER_COLORS } from '../assets/MaterialLibrary';
import { fmt, t } from './i18n';

/** Localisable text: a literal, or a thunk re-evaluated when the language changes. */
export type Text = string | (() => string);
const txt = (v: Text): string => (typeof v === 'function' ? v() : v);

type ScreenName = 'title' | 'pause' | 'dead' | 'extracted' | null;

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

/** DOM HUD bound to game state; never owns rules. */
export class Hud {
  private readonly hud = $('#hud');
  private readonly healthFill = $('#health-fill');
  private readonly staminaFill = $('#stamina-fill');
  private readonly batteryFill = $('#battery-fill');
  private readonly lightState = $('#light-state');
  private readonly healthMeter = $('.meter-health');
  private readonly staminaMeter = $('.meter-stamina');
  private readonly batteryMeter = $('.meter-battery');
  private readonly counts = [0, 1, 2, 3].map((i) => $(`#count-${i}`));
  private readonly slots = [0, 1, 2, 3].map((i) => $(`.slot[data-tier="${i}"]`));
  private readonly haul = $('#haul-value');
  private readonly reticle = $('#reticle');
  private readonly ring = $('#harvest-progress');
  private readonly prompt = $('#prompt');
  private readonly promptText = $('#prompt-text');
  private readonly promptValue = $('#prompt-value');
  private readonly promptKey = $('#prompt-key');
  private readonly banner = $('#banner');
  private readonly bannerTitle = $('#banner-title');
  private readonly bannerSub = $('#banner-sub');
  private readonly subtitle = $('#subtitle');
  private readonly huntMeter = $('#hunt-meter');
  private readonly huntFill = $('#hunt-fill');
  private readonly hint = $('#hint');
  private readonly lockHint = $('#lock-hint');
  private lockPromptShown = false;
  private readonly extract = $('#extract');
  private readonly extractFill = $('#extract-fill');
  private readonly toastLayer = $('#toast-layer');
  private readonly flashEl = $('#fx-flash');
  private bannerText: [Text, Text] = ['', ''];
  private hintText: Text = '';
  private bannerTimer = 0;
  private subtitleTimer = 0;
  private hintTimer = 0;
  private flashAmt = 0;
  private haulShown = 0;
  private haulTarget = 0;
  private last = { h: -1, s: -1, b: -1, light: true };
  readonly screens = {
    title: $('#screen-title'),
    pause: $('#screen-pause'),
    dead: $('#screen-dead'),
    extracted: $('#screen-extracted'),
  };

  setVisible(v: boolean): void {
    this.hud.classList.toggle('hidden', !v);
  }

  showScreen(name: ScreenName): void {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
  }

  /** Re-render every piece of HUD text that was set from code (static nodes use data-i18n). */
  relocalize(): void {
    this.lightState.textContent = t(this.last.light ? 'light.on' : 'light.off');
    this.haul.textContent = fmt(this.haulShown);
    this.bannerTitle.textContent = txt(this.bannerText[0]);
    this.bannerSub.textContent = txt(this.bannerText[1]);
    this.hint.textContent = txt(this.hintText);
  }

  setVitals(health01: number, stamina01: number, battery01: number, lightOn: boolean): void {
    const h = Math.round(health01 * 200) / 200;
    const s = Math.round(stamina01 * 100) / 100;
    const b = Math.round(battery01 * 100) / 100;
    if (h !== this.last.h) {
      this.healthFill.style.transform = `scaleX(${h})`;
      this.healthMeter.classList.toggle('low', h <= 0.5);
      this.last.h = h;
    }
    if (s !== this.last.s) {
      this.staminaFill.style.transform = `scaleX(${s})`;
      this.staminaMeter.classList.toggle('low', s < 0.2);
      this.last.s = s;
    }
    if (b !== this.last.b) {
      this.batteryFill.style.transform = `scaleX(${b})`;
      this.batteryMeter.classList.toggle('low', b < 0.18);
      this.last.b = b;
    }
    if (lightOn !== this.last.light) {
      this.lightState.textContent = t(lightOn ? 'light.on' : 'light.off');
      this.lightState.classList.toggle('off', !lightOn);
      this.last.light = lightOn;
    }
  }

  setSatchel(counts: number[], haul: number, instant = false): void {
    counts.forEach((c, i) => (this.counts[i].textContent = String(c)));
    this.haulTarget = haul;
    if (instant) {
      this.haulShown = haul;
      this.haul.textContent = fmt(haul);
    }
  }

  bumpSlot(tier: number): void {
    const el = this.slots[tier];
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  toast(text: string, tier: number): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.color = TIER_COLORS[tier];
    el.textContent = text;
    this.toastLayer.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  setPrompt(info: { text: string; value: string; key: string } | null, progress01: number): void {
    this.reticle.classList.toggle('target', !!info);
    this.prompt.classList.toggle('hidden', !info);
    if (info) {
      this.promptText.textContent = info.text;
      this.promptValue.textContent = info.value;
      this.promptKey.textContent = info.key;
    }
    this.ring.style.strokeDashoffset = String(251.3 * (1 - progress01));
  }

  showBanner(title: Text, sub: Text, kind: 'danger' | 'caller' | 'howl' | 'info', seconds: number): void {
    this.banner.className = kind;
    this.bannerText = [title, sub];
    this.bannerTitle.textContent = txt(title);
    this.bannerSub.textContent = txt(sub);
    this.bannerTimer = seconds;
  }

  showSubtitle(text: string, seconds: number): void {
    this.subtitle.textContent = text;
    this.subtitle.classList.remove('hidden');
    this.subtitleTimer = seconds;
  }

  showHint(text: Text, seconds = 5): void {
    this.hintText = text;
    this.hint.textContent = txt(text);
    this.hint.classList.remove('hidden');
    this.hintTimer = seconds;
  }

  /** Persistent "click to capture the mouse" prompt. Independent of the timed hint. */
  setLockPrompt(show: boolean): void {
    if (show === this.lockPromptShown) return;
    this.lockPromptShown = show;
    this.lockHint.classList.toggle('hidden', !show);
  }

  setHunt(frac: number | null): void {
    this.huntMeter.classList.toggle('hidden', frac === null);
    if (frac !== null) this.huntFill.style.transform = `scaleX(${frac})`;
  }

  setExtract(frac: number | null): void {
    this.extract.classList.toggle('hidden', frac === null);
    if (frac !== null) this.extractFill.style.transform = `scaleX(${frac})`;
  }

  flash(color: string, amount: number): void {
    this.flashEl.style.background = color;
    this.flashAmt = Math.max(this.flashAmt, amount);
  }

  tick(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.add('hidden');
    }
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitle.classList.add('hidden');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hint.classList.add('hidden');
    }
    if (this.flashAmt > 0) {
      this.flashAmt = Math.max(0, this.flashAmt - dt * 2.2);
      this.flashEl.style.opacity = String(this.flashAmt);
    }
    if (this.haulShown !== this.haulTarget) {
      const diff = this.haulTarget - this.haulShown;
      this.haulShown += Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt * 8)));
      if (Math.abs(this.haulTarget - this.haulShown) < 1) this.haulShown = this.haulTarget;
      this.haul.textContent = fmt(this.haulShown);
    }
  }

  clearTransient(): void {
    this.banner.classList.add('hidden');
    this.subtitle.classList.add('hidden');
    this.hint.classList.add('hidden');
    this.bannerTimer = this.subtitleTimer = this.hintTimer = 0;
    this.flashAmt = 0;
    this.flashEl.style.opacity = '0';
    this.setHunt(null);
    this.setExtract(null);
    this.setPrompt(null, 0);
    this.toastLayer.replaceChildren();
  }
}
