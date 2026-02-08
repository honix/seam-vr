import { SceneGraph } from './scene-graph';

export interface Command {
  cmd: string;
  [key: string]: any;
}

export type CommandHandler = (
  cmd: Command,
  sceneGraph: SceneGraph
) => { undo: () => void } | void;

type BusEventType = 'command:executed' | 'command:undone' | 'command:redone';
type BusEventHandler = (data: any) => void;

export class CommandBus {
  private handlers: Map<string, CommandHandler> = new Map();
  private undoStack: Array<{ cmd: Command; undo: () => void }> = [];
  private redoStack: Array<{ cmd: Command; undo: () => void }> = [];
  private sceneGraph: SceneGraph;
  private listeners: Map<BusEventType, BusEventHandler[]> = new Map();

  constructor(sceneGraph: SceneGraph) {
    this.sceneGraph = sceneGraph;
  }

  register(cmdName: string, handler: CommandHandler): void {
    this.handlers.set(cmdName, handler);
  }

  exec(cmd: Command): void {
    // Handle special undo/redo commands
    if (cmd.cmd === 'undo') {
      this.undo();
      return;
    }
    if (cmd.cmd === 'redo') {
      this.redo();
      return;
    }

    const handler = this.handlers.get(cmd.cmd);
    if (!handler) {
      console.warn(`[CommandBus] No handler for command: ${cmd.cmd}`);
      return;
    }

    const result = handler(cmd, this.sceneGraph);
    if (result && result.undo) {
      this.undoStack.push({ cmd, undo: result.undo });
      // Clear redo stack on new command
      this.redoStack.length = 0;
    }

    this.emit('command:executed', { cmd });
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;

    entry.undo();
    this.redoStack.push(entry);
    this.emit('command:undone', { cmd: entry.cmd });
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;

    // Re-execute the command
    const handler = this.handlers.get(entry.cmd.cmd);
    if (!handler) return;

    const result = handler(entry.cmd, this.sceneGraph);
    if (result && result.undo) {
      this.undoStack.push({ cmd: entry.cmd, undo: result.undo });
    } else {
      // If no undo returned on redo, push original entry back
      this.undoStack.push(entry);
    }

    this.emit('command:redone', { cmd: entry.cmd });
  }

  on(event: BusEventType, handler: BusEventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  private emit(event: BusEventType, data: any): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const h of handlers) {
        h(data);
      }
    }
  }
}
