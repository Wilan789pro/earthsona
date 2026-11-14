import { describe, expect, it } from "vitest";
import { PRESETS, VARS, baselineOf, changesFromBaseline, simulate } from "../src/lab/simulation";

const missions = ["forest", "ocean", "pulse"] as const;
const health = (m: (typeof missions)[number], over: Record<string, number> = {}) => simulate(m, { ...baselineOf(m), ...over }).health;

describe("Laboratories: six variables each, with min / baseline / max", () => {
  it("every mission has exactly six variables with a baseline inside the range", () => {
    for (const m of missions) {
      expect(VARS[m]).toHaveLength(6);
      for (const d of VARS[m]) {
        expect(d.min).toBeLessThan(d.max);
        expect(d.baseline).toBeGreaterThanOrEqual(d.min);
        expect(d.baseline).toBeLessThanOrEqual(d.max);
        expect(d.help.length).toBeGreaterThan(10);
      }
    }
  });

  it("baseline conditions are reasonably healthy and have no stress findings", () => {
    for (const m of missions) {
      expect(health(m)).toBeGreaterThan(60);
      expect(changesFromBaseline(m, baselineOf(m))).toEqual([]);
    }
  });

  it("changes are gradual: one slider step never collapses the ecosystem", () => {
    for (const m of missions) {
      for (const d of VARS[m]) {
        let prev = health(m);
        for (let x = d.baseline; x <= d.max; x += d.step) {
          const h = health(m, { [d.key]: x });
          expect(Math.abs(h - prev)).toBeLessThanOrEqual(12);
          prev = h;
        }
      }
    }
  });
});

describe("Forest: interconnected relationships", () => {
  it("less rain dries the forest progressively, and heat makes drought worse (combined effect)", () => {
    const dry = health("forest", { rain: 40 });
    const hot = health("forest", { temp: 4 });
    const both = health("forest", { rain: 40, temp: 4 });
    expect(dry).toBeLessThan(health("forest"));
    expect(both).toBeLessThan(Math.min(dry, hot));
    const r = simulate("forest", { ...baselineOf("forest"), rain: 40, temp: 4 });
    expect(r.findings.join(" ")).toMatch(/Heat and dry soil are acting together/);
  });
  it("more CO₂ does not automatically mean a healthier forest", () => {
    const co2Only = health("forest", { co2: 840 });
    const co2Hot = health("forest", { co2: 840, temp: 4, rain: 40 });
    expect(co2Only).toBeGreaterThanOrEqual(health("forest") - 1);
    expect(co2Hot).toBeLessThan(health("forest"));
    expect(simulate("forest", { ...baselineOf("forest"), co2: 840, temp: 4, rain: 40 }).findings.join(" ")).toMatch(/does not mean a healthier forest/);
  });
  it("too much rain causes waterlogging stress", () => {
    const r = simulate("forest", { ...baselineOf("forest"), rain: 290, soil: 98 });
    expect(r.indicators.find((i) => i.key === "waterlog")!.value).toBeGreaterThan(0.5);
  });
});

describe("Ocean: interconnected relationships", () => {
  it("warming raises bleaching risk and lowers live coral", () => {
    const warm = simulate("ocean", { ...baselineOf("ocean"), sst: 2.5 });
    expect(warm.indicators.find((i) => i.key === "bleach")!.value).toBeGreaterThan(0.8);
    expect(health("ocean", { sst: 2.5 })).toBeLessThan(health("ocean"));
  });
  it("excess nutrients cause a bloom that depletes oxygen", () => {
    const r = simulate("ocean", { ...baselineOf("ocean"), nutrients: 280 });
    expect(r.visual.bloom).toBeGreaterThan(0.6);
    expect(r.indicators.find((i) => i.key === "oxygen")!.value).toBeGreaterThan(simulate("ocean", baselineOf("ocean")).indicators.find((i) => i.key === "oxygen")!.value);
  });
  it("reef health responds to stressors rather than being an isolated setting", () => {
    const start = 80;
    const stressed = simulate("ocean", { ...baselineOf("ocean"), reef: start, sst: 2, ph: 7.7 });
    expect(stressed.indicators.find((i) => i.key === "coral")!.value).toBeLessThan(start / 100 / 2);
  });
});

describe("Earth Pulse: interconnected relationships", () => {
  it("doubling CO₂ implies ~3 °C (IPCC best-estimate sensitivity)", () => {
    const r = simulate("pulse", { ...baselineOf("pulse"), co2: 560 });
    expect(r.indicators.find((i) => i.key === "implied")!.value * 6).toBeCloseTo(3, 1);
  });
  it("warming reduces ice and raises risk", () => {
    const hot = simulate("pulse", { ...baselineOf("pulse"), temp: 3.5 });
    expect(hot.indicators.find((i) => i.key === "ice")!.value).toBeLessThan(simulate("pulse", baselineOf("pulse")).indicators.find((i) => i.key === "ice")!.value);
    expect(health("pulse", { temp: 3.5 })).toBeLessThan(health("pulse"));
  });
  it("extreme-weather wording never blames single events", () => {
    const r = simulate("pulse", { ...baselineOf("pulse"), extreme: 2.5 });
    expect(r.findings.join(" ")).toMatch(/Individual events still have many causes/);
  });
});

describe("What happens if… scenarios", () => {
  it("every preset uses only that mission's variables and stays within range", () => {
    for (const m of missions) {
      for (const p of PRESETS[m]) {
        for (const [k, v] of Object.entries(p.values)) {
          const d = VARS[m].find((x) => x.key === k)!;
          expect(d).toBeDefined();
          expect(v).toBeGreaterThanOrEqual(d.min);
          expect(v).toBeLessThanOrEqual(d.max);
        }
      }
    }
  });
});
