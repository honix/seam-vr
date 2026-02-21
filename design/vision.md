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

## Why VR-First

- VR creation is inherently spatial - placing and deforming 3D shapes with your hands
- Performance capture (recording hand movements) is the fastest way to animate
- Flat-screen creation of 3D content is awkward (mouse-based 3D manipulation)
- VR-first ensures the UX is spatial from day one, not retrofitted
- Flat-screen users are viewers/consumers first, creators later (if ever)

## Success Metrics (MVP)

- A single user can sculpt a recognizable character in < 5 minutes
- Animate it with performance capture in < 2 minutes
- Share via URL that loads in < 3 seconds on any browser
- VR viewer sees the animation in stereo with head tracking
- Flat-screen viewer sees it with orbit camera controls
