import { describe, expect, it } from "vitest";
import { FIRST_CHUNK, splitForSpeech } from "../src/ui/luna";

describe("Luna's speech chunks (fast first audio)", () => {
  it("the first chunk is one short sentence", () => {
    const c = splitForSpeech("Hot AND dry together could make the trees very thirsty. Their leaves may turn brown and fall. Scientists check many dates.");
    expect(c[0]).toBe("Hot AND dry together could make the trees very thirsty.");
    expect(c.join(" ")).toContain("Scientists check many dates.");
  });
  it("a long first sentence is cut at a comma", () => {
    const c = splitForSpeech("Welcome to the Earth Sound Lab, where we start with real measurements from satellites and NASA's weather model, and then try things.");
    expect(c[0].length).toBeLessThanOrEqual(FIRST_CHUNK);
    expect(c.join(" ").replace(/\s+/g, " ")).toBe("Welcome to the Earth Sound Lab, where we start with real measurements from satellites and NASA's weather model, and then try things.");
  });
  it("later chunks stay under ~220 characters", () => {
    const long = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i} about the sea.`).join(" ");
    for (const c of splitForSpeech(long)) expect(c.length).toBeLessThanOrEqual(230);
  });
});
