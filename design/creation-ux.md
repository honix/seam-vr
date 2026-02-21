# Creation UX

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

- Sculpt volumes registered as scene nodes for hierarchy/selection
- Parent-child transforms for posing multi-part sculptures
- Move layer tool for repositioning sculpted parts
- Duplicate: clone sculpt volumes
- Mirror: automatic symmetry mode (later phase)

### Materials

- Clay PBR material on sculpted meshes
- Color picker (palette or color wheel)
- Roughness/metallic slider
- Preset materials (clay, metal, skin, stone, etc.)

## Controller Mapping (Quest / Generic XR)

| Input | Action |
|-------|--------|
| Trigger | Apply brush / select |
| Grip (hold) | World navigation (pan + rotate) |
| Both grips | Scale + 3-axis rotation |
| Y/B (hold-release) | Radial menu (tool selection) |
| Thumbstick Y | Brush radius |
| Thumbstick X (left) | Undo / redo |

## Undo/Redo

- Full operation stack (per user action, not per voxel)
- Thumbstick left = undo, right = redo
- Operations: sculpt stroke, move, material change, layer operations
- Undo stack serializable (enables collaboration replay)
