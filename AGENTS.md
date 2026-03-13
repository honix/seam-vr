# Seam VR Agent Notes

## Project Overview
- Seam VR is a browser-based VR creation sandbox built around sculpt-first workflows.
- The stack is TypeScript, Three.js, WebGPU, WGSL, and WebXR.
- The app is VR-first, but it also has a desktop/browser harness that lets us exercise interaction flows without an HMD.
- The project is still early-stage. GPU SDF sculpting and cube-marching are the main technical foundations that already exist.

## Core Mental Model
- The scene is command-driven. Interaction should usually flow through the command bus instead of ad hoc state mutation.
- The user moves the world by transforming `worldGroup`, not by moving the XR rig itself.
- Tools are per-hand. Trigger is tool use, grip is world navigation, and radial-menu / brush controls are handed input features layered on top.
- Clay sculpting is routed through an active clay target. In normal app flow, selecting a clay node in the hierarchy is what makes it the active sculpt target.

## Important Runtime Areas
- `src/interaction/*`
  - Interaction manager, tool system, brush preview, and high-level input behavior.
- `src/sculpting/*`
  - Clay manager, sculpt interaction, SDF edits, remesh scheduling, and mesh extraction.
- `src/xr/*`
  - XR input handling plus the desktop XR emulator used by the harness.
- `src/test-harness/*`
  - Browser-side debugging and automation surface exposed through `window.__seam`.

## Browser Harness Workflow
- Rebuild after source changes with `npm run build`.
- Serve the built app locally and open it in Chrome. A common flow is previewing the app on `http://127.0.0.1:4173/`.
- Use `?play=<id>` to auto-run a built-in scenario after startup.
- The play runner emits a machine-friendly console line:
  - `[PlayResult] <json>`
- For browser automation, prefer checking console output and `window.__seam` state. Do not use DOM text waiting for console logs.

## `window.__seam` Notes
- The harness exposes a debugging API on `window.__seam`.
- Common useful entry points:
  - `exec(cmd)`
  - `reset()`
  - `scene()`
  - `node(id)`
  - `snapshotScene()`
  - `captureViewport()`
  - `focus(target, distance?)`
  - `select(id)`
  - `deselect()`
  - `activateClay(id | null)`
  - `clayStats(id?)`
  - `openHierarchy()`, `closeHierarchy()`
  - `openInspector()`, `closeInspector()`
  - `openTimeline()`, `closeTimeline()`
  - `panelState()`
- Play API:
  - `window.__seam.play.list()`
  - `window.__seam.play.run(id)`
  - `window.__seam.play.lastRun`

## Built-In Play Scenarios
- `boot_smoke`
- `sculpt_stress_short`
- `ui_smoke`

## Harness Testing Tips
- If you need to know whether sculpting really happened, trust `clayStats()` before trusting screenshots.
- A browser capture can still look dark or unhelpful even when clay mesh generation succeeded.
- For sculpt testing, make sure the clay node is selected through the normal app flow when possible. In VR, selecting the clay in the hierarchy is the behavior that matters.
- If a play or manual harness step appears to hang after reload, check console messages or evaluate `window.__seam` directly. Waiting for console text with a DOM waiter is the wrong primitive.

## Recent Browser-Side Sculpting Lessons
- Desktop sculpting was previously broken for non-HMD runs for two separate reasons:
  - `src/xr/xr-emulator.ts` computed button edges too early, which swallowed `trigger_start` and `trigger_end`.
  - `src/main.ts` only ran the emulator loop when WebXR was unsupported. In Chrome with WebXR support but no active VR session, emulator input was skipped.
- The current expectation is:
  - desktop/browser mode uses the emulator until an actual VR session starts
  - trigger edge transitions are consumed on frame updates, not immediately at command dispatch time
- There is a focused regression test in `tests/unit/xr-input-handler.test.ts` covering trigger start / update / end behavior.

## Debugging Notes For Future Sessions
- If browser sculpting looks broken, first check:
  - `window.__seam.clayStats('clay_1')`
  - current selected node
  - current active clay id
  - whether the brush preview is visible
- If brush preview updates but clay triangles stay at `0`, the issue is likely in input-to-sculpt routing, not in rendering alone.
- A temporary debug hook exists in `src/sculpting/sculpt-interaction.ts`:
  - `globalThis.__seamSculptDebug`
  - It is useful for confirming `beginStroke`, `updateStroke`, and `endStroke` calls during browser-driven tests.

## Working Style Expectations
- Prefer small, end-to-end checks over theoretical reasoning.
- When changing interaction or sculpting code, verify both:
  - unit tests
  - one browser harness flow through `window.__seam` or `?play=<id>`
- Avoid assuming desktop harness behavior matches VR until it is verified.
