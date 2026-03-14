import * as THREE from 'three';
import { CommandBus, Command } from './command-bus';
import { SceneGraph, SceneNode, DeformerConfig } from './scene-graph';
import type { ClayManager } from '../sculpting/clay-manager';
import type { SnapshotEntry } from '../sculpting/sculpt-engine';
import { createPrimitiveGeometry } from '../primitives/primitive-factory';
import { getDefaultParams } from '../primitives/primitive-params';
import { DeformerStack } from '../deformers/deformer-stack';
import {
  PrimitiveType,
  Vec3,
  Vec4,
  MaterialData,
  DEFAULT_MATERIAL,
  DEFAULT_TRANSFORM,
  AnimationPlayerData,
  ClayData,
  NodeType,
} from '../types';

interface NodeSnapshot {
  id: string;
  type: PrimitiveType;
  nodeType: NodeType;
  transform: {
    position: Vec3;
    rotation: Vec4;
    scale: Vec3;
  };
  params: Record<string, number>;
  deformers: DeformerConfig[];
  material: MaterialData;
  parentId: string | null;
  layerType: SceneNode['layerType'];
  visible: boolean;
  locked: boolean;
  lightData: SceneNode['lightData'];
  animationPlayerData: AnimationPlayerData | null;
  clayData: ClayData | null;
}

function cloneTransform(node: SceneNode): { position: Vec3; rotation: Vec4; scale: Vec3 } {
  return {
    position: [...node.transform.position] as Vec3,
    rotation: [...node.transform.rotation] as Vec4,
    scale: [...node.transform.scale] as Vec3,
  };
}

function applyTransform(object: THREE.Object3D | null, transform: typeof DEFAULT_TRANSFORM): void {
  if (!object) return;
  object.position.set(transform.position[0], transform.position[1], transform.position[2]);
  object.quaternion.set(transform.rotation[0], transform.rotation[1], transform.rotation[2], transform.rotation[3]);
  object.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
}

function applyNodeTransform(node: SceneNode): void {
  applyTransform(node.object3D ?? node.mesh, node.transform);
}

function reparentIfNeeded(sceneGraph: SceneGraph, nodeId: string, parentId: string | null | undefined): void {
  if (parentId !== undefined) {
    sceneGraph.reparent(nodeId, parentId);
  }
}

function createPrimitiveNode(
  id: string,
  type: PrimitiveType,
  position?: Vec3,
  params?: Record<string, number>,
  material?: MaterialData
): SceneNode {
  const node = new SceneNode(
    id,
    type,
    position ? { position } : undefined,
    params,
    material
  );

  const mergedParams = { ...getDefaultParams(type), ...(params ?? {}) };
  const geometry = createPrimitiveGeometry(type, mergedParams);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(...(node.material.color ?? [0.8, 0.8, 0.8])),
    roughness: node.material.roughness ?? 0.5,
    metalness: node.material.metallic ?? 0.0,
  });
  const mesh = new THREE.Mesh(geometry, mat);
  node.mesh = mesh;
  node.object3D = mesh;
  applyNodeTransform(node);
  return node;
}

function attachLight(
  mesh: THREE.Mesh,
  lightType: string,
  color: THREE.Color,
  intensity: number,
): void {
  switch (lightType) {
    case 'directional': {
      const light = new THREE.DirectionalLight(color, intensity);
      const target = new THREE.Object3D();
      target.position.set(0, 0, -1);
      mesh.add(target);
      light.target = target;
      mesh.add(light);
      break;
    }
    case 'spot': {
      const light = new THREE.SpotLight(color, intensity, 10, Math.PI / 6, 0.5);
      const target = new THREE.Object3D();
      target.position.set(0, 0, -1);
      mesh.add(target);
      light.target = target;
      mesh.add(light);
      break;
    }
    default: {
      const light = new THREE.PointLight(color, intensity, 10);
      mesh.add(light);
      break;
    }
  }
}

