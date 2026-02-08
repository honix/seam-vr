import { PrimitiveType, Vec3 } from '../types';

export interface CylinderParams {
  radiusTop: number;
  radiusBottom: number;
  height: number;
  radialSegments: number;
  heightSegments: number;
}

export interface SphereParams {
  radius: number;
  widthSegments: number;
  heightSegments: number;
}

export interface BoxParams {
  width: number;
  height: number;
  depth: number;
  widthSegments: number;
  heightSegments: number;
  depthSegments: number;
}

export interface ConeParams {
  radius: number;
  height: number;
  radialSegments: number;
  heightSegments: number;
}

export interface TorusParams {
  radius: number;
  tubeRadius: number;
  radialSegments: number;
  tubularSegments: number;
}

export interface CapsuleParams {
  radius: number;
  length: number;
  capSegments: number;
  radialSegments: number;
}

export interface TubeParams {
  radius: number;
  points: Vec3[];
  tubularSegments: number;
  radialSegments: number;
}

const CYLINDER_DEFAULTS: CylinderParams = {
  radiusTop: 0.5,
  radiusBottom: 0.5,
  height: 1.0,
  radialSegments: 16,
  heightSegments: 12,
};

const SPHERE_DEFAULTS: SphereParams = {
  radius: 0.5,
  widthSegments: 24,
  heightSegments: 16,
};

const BOX_DEFAULTS: BoxParams = {
  width: 1.0,
  height: 1.0,
  depth: 1.0,
  widthSegments: 4,
  heightSegments: 4,
  depthSegments: 4,
};

const CONE_DEFAULTS: ConeParams = {
  radius: 0.5,
  height: 1.0,
  radialSegments: 16,
  heightSegments: 12,
};

const TORUS_DEFAULTS: TorusParams = {
  radius: 0.5,
  tubeRadius: 0.15,
  radialSegments: 16,
  tubularSegments: 32,
};

const CAPSULE_DEFAULTS: CapsuleParams = {
  radius: 0.3,
  length: 1.0,
  capSegments: 8,
  radialSegments: 16,
};

const TUBE_DEFAULTS: TubeParams = {
  radius: 0.1,
  points: [
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ],
  tubularSegments: 32,
  radialSegments: 8,
};

const DEFAULTS: Record<PrimitiveType, Record<string, any>> = {
  cylinder: CYLINDER_DEFAULTS,
  sphere: SPHERE_DEFAULTS,
  box: BOX_DEFAULTS,
  cone: CONE_DEFAULTS,
  torus: TORUS_DEFAULTS,
  capsule: CAPSULE_DEFAULTS,
  tube: TUBE_DEFAULTS,
};

export function getDefaultParams(type: PrimitiveType): Record<string, any> {
  return { ...DEFAULTS[type] };
}
