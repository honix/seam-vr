import type { Command } from '../core/command-bus';
import type { ToolId } from '../interaction/tool-system';
import type { Hand, Vec3, Vec4 } from '../types';

export type PlayXRButton = 'trigger' | 'grip' | 'a' | 'b';

export interface PlayFrameSample {
  frameMs: number;
  renderMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface PlayMeasurementResult {
  label: string;
  durationMs: number;
  frameCount: number;
  avgFrameMs: number;
  minFrameMs: number;
  maxFrameMs: number;
  avgRenderMs: number;
  maxRenderMs: number;
  maxDrawCalls: number;
  maxTriangles: number;
  maxGeometries: number;
  maxTextures: number;
}

export interface PlayCapture {
  label: string;
  dataUrl: string;
}

export interface PlayRunError {
  message: string;
  stack?: string;
}

export interface PlayRunResult {
  id: string;
  status: 'passed' | 'failed';
  startedAt: string;
  endedAt: string;
  durationMs: number;
  measurements: PlayMeasurementResult[];
  captures: PlayCapture[];
  error?: PlayRunError;
}

export interface PlayScenarioSummary {
  id: string;
  description?: string;
  tags?: string[];
}

export interface PlayScenario {
  id: string;
  description?: string;
  tags?: string[];
  run: (ctx: PlayContext) => Promise<void> | void;
}

export interface PlayContext {
  exec(cmd: Command): void;
  select(nodeId: string | null): void;
  activateClay(nodeId: string | null): void;
  setTool(hand: Hand, tool: ToolId): void;
  panelState(): object;
  xr: {
    pose(hand: Hand, position: Vec3, rotation?: Vec4): void;
    press(hand: Hand, button: PlayXRButton): void;
    release(hand: Hand, button: PlayXRButton): void;
    thumbstick(hand: Hand, x: number, y: number): void;
  };
  waitFrames(count: number): Promise<void>;
  waitMs(ms: number): Promise<void>;
  focus(target: Vec3, distance?: number): void;
  reset(): Promise<void>;
  measure(label: string, fn: () => Promise<void> | void): Promise<PlayMeasurementResult>;
  snapshotScene(): object;
  captureViewport(label?: string): string;
}

export interface PlayHarnessActions {
  exec(cmd: Command): void;
  select(nodeId: string | null): void;
  activateClay(nodeId: string | null): void;
  setTool(hand: Hand, tool: ToolId): void;
  panelState(): object;
  xrPose(hand: Hand, position: Vec3, rotation?: Vec4): void;
  xrButton(hand: Hand, button: PlayXRButton, pressed: boolean): void;
  xrThumbstick(hand: Hand, x: number, y: number): void;
  focus(target: Vec3, distance?: number): void;
  reset(): Promise<void>;
  snapshotScene(): object;
  captureViewport(): string;
}

export interface PlayRunnerOptions {
  scenarios: PlayScenario[];
  actions: PlayHarnessActions;
  onLastRunChanged?: (result: PlayRunResult | null) => void;
}
