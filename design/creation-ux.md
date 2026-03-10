# Creation UX

## Core Principles

- **Select is the only exclusive tool.** The user explicitly enters selection mode when they want to pick scene content with a ray.
- **Windows are tool-like and stay attached to the hand that opened them.** They are not spawned as free-floating world panels in v1.
- **UI interaction overrides the active hand tool.** If a hand is pointing at a window, trigger input should operate the UI instead of the current scene tool.
- **Inspector always follows the current selection.** A user can keep `select` in one hand and inspect or edit from the other hand without switching tools.
- **Contextual tools come from capability, not object name.** Avoid special cases like `doll`. A motorcycle, a person, and a lamp should all share the same scene model and only expose the tools their data supports.

## Tool Model

### Always Available

- `select`
- palette open/close
- world navigation
- undo / redo
- hierarchy window tool
- inspector window tool
- timeline window tool

### Contextual by Capability

- **Sculptable**: add, subtract, smooth, move
- **Animatable**: create clip, keyframe, scrub, play, layer, edit curves
- **Connectable**: undecided for now
- **Light**: no dedicated hand tools in v1; edit through inspector only

Groups are organizational scene nodes, not a special capability bucket with their own hand tool family.

## Core Interaction: SDF Sculpting

### Brush Tools

VR controller selects brush via radial menu:

| Brush | Action | Use Case |
|-------|--------|----------|
| Add | Smooth union - deposits material | Building up forms |
| Subtract | Smooth difference - carves away material | Hollowing, detailing |
| Smooth | Relaxes surface | Cleaning up rough areas |
| Move | Grab-and-drag displacement | Reshaping existing forms |

### Sculpt Flow

1. Select brush tool from radial menu (Y/B hold-release)
2. Adjust brush radius (thumbstick Y)
3. Pull trigger to apply brush at controller position
4. Continuous strokes: capsule brush between frames for smooth lines

### Brush Parameters

- **Radius**: controlled by thumbstick Y, compensates for world scale
- **Strength**: how much material is added/removed per stroke
- **Smoothing**: falloff curve for brush edge softness

### Composition

- Sculpt volumes are registered as scene nodes for hierarchy and selection
- Parent-child transforms are used for spatial composition and organization
- Move layer tool repositions sculpted parts
- Duplicate clones scene nodes
- Mirror is a later feature

### Materials

- Clay PBR material on sculpted meshes
- Color picker (palette or color wheel)
- Roughness/metallic slider
- Preset materials (clay, metal, skin, stone, etc.)

## Windows

Window tools follow per-hand replacement behavior:

- Choosing a window from the palette attaches it to that hand.
- Choosing the same window again does nothing.
- Choosing another palette tool on that hand hides the current window and replaces it.
- A window attached to one hand can still be interacted with by the other hand.

### Hierarchy

- Hand-attached window
- Shows scene nodes, including structural nodes like animation players
- Highlights the currently selected node
- Selecting in hierarchy updates inspector and timeline context

### Inspector

- Hand-attached window
- Shows the currently selected object or animation structure
- Hosts most property editing, including light settings and animation clip settings

### Timeline

- Hand-attached window
- Used for scrubbing, play/pause, keyframe editing, and layer management
- Follows the same per-hand replacement behavior as the other window tools

## Controller Mapping (Quest / Generic XR)

| Input | Action |
|-------|--------|
| Trigger | Use current tool or operate UI if pointing at a window |
| Grip (hold) | World navigation (pan + rotate) |
| Both grips | Scale + 3-axis rotation |
| Y/B (hold-release) | Radial menu (tool or window selection) |
| Thumbstick Y | Brush radius |
| Thumbstick X (left) | Undo / redo |

## Undo/Redo

- Full operation stack (per user action, not per voxel)
- Thumbstick left = undo, right = redo
- Operations: sculpt stroke, move, material change, hierarchy edits, animation edits
- Undo stack serializable (enables collaboration replay)
