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
  // Units depend on the POWER "community": AG returns MJ/m^2/day (RE would return kW-hr/m^2/day).
  // The unit shown in the app always comes from the response's `parameters[...].units`.
  ALLSKY_SFC_SW_DWN: { label: "Sunlight reaching the surface (all-sky)", unit: "MJ/m²/day" },
});

/** Make API unit strings readable: "C" → "°C", "MJ/m^2/day" → "MJ/m²/day". */
/** @param {string | undefined | null} u */
export function prettyUnit(u) {
  if (!u) return "";
  if (u === "C" || u === "degree_C" || u === "degrees_C") return "°C";
  return String(u).replace(/\^2/g, "²").replace(/\^3/g, "³");
}

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
  const meta = POWER_PARAMS[ctx.variable] ?? { label: parsed.longname ?? ctx.variable, unit: "" };
  const retrievedAt = ctx.retrievedAt ?? new Date().toISOString();
  const version = parsed.apiVersion ? ` ${parsed.apiVersion}` : "";
  return {
    id: makeSeriesId("power", ctx.variable, ctx.region.id, ctx.periodKey),
    experience: ctx.experience,
    variable: ctx.variable,
    label: meta.label,
    // Units reported by the API win over our table (they depend on the POWER community).
    unit: parsed.units ? prettyUnit(parsed.units) : meta.unit,
    dataset: `NASA POWER ${parsed.apiName}`,
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

export const MODIS_EVI_BAND = { ...MODIS_NDVI_BAND, band: "250m_16_days_EVI" };
export const MODIS_RELIABILITY_BAND = "250m_16_days_pixel_reliability";

/** MOD13Q1 pixel reliability (from /MOD13Q1/bands and the MOD13 user guide). */
export const MODIS_RELIABILITY = /** @type {Record<number, import("./types").Quality>} */ ({
  0: "good", // good data, use with confidence
  1: "marginal", // useful, but look at other QA information
  2: "snow", // snow / ice → not a vegetation signal
  3: "cloudy", // cloudy → not a vegetation signal
});

/** Vegetation-index bands we support. */
export const MODIS_VI = /** @type {Record<string, {band:string, label:string}>} */ ({
  NDVI: { band: MODIS_NDVI_BAND.band, label: "Vegetation greenness (NDVI, 16-day)" },
  EVI: { band: MODIS_EVI_BAND.band, label: "Enhanced vegetation index (EVI, 16-day)" },
});

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
    return { time: s.calendar_date, value, ...(value === null ? { quality: "missing" } : {}) };
  });
}

/**
 * Parse a pixel_reliability subset → Map(date → quality). Multiple pixels: worst rank wins.
 * @param {any} json
 * @returns {Map<string, import("./types").Quality>}
 */
export function parseModisReliability(json) {
  if (!json || !Array.isArray(json.subset)) throw new Error("MODIS: reliability subset missing");
  const out = new Map();
  for (const s of json.subset) {
    const codes = (Array.isArray(s.data) ? s.data : []).filter((/** @type {number} */ v) => v >= 0 && v <= 3);
    out.set(s.calendar_date, codes.length ? MODIS_RELIABILITY[Math.max(...codes)] : "missing");
  }
  return out;
}

/**
 * Apply MOD13Q1 pixel reliability: snow/ice and cloudy composites are not vegetation signals, so their
 * values become null (with the reason kept in `quality`); marginal values are kept and flagged.
 * @param {EarthPoint[]} points
 * @param {Map<string, import("./types").Quality>} reliability
 * @returns {EarthPoint[]}
 */
export function applyModisReliability(points, reliability) {
  return points.map((p) => {
    const q = reliability.get(p.time);
    if (!q || p.value === null) return p;
    if (q === "cloudy" || q === "snow" || q === "missing") return { time: p.time, value: null, quality: q };
    return { ...p, quality: q };
  });
}

/**
 * @param {any[]} subsetJsons one parsed JSON body per batch
 * @param {{experience: import("./types").ExperienceId, variable:string, product:string, region:{id:string,name:string,lat:number,lon:number}, periodKey:string, urls:string[], retrievedAt?:string, reliabilityJsons?: any[]}} ctx
 * @returns {EarthSeries}
 */
