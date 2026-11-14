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
      "An original arrangement with a 6/8 (ternary) swing inspired by traditional Mauritian Sega. " +
      "Where the team's own recordings exist they are used; otherwise the beat is played by simple SYNTHESISED stand-in sounds " +
      "(filtered noise, a low thump, a high ting). These are not real ravann, maravann or triangle sounds, not Sega recordings, and reproduce no song.",
    regions: ["sega"],
    instruments: [
      { name: "Plucked melody", role: "pitch (data)" },
      { name: "Soft second voice", role: "harmony (data)" },
      { name: "Shaker-style noise bursts (synthesised stand-in, not a real maravann)", role: "rhythmic density (data): more rain = more shakes" },
      { name: "High metallic ting (synthesised stand-in, not a real triangle)", role: "brightness (data) when a sunlight layer exists; otherwise a quiet time-keeper" },
      { name: "Low thump and slap (synthesised stand-in, not a real ravann; ocean and weather)", role: "arrangement only: marks the beat, does NOT carry data" },
      { name: "Soft wooden taps (synthesised; forest, a subtler accent)", role: "arrangement only: marks the beat, does NOT carry data" },
    ],
    arrangement:
      "A ternary (compound, 6/8-style) groove: each data step is one beat divided in three; the low thump accents the first beat of every two steps. " +
      "In the forest it is replaced by soft wooden taps so the regional accent stays subtle. The regional layer is mixed below the natural soundscape. " +
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
