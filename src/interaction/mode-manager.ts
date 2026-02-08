import { InteractionMode } from '../types';

const MODE_ORDER: InteractionMode[] = ['handle', 'free-deform', 'play'];

export class ModeManager {
  currentMode: InteractionMode = 'handle';

  onModeChange: ((mode: InteractionMode) => void) | null = null;

  toggle(): void {
    const idx = MODE_ORDER.indexOf(this.currentMode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    this.setMode(next);
  }

  setMode(mode: InteractionMode): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    this.onModeChange?.(mode);
  }
}
