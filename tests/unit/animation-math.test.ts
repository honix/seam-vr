import { describe, it, expect } from 'vitest';
import {
  lerp,
  lerpVec3,
  slerp,
  easeIn,
  easeOut,
  easeInOut,
  applyEasing,
} from '../../src/animation/keyframe';
import { AnimationTrack } from '../../src/animation/animation-track';
import { Vec3, Vec4 } from '../../src/types';

describe('lerp', () => {
  it('should return a at t=0', () => {
    expect(lerp(0, 10, 0)).toBe(0);
  });

  it('should return b at t=1', () => {
    expect(lerp(0, 10, 1)).toBe(10);
  });

  it('should return midpoint at t=0.5', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('should handle negative values', () => {
    expect(lerp(-5, 5, 0.5)).toBe(0);
  });
});

describe('lerpVec3', () => {
  it('should interpolate each component', () => {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [10, 20, 30];
    const result = lerpVec3(a, b, 0.5);
    expect(result[0]).toBe(5);
    expect(result[1]).toBe(10);
    expect(result[2]).toBe(15);
  });

  it('should return a at t=0', () => {
    const a: Vec3 = [1, 2, 3];
    const b: Vec3 = [4, 5, 6];
    const result = lerpVec3(a, b, 0);
    expect(result).toEqual([1, 2, 3]);
  });

  it('should return b at t=1', () => {
    const a: Vec3 = [1, 2, 3];
    const b: Vec3 = [4, 5, 6];
    const result = lerpVec3(a, b, 1);
    expect(result).toEqual([4, 5, 6]);
  });
});

describe('slerp', () => {
  it('should return a at t=0', () => {
    const a: Vec4 = [0, 0, 0, 1]; // identity
    const b: Vec4 = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)]; // 90deg Y
    const result = slerp(a, b, 0);
    expect(result[0]).toBeCloseTo(0, 5);
    expect(result[1]).toBeCloseTo(0, 5);
    expect(result[2]).toBeCloseTo(0, 5);
    expect(result[3]).toBeCloseTo(1, 5);
  });

  it('should return b at t=1', () => {
    const a: Vec4 = [0, 0, 0, 1];
    const b: Vec4 = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];
    const result = slerp(a, b, 1);
    expect(result[0]).toBeCloseTo(0, 5);
    expect(result[1]).toBeCloseTo(Math.sin(Math.PI / 4), 5);
    expect(result[2]).toBeCloseTo(0, 5);
    expect(result[3]).toBeCloseTo(Math.cos(Math.PI / 4), 5);
  });

  it('should produce unit quaternion at midpoint for 90-degree rotation', () => {
    const a: Vec4 = [0, 0, 0, 1];
    const b: Vec4 = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];
    const result = slerp(a, b, 0.5);

    // Should be a 45-degree rotation around Y
    const halfAngle = Math.PI / 8; // 22.5 degrees
    expect(result[0]).toBeCloseTo(0, 4);
    expect(result[1]).toBeCloseTo(Math.sin(halfAngle), 4);
    expect(result[2]).toBeCloseTo(0, 4);
    expect(result[3]).toBeCloseTo(Math.cos(halfAngle), 4);

    // Verify unit length
    const len = Math.sqrt(
      result[0] ** 2 + result[1] ** 2 + result[2] ** 2 + result[3] ** 2
    );
    expect(len).toBeCloseTo(1, 5);
  });

  it('should handle opposite quaternions (take shorter path)', () => {
    const a: Vec4 = [0, 0, 0, 1];
    const b: Vec4 = [0, 0, 0, -1]; // Same rotation, negated
    const result = slerp(a, b, 0.5);
    const len = Math.sqrt(
      result[0] ** 2 + result[1] ** 2 + result[2] ** 2 + result[3] ** 2
    );
    expect(len).toBeCloseTo(1, 5);
  });
});

