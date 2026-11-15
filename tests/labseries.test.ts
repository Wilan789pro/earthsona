import { describe, expect, it } from "vitest";
import { NO_CHANGE, applyChange, applyToRows, realRows, whatIfChange } from "../src/lab/series";

const layer = (variable: string, pts: [string, number | null, boolean?][]) => ({
  def: { variable },
  result: { series: { points: pts.map(([time, value, bridged]) => ({ time, value, bridged: !!bridged })) } },
});

describe("Earth Sound Lab series: real measurements, changed by the sliders", () => {
  it("takes the latest real (not filled-in) dates and joins the other variables", () => {
    const rows = realRows([layer("SST", [["a", 25], ["b", null], ["c", 26, true], ["d", 27]]), layer("SSTA", [["a", 0.1], ["d", 0.4]])], "SST");
    expect(rows.map((r) => r.time)).toEqual(["a", "d"]);
    expect(rows[1].vals).toEqual({ SST: 27, SSTA: 0.4 });
  });
  it("no change leaves the real values untouched", () => {
    const v = { SST: 27, SSTA: 0.4 };
    expect(applyChange(v, NO_CHANGE("ocean"))).toEqual(v);
  });
  it("ocean: Sea warmth shifts the measured temperature; the other sliders do not", () => {
    const base = { sst: 0.4, ph: 8.05, pollution: 15 };
    const c = whatIfChange("ocean", { ...base, sst: 2.4, pollution: 90 }, base);
    expect(applyChange({ SST: 27, SSTA: 0.4 }, c)).toEqual({ SST: 29, SSTA: 2.4 });
    expect(whatIfChange("ocean", { ...base, pollution: 90 }, base).add).toBe(0);
  });
  it("forest: the model's greenness scales NDVI and EVI (forest density)", () => {
    const out = applyToRows([{ time: "a", vals: { NDVI: 0.8, EVI: 0.5 } }], whatIfChange("forest", {}, {}, 0.5));
    expect(out[0].vals.NDVI).toBeCloseTo(0.4);
    expect(out[0].vals.EVI).toBeCloseTo(0.25);
  });
  it("pulse: Heat shifts T2M, Rain scales rain, Sunshine scales sunlight", () => {
    const base = { temp: 25, rain: 4, sun: 20, storms: 1 };
    const c = whatIfChange("pulse", { ...base, temp: 28, rain: 8, sun: 10 }, base);
    const v = applyChange({ T2M: 24, PRECTOTCORR: 2, ALLSKY_SFC_SW_DWN: 18 }, c);
    expect(v.T2M).toBeCloseTo(27);
    expect(v.PRECTOTCORR).toBeCloseTo(4);
    expect(v.ALLSKY_SFC_SW_DWN).toBeCloseTo(9);
  });
});
