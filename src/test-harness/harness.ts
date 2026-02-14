import { CommandBus, Command } from '../core/command-bus';
import { SceneGraph } from '../core/scene-graph';
import { serializeScene, serializeNodeById } from '../core/serialization';
import type { SculptEngine } from '../sculpting/sculpt-engine';
import type { ModeManager } from '../interaction/mode-manager';

declare global {
  interface Window {
    __seam: {
      exec: (cmd: Command) => void;
      scene: () => object;
      node: (id: string) => object | null;
      sculptEngine?: SculptEngine;
      modeManager?: ModeManager;
    };
  }
}

export function initTestHarness(
  commandBus: CommandBus,
  sceneGraph: SceneGraph
): void {
  window.__seam = {
    exec(cmd: Command) {
      commandBus.exec(cmd);
    },
    scene() {
      return serializeScene(sceneGraph);
    },
    node(id: string) {
      return serializeNodeById(sceneGraph, id);
    },
  };

  console.log('[Seam VR] Test harness initialized: window.__seam');
}