describe('easing functions', () => {
  describe('easeIn', () => {
    it('should be 0 at t=0', () => {
      expect(easeIn(0)).toBe(0);
    });
    it('should be 1 at t=1', () => {
      expect(easeIn(1)).toBe(1);
    });
    it('should be less than linear at t=0.5', () => {
      expect(easeIn(0.5)).toBe(0.25);
      expect(easeIn(0.5)).toBeLessThan(0.5);
    });
  });

  describe('easeOut', () => {
    it('should be 0 at t=0', () => {
      expect(easeOut(0)).toBe(0);
    });
    it('should be 1 at t=1', () => {
      expect(easeOut(1)).toBe(1);
    });
    it('should be greater than linear at t=0.5', () => {
      expect(easeOut(0.5)).toBe(0.75);
      expect(easeOut(0.5)).toBeGreaterThan(0.5);
    });
  });

  describe('easeInOut', () => {
    it('should be 0 at t=0', () => {
      expect(easeInOut(0)).toBe(0);
    });
    it('should be 1 at t=1', () => {
      expect(easeInOut(1)).toBe(1);
    });
    it('should be 0.5 at t=0.5', () => {
      expect(easeInOut(0.5)).toBe(0.5);
    });
    it('should be symmetric', () => {
      expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1, 5);
    });
  });

  describe('applyEasing', () => {
    it('should pass through for linear', () => {
      expect(applyEasing(0.5, 'linear')).toBe(0.5);
    });
    it('should apply ease-in', () => {
      expect(applyEasing(0.5, 'ease-in')).toBe(0.25);
    });
    it('should apply ease-out', () => {
      expect(applyEasing(0.5, 'ease-out')).toBe(0.75);
    });
    it('should apply ease-in-out', () => {
      expect(applyEasing(0.5, 'ease-in-out')).toBe(0.5);
    });
    it('step should return 0 before t=1', () => {
      expect(applyEasing(0.0, 'step')).toBe(0);
      expect(applyEasing(0.5, 'step')).toBe(0);
      expect(applyEasing(0.99, 'step')).toBe(0);
    });
    it('step should return 1 at t=1', () => {
      expect(applyEasing(1.0, 'step')).toBe(1);
    });
  });
});

