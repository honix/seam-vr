// Layer types for the unified scene hierarchy.
// Sculpt volumes, primitives, lights, and groups are all "layers".

export type LayerType = 'sculpt' | 'primitive' | 'light' | 'group';

export interface LightData {
  type: 'point' | 'directional' | 'spot';
  intensity: number;
  color: [number, number, number];
}
