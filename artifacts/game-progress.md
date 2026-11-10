# MONKEYBRO — Game Progress

## Intent and constraints
- First-person scavenge-and-extract in a dark flat-peach (pan-tao) orchard. Toggleable flashlight on the camera.
- Linear level. Peaches aged 10 / 100 / 1,000 / 10,000 years; older = rarer and more valuable.
- Randomised extraction points each run.
- Three monster types, increasingly formidable the further from the player they operate:
  1. **Grabber** (close range): pursues the player, on catch drains half of max health (50 HP).
  2. **Caller** (mid range): while the player is scavenging, calls "猴哥" from behind. Turning around to look at it = instant death.
  3. **Howler** (far range): appears when the player harvests a 1,000- or 10,000-year peach and summons every monster on the map into the pursuit.
- No API keys (Tripo / Gemini / ElevenLabs all MISSING) → procedural geometry, canvas textures, Web Audio synthesis, formant-synth voice.
- Bar: the user asked for a playable game in the browser, not explicitly premium. Build the good version; aim for authored visuals.

## Design brief
- **Player promise:** you are a monkey thief creeping through the cursed Immortal Orchard at night, flashlight in hand, stuffing your satchel with immortality peaches and getting out before the orchard's guardians take you.
- **Target feeling:** dread + greed. Every pick is a temptation that makes the night more dangerous.
- **Primary verb:** scavenge (hold E on a peach). **Secondary:** move/sprint, look, toggle light, extract.
- **5–30 s repeat:** scan with the light, spot a peach glow, decide whether to pick it (time exposed), listen for threats, move on.
- **1–5 min change:** deeper zones hold older peaches, faster Grabbers, more Callers; high-value picks trigger the Howler hunt.
- **Lose / learn / restart:** caught twice by a Grabber, or looking at a Caller. Death screen names the cause and the rule. Retry is one click (new random extraction points).
- **Reward / risk:** value banked only on extraction. Light reveals peaches but doubles Grabber detection range; sprint escapes but is loud and limited by stamina; old peaches take longer to pick and summon the hunt.
- **Better player:** manages the light, listens for direction, keeps eyes forward while picking, saves the 1,000/10,000-year peaches for when an extraction point is near.
- **Next decision communicated by:** compass strip with extraction markers + distance, peach glows (colour per tier), interaction prompt with harvest ring, audio cues (growl, call, howl), banner warnings.
- **Non-goals:** combat, crafting, multiple levels, multiplayer.

## Core loop contract
Player **harvests peaches** to **fill the satchel and extract with value** while **Grabbers, Callers and the Howler** create risk; success **banks score (best saved)**, failure **loses the haul and shows the cause, instant retry**.

## Level plan
- Spatial format: one winding orchard trail ~380 m long (−Z), corridor half-width ~11 m, walled by dense trees + fog.
- Zones: I *Outer Orchard* (0–120 m: 10y/100y, 2 Grabbers, 1 Caller), II *Mist Grove* (120–250 m: 100y/1,000y, 3 Grabbers, 1 Caller), III *Heart of the Orchard* (250–380 m: 1,000y/10,000y, 3 faster Grabbers, 1 Caller).
- Start: moonlit clearing with a broken gate. First decision: light on/off. First reward: 10y peaches within 15 m. First threat: Grabber ~45 m in.
- Extraction: 6 candidate shrines (2 per zone). Each run picks 1 from zone I-II pool and 1 from zone II-III pool at random; both shown on compass.
- Landmarks: zone gates (stone paifang arches), lantern posts, a dry pond, giant mother tree at the end.
- Recovery beats: lantern clearings between zones (no Grabber patrol nearby).

## Decisions
- Stack: Vite + TS + three 0.184 (scaffold). Custom capsule-vs-circle collision (no physics engine needed: flat ground, trees as circles, corridor clamp).
- Post: EffectComposer RenderPass + UnrealBloom (eyes, peach halos, lanterns) + OutputPass.
- Audio: Web Audio procedural (worker-owned `src/systems/AudioSystem.ts`).

## Status
- [x] Gameplay core  - [x] World  - [x] Monsters  - [x] HUD/menus  - [x] Audio  - [ ] QA

## User art lock (2026-11-05 11:31 Asia/Shanghai)
- Match comic bible 《偷桃前夜》 / 日月同错 night-orchard look. Full brief: `/workspace/monkeybro/ART_DIRECTION.md`.
- Rename/map: Grabber=紫陌, Caller=青鸾, Howler=金阙 (fairy + monster forms).
- Callout text/voice: 「猴哥——」 only.
- After playable loop lands, do a dedicated visual pass for silhouettes, palette, and fairy→monster tear FX.


