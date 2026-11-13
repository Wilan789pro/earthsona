import type { ExperienceId } from "./data/types";

/**
 * Globe looks for each world, painted from the bundled NASA images (no invented data):
 *   ocean  – only the sea, coloured by depth from the Blue Marble bathymetry (deeper = darker blue);
 *            the land is a pale sand colour. Water mask = where the MUR SST map has values.
 *   forest – only the land's greenness from the MODIS NDVI map (greener = darker green); the sea is plain.
 *   pulse  – the MERRA-2 air-temperature map (warm = red/orange, cold = blue/purple).
 *
 * "Pretend" changes (Luna's playground) repaint the same pixels: they are drawings of a make-believe
 * situation, shown with a "Pretend" label, never presented as NASA data.
 */
export interface Pretend {
  /** Ocean: degrees warmer (+) or cooler (−) than the real map, −3…+4. */
  seaWarmth?: number;
  /** Forest: how much of today's greenness is left, 0…1 (1 = like the real map). */
  green?: number;
  /** Weather: air temperature change in °C, −10…+10. */
  airWarmth?: number;
}

const W = 1024;
const H = 512;

interface Layers {
  base: Uint8ClampedArray; // Blue Marble (relief + bathymetry)
  sst: Uint8ClampedArray; // MUR SST map (alpha = water)
  ndvi: Uint8ClampedArray; // MODIS NDVI map (alpha = land)
  t2m: Uint8ClampedArray; // MERRA-2 air temperature
}

let layers: Promise<Layers | null> | null = null;

function loadPixels(url: string): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, W, H);
      resolve(g.getImageData(0, 0, W, H).data);
    };
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

export function loadThemeLayers(base: string, files: { ocean: string; forest: string; pulse: string }): Promise<Layers | null> {
  layers ??= Promise.all([
    loadPixels(`${base}blue-marble.jpg`),
    loadPixels(`${base}${files.ocean}`),
    loadPixels(`${base}${files.forest}`),
    loadPixels(`${base}${files.pulse}`),
  ])
    .then(([b, s, n, t]) => ({ base: b, sst: s, ndvi: n, t2m: t }))
    .catch(() => null);
  return layers;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Cheap per-pixel hash so changes appear in natural-looking patches, not as a flat tint. */
const hash = (i: number) => {
  let x = (i * 374761393) ^ 0x5bd1e995;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
};
/** Smooth patch noise from the hash on a coarse grid. */
function patch(x: number, y: number): number {
  const gx = x >> 4;
  const gy = y >> 4;
  return hash(gx * 977 + gy * 131) * 0.75 + hash(x * 7 + y * 13) * 0.25;
}

/** Paint a world's look (and any pretend change) into `out` (ImageData of W×H). */
export function paintTheme(L: Layers, exp: ExperienceId, p: Pretend, out: ImageData): void {
  const o = out.data;
  const { base, sst, ndvi, t2m } = L;
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const lum = (base[i] * 0.3 + base[i + 1] * 0.5 + base[i + 2] * 0.2) / 255;
      let r: number, g: number, b: number;
      if (exp === "ocean") {
        const water = sst[i + 3] > 40;
        if (water) {
          // Bathymetry: in the Blue Marble image shallow sea is lighter, deep sea is darker.
          const depth = clamp01((lum - 0.08) / 0.4); // 0 deep … 1 shallow
          r = mix(28, 140, depth);
          g = mix(98, 226, depth);
          b = mix(196, 255, depth);
          const w = p.seaWarmth ?? 0;
          if (w > 0) {
            // Warmer: blue slides towards turquoise then coral, more strongly in warm (tropical) seas;
            // the depth shading stays visible.
            const t = clamp01(w / 4) * (0.45 + 0.55 * clamp01(1 - Math.abs(lat) / 55));
            r = mix(r, 255, t * 0.75);
            g = mix(g, 160 + depth * 40, t * 0.55);
            b = mix(b, 110 + depth * 40, t * 0.7);
            // Pretend coral bleaching: shallow tropical water gets white patches as it warms.
            const shallow = depth > 0.42;
            if (w >= 1.5 && Math.abs(lat) < 32 && shallow && patch(x, y) < clamp01((w - 1) / 3) * 0.75) (r = 255), (g = 252), (b = 245);
          } else if (w < 0) {
            const t = clamp01(-w / 3);
            r = mix(r, 200, t * 0.5);
            g = mix(g, 230, t * 0.4);
            b = mix(b, 255, t * 0.3);
          }
        } else {
          const s = 0.85 + lum * 0.25; // a hint of relief on the sand
          r = 246 * s;
          g = 234 * s;
          b = 205 * s;
        }
      } else if (exp === "forest") {
        const land = ndvi[i + 3] > 40;
        if (land) {
          r = ndvi[i];
          g = ndvi[i + 1];
          b = ndvi[i + 2];
          const greenness = clamp01((g - r) / 120); // how green this pixel is on the NDVI map
          // Brighten the map for children while keeping "greener = darker green".
          r = mix(r, 255, 0.12);
          g = mix(g, 255, 0.08);
          b = mix(b, 255, 0.12);
          const keep = p.green ?? 1;
          if (keep < 1 && greenness > 0.15) {
            const gone = patch(x, y) > keep; // patches disappear first, like a real clearing would look
            const t = gone ? 1 : (1 - keep) * 0.35;
            r = mix(r, 196, t);
            g = mix(g, 156, t);
            b = mix(b, 104, t);
          }
        } else {
          r = 168;
          g = 220;
          b = 255;
        }
      } else {
        r = mix(t2m[i], 255, 0.12);
        g = mix(t2m[i + 1], 255, 0.12);
        b = mix(t2m[i + 2], 255, 0.12);
        const a = p.airWarmth ?? 0;
        if (a > 0) {
          const t = clamp01(a / 10);
          r = mix(r, 235, t * 0.6);
          g = mix(g, 70, t * 0.55);
          b = mix(b, 60, t * 0.6);
        } else if (a < 0) {
          const t = clamp01(-a / 10);
          r = mix(r, 120, t * 0.6);
          g = mix(g, 190, t * 0.4);
          b = mix(b, 255, t * 0.7);
          if (Math.abs(lat) > 60 - t * 25) (r = mix(r, 245, t)), (g = mix(g, 250, t)), (b = mix(b, 255, t)); // pretend ice grows
        }
      }
      // Coastlines (where the MUR sea mask changes) so children can find the continents in every world.
      if (exp !== "ocean" && x + 1 < W && y + 1 < H) {
        const here = sst[i + 3] > 40;
        if (here !== sst[i + 7] > 40 || here !== sst[i + W * 4 + 3] > 40) (r *= 0.45), (g *= 0.45), (b *= 0.5);
      }
      o[i] = r;
      o[i + 1] = g;
      o[i + 2] = b;
      o[i + 3] = 255;
    }
  }
}

/** Soft pretend clouds (only used in Luna's playground for "more rain"). */
export function paintClouds(out: ImageData, amount: number): void {
  const o = out.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const n = (patch(x, y) + patch(x + 37, y + 11)) / 2;
      const a = clamp01((n - (1 - amount) * 0.9) * 2.2) * 230;
      o[i] = o[i + 1] = o[i + 2] = 255;
      o[i + 3] = a;
    }
  }
}

export const THEME_SIZE = { W, H };
