import * as THREE from 'three';

export class XRSessionManager {
  private renderer: THREE.WebGLRenderer;
  private session: XRSession | null = null;
  private refSpace: XRReferenceSpace | null = null;

  onSessionStart: (() => void) | null = null;
  onSessionEnd: (() => void) | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
  }

  async isSupported(): Promise<boolean> {
    if (!navigator.xr) return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      return false;
    }
  }

  setupVRButton(button: HTMLButtonElement): void {
    this.isSupported().then((supported) => {
      if (supported) {
        button.textContent = 'Enter VR';
        button.disabled = false;
        button.addEventListener('click', () => {
          if (this.session) {
            this.endSession();
          } else {
            this.startSession();
          }
        });
      } else {
        button.textContent = 'VR Not Supported';
        button.disabled = true;
      }
    });
  }

  async startSession(): Promise<void> {
    if (!navigator.xr) return;

    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });

    this.session = session;
    await this.renderer.xr.setSession(session);

    this.refSpace = await session.requestReferenceSpace('local-floor');

    session.addEventListener('end', () => {
      this.session = null;
      this.refSpace = null;
      this.onSessionEnd?.();
    });

    session.addEventListener('inputsourceschange', () => {
      console.log('[XR] Input sources changed, count:', session.inputSources.length);
    });

    console.log('[XR] Session started, inputSources:', session.inputSources.length);

    this.onSessionStart?.();
  }

  endSession(): void {
    if (this.session) {
      this.session.end();
    }
  }

  getReferenceSpace(): XRReferenceSpace | null {
    return this.refSpace;
  }

  isInVR(): boolean {
    return this.session !== null;
  }
}