function rebuildLightChildren(node: SceneNode): void {
  if (!node.mesh || !node.lightData) return;
  const toRemove: THREE.Object3D[] = [];
  for (const child of node.mesh.children) {
    if (
      child instanceof THREE.PointLight ||
      child instanceof THREE.DirectionalLight ||
      child instanceof THREE.SpotLight ||
      (child instanceof THREE.Object3D && child.type === 'Object3D' && !(child instanceof THREE.Mesh))
    ) {
      toRemove.push(child);
    }
  }
  for (const child of toRemove) {
    node.mesh.remove(child);
  }
  const color = new THREE.Color(
    node.lightData.color[0],
    node.lightData.color[1],
    node.lightData.color[2]
  );
  attachLight(node.mesh, node.lightData.type, color, node.lightData.intensity);
  if (node.mesh.material instanceof THREE.MeshBasicMaterial) {
    node.mesh.material.color.copy(color);
  }
}

function rebuildPrimitiveGeometry(node: SceneNode): void {
  if (!node.mesh) return;
  const sourceGeometry = createPrimitiveGeometry(node.type, {
    ...getDefaultParams(node.type),
    ...node.params,
  });
  let newGeometry = sourceGeometry;
  if (node.deformers.length > 0) {
    try {
      const deformerStack = new DeformerStack();
      deformerStack.deformers = node.deformers as any;
      newGeometry = deformerStack.apply(sourceGeometry);
      sourceGeometry.dispose();
    } catch {
      newGeometry = sourceGeometry;
    }
  }
  node.mesh.geometry.dispose();
  node.mesh.geometry = newGeometry;
}

function createLightNode(
  id: string,
  position?: Vec3,
  lightType: string = 'point',
  intensity = 1.0,
  color: Vec3 = [1, 1, 1],
): SceneNode {
  const node = new SceneNode(id, 'sphere', position ? { position } : undefined);
  node.nodeType = 'light';
  node.layerType = 'light';
  node.lightData = {
    type: lightType as 'point' | 'directional' | 'spot',
    intensity,
    color: [...color] as [number, number, number],
  };

  const geo = new THREE.SphereGeometry(0.02, 8, 6);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color[0], color[1], color[2]),
  });
  const mesh = new THREE.Mesh(geo, mat);
  node.mesh = mesh;
  node.object3D = mesh;
  applyNodeTransform(node);
  attachLight(mesh, lightType, new THREE.Color(color[0], color[1], color[2]), intensity);
  return node;
}

function createAnchorNode(
  id: string,
  nodeType: Extract<NodeType, 'group' | 'animation_player' | 'clay'>,
  transform?: Partial<typeof DEFAULT_TRANSFORM>,
): SceneNode {
  const node = new SceneNode(id, 'box', transform);
  node.nodeType = nodeType;
  node.layerType = nodeType;
  node.object3D = new THREE.Group();
  node.object3D.name = `${nodeType}_${id}`;
  if (nodeType === 'animation_player') {
    node.animationPlayerData = {
      clipIds: [],
      targetIds: [],
      mode: 'override',
      weight: 1,
      loop: true,
      timeScale: 1,
    };
  }
  if (nodeType === 'clay') {
    node.material = {
      color: [0.7686, 0.5843, 0.4157],
      roughness: 0.85,
      metallic: 0.05,
    };
    node.clayData = {
      clayId: id,
    };
  }
  applyNodeTransform(node);
  return node;
}

function snapshotNode(node: SceneNode): NodeSnapshot {
  return {
    id: node.id,
    type: node.type,
    nodeType: node.nodeType,
    transform: cloneTransform(node),
    params: { ...node.params },
    deformers: node.deformers.map((d) => ({ ...d })),
    material: { ...node.material },
    parentId: node.parent && node.parent.id !== '__root__' ? node.parent.id : null,
    layerType: node.layerType,
    visible: node.visible,
    locked: node.locked,
    lightData: node.lightData ? { ...node.lightData, color: [...node.lightData.color] as [number, number, number] } : null,
    animationPlayerData: node.animationPlayerData
      ? {
          clipIds: [...node.animationPlayerData.clipIds],
          targetIds: [...node.animationPlayerData.targetIds],
          mode: node.animationPlayerData.mode,
          weight: node.animationPlayerData.weight,
          loop: node.animationPlayerData.loop,
          timeScale: node.animationPlayerData.timeScale,
        }
      : null,
    clayData: node.clayData ? { ...node.clayData } : null,
  };
}

