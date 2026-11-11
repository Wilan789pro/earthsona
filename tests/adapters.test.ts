import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  batchModisDates,
  buildModisSeries,
  buildPowerSeries,
  buildPowerUrl,
  parseModisDates,
  parseModisSubset,
  parsePowerResponse,
  parseSvsPage,
} from "../src/data/parsers.js";
import { powerAdapter } from "../src/data/adapters/powerAdapter";
import { modisAdapter } from "../src/data/adapters/modisAdapter";
import { sstAdapter } from "../src/data/adapters/sstAdapter";
import { simulatedAdapter } from "../src/data/adapters/simulatedAdapter";
import type { FetchParams } from "../src/data/types";

// Fixtures are REAL responses saved from the APIs (Port Louis, Mauritius) on 2026-11-11.
const fx = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8"));

const portLouis = { id: "port-louis", name: "Port Louis, Mauritius", lat: -20.16, lon: 57.5 };

/** Minimal fetch stub that serves fixtures by URL substring. */
function stubFetch(routes: [string, unknown][]): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = routes.find(([k]) => url.includes(k));
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetch: f, calls };
}

describe("NASA POWER parsing", () => {
  it("parses daily T2M with ISO dates and tropical values", () => {
    const p = parsePowerResponse(fx("power_daily_port_louis.json"), "T2M");
    expect(p.fillValue).toBe(-999);
    expect(p.points).toHaveLength(10);
    expect(p.points[0]).toEqual({ time: "2024-01-01", value: 27.89 });
    for (const pt of p.points) expect(pt.value).toBeGreaterThan(20), expect(pt.value).toBeLessThan(32);
  });

  it("drops the monthly annual-mean row (MM=13) and maps months to the 1st", () => {
    const p = parsePowerResponse(fx("power_monthly_port_louis.json"), "T2M");
    expect(p.points).toHaveLength(24);
    expect(p.points.map((x) => x.time)).not.toContain("2020-13-01");
    expect(p.points[0]).toEqual({ time: "2020-01-01", value: 27.15 });
    expect(p.points[23].time).toBe("2021-12-01");
  });

  it("treats the fill value (-999) as null", () => {
    const j = fx("power_daily_port_louis.json");
    j.properties.parameter.PRECTOTCORR["20240105"] = -999.0;
    const p = parsePowerResponse(j, "PRECTOTCORR");
    expect(p.points.find((x) => x.time === "2024-01-05")!.value).toBeNull();
  });

  it("builds a normalised EarthSeries with citation and exact URL", () => {
    const url = buildPowerUrl({ resolution: "daily", parameters: ["T2M"], lat: -20.16, lon: 57.5, start: "2024-01-01", end: "2024-01-10" });
    expect(url).toContain("/daily/point?");
    expect(url).toContain("start=20240101");
    const s = buildPowerSeries(fx("power_daily_port_louis.json"), {
      experience: "pulse",
      variable: "T2M",
      region: portLouis,
      periodKey: "2024-jan",
      url,
      retrievedAt: "2026-11-11T00:00:00Z",
    });
    expect(s.id).toBe("power-t2m-port-louis-2024-jan");
    expect(s.unit).toBe("°C");
    expect(s.source.kind).toBe("nasa");
    expect(s.source.url).toBe(url);
    expect(s.source.citation).toMatch(/Langley Research Center/);
    expect(s.source.citation).toMatch(/v2\.10\.3/);
  });

  it("monthly URLs use YYYY start/end", () => {
    const url = buildPowerUrl({ resolution: "monthly", parameters: ["T2M"], lat: 1, lon: 2, start: "2015", end: "2024-12-31" });
    expect(url).toContain("/monthly/point?");
    expect(url).toContain("start=2015&end=2024");
  });

  it("powerAdapter fetches and parses through an injected fetch", async () => {
    const { fetch, calls } = stubFetch([["power.larc.nasa.gov", fx("power_monthly_port_louis.json")]]);
    const params: FetchParams = {
      experience: "pulse",
      region: portLouis,
      def: { source: "power", variable: "T2M", resolution: "monthly", start: "2020", end: "2021", periodKey: "2020-2021" },
      fetchImpl: fetch,
    };
    const s = await powerAdapter.fetchSeries(params);
    expect(calls).toHaveLength(1);
    expect(s.points).toHaveLength(24);
  });
});

