// WebGPU Compute Pipeline for SDF sculpting
// Optimized: pre-allocated buffer pools, 2 GPU fences per stroke.
//   Fence 1: brush dispatches + SDF readbacks
//   Fence 2: buildPadded + marchingCubes + vertex readbacks (fixed-size)

import type { Chunk } from './chunk';
import type { BrushParams, SculptConfig, MeshData } from './types';
import { EDGE_TABLE, TRI_TABLE } from './marching-tables';

import sdfBrushShader from '../shaders/sdf-brush.compute.wgsl?raw';
import marchingCubesShader from '../shaders/marching-cubes.compute.wgsl?raw';
import buildPaddedShader from '../shaders/build-padded.compute.wgsl?raw';

interface ChunkGPUData {
  sdfBuffer: GPUBuffer;
}

// Max chunks per GPU round (pool slots). Overflow handled by multi-round.
// Sized for: 8 brush chunks + 12 remesh chunks (8 modified + 4 boundary neighbors).
// Memory: 12 × ~5MB = ~60MB total (vertex buffers are 2.3MB each, not 11.8MB).
const MAX_BATCH = 12;

// Realistic max vertices per chunk. Theoretical max is cs^3*15 (491K),
// but real sculpt surfaces rarely exceed 30% cell fill = ~100K vertices.
// This caps GPU pool memory at ~40MB instead of ~183MB.
const MAX_VERTICES_PER_CHUNK = 100_000;

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

  // --- Pre-allocated buffer pools (reused every frame) ---
  // Brush phase
  private brushUniformBuffers: GPUBuffer[] = [];
  private sdfReadbackBuffers: GPUBuffer[] = [];

  // Remesh phase
  private sliceBuffers: GPUBuffer[] = [];
  private paddedBuffers: GPUBuffer[] = [];
  private bpUniformBuffers: GPUBuffer[] = [];
  private mcUniformBuffers: GPUBuffer[] = [];
  private vertexBuffers: GPUBuffer[] = [];
  private counterBuffers: GPUBuffer[] = [];
  private vertexReadbackBuffers: GPUBuffer[] = [];
  private counterReadbackBuffers: GPUBuffer[] = [];

  // Sizes cached from config
  private sdfSize = 0;
  private sliceSize = 0;
  private paddedSize = 0;
  private vertexBufferSize = 0;

  private config: SculptConfig;
  private _ready: boolean = false;

  constructor(config: SculptConfig) {
    this.config = config;
  }

  get ready(): boolean {
    return this._ready;
  }

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
      this.preAllocateBufferPools();

      this._ready = true;
      return true;
    } catch {
      console.warn('[SculptGPU] WebGPU initialization failed');
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

  /**
   * Pre-allocate all reusable GPU buffers at init time.
   * Eliminates per-frame allocation overhead (~20 createBuffer/destroy calls per stroke).
   */
  private preAllocateBufferPools(): void {
    if (!this.device) return;

    const cs = this.config.chunkSize;
    const samples = cs + 1;
    const padded = samples + 2;

    this.sdfSize = samples * samples * samples * 4;
    this.sliceSize = 6 * samples * samples * 4;
    this.paddedSize = padded * padded * padded * 4;
    this.vertexBufferSize = MAX_VERTICES_PER_CHUNK * 6 * 4;

    for (let i = 0; i < MAX_BATCH; i++) {
      // Brush uniforms (80 bytes — expanded for capsule brush)
      this.brushUniformBuffers.push(this.device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }));

      // SDF readback
      this.sdfReadbackBuffers.push(this.device.createBuffer({
        size: this.sdfSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }));

      // Slice buffers (26KB each)
      this.sliceBuffers.push(this.device.createBuffer({
        size: this.sliceSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }));

      // Padded buffers (172KB each, GPU-only)
      this.paddedBuffers.push(this.device.createBuffer({
        size: this.paddedSize,
        usage: GPUBufferUsage.STORAGE,
      }));

      // BuildPadded uniforms (16 bytes)
      this.bpUniformBuffers.push(this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }));

      // MC uniforms (32 bytes)
      this.mcUniformBuffers.push(this.device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }));

      // Vertex output (11.8MB each)
      this.vertexBuffers.push(this.device.createBuffer({
        size: this.vertexBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }));

      // Counter (4 bytes)
      this.counterBuffers.push(this.device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      }));

      // Vertex readback (same max size as vertex buffer)
      this.vertexReadbackBuffers.push(this.device.createBuffer({
        size: this.vertexBufferSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }));

      // Counter readback (4 bytes)
      this.counterReadbackBuffers.push(this.device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }));
    }
  }

  private getChunkBuffer(chunk: Chunk, key: string): ChunkGPUData {
    let gpuData = this.chunkBuffers.get(key);
    if (!gpuData) {
      const buffer = this.device!.createBuffer({
        size: chunk.data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      gpuData = { sdfBuffer: buffer };
      this.chunkBuffers.set(key, gpuData);
    }
    return gpuData;
  }

  /**
   * Apply brush to all chunks. Processes in rounds of MAX_BATCH.
   */
  async applyBrushBatch(chunks: Chunk[], brush: BrushParams): Promise<void> {
    if (!this.device || !this.brushPipeline || chunks.length === 0) return;

    const cs = this.config.chunkSize;
    const vs = this.config.voxelSize;
    const samples = cs + 1;
    const workgroups = Math.ceil(samples / 4);

    for (let offset = 0; offset < chunks.length; offset += MAX_BATCH) {
      const n = Math.min(MAX_BATCH, chunks.length - offset);
      const encoder = this.device.createCommandEncoder();

      for (let i = 0; i < n; i++) {
        const chunk = chunks[offset + i];
        const key = `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`;
        const gpuData = this.getChunkBuffer(chunk, key);

        this.device.queue.writeBuffer(gpuData.sdfBuffer, 0, chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);

        // Pack uniform struct matching WGSL BrushUniforms layout (80 bytes):
        //  0: center (vec3<f32>) + radius (f32)        = 16 bytes
        //  16: strength (f32) + smoothing (f32) + operation (u32) + _pad0 (u32) = 16 bytes
        //  32: prev_center (vec3<f32>) + _pad1 (f32)   = 16 bytes
        //  48: chunk_origin (vec3<f32>) + voxel_size (f32) = 16 bytes
        //  64: samples_per_axis (u32) + _pad2 (3x u32) = 16 bytes
        const uniformData = new ArrayBuffer(80);
        const f32 = new Float32Array(uniformData);
        const u32 = new Uint32Array(uniformData);
        f32[0] = brush.center[0]; f32[1] = brush.center[1]; f32[2] = brush.center[2];
        f32[3] = brush.radius;
        f32[4] = brush.strength; f32[5] = brush.smoothing;
        u32[6] = brush.type === 'add' ? 0 : 1; u32[7] = 0;
        f32[8] = brush.prevCenter![0]; f32[9] = brush.prevCenter![1]; f32[10] = brush.prevCenter![2];
        f32[11] = 0;
        f32[12] = chunk.coord.x * cs * vs; f32[13] = chunk.coord.y * cs * vs;
        f32[14] = chunk.coord.z * cs * vs; f32[15] = vs;
        u32[16] = samples; u32[17] = 0; u32[18] = 0; u32[19] = 0;

        this.device.queue.writeBuffer(this.brushUniformBuffers[i], 0, new Uint8Array(uniformData));

        const bindGroup = this.device.createBindGroup({
          layout: this.brushPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.brushUniformBuffers[i] } },
            { binding: 1, resource: { buffer: gpuData.sdfBuffer } },
          ],
        });

        const pass = encoder.beginComputePass();
        pass.setPipeline(this.brushPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
        pass.end();

        encoder.copyBufferToBuffer(gpuData.sdfBuffer, 0, this.sdfReadbackBuffers[i], 0, this.sdfSize);
      }

      this.device.queue.submit([encoder.finish()]);
      await Promise.all(
        Array.from({ length: n }, (_, i) => this.sdfReadbackBuffers[i].mapAsync(GPUMapMode.READ))
      );

      for (let i = 0; i < n; i++) {
        const result = new Float32Array(this.sdfReadbackBuffers[i].getMappedRange());
        chunks[offset + i].data.set(result);
        this.sdfReadbackBuffers[i].unmap();
      }
    }
  }

  /**
   * Build padded + extract mesh for all chunks. Processes in rounds of MAX_BATCH.
   * Each round: single GPU submission + single fence.
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

    const results: MeshData[] = [];

    for (let offset = 0; offset < items.length; offset += MAX_BATCH) {
      const n = Math.min(MAX_BATCH, items.length - offset);
      const encoder = this.device.createCommandEncoder();

      for (let i = 0; i < n; i++) {
        const { chunk, boundarySlices } = items[offset + i];
        const key = `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`;
        const gpuData = this.getChunkBuffer(chunk, key);

        this.device.queue.writeBuffer(gpuData.sdfBuffer, 0, chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
        this.device.queue.writeBuffer(this.sliceBuffers[i], 0, boundarySlices.buffer, boundarySlices.byteOffset, boundarySlices.byteLength);

        // BuildPadded uniforms
        const bpUniData = new ArrayBuffer(16);
        new Uint32Array(bpUniData, 0, 1)[0] = samples;
        new Float32Array(bpUniData, 4, 1)[0] = this.config.emptyValue;
        this.device.queue.writeBuffer(this.bpUniformBuffers[i], 0, new Uint8Array(bpUniData));

        const bpBG = this.device.createBindGroup({
          layout: this.buildPaddedPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.bpUniformBuffers[i] } },
            { binding: 1, resource: { buffer: gpuData.sdfBuffer } },
            { binding: 2, resource: { buffer: this.sliceBuffers[i] } },
            { binding: 3, resource: { buffer: this.paddedBuffers[i] } },
          ],
        });

        const bpPass = encoder.beginComputePass();
        bpPass.setPipeline(this.buildPaddedPipeline);
        bpPass.setBindGroup(0, bpBG);
        bpPass.dispatchWorkgroups(bpWorkgroups, bpWorkgroups, bpWorkgroups);
        bpPass.end();

        // MC uniforms
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
        this.device.queue.writeBuffer(this.mcUniformBuffers[i], 0, new Float32Array(mcUniData));
        this.device.queue.writeBuffer(this.counterBuffers[i], 0, new Uint32Array([0]));

        const mcBG = this.device.createBindGroup({
          layout: this.mcPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.mcUniformBuffers[i] } },
            { binding: 1, resource: { buffer: this.paddedBuffers[i] } },
            { binding: 2, resource: { buffer: this.edgeTableBuffer } },
            { binding: 3, resource: { buffer: this.triTableBuffer } },
            { binding: 4, resource: { buffer: this.vertexBuffers[i] } },
            { binding: 5, resource: { buffer: this.counterBuffers[i] } },
          ],
        });

        const mcPass = encoder.beginComputePass();
        mcPass.setPipeline(this.mcPipeline);
        mcPass.setBindGroup(0, mcBG);
        mcPass.dispatchWorkgroups(mcWorkgroups, mcWorkgroups, mcWorkgroups);
        mcPass.end();

        encoder.copyBufferToBuffer(this.counterBuffers[i], 0, this.counterReadbackBuffers[i], 0, 4);
        encoder.copyBufferToBuffer(this.vertexBuffers[i], 0, this.vertexReadbackBuffers[i], 0, this.vertexBufferSize);
      }

      // Single submit + fence for this round
      this.device.queue.submit([encoder.finish()]);
      const mapPromises: Promise<void>[] = [];
      for (let i = 0; i < n; i++) {
        mapPromises.push(this.counterReadbackBuffers[i].mapAsync(GPUMapMode.READ));
        mapPromises.push(this.vertexReadbackBuffers[i].mapAsync(GPUMapMode.READ));
      }
      await Promise.all(mapPromises);

      for (let i = 0; i < n; i++) {
        const rawCount = new Uint32Array(this.counterReadbackBuffers[i].getMappedRange())[0];
        this.counterReadbackBuffers[i].unmap();
        const vc = Math.min(rawCount, MAX_VERTICES_PER_CHUNK);

        if (vc === 0) {
          this.vertexReadbackBuffers[i].unmap();
          results.push({ positions: new Float32Array(0), normals: new Float32Array(0), vertexCount: 0 });
          continue;
        }

        // Copy interleaved data directly — no de-interleave.
        // getMappedRange is a shared view, so we must copy before unmap.
        const fullRange = this.vertexReadbackBuffers[i].getMappedRange();
        const interleaved = new Float32Array(vc * 6);
        interleaved.set(new Float32Array(fullRange, 0, vc * 6));
        this.vertexReadbackBuffers[i].unmap();
        results.push({ positions: new Float32Array(0), normals: new Float32Array(0), interleaved, vertexCount: vc });
      }
    }

    return results;
  }

  releaseChunk(key: string): void {
    const gpuData = this.chunkBuffers.get(key);
    if (gpuData) {
      gpuData.sdfBuffer.destroy();
      this.chunkBuffers.delete(key);
    }
  }

  destroy(): void {
    for (const [, gpuData] of this.chunkBuffers) {
      gpuData.sdfBuffer.destroy();
    }
    this.chunkBuffers.clear();

    // Destroy pooled buffers
    const pools = [
      this.brushUniformBuffers, this.sdfReadbackBuffers,
      this.sliceBuffers, this.paddedBuffers,
      this.bpUniformBuffers, this.mcUniformBuffers,
      this.vertexBuffers, this.counterBuffers,
      this.vertexReadbackBuffers, this.counterReadbackBuffers,
    ];
    for (const pool of pools) {
      for (const buf of pool) buf.destroy();
      pool.length = 0;
    }

    this.edgeTableBuffer?.destroy();
    this.triTableBuffer?.destroy();
    this.device?.destroy();
    this._ready = false;
  }
}
