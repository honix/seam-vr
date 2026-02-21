# Connections & Physics Animation

Everything is uniform. Sculpt volumes are just objects - a head, a wheel, a table leg, a door. Connect them, add physics, animate by grabbing. No special-cased "doll" or "character" concepts.

## Core Primitives

The system has only three things:

1. **Objects** - sculpt volumes. Each is a rigid body in physics.
2. **Connections** - physics constraints between any two objects at surface points.
3. **Hand tracks** - recorded controller movement that drives an object during playback.

That's it. A puppet, a car, a catapult, a swinging door - all built from the same pieces.

## Objects

Any sculpt volume is an object. Each has:
- Geometry (sculpted mesh)
- Material (color, roughness, metallic)
- Mass (derived from volume, or user-set)
- Default pose (position + rotation in zero frame)

No types, no categories. A sphere is a head or a wheel depending on what you connect it to.

## Connections

A connection joins two objects at specific surface points. It is a physics constraint.

- **Point A**: position on object 1's surface
- **Point B**: position on object 2's surface
- **Tightness**: tight (rigid, bolted) → loose (floppy, stringy)
- **Type**: ball joint (rotate freely), hinge (one axis), fixed (no relative movement)
- Joint limits: future feature, skip for MVP

Connections form a free graph. No root, no hierarchy. An object can have any number of connections to any other objects.

### Examples

| Scene | Objects | Connections |
|-------|---------|-------------|
| Puppet | torso, head, 2 arms, 2 legs | neck=ball, shoulders=ball, hips=ball |
| Car | body, 4 wheels | 4x hinge (each wheel spins on one axis) |
| Door + frame | frame, door panel | 1x hinge |
| Mobile (hanging) | crossbar, 3 ornaments | 3x ball (loose) |
| Chain | 5 links | 4x ball (loose) between adjacent links |

## Hand Tracks

A hand track is a recording of one VR controller over time. During playback, it acts as a dynamic constraint pulling an object.

- **Target object**: which object this hand grabs
- **Grab point**: surface point where the hand attaches
- **Data**: array of (time, position, rotation) samples at recording FPS

Multiple hand tracks on the same timeline. Two hands can record simultaneously.

## Phases

### Setup Phase (Zero Frame)

No physics. User arranges objects and connections.

- Sculpt objects (separate sculpt volumes)
- Position and orient objects in space (the "default pose")
- Create connections between objects
- Adjust connection properties (tightness, type)
- This is the starting state for every playback

User can return to zero frame at any time (stop button). Adjusting default pose may invalidate existing hand recordings - user re-records as needed.

### Action Phase (Record / Playback)

Physics activates. Objects become rigid bodies, connections become physics constraints.

**Recording:**
1. User presses record
2. Existing hand tracks play back (user sees previous recordings)
3. User grabs an object with one or both controllers
4. Controller position + rotation recorded as a new hand track
5. The grab acts as a dynamic constraint: hand pulls the object, physics propagates through connections
6. Uncontrolled objects go ragdoll (gravity)
7. User presses stop → hand track saved, scene returns to zero frame

**Playback:**
1. User presses play
2. All hand tracks replay simultaneously
3. Physics re-simulates from zero frame using hand tracks as inputs
4. Deterministic: same result every run (Rapier.js with fixed timestep)
5. User presses stop → return to zero frame

## User Stories

### 1. Build a puppet

1. Sculpt torso, head, arms, legs as separate volumes
2. Position in default pose
3. Select stitch tool, connect neck (torso→head, ball, tight)
4. Connect shoulders, hips (ball, medium)
5. Press record, grab torso, walk it forward - limbs swing naturally
6. Press record again, grab right arm, wave it while torso replays
7. Press play to review

### 2. Build a toy car

1. Sculpt a car body and 4 wheels
2. Position wheels at corners of body
3. Stitch each wheel to body with hinge connection (spin axis = wheel axle)
4. Set tightness to medium (wheels spin freely but not infinitely)
5. Press record, grab body, push it forward - wheels spin from ground contact
6. Press play to review

### 3. Swinging mobile

