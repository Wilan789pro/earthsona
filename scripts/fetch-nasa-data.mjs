#!/usr/bin/env node
/**
 * Pre-fetch real NASA data so the hackathon demo never depends on venue Wi-Fi.
 *
 *   npm run fetch-data                 # everything in scripts/regions.json
 *   npm run fetch-data -- --only=forest --region=port-louis   # one part and/or place
 *   npm run fetch-data -- --only=pulse # one part: pulse | forest | ocean | eic | imagery
 *   ERDDAP_BASE=https://host/erddap npm run fetch-data -- --only=ocean   # another ERDDAP server for MUR SST
 *   EARTHDATA_TOKEN in .env           # NASA/JPL MUR SST straight from PO.DAAC (CMR + OPeNDAP); see .env.example
 *
 * Writes:
 *   public/data/real/{experience}/{id}.json   one normalised EarthSeries per file
 *   public/data/real/index.json               manifest the app's registry reads
 *   public/data/eic/{experience}.json (+ image when ≤ 3 MB)
 *
 * Node 18+ only (built-in fetch), no dependencies. Parsing is shared with the app via src/data/parsers.js.
 */
import { mkdir, readFile, rename, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  batchModisDates,
  buildModisDatesUrl,
  buildModisSeries,
  buildModisSubsetUrl,
  buildPowerSeries,
  buildPowerUrl,
  parseModisDates,
  parseSvsPage,
  MODIS_VI,
  MODIS_RELIABILITY_BAND,
  ERDDAP_DEFAULT,
  ERDDAP_FALLBACK,
  buildErddapUrl,
  buildErddapSstSeries,
  MUR_PODAAC,
  murGridIndex,
  buildCmrGranuleUrl,
  parseCmrGranules,
  sampleGranules,
  buildMurOpendapUrl,
  parseDmrPacking,
  parseMurPointValue,
  buildMurPodaacSeries,
} from "../src/data/parsers.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Server-side configuration (never bundled into the app): read .env when it exists. Node 20.12+.
try {
  process.loadEnvFile?.(join(ROOT, ".env"));
} catch {
  /* no .env: fine */
}
const CACHE = join(ROOT, ".cache");
const OUT = join(ROOT, "public", "data", "real");
const EIC_OUT = join(ROOT, "public", "data", "eic");
const DELAY_MS = 1200; // polite pause between requests
const RETRY_DELAY_MS = 4000;
const TIMEOUT_MS = 90_000;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const UA = "EARTHSONA-hackathon-prefetch/0.2 (NASA Space Apps 2026)";

const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const want = (k) => only.length === 0 || only.includes(k);
const onlyRegions = (process.argv.find((a) => a.startsWith("--region=")) ?? "").slice(9).split(",").filter(Boolean);
const regionWanted = (id) => onlyRegions.length === 0 || onlyRegions.includes(id);

