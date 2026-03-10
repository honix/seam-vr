# Animation Structure

## Goal

Define the structure used for scene composition and animation without introducing object-specific concepts like `doll`.

The same system should work for:

- a running character
- a motorcycle
- a car
- a door
- a prop with looping secondary motion

## Scene Structure

### Scene Nodes

The scene tree contains both spatial content and structural nodes:

- sculpt volumes
- groups
- lights
- animation players
- other transform-bearing content

This tree is for:

- parenting
- transforms
- visibility
- selection
- spatial organization
- structural organization for scene-level systems like animation playback

It should not contain every clip and track as if they were spatial children, but animation players themselves should exist as nodes.

### Animation Player Node

Animation is the one area where extra structure is justified.

The special animation node is an **animation player**.

An animation player:

- targets one or more scene nodes
- references one or more clips
- defines blend mode, timing, and layering
- can be stacked above another player
- appears in the hierarchy like other scene nodes, similar to Godot's approach

This is how a loop can be reused and then driven by another layer.

## Why Animation Players Exist

They solve cases like:

1. A run cycle loops on a character rig.
2. Another player moves the whole character along a path.
3. A third player adds upper-body motion.

Without animation players, every animation becomes a one-off baked result and cannot be composed cleanly.

## Clips and Tracks

Clips are authored motion data, not scene identity.

They should be editable from:

- inspector
- timeline
- later, a curve editor

Tracks should target:

- scene node transforms
- material or property values when needed
- IK controls or rig controls

## Inspector vs Hierarchy

Hierarchy should stay focused on scene and structural nodes.

Animation data should appear primarily in:

- inspector sections for the current selection
- the timeline window
- animation player nodes plus their inspector/timeline views

This avoids polluting the main hierarchy with every clip and track as if they were spatial children while still allowing animation players to exist as first-class nodes.

## Layered Example

Running character:

- `CharacterRoot` group in the scene tree
- `BodyRig` or control set under that group
- `RunCycle` clip authored once
- `BaseRunPlayer` loops `RunCycle`
- `PathPlayer` animates `CharacterRoot` translation and facing
- `UpperBodyAdditive` adds waving or aiming on top

The same idea applies to a vehicle:

- wheel spin loop
- suspension bounce layer
- path or steering layer

## Non-Goals

- No `doll` node type
- No requirement that animation is physics-driven
- No assumption that recording by grabbing is the primary authoring model

Recording can still exist later, but it should feed the same clip and keyframe system instead of defining a different architecture.

## Data Shape

```ts
SceneNode {
  id: string
  parentId?: string
  transform: Transform
}

AnimationClip {
  id: string
  tracks: Track[]
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
```

## Open Questions

- Should clips be standalone assets, or stored inside players by default with optional extraction later?
- Should IK controls appear as child rows in the timeline, or in a dedicated rig subsection?
- How much of animation-player structure should be visible in hierarchy versus inspector-only?
