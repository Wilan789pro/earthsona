import type { Adapter, EarthSeries } from "../types";
import {
  MODIS_RELIABILITY_BAND,
  MODIS_VI,
  batchModisDates,
  buildModisDatesUrl,
  buildModisSeries,
  buildModisSubsetUrl,
  parseModisDates,
} from "../parsers.js";

/**
 * Forest Voices — ORNL DAAC MODIS/VIIRS subset REST API (no key, CORS echoes the origin).
 *  1. GET /{product}/dates  → list of composite dates for the pixel
 *  2. GET /{product}/subset for the VI band AND the pixel_reliability band, in batches of ≤10 dates
 * Values: scale 0.0001, fill -3000, valid range -2000..10000 (from /MOD13Q1/bands).
 * QA: reliability 2 (snow/ice) and 3 (cloudy) → null; 1 (marginal) kept and flagged.
 */
export const modisAdapter: Adapter = {
  async fetchSeries(params): Promise<EarthSeries> {
    const f = params.fetchImpl ?? fetch;
    const product = params.def.product ?? "MOD13Q1";
    const band = params.def.band ?? (MODIS_VI[params.def.variable] ?? MODIS_VI.NDVI).band;
    const { lat, lon } = params.region;
    const headers = { Accept: "application/json" };
    const get = async (url: string) => {
      const res = await f(url, { signal: params.signal, headers });
      if (!res.ok) throw new Error(`MODIS HTTP ${res.status}`);
      return res.json();
    };

    const batches = batchModisDates(parseModisDates(await get(buildModisDatesUrl(product, lat, lon))), params.def.start, params.def.end);
    if (!batches.length) throw new Error("MODIS: no composites in the requested period");

    const urls: string[] = [];
    const bodies: unknown[] = [];
    const reliability: unknown[] = [];
    for (const b of batches) {
      const url = buildModisSubsetUrl({ product, lat, lon, band, startDate: b.startDate, endDate: b.endDate });
      urls.push(url);
      bodies.push(await get(url));
      reliability.push(await get(buildModisSubsetUrl({ product, lat, lon, band: MODIS_RELIABILITY_BAND, startDate: b.startDate, endDate: b.endDate })));
    }
    return buildModisSeries(bodies, {
      experience: params.experience,
      variable: params.def.variable,
      product,
      region: params.region,
      periodKey: params.def.periodKey,
      urls,
      reliabilityJsons: reliability,
    });
  },
};
