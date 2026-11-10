# Greywall expedition — implementation and verification

Completed: bilingual level selection, an independent second expedition, original medieval city/monster families, hold-to-search Intel Blueprints, colored inventory and extraction settlement. The original orchard mechanics remain. [User/configuration guide](greywall-guide.md) · [Design and interfaces](greywall-design.md). Local development: http://127.0.0.1:5188/monkeytest/ ; production preview: http://127.0.0.1:4189/monkeytest/ .

## Implemented behavior

- Main menu selects either expedition; pause, defeat and success can return to selection. LevelRegistry registers future scene factories. Prior scene loop/input/audio/render resources are disposed; shared canvas graphics state resets to prevent color accumulation.
- Greywall has16 enterable houses in3 building families,18 search sites, connected boulevards/cross-streets/alleys, red ceramic roofs, cobbles, fortified walls, towers, a market and signal gate. Roof undersides remain visible indoors. Smooth branching trees share leaf-mask atlases, bark relief and instanced batches.
- Eight original enemies span five families. Actual model heights are1.7/4/6/8/12m. Sight/FOV/distance and hearing feed patrol/chase/windup/attack/search/return states. Cached wall routing detours around buildings; tall enemies cannot pass low doors, including during charges. Types use melee, stomp, sweep, armored charge/defense, and beast rocks/shockwaves. All moving enemies feed spatial footsteps.
- Q / Space / right-click / touch sword strikes; E / left-click / touch blueprint holds to search1.4s. Interrupted holds cancel; a cache pays once. Four loot tiers use65%/25%/8.5%/1.5% weights, green/blue/purple/orange colors and values10/100/1,000/10,000. Counts and haul update immediately. Failure/retry resets unextracted loot. Camera height remains1.62m during locomotion and striking.
- The far gate charges extraction for3.2s. A typed `game:extraction` event and `localStorage['greywall.last-extraction']` carry levelId, seed, counts, totalValue and time. This is the future persistent-system interface; no account/backend inventory is connected.

## Checks run

1. `npm run build`: TypeScript and production build passed. The original scene intentionally remains in the initial menu/background bundle; CityGame is a separate lazy chunk (~46.6kB, ~16.7kB gzip). Vite reports a non-fatal static/dynamic import note for the original Game.
2. Full consolidated Playwright run:67 passed /9 device-condition skips across desktop/mobile (6.5min). This covers original orchard extraction/bait/hunt/chest rules, movement/steady view, no-marker rendering, footsteps, controls and all newly integrated city systems.
3. After independent review fixes, the focused city suite passed24/24. Checks include configured size ratios, armor/cooldown/damage, sight/hearing/search/disengagement, wall detours/planner bounds, melee/ranged/shockwave attacks, giant doorway/charge blocking, contact strikes, repeated menu switching, inventory payout/rarity distribution, real hold cancellation, death/retry and saved settlement.
4. After final renderer/LOD refinements, affected suites passed47 /5 condition skips (3.4min): city session/world, shared search, orchard movement/peach access, tree LOD, pointer/touch behavior, localization and canvas-color consistency. No failures. The roof underside refinement was verified by the final production captures.
5. Production captures use the checked-in inspector through the real menu:1280×720 desktop and390×664 mobile CSS viewports, DPR1, Chinese, seed42. Sixteen acknowledged state captures cover menu, orchard, courtyard, city play/search/open chest, death and extraction. All are nonblank with zero page/console errors. [Current manifest](greywall-evidence.json).
6. Real W/Q/E keyboard events drive the separate motion evidence. Simulation remains in playing state and is stepped at1/60s for reproducible samples; rendering occurs at each sample. This establishes animation/contact behavior, not live-device frame pacing. [Motion measurements](greywall-20261109-r3/motion.json), [approach](greywall-20261109-r3/motion-giant-approach.png), [windup](greywall-20261109-r3/motion-giant-windup.png), [contact](greywall-20261109-r3/motion-giant-contact.png), [counterstrike](greywall-20261109-r3/motion-counterstrike.png), [opening](greywall-20261109-r3/motion-cache-opening.png), [open](greywall-20261109-r3/motion-cache-open.png). Expected measured changes: player100→70 HP on stomp, giant160→119 HP on counterstrike, one searched cache adds10 with seed42, eye height stays1.62.

The first screenshot pass exposed mobile overexposure that a nonblank check could not catch. Independent code review also found stale dynamic translations, overwritten loading-error copy and the armored charge collision branch. All are corrected and covered; historical r1/r2 captures are explicitly before/intermediate evidence, not release screenshots. [First visual-pass manifest](greywall-before-evidence.json).

## Current captures and renderer counts

All current reports use run ID`greywall-20261109-r3`. Cloud rendering used ANGLE/SwiftShader software. Pixel/renderer counts are useful; software FPS cannot establish hardware performance.

| Viewport | State | Draw calls | Triangles | Geometries | Textures | Entropy | Luminance contrast |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| desktop | orchard | 293 | 276,266 | 244 | 15 | 3.26 | 53.1 |
| desktop | courtyard-2 | 472 | 263,348 | 383 | 16 | 2.68 | 40.4 |
| desktop | city-active | 399 | 82,460 | 236 | 30 | 4.95 | 127 |
| desktop | city-supply | 132 | 45,286 | 245 | 30 | 3.28 | 56.5 |
| desktop | city-chest-open | 133 | 45,478 | 245 | 30 | 3.46 | 64.7 |
| mobile | orchard | 223 | 271,214 | 192 | 14 | 4.48 | 86.3 |
| mobile | courtyard-2 | 83 | 222,072 | 67 | 12 | 3.94 | 57.2 |
| mobile | city-active | 256 | 64,576 | 172 | 24 | 5.04 | 120.3 |
| mobile | city-supply | 64 | 38,846 | 194 | 26 | 4.49 | 70.7 |
| mobile | city-chest-open | 65 | 39,038 | 187 | 26 | 4.8 | 141.3 |

