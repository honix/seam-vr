// Seam VR - Shared types

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number]; // quaternion
export type Color = [number, number, number]; // RGB 0-1

export interface Transform {
  position: Vec3;
  rotation: Vec4; // quaternion [x, y, z, w]
  scale: Vec3;
}

export const DEFAULT_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

// Primitive types
export type PrimitiveType =
  | 'cylinder'
  | 'sphere'
  | 'box'
  | 'cone'
  | 'torus'
  | 'capsule'
  | 'tube';

// Deformer types
export type DeformerType = 'bend' | 'taper' | 'twist' | 'lattice' | 'noise';

// Material data
export interface MaterialData {
  color: Color;
  roughness: number;
  metallic: number;
  emissive?: Color;
  emissiveIntensity?: number;
}

export const DEFAULT_MATERIAL: MaterialData = {
  color: [0.8, 0.8, 0.8],
  roughness: 0.5,
  metallic: 0.0,
};

// Interpolation modes for animation
export type InterpolationMode = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step';

// XR controller button state
export interface XRButtonState {
  pressed: boolean;
  touched: boolean;
  value: number;
}

// Interaction modes
export type InteractionMode = 'handle' | 'free-deform' | 'play';
