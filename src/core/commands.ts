import * as THREE from 'three';
import { CommandBus, Command } from './command-bus';
import { SceneGraph, SceneNode, DeformerConfig } from './scene-graph';
import { createPrimitiveGeometry } from '../primitives/primitive-factory';
import { getDefaultParams } from '../primitives/primitive-params';
import {
  PrimitiveType,
  Vec3,
  Vec4,
  MaterialData,
  DEFAULT_MATERIAL,
  DEFAULT_TRANSFORM,
} from '../types';

export function registerAllCommands(
  bus: CommandBus,
  sceneGraph: SceneGraph
): void {
  // spawn - create a new primitive node
  bus.register('spawn', (cmd: Command, sg: SceneGraph) => {
    const id: string = cmd.id;
    const type: PrimitiveType = cmd.type;
    const position: Vec3 | undefined = cmd.position;
    const params: Record<string, number> = cmd.params ?? {};
    const material: MaterialData | undefined = cmd.material;

    const node = new SceneNode(
      id,
      type,
      position ? { position } : undefined,
      params,
      material
    );

    // Generate geometry and create mesh
    const mergedParams = { ...getDefaultParams(type), ...params };
    const geometry = createPrimitiveGeometry(type, mergedParams);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(...(node.material.color ?? [0.8, 0.8, 0.8])),
      roughness: node.material.roughness ?? 0.5,
      metalness: node.material.metallic ?? 0.0,
    });
    const mesh = new THREE.Mesh(geometry, mat);

    if (position) {
      mesh.position.set(position[0], position[1], position[2]);
    }

    node.mesh = mesh;
    sg.addNode(node);

    return {
      undo: () => {
        sg.removeNode(id);
      },
    };
  });

  // delete - remove a node
  bus.register('delete', (cmd: Command, sg: SceneGraph) => {
    const id: string = cmd.id;
    const node = sg.getNode(id);
    if (!node) return;

    // Capture state for undo
    const savedType = node.type;
    const savedTransform = {
      position: [...node.transform.position] as Vec3,
      rotation: [...node.transform.rotation] as Vec4,
      scale: [...node.transform.scale] as Vec3,
    };
    const savedParams = { ...node.params };
    const savedDeformers = [...node.deformers];
    const savedMaterial = { ...node.material };
    const savedParentId =
      node.parent && node.parent.id !== '__root__' ? node.parent.id : null;

    sg.removeNode(id);

    return {
      undo: () => {
        // Re-spawn via the bus to rebuild mesh etc.
        bus.exec({
          cmd: 'spawn',
          id,
          type: savedType,
          position: savedTransform.position,
          params: savedParams,
          material: savedMaterial,
        });
        const restored = sg.getNode(id);
        if (restored) {
          restored.transform = savedTransform;
          restored.deformers = savedDeformers;
          if (savedParentId) {
            sg.reparent(id, savedParentId);
          }
        }
      },
    };
  });

  // set_param - update a primitive parameter
  bus.register('set_param', (cmd: Command, sg: SceneGraph) => {
    const id: string = cmd.id;
    const key: string = cmd.key;
    const value: number = cmd.value;

    const node = sg.getNode(id);
    if (!node) return;

    const oldValue = node.params[key];
    node.params[key] = value;

    // Regenerate geometry
    const mergedParams = { ...getDefaultParams(node.type), ...node.params };
    const newGeometry = createPrimitiveGeometry(node.type, mergedParams);
    if (node.mesh) {
      node.mesh.geometry.dispose();
      node.mesh.geometry = newGeometry;
    }

    sg.emit('node:updated', { node, change: 'param' });

    return {
      undo: () => {
        if (oldValue === undefined) {
          delete node.params[key];
        } else {
          node.params[key] = oldValue;
        }
        // Regenerate geometry
        const undoParams = { ...getDefaultParams(node.type), ...node.params };
        const undoGeometry = createPrimitiveGeometry(node.type, undoParams);
        if (node.mesh) {
          node.mesh.geometry.dispose();
          node.mesh.geometry = undoGeometry;
        }
        sg.emit('node:updated', { node, change: 'param' });
      },
    };
  });

  // set_transform - update node transform
  bus.register('set_transform', (cmd: Command, sg: SceneGraph) => {
    const id: string = cmd.id;
    const node = sg.getNode(id);
    if (!node) return;

    const oldTransform = {
      position: [...node.transform.position] as Vec3,
      rotation: [...node.transform.rotation] as Vec4,
      scale: [...node.transform.scale] as Vec3,
    };

    if (cmd.position) {
      node.transform.position = cmd.position;
      if (node.mesh) {
        node.mesh.position.set(
          cmd.position[0],
          cmd.position[1],
          cmd.position[2]
        );
      }
    }
    if (cmd.rotation) {
      node.transform.rotation = cmd.rotation;
      if (node.mesh) {
        node.mesh.quaternion.set(
          cmd.rotation[0],
          cmd.rotation[1],
          cmd.rotation[2],
          cmd.rotation[3]
        );
      }
    }
    if (cmd.scale) {
      node.transform.scale = cmd.scale;
      if (node.mesh) {
        node.mesh.scale.set(cmd.scale[0], cmd.scale[1], cmd.scale[2]);
      }
    }

    sg.emit('node:updated', { node, change: 'transform' });

    return {
      undo: () => {
        node.transform = oldTransform;
        if (node.mesh) {
          node.mesh.position.set(
            oldTransform.position[0],
            oldTransform.position[1],
            oldTransform.position[2]
          );
          node.mesh.quaternion.set(
            oldTransform.rotation[0],
            oldTransform.rotation[1],
            oldTransform.rotation[2],
            oldTransform.rotation[3]
          );
          node.mesh.scale.set(
            oldTransform.scale[0],
            oldTransform.scale[1],
            oldTransform.scale[2]
          );
        }
        sg.emit('node:updated', { node, change: 'transform' });
      },
    };
  });

  // add_deformer - add a deformer to a node
  bus.register('add_deformer', (cmd: Command, sg: SceneGraph) => {
    const targetId: string = cmd.target;
    const deformer: DeformerConfig = cmd.deformer;

    const node = sg.getNode(targetId);
    if (!node) return;

    node.deformers.push(deformer);
    const addedIndex = node.deformers.length - 1;

    sg.emit('node:updated', { node, change: 'deformer' });

    return {
      undo: () => {
        node.deformers.splice(addedIndex, 1);
        sg.emit('node:updated', { node, change: 'deformer' });
      },
    };
  });

  // remove_deformer - remove a deformer at index
  bus.register('remove_deformer', (cmd: Command, sg: SceneGraph) => {
    const targetId: string = cmd.target;
    const index: number = cmd.index;

    const node = sg.getNode(targetId);
    if (!node) return;
    if (index < 0 || index >= node.deformers.length) return;

    const removed = node.deformers.splice(index, 1)[0];

    sg.emit('node:updated', { node, change: 'deformer' });

    return {
      undo: () => {
        node.deformers.splice(index, 0, removed);
        sg.emit('node:updated', { node, change: 'deformer' });
      },
    };
  });

  // set_material - update material properties
  bus.register('set_material', (cmd: Command, sg: SceneGraph) => {
    const id: string = cmd.id;
    const materialUpdate: Partial<MaterialData> = cmd.material;

    const node = sg.getNode(id);
    if (!node) return;

    const oldMaterial = { ...node.material };

    // Merge partial material update
    Object.assign(node.material, materialUpdate);

    // Update mesh material
    if (node.mesh && node.mesh.material instanceof THREE.MeshStandardMaterial) {
      const mat = node.mesh.material;
      if (materialUpdate.color) {
        mat.color.setRGB(
          materialUpdate.color[0],
          materialUpdate.color[1],
          materialUpdate.color[2]
        );
      }
      if (materialUpdate.roughness !== undefined) {
        mat.roughness = materialUpdate.roughness;
      }
      if (materialUpdate.metallic !== undefined) {
        mat.metalness = materialUpdate.metallic;
      }
    }

    sg.emit('node:updated', { node, change: 'material' });

    return {
      undo: () => {
        node.material = oldMaterial;
        if (
          node.mesh &&
          node.mesh.material instanceof THREE.MeshStandardMaterial
        ) {
          const mat = node.mesh.material;
          mat.color.setRGB(
            oldMaterial.color[0],
            oldMaterial.color[1],
            oldMaterial.color[2]
          );
          mat.roughness = oldMaterial.roughness;
          mat.metalness = oldMaterial.metallic;
        }
        sg.emit('node:updated', { node, change: 'material' });
      },
    };
  });

  // parent - reparent a node
  bus.register('parent', (cmd: Command, sg: SceneGraph) => {
    const id: string = cmd.id;
    const parentId: string | null = cmd.parentId;

    const node = sg.getNode(id);
    if (!node) return;

    const oldParentId =
      node.parent && node.parent.id !== '__root__' ? node.parent.id : null;

    sg.reparent(id, parentId);

    return {
      undo: () => {
        sg.reparent(id, oldParentId);
      },
    };
  });
}
