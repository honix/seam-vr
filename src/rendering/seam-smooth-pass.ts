import * as THREE from 'three';

export interface SeamSmoothParams {
  enabled: boolean;
  blendRadius: number;
  depthThreshold: number;
  normalThreshold: number;
}

export const DEFAULT_SEAM_SMOOTH_PARAMS: SeamSmoothParams = {
  enabled: false, // Disabled for MVP
  blendRadius: 2,
  depthThreshold: 0.01,
  normalThreshold: 0.3,
};

/**
 * Seam smoothing post-processing pass.
 * For MVP this is a placeholder that stores parameters and is ready to
 * be enabled when the WebGPU pipeline and render targets are set up.
 *
 * When enabled, it will use the seam-smooth.frag.wgsl shader to blend
 * normals at primitive seam boundaries in screen space.
 */
export class SeamSmoothPass {
  params: SeamSmoothParams;
  private material: THREE.ShaderMaterial | null = null;
  private quad: THREE.Mesh | null = null;

  constructor(params?: Partial<SeamSmoothParams>) {
    this.params = { ...DEFAULT_SEAM_SMOOTH_PARAMS, ...params };
  }

  /**
   * Initialize the pass with render targets.
   * Placeholder for MVP - will set up fullscreen quad + shader when WebGPU pipeline is ready.
   */
  setup(
    _renderer: THREE.WebGLRenderer,
    _width: number,
    _height: number
  ): void {
    if (!this.params.enabled) return;

    // MVP placeholder: When enabled, this will create:
    // 1. A normal render target (MRT with normals + depth)
    // 2. A fullscreen quad with the seam-smooth shader
    // 3. Uniform bindings for blendRadius, depthThreshold, normalThreshold
    //
    // For now, the WGSL shader is written and ready in src/shaders/seam-smooth.frag.wgsl
  }

  /**
   * Apply the seam smoothing pass.
   * No-op when disabled.
   */
  render(
    _renderer: THREE.WebGLRenderer,
    _readTarget: THREE.WebGLRenderTarget | null,
    _writeTarget: THREE.WebGLRenderTarget | null
  ): void {
    if (!this.params.enabled) return;
    // Will be implemented when WebGPU render targets are set up
  }

  setParams(params: Partial<SeamSmoothParams>): void {
    Object.assign(this.params, params);
    if (this.material) {
      if (params.blendRadius !== undefined) {
        this.material.uniforms['blendRadius'].value = params.blendRadius;
      }
      if (params.depthThreshold !== undefined) {
        this.material.uniforms['depthThreshold'].value = params.depthThreshold;
      }
      if (params.normalThreshold !== undefined) {
        this.material.uniforms['normalThreshold'].value = params.normalThreshold;
      }
    }
  }

  dispose(): void {
    this.material?.dispose();
    this.quad?.geometry.dispose();
    this.material = null;
    this.quad = null;
  }
}
