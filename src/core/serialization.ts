import { SceneGraph, SceneNode } from './scene-graph';
import { CommandBus } from './command-bus';
import { Vec3, Vec4 } from '../types';

interface SerializedNode {
  id: string;
  type: string;
  nodeType: string;
  layerType: string;
  transform: {
    position: Vec3;
    rotation: Vec4;
    scale: Vec3;
  };
  params: Record<string, any>;
  deformers: Array<{ type: string; [key: string]: any }>;
  material: {
    color: [number, number, number];
    roughness: number;
    metallic: number;
    emissive?: [number, number, number];
    emissiveIntensity?: number;
  };
  parent: string | null;
  visible: boolean;
}

interface SerializedScene {
  version: number;
  nodes: SerializedNode[];
}

function serializeNode(node: SceneNode): SerializedNode {
  return {
    id: node.id,
    type: node.type,
    nodeType: node.nodeType,
    layerType: node.layerType,
    transform: {
      position: [...node.transform.position] as Vec3,
      rotation: [...node.transform.rotation] as Vec4,
      scale: [...node.transform.scale] as Vec3,
    },
    params: { ...node.params },
    deformers: node.deformers.map((d) => ({ ...d })),
    material: { ...node.material },
    parent:
      node.parent && node.parent.id !== '__root__' ? node.parent.id : null,
    visible: node.visible,
  };
}

export function serializeScene(sceneGraph: SceneGraph): SerializedScene {
  const nodes: SerializedNode[] = [];

  sceneGraph.traverse((node: SceneNode) => {
    nodes.push(serializeNode(node));
  });

  return {
    version: 1,
    nodes,
  };
}

export function serializeNodeById(
  sceneGraph: SceneGraph,
  id: string
): SerializedNode | null {
  const node = sceneGraph.getNode(id);
  if (!node) return null;
  return serializeNode(node);
}

export function deserializeScene(
  json: SerializedScene,
  commandBus: CommandBus,
  sceneGraph: SceneGraph
): void {
  sceneGraph.clear();

  for (const node of json.nodes) {
    switch (node.nodeType) {
      case 'light':
        commandBus.exec({
          cmd: 'spawn_light',
          id: node.id,
          position: node.transform.position,
        });
        break;
      case 'group':
        commandBus.exec({
          cmd: 'create_group',
          id: node.id,
          position: node.transform.position,
        });
        break;
      case 'animation_player':
        commandBus.exec({
          cmd: 'create_animation_player',
          id: node.id,
          position: node.transform.position,
        });
        break;
      case 'clay':
        commandBus.exec({
          cmd: 'create_clay',
          id: node.id,
          position: node.transform.position,
        });
        break;
      default:
        commandBus.exec({
          cmd: 'spawn',
          id: node.id,
          type: node.type,
          position: node.transform.position,
          params: node.params,
          material: node.material,
        });
        break;
    }

    const restored = sceneGraph.getNode(node.id);
    if (restored) {
      restored.transform.rotation = [...node.transform.rotation] as Vec4;
      restored.transform.scale = [...node.transform.scale] as Vec3;
      restored.deformers = node.deformers.map((d) => ({ ...d })) as any;
      restored.visible = node.visible;
    }
  }

  for (const node of json.nodes) {
    if (node.parent) {
      sceneGraph.reparent(node.id, node.parent);
    }
  }
}