## Integration pass (Game.ts rewrite)
- `src/game/Game.ts` rewritten to wire Level/PeachField/Player/Input/Howler/Callers/Grabbers/Hud/Audio/RenderPipeline into one loop.
- Headless (swiftshader) checks passed: title→play, movement, harvest progress, Caller 青鸾点名 death, 2× Grabber 紫陌掠命 death, shrine extraction charge, test-hook states. Screenshots in `artifacts/qa/`.
- QA left open: no real-GPU / pointer-lock / touch playtest; difficulty and flashlight bloom intensity untuned.
- Dev only: `window.__MONKEYBRO__` exposes the Game instance for scripted QA.

## Premium visual upgrade (branch `feat/premium-visuals`, 2026-11-06)
Target: Eastern ink-night comic (`ART_DIRECTION.md`, `VISUAL_QA_ANCHORS.md`). Procedural only (Tripo/Gemini/ElevenLabs keys MISSING).
Baseline defects: near-black ground, muddy tree silhouettes, lantern = yellow blob with no arms, English stat-card HUD.

### Step 1 — World / lighting / materials ✅
- Lighting: hemisphere `#8a7cc8`/`#2d4a3e` @1.15, cool key moon `#b8c6ff` @1.6 aligned with the sky-dome moon, faint warm peach rim; exposure 1.22.
- Fog: ink-purple `#2a1c44`, density 0.020 (high) / 0.024 (low) → near/mid/far orchard layers read.
- Sky: violet horizon haze, moonlit ink-wash cloud bands, layered moon halo, two ink-wash mountain ridges.
- Ground kit: ink-moss floor texture (tileable moss/soil patches, gold + umber leaves, petals); ancient flagstone trail with cracks/lichen; brighter bark/stone/rock/grass.
- Orchard readability: canopy vertex colours baked with moonlit-top / ink-purple-underside gradient; pine-smoke teal leaf palette.
- 「月光碎金」: instanced leaf-dapple decals (moon-blue + peach-gold) along the trail and slanted god-ray cards toward the moon (hunt tints them red).
- Measured (SwiftShader, active-play): entropy 2.59→4.95 bits, edge density 0.065→0.186, contrast 67.7→103.7, dominant colour share 0.577→0.136.

### Step 2 — Lantern & monkey-arm viewmodel ✅ (`Player.ts`, `ProceduralTextures.ts`)
- Builds on the PR #9 cage lantern. Filigree rebuild: 6 alternating bronze/iron meridians, 4 latitude rings, 12-knot cloud-scroll band, ruby core + flame cone inside an amber halo, pagoda lid with finial and 6 upturned tips, lotus foot, 4-link chain into the fist bail.
- Right forearm: canvas fur map (`furTexture`), 6 spiral cloth wraps (`wrapTexture`) with frayed tail, ragged indigo sleeve with gold hem. Furred hand with 4 curled fingers + thumb and nails.
- New left guard arm (empty fist, lower-left): reaches forward while picking, tucks to the chest otherwise. Slight roll sway on the lantern hand.
- Spotlight warmed to `#ffa05a` and emitted 0.7 m ahead of the lantern so the beam no longer blows out the viewmodel.

### Step 3 — Monster heroes ✅ (`Monsters.ts`)
- 紫陌 (Grabber): lilac-cast pale skin `#c8b4d8`; translucent 藕荷 mist veils from both shoulders + shawl.
- 青鸾 (Caller): pine-smoke teal robe/hood/sleeves `#4f9a92`; throat-flute mouth (lip ring, ice-blue throat, 5 gold reeds) that opens and pulses while she calls 「猴哥——」 and gapes in the death pose.
- 金阙 (Howler): 9 torn ink-purple robe strips with gold hems and seams; gold-ribbed folding fan in the right hand.

### Step 4 — Chinese ink-night HUD/UI + audio polish ✅ (`index.html`, `styles.css`, `Hud.ts`, `Game.ts`, `PeachField.ts`, `LevelPath.ts`, `AudioSystem.ts`)
- All copy in Chinese: `lang="zh-CN"`, title 偷桃前夜, HUD labels (命/力/灯, 十年…万年, 桃值), compass 北/东/南/西, light state 明/熄, all four screens, banners, prompts, death copy, toasts, tier names 十年桃…万年蟠桃, zone names (外园 · 月下桃径 / 雾林 · 薄纱迷径 / 园心 · 母树高枝), zh-CN number formatting.
- Ink-night CSS skin: ink-purple/gold/vermillion palette, CJK serif stack, ink-wash panels with a gold rule, chamfered vitals/satchel plates, peach-shaped slots, vermillion seal glyphs, cyan 「猴哥——」 subtitle glow. At ≤720 px, vitals move under the zone plate.
- Audio: lantern toggle re-voiced (chain ticks, cage-lid tap, flame whoosh on / snuff off); new ambient wind-chime and guqin-like pluck; ambient gap 8–22 s. The female 「猴哥」 formant voice is unchanged from PR #9.

