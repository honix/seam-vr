// Sculpt Engine - main coordinator for VR sculpting
// Manages SDF volume, brush operations, mesh extraction, and Three.js rendering.
// Selects GPU or CPU path based on WebGPU availability.

import * as THREE from 'three';
import { SDFVolume } from './sdf-volume';
import { Chunk } from './chunk';
import { applyBrush, MoveBrush } from './brush';
import { extractMesh } from './marching-cubes';
import { GPUCompute } from './gpu-compute';
import type { BrushParams, BrushType, SculptConfig, MeshData } from './types';
import { DEFAULT_SCULPT_CONFIG, chunkKey } from './types';

interface ChunkMeshData {
  mesh: THREE.Mesh;
  vertexCount: number;
}

export class SculptEngine {
  readonly volume: SDFVolume;
  readonly config: SculptConfig;

  private scene: THREE.Scene;
  private gpu: GPUCompute;
  private useGPU: boolean = false;

  // Three.js meshes per chunk
  private chunkMeshes: Map<string, ChunkMeshData> = new Map();
  private material: THREE.MeshStandardMaterial;

  // Brush state
  private moveBrush: MoveBrush = new MoveBrush();
  private _brushType: BrushType = 'add';
  private _brushRadius: number = 0.02; // 2cm default
  private _brushStrength: number = 1.0;
  private _brushSmoothing: number = 0.005;

  // Sculpt group in scene
  private sculptGroup: THREE.Group;

  constructor(scene: THREE.Scene, config: SculptConfig = DEFAULT_SCULPT_CONFIG) {
    this.scene = scene;
    this.config = config;
    this.volume = new SDFVolume(config);
    this.gpu = new GPUCompute(config);

    // Sculpt material (clay-like)
    this.material = new THREE.MeshStandardMaterial({
      color: 0xc4956a,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });

    // Group to hold all chunk meshes
    this.sculptGroup = new THREE.Group();
    this.sculptGroup.name = 'sculpt_volume';
    this.scene.add(this.sculptGroup);
  }

  /**
   * Try to initialize GPU compute. Call once at startup.
   */
  async initGPU(): Promise<boolean> {
    this.useGPU = await this.gpu.init();
    if (this.useGPU) {
      console.log('[Sculpt] GPU compute enabled');
    } else {
      console.log('[Sculpt] Using CPU fallback');
    }
    return this.useGPU;
  }

  // --- Brush property accessors ---

  get brushType(): BrushType { return this._brushType; }
  set brushType(type: BrushType) { this._brushType = type; }

  get brushRadius(): number { return this._brushRadius; }
  set brushRadius(r: number) { this._brushRadius = Math.max(0.001, r); }

  get brushStrength(): number { return this._brushStrength; }
  set brushStrength(s: number) { this._brushStrength = Math.max(0.01, Math.min(2.0, s)); }

  get brushSmoothing(): number { return this._brushSmoothing; }
  set brushSmoothing(s: number) { this._brushSmoothing = Math.max(0, s); }

  /**
   * Apply a sculpt stroke at the given world position.
   * Used for add and subtract brushes.
   */
  async stroke(
    worldPos: [number, number, number]
  ): Promise<void> {
    if (this._brushType === 'move') return; // Move uses beginMove/updateMove

    const brush: BrushParams = {
      type: this._brushType,
      center: worldPos,
      radius: this._brushRadius,
      strength: this._brushStrength,
      smoothing: this._brushSmoothing,
    };

    let modifiedChunks: Chunk[];

    if (this.useGPU) {
      // GPU path: dispatch brush shader per affected chunk, then extract mesh
      const coords = this.volume.chunksInSphere(
        worldPos[0], worldPos[1], worldPos[2],
        this._brushRadius + this._brushSmoothing
      );
      modifiedChunks = [];
      for (const coord of coords) {
        const chunk = this.volume.getOrCreateChunk(coord);
        await this.gpu.applyBrush(chunk, brush);
        chunk.dirty = true;
        chunk.updateEmpty();
        modifiedChunks.push(chunk);
      }
    } else {
      // CPU path
      modifiedChunks = applyBrush(this.volume, brush);
    }

    // Remesh dirty chunks
    await this.remeshChunks(modifiedChunks);
  }

  /**
   * Begin a move operation at the given position
   */
  beginMove(worldPos: [number, number, number]): void {
    this.moveBrush.beginMove(this.volume, worldPos, this._brushRadius);
    // Remesh chunks affected by the erase
    const dirtyChunks = this.volume.dirtyChunks();
    this.remeshChunks(dirtyChunks);
  }

  /**
   * Update move operation with new controller position
   */
  async updateMove(worldPos: [number, number, number]): Promise<void> {
    if (!this.moveBrush.isActive) return;
    const modified = this.moveBrush.updateMove(this.volume, worldPos);
    await this.remeshChunks(modified);
  }

  /**
   * End move operation
   */
  endMove(): void {
    this.moveBrush.endMove();
  }

  /**
   * Remesh a set of chunks (extract triangles and update Three.js meshes)
   */
  private async remeshChunks(chunks: Chunk[]): Promise<void> {
    for (const chunk of chunks) {
      if (chunk.empty) {
        this.removeChunkMesh(chunkKey(chunk.coord));
        continue;
      }

      let meshData: MeshData;
      if (this.useGPU) {
        meshData = await this.gpu.extractMesh(chunk);
      } else {
        meshData = extractMesh(chunk, this.config);
      }

      this.updateChunkMesh(chunkKey(chunk.coord), meshData);
      chunk.dirty = false;
    }
  }

  /**
   * Create or update a Three.js mesh for a chunk
   */
  private updateChunkMesh(key: string, meshData: MeshData): void {
    if (meshData.vertexCount === 0) {
      this.removeChunkMesh(key);
      return;
    }

    let chunkMesh = this.chunkMeshes.get(key);

    if (!chunkMesh) {
      const geometry = new THREE.BufferGeometry();
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = `sculpt_chunk_${key}`;
      this.sculptGroup.add(mesh);
      chunkMesh = { mesh, vertexCount: 0 };
      this.chunkMeshes.set(key, chunkMesh);
    }

    // Update geometry buffers
    const geom = chunkMesh.mesh.geometry;
    geom.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
    geom.computeBoundingSphere();
    chunkMesh.vertexCount = meshData.vertexCount;
  }

  /**
   * Remove a chunk's Three.js mesh
   */
  private removeChunkMesh(key: string): void {
    const chunkMesh = this.chunkMeshes.get(key);
    if (chunkMesh) {
      this.sculptGroup.remove(chunkMesh.mesh);
      chunkMesh.mesh.geometry.dispose();
      this.chunkMeshes.delete(key);
    }
    if (this.useGPU) {
      this.gpu.releaseChunk(key);
    }
  }

  /**
   * Get current mesh statistics
   */
  getStats(): { chunks: number; vertices: number; triangles: number } {
    let totalVerts = 0;
    for (const [, cm] of this.chunkMeshes) {
      totalVerts += cm.vertexCount;
    }
    return {
      chunks: this.volume.chunkCount,
      vertices: totalVerts,
      triangles: Math.floor(totalVerts / 3),
    };
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    for (const [, chunkMesh] of this.chunkMeshes) {
      this.sculptGroup.remove(chunkMesh.mesh);
      chunkMesh.mesh.geometry.dispose();
    }
    this.chunkMeshes.clear();
    this.material.dispose();
    this.scene.remove(this.sculptGroup);
    this.gpu.destroy();
  }
}
