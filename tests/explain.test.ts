import { describe, expect, it } from "vitest";
import { changedVariables, describeSound, explainCombination } from "../src/lab/explain";
import { activeRules, combinedSound } from "../src/lab/scenarios";
import { baselineOf, simulate } from "../src/lab/simulation";
import { NO_FX } from "../src/audio/labLoop";

const run = (exp: "forest" | "ocean" | "pulse", over: Record<string, number>, real: Record<string, number> = {}) => {
  const base = baselineOf(exp, real);
  const v = { ...base, ...over };
  const rules = activeRules(exp, simulate(exp, v, base));
  return explainCombination(exp, v, base, rules, combinedSound(rules));
};

describe("Luna's combined lab explanation", () => {
  it("at the real values she invites the child to try something", () => {
    expect(run("forest", {}).text).toMatch(/real values/);
  });
  it("one slider: names it, the effect and the sound, and says it's pretend", () => {
    const e = run("forest", { rain: 20, soil: 15 });
    expect(e.text).toMatch(/less rain/);
    expect(e.text).toMatch(/So the tune/);
    expect(e.text).toMatch(/pretend/);
  });
  it("three sliders: every changed variable is named, not just the strongest rule", () => {
    const e = run("forest", { temp: 4, rain: 40, co2: 840 });
    expect(e.text).toMatch(/more heat/);
    expect(e.text).toMatch(/less rain/);
    expect(e.text).toMatch(/CO₂/);
    expect(e.changed).toHaveLength(3);
    expect(e.text).toMatch(/could|may|might/);
  });
  it("Earth's Pulse starts from real POWER values and names sun + storms together", () => {
    const e = run("pulse", { sun: 4, storms: 2.6 }, { temp: 25.5, rain: 3.2, sun: 19 });
    expect(e.text).toMatch(/less sunshine/);
    expect(e.text).toMatch(/stronger storms/);
  });
  it("tiny moves (under one step) are not reported as changes", () => {
    const base = baselineOf("ocean");
    expect(changedVariables("ocean", { ...base, sst: base.sst + 0.05 }, base)).toHaveLength(0);
  });
  it("sound sentence follows the combined responses", () => {
    expect(describeSound({ ...NO_FX, notes: -2, tempo: 0.8, fall: true })).toBe("So the tune goes lower, slows down and plays a falling “uh-oh” tune.");
    expect(describeSound(NO_FX)).toMatch(/close to the real tune/);
  });
});
