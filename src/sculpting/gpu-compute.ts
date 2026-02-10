// WebGPU Compute Pipeline for SDF sculpting
// Manages GPU buffers and dispatches compute shaders for:
// 1. SDF brush operations (add/subtract)
// 2. Marching cubes mesh extraction
//
// Falls back to CPU path when WebGPU is unavailable.

import type { Chunk } from './chunk';
import type { BrushParams, SculptConfig, MeshData } from './types';
import { EDGE_TABLE, TRI_TABLE } from './marching-tables';

import sdfBrushShader from '../shaders/sdf-brush.compute.wgsl?raw';
import marchingCubesShader from '../shaders/marching-cubes.compute.wgsl?raw';

interface ChunkGPUData {
  sdfBuffer: GPUBuffer;
  needsUpload: boolean;
}

export class GPUCompute {
  private device: GPUDevice | null = null;
  private brushPipeline: GPUComputePipeline | null = null;
  private mcPipeline: GPUComputePipeline | null = null;

  // Shared resources
  private edgeTableBuffer: GPUBuffer | null = null;
  private triTableBuffer: GPUBuffer | null = null;

  // Per-chunk GPU buffers
  private chunkBuffers: Map<string, ChunkGPUData> = new Map();

  // Staging buffers for readback
  private vertexReadbackBuffer: GPUBuffer | null = null;
  private counterReadbackBuffer: GPUBuffer | null = null;

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

      // Create shared lookup table buffers
      this.createLookupTableBuffers();

      // Compile compute shaders
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