describe("ORNL DAAC MODIS parsing", () => {
  it("applies the 0.0001 scale factor and yields NDVI within [-0.2, 1]", () => {
    const pts = parseModisSubset(fx("modis_subset_port_louis.json"));
    expect(pts).toHaveLength(8);
    expect(pts[0]).toEqual({ time: "2024-01-01", value: 0.1781 });
    for (const p of pts) expect(p.value!).toBeGreaterThanOrEqual(-0.2), expect(p.value!).toBeLessThanOrEqual(1);
  });

  it("treats the fill value (-3000) and out-of-range values as null", () => {
    const j = fx("modis_subset_port_louis.json");
    j.subset[1].data = [-3000];
    j.subset[2].data = [12000];
    const pts = parseModisSubset(j);
    expect(pts[1].value).toBeNull();
    expect(pts[2].value).toBeNull();
  });

  it("batches composite dates in groups of at most 10", () => {
    const dates = parseModisDates(fx("modis_dates_port_louis.json"));
    const batches = batchModisDates(dates, "2024-01-01", "2024-12-31");
    expect(batches.reduce((n, b) => n + b.count, 0)).toBe(23);
    expect(Math.max(...batches.map((b) => b.count))).toBeLessThanOrEqual(10);
    expect(batches[0].startDate).toBe("A2024001");
  });

  it("merges batches into one sorted series with citations", () => {
    const s = buildModisSeries([fx("modis_subset_port_louis.json")], {
      experience: "forest",
      variable: "NDVI",
      product: "MOD13Q1",
      region: portLouis,
      periodKey: "2024",
      urls: ["https://modis.ornl.gov/x"],
    });
    expect(s.source.citation).toMatch(/10\.3334\/ORNLDAAC\/1600/);
    expect(s.source.citation).toMatch(/MOD13Q1\.061/);
    expect(s.points.map((p) => p.time)).toEqual([...s.points.map((p) => p.time)].sort());
  });

  it("modisAdapter requests dates first, then subsets in ≤10-date batches", async () => {
    const { fetch, calls } = stubFetch([
      ["/dates?", fx("modis_dates_port_louis.json")],
      ["/subset?", fx("modis_subset_port_louis.json")],
    ]);
    const s = await modisAdapter.fetchSeries({
      experience: "forest",
      region: portLouis,
      def: { source: "modis", variable: "NDVI", product: "MOD13Q1", start: "2024-01-01", end: "2024-12-31", periodKey: "2024" },
      fetchImpl: fetch,
    });
    expect(calls[0]).toContain("/MOD13Q1/dates?");
    expect(calls.filter((c) => c.includes("/subset?"))).toHaveLength(3); // 23 composites → 10 + 10 + 3
    expect(s.source.kind).toBe("nasa");
  });
});

describe("SST + simulated adapters", () => {
  const def = { source: "sst" as const, variable: "SST", start: "2020-01-01", end: "2020-12-31", periodKey: "2020" };
  it("SST adapter is still simulated and says so", async () => {
    const s = await sstAdapter.fetchSeries({ experience: "ocean", region: portLouis, def });
    expect(s.source.kind).toBe("simulated");
    expect(s.source.name).toMatch(/Simulated demonstration data/);
  });
  it("simulated data is deterministic per region", async () => {
    const a = await simulatedAdapter.fetchSeries({ experience: "ocean", region: portLouis, def });
    const b = await simulatedAdapter.fetchSeries({ experience: "ocean", region: portLouis, def });
    expect(a.points).toEqual(b.points);
    expect(a.points.length).toBeGreaterThan(50);
  });
});

describe("SVS / EIC parsing", () => {
  it("picks a gallery card by title", () => {
    const f = parseSvsPage(fx("svs_40509.json"), { itemTitle: "Sea Surface Temperature" });
    expect(f.title).toBe("Earth Now Dashboard: Sea Surface Temperature");
    expect(f.imageUrl).toBe("https://svs.gsfc.nasa.gov/images/gallery/EarthNowDashboard/WorldView_SST.png");
    expect(f.altText).toMatch(/Sea Surface Temperature/);
  });
  it("uses the light-weight _searchweb image on visualization pages", () => {
    const f = parseSvsPage(fx("svs_5147.json"));
    expect(f.title).toBe("GEOS-FP Near-Surface Temperature");
    expect(f.imageUrl).toMatch(/_searchweb\.png$/);
    expect(f.released).toMatch(/^2023-09-26/);
  });
});
