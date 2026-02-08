import * as THREE from 'three';
import { TubeParams } from './primitive-params';
import { Vec3 } from '../types';

export function createTubeGeometry(params: TubeParams): THREE.BufferGeometry {
  const points = params.points.map(
    (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2])
  );
  const curve = new THREE.CatmullRomCurve3(points);

  return new THREE.TubeGeometry(
    curve,
    params.tubularSegments,
    params.radius,
    params.radialSegments,
    false
  );
}
