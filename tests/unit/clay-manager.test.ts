import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SceneGraph, SceneNode } from '../../src/core/scene-graph';
import { ClayManager } from '../../src/sculpting/clay-manager';

vi.mock('../../src/sculpting/sculpt-engine', () => {
  class SculptEngine {
    brushStrength = 0;
    brushRadius = 0;
    brushType = 'add';

    constructor(_parent: THREE.Object3D) {}

    applyMaterial(): void {}

    async initGPU(): Promise<void> {}

    dispose(): void {}

    stroke(): void {}

    smoothStroke(): void {}

    endStroke(): void {}
  }

  return { SculptEngine };
});

function createClayNode(id: string, anchor: THREE.Object3D): SceneNode {
  const node = new SceneNode(id, 'box');
  node.nodeType = 'clay';
  node.layerType = 'clay';
  node.clayData = { clayId: id };
  node.object3D = anchor;
  return node;
}

describe('ClayManager', () => {
  it('converts worldGroup-local controller hits into active clay local space', () => {
    const sceneGraph = new SceneGraph();
    const worldGroup = new THREE.Group();
    worldGroup.position.set(0, 1.5, 0);

    const clayAnchor = new THREE.Group();
    clayAnchor.position.set(0.25, 2, -0.5);
    clayAnchor.scale.setScalar(2);
    worldGroup.add(clayAnchor);

    const clayNode = createClayNode('clay_1', clayAnchor);
    sceneGraph.addNode(clayNode);

    const clayManager = new ClayManager(sceneGraph, worldGroup);
    clayManager.setActiveClay('clay_1');

    const localHit = clayManager.toActiveClayLocalPosition([1.25, 2.4, 0.3]);

    expect(localHit).not.toBeNull();
    expect(localHit![0]).toBeCloseTo(0.5, 6);
    expect(localHit![1]).toBeCloseTo(0.2, 6);
    expect(localHit![2]).toBeCloseTo(0.4, 6);
  });

  it('scales brush radius into active clay local space', () => {
    const sceneGraph = new SceneGraph();
    const worldGroup = new THREE.Group();

    const clayAnchor = new THREE.Group();
    clayAnchor.scale.set(2, 3, 4);
    worldGroup.add(clayAnchor);

    const clayNode = createClayNode('clay_1', clayAnchor);
    sceneGraph.addNode(clayNode);

    const clayManager = new ClayManager(sceneGraph, worldGroup);
    clayManager.setActiveClay('clay_1');

    expect(clayManager.toActiveClayLocalRadius(0.8)).toBeCloseTo(0.2, 6);
  });
});
