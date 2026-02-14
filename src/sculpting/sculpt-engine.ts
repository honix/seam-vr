// Sculpt Engine - main coordinator for VR sculpting
// Manages SDF volume, brush operations, mesh extraction, and Three.js rendering.
// Uses WebGPU compute for brush application and marching cubes mesh extraction.

import * as THREE from 'three';
import { SDFVolume } from './sdf-volume';
import { Chunk } from './chunk';
import { MoveBrush } from './brush';
import { GPUCompute } from './gpu-compute';
import type { BrushParams, BrushType, SculptConfig, MeshData, ChunkCoord } from './types';
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

  // Three.js meshes per chunk
  private chunkMeshes: Map<string, ChunkMeshData> = new Map();
  private material: THREE.MeshStandardMaterial;

  // Brush state
  private moveBrush: MoveBrush = new MoveBrush();
  private _brushType: BrushType = 'add';
  private _brushRadius: number = 0.02; // 2cm default
  private _brushStrength: number = 1.0;
  private _brushSmoothing: number = 0.005;

  // Concurrent stroke guard — drop frames while GPU is busy
  private strokeInFlight = false;

  // Sculpt group in scene
  sculptGroup: THREE.Group;

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
   * Initialize GPU compute. Must be called before sculpting.
   */
  async initGPU(): Promise<boolean> {
    const ok = await this.gpu.init();
    if (ok) {
      console.log('[Sculpt] GPU compute enabled');
    } else {
      console.warn('[Sculpt] WebGPU not available — sculpting disabled');
    }
    return ok;
  }

  get gpuReady(): boolean { return this.gpu.ready; }

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
   * Batched: all brush dispatches in one GPU submission, all remeshes in another.
   */
  async stroke(worldPos: [number, number, number]): Promise<void> {
    if (this._brushType === 'move') return;
    if (!this.gpu.ready) return;
    // Drop frame if previous stroke still running on GPU
    if (this.strokeInFlight) return;

    this.strokeInFlight = true;
    try {
      const brush: BrushParams = {
        type: this._brushType,
        center: worldPos,
        radius: this._brushRadius,
        strength: this._brushStrength,
        smoothing: this._brushSmoothing,
      };

      const coords = this.volume.chunksInSphere(
        worldPos[0], worldPos[1], worldPos[2],
        this._brushRadius + this._brushSmoothing
      );
      const modifiedChunks: Chunk[] = coords.map(c => this.volume.getOrCreateChunk(c));

      // Batch brush: single GPU submission, single fence
      await this.gpu.applyBrushBatch(modifiedChunks, brush);

      for (const chunk of modifiedChunks) {
        chunk.dirty = true;
        chunk.updateEmpty();
      }

      const extraChunks = this.volume.syncBoundaries(modifiedChunks);
      await this.remeshChunks([...modifiedChunks, ...extraChunks]);
    } finally {
      this.strokeInFlight = false;
    }
  }

  /**
   * Begin a move operation at the given position
   */
  beginMove(worldPos: [number, number, number]): void {
    this.moveBrush.beginMove(this.volume, worldPos, this._brushRadius);
    const dirtyChunks = this.volume.dirtyChunks();
    const extraChunks = this.volume.syncBoundaries(dirtyChunks);
    this.remeshChunks([...dirtyChunks, ...extraChunks]);
  }

  /**
   * Update move operation with new controller position
   */
  async updateMove(worldPos: [number, number, number]): Promise<void> {
    if (!this.moveBrush.isActive) return;
    const modified = this.moveBrush.updateMove(this.volume, worldPos);
    const extraChunks = this.volume.syncBoundaries(modified);
    await this.remeshChunks([...modified, ...extraChunks]);
  }

  /**
   * End move operation
   */
  endMove(): void {
    this.moveBrush.endMove();
  }

  /**
   * Remesh chunks in a single batched GPU call.
   * All buildPadded + marchingCubes dispatches in one submission.
   */
  private async remeshChunks(chunks: Chunk[]): Promise<void> {
    const nonEmpty: Chunk[] = [];
    for (const chunk of chunks) {
      if (chunk.empty) {
        this.removeChunkMesh(chunkKey(chunk.coord));
      } else {
        nonEmpty.push(chunk);
      }
    }

    if (nonEmpty.length === 0) return;

    // Prepare all boundary slices (lightweight CPU reads)
    const items = nonEmpty.map(chunk => ({
      chunk,
      boundarySlices: this.extractBoundarySlices(chunk.coord),
    }));

    // Batch GPU: single submission, single fence
    const meshResults = await this.gpu.buildPaddedAndExtractBatch(items);

    for (let i = 0; i < nonEmpty.length; i++) {
      this.updateChunkMesh(chunkKey(nonEmpty[i].coord), meshResults[i]);
      nonEmpty[i].dirty = false;
    }
  }

  /**
   * Extract 6 neighbor boundary slices for a chunk, packed into a single Float32Array.
   * Each face is samples^2 floats. Total: 6 * samples^2 floats (~26KB at chunkSize=32).
   * Missing neighbors are filled with emptyValue.
   */
  private extractBoundarySlices(coord: ChunkCoord): Float32Array {
    const cs = this.config.chunkSize;
    const samples = cs + 1;
    const S2 = samples * samples;
    const slices = new Float32Array(6 * S2);
    slices.fill(this.config.emptyValue);

    // -X face: neighbor at (x-1), take its ix=cs-1
    const nxm = this.volume.getChunk({ x: coord.x - 1, y: coord.y, z: coord.z });
    if (nxm) {
      for (let iz = 0; iz < samples; iz++)
        for (let iy = 0; iy < samples; iy++)
          slices[0 * S2 + iz * samples + iy] = nxm.get(cs - 1, iy, iz);
    }

    // +X face: neighbor at (x+1), take its ix=1
    const nxp = this.volume.getChunk({ x: coord.x + 1, y: coord.y, z: coord.z });
    if (nxp) {
      for (let iz = 0; iz < samples; iz++)
        for (let iy = 0; iy < samples; iy++)
          slices[1 * S2 + iz * samples + iy] = nxp.get(1, iy, iz);
    }

    // -Y face: neighbor at (y-1), take its iy=cs-1
    const nym = this.volume.getChunk({ x: coord.x, y: coord.y - 1, z: coord.z });
    if (nym) {
      for (let iz = 0; iz < samples; iz++)
        for (let ix = 0; ix < samples; ix++)
          slices[2 * S2 + iz * samples + ix] = nym.get(ix, cs - 1, iz);
    }

    // +Y face: neighbor at (y+1), take its iy=1
    const nyp = this.volume.getChunk({ x: coord.x, y: coord.y + 1, z: coord.z });
    if (nyp) {
      for (let iz = 0; iz < samples; iz++)
        for (let ix = 0; ix < samples; ix++)
          slices[3 * S2 + iz * samples + ix] = nyp.get(ix, 1, iz);
    }

    // -Z face: neighbor at (z-1), take its iz=cs-1
    const nzm = this.volume.getChunk({ x: coord.x, y: coord.y, z: coord.z - 1 });
    if (nzm) {
      for (let iy = 0; iy < samples; iy++)
        for (let ix = 0; ix < samples; ix++)
          slices[4 * S2 + iy * samples + ix] = nzm.get(ix, iy, cs - 1);
    }

    // +Z face: neighbor at (z+1), take its iz=1
    const nzp = this.volume.getChunk({ x: coord.x, y: coord.y, z: coord.z + 1 });
    if (nzp) {
      for (let iy = 0; iy < samples; iy++)
        for (let ix = 0; ix < samples; ix++)
          slices[5 * S2 + iy * samples + ix] = nzp.get(ix, iy, 1);
    }

    return slices;
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

    // Update geometry attributes — reuse BufferGeometry, replace attributes
    const geometry = chunkMesh.mesh.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
    geometry.computeBoundingSphere();
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
    this.gpu.releaseChunk(key);
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
