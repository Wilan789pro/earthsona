import type { Adapter, EarthSeries, FetchParams } from "../types";
import { buildPowerSeries, buildPowerUrl } from "../parsers.js";

/**
 * Earth's Pulse — NASA POWER point API (no key, CORS `*`).
 * Daily:   /api/temporal/daily/point   start/end = YYYYMMDD
 * Monthly: /api/temporal/monthly/point start/end = YYYY
 * Fill value (-999) → null, monthly "13" (annual) rows dropped — see parsers.js.
 */
export function powerUrlFor(params: FetchParams): string {
  return buildPowerUrl({
    resolution: params.def.resolution ?? "monthly",
    parameters: [params.def.variable],
    lat: params.region.lat,
    lon: params.region.lon,
    start: params.def.start,
    end: params.def.end,
  });
}

export const powerAdapter: Adapter = {
  async fetchSeries(params): Promise<EarthSeries> {
    const f = params.fetchImpl ?? fetch;
    const url = powerUrlFor(params);
    const res = await f(url, { signal: params.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`POWER HTTP ${res.status}`);
    const json = await res.json();
    return buildPowerSeries(json, {
      experience: params.experience,
      variable: params.def.variable,
      region: params.region,
      periodKey: params.def.periodKey,
      url,
    });
  },
};
