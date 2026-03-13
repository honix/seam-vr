// Sculpt Engine - main coordinator for VR sculpting
// Manages SDF volume, brush operations, mesh extraction, and Three.js rendering.
// Uses WebGPU compute for brush application and marching cubes mesh extraction.

import * as THREE from 'three';
import { SDFVolume } from './sdf-volume';
import { Chunk } from './chunk';
import { GPUCompute } from './gpu-compute';
import type { BrushParams, BrushType, SculptConfig, MeshData, ChunkCoord } from './types';
import { DEFAULT_SCULPT_CONFIG, chunkKey } from './types';
import type { MaterialData } from '../types';

interface ChunkMeshData {
  mesh: THREE.Mesh;
  vertexCount: number;
}

const MAX_AFFECTED_CHUNKS_PER_STROKE = 128;
const REMESH_BATCH_SIZE = 6;
const LIVE_REMESH_INTERVAL_MS = 32;
const LIVE_REMESH_CHUNK_BUDGET = 12;
const FLUSH_REMESH_CHUNK_BUDGET = 48;
const ENABLE_SCULPT_TIMING_LOGS = false;

interface PendingStroke {
  hand: string;
  mode: 'stroke' | 'smooth';
  position: [number, number, number];
  brushType: BrushType;
  brushRadius: number;
  brushStrength: number;
  brushSmoothing: number;
}

export class SculptEngine {
  readonly volume: SDFVolume;
  readonly config: SculptConfig;

  private parent: THREE.Object3D;
  private gpu: GPUCompute;

  // Three.js meshes per chunk
  private chunkMeshes: Map<string, ChunkMeshData> = new Map();
  readonly sculptMaterial: THREE.MeshStandardMaterial;

  // Brush state
  private _brushType: BrushType = 'add';
  private _brushRadius: number = 0.02; // 2cm default
  private _brushStrength: number = 1.0;
  private _brushSmoothing: number = 0.005;
  // Per-hand previous stroke position for capsule brush continuity
  private _prevStrokePos: Map<string, [number, number, number] | null> = new Map();
  private pendingStrokes: Map<string, PendingStroke> = new Map();
  private pendingStrokeResets: Set<string> = new Set();
  private activeStrokeHands: Set<string> = new Set();
  private pendingRemeshChunkKeys: Map<string, number> = new Map();
  private lastRemeshAt = 0;
  private remeshFlushInFlight = false;
  private remeshPriorityCounter = 0;

  // Concurrent stroke guard — drop frames while GPU is busy
  private strokeInFlight = false;

  // Sculpt group in scene
  sculptGroup: THREE.Group;

