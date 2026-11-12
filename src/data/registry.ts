import type { Adapter, CleanSeries, DataOrigin, EarthSeries, ExperienceId, PeriodDef, RegionDef, SeriesDef } from "./types";
import { normaliseSeries } from "./normalise";
import { simulatedAdapter } from "./adapters/simulatedAdapter";
import { powerAdapter } from "./adapters/powerAdapter";
import { modisAdapter } from "./adapters/modisAdapter";
import { sstAdapter, SST_IMPLEMENTED } from "./adapters/sstAdapter";

/**
 * For a given experience + region + series definition, try in order:
 *   1. bundled real JSON (public/data/real/…, written by `npm run fetch-data`)
 *   2. live NASA API (only if the user enabled live mode, ~10 s timeout)
 *   3. simulated
 * …and report which one was used. Every result goes through the shared normalisation step.
 */

export interface ManifestEntry {
  id: string;
  experience: ExperienceId;
  variable: string;
  regionId: string;
  periodKey: string;
  file: string; // relative to data/real/
  points: number;
  sourceName: string;
  retrievedAt: string;
}

export interface Manifest {
  generatedAt: string;
  series: ManifestEntry[];
}

export interface SeriesRequest {
  experience: ExperienceId;
  region: RegionDef;
  def: SeriesDef;
  /** "auto" = best available; "simulated" = force simulated (for comparison / demo). */
  mode: "auto" | "simulated";
  live: boolean;
}

export interface SeriesResult {
  series: CleanSeries;
  origin: DataOrigin;
  /** Polite message for the aria-live notice area (only set when something fell back). */
  notice?: string;
}

const LIVE_ADAPTERS: Record<SeriesDef["source"], { adapter: Adapter; real: boolean; name: string }> = {
  power: { adapter: powerAdapter, real: true, name: "NASA POWER" },
  modis: { adapter: modisAdapter, real: true, name: "ORNL DAAC MODIS" },
  sst: { adapter: sstAdapter, real: SST_IMPLEMENTED, name: "SST" },
};

export const LIVE_TIMEOUT_MS = 10_000;

export class DataRegistry {
  private manifest: Promise<Manifest | null> | null = null;
  private liveCache = new Map<string, EarthSeries>();
  private fileCache = new Map<string, EarthSeries>();

  constructor(
    private readonly baseUrl: string = `${import.meta.env?.BASE_URL ?? "/"}data/real/`,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    private readonly timeoutMs: number = LIVE_TIMEOUT_MS,
  ) {}

  loadManifest(): Promise<Manifest | null> {
    if (!this.manifest) {
      this.manifest = this.fetchImpl(`${this.baseUrl}index.json`)
        .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
        .catch(() => null);
    }
    return this.manifest;
  }

  /** Which (experience, region, variable) combinations have bundled real data. */
  async bundledEntry(experience: ExperienceId, regionId: string, def: SeriesDef): Promise<ManifestEntry | undefined> {
    const m = await this.loadManifest();
    return m?.series.find(
      (s) => s.experience === experience && s.regionId === regionId && s.variable === def.variable && s.periodKey === def.periodKey,
    );
  }

  async getSeries(req: SeriesRequest): Promise<SeriesResult> {
    const key = `${req.experience}|${req.region.id}|${req.def.variable}|${req.def.periodKey}`;
    const params = {
      experience: req.experience,
      region: req.region,
      def: req.def,
      fetchImpl: this.fetchImpl,
    };
    const notices: string[] = [];

    if (req.mode === "auto") {
      // 1. Bundled real JSON
      const entry = await this.bundledEntry(req.experience, req.region.id, req.def);
      if (entry) {
        try {
          let s = this.fileCache.get(entry.file);
          if (!s) {
            const r = await this.fetchImpl(`${this.baseUrl}${entry.file}`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            s = (await r.json()) as EarthSeries;
            this.fileCache.set(entry.file, s);
          }
          return { series: normaliseSeries(s), origin: "bundled" };
        } catch (err) {
          console.warn("Bundled data failed, falling through", err);
        }
      }

      // 2. Live API (opt-in)
      const live = LIVE_ADAPTERS[req.def.source];
      if (req.live && live?.real) {
        const cached = this.liveCache.get(key);
        if (cached) return { series: normaliseSeries(cached), origin: "live" };
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        try {
          const s = await live.adapter.fetchSeries({ ...params, signal: ctrl.signal });
          const clean = normaliseSeries(s); // throws if no valid values → treated as failure
          this.liveCache.set(key, s);
          return { series: clean, origin: "live" };
        } catch (err) {
          console.warn(`Live ${live.name} request failed`, err);
          notices.push(
            `Live ${live.name} data could not be loaded${ctrl.signal.aborted ? " in time" : ""}. ` +
              `Playing simulated demonstration data instead.`,
          );
        } finally {
          clearTimeout(timer);
        }
      }
    }

    // 3. Simulated
    const sim = await simulatedAdapter.fetchSeries(params);
    return { series: normaliseSeries(sim), origin: "simulated", notice: notices[0] };
  }
}

/** All layers of one experience period for one place, loaded together (first layer = time axis). */
export interface TrackLayer {
  def: SeriesDef;
  result: SeriesResult;
}

export interface Track {
  experience: ExperienceId;
  region: RegionDef;
  period: PeriodDef;
  layers: TrackLayer[];
  /** Origin of the primary (pitch) layer; "mixed" when layers came from different places. */
  origin: DataOrigin | "mixed";
  notices: string[];
}

export async function getTrack(
  registry: DataRegistry,
  req: { experience: ExperienceId; region: RegionDef; period: PeriodDef; mode: "auto" | "simulated"; live: boolean },
): Promise<Track> {
  const layers = await Promise.all(
    req.period.layers.map(async (def) => ({
      def,
      result: await registry.getSeries({ experience: req.experience, region: req.region, def, mode: req.mode, live: req.live }),
    })),
  );
  const origins = new Set(layers.map((l) => l.result.origin));
  const notices = [...new Set(layers.map((l) => l.result.notice).filter((n): n is string => Boolean(n)))];
  return {
    experience: req.experience,
    region: req.region,
    period: req.period,
    layers,
    origin: origins.size === 1 ? layers[0].result.origin : "mixed",
    notices,
  };
}
