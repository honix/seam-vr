import { describe, it, expect, vi } from 'vitest';
import { SceneGraph } from '../../src/core/scene-graph';
import { CommandBus } from '../../src/core/command-bus';
import { registerAllCommands } from '../../src/core/commands';

// Mock Three.js - vitest runs in Node, no WebGL
vi.mock('three', () => {
  class Object3D {
    position = new Vector3();
    quaternion = new Quaternion();
    scale = new Vector3(1, 1, 1);
    visible = true;
    parent: Object3D | null = null;
    children: Object3D[] = [];
    type = 'Object3D';
    add(child: Object3D) {
      child.parent = this;
      this.children.push(child);
    }
    remove(child: Object3D) {
      this.children = this.children.filter((item) => item !== child);
      child.parent = null;
    }
    removeFromParent() {
      this.parent?.remove(this);
    }
    attach(child: Object3D) {
      this.add(child);
    }
  }

  class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
  }

  class Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x = 0, y = 0, z = 0, w = 1) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.w = w;
    }
    set(x: number, y: number, z: number, w: number) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.w = w;
      return this;
    }
  }

  class BufferGeometry {
    private attributes = new Map<string, any>();
    dispose() {}
    clone() {
      const clone = new BufferGeometry();
      for (const [key, value] of this.attributes.entries()) {
        clone.setAttribute(key, value);
      }
      return clone;
    }
    setAttribute(name: string, value: any) {
      this.attributes.set(name, value);
    }
    getAttribute(name: string) {
      return this.attributes.get(name) ?? { array: new Float32Array(0), needsUpdate: false };
    }
    computeVertexNormals() {}
  }

  class Color {
    r: number;
    g: number;
    b: number;
    constructor(r = 0, g = 0, b = 0) {
      this.r = r;
      this.g = g;
      this.b = b;
    }
    setRGB(r: number, g: number, b: number) {
      this.r = r;
      this.g = g;
      this.b = b;
      return this;
    }
  }

  class Mesh extends Object3D {
    geometry: BufferGeometry;
    material: any;
    constructor(geometry?: BufferGeometry, material?: any) {
      super();
      this.geometry = geometry || new BufferGeometry();
      this.material = material || {};
      this.type = 'Mesh';
    }
  }

  class MeshStandardMaterial {
    color: Color;
    roughness: number;
    metalness: number;
    constructor(opts: any = {}) {
      this.color = opts.color || new Color();
      this.roughness = opts.roughness ?? 0.5;
      this.metalness = opts.metalness ?? 0.0;
    }
  }

  class MeshBasicMaterial extends MeshStandardMaterial {}
  class Group extends Object3D {}
  class PointLight extends Object3D {
    color: Color;
    intensity: number;
    constructor(color = new Color(), intensity = 1) {
      super();
      this.color = color;
      this.intensity = intensity;
      this.type = 'PointLight';
    }
  }
  class DirectionalLight extends PointLight {
    target: Object3D = new Object3D();
    constructor(color = new Color(), intensity = 1) {
      super(color, intensity);
      this.type = 'DirectionalLight';
    }
  }
  class SpotLight extends PointLight {
    target: Object3D = new Object3D();
    constructor(color = new Color(), intensity = 1) {
      super(color, intensity);
      this.type = 'SpotLight';
    }
  }

  class CylinderGeometry extends BufferGeometry {}
  class SphereGeometry extends BufferGeometry {}
  class BoxGeometry extends BufferGeometry {}
  class ConeGeometry extends BufferGeometry {}
  class TorusGeometry extends BufferGeometry {}
  class CapsuleGeometry extends BufferGeometry {}
  class TubeGeometry extends BufferGeometry {}
  class CatmullRomCurve3 {}

  return {
    Object3D,
    Vector3,
    Quaternion,
    BufferGeometry,
    Color,
    Mesh,
    MeshStandardMaterial,
    MeshBasicMaterial,
    Group,
    PointLight,
    DirectionalLight,
    SpotLight,
    CylinderGeometry,
    SphereGeometry,
    BoxGeometry,
    ConeGeometry,
    TorusGeometry,
    CapsuleGeometry,
    TubeGeometry,
    CatmullRomCurve3,
  };
});

function setup() {
  const sg = new SceneGraph();
  const bus = new CommandBus(sg);
  registerAllCommands(bus, sg);
  return { sg, bus };
}

