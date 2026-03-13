import { describe, expect, it } from 'vitest';
import { PLAY_SCENARIOS } from '../../src/test-harness/play-registry';

describe('PLAY_SCENARIOS', () => {
  it('registers the built-in browser play scenarios', () => {
    expect(PLAY_SCENARIOS.map((scenario) => scenario.id).sort()).toEqual([
      'boot_smoke',
      'sculpt_stress_short',
      'ui_smoke',
    ]);
  });
});
