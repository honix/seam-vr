// WebGPU Compute Pipeline for SDF sculpting
// Batched GPU operations — all chunks processed in minimal submissions:
//   Fence 1: brush dispatches + SDF readbacks (all chunks)
//   Fence 2: buildPadded + marchingCubes + counter readbacks (all chunks)
//   Fence 3: vertex data readbacks (all non-empty chunks)
// Total: 3 GPU fences per stroke regardless of chunk count.

import type { Chunk } from './chunk';
import type { BrushParams, SculptConfig, MeshData } from './types';
import { EDGE_TABLE, TRI_TABLE } from './marching-tables';

import sdfBrushShader from '../shaders/sdf-brush.compute.wgsl?raw';
import marchingCubesShader from '../shaders/marching-cubes.compute.wgsl?raw';
import buildPaddedShader from '../shaders/build-padded.compute.wgsl?raw';

interface ChunkGPUData {
  sdfBuffer: GPUBuffer;
  needsUpload: boolean;
}

export class GPUCompute {
  private device: GPUDevice | null = null;
  private brushPipeline: GPUComputePipeline | null = null;
  private mcPipeline: GPUComputePipeline | null = null;
  private buildPaddedPipeline: GPUComputePipeline | null = null;

  // Shared resources
  private edgeTableBuffer: GPUBuffer | null = null;
  private triTableBuffer: GPUBuffer | null = null;

  // Per-chunk GPU buffers (persist across frames)
  private chunkBuffers: Map<string, ChunkGPUData> = new Map();

  private config: SculptConfig;
  private _ready: boolean = false;

  constructor(config: SculptConfig) {
    this.config = config;
  }

  get ready(): boolean {
    return this._ready;
  }

