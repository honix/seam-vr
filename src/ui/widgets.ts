// Virtual widget system for Canvas 2D panel content.
// Widgets are not Three.js objects - they draw to a 2D canvas and handle pointer events via UV hit testing.

// --- Color conversion utilities (moved from vr-color-picker.ts) ---

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, v];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    case 5: return [v, p, q];
    default: return [v, t, p];
  }
}

// --- Widget interface ---

export interface Widget {
  x: number;
  y: number;
  w: number;
  h: number;
  draw(ctx: CanvasRenderingContext2D): void;
  onPointerDown?(localX: number, localY: number): boolean;
  onPointerMove?(localX: number, localY: number): void;
  onPointerUp?(): void;
}

// --- LabelWidget ---

export interface LabelConfig {
  text: string;
  fontSize?: number;
  color?: string;
  align?: CanvasTextAlign;
}

export class LabelWidget implements Widget {
  x: number;
  y: number;
  w: number;
  h: number;
  private text: string;
  private fontSize: number;
  private color: string;
  private align: CanvasTextAlign;

  constructor(x: number, y: number, w: number, h: number, config: LabelConfig) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.text = config.text;
    this.fontSize = config.fontSize ?? 18;
    this.color = config.color ?? '#e0e0e0';
    this.align = config.align ?? 'left';
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = this.color;
    ctx.font = `${this.fontSize}px sans-serif`;
    ctx.textAlign = this.align;
    ctx.textBaseline = 'middle';
    const tx = this.align === 'left' ? this.x + 8 :
               this.align === 'right' ? this.x + this.w - 8 :
               this.x + this.w / 2;
    ctx.fillText(this.text, tx, this.y + this.h / 2);
  }
}

// --- SliderWidget ---

export interface SliderConfig {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange?: (value: number) => void;
}

export class SliderWidget implements Widget {
  x: number;
  y: number;
  w: number;
  h: number;
  private label: string;
  private min: number;
  private max: number;
  private normalized: number;
  private onChange: ((value: number) => void) | null;
  private dragging = false;

  // Layout constants (relative to widget bounds)
  private trackY: number;
  private trackH = 14;
  private trackPadX = 12;

  constructor(x: number, y: number, w: number, h: number, config: SliderConfig) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.label = config.label;
    this.min = config.min;
    this.max = config.max;
    this.onChange = config.onChange ?? null;

    const range = this.max - this.min;
    this.normalized = range === 0 ? 0 : (config.value - this.min) / range;
    this.trackY = this.h * 0.55;
  }

  private get trackLeft(): number { return this.x + this.trackPadX; }
  private get trackRight(): number { return this.x + this.w - this.trackPadX; }
  private get trackWidth(): number { return this.trackRight - this.trackLeft; }
  private get trackTop(): number { return this.y + this.trackY; }

  private getValue(): number {
    return this.min + this.normalized * (this.max - this.min);
  }

  private formatValue(v: number): string {
    return Math.abs(v) >= 100 ? v.toFixed(0) :
      Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  }

  private updateFromX(px: number): void {
    const t = (px - this.trackLeft) / this.trackWidth;
    this.normalized = Math.max(0, Math.min(1, t));
    this.onChange?.(this.getValue());
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const labelY = this.y + 6;

    // Label (top-left)
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.label, this.x + this.trackPadX, labelY);

    // Value (top-right)
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.formatValue(this.getValue()), this.trackRight, labelY);

    // Track background
    ctx.fillStyle = '#333333';
    ctx.beginPath();
    ctx.roundRect(this.trackLeft, this.trackTop, this.trackWidth, this.trackH, 4);
    ctx.fill();

    // Fill bar
    const fillW = this.trackWidth * this.normalized;
    if (fillW > 0) {
      ctx.fillStyle = '#ff8800';
      ctx.beginPath();
      ctx.roundRect(this.trackLeft, this.trackTop, fillW, this.trackH, 4);
      ctx.fill();
    }

    // Handle circle
    const handleX = this.trackLeft + fillW;
    const handleY = this.trackTop + this.trackH / 2;
    const handleR = 9;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(handleX, handleY, handleR, 0, Math.PI * 2);
    ctx.fill();
  }

  onPointerDown(localX: number, localY: number): boolean {
    // Check if within the track+handle area (generous vertical hitbox)
    if (localY >= this.trackTop - 10 && localY <= this.trackTop + this.trackH + 10 &&
        localX >= this.trackLeft - 10 && localX <= this.trackRight + 10) {
      this.dragging = true;
      this.updateFromX(localX);
      return true;
    }
    return false;
  }

  onPointerMove(localX: number, _localY: number): void {
    if (this.dragging) {
      this.updateFromX(localX);
    }
  }

  onPointerUp(): void {
    this.dragging = false;
  }
}

// --- ColorWheelWidget ---

export interface ColorWheelConfig {
  color?: [number, number, number];
  onChange?: (color: [number, number, number]) => void;
}

