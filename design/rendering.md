# Rendering

## The Seam Problem

When primitives are composed (cylinder arm meets sphere shoulder), the intersection is visible as a hard edge. This is THE core rendering challenge for this approach.

## Seam Hiding Strategies (ordered by implementation priority)

### 1. Screen-Space Normal Smoothing (MVP)

Post-processing pass that blends normals across nearby surfaces in screen space.

**How it works:**
- Render all primitives normally to G-buffer (depth, normals, color)
- Post pass: for each pixel, sample neighboring normals in screen space
- If depth is similar but normals diverge sharply → blend normals
- Re-light with smoothed normals
- Effectively "melts" sharp seams into smooth transitions

**Pros:** Simple to implement, works for any primitive combination
**Cons:** Only works in screen space (view-dependent), breaks at silhouettes

**Parameters:**
- Blend radius (pixels): how far to search for seam neighbors
- Depth threshold: max depth difference to consider "same surface"
- Normal threshold: min normal divergence to trigger blending

### 2. Overlap Blending (MVP+)

Where primitives overlap in 3D space, blend their surfaces.

**How it works:**
- Each primitive has a "blend zone" at its extremities
- In the overlap region, interpolate normals and positions between both surfaces
- Requires knowing which primitives are neighbors (spatial query)

**Implementation:**
- Tag primitive ends as "open" (blendable) vs "closed" (capped)
- At joints, render both primitives with alpha gradient near the intersection
- Depth-sort fragments in the overlap zone

### 3. SDF Proxy for Joints Only (Later)

Small SDF volumes computed only at joint regions, not the whole model.

**How it works:**
- Detect where two primitives overlap
- Generate a tiny SDF volume (e.g., 32^3) covering just the joint
- Raymarch or MC mesh just that small region
- Replace the overlapping geometry with the smooth SDF surface

**Pros:** Perfect smooth joints
**Cons:** Brings back some SDF complexity, but at tiny scale (32^3 vs 256^3)

### 4. Mesh Boolean at Joints (Later)

Compute mesh union where primitives meet.

**How it works:**
- On edit (not every frame): compute CSG union of overlapping primitives
- Replace the overlapping meshes with the boolean result
- Cache until either primitive is modified

**Libraries:** Manifold (WASM build available), or custom implementation

## Materials & Shading

### PBR Pipeline

Standard WebGPU PBR with:
- Base color (per-primitive or vertex-painted)
- Metallic / roughness (per-primitive slider)
- Normal mapping (from deformation, not texture)
- Environment map for reflections
- SSAO for ambient occlusion (helps hide seams too)

### Art Style Options

The platform should support multiple visual styles via material presets:

| Style | How | Target Audience |
|-------|-----|-----------------|
| Clay/matte | High roughness, soft colors, strong AO | Beginners, stop-motion look |
| Toon/cel | Outline pass + stepped shading | Animators, stylized content |
| Realistic PBR | Full metallic/roughness, env maps | Advanced creators |
| Unlit/flat | No shading, pure color | Graphic design, UI mockups |

### Lighting

- One directional light (sun) + environment map (ambient)
- User can reposition the sun by grabbing it in VR
- Preset environments (studio, outdoor, sunset, night)
- Point/spot lights as placeable objects (later phase)

## Performance Targets

| Platform | Resolution | FPS | Primitive Count |
|----------|-----------|-----|-----------------|
| Desktop VR (Quest Link) | 2x 1440x1600 | 90 | 1000+ |
| Quest standalone (if native) | 2x 1832x1920 | 72-90 | 200-500 |
| Desktop flat screen | 1920x1080 | 60 | 2000+ |
| Mobile viewer | 720-1080p | 30-60 | 500 |

Each primitive is a standard mesh (50-500 triangles depending on subdivision). At 1000 primitives, worst case is 500K triangles - trivial for any modern GPU.

## Render Pipeline

```
Per frame:
1. Update transforms (animation playback or VR input)
2. Update deformers (vertex shader uniforms)
3. Render G-buffer pass (depth, normals, albedo, metallic/rough)
4. Screen-space seam smoothing pass
5. Lighting pass (PBR + shadows)
6. Post-processing (AO, bloom, outline for toon mode)
7. Tone mapping + output to WebXR or canvas
```

No compute shaders needed for MVP. Entire pipeline is standard vertex + fragment shaders.
