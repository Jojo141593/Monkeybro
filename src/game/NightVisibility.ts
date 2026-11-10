/** Lantern reach is a gameplay choice: darkness hides the orchard beyond a few metres. */
export const NIGHT_COLOR = '#05060c';
export const NIGHT_HUNT_COLOR = '#10050b';
export const LANTERN_FOG_DENSITY = 0.065;
export const UNLIT_FOG_DENSITY = 0.20;

export function nightFogDensity(lightOn: boolean, hunt: number): number {
  return (lightOn ? LANTERN_FOG_DENSITY : UNLIT_FOG_DENSITY) + hunt * 0.008;
}