  /**
   * Initialize WebGPU device and compile shaders.
   * Returns false if WebGPU is unavailable.
   */
  async init(): Promise<boolean> {
    if (!navigator.gpu) return false;

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;

      this.device = await adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: 256 * 1024 * 1024,
          maxBufferSize: 256 * 1024 * 1024,
        },
      });

      this.createLookupTableBuffers();
      await this.createPipelines();

      this._ready = true;
      return true;
    } catch {
      console.warn('[SculptGPU] WebGPU initialization failed, using CPU fallback');
      return false;
    }
  }

  private createLookupTableBuffers(): void {
    if (!this.device) return;

    const edgeData = new Uint32Array(EDGE_TABLE);
    this.edgeTableBuffer = this.device.createBuffer({
      size: edgeData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.edgeTableBuffer, 0, edgeData);

    const triData = new Int32Array(TRI_TABLE);
    this.triTableBuffer = this.device.createBuffer({
      size: triData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.triTableBuffer, 0, triData);
  }

  private async createPipelines(): Promise<void> {
    if (!this.device) return;

    const brushModule = this.device.createShaderModule({ code: sdfBrushShader });
    this.brushPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: brushModule, entryPoint: 'main' },
    });

    const mcModule = this.device.createShaderModule({ code: marchingCubesShader });
    this.mcPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: mcModule, entryPoint: 'main' },
    });

    const bpModule = this.device.createShaderModule({ code: buildPaddedShader });
    this.buildPaddedPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: bpModule, entryPoint: 'main' },
    });
  }

  private getChunkBuffer(chunk: Chunk, key: string): ChunkGPUData {
    let gpuData = this.chunkBuffers.get(key);
    if (!gpuData) {
      const buffer = this.device!.createBuffer({
        size: chunk.data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      gpuData = { sdfBuffer: buffer, needsUpload: true };
      this.chunkBuffers.set(key, gpuData);
    }
    return gpuData;
  }

  /**
   * Apply brush to all chunks in a single GPU submission.
   * One fence for all readbacks instead of one fence per chunk.
   */
  async applyBrushBatch(chunks: Chunk[], brush: BrushParams): Promise<void> {
    if (!this.device || !this.brushPipeline || chunks.length === 0) return;

    const cs = this.config.chunkSize;
    const vs = this.config.voxelSize;
    const samples = cs + 1;
    const workgroups = Math.ceil(samples / 4);

    const encoder = this.device.createCommandEncoder();
    const readbacks: GPUBuffer[] = [];
    const tempBuffers: GPUBuffer[] = [];

    for (const chunk of chunks) {
      const key = `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`;
      const gpuData = this.getChunkBuffer(chunk, key);

      // Upload current SDF
      this.device.queue.writeBuffer(gpuData.sdfBuffer, 0, chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);

      // Brush uniforms
      const uniformData = new ArrayBuffer(64);
      const f32 = new Float32Array(uniformData);
      const u32 = new Uint32Array(uniformData);
      f32[0] = brush.center[0];
      f32[1] = brush.center[1];
      f32[2] = brush.center[2];
      f32[3] = brush.radius;
      f32[4] = brush.strength;
      f32[5] = brush.smoothing;
      u32[6] = brush.type === 'add' ? 0 : 1;
      f32[7] = 0;
      f32[8] = chunk.coord.x * cs * vs;
      f32[9] = chunk.coord.y * cs * vs;
      f32[10] = chunk.coord.z * cs * vs;
      f32[11] = vs;
      u32[12] = samples;
      u32[13] = 0;

      const uniformBuffer = this.device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(uniformData));
      tempBuffers.push(uniformBuffer);

      // Dispatch brush compute
      const bindGroup = this.device.createBindGroup({
        layout: this.brushPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: gpuData.sdfBuffer } },
        ],
      });

      const pass = encoder.beginComputePass();
      pass.setPipeline(this.brushPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
      pass.end();

      // Stage readback
      const readbackBuffer = this.device.createBuffer({
        size: chunk.data.byteLength,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      encoder.copyBufferToBuffer(gpuData.sdfBuffer, 0, readbackBuffer, 0, chunk.data.byteLength);
      readbacks.push(readbackBuffer);
    }

    // --- Single submit, single fence ---
    this.device.queue.submit([encoder.finish()]);
    await Promise.all(readbacks.map(b => b.mapAsync(GPUMapMode.READ)));

    // Copy all results back to CPU
    for (let i = 0; i < chunks.length; i++) {
      const result = new Float32Array(readbacks[i].getMappedRange());
      chunks[i].data.set(result);
      readbacks[i].unmap();
      readbacks[i].destroy();
    }

    for (const buf of tempBuffers) buf.destroy();
  }

  /**
   * Build padded buffers + extract meshes for all chunks in two GPU submissions.
   * Fence 1: all compute work + counter readbacks.
   * Fence 2: vertex data readbacks (sizes known from counters).
   */
  async buildPaddedAndExtractBatch(
    items: { chunk: Chunk; boundarySlices: Float32Array }[]
  ): Promise<MeshData[]> {
    if (!this.device || !this.buildPaddedPipeline || !this.mcPipeline ||
        !this.edgeTableBuffer || !this.triTableBuffer || items.length === 0) {
      return items.map(() => ({ positions: new Float32Array(0), normals: new Float32Array(0), vertexCount: 0 }));
    }

    const cs = this.config.chunkSize;
    const vs = this.config.voxelSize;
    const samples = cs + 1;
    const padded = samples + 2;
    const bpWorkgroups = Math.ceil(padded / 4);
    const mcWorkgroups = Math.ceil(cs / 4);
    const maxVertices = cs * cs * cs * 15;
    const vertexBufferSize = maxVertices * 6 * 4;

    const encoder = this.device.createCommandEncoder();
    const tempBuffers: GPUBuffer[] = [];
    const perChunk: { vertexBuffer: GPUBuffer; counterBuffer: GPUBuffer }[] = [];

    for (const { chunk, boundarySlices } of items) {
      const key = `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`;
      const gpuData = this.getChunkBuffer(chunk, key);

      // Upload SDF (may be stale after CPU syncBoundaries)
      this.device.queue.writeBuffer(gpuData.sdfBuffer, 0, chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);

      // Upload boundary slices
      const sliceBuffer = this.device.createBuffer({
        size: boundarySlices.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(sliceBuffer, 0, boundarySlices.buffer, boundarySlices.byteOffset, boundarySlices.byteLength);
      tempBuffers.push(sliceBuffer);

      // Padded output buffer (GPU-only)
      const paddedBuffer = this.device.createBuffer({
        size: padded * padded * padded * 4,
        usage: GPUBufferUsage.STORAGE,
      });
      tempBuffers.push(paddedBuffer);

      // --- BuildPadded ---
      const bpUniData = new ArrayBuffer(16);
      new Uint32Array(bpUniData, 0, 1)[0] = samples;
      new Float32Array(bpUniData, 4, 1)[0] = this.config.emptyValue;
      const bpUniBuf = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(bpUniBuf, 0, new Uint8Array(bpUniData));
      tempBuffers.push(bpUniBuf);

      const bpBG = this.device.createBindGroup({
        layout: this.buildPaddedPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: bpUniBuf } },
          { binding: 1, resource: { buffer: gpuData.sdfBuffer } },
          { binding: 2, resource: { buffer: sliceBuffer } },
          { binding: 3, resource: { buffer: paddedBuffer } },
        ],
      });

      const bpPass = encoder.beginComputePass();
      bpPass.setPipeline(this.buildPaddedPipeline);
      bpPass.setBindGroup(0, bpBG);
      bpPass.dispatchWorkgroups(bpWorkgroups, bpWorkgroups, bpWorkgroups);
      bpPass.end();

      // --- MarchingCubes ---
      const mcUniData = new ArrayBuffer(32);
      const mcF32 = new Float32Array(mcUniData);
      const mcU32 = new Uint32Array(mcUniData);
      mcF32[0] = chunk.coord.x * cs * vs;
      mcF32[1] = chunk.coord.y * cs * vs;
      mcF32[2] = chunk.coord.z * cs * vs;
      mcF32[3] = vs;
      mcU32[4] = cs;
      mcU32[5] = samples;
      mcF32[6] = 0.0;
      mcU32[7] = padded;

      const mcUniBuf = this.device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(mcUniBuf, 0, new Float32Array(mcUniData));
      tempBuffers.push(mcUniBuf);

      const vertexBuffer = this.device.createBuffer({
        size: vertexBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const counterBuffer = this.device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(counterBuffer, 0, new Uint32Array([0]));
      perChunk.push({ vertexBuffer, counterBuffer });

      const mcBG = this.device.createBindGroup({
        layout: this.mcPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: mcUniBuf } },
          { binding: 1, resource: { buffer: paddedBuffer } },
          { binding: 2, resource: { buffer: this.edgeTableBuffer } },
          { binding: 3, resource: { buffer: this.triTableBuffer } },
          { binding: 4, resource: { buffer: vertexBuffer } },
          { binding: 5, resource: { buffer: counterBuffer } },
        ],
      });

      const mcPass = encoder.beginComputePass();
      mcPass.setPipeline(this.mcPipeline);
      mcPass.setBindGroup(0, mcBG);
      mcPass.dispatchWorkgroups(mcWorkgroups, mcWorkgroups, mcWorkgroups);
      mcPass.end();
    }

    // Stage all counter readbacks
    const counterRBs: GPUBuffer[] = [];
    for (const { counterBuffer } of perChunk) {
      const rb = this.device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      encoder.copyBufferToBuffer(counterBuffer, 0, rb, 0, 4);
      counterRBs.push(rb);
    }

    // --- Submit 1: all compute + counter readbacks ---
    this.device.queue.submit([encoder.finish()]);

    // --- Fence 1: all counters resolve in parallel ---
    await Promise.all(counterRBs.map(rb => rb.mapAsync(GPUMapMode.READ)));

    const vertexCounts: number[] = counterRBs.map(rb => {
      const count = new Uint32Array(rb.getMappedRange())[0];
      rb.unmap();
      rb.destroy();
      return count;
    });

    // Stage vertex readbacks for non-empty chunks
    const encoder2 = this.device.createCommandEncoder();
    const vertexRBs: { buffer: GPUBuffer; index: number }[] = [];

    for (let i = 0; i < items.length; i++) {
      if (vertexCounts[i] === 0) continue;
      const readSize = vertexCounts[i] * 6 * 4;
      const rb = this.device.createBuffer({
        size: readSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      encoder2.copyBufferToBuffer(perChunk[i].vertexBuffer, 0, rb, 0, readSize);
      vertexRBs.push({ buffer: rb, index: i });
    }

    if (vertexRBs.length > 0) {
      // --- Submit 2: vertex readbacks ---
      this.device.queue.submit([encoder2.finish()]);

      // --- Fence 2: all vertex data resolves in parallel ---
      await Promise.all(vertexRBs.map(vr => vr.buffer.mapAsync(GPUMapMode.READ)));
    }

    // Build results
    const results: MeshData[] = items.map(() => ({
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      vertexCount: 0,
    }));

    for (const { buffer, index } of vertexRBs) {
      const vc = vertexCounts[index];
      const vertexData = new Float32Array(buffer.getMappedRange().slice(0));
      buffer.unmap();
      buffer.destroy();

      // Split interleaved [pos, normal] into separate arrays for Three.js
      const positions = new Float32Array(vc * 3);
      const normals = new Float32Array(vc * 3);
      for (let i = 0; i < vc; i++) {
        const s = i * 6;
        const d = i * 3;
        positions[d] = vertexData[s];
        positions[d + 1] = vertexData[s + 1];
        positions[d + 2] = vertexData[s + 2];
        normals[d] = vertexData[s + 3];
        normals[d + 1] = vertexData[s + 4];
        normals[d + 2] = vertexData[s + 5];
      }
      results[index] = { positions, normals, vertexCount: vc };
    }

    // Cleanup
    for (const { vertexBuffer, counterBuffer } of perChunk) {
      vertexBuffer.destroy();
      counterBuffer.destroy();
    }
    for (const buf of tempBuffers) buf.destroy();

    return results;
  }

  /**
   * Release a chunk's GPU buffers
   */
  releaseChunk(key: string): void {
    const gpuData = this.chunkBuffers.get(key);
    if (gpuData) {
      gpuData.sdfBuffer.destroy();
      this.chunkBuffers.delete(key);
    }
  }

  /**
   * Destroy all GPU resources
   */
  destroy(): void {
    for (const [, gpuData] of this.chunkBuffers) {
      gpuData.sdfBuffer.destroy();
    }
    this.chunkBuffers.clear();
    this.edgeTableBuffer?.destroy();
    this.triTableBuffer?.destroy();
    this.device?.destroy();
    this._ready = false;
  }
}
