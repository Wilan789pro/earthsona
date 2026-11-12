import type { Adapter, EarthSeries, FetchParams } from "../types";
import { ERDDAP_DEFAULT, buildErddapSstSeries, buildErddapUrl } from "../parsers.js";

/**
 * Ocean Symphony — NASA/JPL MUR SST v4.1 (GHRSST L4, 0.01°, daily) and its anomaly, read as a point
 * time series from an ERDDAP griddap server (no login). Primary dataset page:
 *   https://podaac.jpl.nasa.gov/dataset/MUR-JPL-L4-GLOB-v4.1
 * Default server: NOAA CoastWatch West Coast node (jplMURSST41 / jplMURSST41anom1day). Override with
 * VITE_ERDDAP_BASE (browser) or ERDDAP_BASE (pre-fetch script).
 *
 * The anomaly is the dataset's own `sstAnom` (its baseline is described in the dataset metadata, which the
 * pre-fetch script stores with the series). We never compute an anomaly from raw SST ourselves.
 */
export const SST_IMPLEMENTED = true;

function erddapBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_ERDDAP_BASE || ERDDAP_DEFAULT.base;
}

export function sstUrlFor(params: FetchParams, base = erddapBase()): string {
  const ds = params.def.variable === "SSTA" ? ERDDAP_DEFAULT.anomaly : ERDDAP_DEFAULT.sst;
  return buildErddapUrl({
    base,
    datasetId: ds.datasetId,
    variable: ds.variable,
    start: params.def.start,
    end: params.def.end,
    stride: params.def.stride ?? 7,
    lat: params.region.lat,
    lon: params.region.lon,
  });
}

export const sstAdapter: Adapter = {
  async fetchSeries(params): Promise<EarthSeries> {
    const f = params.fetchImpl ?? fetch;
    const url = sstUrlFor(params);
    const res = await f(url, { signal: params.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`ERDDAP HTTP ${res.status}`);
    const ds = params.def.variable === "SSTA" ? ERDDAP_DEFAULT.anomaly : ERDDAP_DEFAULT.sst;
    return buildErddapSstSeries(await res.json(), {
      experience: params.experience,
      variable: params.def.variable as "SST" | "SSTA",
      erddapVariable: ds.variable,
      datasetId: ds.datasetId,
      region: params.region,
      periodKey: params.def.periodKey,
      url,
    });
  },
};
