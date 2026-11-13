import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import config from "../scripts/regions.json";
import {
  MUR_PODAAC,
  buildCmrGranuleUrl,
  buildMurOpendapUrl,
  buildMurPodaacSeries,
  murGridIndex,
  parseCmrGranules,
  parseMurPointValue,
  sampleGranules,
} from "../src/data/parsers.js";
import { GAME, IMPACT, MISSIONS, STEPS, emptyProgress } from "../src/ui/missions";

const fixture = (f: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", f), "utf-8"));

describe("MUR from PO.DAAC (CMR discovery + OPeNDAP point request)", () => {
  it("parses a real CMR granule response and builds concept-id OPeNDAP URLs", () => {
    const g = parseCmrGranules(fixture("cmr_mur_granules_2024-01-01.json"));
    expect(g.length).toBe(2);
    expect(g[0].date).toBe("2024-01-01");
    expect(g[0].granule).toMatch(/MUR-GLOB-v02\.0-fv04\.1$/);
    expect(g[0].opendap).toBe(`https://opendap.earthdata.nasa.gov/collections/${MUR_PODAAC.collection}/granules/${g[0].granule}`);
  });

  it("samples every 7th day from the start date", () => {
    const days = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10) }));
    expect(sampleGranules(days, "2020-01-01", 7).map((d) => d.date)).toEqual(["2020-01-01", "2020-01-08", "2020-01-15", "2020-01-22", "2020-01-29"]);
  });

  it("finds the nearest 0.01° grid cell (grid from the MUR v4.1 specification)", () => {
    expect(murGridIndex(-89.99, -179.99)).toMatchObject({ i: 0, j: 0 });
    expect(murGridIndex(89.99, 180)).toMatchObject({ i: 17998, j: 35999 });
    const c = murGridIndex(-20.5, 57);
    expect(c).toMatchObject({ i: 6949, j: 23699, lat: -20.5, lon: 57 });
  });

  it("encodes the constraint brackets (Hyrax rejects raw ones) and asks for both variables", () => {
    const u = buildMurOpendapUrl("https://opendap.earthdata.nasa.gov/collections/C1/granules/X", 6949, 23699);
    expect(u).not.toMatch(/[[\]]/);
    expect(u).toContain("analysed_sst%5B0:1:0%5D%5B6949:1:6949%5D%5B23699:1:23699%5D");
    expect(u).toContain(",sst_anomaly%5B");
    expect(buildCmrGranuleUrl({ start: "2020-01-01", end: "2020-01-31" })).toContain("temporal=2020-01-01T00%3A00%3A00Z%2C2020-01-31T23%3A59%3A59Z");
  });

  it("unpacks stored integers, keeps unpacked decimals, and never invents a value for fill / NaN / missing", () => {
    // Value handling only (not a server response): packed int16 kelvin → °C; anomaly in kelvin difference.
    expect(parseMurPointValue("analysed_sst.analysed_sst[0][0], 1500", "analysed_sst")).toBeCloseTo(26.5, 3);
    expect(parseMurPointValue("analysed_sst.analysed_sst[0][0], 299.65", "analysed_sst")).toBeCloseTo(26.5, 3);
    expect(parseMurPointValue("sst_anomaly.sst_anomaly[0][0], 420", "sst_anomaly")).toBeCloseTo(0.42, 3);
    expect(parseMurPointValue("analysed_sst.analysed_sst[0][0], -32768", "analysed_sst")).toBeNull();
    expect(parseMurPointValue("analysed_sst.analysed_sst[0][0], NaN", "analysed_sst")).toBeNull();
    expect(parseMurPointValue("analysed_sst.time, 1388570400", "analysed_sst")).toBeNull();
  });

  it("labels the result as NASA MUR and keeps gaps as null", () => {
    const { SST, SSTA } = buildMurPodaacSeries(
      [{ date: "2020-01-08", sst: 27.1, anom: 0.3 }, { date: "2020-01-01", sst: null, anom: null }],
      { experience: "ocean", region: { id: "x", name: "X", lat: -20.5, lon: 57 }, cell: { lat: -20.5, lon: 57 }, periodKey: "p", url: "u" },
    );
    expect(SST.source.kind).toBe("nasa");
    expect(SST.source.name).toMatch(/MUR/);
    expect(SST.points[0]).toEqual({ time: "2020-01-01", value: null });
    expect(SSTA.source.product).toMatch(/2003–2014/);
  });
});

