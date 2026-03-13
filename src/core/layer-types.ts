// Layer types for the unified scene hierarchy.
// Sculpt volumes, primitives, lights, and groups are all "layers".

export type LayerType =
  | 'clay'
  | 'primitive'
  | 'light'
  | 'group'
  | 'animation_player';

export interface LightData {
  type: 'point' | 'directional' | 'spot';
  intensity: number;
  color: [number, number, number];
}
