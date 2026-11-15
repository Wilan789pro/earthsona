import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseGistemp } from "../src/data/gistemp";

const real = parseGistemp(readFileSync("Datasets/GLB.Ts+dSST.csv", "utf8"));

describe("NASA GISTEMP global temperature (team file, read-only)", () => {
  it("reads complete years 1880 onwards, annual means only for complete years", () => {
    expect(real.years[0]).toEqual({ year: 1880, anomaly: -0.18 });
    expect(real.years.length).toBeGreaterThan(140);
    expect(real.years.every((y) => Number.isFinite(y.anomaly))).toBe(true);
    expect(real.rejected).toEqual([]);
    // the current, incomplete year has "***" for J-D and is NOT averaged
    const last = real.years[real.years.length - 1];
    expect(real.latestMonth!.year).toBeGreaterThanOrEqual(last.year);
  });
  it("values are plausible anomalies in °C (vs 1951–1980)", () => {
    const vals = real.years.map((y) => y.anomaly);
    expect(Math.min(...vals)).toBeGreaterThan(-1);
    expect(Math.max(...vals)).toBeLessThan(2);
  });
  it("never fills a missing year", () => {
    const d = parseGistemp("Land-Ocean: Global Means\nYear,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,J-D\n2000,.1,.1,.1,.1,.1,.1,.1,.1,.1,.1,.1,.1,.10\n2001,.2,***,***,***,***,***,***,***,***,***,***,***,***\n");
    expect(d.years).toEqual([{ year: 2000, anomaly: 0.1 }]);
    expect(d.latestMonth).toEqual({ year: 2001, month: 1, anomaly: 0.2 });
  });
});