  constructor(parent: THREE.Object3D, config: SculptConfig = DEFAULT_SCULPT_CONFIG, groupName = 'sculpt_volume') {
    this.parent = parent;
    this.config = config;
    this.volume = new SDFVolume(config);
    this.gpu = new GPUCompute(config);

    // Sculpt material (clay-like)
    this.sculptMaterial = new THREE.MeshStandardMaterial({
      color: 0xc4956a,
      roughness: 0.85,
      metalness: 0.05,
    });

    // Group to hold all chunk meshes
    this.sculptGroup = new THREE.Group();
    this.sculptGroup.name = groupName;
    this.parent.add(this.sculptGroup);
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
  set brushRadius(r: number) {
    this._brushRadius = Math.max(0.001, Math.min(this.getMaxBrushRadius(), r));
  }

  get brushStrength(): number { return this._brushStrength; }
  set brushStrength(s: number) { this._brushStrength = Math.max(0.01, Math.min(2.0, s)); }

  get brushSmoothing(): number { return this._brushSmoothing; }
  set brushSmoothing(s: number) { this._brushSmoothing = Math.max(0, s); }

  /**
   * Apply a sculpt stroke at the given world position.
   * Keeps boundary neighbors in sync and rebuilds all affected meshes immediately.
   */
  async stroke(worldPos: [number, number, number], hand: string = 'right'): Promise<void> {
    this.activeStrokeHands.add(hand);
    const pending = this.capturePendingStroke('stroke', worldPos, hand);
    if (this.strokeInFlight || this.remeshFlushInFlight) {
      this.pendingStrokes.set(hand, pending);
      return;
    }

    await this.processStroke(pending);
  }

  /**
   * Apply a smooth stroke at the given world position.
   * Uses Laplacian smoothing via double-buffer GPU compute.
   * Same capsule brush logic and boundary sync path as stroke().
   */
  async smoothStroke(worldPos: [number, number, number], hand: string = 'right'): Promise<void> {
    this.activeStrokeHands.add(hand);
    const pending = this.capturePendingStroke('smooth', worldPos, hand);
    if (this.strokeInFlight || this.remeshFlushInFlight) {
      this.pendingStrokes.set(hand, pending);
      return;
    }

    await this.processStroke(pending);
  }

  private async processStroke(pending: PendingStroke): Promise<void> {
    if (!this.gpu.ready) return;

    this.strokeInFlight = true;
    try {
      const t0 = performance.now();
      const prevPos = this._prevStrokePos.get(pending.hand) ?? null;
      this._prevStrokePos.set(pending.hand, [...pending.position]);

      // First frame: just record position, no brush applied.
      // Capsule on frame 2 will cover both positions without double-application.
      if (!prevPos) return;

      const brush: BrushParams = {
        type: pending.mode === 'smooth' ? 'smooth' : pending.brushType,
        center: pending.position,
        prevCenter: prevPos,
        radius: pending.brushRadius,
        strength: pending.brushStrength,
        smoothing: pending.brushSmoothing,
      };

      const influenceRadius =
        pending.mode === 'smooth'
          ? pending.brushRadius + pending.brushSmoothing
          : pending.brushRadius + pending.brushSmoothing * 2;
      const steps = this.createStrokeSteps(prevPos, pending.position, influenceRadius);
      const modifiedChunks = new Map<string, Chunk>();

      const t1 = performance.now();
      for (const step of steps) {
        const stepBrush: BrushParams = {
          ...brush,
          center: step.to,
          prevCenter: step.from,
        };
        const stepChunks = this.getStrokeChunks(step.to, step.from, influenceRadius);
        if (pending.mode === 'smooth') {
          await this.gpu.applySmoothBatch(this.createChunkNeighborhoodItems(stepChunks), stepBrush);
        } else {
          await this.gpu.applyBrushBatch(stepChunks, stepBrush);
        }
        for (const chunk of stepChunks) {
          modifiedChunks.set(chunkKey(chunk.coord), chunk);
        }
      }
      const t2 = performance.now();

      for (const chunk of modifiedChunks.values()) {
        chunk.dirty = true;
      }

      const t3 = performance.now();
      const queuedRemeshCount = this.queueChunksForRemesh([...modifiedChunks.values()]);
      let remeshCount = 0;
      if (this.shouldRunLiveRemesh()) {
        remeshCount = await this.processPendingRemeshPass(LIVE_REMESH_CHUNK_BUDGET);
      }

      const t4 = performance.now();

      const total = t4 - t0;
      if (ENABLE_SCULPT_TIMING_LOGS && total > 5) {
        console.log(
          `[${pending.mode === 'smooth' ? 'Smooth' : 'Stroke'}] ${total.toFixed(1)}ms total | ` +
          `brush: ${(t2 - t1).toFixed(1)}ms (${modifiedChunks.size} chunks, ${steps.length} steps) | ` +
          `remesh: ${(t4 - t3).toFixed(1)}ms (${remeshCount}/${queuedRemeshCount} chunks)`
        );
      }
    } finally {
      this.strokeInFlight = false;
      this.finalizeEndedHandIfSettled(pending.hand);
      const next = this.takePendingStroke();
      if (next) {
        void this.processStroke(next);
      } else if (this.activeStrokeHands.size === 0 && this.pendingRemeshChunkKeys.size > 0) {
        void this.flushPendingRemesh();
      }
    }
  }

  /**
   * Reset stroke state (call when trigger is released).
   */
  endStroke(hand: string = 'right'): void {
    this.activeStrokeHands.delete(hand);
    if (this.strokeInFlight || this.pendingStrokes.has(hand)) {
      this.pendingStrokeResets.add(hand);
    } else {
      this._prevStrokePos.set(hand, null);
      this.pendingStrokeResets.delete(hand);
    }
    if (!this.strokeInFlight && this.activeStrokeHands.size === 0 && this.pendingRemeshChunkKeys.size > 0) {
      void this.flushPendingRemesh();
    }
  }

  private queueChunksForRemesh(modifiedChunks: Chunk[]): number {
    const extraChunks = this.volume.syncBoundaries(modifiedChunks);
    const remeshChunks = [...modifiedChunks, ...extraChunks];

    for (const chunk of remeshChunks) {
      const key = chunkKey(chunk.coord);
      this.gpu.invalidateChunk(key);
      this.pendingRemeshChunkKeys.set(key, ++this.remeshPriorityCounter);
    }
    return remeshChunks.length;
  }

  /**
   * Remesh chunks in a single batched GPU call.
   * All buildPadded + marchingCubes dispatches in one submission.
   */
  private async remeshChunks(chunks: Chunk[]): Promise<void> {
    if (chunks.length === 0) return;
    for (let offset = 0; offset < chunks.length; offset += REMESH_BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + REMESH_BATCH_SIZE);
      const items = this.createChunkNeighborhoodItems(batch);
      const meshResults = await this.gpu.buildPaddedAndExtractBatch(items);

      for (let i = 0; i < batch.length; i++) {
        const chunk = batch[i];
        const meshData = meshResults[i];
        this.updateChunkMesh(chunkKey(chunk.coord), meshData);
        chunk.empty = meshData.vertexCount === 0;
        chunk.dirty = false;
      }
    }
  }