export class ColorWheelWidget implements Widget {
  x: number;
  y: number;
  w: number;
  h: number;

  private hue = 0;
  private sat = 1;
  private val = 1;
  private onChange: ((color: [number, number, number]) => void) | null;
  private wheelImage: ImageData | null = null;
  private wheelSize = 128;
  private lastDrawnVal = -1;
  private dragMode: 'wheel' | 'bar' | null = null;

  // Layout
  private wheelCx: number;
  private wheelCy: number;
  private wheelR: number;
  private barX: number;
  private barY: number;
  private barW = 20;
  private barH: number;
  private swatchX: number;
  private swatchY: number;
  private swatchSize = 22;

  constructor(x: number, y: number, w: number, h: number, config: ColorWheelConfig) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.onChange = config.onChange ?? null;

    // Wheel center and radius
    this.wheelR = Math.min(w * 0.35, h * 0.42);
    this.wheelCx = x + this.wheelR + 10;
    this.wheelCy = y + h / 2;

    // Bar to the right of wheel
    this.barX = this.wheelCx + this.wheelR + 14;
    this.barH = this.wheelR * 2;
    this.barY = this.wheelCy - this.barH / 2;

    // Swatch below bar
    this.swatchX = this.barX;
    this.swatchY = this.barY + this.barH + 6;

    if (config.color) {
      [this.hue, this.sat, this.val] = rgbToHsv(config.color[0], config.color[1], config.color[2]);
    }
  }

  private buildWheelImage(): void {
    if (this.wheelImage && this.lastDrawnVal === this.val) return;
    const size = this.wheelSize;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2;
    this.wheelImage = new ImageData(size, size);
    const data = this.wheelImage.data;

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (py * size + px) * 4;
        if (dist <= r) {
          const angle = Math.atan2(dy, dx);
          const h = ((angle / (Math.PI * 2)) + 1) % 1;
          const s = dist / r;
          const [cr, cg, cb] = hsvToRgb(h, s, this.val);
          data[idx] = Math.round(cr * 255);
          data[idx + 1] = Math.round(cg * 255);
          data[idx + 2] = Math.round(cb * 255);
          data[idx + 3] = 255;
        } else {
          data[idx + 3] = 0;
        }
      }
    }
    this.lastDrawnVal = this.val;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // Draw wheel via offscreen imagedata
    this.buildWheelImage();
    if (this.wheelImage) {
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = this.wheelSize;
      tmpCanvas.height = this.wheelSize;
      const tmpCtx = tmpCanvas.getContext('2d')!;
      tmpCtx.putImageData(this.wheelImage, 0, 0);

      const drawSize = this.wheelR * 2;
      ctx.drawImage(tmpCanvas,
        this.wheelCx - this.wheelR, this.wheelCy - this.wheelR,
        drawSize, drawSize);
    }

    // Crosshair on wheel at current H/S
    const angle = this.hue * Math.PI * 2;
    const dist = this.sat * this.wheelR;
    const chX = this.wheelCx + Math.cos(angle) * dist;
    const chY = this.wheelCy + Math.sin(angle) * dist;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(chX, chY, 5, 0, Math.PI * 2);
    ctx.stroke();

    // Brightness bar (vertical gradient)
    const grad = ctx.createLinearGradient(0, this.barY, 0, this.barY + this.barH);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(this.barX, this.barY, this.barW, this.barH);

    // Bar indicator
    const barIndicatorY = this.barY + (1 - this.val) * this.barH;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.barX - 2, barIndicatorY);
    ctx.lineTo(this.barX + this.barW + 2, barIndicatorY);
    ctx.stroke();

    // Swatch
    const [r, g, b] = hsvToRgb(this.hue, this.sat, this.val);
    ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    ctx.fillRect(this.swatchX, this.swatchY, this.swatchSize, this.swatchSize);
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.swatchX, this.swatchY, this.swatchSize, this.swatchSize);
  }

  onPointerDown(localX: number, localY: number): boolean {
    // Test wheel
    const dx = localX - this.wheelCx;
    const dy = localY - this.wheelCy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= this.wheelR) {
      this.dragMode = 'wheel';
      this.updateWheel(localX, localY);
      return true;
    }

    // Test bar
    if (localX >= this.barX && localX <= this.barX + this.barW &&
        localY >= this.barY && localY <= this.barY + this.barH) {
      this.dragMode = 'bar';
      this.updateBar(localY);
      return true;
    }

    return false;
  }

  onPointerMove(localX: number, localY: number): void {
    if (this.dragMode === 'wheel') {
      this.updateWheel(localX, localY);
    } else if (this.dragMode === 'bar') {
      this.updateBar(localY);
    }
  }

  onPointerUp(): void {
    this.dragMode = null;
  }

  private updateWheel(px: number, py: number): void {
    const dx = px - this.wheelCx;
    const dy = py - this.wheelCy;
    const angle = Math.atan2(dy, dx);
    this.hue = ((angle / (Math.PI * 2)) + 1) % 1;
    this.sat = Math.min(1, Math.sqrt(dx * dx + dy * dy) / this.wheelR);
    this.fireChange();
  }

  private updateBar(py: number): void {
    const t = (py - this.barY) / this.barH;
    this.val = Math.max(0, Math.min(1, 1 - t));
    this.fireChange();
  }

  private fireChange(): void {
    this.onChange?.(hsvToRgb(this.hue, this.sat, this.val));
  }
}

