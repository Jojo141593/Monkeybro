# Dark courtyard exploration — final evidence

The game now has an unmarked, interconnected forest/courtyard layout, six enterable timber-and-plaster halls, sharply reduced visibility without a lantern, and searchable treasure chests. Paths, edging, arrows, world text plaques, compass markers and zone labels were removed. Survival meters, inventory, reticle and nearby interaction prompts remain. Branding, fixed camera height and distance-sensitive monster footsteps are preserved.

## Gameplay and art

Hold **E / left mouse**, or the phone's action control, to search an aimed chest within 2.6m. Search takes 1.4 game seconds; release, pause, lost target or interruption cancels it. Every chest pays once per run. Its seeded peach-tier cache joins the existing satchel, only banks at a real extraction shrine, and rare caches wake the hunt. Restart closes the lids and resets rewards deterministically. Open lids hinge away from the player; visible treasure sits inside the cabinet.

Six authored courtyard halls use tile seams, upturned roof corners, ridge finials, timber brackets, red columns, lattice windows, masonry bases and open doorways. Walls shape decisions and block interaction/attacks. All 24 outer approaches, 12 hall doors and 6 indoor chest standing points are connected to the spawn in a 0.5m grid check with player-radius clearance and swept midpoint tests. Monsters use bounded cached wall routing, including approaches from both solid sides of every hall and courtyard exteriors; they no longer stall at the new plaster walls or grab through them.

Night haze is near-black. Lantern fog density is .065; unlit density is .20. At 10m, exponential-squared transmission is about .66 lit versus .018 unlit. Near walls and treasure receive a broad, slightly downward lantern beam; the unlit scene retains only nearby silhouettes. The mobile survival panel was moved away from loot banners.

All new assets extend the existing low-poly Chinese world kit procedurally. No external asset generation, provider tasks, credentials, imported GLBs or new physics dependencies were used. Collision remains the existing custom circle grid; wall routing uses a cached .6m A* capped at 6,000 expansions/12,000 cells. Roof/body geometry is merged by material, and chest details share geometry. No premium/AAA visual score is claimed.

## Verification

- `npm run build`: passed, including TypeScript. Main JS 776.36 kB / 210.99 kB gzip; CSS 19.76 kB / 5.24 kB gzip.
- Full regression with `/workspace/environment-setup/playwright.config.mjs`: **44 passed, 8 skipped** (device-specific skips). Covers desktop/mobile chest input, reward/extraction/reset, search through-wall rejection, complete hall accessibility, monster doorway pursuit, audio distance attenuation, steady camera, picking, sanctuary/bait, warning timing, pause and touch controls.
- After the final lantern/lid/mobile-layout refinements, the affected chest/night/visual/movement suite was rerun: **17 passed, 1 skipped** (phone-only layout check skipped on desktop). No application changes followed that run.
- Production preview at port4188: HTML and both bundled assets served under `/monkeytest/`. Actual keyboard W traversed the courtyard and hall doors; F toggled off/on. No page errors; development Game access was absent in production.
- Six current-run production captures passed the canvas inspector with no browser/page errors. `check_evidence.py . --manifest artifacts/evidence.json` passed all six reports plus the five chest-motion artifacts.
- Chest motion was driven by real keyboard E with simulation at 1/60s, not by assigning the opened flag. Samples at frames 0/86/91/125 show lid progress 0/.125/.551/.995, a single 100-value payout, and camera Y fixed at 1.62. Visual inspection confirmed opening direction, visible contents and no camera bob.

The production inspector used system Chromium and deviceScaleFactor .5 through the environment helper `/workspace/environment-setup/inspect-courtyard-cpu.mjs`. Gameplay tests used the same browser at .25 DPR with desktop/mobile viewports unchanged. Rendering was **SwiftShader software**, so no FPS or hardware-performance claim is made.

## Current captures and budgets

Run ID: `courtyard-night-20261108-r3`. [Capture manifest](evidence.json). The production build was captured; the chest motion sequence uses the same source through the development runner for per-frame diagnostics.

| Viewport | State | Draw calls | Triangles | Geometries | Entropy | Luminance contrast |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| desktop | courtyard | 135 | 340,064 | 105 | 2.79 | 46.2 |
| desktop | unlit | 135 | 340,064 | 105 | 1.46 | 31.6 |
| desktop | chest-open | 162 | 349,728 | 124 | 2.43 | 69.4 |
| mobile | courtyard | 78 | 335,304 | 60 | 3.96 | 63.6 |
| mobile | unlit | 78 | 335,304 | 60 | 1.64 | 41 |
| mobile | chest-open | 83 | 344,112 | 63 | 4.73 | 103.3 |

Desktop views meet the starting budgets. Mobile triangles reach 344,112 versus the 300,000 guideline, while draw calls, geometry and texture counts remain under their limits. This tradeoff retains the established detailed monster/hand models and the new authored interiors; physical-phone GPU profiling is still unrun. The pre-existing mobile viewmodel is partly outside the portrait viewport; interaction, lantern light and touch controls remain functional.

- [Desktop courtyard](courtyard-night-20261108-r3/desktop-courtyard.png) · [same view unlit](courtyard-night-20261108-r3/desktop-unlit.png) · [open chest](courtyard-night-20261108-r3/desktop-chest-open.png)
- [Mobile courtyard](courtyard-night-20261108-r3/mobile-courtyard.png) · [same view unlit](courtyard-night-20261108-r3/mobile-unlit.png) · [open chest and HUD](courtyard-night-20261108-r3/mobile-chest-open.png)
- [Chest motion measurements](courtyard-night-20261108-r3/chest-motion.json) · [closed](courtyard-night-20261108-r3/chest-motion-closed.png) · [opening](courtyard-night-20261108-r3/chest-motion-opening.png) · [half](courtyard-night-20261108-r3/chest-motion-half.png) · [open](courtyard-night-20261108-r3/chest-motion-open.png)

Golden screenshot baselines were deferred because software/GPU differences and procedural night effects make them unstable across environments. The new suite protects actual visibility contrast, no-marker behavior, doorway connectivity, real input and reward state instead; current captures were inspected visually.

## Skill workflow and review

Used installed `threejs-game-director` with the gameplay, graphics, UI, debug/profiler and QA/release production skills; read the 3D-generator guidance while selecting the existing procedural art path. Relevant references loaded: genre design, physics selection, authoring recipes, technical-art budgets, UI patterns, release checks, visual-test harness and current-run evidence manifest. The game director skill pack source revision is 8286774b22a2566bf894dbc825825c16921866af.

Independent reviews found and resolved side-on monster wall stalls, two far courtyard aprons outside playable bounds, and weak chest-content lighting/mobile banner overlap. Roof normals, doorway clearance, chest occlusion and shared-asset ownership were checked. [Current design contract](courtyard-design.md).

Deploy via the repository's existing GitHub Pages workflow on a push to `main`. A successful push triggers that workflow; it is not proof the live deployment finished.
