/**
 * Forest Voices: the team's real Mauritius vegetation observations (Datasets/EARTHSONA_Mauritius_Vegetation.csv).
 *
 * The CSV is a Google Earth Engine export of NASA MODIS MOD13Q1.061 (Terra, 250 m, 16-day composites):
 *   system:index  Earth Engine image id (date-based)
 *   EVI, NDVI     vegetation indices, ALREADY SCALED (raw × 0.0001), unitless, valid −0.2…1
 *   SummaryQA     MOD13Q1 pixel reliability: 0 good · 1 marginal · 2 snow/ice · 3 cloudy
 *   dataKind, dataset, experience, location, latitude, longitude, quality  (metadata written by the export)
 *   date          composite start date (YYYY-MM-DD)
 *   .geo          GeoJSON geometry (empty MultiPoint in this export; latitude/longitude are used instead)
 *
 * The file is imported read-only at build time; it is never modified. Nothing is invented: rows that fail
 * validation are kept in `rejected` with a reason and are not played.
 */

export interface VegetationObservation {
  id: string;
  date: string; // ISO date of the 16-day composite
  ndvi: number; // original value as in the CSV (already scaled, unitless)
  evi: number | null;
  summaryQA: number; // 0 good · 1 marginal (the CSV's own label is kept in `quality`)
  quality: string;
  dataset: string;
  location: string;
  lat: number;
  lon: number;
  kind: string; // "observation"
}

export interface VegetationDataset {
  source: string;
  observations: VegetationObservation[];
  rejected: { row: number; reason: string; raw: Record<string, string> }[];
  columns: string[];
}

export const QA_MEANING: Record<number, string> = { 0: "good", 1: "marginal (usable, lower confidence)", 2: "snow or ice", 3: "cloudy" };

/** Minimal RFC-4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const num = (s: string | undefined) => {
  if (s === undefined || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Parse + validate. Returns observations sorted by date, plus the rows that were rejected and why. */
export function loadVegetationCsv(text: string, source: string): VegetationDataset {
  const rows = parseCsv(text);
  const columns = (rows.shift() ?? []).map((c) => c.trim());
  const col = (r: string[], name: string) => r[columns.indexOf(name)];
  const out: VegetationObservation[] = [];
  const rejected: VegetationDataset["rejected"] = [];
  const seen = new Set<string>();
  rows.forEach((r, k) => {
    const raw = Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ""]));
    const reject = (reason: string) => rejected.push({ row: k + 2, reason, raw });
    const date = (col(r, "date") ?? "").trim();
    const ndvi = num(col(r, "NDVI"));
    const evi = num(col(r, "EVI"));
    const qa = num(col(r, "SummaryQA"));
    const lat = num(col(r, "latitude"));
    const lon = num(col(r, "longitude"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return reject("invalid or missing date");
    if (ndvi === null) return reject("missing NDVI");
    if (ndvi < -0.2 || ndvi > 1) return reject(`NDVI ${ndvi} outside the valid range −0.2…1`);
    if (evi !== null && (evi < -0.2 || evi > 1)) return reject(`EVI ${evi} outside the valid range −0.2…1`);
    if (qa === 2 || qa === 3) return reject(`SummaryQA ${qa}: ${QA_MEANING[qa]}; not a usable vegetation value`);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return reject("invalid coordinates");
    if (seen.has(date)) return reject(`duplicate observation for ${date}`);
    seen.add(date);
    out.push({
      id: (col(r, "system:index") ?? date).trim() || date,
      date,
      ndvi,
      evi,
      summaryQA: qa ?? -1,
      quality: (col(r, "quality") ?? "").trim() || (qa !== null ? QA_MEANING[qa] ?? "unknown" : "unknown"),
      dataset: (col(r, "dataset") ?? "").trim() || "MODIS MOD13Q1.061",
      location: (col(r, "location") ?? "").trim() || "Mauritius",
      lat,
      lon,
      kind: (col(r, "dataKind") ?? "").trim() || "observation",
    });
  });
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { source, observations: out, rejected, columns };
}
