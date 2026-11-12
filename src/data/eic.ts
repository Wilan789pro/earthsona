import { parseSvsPage } from "./parsers.js";
import type { ExperienceId } from "./types";
import { getExperience } from "./regions";

/**
 * NASA Earth Information Center (EIC) visuals paired with each experience.
 *
 * Source: NASA Scientific Visualization Studio API (https://svs.gsfc.nasa.gov/api/{id}). The ids come from the
 * official EIC gallery (40467) and the EIC Daily Visualizations gallery (40512) and are listed, with an honest
 * note on how each relates to the sound, in scripts/regions.json → "eic".
 *
 * NOTE: the SVS API does not send CORS headers for our origin, so the browser cannot call it directly.
 * `npm run fetch-data -- --only=eic` saves the metadata (and images ≤ 3 MB) to public/data/eic/{experience}.json.
 */
export interface EicFrame {
  key: string;
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
  /** Which EIC gallery it comes from. */
  gallery?: string;
  /** Underlying dataset of the visual. */
  dataset?: string;
  /** How the visual relates to the sound (topic, dataset, period). */
  relation?: string;
}

export interface EicRef {
  key: string;
  svsId: number;
  itemTitle?: string;
  gallery?: string;
  dataset?: string;
  relation?: string;
}

const cache = new Map<ExperienceId, Promise<EicFrame[]>>();

/**
 * @param tryLive also try the SVS API directly when nothing is bundled. Off by default because SVS
 *        currently rejects cross-origin browser requests (it would only add console errors).
 */
export function loadEicFrames(
  experience: ExperienceId,
  { tryLive = false, fetchImpl = (...a: Parameters<typeof fetch>) => fetch(...a) }: { tryLive?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<EicFrame[]> {
  if (!cache.has(experience)) cache.set(experience, load(experience, fetchImpl, tryLive));
  return cache.get(experience)!;
}

type Stored = Omit<EicFrame, "remoteImageUrl" | "bundledImage"> & { localImage?: string };

async function load(experience: ExperienceId, fetchImpl: typeof fetch, tryLive: boolean): Promise<EicFrame[]> {
  const base = `${import.meta.env?.BASE_URL ?? "/"}data/eic/`;
  const refs = getExperience(experience).eic;
  try {
    const r = await fetchImpl(`${base}${experience}.json`);
    if (r.ok) {
      const j = (await r.json()) as { frames?: Stored[] } & Stored;
      const list: Stored[] = Array.isArray(j.frames) ? j.frames : [j];
      return list.map((f) => {
        const ref = refs.find((x) => x.key === f.key || x.svsId === f.svsId);
        return {
          ...f,
          key: f.key ?? ref?.key ?? String(f.svsId),
          gallery: f.gallery ?? ref?.gallery,
          dataset: f.dataset ?? ref?.dataset,
          relation: f.relation ?? ref?.relation,
          remoteImageUrl: f.imageUrl,
          imageUrl: f.localImage ? `${base}${f.localImage}` : f.imageUrl,
          bundledImage: Boolean(f.localImage),
        };
      });
    }
  } catch {
    /* fall through */
  }
  if (!tryLive) return [];
  const out: EicFrame[] = [];
  for (const ref of refs) {
    try {
      const r = await fetchImpl(`https://svs.gsfc.nasa.gov/api/${ref.svsId}`, { signal: AbortSignal.timeout?.(8000) });
      if (!r.ok) continue;
      const p = parseSvsPage(await r.json(), { itemTitle: ref.itemTitle });
      out.push({ ...p, key: ref.key, gallery: ref.gallery, dataset: ref.dataset, relation: ref.relation, remoteImageUrl: p.imageUrl, bundledImage: false });
    } catch {
      /* skip */
    }
  }
  return out;
}
