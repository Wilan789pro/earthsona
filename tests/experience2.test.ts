import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import config from "../scripts/regions.json";
import { ERDDAP_FALLBACK, buildErddapSstSeries, buildErddapUrl, dataTypeFor } from "../src/data/parsers.js";
import { AMBIENCE } from "../src/audio/ambience";
import { TIPS } from "../src/ui/narrator";
import { timeWindows, KID } from "../src/ui/kid";
import { PALETTES, palettesFor } from "../src/sonification/palettes";

const fixture = (f: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", f), "utf-8"));
const region = (id: string) => config.regions.find((r) => r.id === id)!;

describe("nine featured experiences", () => {
  const exps = config.experiences as Record<string, { regions: string[] }>;
  it("has three places per world, Mauritius in every world, and one place without regional music in each", () => {
    for (const [id, e] of Object.entries(exps)) {
      expect(e.regions, id).toHaveLength(3);
      expect(e.regions.some((r) => region(r).country === "Mauritius"), `${id} has Mauritius`).toBe(true);
      expect(e.regions.some((r) => (region(r) as { musicStatus?: string }).musicStatus === "none"), `${id} has a nature-only place`).toBe(true);
    }
  });

  it("only Mauritius gets a regional palette; every other place explains why it has none", () => {
    for (const r of config.regions as { id: string; country: string; music?: string; musicStatus?: string; musicNote?: string }[]) {
      if (r.music) {
        expect(r.country).toBe("Mauritius");
        expect(palettesFor(r.music).map((p) => p.id)).toContain("sega");
      } else {
        expect(["pending", "none"]).toContain(r.musicStatus);
        expect(r.musicNote?.length ?? 0).toBeGreaterThan(30);
        expect(palettesFor(undefined).map((p) => p.id)).toEqual(["neutral"]);
      }
    }
  });

  it("every place has a distinct natural soundscape preset and a sourced fact", () => {
    const used = new Set<string>();
    for (const r of config.regions as { id: string; ambience: string; fact: string; factSource: { url: string }; kidIntro: string }[]) {
      expect(AMBIENCE[r.ambience as keyof typeof AMBIENCE], r.id).toBeDefined();
      expect(r.factSource.url).toMatch(/^https:\/\//);
      expect(r.kidIntro.split(/\s+/).length).toBeLessThan(20);
      used.add(r.ambience);
    }
    expect(used.size).toBe(config.regions.length); // no generic soundscape shared by every place
  });

  it("pairs each world with official EIC visuals and says how each relates to the sound", () => {
    for (const exp of ["ocean", "forest", "pulse"]) {
      const refs = (config.eic as unknown as Record<string, { svsId: number; relation: string; gallery: string }[]>)[exp];
      expect(refs.length).toBeGreaterThan(0);
      for (const r of refs) {
        expect(r.svsId).toBeGreaterThan(0);
        expect(r.gallery).toMatch(/Earth Information Center|EIC/);
        expect(r.relation.length).toBeGreaterThan(40);
      }
    }
    expect((config.eic as unknown as Record<string, { svsId: number }[]>).forest.map((r) => r.svsId)).toContain(4950); // GEDI Forest Height
  });
});

describe("NOAA Coral Reef Watch fallback for ocean temperature", () => {
  it("uses 0–360° longitudes on the OceanWatch server", () => {
    const url = buildErddapUrl({ base: ERDDAP_FALLBACK.base, datasetId: "CRW_sst_v3_1", variable: "analysed_sst", start: "2024-01-01", end: "2024-02-26", stride: 7, lat: 21.1, lon: -158, lon360: true });
    expect(decodeURIComponent(url)).toContain("[(21.1)][(202)]");
    expect(url.startsWith("https://oceanwatch.pifsc.noaa.gov/erddap/griddap/CRW_sst_v3_1.json?")).toBe(true);
  });

  it("parses a real response and labels it as NOAA, not MUR", () => {
    const s = buildErddapSstSeries(fixture("erddap_crw_sst_hawaii.json"), {
      experience: "ocean", variable: "SST", erddapVariable: "analysed_sst", datasetId: "CRW_sst_v3_1",
      region: { id: "hawaii-waters", name: "Hawaii", lat: 21.1, lon: -158 }, periodKey: "2020-2024", url: "u", provider: "crw",
    });
    expect(s.source.kind).toBe("noaa");
    expect(s.source.name).toMatch(/Coral Reef Watch/);
    expect(s.source.name).not.toMatch(/MUR/);
    expect(s.source.product).toMatch(/instead of NASA\/JPL MUR/);
    expect(s.unit).toBe("°C");
    expect(s.points[0]).toEqual({ time: "2024-01-01", value: 25.09 });
    expect(s.points.every((p) => p.value !== null && p.value > 20 && p.value < 30)).toBe(true);
  });
});

describe("data type disclosure", () => {
  it("never presents a model value as a satellite observation", () => {
    expect(dataTypeFor("T2M").kind).toBe("model");
    expect(dataTypeFor("PRECTOTCORR").kind).toBe("model");
    expect(dataTypeFor("T2M").label).toMatch(/model/i);
    expect(dataTypeFor("NDVI").kind).toBe("satellite-derived");
    expect(dataTypeFor("SST").kind).toBe("analysis");
    expect(dataTypeFor("SST", "NOAA Coral Reef Watch (CoralTemp) via ERDDAP").detail).toMatch(/CoralTemp/);
    expect(dataTypeFor("T2M", "Simulated demo").kind).toBe("simulated");
  });
});

describe("child-friendly helpers", () => {
  it("offers one window per year, or quarters for a single year", () => {
    const multi = timeWindows(["2020-01-01", "2021-06-01", "2022-12-01"]);
    expect(multi.map((w) => w.key)).toEqual(["all", "2020", "2021", "2022"]);
    const single = timeWindows(["2024-01-01", "2024-12-31"]);
    expect(single.map((w) => w.label)).toEqual(["All of 2024", "Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"]);
  });

  it("keeps spoken tips short (about 5–12 s, one idea each)", () => {
    for (const list of Object.values(TIPS)) {
      for (const t of list) {
        const words = t.split(/\s+/).length;
        expect(words).toBeGreaterThanOrEqual(10);
        expect(words).toBeLessThanOrEqual(30); // ≈ 2.5 words/s → ≤ 12 s
      }
    }
  });

  it("translates harmony labels into plain words", () => {
    expect(KID.harmony("calm fifth (near baseline)")).toMatch(/calm/);
    expect(KID.harmony("strong tension (much warmer than baseline)")).toMatch(/much warmer/);
  });

  it("describes the Sega palette as data-free arrangement, with references", () => {
    expect(PALETTES.sega.references.length).toBeGreaterThanOrEqual(2);
    expect(PALETTES.sega.instruments.find((i) => /low thump/i.test(i.name))?.role).toMatch(/does NOT carry data/);
    // no synthesised sound may be presented as a real Sega instrument
    for (const i of PALETTES.sega.instruments) if (/ravann|maravann|triangle/i.test(i.name)) expect(i.name).toMatch(/not a real/);
  });
});
