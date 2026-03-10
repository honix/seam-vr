# Animation

## Direction

The animation system should follow a classical 3D pipeline:

- keyframes
- editable curves
- layered animation players
- optional IK controls
- optional recording as an input method later

It should not depend on the earlier physics-driven puppet approach.

## Core Building Blocks

### 1. Scene Nodes

Regular scene nodes remain the things being animated:

- sculpt volumes
- groups
- lights when needed
- any other transform-bearing scene object
- animation players as structural nodes

There is no `doll` node type.

### 2. Animation Clips

An animation clip stores authored motion:

- transform keys
- property keys
- curve interpolation
- optional events or markers later

Clips can be created, assigned, and edited from inspector and timeline.

### 3. Animation Players

Animation players are real nodes in the scene structure, similar to Godot's `AnimationPlayer`.

They exist to:

- play one or more clips
- blend or layer clips
- target a scene node, a group, or a rig/control set
- stack animation behavior
- appear in hierarchy and selection like other nodes

This allows compositions like:

- Player A: looping run cycle on the character rig
- Player B: higher-level motion moving the whole character along a path
- Player C: additive upper-body override for waving or aiming

### 4. IK / Control Rigs

For classical character-style work, animation should support control points and IK goals:

- hand target
- foot target
- head look target
- pole vectors / bend hints later

These controls are animation-facing structures, not special object identity types.

## Authoring Workflow

1. Select a scene node, group, or animation player.
2. Open timeline and inspector from the palette.
3. Create or assign an animation clip.
4. Key poses over time.
5. Refine interpolation curves.
6. Add another animation player or layer if a second motion pass is needed.
7. Use IK controls where direct transform keying is not enough.

## Timeline UI

- Hand-attached window
- Horizontal time axis with playhead
- Rows per target, control, or track
- Key markers visible and draggable
- Layer visibility and mute/solo controls
- Curve editor later

The timeline should follow the same hand-window behavior as inspector and hierarchy:

- selecting the timeline tool shows it on that hand
- selecting timeline again does nothing
- selecting another palette tool on that hand hides it

## Inspector UI

The inspector should expose animation content for the current selection:

- assigned clips
- player settings
- blend mode
- weight
- loop state
- time scale
- clip ranges
- IK settings and control bindings

This keeps clips and player settings editable without forcing all animation content into the hierarchy tree.

## Layering Model

Layering is a first-class requirement.

For v1, layering semantics mean:

- Layers evaluate from bottom to top.
- `override` means the current player writes the final value for the properties it animates, replacing lower layers for those properties.
- `additive` means the current player applies a delta on top of the result from lower layers.
- `weight` scales the contribution of the player.
- Root or path motion is usually an `override` layer.
- Secondary pose adjustments like aiming, waving, leaning, or head-look are usually `additive` layers.

Examples:

- A looping run cycle clip drives leg and arm motion.
- A higher-level player moves the character root through the scene.
- An additive player adjusts spine and arms for aiming.
- A facial layer or head-look layer can be added later without replacing the base motion.

## Data Model

```ts
AnimationClip {
  id: string
  duration: number
  tracks: Track[]
}

Track {
  targetId: string
  property: string
  keyframes: Keyframe[]
}

Keyframe {
  time: number
  value: any
  interpolation: "linear" | "ease" | "step" | "bezier"
}

AnimationPlayer {
  id: string
  parentId?: string
  targetIds: string[]
  clipIds: string[]
  mode: "override" | "additive"
  weight: number
  loop: boolean
  timeScale: number
  parentPlayerId?: string
}

IkGoal {
  id: string
  targetNodeId: string
  effector: string
  goalPosition: Vec3
  goalRotation?: Quat
}
```

## Playback

- Play / pause / stop from timeline
- Loop per player or per clip
- Layer blending in real time
- Preview without switching away from editing context

## Export

- Video: render to MP4/WebM from camera path
- Interactive: share as URL with embedded animation
- glTF: export authored animation tracks where supported