- [Desktop menu](greywall-20261109-r3/desktop-title.png) · [city](greywall-20261109-r3/desktop-city-active.png) · [indoor intel](greywall-20261109-r3/desktop-city-chest-open.png)
- [Mobile menu](greywall-20261109-r3/mobile-title.png) · [city](greywall-20261109-r3/mobile-city-active.png) · [inventory/loot feedback](greywall-20261109-r3/mobile-city-chest-open.png)
- [Original orchard](greywall-20261109-r3/desktop-orchard.png) · [original courtyard](greywall-20261109-r3/desktop-courtyard-2.png)

At matching first-level poses, triangles fall from409,662→276,266 desktop orchard and473,760→263,348 courtyard2; mobile404,610→271,214 and393,332→222,072. These before counts are real captures in[natural-before-evidence.json](natural-before-evidence.json). Original night fog hides the42m tree cut; tests confirm fruit and collision remain unchanged. City trees use six instanced meshes, house fine detail ends at48m, house shell visibility at115m, tree canopy/trunks at72/86m. Far house/enemy shadow submissions are restricted, and city rendering caps DPR at1.

Budget exceptions remain explicit: wide city views use399 desktop/256 mobile draw calls versus the inspector starting limits300/150. The inherited courtyard view uses472 calls/383 geometries (before479/382), and mobile orchard uses223 calls (before234); title background reaches327,864 mobile triangles versus the300k guideline. City active-play triangles are only82,460/64,576 and all city texture/geometry counts stay within their desktop/mobile starting tiers. These are retained for original detailed viewmodels/monsters and enterable authored buildings. Structural reuse, lower triangles and LOD reduce work, but no claim of60FPS or zero device-specific slowdown is established. Physical mobile GPU/Safari profiling remains unrun.

Low contrast in the first-level courtyard is intentional lantern-only night design. City interior material relief and paper contents stay readable without the prior light blowout. Portrait crops some of the inherited first-person arms/lantern; action controls and illumination remain usable.

## Visual calibration

Reviewed the skill's three anchor images and the complete current desktop/mobile capture set, plus motion. New city has no prior complete scorecard; before is not captured rather than invented. This assesses authored stylized presentation, not photorealism.

| Category / genre surface | Before | After | Evidence |
| --- | --- | ---: | --- |
| Art direction | not captured |2.5| Original stone/cloth/iron sentinels, red-roofed fortified town and intel UI |
| Hero/player | not captured |2| Reused authored fur/sleeves/brass lantern; distinct strike pose with steady eye |
| Enemies | not captured |2| Five scale/material/silhouette families; anticipation, armor and ranged roles |
| Rewards/interactables | not captured |2.5| Hinged cabinets, paper contents, held search, rarity colors/value/count feedback |
| World | not captured |2.5| Enterable houses, three facade families, walls/towers/market/alleys and leafy trees |
| Materials | not captured |2.5| Shared foliage atlas/bark relief; stone/tile/plaster/paving/cloth texture roles |
| Lighting/render | not captured |2| Soft sun/shadow depth, interior lantern, corrected shared-context state; deliberately dark orchard |
| VFX/motion | not captured |2| Strike/locomotion/attack warning/contact/hit flash/lid/death transitions |
| UI/HUD | not captured |2.5| Bilingual expedition flow, responsive action controls and readable loot/survival hierarchy |
| Performance evidence | not captured |2.5| Before/after counts, instancing/LOD, build and browser checks; software caveat and budget exceptions |

Average2.3/3. No remaining automatic layout/playability failures observed in declared captures. This does not establish scan-based realism or real-device performance.

## Skill/asset record and limits

Used the installed[threejs-game-director](https://github.com/majidmanzarpour/threejs-game-skills) pack, with gameplay-systems, aaa-graphics-builder, game-ui-designer, debug-profiler and qa-release production skills; 3D/image/audio generator guidance was read for asset sourcing. Loaded references cover gameplay/physics, authoring/technical-art budgets, visual anchors/scorecard, UI patterns, browser QA/visual harness and evidence manifests. Installed source revision8286774b22a2566bf894dbc825825c16921866af.

The official credential probe reports TRIPO_API_KEY, GEMINI_API_KEY and ELEVENLABS_API_KEY all MISSING. No external asset jobs/task IDs, spending or pending generations exist. Deliberately authored procedural geometry/textures and the existing event-driven audio were used. Models and world surfaces remain stylized; no scanned/commercial photographic assets are claimed.

Unimplemented/integration boundaries: server-side account/long-term stash is not connected (typed extraction interface is ready); real phone/Safari/hardware GPU frame-rate and memory profiling is not performed. The original six Chinese halls retain their existing architectural kit; the new three-family architecture is in the city.

Source/scripts/build/captures are ready for authorized GitHub push and merge. The existing Pages workflow deploys on main; a push alone is not evidence that live deployment has completed.