### Step 5 — Evidence + scorecard ✅ → `artifacts/final-evidence.md`
- `npm run build` passes. Scorecard average **5.9/10** (top: lighting, world materials, HUD 7; bottom: mobile layout 4, viewmodel 5, performance 5).
- Desktop final: entropy 5.01, edge density 0.188, contrast 103.4, within desktop budget (269/300 calls). Mobile: over mobile budget (216/150 calls, 399k/300k triangles); the overage existed at baseline.
- Open defects:
  - Lantern is off-screen in mobile portrait (NDC x 1.395).
  - In mobile landscape, the title and extracted panels scroll.
  - Worst-case HUD overlaps on mobile (10 portrait / 15 landscape).
  - 青鸾's teal is lost under the lighting (teal 0.1%).
  - The lantern toggle changes mean luminance by only 1.2.
  - 3 Playwright tests still assert English copy (21 pass / 3 fail / 8 skip).
- Game testing skipped by user override.


## Current task — dark courtyard exploration (2026-11-08)
- User: remove visible paths and identifiers, increase map complexity, darker night with sharply reduced unlit visibility, ancient Chinese buildings and searchable treasure chests.
- Preserve: 偷桃夜 / Peach Heist Night branding, steady eye height, all monster footsteps and distance attenuation, bilingual controls, peach haul/extraction and false shrines.
- Plan: unmarked interconnected forest/courtyards; six enterable timber/plaster halls and looped passages; hold E/LMB/touch to search a chest and bank its reward only after extraction; lantern fog density .065 versus .20 unlit.
- Art: extend the existing authored low-poly Chinese kit procedurally; no external generation/services needed for this scope.
- Work ownership: world geometry/layout and chest entity independent modules; lead owns input/HUD/reward/lighting and consolidated verification.
- Complete: six halls and connected unmarked clearings; all entrances reachable; shared chest interaction/payout; darkness and chest beam readability; compass/zone removal; wall-aware enemy pursuit and wall attack blocking; mobile banner layout.
- Verified: build; full desktop/mobile regression 44 pass/8 device skips, final affected pass 17/1 skip; production W door traversal and F toggle; six current production captures and real-input chest lid frame sequence.
- Evidence: artifacts/evidence.json and artifacts/final-evidence.md, run courtyard-night-20261108-r3. Software renderer only; mobile triangle guideline exceeded slightly and physical-device GPU performance remains unmeasured.
- Complete: implementation and evidence ready for main merge. GitHub Pages deployment completion is not observed by this task.


## Current task — natural trees and varied architecture (2026-11-08)
- User rejects visibly faceted trees and repeated/simple buildings. Use threejs-game-director; upgrade these world surfaces while preserving the dark exploration loop.
- Preserve: unmarked map; dark unlit range; six indoor chest sites, entrances and collision routing; steady camera; all monster footsteps; existing bilingual controls and extraction rewards.
- Current baseline: eight acknowledged desktop/mobile captures (orchard + first three courtyards) in artifacts/natural-before-evidence.json; no visual geometry changed before capture.
- Asset probe: official profile-aware helper reports TRIPO_API_KEY=MISSING, GEMINI_API_KEY=MISSING, ELEVENLABS_API_KEY=MISSING. No external jobs accepted; use a deliberate authored geometry/texture alternative and report its visual limits honestly.
- Plan: smooth curved trunks and branching, alpha-cutout leafy silhouettes replacing solid faceted blobs; three distinct Chinese building families with authored roof/facade/interior detail and shared material batches.
- Ownership: tree factory/materials/textures and architecture/variant placement independent workers; lead owns regression tests, exact-pose comparisons, scorecard, budget measurements and integration.
- Pending: inspect representative revised trees/buildings before multiplying details; consolidated gameplay/access/visual checks; compare render budgets; push and merge after verification.

