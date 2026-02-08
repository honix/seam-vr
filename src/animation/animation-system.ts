import { Vec3, Vec4 } from '../types';
import { SceneGraph } from '../core/scene-graph';
import { AnimationTrack } from './animation-track';

export class AnimationSystem {
  tracks: AnimationTrack[] = [];

  addTrack(track: AnimationTrack): void {
    this.tracks.push(track);
  }

  removeTrack(index: number): void {
    if (index >= 0 && index < this.tracks.length) {
      this.tracks.splice(index, 1);
    }
  }

  evaluate(time: number, sceneGraph: SceneGraph): void {
    for (const track of this.tracks) {
      const node = sceneGraph.getNode(track.targetId);
      if (!node) continue;

      const value = track.evaluate(time);
      this.applyValue(node, track.property, value);
    }
  }

  getDuration(): number {
    let max = 0;
    for (const track of this.tracks) {
      const d = track.getDuration();
      if (d > max) max = d;
    }
    return max;
  }

  clear(): void {
    this.tracks = [];
  }

  private applyValue(
    node: any,
    property: string,
    value: number | Vec3 | Vec4
  ): void {
    // Support dotted paths like 'transform.position', 'params.radiusTop', 'bend.angle'
    const parts = property.split('.');

    if (parts.length === 1) {
      // Direct property on node
      node[property] = value;
      return;
    }

    // Navigate to parent object
    let target: any = node;
    for (let i = 0; i < parts.length - 1; i++) {
      target = target[parts[i]];
      if (target == null) return;
    }

    const finalProp = parts[parts.length - 1];
    target[finalProp] = value;

    // If we changed a transform property, sync the mesh
    if (parts[0] === 'transform' && node.mesh) {
      if (finalProp === 'position') {
        const pos = value as Vec3;
        node.mesh.position.set(pos[0], pos[1], pos[2]);
      } else if (finalProp === 'rotation') {
        const rot = value as Vec4;
        node.mesh.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
      } else if (finalProp === 'scale') {
        const s = value as Vec3;
        node.mesh.scale.set(s[0], s[1], s[2]);
      }
    }
  }
}
