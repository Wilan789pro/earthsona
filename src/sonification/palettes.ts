/**
 * Sound palettes. A palette chooses INSTRUMENTS and the RHYTHMIC ARRANGEMENT only. It never changes what a
 * data value means: pitch, harmony, density, brightness and texture rules live in mappings.ts and are
 * identical for every palette.
 */
export type PaletteId = "neutral" | "sega";

export interface Palette {
  id: PaletteId;
  name: string;
  short: string;
  description: string;
  /** Places (region `music` tag) this palette is offered for. Empty = everywhere. */
  regions: string[];
  instruments: { name: string; role: string }[];
  arrangement: string;
  references: { label: string; url: string }[];
  disclaimer?: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  neutral: {
    id: "neutral",
    name: "Neutral scientific",
    short: "Neutral",
    description: "Plain synthesised tones with no cultural styling. Every sound you hear comes from the data.",
    regions: [],
    instruments: [
      { name: "Sine/triangle melody", role: "pitch (data)" },
      { name: "Soft sine second voice", role: "harmony (data)" },
      { name: "Soft ticks", role: "rhythmic density (data)" },
      { name: "Filtered pad", role: "texture (data)" },
    ],
    arrangement: "None. Silence between notes means the data step has ended.",
    references: [],
  },
  sega: {
    id: "sega",
    name: "Mauritius — Sega-inspired",
    short: "Sega-inspired",
    description:
      "An original, programmatically generated 6/8 (ternary) groove inspired by traditional Mauritian Sega, driven entirely by the data: " +
      "how many beats play, how strong and bright they are, and the drum's pitch all follow the measurements. " +
      "It uses simple synthesised sounds (a tuned low drum and shaker-style noise), not real ravann or maravann sounds, no recordings, and reproduces no song.",
    regions: ["sega"],
    instruments: [
      { name: "Plucked melody", role: "pitch (data)" },
      { name: "Soft second voice", role: "harmony (data)" },
      { name: "Groove density: 1–6 of the six 6/8 subdivisions (synthesised, not a real maravann)", role: "rhythmic density (data): rain (Earth's Pulse), size of the SST anomaly (ocean), EVI (forest)" },
      { name: "Shaker-style noise brightness and drum strength (synthesised, not a real ravann)", role: "brightness (data): sunlight (Earth's Pulse), SST (ocean), NDVI (forest)" },
      { name: "Low tuned drum (synthesised, not a real ravann)", role: "pitch (data): tuned to the data note, a few octaves down" },
    ],
    arrangement:
      "Each data step is one 6/8 bar of six subdivisions, filled in a fixed order (1, 4, 6, 3, 5, 2) as the data rises: calm data plays only the downbeat, " +
      "busy data fills all six. A missing measurement silences the groove. Same data → same rhythm (no randomness, no loop). " +
      "This metre is our design choice for an original interpretation and should be reviewed with Mauritian musicians.",
    references: [
      { label: "National Heritage Fund (Mauritius) — Sega Tipik Morisien: main instruments ravan, maravan and triang", url: "https://nhf.govmu.org/nhf/?page_id=723" },
      { label: "UNESCO — Traditional Mauritian Sega (frame drum, box rattle and triangle keep time); inscribed 2014", url: "https://www.unesco.org/archives/multimedia/document-3665" },
      { label: "UNESCO Intangible Cultural Heritage — Traditional Mauritian Sega (element 01003)", url: "https://ich.unesco.org/en/RL/traditional-mauritian-sega-01003" },
    ],
    disclaimer:
      "Sega is living heritage of the Creole community and of Mauritius. This palette is a respectful, synthesised homage built by the team; " +
      "it is offered only for places in Mauritius and should be reviewed by Mauritian practitioners before public use.",
  },
};

export function palettesFor(music?: string): Palette[] {
  return Object.values(PALETTES).filter((p) => p.regions.length === 0 || (music !== undefined && p.regions.includes(music)));
}
