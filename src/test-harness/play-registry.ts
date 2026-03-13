import type { PlayScenario } from './play-types';
import { bootSmokePlay } from './plays/boot-smoke';
import { sculptStressShortPlay } from './plays/sculpt-stress-short';
import { uiSmokePlay } from './plays/ui-smoke';

export const PLAY_SCENARIOS: PlayScenario[] = [
  bootSmokePlay,
  sculptStressShortPlay,
  uiSmokePlay,
];
