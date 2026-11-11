// @ts-check
/**
 * Pure, dependency-free parsing & URL building for NASA sources.
 *
 * Plain ESM JavaScript on purpose: it is imported both by the browser adapters (TypeScript, via Vite)
 * and by `scripts/fetch-nasa-data.mjs` (plain Node 18+), so there is exactly ONE implementation of
 * every parsing rule. Facts below were confirmed against real responses (see tests/fixtures/).
 *
 * @typedef {import("./types").EarthSeries} EarthSeries
 * @typedef {import("./types").EarthPoint} EarthPoint
 */

// ---------------------------------------------------------------------------
// Citations (official wording from each provider's documentation)
// ---------------------------------------------------------------------------

/** https://power.larc.nasa.gov/docs/referencing/ */
export const POWER_REFERENCE =
  "The data was obtained from the National Aeronautics and Space Administration (NASA) Langley Research Center (LaRC) " +
  "Prediction of Worldwide Energy Resources (POWER) Project funded through the NASA Earth Science Division.";

/** https://doi.org/10.3334/ORNLDAAC/1600 */
export const TESVIS_REFERENCE =
  "ORNL DAAC. 2018. Terrestrial Ecology Subsetting & Visualization Services (TESViS) RESTful Web Service. " +
  "ORNL DAAC, Oak Ridge, Tennessee, USA. https://doi.org/10.3334/ORNLDAAC/1600";

/** Product-level citation for the NDVI values themselves (LP DAAC). */
export const MOD13Q1_REFERENCE =
  "Didan, K. (2021). MODIS/Terra Vegetation Indices 16-Day L3 Global 250m SIN Grid V061. " +
  "NASA EOSDIS Land Processes Distributed Active Archive Center. https://doi.org/10.5067/MODIS/MOD13Q1.061";

export const SVS_REFERENCE =
  "Visualizations courtesy of NASA's Scientific Visualization Studio (SVS) and the NASA Earth Information Center.";

export const SIMULATED_LABEL = "Simulated demonstration data — not a NASA observation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} source
 * @param {string} variable
 * @param {string} regionId
 * @param {string} periodKey
 */
