/**
 * The single normalised data shape that every source (simulated, NASA POWER, ORNL MODIS, SST…)
 * returns. The sound engine, chart and "Understand" text only ever see this shape.
 */

export type ExperienceId = "ocean" | "forest" | "pulse";

export interface EarthPoint {
  /** ISO 8601 date (YYYY-MM-DD). */
  time: string;
  /** Physical value in `unit`. `null` = missing / fill value / cloud-contaminated. */
  value: number | null;
}

export interface EarthSeries {
  id: string; // "power-t2m-port-louis-2015-2024"
  experience: ExperienceId;
  variable: string; // "T2M", "NDVI", "SST"
  label: string; // "Air temperature at 2 m"
  unit: string; // "°C", "mm/day", "NDVI (unitless)"
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
  baseline: { temp: number; ndvi: number; sst: number };
}

export interface SeriesDef {
  source: "power" | "modis" | "sst";
  variable: string;
  resolution?: "daily" | "monthly";
  product?: string;
  band?: string;
  start: string;
  end: string;
  periodKey: string;
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
