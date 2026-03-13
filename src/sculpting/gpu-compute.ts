// WebGPU Compute Pipeline for SDF sculpting
// Optimized: pre-allocated buffer pools, 2 GPU fences per stroke.
//   Fence 1: brush dispatches + SDF readbacks
//   Fence 2: buildPadded + marchingCubes + vertex readbacks (fixed-size)

import type { Chunk } from './chunk';
import type { BrushParams, ChunkCoord, SculptConfig, MeshData } from './types';
import { EDGE_TABLE, TRI_TABLE } from './marching-tables';

import sdfBrushShader from '../shaders/sdf-brush.compute.wgsl?raw';
import sdfSmoothShader from '../shaders/sdf-smooth.compute.wgsl?raw';
import marchingCubesShader from '../shaders/marching-cubes.compute.wgsl?raw';
import buildPaddedShader from '../shaders/build-padded.compute.wgsl?raw';

interface ChunkGPUData {
  sdfBuffer: GPUBuffer;
  initialized: boolean;
  cpuDirty: boolean;
  gpuDirty: boolean;
}

// Max chunks per GPU round (pool slots). Overflow handled by multi-round.
// Keep this modest because each clay node owns a full pool and browser refreshes
// can lag in reclaiming GPU memory.
const MAX_BATCH = 6;

// Realistic max vertices per chunk. Theoretical max is cs^3*15 (491K),
// but real sculpt surfaces rarely exceed 30% cell fill = ~100K vertices.
// This caps GPU pool memory at ~40MB instead of ~183MB.
const MAX_VERTICES_PER_CHUNK = 100_000;
const WORKGROUP_SIZE_X = 8;
const WORKGROUP_SIZE_Y = 4;
const WORKGROUP_SIZE_Z = 4;

export class GPUCompute {
  private device: GPUDevice | null = null;
  private brushPipeline: GPUComputePipeline | null = null;
  private smoothPipeline: GPUComputePipeline | null = null;
  private mcPipeline: GPUComputePipeline | null = null;
  private buildPaddedPipeline: GPUComputePipeline | null = null;

  // Shared resources
  private edgeTableBuffer: GPUBuffer | null = null;
  private triTableBuffer: GPUBuffer | null = null;
  private emptyChunkBuffer: GPUBuffer | null = null;

  // Per-chunk GPU buffers (persist across frames)
  private chunkBuffers: Map<string, ChunkGPUData> = new Map();

  // --- Pre-allocated buffer pools (reused every frame) ---
  // Brush phase
  private brushUniformBuffers: GPUBuffer[] = [];
  private sdfReadbackBuffers: GPUBuffer[] = [];
  // Smooth phase temp output buffers. Per-chunk sdfBuffer stays as the stable source snapshot.
  private smoothOutputBuffers: GPUBuffer[] = [];

  // Remesh phase
  private paddedBuffers: GPUBuffer[] = [];
  private bpUniformBuffers: GPUBuffer[] = [];
  private mcUniformBuffers: GPUBuffer[] = [];
  private vertexBuffers: GPUBuffer[] = [];
  private counterBuffers: GPUBuffer[] = [];
  private vertexReadbackBuffers: GPUBuffer[] = [];
  private counterReadbackBuffers: GPUBuffer[] = [];

  // Sizes cached from config
  private sdfSize = 0;
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