export function makeSeriesId(source, variable, regionId, periodKey) {
  return `${source}-${variable}-${regionId}-${periodKey}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

/** Round to a sensible number of decimals so bundled JSON stays small. */
/** @param {number} v @param {number} [dp] */
function round(v, dp = 4) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** @param {string} s */
function toHttps(s) {
  return typeof s === "string" ? s.replace(/^http:\/\//, "https://") : s;
}

// ---------------------------------------------------------------------------
// NASA POWER  (https://power.larc.nasa.gov/docs/services/api/)
// ---------------------------------------------------------------------------

export const POWER_BASE = "https://power.larc.nasa.gov/api/temporal";

/** Human labels for the POWER parameters we use. */
export const POWER_PARAMS = /** @type {Record<string,{label:string, unit:string}>} */ ({
  T2M: { label: "Air temperature at 2 m", unit: "°C" },
  PRECTOTCORR: { label: "Precipitation (bias-corrected)", unit: "mm/day" },
});

/**
 * Daily:   start/end = YYYYMMDD (or YYYY-MM-DD, dashes are stripped)
 * Monthly: start/end = YYYY
 * @param {{resolution:"daily"|"monthly", parameters:string[], lat:number, lon:number, start:string, end:string, community?:string}} p
 */
export function buildPowerUrl(p) {
  const res = p.resolution === "monthly" ? "monthly" : "daily";
  const fmt = (/** @type {string} */ s) => (res === "monthly" ? s.slice(0, 4) : s.replace(/-/g, ""));
  const q = new URLSearchParams({
    parameters: p.parameters.join(","),
    community: p.community ?? "AG",
    latitude: p.lat.toFixed(4),
    longitude: p.lon.toFixed(4),
    start: fmt(p.start),
    end: fmt(p.end),
    format: "JSON",
  });
  return `${POWER_BASE}/${res}/point?${q.toString()}`;
}

/**
 * Parse a POWER point response for ONE parameter.
 * - Fill value comes from `header.fill_value` (observed: -999.0). Fill → null.
 * - Daily keys are YYYYMMDD. Monthly keys are YYYYMM where MM=13 is the ANNUAL mean → dropped.
 * @param {any} json
 * @param {string} variable
 * @returns {{points: EarthPoint[], fillValue:number, apiName:string, apiVersion:string, longname?:string, units?:string, sources?:string[]}}
 */
export function parsePowerResponse(json, variable) {
  if (!json || typeof json !== "object") throw new Error("POWER: empty response");
  if (Array.isArray(json.messages) && json.messages.length && !json.properties) {
    throw new Error(`POWER: ${json.messages.join("; ")}`);
  }
  const values = json?.properties?.parameter?.[variable];
  if (!values || typeof values !== "object") throw new Error(`POWER: parameter ${variable} missing from response`);
  const header = json.header ?? {};
  const fillValue = typeof header.fill_value === "number" ? header.fill_value : -999;

  /** @type {EarthPoint[]} */
  const points = [];
  for (const [key, raw] of Object.entries(values)) {
    let time;
    if (/^\d{8}$/.test(key)) {
      time = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
    } else if (/^\d{6}$/.test(key)) {
      const mm = Number(key.slice(4, 6));
      if (mm < 1 || mm > 12) continue; // "13" = annual aggregate, not a month
      time = `${key.slice(0, 4)}-${key.slice(4, 6)}-01`;
    } else {
      continue;
    }
    const n = typeof raw === "number" ? raw : Number(raw);
    const isFill = !Number.isFinite(n) || n === fillValue || n <= -998;
    points.push({ time, value: isFill ? null : round(n, 3) });
  }
  points.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return {
    points,
    fillValue,
    apiName: header?.api?.name ?? "POWER API",
    apiVersion: header?.api?.version ?? "",
    longname: json?.parameters?.[variable]?.longname,
    units: json?.parameters?.[variable]?.units,
    sources: header.sources,
  };
}

/**
 * @param {any} json
 * @param {{experience: import("./types").ExperienceId, variable:string, region:{id:string,name:string,lat:number,lon:number}, periodKey:string, url:string, retrievedAt?:string}} ctx
 * @returns {EarthSeries}
 */
export function buildPowerSeries(json, ctx) {
  const parsed = parsePowerResponse(json, ctx.variable);
  const meta = POWER_PARAMS[ctx.variable] ?? { label: parsed.longname ?? ctx.variable, unit: parsed.units ?? "" };
  const retrievedAt = ctx.retrievedAt ?? new Date().toISOString();
  const version = parsed.apiVersion ? ` ${parsed.apiVersion}` : "";
  return {
    id: makeSeriesId("power", ctx.variable, ctx.region.id, ctx.periodKey),
    experience: ctx.experience,
    variable: ctx.variable,
    label: meta.label,
    unit: meta.unit,
    region: { name: ctx.region.name, lat: ctx.region.lat, lon: ctx.region.lon },
    points: parsed.points,
    source: {
      kind: "nasa",
      name: "NASA POWER (LaRC)",
      product: `${parsed.apiName}${version}${parsed.sources?.length ? ` · ${parsed.sources.join(", ")}` : ""}`,
      url: ctx.url,
      citation: `${POWER_REFERENCE} ${parsed.apiName}${version}, accessed ${retrievedAt.slice(0, 10)}.`,
      retrievedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// ORNL DAAC MODIS/VIIRS subsetting REST API  (https://modis.ornl.gov/data/modis_webservice.html)
// ---------------------------------------------------------------------------

export const MODIS_BASE = "https://modis.ornl.gov/rst/api/v1";
/** The subset endpoint rejects more than 10 composite dates per request ("exceeds maximum subset tiles support of 10"). */
export const MODIS_MAX_DATES_PER_REQUEST = 10;

/** Band metadata for MOD13Q1 NDVI, as reported by `/MOD13Q1/bands`. */
export const MODIS_NDVI_BAND = {
  band: "250m_16_days_NDVI",
  scale: 0.0001,
  fill: -3000,
  validMin: -2000,
  validMax: 10000,
};

/** @param {string} product @param {number} lat @param {number} lon */
export function buildModisDatesUrl(product, lat, lon) {
  return `${MODIS_BASE}/${product}/dates?latitude=${lat}&longitude=${lon}`;
}

/** @param {{product:string, lat:number, lon:number, band:string, startDate:string, endDate:string}} p */
export function buildModisSubsetUrl(p) {
  return (
    `${MODIS_BASE}/${p.product}/subset?latitude=${p.lat}&longitude=${p.lon}` +
    `&band=${p.band}&startDate=${p.startDate}&endDate=${p.endDate}&kmAboveBelow=0&kmLeftRight=0`
  );
}

/**
 * @param {any} json
 * @returns {{modis_date:string, calendar_date:string}[]}
 */
export function parseModisDates(json) {
  if (!json || !Array.isArray(json.dates)) throw new Error("MODIS: dates list missing");
  return json.dates.filter((/** @type {any} */ d) => d && /^A\d{7}$/.test(d.modis_date) && d.calendar_date);
}

/**
 * Keep dates within [start, end] (ISO strings) and split into batches the API accepts.
 * @param {{modis_date:string, calendar_date:string}[]} dates
 * @param {string} start @param {string} end
 * @param {number} [size]
 */
export function batchModisDates(dates, start, end, size = MODIS_MAX_DATES_PER_REQUEST) {
  const inRange = dates.filter((d) => d.calendar_date >= start && d.calendar_date <= end);
  /** @type {{startDate:string, endDate:string, count:number}[]} */
  const batches = [];
  for (let i = 0; i < inRange.length; i += size) {
    const chunk = inRange.slice(i, i + size);
    batches.push({ startDate: chunk[0].modis_date, endDate: chunk[chunk.length - 1].modis_date, count: chunk.length });
  }
  return batches;
}

/**
 * Parse one subset response. Uses `scale` from the response when present (observed "0.0001").
 * If several pixels are returned the mean of valid pixels is used.
 * @param {any} json
 * @param {{scale:number, fill:number, validMin:number, validMax:number}} [band]
 * @returns {EarthPoint[]}
 */
export function parseModisSubset(json, band = MODIS_NDVI_BAND) {
  if (!json || !Array.isArray(json.subset)) throw new Error("MODIS: subset list missing");
  const scale = Number(json.scale) || band.scale;
  return json.subset.map((/** @type {any} */ s) => {
    const raw = (Array.isArray(s.data) ? s.data : []).filter(
      (/** @type {number} */ v) => Number.isFinite(v) && v !== band.fill && v >= band.validMin && v <= band.validMax,
    );
    const value = raw.length ? round((raw.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0) / raw.length) * scale, 4) : null;
    return { time: s.calendar_date, value };
  });
}

/**
 * @param {any[]} subsetJsons one parsed JSON body per batch
 * @param {{experience: import("./types").ExperienceId, variable:string, product:string, region:{id:string,name:string,lat:number,lon:number}, periodKey:string, urls:string[], retrievedAt?:string}} ctx
 * @returns {EarthSeries}
 */
export function buildModisSeries(subsetJsons, ctx) {
  const byTime = new Map();
  for (const json of subsetJsons) for (const p of parseModisSubset(json)) byTime.set(p.time, p);
  const points = [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
  const retrievedAt = ctx.retrievedAt ?? new Date().toISOString();
  const first = ctx.urls[0] ?? "";
  return {
    id: makeSeriesId("modis", ctx.variable, ctx.region.id, ctx.periodKey),
    experience: ctx.experience,
    variable: ctx.variable,
    label: "Vegetation greenness (NDVI, 16-day)",
    unit: "NDVI (unitless)",
    region: { name: ctx.region.name, lat: ctx.region.lat, lon: ctx.region.lon },
    points,
    source: {
      kind: "nasa",
      name: "NASA MODIS via ORNL DAAC",
      product: `${ctx.product} (Terra MODIS, 250 m, 16-day, C6.1)`,
      url: ctx.urls.length > 1 ? `${first}  (+${ctx.urls.length - 1} more date batches)` : first,
      citation: `${MOD13Q1_REFERENCE} Retrieved via: ${TESVIS_REFERENCE}. Accessed ${retrievedAt.slice(0, 10)}.`,
      retrievedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// NASA Scientific Visualization Studio (EIC visuals)  https://svs.gsfc.nasa.gov/api/
// ---------------------------------------------------------------------------

/**
 * Extract title/description/frame for an SVS page. For gallery pages (e.g. 40509 "Earth Now Dashboard")
 * pass `itemTitle` to pick one card; for visualization pages (e.g. 5147) the main image is used,
 * preferring the small "_searchweb" variant when it exists.
 * @param {any} json
 * @param {{itemTitle?: string}} [opts]
 */
export function parseSvsPage(json, opts = {}) {
  if (!json || typeof json !== "object" || !json.id) throw new Error("SVS: unexpected response");
  const clean = (/** @type {string|undefined|null} */ s) =>
    (s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

  let title = clean(json.title);
  let description = clean(json.description);
  let imageUrl = toHttps(json.main_image?.url ?? "");
  let altText = clean(json.main_image?.alt_text) || title;

  if (opts.itemTitle) {
    for (const g of json.media_groups ?? []) {
      const item = (g.items ?? []).find((/** @type {any} */ it) => clean(it.title) === opts.itemTitle);
      if (item?.instance?.url) {
        title = `${clean(json.title)}: ${clean(item.title)}`;
        description = clean(g.description) || description;
        imageUrl = toHttps(item.instance.url);
        altText = `${clean(item.title)} — ${clean(g.title)}, from NASA's ${clean(json.title)}.`;
        break;
      }
    }
  } else if (imageUrl) {
    // Prefer the light-weight thumbnail variant if the page lists one.
    const raw = JSON.stringify(json);
    const stem = imageUrl.replace(/^https?:\/\//, "").replace(/_(print|searchweb|thm)\.(jpg|png)$/i, "");
    const m = raw.match(new RegExp(`https?://${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_searchweb\\.png`));
    if (m) imageUrl = toHttps(m[0]);
  }
  if (altText.length > 300) altText = altText.slice(0, 297).replace(/\s+\S*$/, "") + "…";

  return {
    svsId: json.id,
    title,
    description,
    imageUrl,
    altText,
    pageUrl: toHttps(json.url ?? `https://svs.gsfc.nasa.gov/${json.id}/`),
    released: json.release_date ?? null,
    updated: json.update_date ?? null,
    credit: SVS_REFERENCE,
  };
}