## Current task — level menu and Greywall city (2026-11-09)
- User: complete main menu with extensible first/second-level selection; independently playable medieval European city; original normal/giant/large/armored/beast enemies with configurable AI/combat; searchable four-tier Intel Blueprints, inventory and extraction settlement; preserve first-level behavior.
- Existing unfinished work: smooth tree geometry retained and completed with shared leaf-spray atlas, alpha-tested foliage and bark relief. Original first-level gameplay remains the default scene; second scene uses shared controller/Input/Hud/audio/search classes with an optional world-boundary callback and optional blueprint loot roll.
- Architecture: LevelRegistry factories and dynamic CityGame chunk; old scene input/audio/render loop/resources disposed before constructing the chosen scene. CityWorld owns walls/roads/houses/towers/tall instanced trees and separate human/giant doorway collision grids.
- Game loop contract: choose expedition, move through connected city streets, hold E/action to search caches, evade telegraphed giant attacks or counterstrike with Q/Space/right-click/touch, reach the far signal gate to bank intel. Failure loses unextracted loot; retry resets inventory, enemies and caches.
- Balance: monster heights 1.7/4/6/8/12m; centralized CityConfig stats/cooldowns/AI timings. Intel weights .65/.25/.085/.015, green/blue/purple/orange values10/100/1000/10000.
- Implemented: menu and level factory, original walled city with16 enterable houses/18 supplies/12 patrol positions, five enemy families, sight/hearing/chase/search/return and type-specific attacks, combat input/feedback, colored inventory and game:extraction settlement event + local saved payload.
- Validation underway: actual menu switching and current-scene globals; real search/attack on desktop/touch; rarity economy; enemy state/attack/navigation checks; city path reachability and LOD; first-level regression; production screenshots/performance evidence.
- Known test diagnoses: avoid simultaneous agent/root browser runs sharing test-results; all code now locked except focused near-contact combat correction. Earlier supply-pose HUD setup fixed by applying rotated front offset and a zero-time scene update. No external asset jobs or provider credentials used.
- Full consolidated run: 67 passed / 9 device-specific skips across desktop + mobile, including first-level regressions. Production TypeScript/Vite build passed.
- Independent review corrections: relocalize dynamic city HUD/paused/result copy, preserve scene-load error feedback, and use giant doorway collisions during armored charge. Added focused locale and charge regressions; city follow-up suite underway.
- Visual orientation: far extraction gate has teal hanging cloth and signal lamps; mobile pickup banner moved below objective/combat cues.
- Follow-up city suite:24/24 passed (desktop/mobile), including dynamic locale and armored-charge doorway tests.
- First visual pass caught a real mobile overexposure defect despite nonblank-test success: reused WebGL context retained graphics state from the disposed scene. Explicit renderer.resetState() at renderer creation fixes the color mismatch; a canvas pixel consistency regression now guards this.
- Visual/performance pass: correct pitched-roof trim direction, reduce city lantern power for nearby surfaces, add material relief, restrict distant detail/enemy shadow casting, and compact first-level tree instances beyond42m under existing night fog (fruit/collision stay loaded). New tree LOD regression plus affected gameplay/input/renderer checks underway.
- Current evidence is a fresh r2 pass; r1 remains historical before evidence and must not be mistaken for the corrected release captures.
- Final affected run after renderer/tree/shadow refinements:47 passed /5 device-condition skips. Includes real hold/search, inventory/settlement, attack/death/retry, menu switching, language refresh, pixel consistency, city reachability/LOD, orchard steady camera/tree LOD/peach reachability and pointer/touch regressions.
- Final build passed; repository inspector now enters city through real menu selection and supports explicit local Chromium/locale/DPR overrides. Final production capture pass is running from that checked-in inspector.
- Earlier standalone tree/building brief is historical: shared natural trees are completed for both scenes; three building families ship in the new city. The six original Chinese hall geometries remain the established first-level kit. Original first-level mechanics are regression-tested rather than migrated.
- Final visual refinement: city roof materials render their underside so indoor searches show a ceiling rather than an open sky. Final capture run is greywall-20261109-r3; r1/r2 are historical comparisons.
- Current render diagnostics confirm tree LOD savings at matching orchard poses: desktop triangles409,662→276,266 (orchard),473,760→263,348 (courtyard2); mobile404,610→271,214 and393,332→222,072. New city active view is82,460 desktop/64,576 mobile triangles. Wide city views still exceed the inspector's starting draw-call guideline; this is recorded as a budget exception and physical GPU performance remains unmeasured.
- Final evidence complete:16 acknowledged production captures, zero page/console errors,8 real-keyboard motion samples and measured contact/search results. Current-manifest checker passed25 artifacts. Reviewed desktop/mobile active play, indoor search, menu, defeat and extraction; roof underside present and mobile color/announcement layout fixed.
- Implementation/verification complete. Configuration and extension/settlement instructions are in greywall-guide.md; final-evidence.md records tests, before/after renderer counts, scorecard, asset probe and physical-device/backend boundaries. No pending generation jobs.
