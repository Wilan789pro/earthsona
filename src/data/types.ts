/**
 * The single normalised data shape that every source (simulated, NASA POWER, ORNL MODIS, SST…)
 * returns. The sound engine, chart and "Understand" text only ever see this shape.
 */

export type ExperienceId = "ocean" | "forest" | "pulse";

/**
 * Per-point quality status.
 *  good / marginal  – provider QA (e.g. MOD13Q1 pixel reliability 0 / 1)
 *  cloudy / snow    – provider says this is not a usable signal → value is null
 *  missing          – fill value / no data → value is null
 *  interpolated     – bridged by EARTHSONA across a single-point gap (never an observation)
 *  simulated        – generated, never an observation
 */
export type Quality = "good" | "marginal" | "cloudy" | "snow" | "missing" | "interpolated" | "simulated";

export interface EarthPoint {
  /** ISO 8601 date (YYYY-MM-DD). */
  time: string;
  /** Physical value in `unit`. `null` = missing / fill value / cloud-contaminated. */
  value: number | null;
  /** Optional quality status (absent = observed value, no extra QA information). */
  quality?: Quality;
}

export interface EarthSeries {
  id: string; // "power-t2m-port-louis-2015-2024"
  experience: ExperienceId;
  variable: string; // "T2M", "NDVI", "SST"
  label: string; // "Air temperature at 2 m"
  unit: string; // "°C", "mm/day", "NDVI (unitless)"
  /** Full dataset name, e.g. "MODIS/Terra Vegetation Indices 16-Day L3 Global 250m (MOD13Q1.061)". */
  dataset?: string;
  region: { name: string; lat: number; lon: number };
  points: EarthPoint[];
  source: {
    kind: "simulated" | "nasa";
    name: string; // "NASA POWER (LaRC)"
    product?: string; // "MOD13Q1"
    url?: string; // exact request URL used
    citation: string; // text for the UI / About page
    retrievedAt?: string;
  };
}

/** Summary statistics over the non-null values of a series. */
export interface SeriesStats {
  min: number;
  max: number;
  mean: number;
  /** Count of valid (non-null) values. */
  count: number;
  /** Count of null values that remain as gaps. */
  gaps: number;
  first: EarthPoint;
  last: EarthPoint;
  minPoint: EarthPoint;
  maxPoint: EarthPoint;
}

/** A series after the shared data-quality step (sorted, trimmed, with stats). */
export interface CleanSeries extends EarthSeries {
  stats: SeriesStats;
}

export interface RegionDef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  biome: string;
  country?: string;
  /** One-line geographical context. */
  context?: string;
  /** A short sourced fact (historical, ecological or cultural). */
  fact?: string;
  factSource?: { label: string; url: string };
  /** Regional sound profile available for this place (see src/sonification/palettes.ts). */
  music?: string;
  baseline: { temp: number; ndvi: number; sst: number };
}

/** What a data layer controls in the sound. A layer may have several roles. */
export type SoundRole = "pitch" | "harmony" | "density" | "brightness" | "texture";

export interface SeriesDef {
  source: "power" | "modis" | "sst";
  variable: string;
  /** Sonification roles of this layer (documented in src/sonification/mappings.ts). */
  roles: SoundRole[];
  resolution?: "daily" | "monthly";
  product?: string;
  band?: string;
  /** ERDDAP stride (7 on a daily grid = weekly samples). */
  stride?: number;
  start: string;
  end: string;
  periodKey: string;
}

/** A time window of an experience; its layers are played together. The first layer sets the time axis. */
export interface PeriodDef {
  key: string;
  label: string;
  layers: SeriesDef[];
}

/** Parameters every adapter's `fetchSeries` accepts. */
export interface FetchParams {
  experience: ExperienceId;
  region: { id: string; name: string; lat: number; lon: number; baseline?: RegionDef["baseline"] };
  def: SeriesDef;
  /** Optional abort signal (used for the ~10 s live timeout). */
  signal?: AbortSignal;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface Adapter {
  fetchSeries(params: FetchParams): Promise<EarthSeries>;
}

/** Where the registry actually got the data from. */
export type DataOrigin = "bundled" | "live" | "simulated";
