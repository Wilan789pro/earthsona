import { describe, expect, it } from "vitest";
import { subsolarPoint } from "../src/globe";

describe("real sun position for the day/night globe", () => {
  it("June solstice at 12:00 UTC: Sun over the Tropic of Cancer near Greenwich", () => {
    const p = subsolarPoint(new Date(Date.UTC(2024, 5, 21, 12, 0)));
    expect(p.lat).toBeCloseTo(23.4, 0);
    expect(Math.abs(p.lon)).toBeLessThan(1);
  });
  it("December solstice at 18:00 UTC: Sun over the Tropic of Capricorn, 90° W", () => {
    const p = subsolarPoint(new Date(Date.UTC(2024, 11, 21, 18, 0)));
    expect(p.lat).toBeCloseTo(-23.4, 0);
    expect(p.lon).toBeCloseTo(-90, 0);
  });
});