describe('CommandBus', () => {
  describe('spawn', () => {
    it('creates a node in the scene graph', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'cyl1', type: 'cylinder' });
      const node = sg.getNode('cyl1');
      expect(node).toBeDefined();
      expect(node!.type).toBe('cylinder');
    });

    it('creates a node with position', () => {
      const { sg, bus } = setup();
      bus.exec({
        cmd: 'spawn',
        id: 's1',
        type: 'sphere',
        position: [1, 2, 3],
      });
      const node = sg.getNode('s1');
      expect(node!.transform.position).toEqual([1, 2, 3]);
    });

    it('creates a mesh on the node', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'b1', type: 'box' });
      expect(sg.getNode('b1')!.mesh).toBeDefined();
    });
  });

  describe('structural node creation', () => {
    it('creates a group node', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'create_group', id: 'group1' });
      const node = sg.getNode('group1');
      expect(node).toBeDefined();
      expect(node!.nodeType).toBe('group');
      expect(node!.layerType).toBe('group');
    });

    it('creates an animation_player node', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'create_animation_player', id: 'player1' });
      const node = sg.getNode('player1');
      expect(node).toBeDefined();
      expect(node!.nodeType).toBe('animation_player');
      expect(node!.animationPlayerData).toBeDefined();
    });

    it('creates a clay node', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'create_clay', id: 'clay1' });
      const node = sg.getNode('clay1');
      expect(node).toBeDefined();
      expect(node!.nodeType).toBe('clay');
      expect(node!.layerType).toBe('clay');
      expect(node!.clayData?.clayId).toBe('clay1');
    });
  });

  describe('delete', () => {
    it('removes a node from the scene graph', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'box' });
      bus.exec({ cmd: 'delete', id: 'a' });
      expect(sg.getNode('a')).toBeUndefined();
    });
  });

  describe('undo', () => {
    it('undoes a spawn (removes the node)', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'box' });
      expect(sg.getNode('a')).toBeDefined();

      bus.undo();
      expect(sg.getNode('a')).toBeUndefined();
    });

    it('undoes a delete (restores the node)', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'sphere' });
      bus.exec({ cmd: 'delete', id: 'a' });
      expect(sg.getNode('a')).toBeUndefined();

      bus.undo();
      expect(sg.getNode('a')).toBeDefined();
      expect(sg.getNode('a')!.type).toBe('sphere');
    });

    it('handles undo via exec with cmd:undo', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'box' });
      bus.exec({ cmd: 'undo' });
      expect(sg.getNode('a')).toBeUndefined();
    });
  });

  describe('redo', () => {
    it('redoes a spawn after undo', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'box' });
      bus.undo();
      expect(sg.getNode('a')).toBeUndefined();

      bus.redo();
      expect(sg.getNode('a')).toBeDefined();
    });

    it('handles redo via exec with cmd:redo', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'box' });
      bus.exec({ cmd: 'undo' });
      bus.exec({ cmd: 'redo' });
      expect(sg.getNode('a')).toBeDefined();
    });

    it('clears redo stack on new command', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'box' });
      bus.undo();
      // New command should clear redo
      bus.exec({ cmd: 'spawn', id: 'b', type: 'sphere' });
      bus.redo(); // Should do nothing
      expect(sg.getNode('a')).toBeUndefined();
      expect(sg.getNode('b')).toBeDefined();
    });
  });

  describe('set_param', () => {
    it('updates a parameter on the node', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'c1', type: 'cylinder' });
      bus.exec({ cmd: 'set_param', id: 'c1', key: 'radiusTop', value: 2.0 });
      expect(sg.getNode('c1')!.params.radiusTop).toBe(2.0);
    });

    it('undoes a parameter change', () => {
      const { sg, bus } = setup();
      bus.exec({
        cmd: 'spawn',
        id: 'c1',
        type: 'cylinder',
        params: { radiusTop: 1.0 },
      });
      bus.exec({ cmd: 'set_param', id: 'c1', key: 'radiusTop', value: 2.0 });
      expect(sg.getNode('c1')!.params.radiusTop).toBe(2.0);

      bus.undo();
      expect(sg.getNode('c1')!.params.radiusTop).toBe(1.0);
    });
  });

  describe('set_transform', () => {
    it('updates position on a node', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'box' });
      bus.exec({
        cmd: 'set_transform',
        id: 'a',
        position: [5, 6, 7],
      });
      expect(sg.getNode('a')!.transform.position).toEqual([5, 6, 7]);
    });

    it('undoes a transform change', () => {
      const { sg, bus } = setup();
      bus.exec({
        cmd: 'spawn',
        id: 'a',
        type: 'box',
        position: [1, 2, 3],
      });
      bus.exec({
        cmd: 'set_transform',
        id: 'a',
        position: [5, 6, 7],
      });
      bus.undo();
      expect(sg.getNode('a')!.transform.position).toEqual([1, 2, 3]);
    });
  });

  describe('add_deformer / remove_deformer', () => {
    it('adds a deformer to a node', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'cylinder' });
      bus.exec({
        cmd: 'add_deformer',
        target: 'a',
        deformer: { type: 'bend', angle: 45 },
      });
      expect(sg.getNode('a')!.deformers).toHaveLength(1);
      expect(sg.getNode('a')!.deformers[0].type).toBe('bend');
    });

    it('undoes add_deformer', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'cylinder' });
      bus.exec({
        cmd: 'add_deformer',
        target: 'a',
        deformer: { type: 'bend', angle: 45 },
      });
      bus.undo();
      expect(sg.getNode('a')!.deformers).toHaveLength(0);
    });

    it('removes a deformer at index', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'cylinder' });
      bus.exec({
        cmd: 'add_deformer',
        target: 'a',
        deformer: { type: 'bend', angle: 45 },
      });
      bus.exec({
        cmd: 'add_deformer',
        target: 'a',
        deformer: { type: 'twist', amount: 90 },
      });
      bus.exec({ cmd: 'remove_deformer', target: 'a', index: 0 });
      expect(sg.getNode('a')!.deformers).toHaveLength(1);
      expect(sg.getNode('a')!.deformers[0].type).toBe('twist');
    });

    it('undoes remove_deformer', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'cylinder' });
      bus.exec({
        cmd: 'add_deformer',
        target: 'a',
        deformer: { type: 'bend', angle: 45 },
      });
      bus.exec({ cmd: 'remove_deformer', target: 'a', index: 0 });
      bus.undo();
      expect(sg.getNode('a')!.deformers).toHaveLength(1);
      expect(sg.getNode('a')!.deformers[0].type).toBe('bend');
    });
  });

  describe('set_material', () => {
    it('updates material on a node', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'box' });
      bus.exec({
        cmd: 'set_material',
        id: 'a',
        material: { color: [1, 0, 0], roughness: 0.2 },
      });
      expect(sg.getNode('a')!.material.color).toEqual([1, 0, 0]);
      expect(sg.getNode('a')!.material.roughness).toBe(0.2);
    });

    it('undoes material change', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'a', type: 'box' });
      const origColor = [...sg.getNode('a')!.material.color];
      bus.exec({
        cmd: 'set_material',
        id: 'a',
        material: { color: [1, 0, 0] },
      });
      bus.undo();
      expect(sg.getNode('a')!.material.color).toEqual(origColor);
    });
  });

  describe('parent', () => {
    it('reparents a node', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'parent', type: 'box' });
      bus.exec({ cmd: 'spawn', id: 'child', type: 'sphere' });
      bus.exec({ cmd: 'parent', id: 'child', parentId: 'parent' });
      expect(sg.getNode('child')!.parent).toBe(sg.getNode('parent'));
    });

    it('undoes reparent', () => {
      const { sg, bus } = setup();
      bus.exec({ cmd: 'spawn', id: 'parent', type: 'box' });
      bus.exec({ cmd: 'spawn', id: 'child', type: 'sphere' });
      bus.exec({ cmd: 'parent', id: 'child', parentId: 'parent' });
      bus.undo();
      expect(sg.getNode('child')!.parent).toBe(sg.getRoot());
    });
  });

  describe('events', () => {
    it('emits command:executed on exec', () => {
      const { bus } = setup();
      const handler = vi.fn();
      bus.on('command:executed', handler);
      bus.exec({ cmd: 'spawn', id: 'a', type: 'box' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('emits command:undone on undo', () => {
      const { bus } = setup();
      const handler = vi.fn();
      bus.on('command:undone', handler);
      bus.exec({ cmd: 'spawn', id: 'a', type: 'box' });
      bus.undo();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('emits command:redone on redo', () => {
      const { bus } = setup();
      const handler = vi.fn();
      bus.on('command:redone', handler);
      bus.exec({ cmd: 'spawn', id: 'a', type: 'box' });
      bus.undo();
      bus.redo();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('unknown command', () => {
    it('warns for unregistered command', () => {
      const { bus } = setup();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      bus.exec({ cmd: 'nonexistent' });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('nonexistent')
      );
      warnSpy.mockRestore();
    });
  });
});
