# Natural orchard and architectural variety

Historical brief before the expanded two-level request. The shared natural-tree pass is included in the final build. Architectural variety is authored in the new city with three Western building families; the original Chinese hall kit and all first-level rules are preserved. The original six-hall variant proposal below is retained as design history, not claimed as a shipped change.

The existing core loop remains: explore unmarked woods and courtyards by lantern, pick peaches and search chests under monster pressure, then escape with the haul. This pass changes the world presentation, rather than adding mechanics. All indoor chest locations, door clearances, stable camera and directional footsteps remain part of the acceptance contract.

Player-facing target: trees should read as branching living plants with fine leaf silhouettes, not colored triangular masses. Use curved tapered trunk/roots, distinct forks and twigs, bark grain, layered foliage with gaps and subtle blossom accents. Interpret “without polygons” as removing visible faceting; maintain smooth shading and leaf-shaped alpha silhouettes at the real camera scale.

The six buildings should have at least three clearly different architectural identities: distinct roof profiles/tiers/ridges, facade composition, window/lattice patterns, beam/bracket forms and interior props. Doorways and loot remain functional; decoration must not create invisible collision or obscure interaction. Variation should survive the existing dim light, not depend on globally brightening the environment.

Asset sourcing: generation credentials are missing after the official probe. Use detailed, intentional Three.js geometry and shared texture atlases, without claiming photographic assets. Favor instancing, merged details and smooth normals over greatly increasing draw calls.

Verification uses fixed seed42, stable orchard t52 view and first three hall exterior poses on desktop/mobile. Compare against the complete pre-edit capture set. Add regression checks for foliage masking/smooth shading, actual geometric building variety, doorway/chest clearance and existing playability. Record draw calls, triangles, geometry and texture counts; software-rendered frame rates do not measure hardware performance.
