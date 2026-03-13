import type {
  PlayCapture,
  PlayContext,
  PlayFrameSample,
  PlayHarnessActions,
  PlayMeasurementResult,
  PlayRunError,
  PlayRunResult,
  PlayRunnerOptions,
  PlayScenario,
  PlayScenarioSummary,
} from './play-types';

interface WaitFramesEntry {
  targetFrame: number;
  resolve: () => void;
}

interface MeasurementState {
  label: string;
  startedAt: number;
  samples: PlayFrameSample[];
}

interface LoggedPlayCapture {
  label: string;
}

interface LoggedPlayRunResult extends Omit<PlayRunResult, 'captures'> {
  captures: LoggedPlayCapture[];
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeMeasurement(
  label: string,
  durationMs: number,
  samples: PlayFrameSample[],
): PlayMeasurementResult {
  const frameTimes = samples.map((sample) => sample.frameMs);
  const renderTimes = samples.map((sample) => sample.renderMs);

  return {
    label,
    durationMs,
    frameCount: samples.length,
    avgFrameMs: average(frameTimes),
    minFrameMs: frameTimes.length === 0 ? 0 : Math.min(...frameTimes),
    maxFrameMs: frameTimes.length === 0 ? 0 : Math.max(...frameTimes),
    avgRenderMs: average(renderTimes),
    maxRenderMs: renderTimes.length === 0 ? 0 : Math.max(...renderTimes),
    maxDrawCalls: samples.length === 0 ? 0 : Math.max(...samples.map((sample) => sample.drawCalls)),
    maxTriangles: samples.length === 0 ? 0 : Math.max(...samples.map((sample) => sample.triangles)),
    maxGeometries: samples.length === 0 ? 0 : Math.max(...samples.map((sample) => sample.geometries)),
    maxTextures: samples.length === 0 ? 0 : Math.max(...samples.map((sample) => sample.textures)),
  };
}

export function getPlayIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  const playId = params.get('play')?.trim() ?? '';
  return playId.length > 0 ? playId : null;
}

function toLoggedResult(result: PlayRunResult): LoggedPlayRunResult {
  return {
    ...result,
    captures: result.captures.map((capture) => ({
      label: capture.label,
    })),
  };
}

export class PlayRunner {
  private readonly scenarios = new Map<string, PlayScenario>();
  private readonly actions: PlayHarnessActions;
  private readonly onLastRunChanged?: (result: PlayRunResult | null) => void;

  private currentRun: Promise<PlayRunResult> | null = null;
  private activeMeasurement: MeasurementState | null = null;
  private waitFramesQueue: WaitFramesEntry[] = [];
  private frameIndex = 0;
  private captures: PlayCapture[] = [];
  private measurements: PlayMeasurementResult[] = [];
  private lastRun: PlayRunResult | null = null;

  constructor(options: PlayRunnerOptions) {
    this.actions = options.actions;
    this.onLastRunChanged = options.onLastRunChanged;
    for (const scenario of options.scenarios) {
      this.scenarios.set(scenario.id, scenario);
    }
  }

  list(): PlayScenarioSummary[] {
    return [...this.scenarios.values()].map((scenario) => ({
      id: scenario.id,
      description: scenario.description,
      tags: scenario.tags,
    }));
  }

  getLastRun(): PlayRunResult | null {
    return this.lastRun;
  }

  onFrame(sample: PlayFrameSample): void {
    this.frameIndex += 1;

    if (this.activeMeasurement) {
      this.activeMeasurement.samples.push(sample);
    }

    const ready = this.waitFramesQueue.filter((entry) => entry.targetFrame <= this.frameIndex);
    if (ready.length === 0) return;

    this.waitFramesQueue = this.waitFramesQueue.filter((entry) => entry.targetFrame > this.frameIndex);
    for (const entry of ready) {
      entry.resolve();
    }
  }

  async autoRunFromSearch(search: string): Promise<void> {
    const playId = getPlayIdFromSearch(search);
    if (!playId) return;
    await this.run(playId);
  }

  async run(id: string): Promise<PlayRunResult> {
    if (this.currentRun) {
      throw new Error('A play run is already in progress');
    }

    const scenario = this.scenarios.get(id);
    if (!scenario) {
      const result = this.createFailureResult(id, new Error(`Unknown play scenario: ${id}`), performance.now(), performance.now());
      this.finishRun(result);
      console.error(`[Play] Unknown scenario: ${id}`);
      this.logResult(result);
      return result;
    }

    this.currentRun = this.executeScenario(scenario);
    try {
      return await this.currentRun;
    } finally {
      this.currentRun = null;
    }
  }