export function buildModisSeries(subsetJsons, ctx) {
  const byTime = new Map();
  for (const json of subsetJsons) for (const p of parseModisSubset(json)) byTime.set(p.time, p);
  let points = [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
  let qaNote = "";
  if (ctx.reliabilityJsons?.length) {
    const rel = new Map();
    for (const j of ctx.reliabilityJsons) for (const [k, v] of parseModisReliability(j)) rel.set(k, v);
    points = applyModisReliability(points, rel);
    qaNote = " Quality: composites flagged cloudy or snow/ice by MOD13Q1 pixel reliability are treated as no data.";
  }
  const retrievedAt = ctx.retrievedAt ?? new Date().toISOString();
  const first = ctx.urls[0] ?? "";
  const vi = MODIS_VI[ctx.variable] ?? MODIS_VI.NDVI;
  return {
    id: makeSeriesId("modis", ctx.variable, ctx.region.id, ctx.periodKey),
    experience: ctx.experience,
    variable: ctx.variable,
    label: vi.label,
    unit: `${ctx.variable} (unitless)`,
    dataset: "MODIS/Terra Vegetation Indices 16-Day L3 Global 250m (MOD13Q1.061)",
    region: { name: ctx.region.name, lat: ctx.region.lat, lon: ctx.region.lon },
    points,
    source: {
      kind: "nasa",
      name: "NASA MODIS via ORNL DAAC",
      product: `${ctx.product} (Terra MODIS, 250 m, 16-day, C6.1).${qaNote}`,
      url: ctx.urls.length > 1 ? `${first}  (+${ctx.urls.length - 1} more date batches)` : first,
      citation: `${MOD13Q1_REFERENCE} Retrieved via: ${TESVIS_REFERENCE}. Accessed ${retrievedAt.slice(0, 10)}.`,
      retrievedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// NASA/JPL MUR SST via ERDDAP griddap  (https://podaac.jpl.nasa.gov/dataset/MUR-JPL-L4-GLOB-v4.1)
// ---------------------------------------------------------------------------

/** https://podaac.jpl.nasa.gov/dataset/MUR-JPL-L4-GLOB-v4.1 (dataset citation) */
export const MUR_REFERENCE =
  "JPL MUR MEaSUREs Project. 2015. GHRSST Level 4 MUR Global Foundation Sea Surface Temperature Analysis (v4.1). " +
  "PO.DAAC, CA, USA. https://doi.org/10.5067/GHGMR-4FJ04";

/** Default ERDDAP server/datasets that publish MUR v4.1 globally without a login. Override with ERDDAP_BASE. */
export const ERDDAP_DEFAULT = {
  base: "https://coastwatch.pfeg.noaa.gov/erddap",
  sst: { datasetId: "jplMURSST41", variable: "analysed_sst" },
  anomaly: { datasetId: "jplMURSST41anom1day", variable: "sstAnom" },
};

// ---------------------------------------------------------------------------
// NASA/JPL MUR SST v4.1 directly from PO.DAAC (Earthdata Cloud). Used by the Node pre-fetch ONLY when an
// Earthdata Login token is configured (EARTHDATA_TOKEN in .env). Never used in the browser: the token must
// stay server-side. Discovery: CMR granule search (public). Values: OPeNDAP (Hyrax) point subsets, one
// granule per sampled day, requesting just one grid cell of analysed_sst and sst_anomaly.
// Checked 2026-11-13: CMR answers without a login; OPeNDAP and Harmony both redirect to Earthdata Login.
// ---------------------------------------------------------------------------

export const MUR_PODAAC = {
  collection: "C1996881146-POCLOUD",
  shortName: "MUR-JPL-L4-GLOB-v4.1",
  cmr: "https://cmr.earthdata.nasa.gov/search/granules.umm_json",
  /** Grid from the MUR v4.1 file specification: 0.01°, lat −89.99…89.99 (17 999 rows), lon −179.99…180.00 (36 000 columns). */
  grid: { lat0: -89.99, lon0: -179.99, step: 0.01, nLat: 17999, nLon: 36000 },
  /**
   * Packing as stored in the files (int16). Used only if the server returns packed integers and the
   * dataset's own DMR attributes could not be read. analysed_sst is in kelvin; sst_anomaly is a kelvin
   * difference from the 2003–2014 day-of-year average (added to MUR granules in July 2019).
   */
  packing: {
    analysed_sst: { scale: 0.001, offset: 298.15, fill: -32768 },
    sst_anomaly: { scale: 0.001, offset: 0, fill: -32768 },
  },
  anomalyBaseline: "anomaly baseline (MUR sst_anomaly): day-of-year average 2003–2014",
};

/** Nearest MUR grid cell to a point.
 * @param {number} lat
 * @param {number} lon */
export function murGridIndex(lat, lon) {
  const g = MUR_PODAAC.grid;
  const i = Math.min(g.nLat - 1, Math.max(0, Math.round((lat - g.lat0) / g.step)));
  const j = Math.min(g.nLon - 1, Math.max(0, Math.round((lon - g.lon0) / g.step)));
  return { i, j, lat: round(g.lat0 + i * g.step, 2), lon: round(g.lon0 + j * g.step, 2) };
}

/** CMR granule search for MUR v4.1 between two dates (inclusive), one page.
 * @param {{start:string, end:string, page?:number, pageSize?:number}} p */
export function buildCmrGranuleUrl({ start, end, page = 1, pageSize = 2000 }) {
  const q = new URLSearchParams({
    collection_concept_id: MUR_PODAAC.collection,
    temporal: `${start}T00:00:00Z,${end}T23:59:59Z`,
    page_size: String(pageSize),
    page_num: String(page),
    sort_key: "start_date",
  });
  return `${MUR_PODAAC.cmr}?${q}`;
}

/**
 * CMR UMM-JSON granules → [{date, granule, opendap}]. Only granules that advertise an OPeNDAP service URL.
 * @param {any} json
 */
export function parseCmrGranules(json) {
  if (!json || !Array.isArray(json.items)) throw new Error("CMR: unexpected response");
  /** @type {{date:string, granule:string, opendap:string}[]} */
  const out = [];
  for (const it of json.items) {
    const ur = it?.umm?.GranuleUR ?? "";
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(ur);
    const od = (it?.umm?.RelatedUrls ?? []).find((/** @type {any} */ u) => /OPENDAP/i.test(u.Subtype ?? "") && /^https:/.test(u.URL));
    // Some granules advertise a long-name URL; the concept-id form below is accepted for all of them.
    if (m && od) out.push({ date: `${m[1]}-${m[2]}-${m[3]}`, granule: ur, opendap: `https://opendap.earthdata.nasa.gov/collections/${MUR_PODAAC.collection}/granules/${ur}` });
  }
  return out;
}

/** Keep every `stride`-th calendar day counted from `start` (weekly samples with stride 7).
 * @template {{date:string}} G
 * @param {G[]} granules
 * @param {string} start
 * @param {number} stride
 * @returns {G[]} */
export function sampleGranules(granules, start, stride) {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return granules.filter((g) => Math.round((Date.parse(`${g.date}T00:00:00Z`) - t0) / 86400000) % stride === 0);
}

/** DAP2 ASCII point request for one grid cell: analysed_sst and sst_anomaly (brackets percent-encoded; Hyrax rejects raw ones).
 * @param {string} opendapUrl
 * @param {number} i
 * @param {number} j */
export function buildMurOpendapUrl(opendapUrl, i, j) {
  const cell = `%5B0:1:0%5D%5B${i}:1:${i}%5D%5B${j}:1:${j}%5D`;
  return `${opendapUrl}.ascii?analysed_sst${cell},sst_anomaly${cell}`;
}

/**
 * Read scale_factor / add_offset / _FillValue for one variable from an OPeNDAP DMR (XML). Returns null
 * for anything missing so the caller can fall back to the documented packing.
 * @param {string} dmr
 * @param {string} variable
 */
export function parseDmrPacking(dmr, variable) {
  const block = new RegExp(`<(?:Int16|Int32|Float32|Float64)\\s+name="${variable}"[\\s\\S]*?</(?:Int16|Int32|Float32|Float64)>`).exec(dmr)?.[0];
  if (!block) return null;
  const attr = (/** @type {string} */ name) => {
    const m = new RegExp(`<Attribute\\s+name="${name}"[^>]*>\\s*<Value>([^<]+)</Value>`).exec(block);
    return m ? Number(m[1]) : null;
  };
  return { scale: attr("scale_factor"), offset: attr("add_offset"), fill: attr("_FillValue"), packed: /^<Int/.test(block) };
}

/**
 * Value of one variable from an OPeNDAP ASCII (DAP2) or CSV (DAP4) point response.
 * Packed integers are unpacked with `packing`; kelvin is converted to °C for analysed_sst.
 * Fill / NaN / missing → null (never invented).
 * @param {string} text
 * @param {"analysed_sst"|"sst_anomaly"} variable
 * @param {{scale:number|null, offset:number|null, fill:number|null}} [packing]
 */
export function parseMurPointValue(text, variable, packing) {
  const re = new RegExp(`(?:^|[\\s/.])${variable}(?:\\.${variable})?(?:\\[[^\\]]*\\])*\\s*,\\s*(-?(?:\\d+\\.?\\d*(?:[eE][-+]?\\d+)?|NaN|nan))`, "m");
  const m = re.exec(text);
  if (!m || /nan/i.test(m[1])) return null;
  const raw = Number(m[1]);
  if (!Number.isFinite(raw)) return null;
  const def = MUR_PODAAC.packing[variable];
  const p = { scale: packing?.scale ?? def.scale, offset: packing?.offset ?? def.offset, fill: packing?.fill ?? def.fill };
  const isInteger = /^-?\d+$/.test(m[1]);
  if (isInteger && raw === p.fill) return null;
  // Integers are stored (packed) values; a decimal means the server already unpacked them.
  const v = isInteger ? raw * p.scale + p.offset : raw;
  return round(variable === "analysed_sst" ? v - 273.15 : v, 3);
}

/**
 * Two EarthSeries (SST and SSTA) from MUR point samples fetched via PO.DAAC OPeNDAP.
 * @param {{date:string, sst:number|null, anom:number|null}[]} samples
 * @param {{experience: import("./types").ExperienceId, region:{id:string,name:string,lat:number,lon:number}, cell:{lat:number,lon:number}, periodKey:string, url:string, retrievedAt?:string}} ctx
 * @returns {{SST: EarthSeries, SSTA: EarthSeries}}
 */
export function buildMurPodaacSeries(samples, ctx) {
  const retrievedAt = ctx.retrievedAt ?? new Date().toISOString();
  const sorted = [...samples].sort((a, b) => (a.date < b.date ? -1 : 1));
  const make = (/** @type {"SST"|"SSTA"} */ variable) => ({
    id: makeSeriesId("mur", variable, ctx.region.id, ctx.periodKey),
    experience: ctx.experience,
    variable,
    label: variable === "SSTA" ? "Sea surface temperature anomaly" : "Sea surface temperature",
    unit: "°C",
    dataset: "GHRSST L4 MUR Global Foundation SST Analysis v4.1 (JPL)",
    region: { name: ctx.region.name, lat: ctx.region.lat, lon: ctx.region.lon },
    points: sorted.map((s) => ({ time: s.date, value: variable === "SSTA" ? s.anom : s.sst })),
    source: {
      kind: /** @type {const} */ ("nasa"),
      name: "NASA/JPL MUR SST v4.1 via PO.DAAC OPeNDAP",
      product:
        `${MUR_PODAAC.shortName} (${variable === "SSTA" ? "sst_anomaly" : "analysed_sst"}), grid cell ${ctx.cell.lat}°, ${ctx.cell.lon}°` +
        (variable === "SSTA" ? ` · ${MUR_PODAAC.anomalyBaseline}` : ""),
      url: ctx.url,
      citation: `${MUR_REFERENCE} Accessed through NASA Earthdata (CMR + OPeNDAP) on ${retrievedAt.slice(0, 10)}.`,
      retrievedAt,
    },
  });
  return { SST: make("SST"), SSTA: make("SSTA") };
}

/** https://coralreefwatch.noaa.gov/product/5km/index.php */
export const CRW_REFERENCE =
  "NOAA Coral Reef Watch. 2018, updated daily. NOAA Coral Reef Watch Version 3.1 Daily Global 5km Satellite " +
  "Sea Surface Temperature (CoralTemp) and SST Anomaly products. College Park, Maryland, USA: NOAA Coral Reef Watch. https://coralreefwatch.noaa.gov/";

/**
 * Fallback used ONLY when the MUR server cannot be reached: NOAA Coral Reef Watch CoralTemp v3.1, a global
 * 5 km gap-free (Level 4) satellite SST analysis, and CRW's own daily SST anomaly. Served by NOAA OceanWatch
 * Central Pacific ERDDAP, whose grid uses 0–360° longitudes. Labelled as NOAA (not MUR) everywhere.
 */
export const ERDDAP_FALLBACK = {
  base: "https://oceanwatch.pifsc.noaa.gov/erddap",
  lon360: true,
  sst: { datasetId: "CRW_sst_v3_1", variable: "analysed_sst" },
  anomaly: { datasetId: "CRW_sst_anom_v1_0", variable: "sea_surface_temperature_anomaly" },
};

/**
 * griddap point time series. Works for 3-D [time][lat][lon] and 4-D [time][level][lat][lon] grids
 * (pass `extraDims` like ["(0.0)"] for the level). `stride` 7 on a daily grid = weekly samples.
 * `lon360` converts a -180..180 longitude for servers whose grid runs 0..360.
 * @param {{base:string, datasetId:string, variable:string, start:string, end:string, stride?:number, lat:number, lon:number, extraDims?:string[], lon360?:boolean}} p
 */
export function buildErddapUrl(p) {
  const t = (/** @type {string} */ d) => (d.length === 10 ? `${d}T09:00:00Z` : d);
  const lon = p.lon360 && p.lon < 0 ? round(p.lon + 360, 4) : p.lon;
  const dims = [`(${t(p.start)}):${p.stride ?? 1}:(${t(p.end)})`, ...(p.extraDims ?? []), `(${p.lat})`, `(${lon})`];
  const q = `${p.variable}${dims.map((d) => `[${d}]`).join("")}`;
  return `${p.base.replace(/\/$/, "")}/griddap/${p.datasetId}.json?${encodeURIComponent(q).replace(/%3A/g, ":").replace(/%2C/g, ",")}`;
}

/**
 * Parse an ERDDAP griddap/tabledap JSON table for one variable.
 * NaN / null → null. Kelvin is converted to °C (unit taken from `columnUnits`).
 * @param {any} json
 * @param {string} variable
 * @returns {{points: EarthPoint[], unit: string}}
 */
export function parseErddapTable(json, variable) {
  const t = json?.table;
  if (!t || !Array.isArray(t.columnNames) || !Array.isArray(t.rows)) throw new Error("ERDDAP: table missing");
  const ti = t.columnNames.indexOf("time");
  const vi = t.columnNames.indexOf(variable);
  if (ti < 0 || vi < 0) throw new Error(`ERDDAP: column ${variable} missing`);
  const rawUnit = (t.columnUnits?.[vi] ?? "").toString();
  const kelvin = /^(K|kelvin|degree_K|degrees_K)$/i.test(rawUnit);
  /** @type {EarthPoint[]} */
  const points = t.rows.map((/** @type {any[]} */ r) => {
    const v = r[vi];
    const ok = typeof v === "number" && Number.isFinite(v);
    return { time: String(r[ti]).slice(0, 10), value: ok ? round(kelvin ? v - 273.15 : v, 3) : null };
  });
  points.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return { points, unit: kelvin ? "°C" : prettyUnit(rawUnit) };
}

/**
 * @param {any} json
 * `provider: "crw"` = the NOAA Coral Reef Watch fallback (see ERDDAP_FALLBACK); default is MUR.
 * @param {{experience: import("./types").ExperienceId, variable:"SST"|"SSTA", erddapVariable:string, datasetId:string, region:{id:string,name:string,lat:number,lon:number}, periodKey:string, url:string, retrievedAt?:string, baselineNote?:string, provider?:"mur"|"crw", fallbackReason?:string}} ctx
 * @returns {EarthSeries}
 */
export function buildErddapSstSeries(json, ctx) {
  const { points, unit } = parseErddapTable(json, ctx.erddapVariable);
  const retrievedAt = ctx.retrievedAt ?? new Date().toISOString();
  const anomaly = ctx.variable === "SSTA";
  if (ctx.provider === "crw") {
    return {
      id: makeSeriesId("crw", ctx.variable, ctx.region.id, ctx.periodKey),
      experience: ctx.experience,
      variable: ctx.variable,
      label: anomaly ? "Sea surface temperature anomaly" : "Sea surface temperature",
      unit: unit || "°C",
      dataset: anomaly
        ? "NOAA Coral Reef Watch CoralTemp SST Anomaly (daily, 5 km)"
        : "NOAA Coral Reef Watch CoralTemp SST v3.1 (Level 4 analysis, daily, 5 km)",
      region: { name: ctx.region.name, lat: ctx.region.lat, lon: ctx.region.lon },
      points,
      source: {
        kind: "noaa",
        name: "NOAA Coral Reef Watch (CoralTemp) via ERDDAP",
        product:
          `${ctx.datasetId} (${ctx.erddapVariable})${anomaly && ctx.baselineNote ? ` · ${ctx.baselineNote}` : ""}` +
          ` · Used instead of NASA/JPL MUR because ${ctx.fallbackReason ?? "the MUR server could not be reached"} when the data was fetched.`,
        url: ctx.url,
        citation: `${CRW_REFERENCE} Served by NOAA OceanWatch ERDDAP (${ctx.datasetId}). Accessed ${retrievedAt.slice(0, 10)}.`,
        retrievedAt,
      },
    };
  }
  return {
    id: makeSeriesId("mur", ctx.variable, ctx.region.id, ctx.periodKey),
    experience: ctx.experience,
    variable: ctx.variable,
    label: anomaly ? "Sea surface temperature anomaly" : "Sea surface temperature",
    unit: unit || "°C",
    dataset: "GHRSST L4 MUR Global Foundation SST Analysis v4.1 (JPL)",
    region: { name: ctx.region.name, lat: ctx.region.lat, lon: ctx.region.lon },
    points,
    source: {
      kind: "nasa",
      name: "NASA/JPL MUR SST via ERDDAP",
      product: `${ctx.datasetId} (${ctx.erddapVariable})${anomaly && ctx.baselineNote ? ` · ${ctx.baselineNote}` : ""}`,
      url: ctx.url,
      citation: `${MUR_REFERENCE} Served by NOAA ERDDAP (${ctx.datasetId}). Accessed ${retrievedAt.slice(0, 10)}.`,
      retrievedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// What KIND of data each value is: satellite-derived product, analysis or model estimate.
// Shown wherever a value is explained, so a model output is never presented as a direct satellite reading.
// ---------------------------------------------------------------------------

/** @typedef {{kind:"satellite-derived"|"analysis"|"model"|"simulated", label:string, kid:string, detail:string}} DataType */

/**
 * @param {string} variable
 * @param {string} [sourceName]
 * @returns {DataType}
 */
export function dataTypeFor(variable, sourceName = "") {
  if (/simulat/i.test(sourceName)) {
    return { kind: "simulated", label: "Simulated (not real data)", kid: "Made-up practice numbers, not a real measurement.", detail: SIMULATED_LABEL };
  }
  switch (variable) {
    case "T2M":
      return {
        kind: "model",
        label: "Model-based estimate (MERRA-2 reanalysis)",
        kid: "Worked out by a NASA computer model that combines many satellite and weather-station measurements.",
        detail: "POWER air temperature comes from NASA's MERRA-2 reanalysis, a weather model kept close to observations. It is an estimate for a grid cell about 50 km across, not a thermometer reading.",
      };
    case "PRECTOTCORR":
      return {
        kind: "model",
        label: "Model-based estimate, bias-corrected (MERRA-2)",
        kid: "Worked out by a NASA computer model, then corrected using rain measurements.",
        detail: "POWER corrected precipitation is MERRA-2 model precipitation adjusted towards observation-based precipitation. It is an estimate for a grid cell, not a rain-gauge reading.",
      };
    case "ALLSKY_SFC_SW_DWN":
      return {
        kind: "satellite-derived",
        label: "Satellite-derived estimate (NASA CERES)",
        kid: "Worked out from satellites that measure sunlight and clouds.",
        detail: "POWER surface solar radiation is derived from NASA CERES satellite measurements of radiation and clouds, with model inputs. It is an estimate for a grid cell.",
      };
    case "NDVI":
    case "EVI":
      return {
        kind: "satellite-derived",
        label: "Satellite-derived index (MODIS, 16-day composite)",
        kid: "Measured from space: a satellite camera compares the red and infrared light that plants reflect.",
        detail: "MOD13Q1 vegetation indices are calculated from Terra MODIS surface reflectance, keeping the best view in each 16-day window. They measure greenness, not the number of trees.",
      };
    case "SST":
    case "SSTA":
      return {
        kind: "analysis",
        label: "Analysis (Level 4: gap-free blend of satellite and in-situ measurements)",
        kid: "Measured from space by several satellites, joined together with ship and buoy readings to fill the gaps.",
        detail: /Coral Reef Watch/i.test(sourceName)
          ? "CoralTemp is a Level 4 analysis: it blends several satellite SST products into a gap-free daily map at 5 km. The anomaly compares each day with Coral Reef Watch's own climatology."
          : "MUR is a Level 4 analysis: it blends several satellite instruments and in-situ data into a gap-free daily map at about 1 km. Values between satellite passes are filled in by the analysis.",
      };
    default:
      return { kind: "analysis", label: "See dataset documentation", kid: "Measured or estimated by scientists.", detail: "See the dataset documentation." };
  }
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