function restoreNodeSnapshot(bus: CommandBus, sceneGraph: SceneGraph, snapshot: NodeSnapshot): void {
  switch (snapshot.nodeType) {
    case 'light':
      bus.exec({
        cmd: 'spawn_light',
        id: snapshot.id,
        position: snapshot.transform.position,
        lightType: snapshot.lightData?.type ?? 'point',
        intensity: snapshot.lightData?.intensity ?? 1,
        color: snapshot.lightData?.color ?? [1, 1, 1],
        parentId: snapshot.parentId,
      });
      break;
    case 'group':
      bus.exec({
        cmd: 'create_group',
        id: snapshot.id,
        position: snapshot.transform.position,
        parentId: snapshot.parentId,
      });
      break;
    case 'animation_player':
      bus.exec({
        cmd: 'create_animation_player',
        id: snapshot.id,
        position: snapshot.transform.position,
        parentId: snapshot.parentId,
      });
      break;
    case 'clay':
      bus.exec({
        cmd: 'create_clay',
        id: snapshot.id,
        position: snapshot.transform.position,
        parentId: snapshot.parentId,
      });
      break;
    default:
      bus.exec({
        cmd: 'spawn',
        id: snapshot.id,
        type: snapshot.type,
        position: snapshot.transform.position,
        params: snapshot.params,
        material: snapshot.material,
        parentId: snapshot.parentId,
      });
      break;
  }

  const restored = sceneGraph.getNode(snapshot.id);
  if (!restored) return;

  restored.nodeType = snapshot.nodeType;
  restored.layerType = snapshot.layerType;
  restored.transform = {
    position: [...snapshot.transform.position] as Vec3,
    rotation: [...snapshot.transform.rotation] as Vec4,
    scale: [...snapshot.transform.scale] as Vec3,
  };
  restored.params = { ...snapshot.params };
  restored.deformers = snapshot.deformers.map((d) => ({ ...d }));
  restored.material = { ...snapshot.material };
  restored.visible = snapshot.visible;
  restored.locked = snapshot.locked;
  restored.lightData = snapshot.lightData
    ? { ...snapshot.lightData, color: [...snapshot.lightData.color] as [number, number, number] }
    : null;
  restored.animationPlayerData = snapshot.animationPlayerData
    ? {
        clipIds: [...snapshot.animationPlayerData.clipIds],
        targetIds: [...snapshot.animationPlayerData.targetIds],
        mode: snapshot.animationPlayerData.mode,
        weight: snapshot.animationPlayerData.weight,
        loop: snapshot.animationPlayerData.loop,
        timeScale: snapshot.animationPlayerData.timeScale,
      }
    : null;
  restored.clayData = snapshot.clayData ? { ...snapshot.clayData } : null;
  applyNodeTransform(restored);
  if (restored.mesh && restored.nodeType !== 'light') {
    rebuildPrimitiveGeometry(restored);
  }
  if (restored.nodeType === 'light') {
    rebuildLightChildren(restored);
  }

  if (restored.object3D) {
    restored.object3D.visible = restored.visible;
  }
  if (restored.mesh) {
    restored.mesh.visible = restored.visible;
  }
}