const log = {
  ok: (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`),
  fail: (m) => console.log(`  \x1b[31m✘\x1b[0m ${m}`),
  info: (m) => console.log(`  · ${m}`),
  head: (m) => console.log(`\n\x1b[1m${m}\x1b[0m`),
};
const results = { ok: [], failed: [], skipped: [] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET JSON with timeout, polite delay and one retry. */
async function getJson(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await sleep(attempt === 1 ? DELAY_MS : RETRY_DELAY_MS);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
      return JSON.parse(text);
    } catch (err) {
      if (attempt === 2) throw err;
      log.info(`retrying once after: ${err.message ?? err}`);
    }
  }
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Atomic write so a crash mid-write never leaves a broken file. */
async function writeJsonAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 1) + "\n", "utf-8");
  await rename(tmp, path);
}

/** Validation gate: never overwrite a good file with an empty / failed / implausible result. */
function validate(series, range) {
  const vals = series.points.map((p) => p.value).filter((v) => v !== null);
  if (series.points.length === 0 || vals.length === 0) return "no valid values";
  // Gaps the provider itself flagged (MODIS cloudy / snow) are honest no-data, not a failed download:
  // accept those series down to 25 % valid; anything else needs 50 %.
  const qaGaps = series.points.filter((p) => p.value === null && (p.quality === "cloudy" || p.quality === "snow")).length;
  const minValid = qaGaps > 0 ? 0.25 : 0.5;
  if (vals.length / series.points.length < minValid) return `only ${vals.length}/${series.points.length} valid values`;
  if (qaGaps > 0 && vals.length / series.points.length < 0.5) log.info(`${series.id}: ${qaGaps} composites flagged cloudy/snow by the provider; kept with ${vals.length} valid values`);
  if (range) {
    const bad = vals.filter((v) => v < range[0] || v > range[1]);
    if (bad.length) return `${bad.length} values outside plausible range [${range}]`;
  }
  return null;
}

const PLAUSIBLE = { T2M: [-90, 60], PRECTOTCORR: [0, 1000], ALLSKY_SFC_SW_DWN: [0, 50], NDVI: [-0.2, 1], EVI: [-0.2, 1], SST: [-3, 40], SSTA: [-15, 15] };

function summarise(series) {
  const vals = series.points.map((p) => p.value).filter((v) => v !== null);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return `${series.points.length} pts, min ${min.toFixed(3)} / mean ${mean.toFixed(3)} / max ${max.toFixed(3)} ${series.unit}`;
}

// ---------------------------------------------------------------------------

const config = JSON.parse(await readFile(join(ROOT, "scripts", "regions.json"), "utf-8"));
const regions = new Map(config.regions.map((r) => [r.id, r]));
const manifestPath = join(OUT, "index.json");
const oldManifest = (await readJsonIfExists(manifestPath)) ?? { series: [] };
const manifest = new Map(oldManifest.series.map((e) => [e.id, e]));

async function saveSeries(series, { experience, regionId, periodKey }) {
  const problem = validate(series, PLAUSIBLE[series.variable]);
  const file = `${experience}/${series.id}.json`;
  if (problem) {
    const kept = manifest.has(series.id) ? " (kept existing good file)" : "";
    log.fail(`${series.id}: rejected — ${problem}${kept}`);
    results.failed.push(`${series.id}: ${problem}`);
    return;
  }
  await writeJsonAtomic(join(OUT, file), series);
  for (const [id, e] of manifest) {
    if (id !== series.id && e.experience === experience && e.regionId === regionId && e.variable === series.variable && e.periodKey === periodKey) manifest.delete(id);
  }
  manifest.set(series.id, {
    id: series.id,
    experience,
    variable: series.variable,
    regionId,
    periodKey,
    file,
    points: series.points.length,
    sourceName: series.source.name,
    retrievedAt: series.source.retrievedAt,
  });
  log.ok(`${series.id}: ${summarise(series)}`);
  results.ok.push(series.id);
}

const layersOf = (exp, source) => exp.periods.flatMap((p) => p.layers.filter((d) => d.source === source));

// --- Earth's Pulse: NASA POWER ---------------------------------------------
async function fetchPower(experience, exp) {
  // One request per region & period with all variables (politer than one per variable).
  const groups = new Map();
  for (const def of layersOf(exp, "power")) {
    const k = `${def.resolution}|${def.start}|${def.end}|${def.periodKey}`;
    if (!groups.has(k)) groups.set(k, { def, variables: [] });
    groups.get(k).variables.push(def.variable);
  }
  for (const regionId of exp.regions.filter(regionWanted)) {
    const region = regions.get(regionId);
    for (const { def, variables } of groups.values()) {
      const url = buildPowerUrl({ resolution: def.resolution, parameters: variables, lat: region.lat, lon: region.lon, start: def.start, end: def.end });
      log.info(`POWER ${region.name} ${variables.join("+")} ${def.periodKey}`);
      let json;
      try {
        json = await getJson(url);
      } catch (err) {
        for (const v of variables) {
          log.fail(`power ${v} ${regionId}: ${err.message}`);
          results.failed.push(`power-${v}-${regionId}-${def.periodKey}: ${err.message}`);
        }
        continue;
      }
      const retrievedAt = new Date().toISOString();
      for (const variable of variables) {
        try {
          const s = buildPowerSeries(json, { experience, variable, region, periodKey: def.periodKey, url, retrievedAt });
          await saveSeries(s, { experience, regionId, periodKey: def.periodKey });
        } catch (err) {
          log.fail(`power ${variable} ${regionId}: ${err.message}`);
          results.failed.push(`power-${variable}-${regionId}-${def.periodKey}: ${err.message}`);
        }
      }
    }
  }
}

// --- Forest Voices: ORNL DAAC MODIS (VI bands + pixel reliability QA) ------
async function fetchModis(experience, exp) {
  // Group VI variables sharing product & period so the reliability band is fetched once per batch.
  const groups = new Map();
  for (const def of layersOf(exp, "modis")) {
    const k = `${def.product ?? "MOD13Q1"}|${def.start}|${def.end}|${def.periodKey}`;
    if (!groups.has(k)) groups.set(k, { def, variables: [] });
    groups.get(k).variables.push(def.variable);
  }
  for (const regionId of exp.regions.filter(regionWanted)) {
    const region = regions.get(regionId);
    for (const { def, variables } of groups.values()) {
      const product = def.product ?? "MOD13Q1";
      log.info(`MODIS ${product} ${region.name} ${variables.join("+")} + QA ${def.start}..${def.end}`);
      try {
        const dates = parseModisDates(await getJson(buildModisDatesUrl(product, region.lat, region.lon)));
        const batches = batchModisDates(dates, def.start, def.end);
        if (!batches.length) throw new Error("no composites in period");
        const bodies = Object.fromEntries(variables.map((v) => [v, []]));
        const urls = Object.fromEntries(variables.map((v) => [v, []]));
        const reliability = [];
        for (const [i, b] of batches.entries()) {
          process.stdout.write(`\r    batch ${i + 1}/${batches.length} (${b.startDate}..${b.endDate})   `);
          for (const v of variables) {
            const url = buildModisSubsetUrl({ product, lat: region.lat, lon: region.lon, band: (MODIS_VI[v] ?? MODIS_VI.NDVI).band, startDate: b.startDate, endDate: b.endDate });
            bodies[v].push(await getJson(url));
            urls[v].push(url);
          }
          reliability.push(await getJson(buildModisSubsetUrl({ product, lat: region.lat, lon: region.lon, band: MODIS_RELIABILITY_BAND, startDate: b.startDate, endDate: b.endDate })));
        }
        process.stdout.write("\n");
        const retrievedAt = new Date().toISOString();
        for (const v of variables) {
          const s = buildModisSeries(bodies[v], { experience, variable: v, product, region, periodKey: def.periodKey, urls: urls[v], retrievedAt, reliabilityJsons: reliability });
          const flagged = s.points.filter((p) => p.quality === "cloudy" || p.quality === "snow").length;
          if (flagged) log.info(`${v}: ${flagged} composites set to no-data (cloudy or snow per pixel reliability)`);
          await saveSeries(s, { experience, regionId, periodKey: def.periodKey });
        }
      } catch (err) {
        process.stdout.write("\n");
        log.fail(`modis ${variables.join("+")} ${regionId}: ${err.message}`);
        results.failed.push(`modis-${variables.join("+")}-${regionId}: ${err.message}`);
      }
    }
  }
}

// --- Ocean Symphony: NASA/JPL MUR SST via ERDDAP (NOAA CoralTemp only if MUR is unreachable) ----------
/** Read the anomaly dataset's own description of its baseline (we never compute an anomaly ourselves). */
async function anomalyBaselineNote(base, datasetId) {
  try {
    await fetch(`${base}/info/index.json?page=1&itemsPerPage=1`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    log.info(`${base} not reachable: ${err.message}`);
    return null;
  }
  try {
    const info = await getJson(`${base}/info/${datasetId}/index.json`);
    const rows = info?.table?.rows ?? [];
    const summary = rows.find((r) => r[1] === "NC_GLOBAL" && r[2] === "summary")?.[4] ?? "";
    const m = summary.match(/[^.]*(climatolog|baseline|reference)[^.]*\./i);
    return m ? `anomaly baseline (from dataset metadata): ${m[0].trim()}` : "anomaly baseline: see dataset metadata";
  } catch (err) {
    log.info(`could not read anomaly metadata from ${base}: ${err.message}`);
    return null;
  }
}

// --- NASA/JPL MUR straight from PO.DAAC (needs an Earthdata Login token; Node only) ---------------------
const MUR_DELAY_MS = Number(process.env.MUR_DELAY_MS ?? 300);

/** Authenticated GET (text). Detects the Earthdata Login redirect instead of following it. */
async function getEarthdataText(url, token) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await sleep(attempt === 1 ? MUR_DELAY_MS : RETRY_DELAY_MS);
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status >= 300 && res.status < 400) {
        const to = res.headers.get("location") ?? "";
        if (/login|urs\.earthdata/i.test(to)) throw Object.assign(new Error("Earthdata Login rejected the token (redirected to login). Create a new token at https://urs.earthdata.nasa.gov/ → Generate Token."), { fatal: true });
        return await getEarthdataText(new URL(to, url).toString(), token);
      }
      const text = await res.text();
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`HTTP ${res.status}: token not accepted`), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
      return text;
    } catch (err) {
      if (err.fatal || attempt === 2) throw err;
      log.info(`retrying once after: ${err.message ?? err}`);
    }
  }
}

/** Returns true when every wanted place was saved from PO.DAAC MUR. */
async function fetchMurPodaac(experience, exp, token) {
  const defs = layersOf(exp, "sst");
  const def = defs.find((d) => d.variable === "SST") ?? defs[0];
  if (!def) return true;
  const stride = def.stride ?? 7;
  log.info(`PO.DAAC MUR v4.1 (${MUR_PODAAC.collection}) via CMR + OPeNDAP, every ${stride} days ${def.start} → ${def.end}`);
  // 1. Discover granules (public CMR, paged).
  let granules = [];
  for (let page = 1; page < 20; page++) {
    const batch = parseCmrGranules(await getJson(buildCmrGranuleUrl({ start: def.start, end: def.end, page })));
    granules.push(...batch);
    if (batch.length < 2000) break;
  }
  granules = sampleGranules(granules, def.start, stride);
  if (!granules.length) throw new Error("CMR returned no MUR granules for the period");
  log.info(`${granules.length} sampled granules`);
  // 2. Packing from the dataset's own DMR (falls back to the documented values).
  let packing = {};
  try {
    const dmr = await getEarthdataText(`${granules[0].opendap}.dmr.xml`, token);
    packing = { analysed_sst: parseDmrPacking(dmr, "analysed_sst"), sst_anomaly: parseDmrPacking(dmr, "sst_anomaly") };
  } catch (err) {
    if (err.fatal) throw err;
    log.info(`could not read DMR (${err.message}); using documented MUR packing`);
  }
  let allOk = true;
  for (const regionId of exp.regions.filter(regionWanted)) {
    const region = regions.get(regionId);
    const cell = murGridIndex(region.lat, region.lon);
    const cacheFile = join(CACHE, "mur", `${regionId}-${cell.i}-${cell.j}.json`);
    const cache = (await readJsonIfExists(cacheFile)) ?? {};
    const samples = [];
    let n = 0;
    for (const g of granules) {
      let text = cache[g.granule];
      if (text === undefined) {
        try {
          text = await getEarthdataText(buildMurOpendapUrl(g.opendap, cell.i, cell.j), token);
        } catch (err) {
          if (err.fatal) throw err;
          log.info(`${g.date}: ${err.message} (left as no data)`);
          samples.push({ date: g.date, sst: null, anom: null });
          continue;
        }
        cache[g.granule] = text;
        if (++n % 25 === 0) {
          await writeJsonAtomic(cacheFile, cache);
          log.info(`${region.name}: ${samples.length + 1}/${granules.length}`);
        }
      }
      samples.push({ date: g.date, sst: parseMurPointValue(text, "analysed_sst", packing.analysed_sst ?? undefined), anom: parseMurPointValue(text, "sst_anomaly", packing.sst_anomaly ?? undefined) });
    }
    await writeJsonAtomic(cacheFile, cache);
    const url = buildMurOpendapUrl(granules[0].opendap, cell.i, cell.j) + `   (one request per sampled day, ${granules.length} days; Earthdata Login)`;
    const { SST, SSTA } = buildMurPodaacSeries(samples, { experience, region, cell, periodKey: def.periodKey, url, retrievedAt: new Date().toISOString() });
    const before = results.failed.length;
    for (const s of [SST, SSTA]) if (defs.some((d) => d.variable === s.variable)) await saveSeries(s, { experience, regionId, periodKey: def.periodKey });
    if (results.failed.length > before) allOk = false;
  }
  return allOk;
}

async function fetchSst(experience, exp) {
  // 0. NASA/JPL MUR straight from PO.DAAC when an Earthdata token is configured (server-side only).
  const token = process.env.EARTHDATA_TOKEN?.trim();
  if (token) {
    try {
      // Partial failures are listed in the summary; existing good files are kept.
      await fetchMurPodaac(experience, exp, token);
      return;
    } catch (err) {
      log.fail(`PO.DAAC MUR: ${err.message}`);
      results.failed.push(`mur-podaac: ${err.message}`);
      log.info("falling back to ERDDAP");
    }
  } else {
    log.info("EARTHDATA_TOKEN not set: skipping PO.DAAC (MUR there requires Earthdata Login); trying ERDDAP");
  }
  // 1. Prefer NASA/JPL MUR. 2. If that server cannot be reached (and no ERDDAP_BASE override was given),
  //    use NOAA Coral Reef Watch CoralTemp for BOTH layers, so SST and its anomaly always come from one family.
  const murBase = process.env.ERDDAP_BASE || ERDDAP_DEFAULT.base;
  let provider = { id: "mur", base: murBase, lon360: false, ...ERDDAP_DEFAULT };
  let baselineNote = await anomalyBaselineNote(murBase, ERDDAP_DEFAULT.anomaly.datasetId);
  let fallbackReason;
  if (baselineNote === null && !process.env.ERDDAP_BASE) {
    fallbackReason = `the MUR server (${new URL(murBase).host}) could not be reached`;
    log.info(`${fallbackReason}; using NOAA Coral Reef Watch CoralTemp instead (labelled as NOAA, not MUR)`);
    provider = { id: "crw", ...ERDDAP_FALLBACK };
    baselineNote = await anomalyBaselineNote(provider.base, ERDDAP_FALLBACK.anomaly.datasetId);
  }
  for (const def of layersOf(exp, "sst")) {
    const ds = def.variable === "SSTA" ? provider.anomaly : provider.sst;
    for (const regionId of exp.regions.filter(regionWanted)) {
      const region = regions.get(regionId);
      const url = buildErddapUrl({ base: provider.base, datasetId: ds.datasetId, variable: ds.variable, start: def.start, end: def.end, stride: def.stride ?? 7, lat: region.lat, lon: region.lon, lon360: provider.lon360 });
      log.info(`ERDDAP ${ds.datasetId} ${region.name} ${def.periodKey}`);
      try {
        const s = buildErddapSstSeries(await getJson(url), {
          experience, variable: def.variable, erddapVariable: ds.variable, datasetId: ds.datasetId, region, periodKey: def.periodKey, url,
          retrievedAt: new Date().toISOString(), baselineNote: baselineNote ?? undefined, provider: provider.id, fallbackReason,
        });
        await saveSeries(s, { experience, regionId, periodKey: def.periodKey });
      } catch (err) {
        log.fail(`sst ${def.variable} ${regionId}: ${err.message}`);
        results.failed.push(`sst-${def.variable}-${regionId}: ${err.message} (server ${provider.base}; set ERDDAP_BASE to try another)`);
      }
    }
  }
}

// --- Globe imagery: NASA GIBS WMS snapshots -----------------------------------
async function fetchImagery() {
  const GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
  const items = [["base", config.imagery.base], ["night", config.imagery.night], ...Object.entries(config.imagery.overlays)];
  const out = join(ROOT, "public", "textures");
  await mkdir(out, { recursive: true });
  const meta = {};
  for (const [key, im] of items) {
    const q = new URLSearchParams({
      SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.3.0", LAYERS: im.layer, CRS: "EPSG:4326", BBOX: "-90,-180,90,180",
      WIDTH: String(im.width), HEIGHT: String(im.height), FORMAT: im.format,
      ...(im.format === "image/png" ? { TRANSPARENT: "TRUE" } : {}),
      ...(im.time ? { TIME: im.time } : {}),
    });
    const url = `${GIBS}?${q}`;
    log.info(`GIBS ${im.layer}${im.time ? ` @ ${im.time}` : ""}`);
    try {
      await sleep(DELAY_MS);
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("image/")) throw new Error(`HTTP ${res.status} ${type} ${(await res.text()).slice(0, 120)}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 20_000) throw new Error(`suspiciously small image (${buf.length} bytes); existing file kept`);
      await writeFile(join(out, im.file), buf);
      meta[key] = { ...im, url, retrievedAt: new Date().toISOString(), bytes: buf.length, credit: "NASA Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)." };
      log.ok(`textures/${im.file} (${(buf.length / 1024).toFixed(0)} KB)`);
      results.ok.push(`imagery-${key}`);
    } catch (err) {
      log.fail(`imagery ${key}: ${err.message}`);
      results.failed.push(`imagery-${key}: ${err.message}`);
    }
  }
  const metaPath = join(out, "imagery.json");
  const old = (await readJsonIfExists(metaPath)) ?? {};
  await writeJsonAtomic(metaPath, { ...old, ...meta });
}

// --- EIC visuals: NASA SVS --------------------------------------------------
async function fetchEic() {
  for (const [experience, refs] of Object.entries(config.eic)) {
    if (experience.startsWith("$")) continue;
    const frames = [];
    const outJson = join(EIC_OUT, `${experience}.json`);
    const old = (await readJsonIfExists(outJson))?.frames ?? [];
    for (const ref of refs) {
      log.info(`SVS ${ref.svsId}${ref.itemTitle ? ` · ${ref.itemTitle}` : ""} → ${experience} (${ref.key})`);
      try {
        const frame = parseSvsPage(await getJson(`https://svs.gsfc.nasa.gov/api/${ref.svsId}`), { itemTitle: ref.itemTitle });
        if (!frame.imageUrl) throw new Error("no image in SVS page");
        let localImage;
        try {
          await sleep(DELAY_MS);
          const res = await fetch(frame.imageUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
          const len = Number(res.headers.get("content-length") ?? 0);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (len > MAX_IMAGE_BYTES) {
            res.body?.cancel();
            log.info(`image is ${(len / 1048576).toFixed(1)} MB — too large to bundle; the app will load it online only`);
          } else {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length <= MAX_IMAGE_BYTES) {
              const ext = frame.imageUrl.match(/\.(png|jpe?g)$/i)?.[1] ?? "png";
              localImage = `${ref.key}.${ext}`;
              await mkdir(EIC_OUT, { recursive: true });
              await writeFile(join(EIC_OUT, localImage), buf);
            }
          }
        } catch (err) {
          log.info(`image not bundled: ${err.message}`);
        }
        frames.push({ ...frame, key: ref.key, gallery: ref.gallery, dataset: ref.dataset, relation: ref.relation, localImage, retrievedAt: new Date().toISOString() });
        log.ok(`${ref.key}: "${frame.title}"${localImage ? ` + ${localImage}` : " (remote image)"}`);
        results.ok.push(`eic-${ref.key}`);
      } catch (err) {
        const prev = old.find((f) => f.key === ref.key);
        if (prev) frames.push(prev);
        log.fail(`eic ${ref.key}: ${err.message}${prev ? " (kept existing entry)" : ""}`);
        results.failed.push(`eic-${ref.key}: ${err.message}`);
      }
    }
    if (frames.length) await writeJsonAtomic(outJson, { experience, frames });
  }
}

// ---------------------------------------------------------------------------

console.log(`EARTHSONA NASA pre-fetch → ${OUT}`);
for (const [experience, exp] of Object.entries(config.experiences)) {
  if (!want(experience)) continue;
  log.head(`${experience}`);
  if (layersOf(exp, "power").length) await fetchPower(experience, exp);
  if (layersOf(exp, "modis").length) await fetchModis(experience, exp);
  if (layersOf(exp, "sst").length) await fetchSst(experience, exp);
}
if (want("imagery")) {
  log.head("imagery (NASA GIBS)");
  await fetchImagery();
}
if (want("eic")) {
  log.head("eic (NASA SVS)");
  await fetchEic();
}

// Drop manifest entries for places no longer listed under their experience in regions.json.
for (const [id, e] of manifest) {
  if (!config.experiences[e.experience]?.regions.includes(e.regionId)) {
    log.info(`manifest: dropping ${id} (place no longer in ${e.experience})`);
    manifest.delete(id);
  }
}

await writeJsonAtomic(manifestPath, {
  generatedAt: new Date().toISOString(),
  series: [...manifest.values()].sort((a, b) => a.id.localeCompare(b.id)),
});

log.head("Summary");
console.log(`  succeeded: ${results.ok.length}   failed: ${results.failed.length}   skipped: ${results.skipped.length}`);
for (const f of results.failed) console.log(`  failed  → ${f}`);
for (const s of results.skipped) console.log(`  skipped → ${s}`);
console.log(`  manifest: ${manifest.size} bundled series in public/data/real/index.json`);
process.exitCode = results.failed.length && !results.ok.length ? 1 : 0;
