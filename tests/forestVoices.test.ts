import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadVegetationCsv, parseCsv } from "../src/data/forestCsv";
import { MAX_STARTS, MIN_STARTS, describeChange, eviToStartsPerSecond, ndviToSemitones, voiceFor } from "../src/sonification/forestVoices";

const CSV_PATH = join(__dirname, "..", "Datasets", "EARTHSONA_Mauritius_Vegetation.csv");
const csv = readFileSync(CSV_PATH, "utf-8");
const header = csv.split(/\r?\n/)[0];

describe("Team's Mauritius vegetation CSV (real file, read-only)", () => {
  const data = loadVegetationCsv(csv, "Datasets/EARTHSONA_Mauritius_Vegetation.csv");

  it("parses every row and keeps the original values", () => {
    expect(data.columns).toEqual(["system:index", "EVI", "NDVI", "SummaryQA", "dataKind", "dataset", "date", "experience", "latitude", "location", "longitude", "quality", ".geo"]);
    expect(data.rejected).toEqual([]);
    expect(data.observations.map((o) => o.date)).toEqual(["2024-01-01", "2024-01-17"]);
    const [a, b] = data.observations;
    expect(a.ndvi).toBe(0.8603000000000001);
    expect(a.evi).toBe(0.6834);
    expect(b.ndvi).toBe(0.9096000000000001);
    expect(b.evi).toBe(0.3635);
    expect(a.summaryQA).toBe(1);
    expect(a.quality).toBe("marginal");
    expect(a.dataset).toBe("MODIS MOD13Q1.061");
    expect([a.lat, a.lon]).toEqual([-20.2, 57.5]);
  });

  it("handles the quoted GeoJSON column", () => {
    const rows = parseCsv(csv);
    expect(rows[1][12]).toBe('{"type":"MultiPoint","coordinates":[]}');
  });

  it("rejects missing, invalid, cloudy and duplicate rows instead of inventing values", () => {
    const bad = [
      header,
      "a,0.5,,1,observation,MODIS,2024-02-01,forest-voices,-20.2,Mauritius,57.5,marginal,{}",
      "b,0.5,1.7,0,observation,MODIS,2024-02-17,forest-voices,-20.2,Mauritius,57.5,good,{}",
      "c,0.5,0.8,3,observation,MODIS,2024-03-04,forest-voices,-20.2,Mauritius,57.5,cloudy,{}",
      "d,0.5,0.8,0,observation,MODIS,not-a-date,forest-voices,-20.2,Mauritius,57.5,good,{}",
      "e,0.5,0.8,0,observation,MODIS,2024-03-20,forest-voices,-20.2,Mauritius,57.5,good,{}",
      "f,0.4,0.7,0,observation,MODIS,2024-03-20,forest-voices,-20.2,Mauritius,57.5,good,{}",
    ].join("\n");
    const d = loadVegetationCsv(bad, "test");
    expect(d.observations.map((o) => o.date)).toEqual(["2024-03-20"]);
    expect(d.rejected.map((r) => r.reason)).toEqual([
      "missing NDVI",
      "NDVI 1.7 outside the valid range −0.2…1",
      "SummaryQA 3: cloudy; not a usable vegetation value",
      "invalid or missing date",
      "duplicate observation for 2024-03-20",
    ]);
  });
});

describe("Forest Voices: data drives the team's SuperCollider instrument", () => {
  it("NDVI → pitch, with the same shape as the original temperature → pitch rule (±1 octave)", () => {
    expect(ndviToSemitones(0)).toBe(-12);
    expect(ndviToSemitones(0.5)).toBe(0);
    expect(ndviToSemitones(1)).toBe(12);
    expect(ndviToSemitones(0.75)).toBeCloseTo(6);
  });
  it("EVI → sounds per second, in the original wind range (0.25–3.0/s)", () => {
    expect(eviToStartsPerSecond(0)).toBe(MIN_STARTS);
    expect(eviToStartsPerSecond(1)).toBe(MAX_STARTS);
    expect(eviToStartsPerSecond(null)).toBe(MIN_STARTS);
  });
  it("the two real observations sound different, in the direction of the data", () => {
    const [a, b] = loadVegetationCsv(csv, "x").observations;
    const va = voiceFor(a);
    const vb = voiceFor(b);
    expect(vb.semitones).toBeGreaterThan(va.semitones); // NDVI went up → higher
    expect(vb.startsPerSecond).toBeLessThan(va.startsPerSecond); // EVI went down → slower beat
    expect(vb.semitones - va.semitones).toBeCloseTo(((0.9096 - 0.8603) / 0.5) * 12, 2);
    expect(va.gain).toBeLessThan(1); // marginal quality is audibly softer
    const c = describeChange(a, b);
    expect(c.lines[0]).toMatch(/went up from 0\.86 to 0\.91/);
    expect(c.lines[1]).toMatch(/went down from 0\.68 to 0\.36.*slower/);
  });
});