export function registerAllCommands(
  bus: CommandBus,
  sceneGraph: SceneGraph
): void {
  bus.register('spawn', (cmd: Command, sg: SceneGraph) => {
    const id: string = cmd.id;
    const type: PrimitiveType = cmd.type;
    const node = createPrimitiveNode(
      id,
      type,
      cmd.position,
      cmd.params ?? {},
      cmd.material
    );
    sg.addNode(node);
    reparentIfNeeded(sg, id, cmd.parentId);

    return {
      undo: () => {
        sg.removeNode(id);
      },
    };
  });

  bus.register('spawn_light', (cmd: Command, sg: SceneGraph) => {
    const node = createLightNode(
      cmd.id,
      cmd.position,
      cmd.lightType ?? 'point',
      cmd.intensity ?? 1.0,
      cmd.color ?? [1, 1, 1],
    );
    sg.addNode(node);
    reparentIfNeeded(sg, cmd.id, cmd.parentId);

    return {
      undo: () => { sg.removeNode(cmd.id); },
    };
  });

  bus.register('create_group', (cmd: Command, sg: SceneGraph) => {
    const node = createAnchorNode(cmd.id, 'group', cmd.position ? { position: cmd.position } : undefined);
    sg.addNode(node);
    reparentIfNeeded(sg, cmd.id, cmd.parentId);
    return {
      undo: () => { sg.removeNode(cmd.id); },
    };
  });

  bus.register('create_animation_player', (cmd: Command, sg: SceneGraph) => {
    const node = createAnchorNode(
      cmd.id,
      'animation_player',
      cmd.position ? { position: cmd.position } : undefined
    );
    if (cmd.animationPlayerData) {
      node.animationPlayerData = {
        ...node.animationPlayerData!,
        ...cmd.animationPlayerData,
      };
    }
    sg.addNode(node);
    reparentIfNeeded(sg, cmd.id, cmd.parentId);
    return {
      undo: () => { sg.removeNode(cmd.id); },
    };
  });

  bus.register('create_clay', (cmd: Command, sg: SceneGraph) => {
    const node = createAnchorNode(cmd.id, 'clay', cmd.position ? { position: cmd.position } : undefined);
    sg.addNode(node);
    reparentIfNeeded(sg, cmd.id, cmd.parentId);
    return {
      undo: () => { sg.removeNode(cmd.id); },
    };
  });

  bus.register('delete', (cmd: Command, sg: SceneGraph) => {
    const node = sg.getNode(cmd.id);
    if (!node) return;
    const snapshot = snapshotNode(node);
    sg.removeNode(cmd.id);

    return {
      undo: () => {
        restoreNodeSnapshot(bus, sg, snapshot);
      },
    };
  });

  bus.register('set_param', (cmd: Command, sg: SceneGraph) => {
    const node = sg.getNode(cmd.id);
    if (!node) return;

    const oldValue = node.params[cmd.key];
    node.params[cmd.key] = cmd.value;
    rebuildPrimitiveGeometry(node);

    sg.emit('node:updated', { node, change: 'param' });

    return {
      undo: () => {
        if (oldValue === undefined) {
          delete node.params[cmd.key];
        } else {
          node.params[cmd.key] = oldValue;
        }
        rebuildPrimitiveGeometry(node);

        sg.emit('node:updated', { node, change: 'param' });
      },
    };
  });

  bus.register('set_transform', (cmd: Command, sg: SceneGraph) => {
    const node = sg.getNode(cmd.id);
    if (!node) return;

    const oldTransform = cloneTransform(node);

    if (cmd.position) node.transform.position = [...cmd.position] as Vec3;
    if (cmd.rotation) node.transform.rotation = [...cmd.rotation] as Vec4;
    if (cmd.scale) node.transform.scale = [...cmd.scale] as Vec3;
    applyNodeTransform(node);

    sg.emit('node:updated', { node, change: 'transform' });

    return {
      undo: () => {
        node.transform = oldTransform;
        applyNodeTransform(node);
        sg.emit('node:updated', { node, change: 'transform' });
      },
    };
  });

  bus.register('add_deformer', (cmd: Command, sg: SceneGraph) => {
    const node = sg.getNode(cmd.target);
    if (!node) return;

    node.deformers.push(cmd.deformer as DeformerConfig);
    const addedIndex = node.deformers.length - 1;
    rebuildPrimitiveGeometry(node);
    sg.emit('node:updated', { node, change: 'deformer' });

    return {
      undo: () => {
        node.deformers.splice(addedIndex, 1);
        rebuildPrimitiveGeometry(node);
        sg.emit('node:updated', { node, change: 'deformer' });
      },
    };
  });

  bus.register('remove_deformer', (cmd: Command, sg: SceneGraph) => {
    const node = sg.getNode(cmd.target);
    if (!node) return;
    if (cmd.index < 0 || cmd.index >= node.deformers.length) return;

    const removed = node.deformers.splice(cmd.index, 1)[0];
    rebuildPrimitiveGeometry(node);
    sg.emit('node:updated', { node, change: 'deformer' });

    return {
      undo: () => {
        node.deformers.splice(cmd.index, 0, removed);
        rebuildPrimitiveGeometry(node);
        sg.emit('node:updated', { node, change: 'deformer' });
      },
    };
  });

  bus.register('set_material', (cmd: Command, sg: SceneGraph) => {
    const node = sg.getNode(cmd.id);
    if (!node) return;

    const oldMaterial = { ...node.material };
    Object.assign(node.material, cmd.material as Partial<MaterialData>);

    if (node.mesh && node.mesh.material instanceof THREE.MeshStandardMaterial) {
      const mat = node.mesh.material;
      if (cmd.material.color) {
        mat.color.setRGB(cmd.material.color[0], cmd.material.color[1], cmd.material.color[2]);
      }
      if (cmd.material.roughness !== undefined) {
        mat.roughness = cmd.material.roughness;
      }
      if (cmd.material.metallic !== undefined) {
        mat.metalness = cmd.material.metallic;
      }
    }

    sg.emit('node:updated', { node, change: 'material' });

    return {
      undo: () => {
        node.material = oldMaterial;
        if (node.mesh && node.mesh.material instanceof THREE.MeshStandardMaterial) {
          node.mesh.material.color.setRGB(oldMaterial.color[0], oldMaterial.color[1], oldMaterial.color[2]);
          node.mesh.material.roughness = oldMaterial.roughness;
          node.mesh.material.metalness = oldMaterial.metallic;
        }
        sg.emit('node:updated', { node, change: 'material' });
      },
    };
  });

  bus.register('set_visibility', (cmd: Command, sg: SceneGraph) => {
    const node = sg.getNode(cmd.id);
    if (!node) return;

    const oldVisible = node.visible;
    node.visible = cmd.visible;
    if (node.object3D) node.object3D.visible = cmd.visible;
    if (node.mesh) node.mesh.visible = cmd.visible;
    sg.emit('node:updated', { node, change: 'visibility' });

    return {
      undo: () => {
        node.visible = oldVisible;
        if (node.object3D) node.object3D.visible = oldVisible;
        if (node.mesh) node.mesh.visible = oldVisible;
        sg.emit('node:updated', { node, change: 'visibility' });
      },
    };
  });

  bus.register('set_light_param', (cmd: Command, sg: SceneGraph) => {
    const node = sg.getNode(cmd.id);
    if (!node || !node.lightData) return;

    const oldLightData = { ...node.lightData, color: [...node.lightData.color] as [number, number, number] };
    if (cmd.lightType) node.lightData.type = cmd.lightType;
    if (cmd.intensity !== undefined) node.lightData.intensity = cmd.intensity;
    if (cmd.color) node.lightData.color = [...cmd.color] as [number, number, number];
    rebuildLightChildren(node);
    sg.emit('node:updated', { node, change: 'light' });

    return {
      undo: () => {
        node.lightData = oldLightData;
        rebuildLightChildren(node);
        sg.emit('node:updated', { node, change: 'light' });
      },
    };
  });

  bus.register('parent', (cmd: Command, sg: SceneGraph) => {
    const node = sg.getNode(cmd.id);
    if (!node) return;
    const oldParentId = node.parent && node.parent.id !== '__root__' ? node.parent.id : null;
    sg.reparent(cmd.id, cmd.parentId);
    return {
      undo: () => {
        sg.reparent(cmd.id, oldParentId);
      },
    };
  });
}

export function registerSculptCommands(bus: CommandBus, clayManager: ClayManager): void {
  bus.register('sculpt_stroke', (cmd: Command) => {
    const engine = clayManager.getEngine(cmd.engineId as string);
    if (!engine) return;

    const postSnapshots = cmd.postSnapshots as SnapshotEntry[];
    void engine.restoreChunkSnapshots(postSnapshots);

    return {
      undo: () => {
        const preSnapshots = cmd.preSnapshots as SnapshotEntry[];
        void engine.restoreChunkSnapshots(preSnapshots);
      },
    };
  });
}
