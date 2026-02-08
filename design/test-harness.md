# Test Harness

## Problem

VR apps are notoriously hard to test. Manual testing requires putting on a headset and physically performing actions. This doesn't scale, breaks CI, and makes regressions invisible until a human stumbles into them.

We need a way to drive the entire app — XR input, UI, sculpting, animation, rendering — through commands that a script (or an AI agent) can issue without a human in the loop.

## Design Principle: Command Bus

The app exposes a **command bus** — a single entry point for all mutations. Every user action (spawn a sphere, grab a handle, press play) is already a command internally. The test harness just injects commands from the outside instead of from XR controllers.

```
                    ┌─────────────┐
  XR Controllers ──→│             │
  Keyboard/Mouse ──→│ Command Bus │──→ App State ──→ Renderer
  Test Harness   ──→│             │
  AI Agent       ──→│             │
                    └─────────────┘
```

This means:
- Tests use the exact same code paths as real users
- No separate "test mode" with different behavior
- Commands are serializable (record a session, replay it as a test)

## Command Protocol

Commands are JSON objects sent to `window.__seam.exec()` or via WebSocket.

### Scene Commands

```typescript
// Spawn a primitive
{ cmd: "spawn", type: "cylinder", id: "arm-left",
  position: [0, 1.2, 0], rotation: [0, 0, 90] }

// Modify parameters
{ cmd: "set_param", target: "arm-left",
  params: { radiusTop: 0.08, radiusBottom: 0.12, height: 0.6 } }

// Apply deformer
{ cmd: "add_deformer", target: "arm-left",
  deformer: { type: "bend", angle: 25, axis: "x" } }

// Set material
{ cmd: "set_material", target: "arm-left",
  material: { color: "#cc8844", roughness: 0.8 } }

// Parent primitives
{ cmd: "parent", child: "arm-left", parent: "torso" }

// Delete
{ cmd: "delete", target: "arm-left" }

// Undo / redo
{ cmd: "undo" }
{ cmd: "redo" }
```

### XR Input Emulation

Simulate controller state without a headset. The emulator feeds synthetic `XRInputSource` data into the same pipeline that processes real controller input.

```typescript
// Set controller pose (position in meters, rotation as euler degrees)
{ cmd: "xr_pose", hand: "right",
  position: [0.3, 1.2, -0.4], rotation: [0, 0, 0] }

// Button press/release
{ cmd: "xr_button", hand: "right", button: "trigger", state: "pressed" }
{ cmd: "xr_button", hand: "right", button: "trigger", state: "released" }
{ cmd: "xr_button", hand: "right", button: "grip", state: "pressed" }

// Thumbstick
{ cmd: "xr_thumbstick", hand: "left", x: -1.0, y: 0.0 }  // undo

// Compound: grab and drag (convenience macro)
{ cmd: "xr_grab_drag", hand: "right",
  from: [0.3, 1.2, -0.4], to: [0.5, 1.4, -0.3],
  duration: 500, button: "grip" }
```

### UI Commands

Drive the radial palette menu and panels without simulating spatial hand movements.

```typescript
// Open palette
{ cmd: "ui_palette", action: "open" }

// Select from palette
{ cmd: "ui_palette", action: "select", item: "sphere" }

// Toggle mode
{ cmd: "ui_mode", mode: "handle" }   // or "free_deform"
{ cmd: "ui_mode", mode: "play" }     // or "edit"

// Timeline controls
{ cmd: "ui_timeline", action: "play" }
{ cmd: "ui_timeline", action: "pause" }
{ cmd: "ui_timeline", action: "seek", time: 2.5 }
{ cmd: "ui_timeline", action: "set_speed", speed: 0.5 }
```

### Animation Commands

```typescript
// Start recording performance capture
{ cmd: "record_start", targets: ["arm-left", "arm-right"] }

// Stop recording
{ cmd: "record_stop" }

// Add keyframe manually
{ cmd: "keyframe", target: "head", time: 1.0,
  property: "transform.rotation", value: [0, 45, 0],
  interpolation: "ease" }

// Play animation
{ cmd: "anim_play", from: 0, to: 5.0, loop: true }
```

### Query Commands

Read state back for assertions.

```typescript
// Get primitive state
{ cmd: "query", target: "arm-left" }
// → { id: "arm-left", type: "cylinder", position: [...], params: {...}, deformers: [...] }

// Get full scene graph
{ cmd: "query_scene" }
// → { primitives: [...], hierarchy: {...}, animation: {...} }

// Get rendered frame info
{ cmd: "query_frame" }
// → { fps: 90, drawCalls: 47, triangles: 23400, gpuTime: 3.2 }

// List undo stack
{ cmd: "query_undo" }
// → { stack: ["spawn cylinder", "set_param", "add_deformer"], position: 3 }
```

## Visual Testing

### Screenshot Comparison

Capture the rendered frame and compare against a reference image.

