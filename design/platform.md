# Platform (Future Phases)

## Phase 1: Sharing (after MVP)

### URL-Based Distribution

Every creation gets a unique URL: `seam.app/s/abc123`

- Opens in any browser (desktop, mobile, VR)
- VR headset → immersive viewer with head tracking
- Desktop → orbit camera with mouse controls
- Mobile → gyroscope look-around + touch orbit

### Scene Format

JSON scene metadata + binary SDF chunk data. Metadata is human-readable and git-diffable. SDF volumes serialized as compressed binary blobs referenced from the JSON.

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "sculpt_volume",
      "type": "sculpt_volume",
      "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "material": { "color": "#cc8844", "roughness": 0.8, "metallic": 0.0 },
      "sdfData": "chunks/sculpt_volume.bin"
    }
  ],
  "lights": [...],
  "animation": { ... },
  "environment": "studio"
}
```

Scene sizes depend on sculpt complexity (number of active chunks). Loads fast with streaming chunk decompression.

### Embed

```html
<iframe src="https://seam.app/embed/abc123" width="800" height="600"></iframe>
```

Embeddable in any website, blog, social media.

## Phase 2: Scripting

### Interaction Layer

Add behaviors to scene objects:

```
When [this cylinder] is [touched by hand]:
  → [rotate] [that sphere] by [45 degrees]
  → [play sound] ["click.mp3"]
  → [change color] to [red]
```

### Implementation Options

| Approach | Audience | Complexity |
|----------|----------|------------|
| Visual blocks (Scratch-like) | Beginners, kids | Lowest barrier |
| Event sheets (Construct-style) | Intermediate | Familiar to many |
| TypeScript/JavaScript | Developers | Full power |
| Natural language → AI generates code | Everyone | Depends on AI quality |

All approaches compile to the same runtime (JavaScript). Users can view the generated code from any approach.

### Script Model

```typescript
// User writes (or AI generates):
on("touch", cylinderArm, () => {
  rotate(sphereHead, { y: 45 }, { duration: 0.5, ease: "bounce" });
  playSound("boing");
});

on("grab", boxTorso, (hand) => {
  follow(boxTorso, hand, { smooth: 0.1 });
});
```

### Physics (Optional)

- Rigid body physics on sculpt volumes (gravity, collisions)
- Configurable per-node: static, dynamic, kinematic
- Constraints: hinge, ball, spring between nodes
- Library: Rapier.js (Rust compiled to WASM, excellent performance)

## Phase 3: Multiplayer

### Shared Creation Spaces

- Multiple users in the same VR space
- See each other's avatars (sculpted in-app!)
- Real-time sync of sculpt edits
- Cursor/selection visibility for collaboration

### Technical Approach

- WebSocket or WebRTC for real-time sync
- CRDT-based scene state (conflict-free replicated data)
- Each edit = operation on scene nodes (sculpt strokes, transforms, material changes)
- Sculpt strokes can be replicated as brush operations (compact)
- Eventual consistency: all clients converge to same state

### Social Features

- User profiles (avatar = your first creation)
- Follow creators
- Like/remix/fork scenes
- Collections/galleries
- Comments (spatial comments pinned in 3D space?)

## Phase 4: AI Integration

### AI Creative Copilot

**Content generation:**
- "Add a tree" → sculpts trunk + canopy shapes with appropriate materials
- "Make this look like a robot" → suggests material changes, adds sculpted details
- "Create a walk cycle" → generates keyframe animation from description
- Voice commands in VR: "make the arms longer" → reshapes sculpted geometry

**Script generation:**
- "When I click the door, open it" → generates touch event + rotation animation
- "Add gravity to all loose objects" → applies physics components
- "Make this a playable game where you catch falling stars" → generates full interaction logic

**Style transfer:**
- "Make this look like Pixar" → adjusts materials, lighting, proportions
- "Studio Ghibli style" → changes palette, adds outline pass, softens shapes

### Technical Approach

- LLM API calls (Claude/GPT) for natural language → scene edits
- Scene format (JSON) is LLM-friendly (small, structured, human-readable)
- Tool-use pattern: LLM calls functions like `sculptBrush()`, `setMaterial()`, `addKeyframe()`
- Context: current scene state + user's intent → targeted edits
- Local inference for latency-critical operations (voice commands in VR)
