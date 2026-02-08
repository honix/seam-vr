import * as THREE from 'three';
import type { MaterialData } from '../types';

/**
 * Create a Three.js MeshStandardMaterial from our MaterialData type.
 */
export function createMaterial(data: MaterialData): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(data.color[0], data.color[1], data.color[2]),
    roughness: data.roughness,
    metalness: data.metallic,
  });

  if (data.emissive) {
    mat.emissive = new THREE.Color(
      data.emissive[0],
      data.emissive[1],
      data.emissive[2]
    );
    mat.emissiveIntensity = data.emissiveIntensity ?? 1.0;
  }

  return mat;
}

/**
 * Update an existing Three.js material with partial MaterialData changes.
 */
export function updateMaterial(
  mat: THREE.MeshStandardMaterial,
  data: Partial<MaterialData>
): void {
  if (data.color !== undefined) {
    mat.color.setRGB(data.color[0], data.color[1], data.color[2]);
  }
  if (data.roughness !== undefined) {
    mat.roughness = data.roughness;
  }
  if (data.metallic !== undefined) {
    mat.metalness = data.metallic;
  }
  if (data.emissive !== undefined) {
    mat.emissive.setRGB(
      data.emissive[0],
      data.emissive[1],
      data.emissive[2]
    );
  }
  if (data.emissiveIntensity !== undefined) {
    mat.emissiveIntensity = data.emissiveIntensity;
  }
  mat.needsUpdate = true;
}
