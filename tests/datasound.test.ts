import { describe, expect, it } from "vitest";
import { GROOVE_ORDER, grooveDrive, grooveEnergy, groovePattern } from "../src/sonification/mappings";
import { readFileSync } from "node:fs";

describe("all sound comes from the data", () => {
  it("the Sega-inspired groove is fully determined by the data (same data → same rhythm)", () => {
    expect(groovePattern(0)).toEqual([0]); // calm data: only the downbeat
    expect(groovePattern(1)).toEqual([0, 1, 2, 3, 4, 5]); // busy data: all six subdivisions
    expect(groovePattern(0.5)).toEqual(groovePattern(0.5));
    for (let d = 0; d <= 1; d += 0.1) expect(groovePattern(d).length).toBeGreaterThanOrEqual(groovePattern(Math.max(0, d - 0.1)).length);
    expect(GROOVE_ORDER).toHaveLength(6);
  });
  it("groove drive and energy come from the documented variables", () => {
    const f = { pitch: 0.7, density: 0.4, brightness: 0.9, harmony: null };
    expect(grooveDrive("pulse", f)).toBe(0.4); // rain
    expect(grooveEnergy("pulse", f)).toBe(0.9); // sunlight
    expect(grooveDrive("ocean", { ...f, harmony: { kind: "anomaly", anomaly: -1 } })).toBe(0.5); // |SSTA| / 2 °C
    expect(grooveEnergy("ocean", f)).toBe(0.7); // SST level
    expect(grooveDrive("forest", { ...f, harmony: { kind: "chord", level01: 0.6 } })).toBe(0.6); // EVI
  });
  it("no recordings or ambience are wired into playback", () => {
    const engine = readFileSync("src/audio/engine.ts", "utf8");
    expect(engine).not.toMatch(/new CulturalSampler|new Ambience|Math\.random/);
    const fv = readFileSync("src/ui/forestVoices.ts", "utf8");
    expect(fv).not.toMatch(/CulturalSampler|\.wav/);
    const main = readFileSync("src/main.ts", "utf8");
    expect(main).not.toMatch(/CULTURAL\[|from "\.\/audio\/ambience"/);
  });
});
