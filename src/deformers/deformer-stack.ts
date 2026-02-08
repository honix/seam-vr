import * as THREE from 'three';
import type { DeformerParams } from './deformer-types';
import { applyBend } from './bend';
import { applyTaper } from './taper';
import { applyTwist } from './twist';
import { applyLattice } from './lattice';
import { applyNoise } from './noise';

/**
 * Ordered stack of deformers applied to a single primitive's geometry.
 * Clones source geometry and applies each deformer sequentially on the CPU.
 */
export class DeformerStack {
  deformers: DeformerParams[] = [];

  add(params: DeformerParams): void {
    this.deformers.push(params);
  }

  remove(index: number): void {
    if (index >= 0 && index < this.deformers.length) {
      this.deformers.splice(index, 1);
    }
  }

  reorder(fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 || fromIndex >= this.deformers.length ||
      toIndex < 0 || toIndex >= this.deformers.length
    ) return;
    const [item] = this.deformers.splice(fromIndex, 1);
    this.deformers.splice(toIndex, 0, item);
  }

  /**
   * Clone the source geometry, apply all deformers in order, and return the result.
   */
  apply(sourceGeometry: THREE.BufferGeometry): THREE.BufferGeometry {
    const geom = sourceGeometry.clone();
    if (this.deformers.length === 0) return geom;

    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    const norAttr = geom.getAttribute('normal') as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const normals = norAttr.array as Float32Array;

    for (const def of this.deformers) {
      switch (def.type) {
        case 'bend':
          applyBend(positions, normals, def);
          break;
        case 'taper':
          applyTaper(positions, normals, def);
          break;
        case 'twist':
          applyTwist(positions, normals, def);
          break;
        case 'lattice':
          applyLattice(positions, normals, def);
          break;
        case 'noise':
          applyNoise(positions, normals, def);
          break;
      }
    }

    // Recompute normals after all deformations
    posAttr.needsUpdate = true;
    geom.computeVertexNormals();

    return geom;
  }

  /**
   * Pack deformer parameters into a flat structure for WGSL shader uniforms.
   * Each deformer gets a block of 8 floats: [type, param0..param6]
   * Max 8 deformers supported.
   */
  toUniforms(): Float32Array {
    const MAX_DEFORMERS = 8;
    const BLOCK_SIZE = 8;
    const data = new Float32Array(MAX_DEFORMERS * BLOCK_SIZE);

    const typeMap = { bend: 1, taper: 2, twist: 3, lattice: 4, noise: 5 } as const;
    const axisMap = { x: 0, y: 1, z: 2 } as const;

    const count = Math.min(this.deformers.length, MAX_DEFORMERS);
    for (let i = 0; i < count; i++) {
      const offset = i * BLOCK_SIZE;
      const def = this.deformers[i];
      data[offset] = typeMap[def.type];

      switch (def.type) {
        case 'bend':
          data[offset + 1] = def.angle * (Math.PI / 180);
          data[offset + 2] = axisMap[def.axis];
          data[offset + 3] = def.center ?? 0;
          break;
        case 'taper':
          data[offset + 1] = def.factor;
          data[offset + 2] = axisMap[def.axis];
          break;
        case 'twist':
          data[offset + 1] = def.angle * (Math.PI / 180);
          data[offset + 2] = axisMap[def.axis];
          break;
        case 'noise':
          data[offset + 1] = def.amplitude;
          data[offset + 2] = def.frequency;
          data[offset + 3] = def.seed ?? 0;
          break;
        // Lattice parameters are too complex for a flat uniform block;
        // GPU lattice would use a separate buffer.
        case 'lattice':
          data[offset + 1] = def.resolution;
          break;
      }
    }

    return data;
  }
}
