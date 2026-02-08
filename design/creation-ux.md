# Creation UX

## Core Interaction: Spawn + Deform

### Primitive Palette

VR controller opens a radial menu of base shapes:

| Primitive | Use Case | Deformation Handles |
|-----------|----------|-------------------|
| Cylinder | Limbs, trunks, pipes | Radius top/bottom, height, bend, taper |
| Sphere | Heads, joints, eyes | Radius XYZ (ellipsoid), squash/stretch |
| Box | Buildings, furniture, blocks | Size XYZ, corner radius, shear |
| Tube | Organic curves, tails, tentacles | Path points, radius along path, twist |
| Cone | Hats, noses, horns | Radius, height, bend |
| Torus | Rings, donuts, handles | Major/minor radius, arc angle |
| Capsule | Rounded limbs, fingers | Radius, height |

### Spawn Flow

1. Open palette (grip button or menu)
2. Grab a primitive type
3. Place it in space (position + rotation set by hand pose)
4. Release to confirm placement
5. Primitive appears with visible deformation handles

### Deformation

Two modes, toggled by button:

**Handle Mode** (default):
- Grab colored handles on the primitive to deform
- Handles visible as small spheres/arrows on the shape
- Each handle maps to one parameter (radius, bend amount, taper, etc.)
- Two-handed: grab both ends of a cylinder to stretch/bend

**Free Deform Mode**:
- Grab anywhere on the surface and push/pull
- Maps to closest deformation type (e.g., pulling middle of cylinder = bend)
- More intuitive but less precise
- Good for quick sketching, switch to handles for refinement

### Deformer Types

Applied per-primitive as vertex shader operations:

| Deformer | Effect | Parameters |
|----------|--------|------------|
| Bend | Curve along one axis | Angle, axis, center |
| Taper | Scale varies along axis | Start scale, end scale, axis |
| Twist | Rotate around axis progressively | Angle, axis |
| Lattice | Freeform deformation (2x2x2 or 3x3x3 control points) | Control point positions |
| Noise | Organic surface displacement | Amplitude, frequency, seed |

Multiple deformers stack on a single primitive (non-destructive, reorderable).

### Composition

- Primitives are parented in a hierarchy (grab one, attach to another)
- Parent-child transforms for posing (move arm, hand follows)
- Group selection: lasso or multi-grab to select several primitives
- Duplicate: grab + trigger clones the selection
- Mirror: automatic symmetry mode (edit left side, right mirrors)

### Materials

Simple material assignment per primitive:
- Color picker (palette or color wheel)
- Roughness/metallic slider
- Preset materials (wood, metal, skin, glass, etc.)
- Vertex painting within a primitive (stretch to paint, later phase)

## Controller Mapping (Quest / Generic XR)

| Input | Action |
|-------|--------|
| Grip (hold) | Grab/move primitive or handle |
| Trigger | Confirm / select |
| Thumbstick | Scroll palette / undo-redo |
| A/X button | Toggle handle/free deform mode |
| B/Y button | Open palette / menu |
| Both grips | Scale selection (pinch gesture) |
| Thumbstick click | Toggle play/edit mode |

## Undo/Redo

- Full operation stack (not per-parameter, per user action)
- Thumbstick left = undo, right = redo
- Operations: spawn, delete, move, deform parameter change, parent/unparent
- Undo stack serializable (enables collaboration replay)
