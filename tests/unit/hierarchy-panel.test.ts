import { describe, expect, it } from 'vitest';
import { SceneGraph, SceneNode } from '../../src/core/scene-graph';
import { buildHierarchyRows } from '../../src/ui/hierarchy-panel';

describe('buildHierarchyRows', () => {
  it('includes a selectable scene root row', () => {
    const sceneGraph = new SceneGraph();

    const rows = buildHierarchyRows(sceneGraph.getRoot(), '__root__');

    expect(rows[0]).toMatchObject({
      nodeId: '__root__',
      text: 'Scene Root',
      selected: true,
    });
  });

  it('shows visible parent-child structure with branch markers', () => {
    const sceneGraph = new SceneGraph();
    const clayNode = new SceneNode('clay_1', 'box');
    clayNode.nodeType = 'clay';
    clayNode.layerType = 'clay';
    const groupNode = new SceneNode('group_1', 'box');
    groupNode.nodeType = 'group';
    groupNode.layerType = 'group';
    const childNode = new SceneNode('cube_1', 'box');

    sceneGraph.addNode(clayNode);
    sceneGraph.addNode(groupNode);
    sceneGraph.addNode(childNode);
    sceneGraph.reparent('cube_1', 'group_1');

    const rows = buildHierarchyRows(sceneGraph.getRoot(), 'cube_1');

    expect(rows.map((row) => row.text)).toEqual([
      'Scene Root',
      '\u251c\u2500 clay_1',
      '\u2514\u2500 group_1',
      '   \u2514\u2500 cube_1',
    ]);
    expect(rows[3]?.selected).toBe(true);
  });
});
