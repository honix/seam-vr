import { describe, it, expect, vi } from 'vitest';
import { SceneGraph, SceneNode } from '../../src/core/scene-graph';

describe('SceneGraph', () => {
  function makeNode(id: string, type: 'box' | 'sphere' = 'box'): SceneNode {
    return new SceneNode(id, type);
  }

  describe('addNode', () => {
    it('adds a node to the graph', () => {
      const sg = new SceneGraph();
      const node = makeNode('a');
      sg.addNode(node);
      expect(sg.getNode('a')).toBe(node);
    });

    it('sets parent to root', () => {
      const sg = new SceneGraph();
      const node = makeNode('a');
      sg.addNode(node);
      expect(node.parent).toBe(sg.getRoot());
    });

    it('adds to root children', () => {
      const sg = new SceneGraph();
      sg.addNode(makeNode('a'));
      sg.addNode(makeNode('b'));
      expect(sg.getRoot().children).toHaveLength(2);
    });
  });

  describe('removeNode', () => {
    it('removes a node from the graph', () => {
      const sg = new SceneGraph();
      sg.addNode(makeNode('a'));
      sg.removeNode('a');
      expect(sg.getNode('a')).toBeUndefined();
    });

    it('removes node from parent children', () => {
      const sg = new SceneGraph();
      sg.addNode(makeNode('a'));
      sg.removeNode('a');
      expect(sg.getRoot().children).toHaveLength(0);
    });

    it('returns undefined for nonexistent node', () => {
      const sg = new SceneGraph();
      expect(sg.removeNode('nonexistent')).toBeUndefined();
    });

    it('removes children recursively', () => {
      const sg = new SceneGraph();
      sg.addNode(makeNode('parent'));
      sg.addNode(makeNode('child'));
      sg.reparent('child', 'parent');
      sg.removeNode('parent');
      expect(sg.getNode('child')).toBeUndefined();
      expect(sg.getNode('parent')).toBeUndefined();
    });
  });

  describe('getNode', () => {
    it('returns the node by id', () => {
      const sg = new SceneGraph();
      const node = makeNode('x');
      sg.addNode(node);
      expect(sg.getNode('x')).toBe(node);
    });

    it('returns undefined for missing id', () => {
      const sg = new SceneGraph();
      expect(sg.getNode('missing')).toBeUndefined();
    });
  });

  describe('reparent', () => {
    it('moves node under a new parent', () => {
      const sg = new SceneGraph();
      sg.addNode(makeNode('parent'));
      sg.addNode(makeNode('child'));
      sg.reparent('child', 'parent');

      const parentNode = sg.getNode('parent')!;
      const childNode = sg.getNode('child')!;
      expect(childNode.parent).toBe(parentNode);
      expect(parentNode.children).toContain(childNode);
    });

    it('removes from old parent children', () => {
      const sg = new SceneGraph();
      sg.addNode(makeNode('p1'));
      sg.addNode(makeNode('p2'));
      sg.addNode(makeNode('child'));
      sg.reparent('child', 'p1');
      sg.reparent('child', 'p2');

      expect(sg.getNode('p1')!.children).not.toContain(sg.getNode('child'));
      expect(sg.getNode('p2')!.children).toContain(sg.getNode('child'));
    });

    it('reparents to root with null parentId', () => {
      const sg = new SceneGraph();
      sg.addNode(makeNode('parent'));
      sg.addNode(makeNode('child'));
      sg.reparent('child', 'parent');
      sg.reparent('child', null);

      expect(sg.getNode('child')!.parent).toBe(sg.getRoot());
    });
  });

  describe('traverse', () => {
    it('visits all nodes depth-first', () => {
      const sg = new SceneGraph();
      sg.addNode(makeNode('a'));
      sg.addNode(makeNode('b'));
      sg.addNode(makeNode('c'));
      sg.reparent('b', 'a');

      const visited: string[] = [];
      sg.traverse((node) => visited.push(node.id));

      // 'a' is root child, 'b' is child of 'a', 'c' is root child
      expect(visited).toEqual(['a', 'b', 'c']);
    });

    it('visits no nodes on empty graph', () => {
      const sg = new SceneGraph();
      const visited: string[] = [];
      sg.traverse((node) => visited.push(node.id));
      expect(visited).toEqual([]);
    });
  });

  describe('getAllNodes', () => {
    it('returns all non-root nodes', () => {
      const sg = new SceneGraph();
      sg.addNode(makeNode('a'));
      sg.addNode(makeNode('b'));
      const all = sg.getAllNodes();
      expect(all).toHaveLength(2);
      expect(all.map((n) => n.id).sort()).toEqual(['a', 'b']);
    });

    it('returns empty array when no nodes', () => {
      const sg = new SceneGraph();
      expect(sg.getAllNodes()).toEqual([]);
    });
  });

  describe('events', () => {
    it('emits node:added on addNode', () => {
      const sg = new SceneGraph();
      const handler = vi.fn();
      sg.on('node:added', handler);

      const node = makeNode('a');
      sg.addNode(node);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ node });
    });

    it('emits node:removed on removeNode', () => {
      const sg = new SceneGraph();
      const handler = vi.fn();
      sg.on('node:removed', handler);

      const node = makeNode('a');
      sg.addNode(node);
      sg.removeNode('a');

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('emits node:updated on reparent', () => {
      const sg = new SceneGraph();
      const handler = vi.fn();
      sg.on('node:updated', handler);

      sg.addNode(makeNode('parent'));
      sg.addNode(makeNode('child'));
      sg.reparent('child', 'parent');

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('removes all nodes', () => {
      const sg = new SceneGraph();
      sg.addNode(makeNode('a'));
      sg.addNode(makeNode('b'));
      sg.clear();
      expect(sg.getAllNodes()).toEqual([]);
    });
  });
});