    // Edge table (256 * 4 bytes)
    const edgeData = new Uint32Array(EDGE_TABLE);
    this.edgeTableBuffer = this.device.createBuffer({
      size: edgeData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.edgeTableBuffer, 0, edgeData);

    // Tri table (256 * 16 * 4 bytes)
    const triData = new Int32Array(TRI_TABLE);
    this.triTableBuffer = this.device.createBuffer({
      size: triData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.triTableBuffer, 0, triData);
  }

  private async createPipelines(): Promise<void> {
    if (!this.device) return;

    // SDF Brush pipeline
    const brushModule = this.device.createShaderModule({
      code: sdfBrushShader,
    });
    this.brushPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: brushModule, entryPoint: 'main' },
    });

    // Marching cubes pipeline
    const mcModule = this.device.createShaderModule({
      code: marchingCubesShader,
    });
    this.mcPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: mcModule, entryPoint: 'main' },
    });
  }

  /**
   * Get or create GPU buffer for a chunk's SDF data
   */
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
   * Dispatch SDF brush compute shader on a chunk
   */
  async applyBrush(chunk: Chunk, brush: BrushParams): Promise<void> {
    if (!this.device || !this.brushPipeline) return;

    const key = `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`;
    const gpuData = this.getChunkBuffer(chunk, key);

    // Upload SDF data to GPU
    this.device.queue.writeBuffer(gpuData.sdfBuffer, 0, chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);

    // Create uniform buffer (aligned to 16 bytes)
    const cs = this.config.chunkSize;
    const vs = this.config.voxelSize;
    const samples = cs + 1;
    const originX = chunk.coord.x * cs * vs;
    const originY = chunk.coord.y * cs * vs;
    const originZ = chunk.coord.z * cs * vs;

    // BrushUniforms layout (must match WGSL struct):
    // center: vec3<f32> (12 bytes) + radius: f32 (4 bytes) = 16
    // strength: f32 + smoothing: f32 + operation: u32 + pad: f32 = 16 (actually need alignment)
    // chunk_origin: vec3<f32> + voxel_size: f32 = 16
    // samples_per_axis: u32 + pad: u32 = 8 (padded to 16)
    const uniformData = new ArrayBuffer(64);
    const f32View = new Float32Array(uniformData);
    const u32View = new Uint32Array(uniformData);

    f32View[0] = brush.center[0]; // center.x
    f32View[1] = brush.center[1]; // center.y
    f32View[2] = brush.center[2]; // center.z
    f32View[3] = brush.radius;    // radius
    f32View[4] = brush.strength;  // strength
    f32View[5] = brush.smoothing; // smoothing
    u32View[6] = brush.type === 'add' ? 0 : 1; // operation
    f32View[7] = 0; // pad
    f32View[8] = originX;  // chunk_origin.x
    f32View[9] = originY;  // chunk_origin.y
    f32View[10] = originZ; // chunk_origin.z
    f32View[11] = vs;      // voxel_size
    u32View[12] = samples; // samples_per_axis
    u32View[13] = 0;       // pad

    const uniformBuffer = this.device.createBuffer({
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(uniformData));

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      layout: this.brushPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: gpuData.sdfBuffer } },
      ],
    });

    // Dispatch compute
    const workgroups = Math.ceil(samples / 4);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.brushPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();

    // Read back SDF data to CPU
    const readbackBuffer = this.device.createBuffer({
      size: chunk.data.byteLength,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    encoder.copyBufferToBuffer(gpuData.sdfBuffer, 0, readbackBuffer, 0, chunk.data.byteLength);
    this.device.queue.submit([encoder.finish()]);

    // Map and copy back
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readbackBuffer.getMappedRange());
    chunk.data.set(result);
    readbackBuffer.unmap();

    // Cleanup temp buffers
    uniformBuffer.destroy();
    readbackBuffer.destroy();
  }

  /**
   * Dispatch marching cubes compute shader on a chunk.
   * Returns the extracted mesh data.
   */
  async extractMesh(chunk: Chunk): Promise<MeshData> {
    if (!this.device || !this.mcPipeline || !this.edgeTableBuffer || !this.triTableBuffer) {
      return { positions: new Float32Array(0), normals: new Float32Array(0), vertexCount: 0 };
    }

    const key = `${chunk.coord.x},${chunk.coord.y},${chunk.coord.z}`;
    const gpuData = this.getChunkBuffer(chunk, key);

    // Upload latest SDF data
    this.device.queue.writeBuffer(gpuData.sdfBuffer, 0, chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);

    const cs = this.config.chunkSize;
    const vs = this.config.voxelSize;
    const samples = cs + 1;
    const originX = chunk.coord.x * cs * vs;
    const originY = chunk.coord.y * cs * vs;
    const originZ = chunk.coord.z * cs * vs;

    // MCUniforms
    const uniformData = new ArrayBuffer(32);
    const f32View = new Float32Array(uniformData);
    const u32View = new Uint32Array(uniformData);
    f32View[0] = originX;
    f32View[1] = originY;
    f32View[2] = originZ;
    f32View[3] = vs;
    u32View[4] = cs;
    u32View[5] = samples;
    f32View[6] = 0.0; // iso_level
    u32View[7] = 0;   // pad

    const uniformBuffer = this.device.createBuffer({
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(uniformData));

    // Output vertex buffer (generous allocation: max 5 tris per cell * 3 verts * 6 floats)
    const maxVertices = cs * cs * cs * 15;
    const vertexBufferSize = maxVertices * 6 * 4; // 6 floats per vertex
    const vertexBuffer = this.device.createBuffer({
      size: vertexBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Atomic counter buffer
    const counterBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(counterBuffer, 0, new Uint32Array([0]));

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      layout: this.mcPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: gpuData.sdfBuffer } },
        { binding: 2, resource: { buffer: this.edgeTableBuffer } },
        { binding: 3, resource: { buffer: this.triTableBuffer } },
        { binding: 4, resource: { buffer: vertexBuffer } },
        { binding: 5, resource: { buffer: counterBuffer } },
      ],
    });

    // Dispatch
    const workgroups = Math.ceil(cs / 4);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.mcPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();

    // Read back counter
    const counterReadback = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    encoder.copyBufferToBuffer(counterBuffer, 0, counterReadback, 0, 4);

    this.device.queue.submit([encoder.finish()]);

    // Get vertex count
    await counterReadback.mapAsync(GPUMapMode.READ);
    const vertexCount = new Uint32Array(counterReadback.getMappedRange())[0];
    counterReadback.unmap();

    if (vertexCount === 0) {
      uniformBuffer.destroy();
      vertexBuffer.destroy();
      counterBuffer.destroy();
      counterReadback.destroy();
      return { positions: new Float32Array(0), normals: new Float32Array(0), vertexCount: 0 };
    }

    // Read back vertex data
    const readSize = vertexCount * 6 * 4;
    const vertexReadback = this.device.createBuffer({
      size: readSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder2 = this.device.createCommandEncoder();
    encoder2.copyBufferToBuffer(vertexBuffer, 0, vertexReadback, 0, readSize);
    this.device.queue.submit([encoder2.finish()]);

    await vertexReadback.mapAsync(GPUMapMode.READ);
    const vertexData = new Float32Array(vertexReadback.getMappedRange().slice(0));
    vertexReadback.unmap();

    // Split into positions and normals
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3] = vertexData[i * 6];
      positions[i * 3 + 1] = vertexData[i * 6 + 1];
      positions[i * 3 + 2] = vertexData[i * 6 + 2];
      normals[i * 3] = vertexData[i * 6 + 3];
      normals[i * 3 + 1] = vertexData[i * 6 + 4];
      normals[i * 3 + 2] = vertexData[i * 6 + 5];
    }

    // Cleanup
    uniformBuffer.destroy();
    vertexBuffer.destroy();
    counterBuffer.destroy();
    counterReadback.destroy();
    vertexReadback.destroy();

    return { positions, normals, vertexCount };
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
    this.vertexReadbackBuffer?.destroy();
    this.counterReadbackBuffer?.destroy();
    this.device?.destroy();
    this._ready = false;
  }
}