    const smoothModule = this.device.createShaderModule({ code: sdfSmoothShader });
    this.smoothPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: smoothModule, entryPoint: 'main' },
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
    this.paddedSize = padded * padded * padded * 4;
    this.vertexBufferSize = MAX_VERTICES_PER_CHUNK * 6 * 4;

    this.emptyChunkBuffer = this.device.createBuffer({
      size: this.sdfSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.emptyChunkBuffer, 0, new Float32Array(samples * samples * samples).fill(this.config.emptyValue));

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

      // Smooth output buffer for seam-aware smoothing results
      this.smoothOutputBuffers.push(this.device.createBuffer({
        size: this.sdfSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
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

      // Vertex output (~2.4MB each with current MAX_VERTICES_PER_CHUNK)
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
      gpuData = { sdfBuffer: buffer, initialized: false, cpuDirty: false, gpuDirty: false };
      this.chunkBuffers.set(key, gpuData);
    }
    return gpuData;
  }

  private ensureChunkUploaded(chunk: Chunk, key: string): ChunkGPUData {
    const gpuData = this.getChunkBuffer(chunk, key);
    if (!gpuData.initialized || gpuData.cpuDirty) {
      this.device!.queue.writeBuffer(
        gpuData.sdfBuffer,
        0,
        chunk.data.buffer,
        chunk.data.byteOffset,
        chunk.data.byteLength
      );
      gpuData.initialized = true;
      gpuData.cpuDirty = false;
      gpuData.gpuDirty = false;
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
    const workgroupsX = Math.ceil(samples / WORKGROUP_SIZE_X);
    const workgroupsY = Math.ceil(samples / WORKGROUP_SIZE_Y);
    const workgroupsZ = Math.ceil(samples / WORKGROUP_SIZE_Z);

    for (let offset = 0; offset < chunks.length; offset += MAX_BATCH) {
      const n = Math.min(MAX_BATCH, chunks.length - offset);
      const encoder = this.device.createCommandEncoder();

      for (let i = 0; i < n; i++) {
        const chunk = chunks[offset + i];
        const key = `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`;
        const gpuData = this.ensureChunkUploaded(chunk, key);

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
        pass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
        pass.end();
        gpuData.gpuDirty = true;
      }

      this.device.queue.submit([encoder.finish()]);
    }
  }

  /**
   * Apply Laplacian smooth to all chunks. Processes in rounds of MAX_BATCH.
   * Reads from a stable per-chunk source snapshot and writes into per-batch temp output buffers.
   */
  async applySmoothBatch(
    items: {
      chunk: Chunk;
      neighbors: {
        nxm?: Chunk;
        nxp?: Chunk;
        nym?: Chunk;
        nyp?: Chunk;
        nzm?: Chunk;
        nzp?: Chunk;
      };
    }[],
    brush: BrushParams
  ): Promise<void> {
    if (!this.device || !this.smoothPipeline || !this.buildPaddedPipeline ||
        !this.emptyChunkBuffer || items.length === 0) return;

    const cs = this.config.chunkSize;
    const vs = this.config.voxelSize;
    const samples = cs + 1;
    const padded = samples + 2;
    const workgroupsX = Math.ceil(samples / WORKGROUP_SIZE_X);
    const workgroupsY = Math.ceil(samples / WORKGROUP_SIZE_Y);
    const workgroupsZ = Math.ceil(samples / WORKGROUP_SIZE_Z);
    const bpWorkgroupsX = Math.ceil(padded / WORKGROUP_SIZE_X);
    const bpWorkgroupsY = Math.ceil(padded / WORKGROUP_SIZE_Y);
    const bpWorkgroupsZ = Math.ceil(padded / WORKGROUP_SIZE_Z);

    const sourceBuffers = new Map<string, GPUBuffer>();
    const uploadSnapshot = (chunk: Chunk | undefined): GPUBuffer | null => {
      if (!chunk) return null;
      const key = `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`;
      const existing = sourceBuffers.get(key);
      if (existing) return existing;

      const gpuData = this.ensureChunkUploaded(chunk, key);
      sourceBuffers.set(key, gpuData.sdfBuffer);
      return gpuData.sdfBuffer;
    };

    for (const item of items) {
      uploadSnapshot(item.chunk);
      uploadSnapshot(item.neighbors.nxm);
      uploadSnapshot(item.neighbors.nxp);
      uploadSnapshot(item.neighbors.nym);
      uploadSnapshot(item.neighbors.nyp);
      uploadSnapshot(item.neighbors.nzm);
      uploadSnapshot(item.neighbors.nzp);
    }

    for (let offset = 0; offset < items.length; offset += MAX_BATCH) {
      const n = Math.min(MAX_BATCH, items.length - offset);
      const encoder = this.device.createCommandEncoder();
      const bpBindGroups: GPUBindGroup[] = [];
      const smoothBindGroups: GPUBindGroup[] = [];

      for (let i = 0; i < n; i++) {
        const { chunk, neighbors } = items[offset + i];
        const key = `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`;
        const center = sourceBuffers.get(key)!;
        const nxm = neighbors.nxm
          ? sourceBuffers.get(`${neighbors.nxm.coord.x},${neighbors.nxm.coord.y},${neighbors.nxm.coord.z}`)!
          : this.emptyChunkBuffer;
        const nxp = neighbors.nxp
          ? sourceBuffers.get(`${neighbors.nxp.coord.x},${neighbors.nxp.coord.y},${neighbors.nxp.coord.z}`)!
          : this.emptyChunkBuffer;
        const nym = neighbors.nym
          ? sourceBuffers.get(`${neighbors.nym.coord.x},${neighbors.nym.coord.y},${neighbors.nym.coord.z}`)!
          : this.emptyChunkBuffer;
        const nyp = neighbors.nyp
          ? sourceBuffers.get(`${neighbors.nyp.coord.x},${neighbors.nyp.coord.y},${neighbors.nyp.coord.z}`)!
          : this.emptyChunkBuffer;
        const nzm = neighbors.nzm
          ? sourceBuffers.get(`${neighbors.nzm.coord.x},${neighbors.nzm.coord.y},${neighbors.nzm.coord.z}`)!
          : this.emptyChunkBuffer;
        const nzp = neighbors.nzp
          ? sourceBuffers.get(`${neighbors.nzp.coord.x},${neighbors.nzp.coord.y},${neighbors.nzp.coord.z}`)!
          : this.emptyChunkBuffer;

        // Pack uniform struct matching WGSL BrushUniforms layout (80 bytes)
        const uniformData = new ArrayBuffer(80);
        const f32 = new Float32Array(uniformData);
        const u32 = new Uint32Array(uniformData);
        f32[0] = brush.center[0]; f32[1] = brush.center[1]; f32[2] = brush.center[2];
        f32[3] = brush.radius;
        f32[4] = brush.strength; f32[5] = brush.smoothing;
        u32[6] = 0; u32[7] = 0; // operation unused for smooth
        f32[8] = brush.prevCenter![0]; f32[9] = brush.prevCenter![1]; f32[10] = brush.prevCenter![2];
        f32[11] = 0;
        f32[12] = chunk.coord.x * cs * vs; f32[13] = chunk.coord.y * cs * vs;
        f32[14] = chunk.coord.z * cs * vs; f32[15] = vs;
        u32[16] = samples; u32[17] = 0; u32[18] = 0; u32[19] = 0;

        this.device.queue.writeBuffer(this.brushUniformBuffers[i], 0, new Uint8Array(uniformData));

        const bpUniData = new ArrayBuffer(16);
        new Uint32Array(bpUniData, 0, 1)[0] = samples;
        new Float32Array(bpUniData, 4, 1)[0] = this.config.emptyValue;
        this.device.queue.writeBuffer(this.bpUniformBuffers[i], 0, new Uint8Array(bpUniData));

        bpBindGroups.push(this.device.createBindGroup({
          layout: this.buildPaddedPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.bpUniformBuffers[i] } },
            { binding: 1, resource: { buffer: center } },
            { binding: 2, resource: { buffer: nxm } },
            { binding: 3, resource: { buffer: nxp } },
            { binding: 4, resource: { buffer: nym } },
            { binding: 5, resource: { buffer: nyp } },
            { binding: 6, resource: { buffer: nzm } },
            { binding: 7, resource: { buffer: nzp } },
            { binding: 8, resource: { buffer: this.paddedBuffers[i] } },
          ],
        }));

        smoothBindGroups.push(this.device.createBindGroup({
          layout: this.smoothPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.brushUniformBuffers[i] } },
            { binding: 1, resource: { buffer: this.paddedBuffers[i] } },
            { binding: 2, resource: { buffer: this.smoothOutputBuffers[i] } },
          ],
        }));
      }

      const bpPass = encoder.beginComputePass();
      bpPass.setPipeline(this.buildPaddedPipeline);
      for (let i = 0; i < n; i++) {
        bpPass.setBindGroup(0, bpBindGroups[i]);
        bpPass.dispatchWorkgroups(bpWorkgroupsX, bpWorkgroupsY, bpWorkgroupsZ);
      }
      bpPass.end();

      const smoothPass = encoder.beginComputePass();
      smoothPass.setPipeline(this.smoothPipeline);
      for (let i = 0; i < n; i++) {
        smoothPass.setBindGroup(0, smoothBindGroups[i]);
        smoothPass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
      }
      smoothPass.end();

      for (let i = 0; i < n; i++) {
        const chunk = items[offset + i].chunk;
        const gpuData = this.getChunkBuffer(chunk, `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`);
        encoder.copyBufferToBuffer(this.smoothOutputBuffers[i], 0, gpuData.sdfBuffer, 0, this.sdfSize);
        gpuData.gpuDirty = true;
      }

      this.device.queue.submit([encoder.finish()]);
    }
  }

  async syncBoundaryFaces(
    modifiedChunks: Chunk[],
    getChunk: (coord: ChunkCoord) => Chunk | undefined,
  ): Promise<Chunk[]> {
    if (!this.device || modifiedChunks.length === 0) return [];

    const samples = this.config.chunkSize + 1;
    const sampleBytes = 4;
    const planeBytes = samples * sampleBytes;
    const slabBytes = samples * samples * sampleBytes;
    const modifiedKeys = new Set(modifiedChunks.map((chunk) => `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`));
    const extraChunks: Chunk[] = [];
    const seen = new Set<string>();
    const encoder = this.device.createCommandEncoder();
    let copyCount = 0;

    const queueRemesh = (chunk: Chunk, key: string) => {
      chunk.dirty = true;
      if (!modifiedKeys.has(key) && !seen.has(key)) {
        extraChunks.push(chunk);
      }
      seen.add(key);
    };

    const copyFace = (
      source: Chunk,
      target: Chunk,
      axis: 'x' | 'y' | 'z',
      sourceIndex: number,
      targetIndex: number,
    ) => {
      const sourceKey = `${source.coord.x},${source.coord.y},${source.coord.z}`;
      const targetKey = `${target.coord.x},${target.coord.y},${target.coord.z}`;
      const sourceBuffer = this.ensureChunkUploaded(source, sourceKey).sdfBuffer;
      const targetData = this.ensureChunkUploaded(target, targetKey);

      if (axis === 'x') {
        for (let iz = 0; iz < samples; iz++) {
          for (let iy = 0; iy < samples; iy++) {
            const sourceOffset = ((iz * samples * samples) + (iy * samples) + sourceIndex) * sampleBytes;
            const targetOffset = ((iz * samples * samples) + (iy * samples) + targetIndex) * sampleBytes;
            encoder.copyBufferToBuffer(sourceBuffer, sourceOffset, targetData.sdfBuffer, targetOffset, sampleBytes);
            copyCount += 1;
          }
        }
      } else if (axis === 'y') {
        for (let iz = 0; iz < samples; iz++) {
          const sourceOffset = ((iz * samples * samples) + (sourceIndex * samples)) * sampleBytes;
          const targetOffset = ((iz * samples * samples) + (targetIndex * samples)) * sampleBytes;
          encoder.copyBufferToBuffer(sourceBuffer, sourceOffset, targetData.sdfBuffer, targetOffset, planeBytes);
          copyCount += 1;
        }
      } else {
        const sourceOffset = sourceIndex * slabBytes;
        const targetOffset = targetIndex * slabBytes;
        encoder.copyBufferToBuffer(sourceBuffer, sourceOffset, targetData.sdfBuffer, targetOffset, slabBytes);
        copyCount += 1;
      }

      targetData.gpuDirty = true;
    };

    for (const chunk of modifiedChunks) {
      const { x, y, z } = chunk.coord;

      const nxpKey = `${x + 1},${y},${z}`;
      const nxp = getChunk({ x: x + 1, y, z });
      if (nxp) {
        copyFace(chunk, nxp, 'x', this.config.chunkSize, 0);
        queueRemesh(nxp, nxpKey);
      }

      const nypKey = `${x},${y + 1},${z}`;
      const nyp = getChunk({ x, y: y + 1, z });
      if (nyp) {
        copyFace(chunk, nyp, 'y', this.config.chunkSize, 0);
        queueRemesh(nyp, nypKey);
      }

      const nzpKey = `${x},${y},${z + 1}`;
      const nzp = getChunk({ x, y, z: z + 1 });
      if (nzp) {
        copyFace(chunk, nzp, 'z', this.config.chunkSize, 0);
        queueRemesh(nzp, nzpKey);
      }

      const nxmKey = `${x - 1},${y},${z}`;
      if (!modifiedKeys.has(nxmKey)) {
        const nxm = getChunk({ x: x - 1, y, z });
        if (nxm) {
          copyFace(chunk, nxm, 'x', 0, this.config.chunkSize);
          queueRemesh(nxm, nxmKey);
        }
      }

      const nymKey = `${x},${y - 1},${z}`;
      if (!modifiedKeys.has(nymKey)) {
        const nym = getChunk({ x, y: y - 1, z });
        if (nym) {
          copyFace(chunk, nym, 'y', 0, this.config.chunkSize);
          queueRemesh(nym, nymKey);
        }
      }

      const nzmKey = `${x},${y},${z - 1}`;
      if (!modifiedKeys.has(nzmKey)) {
        const nzm = getChunk({ x, y, z: z - 1 });
        if (nzm) {
          copyFace(chunk, nzm, 'z', 0, this.config.chunkSize);
          queueRemesh(nzm, nzmKey);
        }
      }
    }

    if (copyCount > 0) {
      this.device.queue.submit([encoder.finish()]);
    }

    return extraChunks;
  }

  async syncChunksToCPU(chunks: Chunk[]): Promise<void> {
    if (!this.device || chunks.length === 0) return;

    for (let offset = 0; offset < chunks.length; offset += MAX_BATCH) {
      const batch = chunks.slice(offset, offset + MAX_BATCH);
      const encoder = this.device.createCommandEncoder();
      const synced: Array<{ chunk: Chunk; gpuData: ChunkGPUData; readbackIndex: number }> = [];

      for (let i = 0; i < batch.length; i++) {
        const chunk = batch[i];
        const key = `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`;
        const gpuData = this.chunkBuffers.get(key);
        if (!gpuData || !gpuData.initialized || !gpuData.gpuDirty) {
          continue;
        }

        encoder.copyBufferToBuffer(gpuData.sdfBuffer, 0, this.sdfReadbackBuffers[synced.length], 0, this.sdfSize);
        synced.push({ chunk, gpuData, readbackIndex: synced.length });
      }

      if (synced.length === 0) {
        continue;
      }

      this.device.queue.submit([encoder.finish()]);
      await Promise.all(
        synced.map(({ readbackIndex }) => this.sdfReadbackBuffers[readbackIndex].mapAsync(GPUMapMode.READ)),
      );

      for (const { chunk, gpuData, readbackIndex } of synced) {
        const result = new Float32Array(this.sdfReadbackBuffers[readbackIndex].getMappedRange());
        chunk.data.set(result);
        this.sdfReadbackBuffers[readbackIndex].unmap();
        gpuData.gpuDirty = false;
      }
    }
  }

  /**
   * Build padded + extract mesh for all chunks. Processes in rounds of MAX_BATCH.
   * Each round: single GPU submission + single fence.
   */
  async buildPaddedAndExtractBatch(
    items: {
      chunk: Chunk;
      neighbors: {
        nxm?: Chunk;
        nxp?: Chunk;
        nym?: Chunk;
        nyp?: Chunk;
        nzm?: Chunk;
        nzp?: Chunk;
      };
    }[]
  ): Promise<MeshData[]> {
    if (!this.device || !this.buildPaddedPipeline || !this.mcPipeline ||
        !this.edgeTableBuffer || !this.triTableBuffer || !this.emptyChunkBuffer || items.length === 0) {
      return items.map(() => ({ vertexCount: 0 }));
    }

    const cs = this.config.chunkSize;
    const vs = this.config.voxelSize;
    const samples = cs + 1;
    const padded = samples + 2;
    const bpWorkgroupsX = Math.ceil(padded / WORKGROUP_SIZE_X);
    const bpWorkgroupsY = Math.ceil(padded / WORKGROUP_SIZE_Y);
    const bpWorkgroupsZ = Math.ceil(padded / WORKGROUP_SIZE_Z);
    const mcWorkgroupsX = Math.ceil(cs / WORKGROUP_SIZE_X);
    const mcWorkgroupsY = Math.ceil(cs / WORKGROUP_SIZE_Y);
    const mcWorkgroupsZ = Math.ceil(cs / WORKGROUP_SIZE_Z);

    const results: MeshData[] = [];

    for (let offset = 0; offset < items.length; offset += MAX_BATCH) {
      const n = Math.min(MAX_BATCH, items.length - offset);
      const encoder = this.device.createCommandEncoder();

      for (let i = 0; i < n; i++) {
        const { chunk, neighbors } = items[offset + i];
        const key = `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`;
        const gpuData = this.ensureChunkUploaded(chunk, key);

        const nxm = neighbors.nxm
          ? this.ensureChunkUploaded(neighbors.nxm, `${neighbors.nxm.coord.x},${neighbors.nxm.coord.y},${neighbors.nxm.coord.z}`).sdfBuffer
          : this.emptyChunkBuffer;
        const nxp = neighbors.nxp
          ? this.ensureChunkUploaded(neighbors.nxp, `${neighbors.nxp.coord.x},${neighbors.nxp.coord.y},${neighbors.nxp.coord.z}`).sdfBuffer
          : this.emptyChunkBuffer;
        const nym = neighbors.nym
          ? this.ensureChunkUploaded(neighbors.nym, `${neighbors.nym.coord.x},${neighbors.nym.coord.y},${neighbors.nym.coord.z}`).sdfBuffer
          : this.emptyChunkBuffer;
        const nyp = neighbors.nyp
          ? this.ensureChunkUploaded(neighbors.nyp, `${neighbors.nyp.coord.x},${neighbors.nyp.coord.y},${neighbors.nyp.coord.z}`).sdfBuffer
          : this.emptyChunkBuffer;
        const nzm = neighbors.nzm
          ? this.ensureChunkUploaded(neighbors.nzm, `${neighbors.nzm.coord.x},${neighbors.nzm.coord.y},${neighbors.nzm.coord.z}`).sdfBuffer
          : this.emptyChunkBuffer;
        const nzp = neighbors.nzp
          ? this.ensureChunkUploaded(neighbors.nzp, `${neighbors.nzp.coord.x},${neighbors.nzp.coord.y},${neighbors.nzp.coord.z}`).sdfBuffer
          : this.emptyChunkBuffer;

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
            { binding: 2, resource: { buffer: nxm } },
            { binding: 3, resource: { buffer: nxp } },
            { binding: 4, resource: { buffer: nym } },
            { binding: 5, resource: { buffer: nyp } },
            { binding: 6, resource: { buffer: nzm } },
            { binding: 7, resource: { buffer: nzp } },
            { binding: 8, resource: { buffer: this.paddedBuffers[i] } },
          ],
        });

        const bpPass = encoder.beginComputePass();
        bpPass.setPipeline(this.buildPaddedPipeline);
        bpPass.setBindGroup(0, bpBG);
        bpPass.dispatchWorkgroups(bpWorkgroupsX, bpWorkgroupsY, bpWorkgroupsZ);
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
        mcPass.dispatchWorkgroups(mcWorkgroupsX, mcWorkgroupsY, mcWorkgroupsZ);
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
          results.push({ vertexCount: 0 });
          continue;
        }

        // Copy interleaved data directly — no de-interleave.
        // getMappedRange is a shared view, so we must copy before unmap.
        const fullRange = this.vertexReadbackBuffers[i].getMappedRange();
        const interleaved = new Float32Array(vc * 6);
        interleaved.set(new Float32Array(fullRange, 0, vc * 6));
        this.vertexReadbackBuffers[i].unmap();
        results.push({ interleaved, vertexCount: vc });
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

  invalidateChunk(key: string): void {
    const gpuData = this.chunkBuffers.get(key);
    if (gpuData) {
      gpuData.cpuDirty = true;
      gpuData.gpuDirty = false;
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
      this.smoothOutputBuffers,
      this.paddedBuffers,
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
    this.emptyChunkBuffer?.destroy();
    this.device?.destroy();
    this._ready = false;
  }
}
