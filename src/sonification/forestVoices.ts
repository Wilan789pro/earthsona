import type { VegetationObservation } from "../data/forestCsv";

/**
 * Forest Voices mapping: real vegetation observations → the team's SuperCollider sound design.
 *
 * The SuperCollider "climate overlap" instrument (supercollider/cultural_sound/*.scd) has two controls:
 *   temperature → pitch: −10 °C = −12 semitones, 20 °C = original pitch, 40 °C = +12 semitones
 *   wind        → sound starts per second: 0 → 0.25/s … 100 → 3.0/s (overlapping, scheduled from each start)
 * For Forest Voices the same instrument is driven by vegetation indices instead (absolute scales, so the
 * same value always sounds the same, in every place and on every date):
 *   NDVI (greenness)   → pitch:   NDVI 0 = −12 st · 0.5 = original pitch · 1.0 = +12 st (linear)
 *   EVI  (leafiness)   → starts per second: EVI 0 = 0.25/s … EVI 1 = 3.0/s (same range as the wind control)
 *   QA "marginal"      → a slightly softer, duller sound (lower confidence is audible, never hidden)
 *   change A → B       → the pitch glides between the two dates, so the melody moves with the data
 * These are artistic choices, not physical laws; they are shown in the app's science section.
 */
export const NDVI_REFERENCE = 0.5;
export const MIN_STARTS = 0.25;
export const MAX_STARTS = 3.0;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const linlin = (x: number, a: number, b: number, c: number, d: number) => c + ((clamp(x, a, b) - a) / (b - a)) * (d - c);

export function ndviToSemitones(ndvi: number): number {
  return ndvi <= NDVI_REFERENCE ? linlin(ndvi, 0, NDVI_REFERENCE, -12, 0) : linlin(ndvi, NDVI_REFERENCE, 1, 0, 12);
}

export function eviToStartsPerSecond(evi: number | null): number {
  return evi === null ? MIN_STARTS : linlin(evi, 0, 1, MIN_STARTS, MAX_STARTS);
}

export interface VoiceParams {
  semitones: number;
  ratio: number;
  startsPerSecond: number;
  gain: number;
  /** Low-pass cut-off in Hz (null = open). */
  tone: number | null;
}

export function voiceFor(o: Pick<VegetationObservation, "ndvi" | "evi" | "summaryQA">): VoiceParams {
  const semitones = ndviToSemitones(o.ndvi);
  const marginal = o.summaryQA === 1;
  return {
    semitones,
    ratio: 2 ** (semitones / 12),
    startsPerSecond: eviToStartsPerSecond(o.evi),
    gain: marginal ? 0.8 : 1,
    tone: marginal ? 7000 : null,
  };
}

/** Plain-language comparison of two real observations (what changed, not why). */
export function describeChange(a: VegetationObservation, b: VegetationObservation): { lines: string[]; pitchSteps: number; tempoChange: number } {
  const va = voiceFor(a);
  const vb = voiceFor(b);
  const pitchSteps = vb.semitones - va.semitones;
  const tempoChange = vb.startsPerSecond - va.startsPerSecond;
  const lines: string[] = [];
  const dN = b.ndvi - a.ndvi;
  lines.push(
    Math.abs(dN) < 0.005
      ? "Greenness (NDVI) stayed about the same, so the notes stay at the same height."
      : `Greenness (NDVI) went ${dN > 0 ? "up" : "down"} from ${a.ndvi.toFixed(2)} to ${b.ndvi.toFixed(2)}, so our forest sound plays ${Math.abs(pitchSteps).toFixed(1)} semitones ${dN > 0 ? "higher" : "lower"}.`,
  );
  if (a.evi !== null && b.evi !== null) {
    const dE = b.evi - a.evi;
    lines.push(
      Math.abs(dE) < 0.005
        ? "Leafiness (EVI) stayed about the same, so the beat keeps the same speed."
        : `Leafiness (EVI) went ${dE > 0 ? "up" : "down"} from ${a.evi.toFixed(2)} to ${b.evi.toFixed(2)}, so the beat gets ${dE > 0 ? "faster" : "slower"} (${va.startsPerSecond.toFixed(1)} → ${vb.startsPerSecond.toFixed(1)} sounds per second).`,
    );
  }
  return { lines, pitchSteps, tempoChange };
}
