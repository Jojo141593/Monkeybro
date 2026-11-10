import { expect, test } from '@playwright/test';
import type { AudioSystem, MonsterKind, MonsterStepSource } from '../src/systems/AudioSystem';
import type * as THREE from 'three';

test('all monster footsteps produce audio and become louder at close range', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(async moduleURL => {
    const { AudioSystem } = await import(moduleURL) as typeof import('../src/systems/AudioSystem');
    const render = async (kind: MonsterKind, distance: number): Promise<number> => {
      const ctx = new OfflineAudioContext(2, 24000, 48000);
      const bus = ctx.createGain();bus.connect(ctx.destination);
      const noise = ctx.createBuffer(1, 96000, 48000);
      let seed = 7;
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1; }
      const a = new AudioSystem() as unknown as { ctx: OfflineAudioContext; monsterFootGain: GainNode; noiseBuf: AudioBuffer; monsterFootstep(kind: MonsterKind, p: THREE.Vector3, t: number): void };
      a.ctx = ctx;a.monsterFootGain = bus;a.noiseBuf = noise;
      // Seeded noise is constant, so distance is the only source of amplitude change.
      const random = Math.random;Math.random = () => 0.5;
      try { a.monsterFootstep(kind, { x: 0, y: 0, z: -distance } as THREE.Vector3, 0.01); } finally { Math.random = random; }
      const buffer = await ctx.startRendering();
      let energy = 0;
      for (let ch = 0; ch < 2; ch++) for (const sample of buffer.getChannelData(ch)) energy += sample * sample;
      return Math.sqrt(energy / (buffer.length * 2));
    };
    const results = [];
    for (const kind of ['grabber', 'caller', 'howler'] as const) results.push({ kind, near: await render(kind, 2), far: await render(kind, 20) });
    return results;
  }, '/monkeytest/src/systems/AudioSystem.ts');
  for (const r of report) {
    expect(r.far, r.kind).toBeGreaterThan(0.00001);
    expect(r.near, r.kind).toBeGreaterThan(r.far * 4);
  }
});

test('strides follow movement for all monsters and stay silent on stop, teleport, pause and hide', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __MONKEYBRO__?: unknown }).__MONKEYBRO__);
  await page.locator('#start-button').click();
  const report = await page.evaluate(async () => {
    const g = (window as unknown as { __MONKEYBRO__: { audio: AudioSystem; player: { position: THREE.Vector3 }; loop: { stop(): void } } }).__MONKEYBRO__;
    g.loop.stop(); await g.audio.unlock();
    const a = g.audio as unknown as { monsterFootstep(kind: MonsterKind): void; updateMonsterSteps: AudioSystem['updateMonsterSteps'] };
    const calls: MonsterKind[] = [];
    a.monsterFootstep = kind => calls.push(kind);
    const sources: MonsterStepSource[] = (['grabber', 'caller', 'howler'] as const).map(kind => ({id: kind,kind,position: g.player.position.clone().set(0, 0, -2),active:true}));
    a.updateMonsterSteps(0.1, sources, false);
    a.updateMonsterSteps(0.1, sources, true);
    for (let i = 0; i < 20; i++) { for (const s of sources) s.position.x += 0.25; a.updateMonsterSteps(0.1, sources, true); }
    const moving = [...calls];
    calls.length = 0;
    for (let i = 0; i < 20; i++) a.updateMonsterSteps(0.1, sources, true);
    for (const s of sources) s.position.x += 100;
    a.updateMonsterSteps(0.1, sources, true);
    for (const s of sources) s.position.x += 1;
    a.updateMonsterSteps(0.1, sources, false);
    for (const s of sources) s.active = false;
    a.updateMonsterSteps(0.1, sources, true);
    return { moving, quiet: [...calls] };
  });
  expect(new Set(report.moving)).toEqual(new Set(['grabber', 'caller', 'howler']));
  expect(report.quiet).toEqual([]);
});
