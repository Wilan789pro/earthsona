import type { ExperienceId, SoundRole } from "../data/types";

/**
 * THE documented data → sound mapping. Everything that turns a measurement into sound goes through here.
 *
 * Rules that never change between sound palettes (neutral / regional):
 *   pitch       value → note on a two-octave pentatonic scale (higher value = higher note)
 *   harmony     variable-specific second voice (see HARMONY_RULES)
 *   density     value → number of rhythmic hits in the step (0 … 4)
 *   brightness  value → tone colour (low-pass filter opens; regional palettes also raise their bright
 *               percussion), i.e. "more = brighter"
 *   texture     value → sustained pad: fuller and brighter for higher values
 * Palettes choose instruments and the rhythmic arrangement only (src/sonification/palettes.ts).
 */

/** Absolute ranges used by the "Global scale" pitch mode and the Earth Sound Lab. Same value → same note
 *  everywhere. Chosen to cover the realistic range of each variable at the surface. */
export const ABSOLUTE_RANGE: Record<string, { min: number; max: number }> = {
  T2M: { min: -40, max: 45 },
  PRECTOTCORR: { min: 0, max: 30 },
  ALLSKY_SFC_SW_DWN: { min: 0, max: 35 },
  NDVI: { min: -0.2, max: 1 },
  EVI: { min: -0.2, max: 1 },
  SST: { min: -2, max: 32 },
  SSTA: { min: -3, max: 3 },
  /** NASA GISTEMP global annual anomaly (°C vs 1951–1980): the separate "whole planet" track. */
  GISTEMP: { min: -1, max: 2 },
};

/** Scale per experience: shared by every palette so a value always lands on the same note. */
export const SCALES: Record<ExperienceId, { root: number; steps: number[]; name: string }> = {
  ocean: { root: 196.0, steps: [0, 2, 4, 7, 9], name: "G major pentatonic" },
  forest: { root: 220.0, steps: [0, 2, 4, 7, 9], name: "A major pentatonic" },
  pulse: { root: 130.81, steps: [0, 3, 5, 7, 10], name: "C minor pentatonic" },
};
export const OCTAVES = 2;

/** Number of distinct notes available (two octaves of a 5-note scale, plus the top octave note). */
export const NOTE_COUNT = 5 * OCTAVES + 1;

export function noteIndex(level01: number): number {
  return Math.min(NOTE_COUNT - 1, Math.max(0, Math.round(level01 * (NOTE_COUNT - 1))));
}

export function noteFrequency(exp: ExperienceId, index: number): number {
  const s = SCALES[exp];
  const octave = Math.floor(index / s.steps.length);
  const semis = index >= NOTE_COUNT - 1 ? 12 * OCTAVES : s.steps[index % s.steps.length] + 12 * octave;
  return s.root * 2 ** (semis / 12);
}

export const NOTE_NAMES_C = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
/**
 * The melody's pitch is CONTINUOUS over three octaves: every real change in the measurement moves the pitch
 * (no rounding to a few notes), and the same value gives the same pitch at every place (fixed global range).
 * Level 0 = MELODY_LOW[exp], level 1 = three octaves higher.
 */
export const MELODY_OCTAVES = 3;
export const MELODY_LOW: Record<ExperienceId, number> = { ocean: 98.0, forest: 110.0, pulse: 82.41 };
export function pitchFrequency(exp: ExperienceId, level01: number): number {
  const l = Math.min(1, Math.max(0, level01));
  return MELODY_LOW[exp] * 2 ** (l * MELODY_OCTAVES);
}
/** Pitch difference in semitones between two levels (for "higher / lower than last time"). */
export function semitonesBetween(a01: number, b01: number): number {
  return (b01 - a01) * 12 * MELODY_OCTAVES;
}

/**
 * Sega-inspired 6/8 groove (Mauritius places only), generated from the data, never a loop or a recording.
 *  drive  → how many of the 6 subdivisions play (1…6): ocean = size of the SST anomaly (0…2 °C),
 *           forest = EVI level, Earth's Pulse = rain level.
 *  energy → drum intensity and shaker brightness: ocean = SST level, forest = NDVI level, pulse = sunlight level.
 *  The drum's pitch follows the melody (the data note). No measurement → no groove (only the no-data tick).
 */
export const GROOVE_ORDER = [0, 3, 5, 2, 4, 1];
export interface GrooveInput {
  pitch: number | null;
  density: number | null;
  brightness: number | null;
  harmony: HarmonyFrame | null;
}
export function grooveDrive(exp: ExperienceId, f: GrooveInput): number {
  const c = (x: number) => Math.min(1, Math.max(0, x));
  if (exp === "pulse") return c(f.density ?? 0);
  if (exp === "ocean") return f.harmony?.kind === "anomaly" ? c(Math.abs(f.harmony.anomaly) / 2) : 0;
  return f.harmony?.kind === "chord" ? c(f.harmony.level01) : 0;
}
export function grooveEnergy(exp: ExperienceId, f: GrooveInput): number {
  const c = (x: number) => Math.min(1, Math.max(0, x));
  return exp === "pulse" ? c(f.brightness ?? 0.4) : c(f.pitch ?? 0);
}
/** Which of the six 6/8 subdivisions sound for a drive level (deterministic: same data, same rhythm). */
export function groovePattern(drive: number): number[] {
  const n = 1 + Math.round(Math.min(1, Math.max(0, drive)) * 5);
  return GROOVE_ORDER.slice(0, n).sort((a, b) => a - b);
}