```typescript
// Capture current frame as PNG
{ cmd: "screenshot", camera: "default" }
// → returns base64 PNG or saves to path

// Capture from a specific viewpoint
{ cmd: "screenshot",
  camera: { position: [0, 1.5, 3], lookAt: [0, 1, 0], fov: 60 } }

// Capture both VR eyes
{ cmd: "screenshot", camera: "stereo" }
// → returns { left: base64, right: base64 }
```

Comparison uses per-pixel diff with a configurable threshold. Small differences (antialiasing, float precision) are tolerated. Large differences flag a regression.

```typescript
{ cmd: "screenshot_compare",
  reference: "tests/references/character-pose-01.png",
  threshold: 0.02 }  // max 2% pixel difference
// → { match: true, diff: 0.003, diffImage: base64 }
```

### What Visual Tests Catch

| Test | What It Validates |
|------|------------------|
| Spawn each primitive type | Correct geometry generation |
| Apply each deformer | Vertex shader deformation works |
| Seam smoothing on/off | Post-processing pass runs correctly |
| Material presets | PBR pipeline, lighting |
| Animation playback at keyframes | Interpolation, transform updates |
| Stereo rendering | Both eyes render, no divergence |
| 1000-primitive stress test | No visual corruption at scale |

### Reference Image Management

- Reference images live in `tests/references/` and are checked into git
- When a visual change is intentional, update references with `{ cmd: "screenshot_update_ref", test: "..." }`
- CI fails on any unreviewed visual diff
- Diff images are uploaded as CI artifacts for human review

## Test Execution Modes

### 1. In-Browser (Development)

Run tests in the same browser tab as the app. Good for debugging.

```typescript
// Load test suite in browser console
await import("/tests/suite.ts");

// Run a specific test
await seam.test.run("spawn-all-primitives");

// Run all tests
await seam.test.runAll();
```

Tests call `window.__seam.exec()` directly. Results print to console and overlay on screen.

### 2. Headless Browser (CI)

Chrome/Chromium with `--headless=new` and WebGPU flags.

```bash
# Run full test suite in headless Chrome
npm run test:visual

# Under the hood:
# 1. Start Vite dev server
# 2. Launch headless Chrome with WebGPU enabled
# 3. Navigate to app URL
# 4. Inject test runner via CDP (Chrome DevTools Protocol)
# 5. Execute command sequences
# 6. Capture screenshots, compare references
# 7. Report pass/fail
```

Required Chrome flags for headless WebGPU:
```
--headless=new
--enable-unsafe-webgpu
--enable-features=Vulkan
--use-angle=vulkan
--disable-gpu-sandbox
```

### 3. WebSocket Remote (AI Agent / External Tools)

The app starts a WebSocket server on a debug port. External processes connect and send commands.

```
Test Runner / AI Agent
       │
       │ WebSocket (ws://localhost:9222/seam)
       ▼
  ┌──────────┐
  │ Seam App │  (running in browser)
  └──────────┘
```

This enables:
- AI agents (Claude, etc.) to drive the app and verify results
- External test frameworks (Playwright, Puppeteer) to orchestrate
- Record-and-replay tools to capture human sessions as tests

## Test Categories

### Unit: Scene Graph

Pure logic tests, no rendering needed. Run in Node.

- Primitive creation and parameter validation
- Parent/child hierarchy operations
- Deformer stacking order
- Undo/redo stack integrity
- Animation keyframe interpolation math
- Scene serialization roundtrip (JSON → scene → JSON = identical)

### Integration: Command → Render

Full pipeline tests. Require browser with WebGPU.

| Test | Commands | Assertion |
|------|----------|-----------|
| Spawn and query | `spawn` → `query` | Returned state matches input |
| Deform pipeline | `spawn` → `add_deformer` → `screenshot` | Visual matches reference |
| Undo after spawn | `spawn` → `undo` → `query_scene` | Scene is empty |
| Undo after deform | `spawn` → `add_deformer` → `undo` → `screenshot` | Deformer removed visually |
| Parent chain | `spawn A` → `spawn B` → `parent B→A` → move A → `query B` | B moved with A |
| Animation playback | `spawn` → `keyframe` × N → `anim_play` → `seek` → `screenshot` | Correct pose at time T |

### Stress / Performance

- Spawn 1000 primitives, measure frame time
- Apply 5 stacked deformers to 100 primitives
- Record 10-second performance capture, verify frame drops
- Serialize + deserialize 500-primitive scene, measure time

### XR Input Simulation

Full interaction tests using emulated controllers.

| Test | Emulated Actions | Assertion |
|------|-----------------|-----------|
| Open palette and spawn | `xr_button(B)` → `xr_pose` over sphere → `xr_button(trigger)` → `xr_pose` in space → release | Sphere exists at target position |
| Grab and move | `xr_pose` on primitive → `grip pressed` → move → `grip released` | Primitive at new position |
| Two-handed scale | Both grips on primitive → move apart → release | Primitive scale increased |
| Handle deformation | `xr_pose` on handle → `grip` → drag → release | Deformer param changed |
| Undo via thumbstick | `xr_thumbstick(left, -1, 0)` | Last operation undone |