  private shouldRunLiveRemesh(): boolean {
    if (this.pendingRemeshChunkKeys.size === 0) return false;
    if (this.remeshFlushInFlight) return false;
    return performance.now() - this.lastRemeshAt >= LIVE_REMESH_INTERVAL_MS;
  }

  private async processPendingRemeshPass(limit: number): Promise<number> {
    if (this.pendingRemeshChunkKeys.size === 0) return 0;

    const keys = [...this.pendingRemeshChunkKeys.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key]) => key);
    for (const key of keys) {
      this.pendingRemeshChunkKeys.delete(key);
    }

    const chunks = keys
      .map((key) => this.volume.getChunk(this.parseChunkKey(key)))
      .filter((chunk): chunk is Chunk => chunk !== undefined);

    if (chunks.length === 0) return 0;

    await this.remeshChunks(chunks);
    this.lastRemeshAt = performance.now();
    return chunks.length;
  }

  private async flushPendingRemesh(): Promise<void> {
    if (this.remeshFlushInFlight || this.strokeInFlight) return;
    if (this.pendingRemeshChunkKeys.size === 0) return;

    this.remeshFlushInFlight = true;
    try {
      while (this.pendingRemeshChunkKeys.size > 0 && this.activeStrokeHands.size === 0) {
        await this.processPendingRemeshPass(FLUSH_REMESH_CHUNK_BUDGET);
      }
    } finally {
      this.remeshFlushInFlight = false;
      const next = this.takePendingStroke();
      if (next) {
        void this.processStroke(next);
      }
    }
  }

  private getMaxBrushRadius(): number {
    return this.config.chunkSize * this.config.voxelSize * 1.5;
  }

  private getStrokeChunks(
    worldPos: [number, number, number],
    prevPos: [number, number, number],
    influenceRadius: number,
  ): Chunk[] {
    const coords = new Map<string, ChunkCoord>();
    const dx = worldPos[0] - prevPos[0];
    const dy = worldPos[1] - prevPos[1];
    const dz = worldPos[2] - prevPos[2];
    const distance = Math.hypot(dx, dy, dz);
    const chunkWorldSize = this.config.chunkSize * this.config.voxelSize;
    const sampleSpacing = Math.max(chunkWorldSize * 0.5, influenceRadius * 0.75);
    const sampleCount = Math.max(1, Math.ceil(distance / sampleSpacing));

    for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex++) {
      const t = sampleCount === 0 ? 0 : sampleIndex / sampleCount;
      const sample: [number, number, number] = [
        prevPos[0] + dx * t,
        prevPos[1] + dy * t,
        prevPos[2] + dz * t,
      ];
      for (const c of this.volume.chunksInSphere(sample[0], sample[1], sample[2], influenceRadius)) {
        coords.set(chunkKey(c), c);
      }
    }

    return [...coords.values()].map((coord) => this.volume.getOrCreateChunk(coord));
  }

  private capturePendingStroke(
    mode: 'stroke' | 'smooth',
    position: [number, number, number],
    hand: string,
  ): PendingStroke {
    return {
      hand,
      mode,
      position: [...position],
      brushType: this._brushType,
      brushRadius: this._brushRadius,
      brushStrength: this._brushStrength,
      brushSmoothing: this._brushSmoothing,
    };
  }

  private takePendingStroke(): PendingStroke | null {
    const next = this.pendingStrokes.values().next().value as PendingStroke | undefined;
    if (!next) return null;
    this.pendingStrokes.delete(next.hand);
    return next;
  }

  private finalizeEndedHandIfSettled(hand: string): void {
    if (!this.pendingStrokeResets.has(hand)) return;
    if (this.activeStrokeHands.has(hand)) return;
    if (this.pendingStrokes.has(hand)) return;

    this._prevStrokePos.set(hand, null);
    this.pendingStrokeResets.delete(hand);
  }

  private createStrokeSteps(
    from: [number, number, number],
    to: [number, number, number],
    influenceRadius: number,
  ): { from: [number, number, number]; to: [number, number, number] }[] {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const distance = Math.hypot(dx, dy, dz);
    const maxSegmentLength = this.getMaxSegmentLength(influenceRadius);
    const stepCount = Math.max(1, Math.ceil(distance / maxSegmentLength));
    const steps: { from: [number, number, number]; to: [number, number, number] }[] = [];
    let segmentStart: [number, number, number] = [...from];

    for (let stepIndex = 1; stepIndex <= stepCount; stepIndex++) {
      const t = stepIndex / stepCount;
      const segmentEnd: [number, number, number] = [
        from[0] + dx * t,
        from[1] + dy * t,
        from[2] + dz * t,
      ];
      steps.push({ from: segmentStart, to: segmentEnd });
      segmentStart = segmentEnd;
    }

    return steps;
  }

  private getMaxSegmentLength(influenceRadius: number): number {
    const chunkWorldSize = this.config.chunkSize * this.config.voxelSize;
    const axisChunks = Math.max(1, Math.ceil((influenceRadius * 2) / chunkWorldSize));
    const crossSectionChunks = axisChunks * axisChunks;
    const alongBudget = Math.max(1, Math.floor(MAX_AFFECTED_CHUNKS_PER_STROKE / crossSectionChunks));
    const travelChunks = Math.max(1, alongBudget - axisChunks);
    return Math.max(chunkWorldSize * 0.5, travelChunks * chunkWorldSize);
  }

  private parseChunkKey(key: string): ChunkCoord {
    const [x, y, z] = key.split(',').map(Number);
    return { x, y, z };
  }

  private createChunkBoundingSphere(key: string): THREE.Sphere {
    const coord = this.parseChunkKey(key);
    const chunkWorldSize = this.config.chunkSize * this.config.voxelSize;
    const center = new THREE.Vector3(
      (coord.x + 0.5) * chunkWorldSize,
      (coord.y + 0.5) * chunkWorldSize,
      (coord.z + 0.5) * chunkWorldSize,
    );
    const radius = Math.sqrt(3) * (chunkWorldSize + this.config.voxelSize) * 0.5;
    return new THREE.Sphere(center, radius);
  }

  private createChunkNeighborhoodItems(chunks: Chunk[]) {
    return chunks.map(chunk => ({
      chunk,
      neighbors: {
        nxm: this.volume.getChunk({ x: chunk.coord.x - 1, y: chunk.coord.y, z: chunk.coord.z }),
        nxp: this.volume.getChunk({ x: chunk.coord.x + 1, y: chunk.coord.y, z: chunk.coord.z }),
        nym: this.volume.getChunk({ x: chunk.coord.x, y: chunk.coord.y - 1, z: chunk.coord.z }),
        nyp: this.volume.getChunk({ x: chunk.coord.x, y: chunk.coord.y + 1, z: chunk.coord.z }),
        nzm: this.volume.getChunk({ x: chunk.coord.x, y: chunk.coord.y, z: chunk.coord.z - 1 }),
        nzp: this.volume.getChunk({ x: chunk.coord.x, y: chunk.coord.y, z: chunk.coord.z + 1 }),
      },
    }));
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
      const mesh = new THREE.Mesh(geometry, this.sculptMaterial);
      mesh.name = `sculpt_chunk_${key}`;
      this.sculptGroup.add(mesh);
      chunkMesh = { mesh, vertexCount: 0 };
      this.chunkMeshes.set(key, chunkMesh);
    }

    const geometry = chunkMesh.mesh.geometry;
    const ib = new THREE.InterleavedBuffer(meshData.interleaved!, 6);
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    geometry.boundingSphere = this.createChunkBoundingSphere(key);
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

  applyMaterial(material: MaterialData): void {
    this.sculptMaterial.color.setRGB(material.color[0], material.color[1], material.color[2]);
    this.sculptMaterial.roughness = material.roughness;
    this.sculptMaterial.metalness = material.metallic;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.activeStrokeHands.clear();
    this.pendingStrokes.clear();
    this.pendingStrokeResets.clear();
    this.pendingRemeshChunkKeys.clear();
    for (const [, chunkMesh] of this.chunkMeshes) {
      this.sculptGroup.remove(chunkMesh.mesh);
      chunkMesh.mesh.geometry.dispose();
    }
    this.chunkMeshes.clear();
    this.sculptMaterial.dispose();
    this.parent.remove(this.sculptGroup);
    this.gpu.destroy();
  }
}
