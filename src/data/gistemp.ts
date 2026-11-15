import csvText from "../../Datasets/GLB.Ts+dSST.csv?raw";
import { parseCsv } from "./forestCsv";

/**
 * NASA GISTEMP v4 (GISS Surface Temperature Analysis), file Datasets/GLB.Ts+dSST.csv (read-only).
 * "Land-Ocean: Global Means": monthly global mean surface temperature ANOMALIES in °C, i.e. how much warmer or
 * cooler the whole planet was than its 1951–1980 average (land air temperatures + sea surface temperatures).
 * "***" marks months that are not available yet; those are skipped, never filled in. EARTHSONA uses the annual
 * mean (column J-D) only for complete years. This is the WHOLE PLANET, unlike NASA POWER (one place's weather).
 */
export interface GistempYear {
  year: number;
  /** Annual (Jan–Dec) mean anomaly, °C vs 1951–1980. */
  anomaly: number;
}

export interface GistempData {
  source: string;
  years: GistempYear[];
  /** Latest monthly value available (may be from an incomplete year). */
  latestMonth: { year: number; month: number; anomaly: number } | null;
  rejected: string[];
}

export const GISTEMP_BASELINE = "1951–1980";

export function parseGistemp(text: string, source = "Datasets/GLB.Ts+dSST.csv"): GistempData {
  const rows = parseCsv(text).filter((r) => r.length > 1);
  const head = rows.findIndex((r) => r[0].trim() === "Year");
  if (head < 0) throw new Error("GISTEMP: header row not found");
  const cols = rows[head].map((c) => c.trim());
  const jd = cols.indexOf("J-D");
  if (jd < 0) throw new Error("GISTEMP: J-D column not found");
  const years: GistempYear[] = [];
  const rejected: string[] = [];
  let latestMonth: GistempData["latestMonth"] = null;
  for (const r of rows.slice(head + 1)) {
    const year = Number(r[0]);
    if (!Number.isInteger(year) || year < 1850 || year > 2100) {
      rejected.push(`bad year "${r[0]}"`);
      continue;
    }
    for (let m = 1; m <= 12; m++) {
      const v = Number(r[m]);
      if (r[m] && r[m].trim() !== "***" && Number.isFinite(v)) latestMonth = { year, month: m, anomaly: v };
    }
    const cell = (r[jd] ?? "").trim();
    if (cell === "***" || cell === "") continue; // incomplete year: not averaged, not invented
    const a = Number(cell);
    if (!Number.isFinite(a) || Math.abs(a) > 5) {
      rejected.push(`${year}: implausible annual value "${cell}"`);
      continue;
    }
    years.push({ year, anomaly: a });
  }
  return { source, years, latestMonth, rejected };
}

export const GISTEMP = parseGistemp(csvText);
