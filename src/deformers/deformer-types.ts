import type { Vec3 } from '../types';

export interface BendParams {
  angle: number;
  axis: 'x' | 'y' | 'z';
  center?: number;
}

export interface TaperParams {
  factor: number;
  axis: 'x' | 'y' | 'z';
}

export interface TwistParams {
  angle: number;
  axis: 'x' | 'y' | 'z';
}

export interface LatticeParams {
  resolution: 2 | 3;
  points: Vec3[];
}

export interface NoiseParams {
  amplitude: number;
  frequency: number;
  seed?: number;
}

export type DeformerParams =
  | ({ type: 'bend' } & BendParams)
  | ({ type: 'taper' } & TaperParams)
  | ({ type: 'twist' } & TwistParams)
  | ({ type: 'lattice' } & LatticeParams)
  | ({ type: 'noise' } & NoiseParams);
