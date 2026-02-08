# Vision

## One-liner

A browser-based VR platform where anyone can create, animate, and share 3D interactive content.

## The Gap

| Platform | Creation | Scripting | VR | Distribution | Problem |
|----------|----------|-----------|-----|-------------|---------|
| Dreams | Excellent | Visual | Yes | PS only | Platform-locked, dying |
| Roblox | Primitive | Lua | No | Massive | Ugly, no VR creation |
| VRChat | Import only | Udon | Yes | PC/Quest | No in-VR creation |
| Quill | Strokes | None | Yes | Limited | No solids, no scripting |
| Medium | SDF sculpt | None | Yes | Dead | No animation, no sharing |

**Nobody combines good VR creation + animation + scripting + open web distribution.**

## Target Audience

Layered complexity for different skill levels:

1. **Casual creators** - spawn shapes, pose them, take screenshots, share. Like building with digital clay. No code needed.
2. **Artists & animators** - performance capture + keyframe refinement for short films and loops. Export to video or interactive viewer.
3. **Makers & indie devs** - add scripting and logic to create interactive experiences, games, educational content.
4. **AI-assisted creators** - describe what you want, AI helps build geometry, write logic, suggest animations.

All levels share the same platform and can learn from each other's work by remixing shared content.

## Why Browser

- Zero install: share a URL, it just works
- Cross-device: desktop, mobile (viewing), VR headsets
- Web ecosystem: npm packages, web frameworks, collaboration tools
- No app store gatekeeping
- Updates ship instantly

## Why Primitives (Not SDF/Voxels)

Learned from the render-sdf project:
- SDF → mesh extraction requires GPU compute pipelines that fight browser/engine abstractions
- Marching cubes creates CPU→GPU bottlenecks (see render-sdf's 5 branch exploration)
- Primitives are standard meshes - trivial to render on any GPU, including Quest/mobile
- Non-destructive editing (change any parameter anytime) vs destructive SDF sculpting
- Scene files are tiny (kilobytes of parameters vs megabytes of voxel data)
- Primitives map naturally to animation (every shape has a transform to keyframe)

## Why VR-First

- VR creation is inherently spatial - placing and deforming 3D shapes with your hands
- Performance capture (recording hand movements) is the fastest way to animate
- Flat-screen creation of 3D content is awkward (mouse-based 3D manipulation)
- VR-first ensures the UX is spatial from day one, not retrofitted
- Flat-screen users are viewers/consumers first, creators later (if ever)

## Success Metrics (MVP)

- A single user can create a recognizable character from primitives in < 5 minutes
- Animate it with performance capture in < 2 minutes
- Share via URL that loads in < 3 seconds on any browser
- VR viewer sees the animation in stereo with head tracking
- Flat-screen viewer sees it with orbit camera controls
