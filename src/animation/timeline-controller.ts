export class TimelineController {
  state: 'stopped' | 'playing' | 'paused' = 'stopped';
  currentTime = 0;
  duration = 10; // default duration in seconds
  speed = 1.0;
  loop = false;
  autoKey = false;

  onTimeChange: ((time: number) => void) | null = null;
  onStateChange: ((state: string) => void) | null = null;

  play(): void {
    if (this.state === 'playing') return;
    this.state = 'playing';
    this.onStateChange?.(this.state);
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.onStateChange?.(this.state);
  }

  stop(): void {
    this.state = 'stopped';
    this.currentTime = 0;
    this.onTimeChange?.(0);
    this.onStateChange?.(this.state);
  }

  seek(time: number): void {
    this.currentTime = Math.max(0, Math.min(time, this.duration));
    this.onTimeChange?.(this.currentTime);
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, Math.min(speed, 4.0));
  }

  toggleLoop(): void {
    this.loop = !this.loop;
  }

  update(deltaTime: number): number {
    if (this.state !== 'playing') return this.currentTime;

    this.currentTime += deltaTime * this.speed;

    if (this.currentTime >= this.duration) {
      if (this.loop) {
        this.currentTime = this.currentTime % this.duration;
      } else {
        this.currentTime = this.duration;
        this.state = 'stopped';
        this.onStateChange?.(this.state);
      }
    }

    this.onTimeChange?.(this.currentTime);
    return this.currentTime;
  }
}
