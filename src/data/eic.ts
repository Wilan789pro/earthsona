import { parseSvsPage } from "./parsers.js";
import type { ExperienceId } from "./types";
import { getExperience } from "./regions";

/**
 * EIC visual frame hook — deliberately small and isolated so the approach can change after the
 * mentor conversation.
 *
 * Source: NASA Scientific Visualization Studio API (https://svs.gsfc.nasa.gov/api/{id}), which backs the
 * Earth Information Center's Earth Now dashboard (gallery 40509).
 *
 * NOTE: the SVS API does not send CORS headers for our origin, so the browser cannot call it
 * directly. `npm run fetch-data` saves the metadata (and the image, when small enough) to
 * public/data/eic/{experience}.json. The live call below is attempted only as a last resort.
 */
export interface EicFrame {
  svsId: number;
  title: string;
  description: string;
  /** Image to display: bundled local path when available, otherwise the remote SVS URL. */
  imageUrl: string;
  remoteImageUrl: string;
  altText: string;
  pageUrl: string;
  released: string | null;
  updated: string | null;
  credit: string;
  retrievedAt?: string;
  bundledImage: boolean;
}

const cache = new Map<ExperienceId, Promise<EicFrame | null>>();

export function loadEicFrame(experience: ExperienceId, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<EicFrame | null> {
  if (!cache.has(experience)) cache.set(experience, load(experience, fetchImpl));
  return cache.get(experience)!;
}

async function load(experience: ExperienceId, fetchImpl: typeof fetch): Promise<EicFrame | null> {
  const base = `${import.meta.env?.BASE_URL ?? "/"}data/eic/`;
  try {
    const r = await fetchImpl(`${base}${experience}.json`);
    if (r.ok) {
      const j = (await r.json()) as EicFrame & { localImage?: string };
      return {
        ...j,
        remoteImageUrl: j.imageUrl,
        imageUrl: j.localImage ? `${base}${j.localImage}` : j.imageUrl,
        bundledImage: Boolean(j.localImage),
      };
    }
  } catch {
    /* fall through */
  }
  const { svsId, itemTitle } = getExperience(experience).eic;
  try {
    const r = await fetchImpl(`https://svs.gsfc.nasa.gov/api/${svsId}`, { signal: AbortSignal.timeout?.(8000) });
    if (!r.ok) return null;
    const p = parseSvsPage(await r.json(), { itemTitle });
    return { ...p, remoteImageUrl: p.imageUrl, bundledImage: false };
  } catch {
    return null;
  }
}
