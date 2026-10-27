/**
 * In-browser pixel analysis for the inspector — the same algorithm as the Rust
 * `pixel_diff` (pxsig-core/src/pixeldiff.rs), live under the tolerance slider:
 * a changed-pixel mask, the dimmed "pixel diff" view, the highlight overlay, and
 * change regions (8px tiles holding a changed pixel, joined 8-way, largest first).
 */
import type { Region } from '../data';

export interface Analysis {
  W: number;
  H: number;
  changed: number;
  maxD: number;
  diff: HTMLCanvasElement;
  highlight: HTMLCanvasElement;
  regions: Region[];
}

export const canvasOf = (w: number, h: number) =>
  Object.assign(document.createElement('canvas'), { width: w, height: h });

export function readPixels(img: HTMLImageElement): ImageData | null {
  try {
    const c = canvasOf(img.naturalWidth, img.naturalHeight);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  } catch {
    return null; // file:// taints the canvas
  }
}

export function analyse(pa: ImageData, pb: ImageData, tol: number): Analysis {
  const W = Math.max(pa.width, pb.width);
  const H = Math.max(pa.height, pb.height);
  const mask = new Uint8Array(W * H);
  const diff = canvasOf(W, H);
  const highlight = canvasOf(W, H);
  const dImg = diff.getContext('2d')!.createImageData(W, H);
  const hImg = highlight.getContext('2d')!.createImageData(W, H);
  let changed = 0;
  let maxD = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inA = x < pa.width && y < pa.height;
      const inB = x < pb.width && y < pb.height;
      const i = (y * pa.width + x) * 4;
      const j = (y * pb.width + x) * 4;
      const o = (y * W + x) * 4;
      let d = 255;
      if (inA && inB)
        d = Math.max(
          Math.abs(pa.data[i] - pb.data[j]),
          Math.abs(pa.data[i + 1] - pb.data[j + 1]),
          Math.abs(pa.data[i + 2] - pb.data[j + 2]),
          Math.abs(pa.data[i + 3] - pb.data[j + 3])
        );
      if (d > maxD) maxD = d;
      if (d > tol) {
        mask[y * W + x] = 1;
        changed++;
        dImg.data[o] = 255;
        dImg.data[o + 2] = 153;
        dImg.data[o + 3] = 255;
        hImg.data[o] = 255;
        hImg.data[o + 2] = 153;
        hImg.data[o + 3] = 150;
      } else {
        const src = inB ? pb : pa;
        const k = inB ? j : i;
        const lum = 0.2126 * src.data[k] + 0.7152 * src.data[k + 1] + 0.0722 * src.data[k + 2];
        dImg.data[o] = dImg.data[o + 1] = dImg.data[o + 2] = lum;
        dImg.data[o + 3] = 64;
      }
    }
  }
  diff.getContext('2d')!.putImageData(dImg, 0, 0);
  highlight.getContext('2d')!.putImageData(hImg, 0, 0);
  return { W, H, changed, maxD, diff, highlight, regions: regionsOf(mask, W, H, 8).slice(0, 200) };
}

export function regionsOf(mask: Uint8Array, W: number, H: number, T: number): Region[] {
  const tw = Math.ceil(W / T);
  const th = Math.ceil(H / T);
  const tiles = new Uint8Array(tw * th);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (mask[y * W + x]) tiles[((y / T) | 0) * tw + ((x / T) | 0)] = 1;
  const seen = new Uint8Array(tw * th);
  const out: Region[] = [];
  for (let t = 0; t < tiles.length; t++) {
    if (!tiles[t] || seen[t]) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    const q = [t];
    seen[t] = 1;
    while (q.length) {
      const u = q.pop()!;
      const ux = u % tw;
      const uy = (u / tw) | 0;
      x0 = Math.min(x0, ux);
      y0 = Math.min(y0, uy);
      x1 = Math.max(x1, ux);
      y1 = Math.max(y1, uy);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const vx = ux + dx;
          const vy = uy + dy;
          if (vx < 0 || vy < 0 || vx >= tw || vy >= th) continue;
          const v = vy * tw + vx;
          if (tiles[v] && !seen[v]) {
            seen[v] = 1;
            q.push(v);
          }
        }
    }
    const x = x0 * T;
    const y = y0 * T;
    const w = Math.min(W, (x1 + 1) * T) - x;
    const h = Math.min(H, (y1 + 1) * T) - y;
    let px = 0;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px += mask[yy * W + xx];
    out.push({ x, y, w, h, px });
  }
  return out.sort((a, b) => b.px - a.px || a.y - b.y || a.x - b.x);
}

/** Keep only the red (changed) cells of a signature heatmap, transparent elsewhere. */
export function cellsLayer(heat: HTMLImageElement): HTMLCanvasElement | null {
  const px = readPixels(heat);
  if (!px) return null;
  for (let i = 0; i < px.data.length; i += 4) {
    const red = px.data[i] - Math.max(px.data[i + 1], px.data[i + 2]);
    px.data[i + 3] = red > 40 ? Math.min(255, 80 + red) : 0;
  }
  const c = canvasOf(px.width, px.height);
  c.getContext('2d')!.putImageData(px, 0, 0);
  return c;
}

export const loadImg = (src: string) =>
  new Promise<HTMLImageElement | null>((ok) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => ok(im);
    im.onerror = () => ok(null);
    im.src = src;
  });

export const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
