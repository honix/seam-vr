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
- Primitive approach needs no compute shaders → works with WebGL fallback
- Quest standalone can be addressed later with native app if needed
- Primitive scenes are tiny (KB) → memory is not an issue
- Mesh shaders irrelevant for standard primitive rendering

## Why Primitives (Not SDF/Voxels)

### Lessons from render-sdf project

The render-sdf project explored 5 branches over weeks:

| Branch | Approach | Problem |
|--------|----------|---------|
| `main` | MC mesh + CPU readback | 4 chunks/frame limit, 360KB/chunk readback |
| `gpu-direct-mesh-4.6` | CompositorEffect indirect draw | Bypasses Godot renderer, manual depth/lighting/VR stereo |
| `temporal-cache` | Raymarching + depth reprojection | Ghosting, noise, 1/4 pixel cycling artifacts |
| `brick-map` | Sparse brick map + raymarching | Visual glitches, noise - user doesn't like the look |

**Core finding:** GPU mesh generation in any engine (not just Godot) requires either:
1. CPU readback (slow, bottleneck) or
2. Custom renderer bypassing the engine (fragile, reimplements everything)

**Primitives avoid the entire problem:**
- Each primitive is a standard mesh (50-500 triangles)
- Generated once when spawned, updated only when deformation params change
- Standard vertex + fragment shader pipeline
- No compute shaders needed for MVP
- Runs on WebGL as fallback (Quest standalone, older browsers)

### Tradeoffs accepted

| Lost | Gained |
|------|--------|
| Organic SDF sculpting (Medium-style) | Non-destructive parametric editing |
| Arbitrary topology | Instant rendering on any device |
| Smooth boolean subtraction | Tiny scene files (KB vs MB) |
| Voxel-level detail | Natural animation model (every shape has a transform) |

## Data Model

### Scene Graph

```
Scene
  ├── Primitive (cylinder, id: "torso")
  │     ├── deformers: [taper, bend]
  │     ├── material: { color, roughness, metallic }
  │     └── children:
  │           ├── Primitive (sphere, id: "head")
  │           └── Primitive (cylinder, id: "arm-left")
  │                 └── Primitive (sphere, id: "hand-left")
  ├── Light (directional, id: "sun")
  ├── Environment (id: "studio")
  └── Animation
        └── tracks: [...]
```

### Serialization

JSON scene format. Human-readable, LLM-friendly, git-diffable.

Estimated sizes:
- Simple character (20 primitives): ~2 KB
- Complex scene (200 primitives + animation): ~50 KB
- Rich interactive experience (500 primitives + scripts): ~200 KB

Compare to render-sdf: 256^3 R16F SDF = 33.5 MB (167,000x larger).

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

**Recommendation:** Start with Three.js. Largest community, decent WebGPU support, built-in WebXR. If we hit limitations, can drop to raw WebGPU for specific passes (seam smoothing post-process).

## Performance Budget

Primitive rendering is cheap. The budget goes to:

| Component | Budget | Notes |
|-----------|--------|-------|
| Primitive rendering | 2-3ms | 1000 primitives, standard pipeline |
| Deformer computation | 0.5ms | Vertex shader, per-primitive |
| Seam smoothing post-pass | 1-2ms | Screen-space, fullscreen |
| Lighting + shadows | 2-3ms | One directional + env map |
| Post-processing (AO, bloom) | 1-2ms | Standard passes |
| WebXR overhead | 0.5ms | Frame submission |
| **Total** | **~8ms** | **Well within 11.1ms VR budget** |

Headroom for future features: scripting, physics, particles.
