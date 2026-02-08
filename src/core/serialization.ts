import { SceneGraph, SceneNode } from './scene-graph';
import { CommandBus } from './command-bus';
import { Vec3, Vec4 } from '../types';

interface SerializedNode {
  id: string;
  type: string;
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
}

interface SerializedScene {
  version: number;
  primitives: SerializedNode[];
}

export function serializeScene(sceneGraph: SceneGraph): SerializedScene {
  const primitives: SerializedNode[] = [];

  sceneGraph.traverse((node: SceneNode) => {
    primitives.push({
      id: node.id,
      type: node.type,
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
    });
  });

  return {
    version: 1,
    primitives,
  };
}

function serializeNode(node: SceneNode): SerializedNode {
  return {
    id: node.id,
    type: node.type,
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
  // Clear existing scene
  sceneGraph.clear();

  // First pass: spawn all nodes
  for (const prim of json.primitives) {
    commandBus.exec({
      cmd: 'spawn',
      id: prim.id,
      type: prim.type,
      position: prim.transform.position,
      params: prim.params,
      material: prim.material,
    });

    // Apply full transform (spawn only sets position)
    const node = sceneGraph.getNode(prim.id);
    if (node) {
      node.transform.rotation = [...prim.transform.rotation] as Vec4;
      node.transform.scale = [...prim.transform.scale] as Vec3;
      node.deformers = prim.deformers.map((d) => ({ ...d })) as any;
    }
  }

  // Second pass: reparent
  for (const prim of json.primitives) {
    if (prim.parent) {
      sceneGraph.reparent(prim.id, prim.parent);
    }
  }
}