export function noteName(freq: number): string {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return `${NOTE_NAMES_C[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Rhythmic density: value 0..1 → hits per step. */
export function densityHits(level01: number): number {
  return Math.min(4, Math.max(0, Math.round(level01 * 4)));
}

/**
 * Harmony rules.
 *  SSTA (anomaly, °C, ABSOLUTE thresholds so the meaning never depends on the place):
 *     |a| < 0.5 °C   → perfect fifth (calm, close to the dataset's baseline)
 *     0.5 – 1.5 °C   → major second (gentle tension)
 *     ≥ 1.5 °C       → tritone (strong tension)
 *     positive anomaly → the second voice sits ABOVE the melody; negative → BELOW.
 *  EVI (on the chosen pitch scale, global by default): low → bare octave, middle → fifth, high → major-third + fifth (richer chord).
 */
export type HarmonyFrame = { kind: "anomaly"; anomaly: number } | { kind: "chord"; level01: number };

export function harmonyIntervals(h: HarmonyFrame): { semitones: number[]; label: string } {
  if (h.kind === "anomaly") {
    const a = Math.abs(h.anomaly);
    const dir = h.anomaly >= 0 ? 1 : -1;
    if (a < 0.5) return { semitones: [7 * dir], label: "calm fifth (near baseline)" };
    if (a < 1.5) return { semitones: [2 * dir + (dir < 0 ? -12 : 12)], label: `gentle tension (${h.anomaly > 0 ? "warmer" : "cooler"} than baseline)` };
    return { semitones: [6 * dir + (dir < 0 ? -12 : 12)], label: `strong tension (${h.anomaly > 0 ? "much warmer" : "much cooler"} than baseline)` };
  }
  if (h.level01 < 0.34) return { semitones: [12], label: "thin octave (low EVI)" };
  if (h.level01 < 0.67) return { semitones: [7], label: "open fifth (medium EVI)" };
  return { semitones: [4, 7], label: "full chord (high EVI)" };
}

export interface RoleDoc {
  role: SoundRole;
  youHear: string;
  rule: string;
}

export const ROLE_DOCS: Record<SoundRole, RoleDoc> = {
  pitch: { role: "pitch", youHear: "Melody note: higher or lower", rule: "Value → continuous pitch over three octaves on one fixed range for every place. Higher value = higher note; even small real changes move the pitch, and the note glides from the previous date." },
  harmony: { role: "harmony", youHear: "A second, softer voice", rule: "Variable-specific: anomaly → how calm or tense the interval sounds; EVI → how full the chord is." },
  density: { role: "density", youHear: "How many rhythmic hits per note", rule: "Value → 0 to 4 hits per step. More rain = busier rhythm." },
  brightness: { role: "brightness", youHear: "Tone colour: darker or brighter", rule: "Value → filter opens and bright percussion rises. More sunlight = brighter sound." },
  texture: { role: "texture", youHear: "A sustained background pad", rule: "Value → pad gets fuller and brighter. Greener = richer pad." },
};

/** Per-variable wording used in "What you heard". */
export const VARIABLE_WORDS: Record<string, { short: string; more: string; less: string }> = {
  T2M: { short: "air temperature", more: "warmer", less: "cooler" },
  PRECTOTCORR: { short: "rainfall", more: "wetter", less: "drier" },
  ALLSKY_SFC_SW_DWN: { short: "sunlight at the surface", more: "sunnier", less: "cloudier or darker" },
  NDVI: { short: "vegetation greenness (NDVI)", more: "greener", less: "less green" },
  EVI: { short: "enhanced vegetation index (EVI)", more: "denser canopy signal", less: "weaker canopy signal" },
  SST: { short: "sea surface temperature", more: "warmer water", less: "cooler water" },
  SSTA: { short: "sea surface temperature anomaly", more: "warmer than baseline", less: "cooler than baseline" },
};

/** Interpretation limits shown after listening. */
export const LIMITATIONS: Record<string, string> = {
  T2M: "POWER values are model-based estimates (MERRA-2) for a grid cell of about 0.5° × 0.625°, not a single thermometer.",
  PRECTOTCORR: "Rainfall is a bias-corrected grid-cell estimate; local showers can differ a lot from the cell average.",
  ALLSKY_SFC_SW_DWN: "Sunlight is a daily total for the grid cell; clouds reduce it, so it partly reflects cloudiness.",
  NDVI: "NDVI measures greenness, not the number of trees. Seasons, clouds and land use all change it; cloudy or snowy composites are removed.",
  EVI: "EVI is less saturated than NDVI over dense forest but is still a greenness index, not a direct measure of forest health or deforestation.",
  SST: "MUR SST is a gap-filled analysis of the ocean's foundation temperature (about 1 km), sampled weekly here.",
  SSTA: "The anomaly is relative to the dataset's own climatological baseline; it is not a forecast.",
};
