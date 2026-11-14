import { describe, expect, it } from "vitest";
import { normaliseSeries } from "../src/data/normalise";
import type { Track } from "../src/data/registry";
import type { EarthSeries, SeriesDef } from "../src/data/types";
import { trackToFrames } from "../src/sonification/frames";
import { pitchFrequency, semitonesBetween } from "../src/sonification/mappings";

const track = (variable: string, vals: (number | null)[], lat = 0): Track => {
  const s: EarthSeries = {
    id: variable, experience: "forest", variable, label: variable, unit: "", region: { name: "r", lat, lon: 0 },
    points: vals.map((v, i) => ({ time: `2020-${String(i + 1).padStart(2, "0")}-01`, value: v, quality: v === null ? "cloudy" : "good" })),
    source: { kind: "nasa", name: "n", citation: "c" },
  };
  const d: SeriesDef = { source: "modis", variable, roles: ["pitch"], start: "2020", end: "2020", periodKey: "p" };
  return {
    experience: "forest", region: { id: "r", name: "r", lat, lon: 0, biome: "", baseline: { temp: 0, ndvi: 0, sst: 0 } },
    period: { key: "p", label: "p", layers: [d] },
    layers: [{ def: d, result: { series: normaliseSeries(s), origin: "bundled" } }], origin: "bundled", notices: [],
  };
};

describe("sound integrity: missing and interpolated dates", () => {
  it("a date filled in by interpolation is NOT played or shown as a measurement", () => {
    const f = trackToFrames(track("NDVI", [0.8, null, 0.6]), "absolute");
    expect(f[1].pitch).toBeNull(); // plays the no-data tick
    expect(f[1].values.NDVI.value).toBeNull();
    expect(f[1].values.NDVI.quality).toBe("no measurement");
    expect(f[1].estimate).not.toBeNull(); // only for the optional, clearly different smoothing sound
    expect(f[0].estimate).toBeNull();
    expect(f[2].prevPitch).toBeCloseTo(f[0].pitch!, 6); // the next note glides from the last REAL measurement
  });
  it("longer gaps stay gaps with no estimate at all", () => {
    const f = trackToFrames(track("NDVI", [0.8, null, null, 0.6]), "absolute");
    expect(f[1].pitch).toBeNull();
    expect(f[1].estimate).toBeNull();
  });
});

describe("pitch resolution with one global range", () => {
  it("the smallest real changes are audible (pitch is continuous)", () => {
    const n = trackToFrames(track("NDVI", [0.8, 0.81]), "absolute");
    expect(n[1].pitch!).toBeGreaterThan(n[0].pitch!);
    expect(pitchFrequency("forest", n[1].pitch!)).toBeGreaterThan(pitchFrequency("forest", n[0].pitch!));
    const t = trackToFrames(track("T2M", [25, 25.1]), "absolute");
    expect(t[1].pitch!).toBeGreaterThan(t[0].pitch!);
  });
  it("a typical season is several semitones (Mauritius SST about 23 → 29 °C)", () => {
    const s = trackToFrames(track("SST", [23, 29]), "absolute");
    expect(semitonesBetween(s[0].pitch!, s[1].pitch!)).toBeGreaterThan(5);
  });
  it("the same value is the same pitch at every place", () => {
    const a = trackToFrames(track("NDVI", [0.3, 0.6]), "absolute");
    const b = trackToFrames(track("NDVI", [0.9, 0.6], 50), "absolute");
    expect(a[1].pitch).toBe(b[1].pitch);
  });
});
