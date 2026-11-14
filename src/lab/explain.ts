import type { ExperienceId } from "../data/types";
import { VARS, type Values } from "./simulation";
import type { Rule, SoundResponse } from "./scenarios";

/**
 * Luna's COMBINED explanation for the Earth Sound Lab: it names every slider the child changed (compared with
 * the real starting values), the effects of ALL active rules together, and what that does to the sound.
 * Deterministic and short; hedged words only ("could", "may"); always ends by saying it is pretend.
 */
const WORDS: Record<string, [up: string, down: string]> = {
  "forest.sun": ["more sunshine", "less sunshine"],
  "forest.rain": ["more rain", "less rain"],
  "forest.humidity": ["damper air", "drier air"],
  "forest.temp": ["more heat", "less heat"],
  "forest.co2": ["more CO₂", "less CO₂"],
  "forest.soil": ["wetter soil", "drier soil"],
  "ocean.sst": ["warmer water", "cooler water"],
  "ocean.ph": ["less acidic water", "more acidic water"],
  "ocean.oxygen": ["more oxygen", "less oxygen"],
  "ocean.pollution": ["more rubbish", "less rubbish"],
  "ocean.nutrients": ["more plant food", "less plant food"],
  "ocean.reef": ["a healthier reef", "a weaker reef"],
  "pulse.temp": ["more heat", "less heat"],
  "pulse.rain": ["more rain", "less rain"],
  "pulse.sun": ["more sunshine", "less sunshine"],
  "pulse.co2": ["more CO₂", "less CO₂"],
  "pulse.veg": ["more plants", "fewer plants"],
  "pulse.storms": ["stronger storms", "calmer weather"],
};

export interface Change {
  key: string;
  label: string;
  words: string;
  direction: 1 | -1;
  /** 0..1: how far towards the slider's end the change goes. */
  size: number;
}

/** Every slider that moved noticeably away from the real start (≥ 1 step and ≥ 4 % of its range). */
export function changedVariables(exp: ExperienceId, v: Values, base: Values): Change[] {
  return VARS[exp]
    .map((d) => {
      const diff = v[d.key] - base[d.key];
      const room = diff > 0 ? d.max - base[d.key] : base[d.key] - d.min;
      if (Math.abs(diff) < Math.max(d.step, (d.max - d.min) * 0.04) || room <= 0) return null;
      const direction = (diff > 0 ? 1 : -1) as 1 | -1;
      const size = Math.min(1, Math.abs(diff) / room);
      const w = WORDS[`${exp}.${d.key}`] ?? [`more ${d.label.toLowerCase()}`, `less ${d.label.toLowerCase()}`];
      const word = w[direction > 0 ? 0 : 1];
      const big = word.startsWith("a ") ? `a much ${word.slice(2)}` : word.startsWith("fewer") ? `far ${word}` : `much ${word}`;
      return { key: d.key, label: d.label, direction, size, words: size > 0.55 ? big : word };
    })
    .filter((c): c is Change => c !== null);
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const firstSentence = (s: string) => (s.match(/^[^.!?]+[.!?]/)?.[0] ?? s).trim();

/** What the combined sound responses do, in plain words. `pitchShift` = semitones the data note itself moved. */
export function describeSound(fx: Required<Omit<SoundResponse, "text">>, pitchShift = 0): string {
  // each phrase completes "the tune …"
  const parts: string[] = [];
  const notes = fx.notes * 2 + pitchShift;
  if (notes <= -0.5) parts.push("goes lower");
  else if (notes >= 0.5) parts.push("goes higher");
  if (fx.tempo < 0.95) parts.push("slows down");
  else if (fx.tempo > 1.05) parts.push("speeds up");
  if (fx.busy < 0.8) parts.push("has fewer beats");
  else if (fx.busy > 1.2) parts.push("has busier beats");
  if (fx.bright < 0.85) parts.push("sounds darker");
  else if (fx.bright > 1.15) parts.push("sounds brighter");
  if (fx.tension >= 0.25) parts.push("gets a tense chord");
  if (fx.fall) parts.push("plays a falling “uh-oh” tune");
  if (!parts.length) return "The music stays close to the real tune.";
  return `So the tune ${list(parts)}.`;
}

export function explainCombination(
  exp: ExperienceId,
  v: Values,
  base: Values,
  rules: Rule[],
  fx: Required<Omit<SoundResponse, "text">>,
  pitchShift = 0,
): { text: string; mood: Rule["mood"]; changed: Change[] } {
  const changed = changedVariables(exp, v, base);
  if (!changed.length) return { text: "Everything is at the real values. Move a slider to try a pretend change!", mood: "happy", changed };
  const what = `You picked ${list(changed.map((c) => c.words))}.`;
  const serious = rules.filter((r) => !/healthy|normal/.test(r.id));
  let effect: string;
  if (!serious.length) effect = "Together, that still stays close to normal here.";
  else if (serious.length === 1) effect = `Together, ${lowerFirst(firstSentence(serious[0].kid))}`;
  else effect = `Together, ${lowerFirst(firstSentence(serious[0].kid))} And ${lowerFirst(firstSentence(serious[1].kid))}`;
  const text = `${what} ${effect} ${describeSound(fx, pitchShift)} This is a pretend world, not a real measurement.`;
  return { text, mood: serious[0]?.mood ?? "happy", changed };
}

function lowerFirst(s: string): string {
  // keep "CO₂", "AND" etc. as they are; only lower an ordinary first word
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}