1. Sculpt a crossbar and 3 hanging ornaments
2. Stitch ornaments to crossbar with ball joints, tightness = loose
3. Press record, grab crossbar, sway it gently
4. Ornaments swing with physics, slightly out of phase
5. Press play to review the peaceful motion

### 4. Rube Goldberg machine

1. Sculpt: ramp, ball, lever, bucket, pulley parts
2. Connect lever with hinge, bucket with ball joint to pulley
3. Press record, grab ball, place it at top of ramp, release
4. Ball rolls down, hits lever, lever tips bucket, etc.
5. Minimal hand input, physics does the rest

### 5. Multi-pass complex animation

1. Build a puppet (story 1)
2. Pass 1: record torso movement (walking path)
3. Pass 2: record right arm (waving) while torso replays
4. Pass 3: record left arm (holding something) while torso + right arm replay
5. Pass 4: record head (looking around) while everything else replays
6. Each pass adds one hand track, building up the performance

### 6. Re-record a pass

1. Watch playback, notice the arm wave looks wrong
2. Delete that specific hand track
3. Press record - all other tracks replay
4. Record a new arm movement
5. New track replaces the deleted one

## Controls

| Input | Setup Phase | Action Phase (Recording) | Action Phase (Playback) |
|-------|-------------|--------------------------|------------------------|
| Trigger | Sculpt / select / set connection point | Grab object (starts recording that hand) | - |
| Grip | World navigation | World navigation | World navigation |
| Y/B | Radial menu (tools, record, play, stop) | Radial menu (stop) | Radial menu (pause, stop) |
| Thumbstick Y | Brush radius | - | Scrub time |
| Thumbstick X | Undo/redo | - | - |

## Connection Overlay

Toggle via radial menu. When enabled:
- **Lines** drawn between connected points (colored by tightness: white = tight, orange = loose)
- **Dots** at each connection point on the object surface
- **Selected connection** highlighted (thicker line, larger dots)
- Overlay renders on top of geometry (not occluded by objects)

## Physics Configuration

- **Engine**: Rapier.js (WASM, deterministic)
- **Timestep**: fixed (1/90s to match VR refresh)
- **Rigid bodies**: one per object, collision shape from convex hull of sculpt mesh
- **Constraints**: mapped from connections
  - Tight → high stiffness / low compliance
  - Loose → low stiffness / high compliance
  - Ball joint → spherical joint constraint
  - Hinge → revolute joint constraint
  - Fixed → fixed joint constraint
- **Hand constraint**: kinematic body at recorded hand position, connected to target object with a stiff spring (position + rotation)
- **Gravity**: enabled, standard (0, -9.81, 0)
- **Damping**: per-object angular/linear damping to prevent infinite oscillation

## Data Model

```
Connection {
  id: string
  objectA: string        // sculpt volume ID
  pointA: Vec3           // local-space position on objectA surface
  objectB: string        // sculpt volume ID
  pointB: Vec3           // local-space position on objectB surface
  tightness: number      // 0 (loose) to 1 (tight)
  type: "ball" | "hinge" | "fixed"
}

HandTrack {
  id: string
  targetObject: string   // sculpt volume ID
  grabPoint: Vec3        // local-space position on object surface
  startTime: number      // seconds
  samples: HandSample[]
}

HandSample {
  time: number           // seconds (relative to track start)
  position: Vec3         // world-space controller position
  rotation: Quat         // world-space controller rotation
}

SceneState {
  objects: string[]              // sculpt volume IDs
  connections: Connection[]
  handTracks: HandTrack[]
  defaultPose: Map<string, Transform>  // object ID → position + rotation at zero frame
}
```

## Open Questions (Future)

- **Hand path visualization**: show recorded hand paths as curves in 3D space, possibly editable
- **Joint limits**: constrain rotation ranges per connection
- **Collision between objects**: prevent self-intersection
- **Physics presets**: weight/bounciness per object (heavy stone vs light cloth)
- **Static objects**: pin an object in place (floor, wall, table surface) - infinite mass, unaffected by forces
- **Export**: bake physics simulation to keyframes for deterministic playback without Rapier
