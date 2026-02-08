# Animation

## Two Creation Modes

### 1. Performance Capture (Primary)

Record hand movements in real-time, mapped to primitive transforms.

**Flow:**
1. Select primitives to animate (or "puppet" - a group)
2. Grab control points (e.g., character's hands, head)
3. Press record
4. Move naturally - system records transforms at 90fps
5. Stop recording
6. Playback immediately

**What gets recorded:**
- Transform (position, rotation, scale) per primitive per frame
- Deformation parameter changes (if handles are grabbed during recording)
- Timeline position for synchronization

**Multi-take workflow:**
- Record body movement first (coarse poses)
- Record facial/detail pass second (fine adjustments)
- Layers composite together
- Each take can be re-recorded without affecting others

### 2. Keyframe Editing (Refinement)

Traditional timeline for precision adjustments after performance capture.

**Timeline UI:**
- Floating panel in VR space (grabbable, positionable)
- Horizontal time axis with playhead
- Rows per primitive (or per group)
- Diamond markers for keyframes
- Grab playhead to scrub

**Keyframe operations:**
- Auto-key: moving a primitive while stopped creates a keyframe
- Copy/paste keyframes
- Adjust timing by dragging keyframes on timeline
- Interpolation: linear, ease-in/out, bezier (visual curve editor, later phase)

### Data Model

```
Animation {
  duration: number (seconds)
  tracks: Track[]
}

Track {
  targetId: string (primitive or group ID)
  property: string ("transform", "bend.angle", "color", etc.)
  keyframes: Keyframe[]
}

Keyframe {
  time: number (seconds)
  value: any (vec3 for position, float for deformer param, etc.)
  interpolation: "linear" | "ease" | "step"
}
```

Performance capture recordings are converted to keyframes at recording FPS, then can be simplified (remove redundant keyframes where interpolation matches recorded values).

### Playback

- Play/pause/stop controls on timeline panel
- Loop mode for previewing
- Speed control (0.25x - 4x)
- Ghost/onion-skin: show previous/next keyframe poses as transparent overlays
- Audio sync (import audio track, later phase)

### Export

- Video: render to MP4/WebM from camera path (server-side or client-side via MediaRecorder)
- Interactive: share as URL with embedded animation (autoplays or user-controlled)
- glTF: export animated scene as standard 3D format for other tools
