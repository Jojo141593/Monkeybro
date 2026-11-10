# Dark courtyard exploration

Player promise: sneak through an unmarked, haunted Chinese garden, search abandoned halls for treasure, and escape with the haul.

Core loop: explore by lantern light, choose a doorway or forest passage, hold the shared interaction control to pick peaches or search a chest, then find a real cold-blue shrine while monsters pursue. Searching roots the player and exposes them to the same threats as picking. A chest pays out once per run; rare rewards trigger the hunt. Death loses the unbanked haul, extraction saves it, restart resets all chests.

The map uses connected groves, intersecting loops, walled courtyards and small halls with open doorways. The first hall gives an early choice and reward; later halls create detours near stronger enemies. Buildings, roof silhouettes and monster audio provide orientation. There are no road meshes, edge stripes, arrows, compass markers or zone labels. Survival meters, inventory, the reticle and nearby interaction prompts stay available.

Darkness: dim moon/fill, near-black haze and subdued sky/dapple. Lantern-on fog density .065; unlit .20, blended over a fraction of a second. Under exponential-squared fog, distant terrain vanishes much sooner without light. The lantern reveals nearby walls and chests; it also attracts hunters. Keep fixed eye height, existing custom arcade collision and desktop/mobile intents. No new physics dependency or external asset provider.

Verification: build; chest hold/cancel/single payout/reset/occlusion; real keyboard and touch interaction; entry/exit/interior reachability; lit/unlit image and range comparison; removal of markers; peach/extraction/monster footsteps regressions. Capture desktop and mobile active play, unlit play and an indoor open chest, with fresh run IDs. FPS from software rendering is not a hardware performance measurement.
