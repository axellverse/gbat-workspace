"use client";

/**
 * Builds the post image from a product photo entirely in the browser — no
 * image-model cost, and the product stays photographically accurate.
 *
 * Two sizes, because the networks disagree about shape: Pinterest wants 2:3,
 * while Instagram rejects anything taller than 4:5. The layout is written
 * against the pin's height and scaled, so both renders look like one design.
 */

import type { ImageTreatment } from "./styles";

export type Size = { width: number; height: number };

export const PIN_SIZE: Size = { width: 1000, height: 1500 };
export const SOCIAL_SIZE: Size = { width: 1080, height: 1350 };

export type ComposeOptions = {
  imageUrl: string;
  headline: string;
  brand: string;
  price: string;
  cta: string;
  accent: string;
  /** Off for "product photo" and "AI image" modes, which crop without branding. */
  overlay: boolean;
  /** How the chosen post style wants the overlay drawn. */
  treatment: ImageTreatment;
};

const REFERENCE_HEIGHT = 1500;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the product image."));
    // Remote images are proxied through our own origin so the canvas stays exportable.
    img.src = src.startsWith("data:") ? src : `/api/proxy-image?url=${encodeURIComponent(src)}`;
  });
}

/** Greedy word wrap that also caps the number of rendered lines. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);

  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth) {
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

/** Scales and centres the source image so it covers the whole canvas. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, size: Size) {
  const scale = Math.max(size.width / img.width, size.height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size.width - w) / 2, (size.height - h) / 2, w, h);
}

export async function composeImage(opts: ComposeOptions, size: Size = PIN_SIZE): Promise<string> {
  const img = await loadImage(opts.imageUrl);
  const { width: W, height: H } = size;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  drawCover(ctx, img, size);

  // Without branding the job is done: this is just a correctly cropped photo.
  if (!opts.overlay) return canvas.toDataURL("image/jpeg", 0.92);

  const style = opts.treatment;

  // Every measurement below was tuned at 1500px tall, so scale from there.
  const k = H / REFERENCE_HEIGHT;
  const px = (value: number) => Math.round(value * k);

  // Bottom scrim so light product photos still carry white text. How dark it
  // goes is the style's call — a minimal post barely touches the photo.
  const scrim = ctx.createLinearGradient(0, H * (1 - style.scrim * 0.7), 0, H);
  scrim.addColorStop(0, "rgba(0,0,0,0)");
  scrim.addColorStop(0.55, `rgba(0,0,0,${(style.scrim * 0.62).toFixed(3)})`);
  scrim.addColorStop(1, `rgba(0,0,0,${style.scrim.toFixed(3)})`);
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, W, H);

  const pad = px(70);
  let cursor = H - pad;

  // Corner flag, top-left, for the styles that announce something.
  if (style.badge) {
    ctx.font = `800 ${px(26)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    const label = style.badge;
    const textWidth = ctx.measureText(label).width;
    const boxW = textWidth + px(36);
    const boxH = px(52);

    ctx.fillStyle = opts.accent;
    ctx.beginPath();
    ctx.roundRect(pad, pad, boxW, boxH, px(10));
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, pad + px(18), pad + boxH / 2 + 1);
    ctx.textBaseline = "alphabetic";
  }

  // Call to action pill, bottom-most element.
  if (style.showCta && opts.cta.trim()) {
    ctx.font = `600 ${px(30)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    const label = opts.cta.trim().toUpperCase();
    const pillW = ctx.measureText(label).width + px(68);
    const pillH = px(74);
    const y = cursor - pillH;

    ctx.fillStyle = opts.accent;
    ctx.beginPath();
    ctx.roundRect(pad, y, pillW, pillH, pillH / 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, pad + px(34), y + pillH / 2 + 1);
    cursor = y - px(44);
  }

  // Price, just above the CTA.
  if (style.showPrice && opts.price.trim()) {
    ctx.font = `700 ${px(44)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(opts.price.trim(), pad, cursor);
    cursor -= px(62);
  }

  // Headline grows upward from whatever space is left.
  const headline = style.headlineCase === "upper" ? opts.headline.toUpperCase() : opts.headline;
  if (headline.trim()) {
    const base = headline.length > 60 ? 58 : headline.length > 34 ? 68 : 80;
    const fontSize = px(base * style.headlineScale);
    ctx.font = `800 ${fontSize}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    ctx.fillStyle = "#ffffff";
    // The shorter canvas has less room, so cap the headline at three lines.
    const lines = wrap(ctx, headline.trim(), W - pad * 2, H >= REFERENCE_HEIGHT ? 4 : 3);
    const lineHeight = fontSize * 1.16;

    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = px(18);
    for (let i = lines.length - 1; i >= 0; i--) {
      ctx.fillText(lines[i], pad, cursor);
      cursor -= lineHeight;
    }
    ctx.shadowBlur = 0;
    cursor -= px(10);
  }

  // A short accent rule reads as a divider above the headline.
  if (style.accentRule) {
    ctx.fillStyle = opts.accent;
    ctx.fillRect(pad, cursor - px(18), px(90), px(7));
    cursor -= px(40);
  }

  // Brand eyebrow sits above the headline in the accent colour.
  if (style.showBrand && opts.brand.trim()) {
    ctx.font = `700 ${px(30)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    ctx.fillStyle = opts.accent;
    const label = opts.brand.trim().toUpperCase();
    // letterSpacing is not in every browser's canvas implementation yet.
    const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    spaced.letterSpacing = `${px(3)}px`;
    ctx.fillText(label, pad, cursor);
    spaced.letterSpacing = "0px";
  }

  return canvas.toDataURL("image/jpeg", 0.92);
}
