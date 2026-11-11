#!/usr/bin/env node
/**
 * Pre-fetch real NASA data so the hackathon demo never depends on venue Wi-Fi.
 *
 *   npm run fetch-data                 # everything in scripts/regions.json
 *   npm run fetch-data -- --only=pulse # one experience (pulse | forest | ocean | eic)
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
  MODIS_NDVI_BAND,
} from "../src/data/parsers.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "data", "real");
const EIC_OUT = join(ROOT, "public", "data", "eic");
const DELAY_MS = 1200; // polite pause between requests
const RETRY_DELAY_MS = 4000;
const TIMEOUT_MS = 90_000;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const UA = "EARTHSONA-hackathon-prefetch/0.2 (NASA Space Apps 2026)";

const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const want = (k) => only.length === 0 || only.includes(k);

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
  if (vals.length / series.points.length < 0.5) return `only ${vals.length}/${series.points.length} valid values`;
  if (range) {
    const bad = vals.filter((v) => v < range[0] || v > range[1]);
    if (bad.length) return `${bad.length} values outside plausible range [${range}]`;
  }
  return null;
}

const PLAUSIBLE = { T2M: [-90, 60], PRECTOTCORR: [0, 1000], NDVI: [-0.2, 1] };

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

// --- Earth's Pulse: NASA POWER ---------------------------------------------
async function fetchPower(experience, exp) {
  // One request per region & period with all variables (politer than one per variable).
  const groups = new Map();
  for (const def of exp.series.filter((d) => d.source === "power")) {
    const k = `${def.resolution}|${def.start}|${def.end}|${def.periodKey}`;
    if (!groups.has(k)) groups.set(k, { def, variables: [] });
    groups.get(k).variables.push(def.variable);
  }
  for (const regionId of exp.regions) {
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
          results.failed.push(`power-${v}-${regionId}: ${err.message}`);
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
          results.failed.push(`power-${variable}-${regionId}: ${err.message}`);
        }
      }
    }
  }
}

// --- Forest Voices: ORNL DAAC MODIS ----------------------------------------
async function fetchModis(experience, exp) {
  for (const def of exp.series.filter((d) => d.source === "modis")) {
    const product = def.product ?? "MOD13Q1";
    const band = def.band ?? MODIS_NDVI_BAND.band;
    for (const regionId of exp.regions) {
      const region = regions.get(regionId);
      log.info(`MODIS ${product} ${region.name} ${def.start}..${def.end}`);
      try {
        const dates = parseModisDates(await getJson(buildModisDatesUrl(product, region.lat, region.lon)));
        const batches = batchModisDates(dates, def.start, def.end);
        if (!batches.length) throw new Error("no composites in period");
        const bodies = [];
        const urls = [];
        for (const [i, b] of batches.entries()) {
          const url = buildModisSubsetUrl({ product, lat: region.lat, lon: region.lon, band, startDate: b.startDate, endDate: b.endDate });
          process.stdout.write(`\r    batch ${i + 1}/${batches.length} (${b.startDate}..${b.endDate})   `);
          bodies.push(await getJson(url));
          urls.push(url);
        }
        process.stdout.write("\n");
        const s = buildModisSeries(bodies, { experience, variable: def.variable, product, region, periodKey: def.periodKey, urls, retrievedAt: new Date().toISOString() });
        await saveSeries(s, { experience, regionId, periodKey: def.periodKey });
      } catch (err) {
        process.stdout.write("\n");
        log.fail(`modis ${def.variable} ${regionId}: ${err.message}`);
        results.failed.push(`modis-${def.variable}-${regionId}: ${err.message}`);
      }
    }
  }
}

// --- EIC visuals: NASA SVS --------------------------------------------------
async function fetchEic() {
  for (const [experience, ref] of Object.entries(config.eic)) {
    log.info(`SVS ${ref.svsId}${ref.itemTitle ? ` · ${ref.itemTitle}` : ""} → ${experience}`);
    const outJson = join(EIC_OUT, `${experience}.json`);
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
            localImage = `${experience}.${ext}`;
            await mkdir(EIC_OUT, { recursive: true });
            await writeFile(join(EIC_OUT, localImage), buf);
          }
        }
      } catch (err) {
        log.info(`image not bundled: ${err.message}`);
      }
      await writeJsonAtomic(outJson, { ...frame, localImage, retrievedAt: new Date().toISOString() });
      log.ok(`eic/${experience}.json: "${frame.title}"${localImage ? ` + ${localImage}` : " (remote image)"}`);
      results.ok.push(`eic-${experience}`);
    } catch (err) {
      const kept = (await stat(outJson).catch(() => null)) ? " (kept existing file)" : "";
      log.fail(`eic ${experience}: ${err.message}${kept}`);
      results.failed.push(`eic-${experience}: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------

console.log(`EARTHSONA NASA pre-fetch → ${OUT}`);
for (const [experience, exp] of Object.entries(config.experiences)) {
  if (!want(experience)) continue;
  log.head(`${experience}`);
  if (exp.series.some((d) => d.source === "power")) await fetchPower(experience, exp);
  if (exp.series.some((d) => d.source === "modis")) await fetchModis(experience, exp);
  if (exp.series.some((d) => d.source === "sst")) {
    log.info("SST source not confirmed yet (see src/data/adapters/sstAdapter.ts TODO) — app uses simulated data");
    results.skipped.push(`${experience}: SST (pending mentor confirmation)`);
  }
}
if (want("eic")) {
  log.head("eic (NASA SVS)");
  await fetchEic();
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
