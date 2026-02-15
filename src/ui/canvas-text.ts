// Canvas texture utility for text labels and simple shape icons.
// Used by radial menu and floating panels.

import * as THREE from 'three';

export interface TextOptions {
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  width?: number;
  height?: number;
  align?: CanvasTextAlign;
}

const DEFAULT_TEXT_OPTS: Required<TextOptions> = {
  fontSize: 32,
  fontFamily: 'sans-serif',
  color: '#ffffff',
  backgroundColor: 'transparent',
  width: 256,
  height: 64,
  align: 'center',
};

export function createTextTexture(text: string, opts?: TextOptions): THREE.CanvasTexture {
  const o = { ...DEFAULT_TEXT_OPTS, ...opts };
  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext('2d')!;

  if (o.backgroundColor !== 'transparent') {
    ctx.fillStyle = o.backgroundColor;
    ctx.fillRect(0, 0, o.width, o.height);
  }

  ctx.fillStyle = o.color;
  ctx.font = `${o.fontSize}px ${o.fontFamily}`;
  ctx.textAlign = o.align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, o.width / 2, o.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export type IconShape = 'plus' | 'minus' | 'wave' | 'arrows' | 'cube' | 'sphere' | 'capsule' | 'light' | 'move' | 'eye' | 'layers';

export function createIconTexture(icon: IconShape, color: number, size = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = new THREE.Color(color);
  const hex = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;

  ctx.strokeStyle = hex;
  ctx.fillStyle = hex;
  ctx.lineWidth = size / 16;
  ctx.lineCap = 'round';

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.35;

  switch (icon) {
    case 'plus':
      ctx.beginPath();
      ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
      ctx.stroke();
      break;
    case 'minus':
      ctx.beginPath();
      ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
      ctx.stroke();
      break;
    case 'wave':
      ctx.beginPath();
      for (let i = 0; i <= size; i++) {
        const x = i;
        const y = cy + Math.sin((i / size) * Math.PI * 3) * r * 0.5;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    case 'arrows':
      ctx.beginPath();
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
      ctx.moveTo(cx - r * 0.5, cy - r * 0.5); ctx.lineTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.5, cy - r * 0.5);
      ctx.stroke();
      break;
    case 'cube':
      ctx.strokeRect(cx - r * 0.6, cy - r * 0.6, r * 1.2, r * 1.2);
      break;
    case 'sphere':
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'capsule':
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.3, r * 0.4, Math.PI, 0);
      ctx.lineTo(cx + r * 0.4, cy + r * 0.3);
      ctx.arc(cx, cy + r * 0.3, r * 0.4, 0, Math.PI);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'light':
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      // rays
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * r * 0.55, cy + Math.sin(angle) * r * 0.55);
        ctx.lineTo(cx + Math.cos(angle) * r * 0.85, cy + Math.sin(angle) * r * 0.85);
        ctx.stroke();
      }
      break;
    case 'move':
      // Four arrows
      ctx.beginPath();
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
      ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
      // Arrowheads
      const ah = r * 0.3;
      ctx.moveTo(cx - ah, cy - r + ah); ctx.lineTo(cx, cy - r); ctx.lineTo(cx + ah, cy - r + ah);
      ctx.moveTo(cx - ah, cy + r - ah); ctx.lineTo(cx, cy + r); ctx.lineTo(cx + ah, cy + r - ah);
      ctx.moveTo(cx - r + ah, cy - ah); ctx.lineTo(cx - r, cy); ctx.lineTo(cx - r + ah, cy + ah);
      ctx.moveTo(cx + r - ah, cy - ah); ctx.lineTo(cx + r, cy); ctx.lineTo(cx + r - ah, cy + ah);
      ctx.stroke();
      break;
    case 'eye':
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.8, r * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'layers':
      for (let i = 0; i < 3; i++) {
        const y = cy - r * 0.4 + i * r * 0.4;
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.7, y);
        ctx.lineTo(cx, y - r * 0.25);
        ctx.lineTo(cx + r * 0.7, y);
        ctx.lineTo(cx, y + r * 0.25);
        ctx.closePath();
        ctx.stroke();
      }
      break;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
