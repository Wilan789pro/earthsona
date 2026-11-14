import { describe, expect, it } from "vitest";
import { RULES, activeRules, combinedSound } from "../src/lab/scenarios";
import { baselineOf, simulate } from "../src/lab/simulation";
import { NO_FX, PHRASE, shapeFrame } from "../src/audio/labLoop";
import { labFrames } from "../src/sonification/frames";
import { noteIndex } from "../src/sonification/mappings";

describe("WHAT IF? scenario engine", () => {
  it("every rule is fully documented with a hedged kid sentence and an https source", () => {
    for (const r of RULES) {
      for (const k of ["condition", "consequence", "kid", "visual"] as const) expect(r[k].length).toBeGreaterThan(5);
      expect(r.sound.text.length).toBeGreaterThan(5);
      expect(r.source.url).toMatch(/^https:\/\//);
      if (r.mood === "concerned") expect(r.kid).toMatch(/could|may|might/);
    }
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });
  it("at the real starting point only the 'healthy/normal' rule fires", () => {
    const realPulse = baselineOf("pulse", { temp: 25.5, rain: 3.2, sun: 19 });
    for (const [m, base] of [["forest", baselineOf("forest")], ["ocean", baselineOf("ocean")], ["pulse", realPulse]] as const) {
      const ids = activeRules(m, simulate(m, base, base)).map((r) => r.id);
      expect(ids.every((id) => /healthy|normal/.test(id))).toBe(true);
    }
  });
  it("combining sliders fires combined rules (heat + drought)", () => {
    const base = baselineOf("forest");
    const ids = activeRules("forest", simulate("forest", { ...base, temp: 4, rain: 40, humidity: 45, soil: 35 })).map((r) => r.id);
    expect(ids[0]).toBe("forest-heat-drought");
    const ocean = baselineOf("ocean");
    expect(activeRules("ocean", simulate("ocean", { ...ocean, sst: 2, nutrients: 260 })).map((r) => r.id)).toContain("ocean-heat-runoff");
  });
  it("a stressed forest sounds lower and plays the falling figure", () => {
    const base = baselineOf("forest");
    const fx = combinedSound(activeRules("forest", simulate("forest", { ...base, rain: 20, soil: 10 })));
    expect(fx.notes).toBeLessThan(0);
    expect(fx.fall).toBe(true);
  });
});

describe("lab loop: real-time shaping", () => {
  const f = labFrames({ NDVI: 0.6 }, "NDVI", 1)[0];
  it("REAL mode keeps the data note at the centre of the phrase", () => {
    expect(noteIndex(shapeFrame(f, 0, NO_FX).pitch!)).toBe(noteIndex(f.pitch!));
    expect(noteIndex(shapeFrame(f, 4, NO_FX).pitch!)).toBe(noteIndex(f.pitch!) + PHRASE[4]);
  });
  it("lower data → lower phrase; rule responses move it further down", () => {
    const low = labFrames({ NDVI: 0.3 }, "NDVI", 1)[0];
    expect(shapeFrame(low, 0, NO_FX).pitch!).toBeLessThan(shapeFrame(f, 0, NO_FX).pitch!);
    const fx = { ...NO_FX, notes: -2, fall: true };
    expect(shapeFrame(f, 0, fx).pitch!).toBeLessThan(shapeFrame(f, 0, NO_FX).pitch!);
    expect(shapeFrame(f, 0, fx).drop).toBe(true);
    expect(shapeFrame(f, 1, fx).drop).toBe(false);
  });
});
