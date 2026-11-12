import { describe, expect, it } from "vitest";
import { normaliseSeries } from "../src/data/normalise";
import type { Track } from "../src/data/registry";
import type { EarthSeries, SeriesDef } from "../src/data/types";
import { labFrames, trackToFrames } from "../src/sonification/frames";
import { ABSOLUTE_RANGE, NOTE_COUNT, densityHits, harmonyIntervals, noteFrequency, noteIndex, noteName } from "../src/sonification/mappings";
import { PALETTES, palettesFor } from "../src/sonification/palettes";

const mk = (variable: string, unit: string, vals: (number | null)[], kind: "nasa" | "simulated" = "nasa"): EarthSeries => ({
  id: variable,
  experience: "pulse",
  variable,
  label: variable,
  unit,
  region: { name: "r", lat: 0, lon: 0 },
  points: vals.map((v, i) => ({ time: `2020-${String(i + 1).padStart(2, "0")}-01`, value: v })),
  source: { kind, name: "n", citation: "c" },
});
const def = (variable: string, roles: SeriesDef["roles"]): SeriesDef => ({ source: "power", variable, roles, start: "2020", end: "2020", periodKey: "p" });
const track = (layers: [SeriesDef, EarthSeries][]): Track => ({
  experience: "pulse",
  region: { id: "r", name: "r", lat: 0, lon: 0, biome: "", baseline: { temp: 0, ndvi: 0, sst: 0 } },
  period: { key: "p", label: "p", layers: layers.map(([d]) => d) },
  layers: layers.map(([d, s]) => ({ def: d, result: { series: normaliseSeries(s), origin: "bundled" } })),
  origin: "bundled",
  notices: [],
});

describe("documented mappings", () => {
  it("pitch: min → lowest note, max → highest note, monotonic", () => {
    expect(noteIndex(0)).toBe(0);
    expect(noteIndex(1)).toBe(NOTE_COUNT - 1);
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.05) {
      const n = noteIndex(x);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
      expect(noteFrequency("pulse", n)).toBeGreaterThan(0);
    }
    expect(noteName(noteFrequency("pulse", 0))).toBe("C3");
    expect(noteName(noteFrequency("pulse", NOTE_COUNT - 1))).toBe("C5");
  });

  it("rainfall density: 0 → no hits, max → 4 hits", () => {
    expect(densityHits(0)).toBe(0);
    expect(densityHits(1)).toBe(4);
    expect(densityHits(0.5)).toBe(2);
  });

  it("SST anomaly harmony uses absolute thresholds and direction", () => {
    expect(harmonyIntervals({ kind: "anomaly", anomaly: 0.2 }).semitones).toEqual([7]);
    expect(harmonyIntervals({ kind: "anomaly", anomaly: -0.2 }).semitones).toEqual([-7]);
    expect(harmonyIntervals({ kind: "anomaly", anomaly: 1.0 }).label).toMatch(/gentle tension \(warmer/);
    expect(harmonyIntervals({ kind: "anomaly", anomaly: -2.0 }).label).toMatch(/strong tension \(much cooler/);
  });
});

describe("track → frames", () => {
  const t = track([
    [def("T2M", ["pitch"]), mk("T2M", "°C", [20, 22, null, null, 30])],
    [def("PRECTOTCORR", ["density"]), mk("PRECTOTCORR", "mm/day", [0, 30, 15, 7.5, 0])],
    [def("ALLSKY_SFC_SW_DWN", ["brightness"]), mk("ALLSKY_SFC_SW_DWN", "MJ/m²/day", [35, 0, 10, 10, 35])],
  ]);
  const frames = trackToFrames(t, "relative");

  it("uses the pitch layer as the time axis and aligns other layers by date", () => {
    expect(frames).toHaveLength(5);
    expect(frames[0].pitch).toBe(0);
    expect(frames[4].pitch).toBe(1);
    expect(frames[1].density).toBe(1); // 30 mm/day = top of the absolute rainfall range
    expect(frames[0].brightness).toBe(1);
    expect(frames[0].values.PRECTOTCORR.value).toBe(0);
  });

  it("keeps long gaps as no-data frames (null pitch → no-data cue)", () => {
    expect(frames[2].pitch).toBeNull();
    expect(frames[3].pitch).toBeNull();
  });

  it("global (absolute) pitch: the same value gives the same note anywhere", () => {
    const a = trackToFrames(track([[def("T2M", ["pitch"]), mk("T2M", "°C", [10, 25, 26])]]), "absolute");
    const b = trackToFrames(track([[def("T2M", ["pitch"]), mk("T2M", "°C", [24, 25, 40])]]), "absolute");
    expect(a[1].pitch).toBe(b[1].pitch);
    const r = ABSOLUTE_RANGE.T2M;
    expect(a[1].pitch).toBeCloseTo((25 - r.min) / (r.max - r.min));
  });

  it("frames do not depend on the sound palette (palette is not an input)", () => {
    expect(trackToFrames(t, "relative")).toEqual(frames);
  });
});

describe("Earth Sound Lab frames", () => {
  it("map slider values on the absolute scale", () => {
    const f = labFrames({ T2M: 45, PRECTOTCORR: 0, ALLSKY_SFC_SW_DWN: 35 }, "T2M", 4);
    expect(f).toHaveLength(4);
    expect(f[0].pitch).toBe(1);
    expect(f[0].density).toBe(0);
    expect(f[0].brightness).toBe(1);
  });
});

describe("palettes", () => {
  it("offers the Sega-inspired profile only where the region is tagged for it", () => {
    expect(palettesFor(undefined).map((p) => p.id)).toEqual(["neutral"]);
    expect(palettesFor("sega").map((p) => p.id)).toEqual(["neutral", "sega"]);
  });
  it("documents cultural references and states that the drum carries no data", () => {
    expect(PALETTES.sega.references.length).toBeGreaterThanOrEqual(2);
    expect(PALETTES.sega.instruments.find((i) => /frame drum/i.test(i.name))?.role).toMatch(/does NOT carry data/);
  });
});
