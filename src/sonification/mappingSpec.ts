import { ABSOLUTE_RANGE } from "./mappings";
import { DROP_THRESHOLD } from "./frames";

/**
 * THE mapping specification: one row per measured variable, saying exactly how it becomes sound.
 * Shown on the Grown-ups → Science page and checked by tests/mappingSpec.test.ts (direction is monotonic,
 * ranges match the code). Every rule is an artistic choice applied to real observations; none claims a
 * physical sound.
 */
export interface MappingRow {
  mission: "ocean" | "forest" | "pulse";
  dataset: string;
  variable: string;
  label: string;
  unit: string;
  /** How the value is normalised to 0..1 before mapping. */
  normalisation: string;
  /** Normalisation range in the variable's unit (fixed, so places and dates are comparable). */
  range: { min: number; max: number };
  parameter: string;
  /** What the lowest and highest value produce. */
  minSound: string;
  maxSound: string;
  /** "up" = a higher value gives more of the parameter (higher pitch, busier, brighter…). */
  direction: "up";
  overTime: string;
}

const drop = (v: string, unit: string) => `A fall of ≥ ${DROP_THRESHOLD[v]} ${unit} since the previous date adds a soft falling two-note figure below the melody.`;

export const MAPPING_SPEC: MappingRow[] = [
  {
    mission: "forest",
    dataset: "NASA MODIS MOD13Q1.061 (Terra, 250 m, 16-day) — team CSV Datasets/EARTHSONA_Mauritius_Vegetation.csv and bundled Black River Gorges series",
    variable: "NDVI",
    label: "Greenness",
    unit: "unitless",
    normalisation: "Global fixed range (default), so the same NDVI is the same note in every place and on every date.",
    range: ABSOLUTE_RANGE.NDVI,
    parameter: "Melody pitch (two-octave pentatonic) · Forest Voices sample pitch (−12…+12 semitones) · forest pad fullness · number of birds/insects in the ambience",
    minSound: "lowest note, thin pad, quiet forest",
    maxSound: "highest note, full pad, lively forest",
    direction: "up",
    overTime: `Each date is one step; the melody rises and falls with greenness and glides between dates in Forest Voices. ${drop("NDVI", "NDVI")}`,
  },
  {
    mission: "forest",
    dataset: "NASA MODIS MOD13Q1.061 (as above)",
    variable: "EVI",
    label: "Leafiness",
    unit: "unitless",
    normalisation: "Global fixed range (default).",
    range: ABSOLUTE_RANGE.EVI,
    parameter: "Harmony richness (octave → fifth → major chord) · Forest Voices sounds per second (0.25–3.0)",
    minSound: "bare octave, slow sparse beats",
    maxSound: "full chord, quick busy beats",
    direction: "up",
    overTime: "When leafiness falls the chord thins out and the beat slows down.",
  },
  {
    mission: "ocean",
    dataset: "NOAA OISST v2.1 (daily, 0.25°), weekly samples",
    variable: "SST",
    label: "Sea temperature",
    unit: "°C",
    normalisation: "Global fixed range −2…32 °C (default).",
    range: ABSOLUTE_RANGE.SST,
    parameter: "Melody pitch · brightness of the waves in the ambience",
    minSound: "low note, dark soft waves",
    maxSound: "high note, bright fizzy waves",
    direction: "up",
    overTime: `Warming seasons climb, cooling seasons fall. ${drop("SST", "°C")}`,
  },
  {
    mission: "ocean",
    dataset: "NOAA OISST v2.1 anomaly (vs. 1971–2000 climatology)",
    variable: "SSTA",
    label: "Warmer or cooler than usual",
    unit: "°C",
    normalisation: "Absolute thresholds: |a| < 0.5 °C calm · 0.5–1.5 °C gentle tension · ≥ 1.5 °C strong tension.",
    range: ABSOLUTE_RANGE.SSTA,
    parameter: "Second voice: fifth → major second → tritone; above the melody when warmer, below when cooler",
    minSound: "calm fifth below the melody",
    maxSound: "tense tritone above the melody",
    direction: "up",
    overTime: "A marine heatwave is heard as growing tension; returning to normal resolves it.",
  },
  {
    mission: "pulse",
    dataset: "NASA POWER (MERRA-2 based), daily / monthly, one point per place — local, not global weather",
    variable: "T2M",
    label: "Air temperature",
    unit: "°C",
    normalisation: "Global fixed range −40…45 °C (default).",
    range: ABSOLUTE_RANGE.T2M,
    parameter: "Melody pitch",
    minSound: "low note",
    maxSound: "high note",
    direction: "up",
    overTime: `Seasons become a slow melody. ${drop("T2M", "°C")}`,
  },
  {
    mission: "pulse",
    dataset: "NASA POWER (as above)",
    variable: "PRECTOTCORR",
    label: "Rain",
    unit: "mm/day",
    normalisation: "Fixed range 0…30 mm/day.",
    range: ABSOLUTE_RANGE.PRECTOTCORR,
    parameter: "Rhythm: 0–4 hits per step · rain loudness and thunder likelihood in the ambience",
    minSound: "no drum hits, dry",
    maxSound: "four hits per step, heavy rain",
    direction: "up",
    overTime: "Wet seasons get busier, dry spells go quiet.",
  },
  {
    mission: "pulse",
    dataset: "NASA POWER (as above)",
    variable: "ALLSKY_SFC_SW_DWN",
    label: "Sunshine",
    unit: "MJ/m²/day",
    normalisation: "Fixed range 0…35 MJ/m²/day.",
    range: ABSOLUTE_RANGE.ALLSKY_SFC_SW_DWN,
    parameter: "Brightness (low-pass filter opens) · more birds in the ambience",
    minSound: "dull, muffled tone",
    maxSound: "bright, sparkling tone",
    direction: "up",
    overTime: "Sunny months sound brighter; cloudy months duller.",
  },
];

/** Map a value to 0..1 exactly as the spec says (used by the tests and the lab). */
export function normaliseBySpec(variable: string, value: number): number {
  const row = MAPPING_SPEC.find((r) => r.variable === variable);
  if (!row) throw new Error(`No mapping for ${variable}`);
  const { min, max } = row.range;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}