describe('AnimationTrack', () => {
  it('should evaluate between keyframes with linear interpolation', () => {
    const track = new AnimationTrack('node1', 'params.height');
    track.addKeyframe({ time: 0, value: 0, interpolation: 'linear' });
    track.addKeyframe({ time: 2, value: 10, interpolation: 'linear' });

    expect(track.evaluate(0)).toBe(0);
    expect(track.evaluate(1)).toBe(5);
    expect(track.evaluate(2)).toBe(10);
  });

  it('should hold first value before first keyframe', () => {
    const track = new AnimationTrack('node1', 'params.height');
    track.addKeyframe({ time: 1, value: 5, interpolation: 'linear' });
    track.addKeyframe({ time: 3, value: 15, interpolation: 'linear' });

    expect(track.evaluate(0)).toBe(5);
    expect(track.evaluate(-10)).toBe(5);
  });

  it('should hold last value after last keyframe', () => {
    const track = new AnimationTrack('node1', 'params.height');
    track.addKeyframe({ time: 0, value: 0, interpolation: 'linear' });
    track.addKeyframe({ time: 2, value: 10, interpolation: 'linear' });

    expect(track.evaluate(2)).toBe(10);
    expect(track.evaluate(100)).toBe(10);
  });

  it('should interpolate Vec3 values', () => {
    const track = new AnimationTrack('node1', 'transform.position');
    track.addKeyframe({
      time: 0,
      value: [0, 0, 0] as Vec3,
      interpolation: 'linear',
    });
    track.addKeyframe({
      time: 2,
      value: [10, 20, 30] as Vec3,
      interpolation: 'linear',
    });

    const result = track.evaluate(1) as Vec3;
    expect(result[0]).toBeCloseTo(5);
    expect(result[1]).toBeCloseTo(10);
    expect(result[2]).toBeCloseTo(15);
  });

  it('should use slerp for rotation properties', () => {
    const track = new AnimationTrack('node1', 'transform.rotation');
    const a: Vec4 = [0, 0, 0, 1];
    const b: Vec4 = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];

    track.addKeyframe({ time: 0, value: a, interpolation: 'linear' });
    track.addKeyframe({ time: 1, value: b, interpolation: 'linear' });

    const result = track.evaluate(0.5) as Vec4;
    // Should be a 45-degree rotation around Y
    const halfAngle = Math.PI / 8;
    expect(result[1]).toBeCloseTo(Math.sin(halfAngle), 3);
    expect(result[3]).toBeCloseTo(Math.cos(halfAngle), 3);
  });

  it('should handle multiple keyframes', () => {
    const track = new AnimationTrack('node1', 'params.height');
    track.addKeyframe({ time: 0, value: 0, interpolation: 'linear' });
    track.addKeyframe({ time: 1, value: 10, interpolation: 'linear' });
    track.addKeyframe({ time: 3, value: 30, interpolation: 'linear' });

    expect(track.evaluate(0.5)).toBeCloseTo(5);
    expect(track.evaluate(1)).toBe(10);
    expect(track.evaluate(2)).toBeCloseTo(20);
  });

  it('should apply easing between keyframes', () => {
    const track = new AnimationTrack('node1', 'params.height');
    track.addKeyframe({ time: 0, value: 0, interpolation: 'ease-in' });
    track.addKeyframe({ time: 2, value: 10, interpolation: 'linear' });

    // At t=1, raw t = 0.5, ease-in(0.5) = 0.25
    expect(track.evaluate(1)).toBeCloseTo(2.5);
  });

  it('should return 0 for empty track', () => {
    const track = new AnimationTrack('node1', 'params.height');
    expect(track.evaluate(0)).toBe(0);
  });

  it('should insert keyframes in sorted order', () => {
    const track = new AnimationTrack('node1', 'params.height');
    track.addKeyframe({ time: 3, value: 30, interpolation: 'linear' });
    track.addKeyframe({ time: 1, value: 10, interpolation: 'linear' });
    track.addKeyframe({ time: 2, value: 20, interpolation: 'linear' });

    expect(track.keyframes[0].time).toBe(1);
    expect(track.keyframes[1].time).toBe(2);
    expect(track.keyframes[2].time).toBe(3);
  });

  it('should report correct duration', () => {
    const track = new AnimationTrack('node1', 'params.height');
    track.addKeyframe({ time: 0, value: 0, interpolation: 'linear' });
    track.addKeyframe({ time: 5, value: 50, interpolation: 'linear' });

    expect(track.getDuration()).toBe(5);
  });

  it('should remove keyframes by index', () => {
    const track = new AnimationTrack('node1', 'params.height');
    track.addKeyframe({ time: 0, value: 0, interpolation: 'linear' });
    track.addKeyframe({ time: 1, value: 10, interpolation: 'linear' });
    track.addKeyframe({ time: 2, value: 20, interpolation: 'linear' });

    track.removeKeyframe(1);
    expect(track.keyframes.length).toBe(2);
    expect(track.keyframes[1].time).toBe(2);
  });
});

describe('PerformanceCapture', () => {
  it('should start, capture frames, and stop producing tracks', async () => {
    // Minimal SceneGraph mock
    const mockNode = {
      id: 'test-node',
      transform: {
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0, 1] as Vec4,
        scale: [1, 1, 1] as Vec3,
      },
    };

    const mockGraph = {
      getNode: (id: string) => (id === 'test-node' ? mockNode : undefined),
    };

    // Dynamic import to avoid THREE dependency issues in unit tests
    const { PerformanceCapture } = await import(
      '../../src/animation/performance-capture'
    );

    const capture = new PerformanceCapture(mockGraph as any);

    expect(capture.isRecording).toBe(false);

    capture.startRecording(['test-node']);
    expect(capture.isRecording).toBe(true);

    // Simulate several frames with movement
    for (let i = 0; i < 10; i++) {
      mockNode.transform.position = [i * 0.1, 0, 0];
      capture.captureFrame(i * (1 / 30));
    }

    const tracks = capture.stopRecording();
    expect(capture.isRecording).toBe(false);

    // Should produce position and rotation tracks
    expect(tracks.length).toBe(2);

    const posTrack = tracks.find((t) => t.property === 'transform.position');
    const rotTrack = tracks.find((t) => t.property === 'transform.rotation');

    expect(posTrack).toBeDefined();
    expect(rotTrack).toBeDefined();

    // Position track should have keyframes
    expect(posTrack!.keyframes.length).toBeGreaterThan(0);
    expect(posTrack!.keyframes.length).toBeLessThanOrEqual(10);
  });
});
