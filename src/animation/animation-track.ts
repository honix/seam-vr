import { Vec3, Vec4 } from '../types';
import { Keyframe, lerp, lerpVec3, slerp, applyEasing } from './keyframe';

export class AnimationTrack {
  targetId: string;
  property: string;
  keyframes: Keyframe[] = [];

  constructor(targetId: string, property: string) {
    this.targetId = targetId;
    this.property = property;
  }

  addKeyframe(kf: Keyframe): void {
    // Insert in sorted order by time
    const idx = this.keyframes.findIndex((k) => k.time > kf.time);
    if (idx === -1) {
      this.keyframes.push(kf);
    } else {
      this.keyframes.splice(idx, 0, kf);
    }
  }

  removeKeyframe(index: number): void {
    if (index >= 0 && index < this.keyframes.length) {
      this.keyframes.splice(index, 1);
    }
  }

  evaluate(time: number): number | Vec3 | Vec4 {
    if (this.keyframes.length === 0) {
      return 0;
    }

    // Before first keyframe: hold first value
    if (time <= this.keyframes[0].time) {
      return this.keyframes[0].value;
    }

    // After last keyframe: hold last value
    const last = this.keyframes[this.keyframes.length - 1];
    if (time >= last.time) {
      return last.value;
    }

    // Find surrounding keyframes
    let i = 0;
    while (i < this.keyframes.length - 1 && this.keyframes[i + 1].time <= time) {
      i++;
    }

    const kfA = this.keyframes[i];
    const kfB = this.keyframes[i + 1];

    // Compute normalized time between keyframes
    const duration = kfB.time - kfA.time;
    if (duration <= 0) return kfA.value;

    const rawT = (time - kfA.time) / duration;
    const t = applyEasing(rawT, kfA.interpolation);

    return this.interpolateValues(kfA.value, kfB.value, t);
  }

  getDuration(): number {
    if (this.keyframes.length === 0) return 0;
    return this.keyframes[this.keyframes.length - 1].time;
  }

  private interpolateValues(
    a: number | Vec3 | Vec4,
    b: number | Vec3 | Vec4,
    t: number
  ): number | Vec3 | Vec4 {
    // Scalar
    if (typeof a === 'number' && typeof b === 'number') {
      return lerp(a, b, t);
    }

    const arrA = a as number[];
    const arrB = b as number[];

    // Quaternion (Vec4) - use slerp for rotation properties
    if (arrA.length === 4 && arrB.length === 4 && this.isRotationProperty()) {
      return slerp(arrA as Vec4, arrB as Vec4, t);
    }

    // Vec3
    if (arrA.length === 3 && arrB.length === 3) {
      return lerpVec3(arrA as Vec3, arrB as Vec3, t);
    }

    // Vec4 non-rotation: component-wise lerp
    if (arrA.length === 4 && arrB.length === 4) {
      return [
        lerp(arrA[0], arrB[0], t),
        lerp(arrA[1], arrB[1], t),
        lerp(arrA[2], arrB[2], t),
        lerp(arrA[3], arrB[3], t),
      ] as Vec4;
    }

    // Fallback
    return a;
  }

  private isRotationProperty(): boolean {
    return this.property.includes('rotation');
  }
}
