# Rendering

## Materials & Shading

### PBR Pipeline

Standard WebGPU PBR with:
- Base color (per sculpt volume or per-vertex painted)
- Metallic / roughness (per sculpt volume slider)
- Normal mapping (from mesh normals)
- Environment map for reflections
- SSAO for ambient occlusion

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
- Point/spot lights as placeable objects

## Performance Targets

| Platform | Resolution | FPS | Notes |
|----------|-----------|-----|-------|
| Desktop VR (Quest Link) | 2x 1440x1600 | 90 | Primary target |
| Quest standalone (if native) | 2x 1832x1920 | 72-90 | WebGPU availability TBD |
| Desktop flat screen | 1920x1080 | 60 | Viewer mode |
| Mobile viewer | 720-1080p | 30-60 | Viewer mode |

Sculpt mesh complexity depends on voxel resolution and active chunk count. GPU compute (marching cubes) keeps mesh extraction fast (~3-5ms per stroke).

## Render Pipeline

```
Per frame:
1. Update transforms (animation playback or VR input)
2. Sculpt compute pass (if brush active): SDF brush → padded buffer → marching cubes
3. Render pass (depth, normals, albedo, metallic/rough)
4. Lighting pass (PBR + shadows)
5. Post-processing (AO, bloom, outline for toon mode)
6. Tone mapping + output to WebXR or canvas
```

WebGPU compute shaders used for sculpt pipeline. Standard vertex + fragment shaders for rendering.
