# CLAUDE.md

## Project: Seam VR

Browser-based VR creation platform for 3D animation and interactive content. SDF sculpting is the primary creation tool, with deformable parametric primitives available as a secondary composition approach. Performance capture animation and URL-based sharing.

## Vision

**VR-first creation tool for animation and film** that evolves into an interactive platform with scripting, multiplayer, and AI assistance. Think Dreams meets the web - anyone can create, share, and remix 3D interactive content from a browser.

## Core Principles

- **Sculpt-first** - SDF-based sculpting is the main expression tool. Add, subtract, and move material with VR controllers to build organic shapes in real time.
- **Primitives as building blocks** - deformable parametric primitives (cylinders, spheres, tubes) remain available for quick composition and non-destructive editing.
- **VR-first creation, flat-screen viewing** - build in VR headset, share via URL for anyone to watch on any device.
- **Web-native** - zero install, runs in browser. WebGPU for rendering and GPU compute, WebXR for VR.

## Tech Stack

- **WebGPU** (Three.js + raw compute pipelines) for rendering and GPU-accelerated sculpting
- **WebXR** for VR input/display
- **TypeScript** for application code
- **WGSL** shaders for rendering, post-processing, and compute (SDF brush ops, marching cubes mesh extraction)

## Architecture

### Sculpt pipeline (primary)

```
VR controller input (SculptInteraction)
    ↓
SculptEngine → capsule brush applied to sparse chunked SDF volume
    ↓ GPU compute: sdf-brush.compute.wgsl (modify SDF values)
    ↓ GPU compute: build-padded.compute.wgsl (assemble padded chunk buffer)
    ↓ GPU compute: marching-cubes.compute.wgsl (extract triangle mesh)
    ↓
Per-chunk Three.js BufferGeometry with clay PBR material
    ↓
WebXR stereo output (VR) or canvas (flat screen)
```

Key details: 32³ cells/chunk, 2mm voxel size, sparse allocation, pooled GPU buffers. Brush types: add (smooth union), subtract (smooth difference), move (grab-and-drag displacement). Deferred remeshing for boundary chunks keeps frame time ~3-5ms per stroke.

### Primitive pipeline (secondary)

```
Primitives (parametric meshes)
    ↓ vertex shader deformations (bend, taper, twist)
    ↓
Standard WebGPU render pipeline (depth, normals, PBR)
    ↓
Post-processing (screen-space normal smoothing for seams, AO, bloom)
    ↓
WebXR stereo output (VR) or canvas (flat screen)
```

### VR interaction

**Per-hand tool system** (replaces old ModeManager). Each hand independently selects a tool: sculpt (add/subtract/smooth/move), spawn (cube/sphere/capsule/light), move_layer, inspector, hierarchy. `InteractionManager` routes input to subsystems based on each hand's active tool.

**Input mapping**: trigger = tool use, grip = world navigation, Y/B hold-release = radial menu (tool selection), thumbstick Y = brush radius, thumbstick X (left) = undo/redo.

**World navigation** moves `worldGroup`, not the camera rig. This preserves canonical world coordinates for multiplayer and avoids IPD distortion on scale. Single grip: pan + rotate (grab-and-twist via controller orientation). Dual grip: scale + full 3-axis rotation around midpoint (orthonormal frame from positions + averaged controller up vectors). Controller positions are transformed to worldGroup local space before passing to sculpt/spawn/grab systems. Brush radius compensates for world scale.

**VR UI**: Radial menu (hold button, point, release to select) with canvas-text labels. Floating panels (inspector, hierarchy) with grabbable title bars, face toward camera on open.

## Key Design Docs

See `/design/` folder:
- `vision.md` - product vision and audience
- `creation-ux.md` - primitive spawning, deformation, composition
- `animation.md` - timeline, performance capture, keyframing
- `rendering.md` - seam hiding, materials, visual style
- `platform.md` - sharing, scripting, multiplayer, AI (future phases)
- `tech-decisions.md` - why browser, why primitives, lessons from render-sdf
- `test-harness.md` - automated testing via command bus, XR emulation, visual regression

## Development Phases

1. **MVP**: VR sculpting + primitive creation + deformation + basic animation + URL sharing
2. **Polish**: Sculpt tool refinement, materials, lighting, flat-screen viewer
3. **Scripting**: Interactive behaviors, visual + code scripting, AI assist
4. **Multiplayer**: Shared creation spaces, real-time collaboration
5. **Platform**: User profiles, content discovery, remixing

## Permissions

- Can edit `.ts`, `.js`, `.wgsl`, `.html`, `.css`, `.json` files
- Can edit config files (vite, tsconfig, package.json, etc.)
- Can run npm/node commands
