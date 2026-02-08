import { Vec3, Vec4 } from '../types';
import { SceneGraph } from '../core/scene-graph';
import { AnimationTrack } from './animation-track';
import { Keyframe } from './keyframe';

interface CaptureFrame {
  time: number;
  position: Vec3;
  rotation: Vec4;
}

export class PerformanceCapture {
  private sceneGraph: SceneGraph;
  private trackedIds: string[] = [];
  private frameData: Map<string, CaptureFrame[]> = new Map();

  isRecording = false;

  constructor(sceneGraph: SceneGraph) {
    this.sceneGraph = sceneGraph;
  }

  startRecording(nodeIds: string[]): void {
    this.trackedIds = [...nodeIds];
    this.frameData.clear();
    for (const id of nodeIds) {
      this.frameData.set(id, []);
    }
    this.isRecording = true;
  }

  captureFrame(time: number): void {
    if (!this.isRecording) return;

    for (const id of this.trackedIds) {
      const node = this.sceneGraph.getNode(id);
      if (!node) continue;

      const frames = this.frameData.get(id);
      if (!frames) continue;

      frames.push({
        time,
        position: [...node.transform.position] as Vec3,
        rotation: [...node.transform.rotation] as Vec4,
      });
    }
  }

  stopRecording(): AnimationTrack[] {
    this.isRecording = false;
    const tracks: AnimationTrack[] = [];

    for (const id of this.trackedIds) {
      const frames = this.frameData.get(id);
      if (!frames || frames.length === 0) continue;

      // Create position track
      const posTrack = new AnimationTrack(id, 'transform.position');
      const simplifiedPos = this.simplifyVec3Frames(frames, 'position', 0.001);
      for (const kf of simplifiedPos) {
        posTrack.addKeyframe(kf);
      }
      tracks.push(posTrack);

      // Create rotation track
      const rotTrack = new AnimationTrack(id, 'transform.rotation');
      const simplifiedRot = this.simplifyVec4Frames(frames, 'rotation', 0.001);
      for (const kf of simplifiedRot) {
        rotTrack.addKeyframe(kf);
      }
      tracks.push(rotTrack);
    }

    this.trackedIds = [];
    this.frameData.clear();
    return tracks;
  }

  private simplifyVec3Frames(
    frames: CaptureFrame[],
    prop: 'position',
    epsilon: number
  ): Keyframe[] {
    if (frames.length <= 2) {
      return frames.map((f) => ({
        time: f.time,
        value: f[prop],
        interpolation: 'linear' as const,
      }));
    }

    // Ramer-Douglas-Peucker on each axis independently, then merge keep indices
    const keepIndices = this.rdpIndices(
      frames.map((f) => {
        const v = f[prop];
        return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      }),
      epsilon
    );

    // Always keep first and last
    keepIndices.add(0);
    keepIndices.add(frames.length - 1);

    const sorted = Array.from(keepIndices).sort((a, b) => a - b);
    return sorted.map((i) => ({
      time: frames[i].time,
      value: frames[i][prop],
      interpolation: 'linear' as const,
    }));
  }

  private simplifyVec4Frames(
    frames: CaptureFrame[],
    prop: 'rotation',
    epsilon: number
  ): Keyframe[] {
    if (frames.length <= 2) {
      return frames.map((f) => ({
        time: f.time,
        value: f[prop],
        interpolation: 'linear' as const,
      }));
    }

    // Simplified: use quaternion magnitude as 1D signal
    const keepIndices = this.rdpIndices(
      frames.map((f) => {
        const q = f[prop];
        return Math.acos(Math.min(1, Math.abs(q[3]))) * 2;
      }),
      epsilon
    );

    keepIndices.add(0);
    keepIndices.add(frames.length - 1);

    const sorted = Array.from(keepIndices).sort((a, b) => a - b);
    return sorted.map((i) => ({
      time: frames[i].time,
      value: frames[i][prop],
      interpolation: 'linear' as const,
    }));
  }

  // 1D Ramer-Douglas-Peucker: returns set of indices to keep
  private rdpIndices(values: number[], epsilon: number): Set<number> {
    const keep = new Set<number>();
    this.rdpRecurse(values, 0, values.length - 1, epsilon, keep);
    return keep;
  }

  private rdpRecurse(
    values: number[],
    start: number,
    end: number,
    epsilon: number,
    keep: Set<number>
  ): void {
    if (end - start <= 1) return;

    // Find the point with max distance from the line between start and end
    const startVal = values[start];
    const endVal = values[end];
    const range = end - start;

    let maxDist = 0;
    let maxIdx = start;

    for (let i = start + 1; i < end; i++) {
      const t = (i - start) / range;
      const interpolated = startVal + (endVal - startVal) * t;
      const dist = Math.abs(values[i] - interpolated);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon) {
      keep.add(maxIdx);
      this.rdpRecurse(values, start, maxIdx, epsilon, keep);
      this.rdpRecurse(values, maxIdx, end, epsilon, keep);
    }
  }
}
