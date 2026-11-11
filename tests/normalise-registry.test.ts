import { describe, expect, it } from "vitest";
import { normaliseSeries, toUnit } from "../src/data/normalise";
import { DataRegistry, type Manifest } from "../src/data/registry";
import type { EarthSeries, RegionDef, SeriesDef } from "../src/data/types";

const base: Omit<EarthSeries, "points"> = {
  id: "t",
  experience: "pulse",
  variable: "T2M",
  label: "x",
  unit: "°C",
  region: { name: "r", lat: 0, lon: 0 },
  source: { kind: "nasa", name: "n", citation: "c" },
};

describe("normaliseSeries", () => {
  it("sorts, trims edge nulls, bridges single gaps and keeps long gaps", () => {
    const s = normaliseSeries({
      ...base,
      points: [
        { time: "2020-05-01", value: 5 },
        { time: "2020-01-01", value: null },
        { time: "2020-02-01", value: 1 },
        { time: "2020-03-01", value: null },
        { time: "2020-04-01", value: 3 },
        { time: "2020-06-01", value: null },
        { time: "2020-07-01", value: null },
        { time: "2020-08-01", value: 8 },
        { time: "2020-09-01", value: null },
      ],
    });
    expect(s.points.map((p) => p.time)).toEqual([
      "2020-02-01", "2020-03-01", "2020-04-01", "2020-05-01", "2020-06-01", "2020-07-01", "2020-08-01",
    ]);
    expect(s.points[1]).toEqual({ time: "2020-03-01", value: 2, bridged: true });
    expect(s.points[4].value).toBeNull();
    expect(s.stats.gaps).toBe(2);
    // Stats use observations only (bridged value 2 excluded).
    expect(s.stats).toMatchObject({ min: 1, max: 8, count: 4, mean: 4.25 });
  });

  it("throws on a series with no valid values", () => {
    expect(() => normaliseSeries({ ...base, points: [{ time: "2020-01-01", value: null }] })).toThrow();
  });

  it("toUnit maps into 0..1", () => {
    const s = normaliseSeries({ ...base, points: [{ time: "2020-01-01", value: 10 }, { time: "2020-02-01", value: 20 }] });
    expect(toUnit(15, s.stats)).toBe(0.5);
    expect(toUnit(99, s.stats)).toBe(1);
  });
});

describe("DataRegistry fallback order", () => {
  const region: RegionDef = { id: "port-louis", name: "Port Louis", lat: -20.16, lon: 57.5, biome: "", baseline: { temp: 25, ndvi: 0.2, sst: 26 } };
  const def: SeriesDef = { source: "power", variable: "T2M", resolution: "monthly", start: "2020", end: "2021", periodKey: "2020-2021" };
  const realSeries: EarthSeries = { ...base, points: [{ time: "2020-01-01", value: 27 }, { time: "2020-02-01", value: 28 }] };
  const manifest: Manifest = {
    generatedAt: "x",
    series: [{ id: "a", experience: "pulse", variable: "T2M", regionId: "port-louis", periodKey: "2020-2021", file: "pulse/a.json", points: 2, sourceName: "NASA POWER", retrievedAt: "x" }],
  };

  const make = (routes: Record<string, unknown>, opts: { fail?: boolean; hang?: boolean } = {}) => {
    const calls: string[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (opts.fail) throw new TypeError("Failed to fetch");
      if (opts.hang && url.startsWith("https://")) {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }
      const key = Object.keys(routes).find((k) => url.includes(k));
      return key ? new Response(JSON.stringify(routes[key])) : new Response("", { status: 404 });
    }) as typeof fetch;
    return { reg: new DataRegistry("/data/real/", f, 50), calls };
  };

  it("1. uses bundled JSON when present", async () => {
    const { reg } = make({ "index.json": manifest, "pulse/a.json": realSeries });
    const r = await reg.getSeries({ experience: "pulse", region, def, mode: "auto", live: true });
    expect(r.origin).toBe("bundled");
    expect(r.series.stats.max).toBe(28);
  });

  it("2. goes live when nothing is bundled and live is on, and caches it", async () => {
    const power = { header: { fill_value: -999, api: { name: "POWER", version: "v2" } }, properties: { parameter: { T2M: { "202001": 27, "202002": 28 } } } };
    const { reg, calls } = make({ "index.json": { generatedAt: "", series: [] }, "power.larc.nasa.gov": power });
    const r1 = await reg.getSeries({ experience: "pulse", region, def, mode: "auto", live: true });
    const r2 = await reg.getSeries({ experience: "pulse", region, def, mode: "auto", live: true });
    expect(r1.origin).toBe("live");
    expect(r2.origin).toBe("live");
    expect(calls.filter((c) => c.includes("power.larc")).length).toBe(1);
  });

  it("3. falls back to simulated with a polite notice when live fails / times out", async () => {
    const { reg } = make({ "index.json": { generatedAt: "", series: [] } }, { hang: true });
    const r = await reg.getSeries({ experience: "pulse", region, def, mode: "auto", live: true });
    expect(r.origin).toBe("simulated");
    expect(r.notice).toMatch(/could not be loaded in time/);
    expect(r.series.source.kind).toBe("simulated");
  });

  it("works with the network fully down (no manifest, no live)", async () => {
    const { reg } = make({}, { fail: true });
    const r = await reg.getSeries({ experience: "pulse", region, def, mode: "auto", live: false });
    expect(r.origin).toBe("simulated");
    expect(r.notice).toBeUndefined();
  });

  it("mode=simulated forces simulated even when real data exists", async () => {
    const { reg } = make({ "index.json": manifest, "pulse/a.json": realSeries });
    const r = await reg.getSeries({ experience: "pulse", region, def, mode: "simulated", live: false });
    expect(r.origin).toBe("simulated");
  });
});
