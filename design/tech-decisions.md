# Technical Decisions

## Why Browser (WebGPU + Three.js)

### Decided: Pure browser stack

**Reasons:**
1. Zero install distribution (share URL, it works)
2. Cross-platform by default (desktop, mobile viewing, VR via WebXR)
3. WebGPU provides near-native GPU performance (3-6% overhead vs Vulkan)
4. Massive ecosystem (npm, TypeScript tooling, web frameworks)
5. Updates ship instantly (no app store review)
6. AI integration is trivial (HTTP API calls from JS)

**Risks:**
- WebXR + WebGPU integration is experimental (Chrome behind flags, Safari 26.2)
- No Quest standalone WebGPU (Meta hasn't shipped it)
- Browser memory limits (~4GB) vs native
- No mesh shaders (post-v1 WebGPU spec)

**Mitigations:**
- Quest standalone can be addressed later with native app if needed
- Sparse chunked SDF volumes keep memory usage reasonable
- Mesh shaders not required for current pipeline

## Why SDF Sculpting

### Learned from render-sdf project

The render-sdf project explored multiple rendering approaches. The core finding: GPU mesh extraction works well when using WebGPU compute shaders with sparse chunked volumes. Key decisions:

- **32^3 cells/chunk, 2mm voxel size** - good balance of detail vs performance
- **Sparse allocation** - only chunks with content use GPU memory
- **Pooled GPU buffers** - avoid per-frame allocation overhead
- **Capsule brush** - interpolates between controller positions for smooth strokes
- **Deferred remeshing** - boundary neighbors queued for batch processing

### Tradeoffs accepted

| Gained | Cost |
|--------|------|
| Organic sculpting (Medium-style) | Larger scene files (voxel data vs parameters) |
| Arbitrary topology | GPU compute dependency (WebGPU required) |
| Smooth boolean operations | No WebGL fallback for sculpt pipeline |
| Intuitive VR creation (hands → clay) | More complex data pipeline |

## Data Model

### Scene Graph

```
Scene
  ├── SculptVolume (id: "sculpt_volume")
  │     ├── chunks: sparse SDF data
  │     └── material: { color, roughness, metallic }
  ├── Light (directional, id: "sun")
  ├── Light (point, id: "light-1")
  ├── Environment (id: "studio")
  └── Animation
        └── tracks: [...]
```

### Serialization

JSON scene format with binary SDF data. Scene metadata is human-readable, LLM-friendly, git-diffable. SDF chunk data stored as binary blobs referenced from the JSON.

## Framework Choice

### Three.js vs Babylon.js vs Raw WebGPU

| | Three.js | Babylon.js | Raw WebGPU |
|---|---|---|---|
| WebGPU support | r166+ (TSL) | Mature | Full control |
| Scene graph | Built-in | Built-in | Build your own |
| WebXR | Built-in | Built-in | Build your own |
| Community | Largest | Large | Small |
| Bundle size | ~150KB | ~300KB+ | Minimal |
| Compute shaders | Experimental | Supported | Native |
| Learning curve | Moderate | Moderate | Steep |

**Decision:** Three.js for scene graph, WebXR, and standard rendering. Raw WebGPU compute pipelines for sculpt pipeline (SDF brush, marching cubes).

## Performance Budget

Sculpt-focused pipeline budget:

| Component | Budget | Notes |
|-----------|--------|-------|
| Sculpt compute (per stroke) | 3-5ms | SDF brush + padded buffer + marching cubes |
| Mesh rendering | 2-3ms | Sculpt chunks + lights |
| Lighting + shadows | 2-3ms | Directional + point/spot + env map |
| Post-processing (AO, bloom) | 1-2ms | Standard passes |
| WebXR overhead | 0.5ms | Frame submission |
| **Total** | **~8-13ms** | **Within 11.1ms VR budget (sculpt amortized)** |

Sculpt compute is amortized - only runs on frames with active brush input, not every frame. Headroom for future features: scripting, physics, particles.