describe("Astronaut missions", () => {
  const worlds = Object.keys(config.experiences) as (keyof typeof MISSIONS)[];

  it("has a mission with seven narrated steps for every world", () => {
    expect(STEPS.length).toBe(7);
    for (const w of worlds) {
      const m = MISSIONS[w];
      for (let i = 0; i < 7; i++) expect(m.lines[i as 0].length).toBeGreaterThan(10);
      expect(m.actions.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("every challenge and prediction has exactly one right answer, with feedback for each choice", () => {
    const sets = [...worlds.map((w) => MISSIONS[w].challenge.options), ...worlds.map((w) => IMPACT[w].predict.options), ...GAME.map((g) => g.options)];
    for (const opts of sets) {
      expect(opts.filter((o) => o.ok).length).toBe(1);
      for (const o of opts) expect(o.why.length).toBeGreaterThan(5);
    }
  });

  it("consequence chains start from the data and end by saying what was NOT checked", () => {
    for (const w of worlds) {
      const c = IMPACT[w].chain;
      expect(c[0].kind).toBe("measured");
      expect(c[c.length - 1].kind).toBe("not-checked");
      expect(IMPACT[w].sources.length).toBeGreaterThan(0);
    }
  });

  it("mission and impact text contains no invented measurements (numbers come only from loaded data)", () => {
    const text = JSON.stringify([MISSIONS, IMPACT.ocean.chain, IMPACT.forest, IMPACT.pulse, GAME]);
    expect(text).not.toMatch(/\d+(\.\d+)?\s*(°C|mm|MJ|kWh|%)/);
  });

  it("forest content never equates lower greenness with deforestation", () => {
    const t = JSON.stringify([MISSIONS.forest, IMPACT.forest]).toLowerCase();
    expect(t).toMatch(/does not prove|not by itself/);
    expect(t).not.toMatch(/deforestation (was|is) (shown|proven|measured)/);
  });

  it("starts with empty progress and no badges", () => {
    const p = emptyProgress();
    expect(p.intro).toBe(false);
    for (const w of worlds) expect(p[w]).toEqual({ step: 0, done: Array(7).fill(false), badge: false });
  });
});

import { natureModFor } from "../src/audio/ambience";

describe("Measurements shape the nature sound (documented rules)", () => {
  const v = (o: Record<string, number | null>) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, { value: x }]));
  it("greener forest → livelier forest; no green → silent forest", () => {
    expect(natureModFor("forest", v({ NDVI: 0.9 })).life).toBeGreaterThan(natureModFor("forest", v({ NDVI: 0.4 })).life!);
    expect(natureModFor("forest", v({ NDVI: 0 })).life).toBe(0);
  });
  it("more rain → heavier rain; no rain → no rain sound; sunshine → birds", () => {
    expect(natureModFor("pulse", v({ PRECTOTCORR: 0 })).rain).toBe(0);
    expect(natureModFor("pulse", v({ PRECTOTCORR: 12 })).rain).toBeGreaterThan(1);
    expect(natureModFor("pulse", v({ ALLSKY_SFC_SW_DWN: 25 })).life).toBeGreaterThan(natureModFor("pulse", v({ ALLSKY_SFC_SW_DWN: 5 })).life!);
  });
  it("warmer sea → brighter waves; missing data changes nothing (never invented)", () => {
    expect(natureModFor("ocean", v({ SST: 29 })).bright).toBeGreaterThan(natureModFor("ocean", v({ SST: 18 })).bright!);
    expect(natureModFor("ocean", v({ SST: null }))).toEqual({});
    expect(natureModFor("forest", {})).toEqual({});
  });
});
