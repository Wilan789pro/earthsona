import type { Adapter, EarthSeries, FetchParams } from "../types";
import {
  MODIS_NDVI_BAND,
  batchModisDates,
  buildModisDatesUrl,
  buildModisSeries,
  buildModisSubsetUrl,
  parseModisDates,
} from "../parsers.js";

/**
 * Forest Voices — ORNL DAAC MODIS/VIIRS subset REST API (no key, CORS echoes the origin).
 *  1. GET /{product}/dates  → list of composite dates for the pixel
 *  2. GET /{product}/subset in batches of ≤10 dates (the API's hard limit)
 * Values: scale 0.0001, fill -3000, valid range -2000..10000 (from /MOD13Q1/bands).
 */
export const modisAdapter: Adapter = {
  async fetchSeries(params): Promise<EarthSeries> {
    const f = params.fetchImpl ?? fetch;
    const product = params.def.product ?? "MOD13Q1";
    const band = params.def.band ?? MODIS_NDVI_BAND.band;
    const { lat, lon } = params.region;
    const headers = { Accept: "application/json" };

    const datesRes = await f(buildModisDatesUrl(product, lat, lon), { signal: params.signal, headers });
    if (!datesRes.ok) throw new Error(`MODIS dates HTTP ${datesRes.status}`);
    const batches = batchModisDates(parseModisDates(await datesRes.json()), params.def.start, params.def.end);
    if (!batches.length) throw new Error("MODIS: no composites in the requested period");

    const urls: string[] = [];
    const bodies: unknown[] = [];
    for (const b of batches) {
      const url = buildModisSubsetUrl({ product, lat, lon, band, startDate: b.startDate, endDate: b.endDate });
      const res = await f(url, { signal: params.signal, headers });
      if (!res.ok) throw new Error(`MODIS subset HTTP ${res.status}`);
      urls.push(url);
      bodies.push(await res.json());
    }
    return buildModisSeries(bodies, {
      experience: params.experience,
      variable: params.def.variable,
      product,
      region: params.region,
      periodKey: params.def.periodKey,
      urls,
    });
  },
};