### Seam Quality

Specific tests for the core rendering challenge.

- Two overlapping cylinders at various angles → screenshot → compare seam smoothness
- Enable/disable seam smoothing → measure pixel difference in seam region
- Rotate camera around a joint → capture screenshots at N angles → verify no view-dependent artifacts exceed threshold

## Recording and Replay

### Session Recording

Every command that passes through the bus can be logged with timestamps.

```typescript
{ cmd: "recording_start" }
// ... user creates things in VR ...
{ cmd: "recording_stop" }
// → saves to tests/recordings/session-2024-01-15.json
```

Recording format:
```json
{
  "version": 1,
  "duration": 45.2,
  "commands": [
    { "t": 0.0, "cmd": "spawn", "type": "cylinder", "id": "auto_1", ... },
    { "t": 0.8, "cmd": "xr_pose", "hand": "right", "position": [0.3, 1.2, -0.4] },
    { "t": 0.85, "cmd": "xr_button", "hand": "right", "button": "grip", "state": "pressed" },
    ...
  ]
}
```

### Replay as Test

```typescript
{ cmd: "replay", file: "tests/recordings/build-character.json", speed: 10 }
```

Replay at 10x speed, then take a screenshot and compare. This turns any human VR session into a regression test.

### Test Authoring from Recording

1. Human creates something in VR (or flat-screen with emulated input)
2. Session is recorded automatically
3. Developer trims the recording, adds assertions at key points
4. Recording becomes a test case with reference screenshots

## Implementation Plan

### Phase 1: Command Bus + Scene Commands

- Expose `window.__seam.exec()` on the app
- Implement scene commands (spawn, set_param, add_deformer, parent, delete)
- Implement query commands (query, query_scene)
- Undo/redo via commands
- Node-based unit tests for scene graph logic

### Phase 2: Visual Testing

- `screenshot` command → canvas capture as PNG
- `screenshot_compare` with per-pixel diff
- Headless Chrome runner script (`npm run test:visual`)
- First reference images for each primitive type
- CI integration (GitHub Actions with WebGPU-capable runner)

### Phase 3: XR Emulation

- Synthetic `XRInputSource` injection
- `xr_pose`, `xr_button`, `xr_thumbstick` commands
- `xr_grab_drag` convenience macro with lerp over duration
- Controller interaction tests (palette, grab, deform)

### Phase 4: Recording + Replay

- Command bus logging with timestamps
- Replay engine (deserialize + execute with timing)
- Recording trimmer (CLI tool to cut start/end, add assertion markers)
- Convert recordings to test cases

### Phase 5: WebSocket Interface

- Debug-mode WebSocket server in the app
- External process can connect and send/receive commands
- Enables AI agents and external tooling to drive the app
- Playwright/Puppeteer integration helpers

## File Structure

```
tests/
  unit/                    # Node-based, no browser needed
    scene-graph.test.ts
    animation-math.test.ts
    serialization.test.ts
  visual/                  # Require headless Chrome + WebGPU
    primitives.test.ts
    deformers.test.ts
    seam-quality.test.ts
    materials.test.ts
    animation.test.ts
    stress.test.ts
  xr/                      # XR input emulation tests
    palette.test.ts
    grab-move.test.ts
    handle-deform.test.ts
    two-handed.test.ts
  recordings/              # Captured sessions for replay tests
    build-character.json
    animate-walk.json
  references/              # Golden screenshots for visual comparison
    cylinder-default.png
    sphere-bend-30deg.png
    seam-smooth-on.png
    ...
  harness/
    command-bus.ts          # Command dispatch + type definitions
    xr-emulator.ts          # Synthetic XR input injection
    screenshot.ts           # Canvas capture + comparison
    headless-runner.ts      # Chrome launch + CDP orchestration
    ws-server.ts            # WebSocket debug interface
    recorder.ts             # Session recording + replay
```

## CI Configuration

```yaml
# Runs on every PR
test-unit:
  - npm run test:unit          # Fast, no GPU needed

# Runs on every PR (needs GPU runner)
test-visual:
  - npm run test:visual        # Headless Chrome + WebGPU
  - upload diff images as artifacts on failure

# Runs nightly (expensive)
test-stress:
  - npm run test:stress        # 1000-primitive scenes, perf benchmarks
  - post results to dashboard
```

## Non-Goals

- **Not a general browser testing tool.** This harness is specific to Seam VR's command model.
- **Not pixel-perfect rendering tests.** Antialiasing and float precision vary across GPUs. Thresholds are intentionally loose (1-5% pixel diff).
- **Not replacing manual QA for subjective quality.** "Does this look good?" requires human eyes. The harness catches "does this look broken?"
- **Not testing third-party libraries.** We trust Three.js / WebGPU. We test our code's interaction with them.
