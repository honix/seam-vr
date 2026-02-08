# CLAUDE.md

## Project: Seam VR

Browser-based VR creation platform for 3D animation and interactive content. Primitive composition approach (deformable cylinders, spheres, tubes, etc.) with non-destructive editing, performance capture animation, and URL-based sharing.

## Vision

**VR-first creation tool for animation and film** that evolves into an interactive platform with scripting, multiplayer, and AI assistance. Think Dreams meets the web - anyone can create, share, and remix 3D interactive content from a browser.

## Core Principles

- **Primitives, not voxels** - compose shapes from deformable parametric primitives. No SDF, no marching cubes, no GPU mesh extraction bottleneck.
- **Non-destructive** - every parameter editable at any time. Scene = list of primitives + transforms + deformations.
- **VR-first creation, flat-screen viewing** - build in VR headset, share via URL for anyone to watch on any device.
- **Web-native** - zero install, runs in browser. WebGPU for rendering, WebXR for VR.

## Tech Stack

- **WebGPU** (Three.js or raw) for rendering
- **WebXR** for VR input/display
- **TypeScript** for application code
- **WGSL** shaders for rendering and post-processing

## Architecture

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

## Key Design Docs

See `/design/` folder:
- `vision.md` - product vision and audience
- `creation-ux.md` - primitive spawning, deformation, composition
- `animation.md` - timeline, performance capture, keyframing
- `rendering.md` - seam hiding, materials, visual style
- `platform.md` - sharing, scripting, multiplayer, AI (future phases)
- `tech-decisions.md` - why browser, why primitives, lessons from render-sdf

## Development Phases

1. **MVP**: VR primitive creation + deformation + basic animation + URL sharing
2. **Polish**: Seam quality, materials, lighting, flat-screen viewer
3. **Scripting**: Interactive behaviors, visual + code scripting, AI assist
4. **Multiplayer**: Shared creation spaces, real-time collaboration
5. **Platform**: User profiles, content discovery, remixing

## Permissions

- Can edit `.ts`, `.js`, `.wgsl`, `.html`, `.css`, `.json` files
- Can edit config files (vite, tsconfig, package.json, etc.)
- Can run npm/node commands
