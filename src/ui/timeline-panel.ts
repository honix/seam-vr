import * as THREE from 'three';
import { Vec3 } from '../types';
import { TimelineController } from '../animation/timeline-controller';

const PANEL_WIDTH = 0.6;
const PANEL_HEIGHT = 0.1;
const SCRUBBER_RADIUS = 0.015;

export class TimelinePanel {
  private scene: THREE.Scene;
  private timelineController: TimelineController;

  private group: THREE.Group = new THREE.Group();
  private scrubberMesh: THREE.Mesh;
  private playButtonMesh: THREE.Mesh;
  private trackMesh: THREE.Mesh;
  private playheadLine: THREE.Line;
  private keyframeMarkers: THREE.Mesh[] = [];

  private isDraggingScrubber = false;
  private panelWorldPos = new THREE.Vector3();

  isVisible = false;

  constructor(scene: THREE.Scene, timelineController: TimelineController) {
    this.scene = scene;
    this.timelineController = timelineController;

    // Build the panel

    // Background
    const bgGeo = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT);
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x222233,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    this.group.add(bg);

    // Track bar (thin line for scrubbing)
    const trackGeo = new THREE.PlaneGeometry(PANEL_WIDTH - 0.08, 0.008);
    const trackMat = new THREE.MeshBasicMaterial({ color: 0x555577 });
    this.trackMesh = new THREE.Mesh(trackGeo, trackMat);
    this.trackMesh.position.set(0, 0, 0.001);
    this.group.add(this.trackMesh);

    // Scrubber (playhead indicator)
    const scrubGeo = new THREE.CircleGeometry(SCRUBBER_RADIUS, 12);
    const scrubMat = new THREE.MeshBasicMaterial({ color: 0xff6633 });
    this.scrubberMesh = new THREE.Mesh(scrubGeo, scrubMat);
    this.scrubberMesh.position.set(-PANEL_WIDTH / 2 + 0.04, 0, 0.002);
    this.group.add(this.scrubberMesh);

    // Playhead vertical line
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -PANEL_HEIGHT / 2, 0.002),
      new THREE.Vector3(0, PANEL_HEIGHT / 2, 0.002),
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xff6633 });
    this.playheadLine = new THREE.Line(lineGeo, lineMat);
    this.group.add(this.playheadLine);

    // Play/Pause button (small triangle or square)
    const playGeo = new THREE.CircleGeometry(0.015, 3);
    const playMat = new THREE.MeshBasicMaterial({ color: 0x44ff66 });
    this.playButtonMesh = new THREE.Mesh(playGeo, playMat);
    this.playButtonMesh.position.set(-PANEL_WIDTH / 2 + 0.015, -PANEL_HEIGHT / 2 + 0.015, 0.002);
    this.playButtonMesh.rotation.z = -Math.PI / 6;
    this.group.add(this.playButtonMesh);

    this.group.visible = false;
    this.scene.add(this.group);
  }

  show(position: Vec3): void {
    this.group.position.set(position[0], position[1], position[2]);
    this.group.visible = true;
    this.isVisible = true;
    this.panelWorldPos.set(position[0], position[1], position[2]);
  }

  hide(): void {
    this.group.visible = false;
    this.isVisible = false;
  }

  update(): void {
    if (!this.isVisible) return;

    const tc = this.timelineController;
    const duration = tc.duration || 1;
    const t = tc.currentTime / duration;

    // Update scrubber position
    const trackStart = -PANEL_WIDTH / 2 + 0.04;
    const trackEnd = PANEL_WIDTH / 2 - 0.04;
    const x = trackStart + t * (trackEnd - trackStart);

    this.scrubberMesh.position.x = x;
    this.playheadLine.position.x = x;

    // Update play button color based on state
    const playMat = this.playButtonMesh.material as THREE.MeshBasicMaterial;
    if (tc.state === 'playing') {
      playMat.color.setHex(0xff4444); // Red = pause
    } else {
      playMat.color.setHex(0x44ff66); // Green = play
    }
  }

  handleInteraction(position: Vec3, triggerPressed: boolean): void {
    if (!this.isVisible) return;

    const pointer = new THREE.Vector3(...position);
    const localPointer = pointer.clone().sub(this.group.position);

    // Check if near the track bar for scrubbing
    const trackStart = -PANEL_WIDTH / 2 + 0.04;
    const trackEnd = PANEL_WIDTH / 2 - 0.04;

    if (
      triggerPressed &&
      Math.abs(localPointer.y) < PANEL_HEIGHT / 2 &&
      localPointer.x >= trackStart &&
      localPointer.x <= trackEnd
    ) {
      // Scrub to time
      const t = (localPointer.x - trackStart) / (trackEnd - trackStart);
      const time = t * this.timelineController.duration;
      this.timelineController.seek(time);
      this.isDraggingScrubber = true;
    } else if (!triggerPressed) {
      this.isDraggingScrubber = false;
    }

    // Check play button hit
    if (
      triggerPressed &&
      !this.isDraggingScrubber &&
      localPointer.distanceTo(this.playButtonMesh.position) < 0.025
    ) {
      if (this.timelineController.state === 'playing') {
        this.timelineController.pause();
      } else {
        this.timelineController.play();
      }
    }
  }

  addKeyframeMarker(time: number): void {
    const duration = this.timelineController.duration || 1;
    const t = time / duration;

    const trackStart = -PANEL_WIDTH / 2 + 0.04;
    const trackEnd = PANEL_WIDTH / 2 - 0.04;
    const x = trackStart + t * (trackEnd - trackStart);

    const markerGeo = new THREE.PlaneGeometry(0.004, 0.02);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.set(x, PANEL_HEIGHT / 2 - 0.02, 0.002);

    this.group.add(marker);
    this.keyframeMarkers.push(marker);
  }

  clearKeyframeMarkers(): void {
    for (const marker of this.keyframeMarkers) {
      this.group.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    this.keyframeMarkers = [];
  }
}