// --- DropdownWidget ---

export interface DropdownConfig {
  label: string;
  options: string[];
  selectedIndex?: number;
  onChange?: (index: number) => void;
}

export class DropdownWidget implements Widget {
  x: number;
  y: number;
  w: number;
  h: number;

  private label: string;
  private options: string[];
  private selectedIndex: number;
  private expanded = false;
  private onChange: ((index: number) => void) | null;

  // Layout
  private headerH = 28;
  private optionH = 26;
  private collapsedH: number;

  /** Notify parent to re-layout when expand state changes. Set by PanelCanvas. */
  onExpandChange: (() => void) | null = null;

  constructor(x: number, y: number, w: number, h: number, config: DropdownConfig) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.collapsedH = h;
    this.h = h;
    this.label = config.label;
    this.options = config.options;
    this.selectedIndex = config.selectedIndex ?? 0;
    this.onChange = config.onChange ?? null;
  }

  getExpandedHeight(): number {
    return this.headerH + this.options.length * this.optionH;
  }

  isExpanded(): boolean { return this.expanded; }

  draw(ctx: CanvasRenderingContext2D): void {
    const arrow = this.expanded ? '\u25B2' : '\u25BC';
    const selectedLabel = this.options[this.selectedIndex] ?? '';

    // Header background
    ctx.fillStyle = '#2a2a4e';
    ctx.beginPath();
    ctx.roundRect(this.x, this.y, this.w, this.headerH, 4);
    ctx.fill();

    // Header text
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${this.label}: ${selectedLabel}`, this.x + 10, this.y + this.headerH / 2);

    // Arrow
    ctx.textAlign = 'right';
    ctx.fillText(arrow, this.x + this.w - 10, this.y + this.headerH / 2);

    // Option rows (when expanded)
    if (this.expanded) {
      for (let i = 0; i < this.options.length; i++) {
        const oy = this.y + this.headerH + i * this.optionH;
        const isSelected = i === this.selectedIndex;

        // Option background
        ctx.fillStyle = isSelected ? '#ff8800' : '#222244';
        ctx.fillRect(this.x, oy, this.w, this.optionH);

        // Option text
        ctx.fillStyle = isSelected ? '#000000' : '#e0e0e0';
        ctx.font = '15px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.options[i], this.x + 14, oy + this.optionH / 2);
      }
    }
  }

  onPointerDown(localX: number, localY: number): boolean {
    // Test header
    if (localY >= this.y && localY < this.y + this.headerH &&
        localX >= this.x && localX <= this.x + this.w) {
      this.expanded = !this.expanded;
      this.h = this.expanded ? this.getExpandedHeight() : this.collapsedH;
      this.onExpandChange?.();
      return true;
    }

    // Test option rows (when expanded)
    if (this.expanded) {
      for (let i = 0; i < this.options.length; i++) {
        const oy = this.y + this.headerH + i * this.optionH;
        if (localY >= oy && localY < oy + this.optionH &&
            localX >= this.x && localX <= this.x + this.w) {
          this.selectedIndex = i;
          this.expanded = false;
          this.h = this.collapsedH;
          this.onChange?.(i);
          this.onExpandChange?.();
          return true;
        }
      }
    }

    return false;
  }
}

// --- ClickableRowWidget ---

export interface ClickableRowConfig {
  text: string;
  icon?: string;
  selected?: boolean;
  indent?: number;
  onClick?: () => void;
}

export class ClickableRowWidget implements Widget {
  x: number;
  y: number;
  w: number;
  h: number;
  private text: string;
  private icon: string;
  private selected: boolean;
  private indent: number;
  private onClick: (() => void) | null;

  constructor(x: number, y: number, w: number, h: number, config: ClickableRowConfig) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.text = config.text;
    this.icon = config.icon ?? '';
    this.selected = config.selected ?? false;
    this.indent = config.indent ?? 0;
    this.onClick = config.onClick ?? null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // Selected background highlight
    if (this.selected) {
      ctx.fillStyle = 'rgba(58, 42, 14, 0.8)';
      ctx.fillRect(this.x, this.y, this.w, this.h);
    }

    const textX = this.x + 10 + this.indent;
    const textColor = this.selected ? '#ff8800' : '#e0e0e0';

    ctx.fillStyle = textColor;
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    if (this.icon) {
      ctx.fillText(`${this.icon} ${this.text}`, textX, this.y + this.h / 2);
    } else {
      ctx.fillText(this.text, textX, this.y + this.h / 2);
    }
  }

  onPointerDown(_localX: number, _localY: number): boolean {
    this.onClick?.();
    return true;
  }
}
