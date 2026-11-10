# Two-expedition game design

## Shared promise and level contract
Choose an expedition, search for valuable loot under monster pressure, then escape with it. The orchard remains the first expedition with its original peaches, fairy-demons, dark lantern visibility, chest rewards and shrine/bait rules. Greywall is a separate second scene: an original European medieval city with cobbled boulevards, side alleys, enterable houses, red roofs, stone walls and towers. It uses the same player eye height1.62m, steady camera, movement/input, audio, HUD and chest interaction primitives. `LevelRegistry.registerLevel` is the extension point for later scenes.

The main menu shows both levels with a selected-state card, description and explicit entry control. Pause, death and extraction screens can return to selection. Scene loading stops and disposes the preceding scene before constructing the selected factory. Original orchard test hooks and mechanics remain available only while it is the current scene.

## City encounter plan
A safe south gate teaches movement and searching. Market and broad cross-streets offer choices among18 supply points. Ordinary enemies introduce close combat; larger sentinels appear deeper in the city. Low house doors admit human-sized actors but block giants. Towers, red roofs and streets orient the player. The far signal gate at z−120 charges extraction over3.2s; loot can be banked at any positive or zero haul. No mandatory kill gate is added.

The five original enemy forms are stone, cloth, leather and iron humanoid sentinels, not copies of anime characters. Ordinary height1.7m; base giant4m, large6m, armored8m and beast12m. Original names and centralized values live in `CityConfig.ts`. Patrol → perception → chase → telegraphed attack → search at last known position → return. Vision requires distance/field-of-view and wall LOS; sprinting and searching create hearing cues. Cached wall routing handles detours; tall bodies use a separate grid to avoid entering low-roof houses. Combat roles are nimble melee, slow stomp, broad sweep, armored charge/high defense and beast rock/shockwave. Attacks have windup and recovery, can be avoided, and cannot hit through solid walls.

The player counterstrikes with Q, Space, right-click or the touch sword button. Searching uses E, left mouse or the action button and roots the player until released. No walking camera bob is introduced; strikes only animate the fist.

## Loot and settlement
Intel rarity configuration is independent of orchard peach rewards: common green10 at65%, rare blue100 at25%, epic purple1000 at8.5%, legendary orange10000 at1.5%. A cache pays once per run after a completed hold, shows colored name/value feedback, increments the backpack and this-run value. Incomplete searching cancels on release, pause or interruption. Extraction emits a typed `game:extraction` payload with levelId/seed/counts/totalValue/time and saves the last local settlement. This is the integration seam for a future persistent backend; no server is required for this slice.

## Rendering and verification
Procedural authored architecture, smooth tree trunks and shared alpha foliage are reused without external providers. House detail and vegetation have distance LOD; repeated tree forms use six instanced batches, static facade detail is merged by material. One soft-shadow sun plus hemisphere fill defines city lighting. Hardware performance remains a measurement task, not inferred from software-rendered FPS.

Required checks: menu and repeated level switching; original first-level regression; real desktop/touch movement/search/attack; all supply/extraction/patrol points reachable; rarity probabilities and inventory totals; damage/armor/cooldowns/AI search/disengagement; ranged attacks and wall blocking; death/retry/reset; settlement only after extraction; production base paths, responsive captures and resource cleanup.

## Review findings resolved
Independent integration review found stale dynamic translations on city language change, immediately overwritten load-error feedback, and an armored-charge branch bypassing the low-doorway giant grid. These are corrected, with locale and charge regression coverage. Ordinary enemies also keep melee spacing during cooldown and remain hittable at exact contact. The far gate has authored cloth/lamp cues; mobile pickup announcements reserve space below the objective and threat line.

## Measured optimization pass
The first visual pass exposed excess far-tree triangles and unnecessary far-caster submissions. Orchard tree instance lists are now compacted at42m within the opaque night fog; all peach positions and colliders remain in memory and keep their rules. City house trim does not cast separate shadows, house shell shadows stop at60m, and enemy shadows stop at35m. Main silhouettes and nearby soft shadows remain. World surface textures also provide light bump relief, city lantern intensity is8 instead of the orchard's62, and gable trim follows its actual roof slope.

Renderer creation resets inherited graphics state because both levels reuse one HTML canvas/WebGL context. This removes the mobile color accumulation seen in the first capture pass. The final visual manifest uses a fresh r2 ID; historical r1 images are retained for diagnosis/comparison.