  private async executeScenario(scenario: PlayScenario): Promise<PlayRunResult> {
    this.measurements = [];
    this.captures = [];
    const startPerf = performance.now();
    const startedAt = new Date().toISOString();

    try {
      await scenario.run(this.createContext());
      const endPerf = performance.now();
      const result: PlayRunResult = {
        id: scenario.id,
        status: 'passed',
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: endPerf - startPerf,
        measurements: [...this.measurements],
        captures: [...this.captures],
      };
      this.finishRun(result);
      this.logResult(result);
      return result;
    } catch (error) {
      const endPerf = performance.now();
      const result = this.createFailureResult(scenario.id, error, startPerf, endPerf, startedAt);
      this.finishRun(result);
      console.error(`[Play] Scenario failed: ${scenario.id}`, error);
      this.logResult(result);
      return result;
    }
  }

  private createContext(): PlayContext {
    return {
      exec: (cmd) => {
        this.actions.exec(cmd);
      },
      select: (nodeId) => {
        this.actions.select(nodeId);
      },
      activateClay: (nodeId) => {
        this.actions.activateClay(nodeId);
      },
      setTool: (hand, tool) => {
        this.actions.setTool(hand, tool);
      },
      panelState: () => this.actions.panelState(),
      xr: {
        pose: (hand, position, rotation) => {
          this.actions.xrPose(hand, position, rotation);
        },
        press: (hand, button) => {
          this.actions.xrButton(hand, button, true);
        },
        release: (hand, button) => {
          this.actions.xrButton(hand, button, false);
        },
        thumbstick: (hand, x, y) => {
          this.actions.xrThumbstick(hand, x, y);
        },
      },
      waitFrames: (count) => this.waitFrames(count),
      waitMs: (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
      focus: (target, distance) => {
        this.actions.focus(target, distance);
      },
      reset: () => this.actions.reset(),
      measure: async (label, fn) => this.measure(label, fn),
      snapshotScene: () => this.actions.snapshotScene(),
      clayStats: (nodeId) => this.actions.clayStats(nodeId),
      captureViewport: (label) => this.captureViewport(label),
    };
  }

  private waitFrames(count: number): Promise<void> {
    if (count <= 0) return Promise.resolve();

    return new Promise((resolve) => {
      this.waitFramesQueue.push({
        targetFrame: this.frameIndex + count,
        resolve,
      });
    });
  }

  private async measure(label: string, fn: () => Promise<void> | void): Promise<PlayMeasurementResult> {
    if (this.activeMeasurement) {
      throw new Error(`Nested play measurements are not supported (${label})`);
    }

    const state: MeasurementState = {
      label,
      startedAt: performance.now(),
      samples: [],
    };
    this.activeMeasurement = state;

    try {
      await fn();
    } finally {
      this.activeMeasurement = null;
    }

    const result = summarizeMeasurement(label, performance.now() - state.startedAt, state.samples);
    this.measurements.push(result);
    console.log(
      `[Play] ${label}: frames=${result.frameCount}, avgFrame=${result.avgFrameMs.toFixed(2)}ms, ` +
      `maxFrame=${result.maxFrameMs.toFixed(2)}ms, avgRender=${result.avgRenderMs.toFixed(2)}ms, ` +
      `maxDrawCalls=${result.maxDrawCalls}`,
    );
    return result;
  }

  private captureViewport(label?: string): string {
    const dataUrl = this.actions.captureViewport();
    this.captures.push({
      label: label ?? `capture_${this.captures.length + 1}`,
      dataUrl,
    });
    return dataUrl;
  }

  private createFailureResult(
    id: string,
    error: unknown,
    startPerf: number,
    endPerf: number,
    startedAt = new Date().toISOString(),
  ): PlayRunResult {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const errorInfo: PlayRunError = {
      message: normalizedError.message,
      stack: normalizedError.stack,
    };

    return {
      id,
      status: 'failed',
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: endPerf - startPerf,
      measurements: [...this.measurements],
      captures: [...this.captures],
      error: errorInfo,
    };
  }

  private finishRun(result: PlayRunResult): void {
    this.lastRun = result;
    this.onLastRunChanged?.(result);
    this.activeMeasurement = null;
    this.waitFramesQueue = [];
  }

  private logResult(result: PlayRunResult): void {
    console.log(
      `[Play] ${result.id} ${result.status} in ${result.durationMs.toFixed(1)}ms ` +
      `(${result.measurements.length} measurements, ${result.captures.length} captures)`,
    );
    console.log('[PlayResult]', JSON.stringify(toLoggedResult(result)));
  }
}
