import config from "../../scripts/regions.json";
import type { ExperienceId, PeriodDef, RegionDef } from "./types";
import type { EicRef } from "./eic";

/** Same config file the pre-fetch script reads, so app and bundled data never drift apart. */
export const REGIONS: RegionDef[] = config.regions as RegionDef[];

export interface ExperienceDef {
  id: ExperienceId;
  title: string;
  tagline: string;
  regions: string[];
  periods: PeriodDef[];
  /** Child-friendly one-liner. */
  kid: string;
  /** Short name for the big environment buttons. */
  short: string;
  icon: string;
  eic: EicRef[];
}

const META: Record<ExperienceId, { title: string; tagline: string; kid: string; short: string; icon: string }> = {
  ocean: { title: "Ocean Symphony", short: "Ocean", icon: "🌊", tagline: "Sea surface temperature and its anomaly", kid: "Hear how warm the sea is." },
  forest: { title: "Forest Voices", short: "Forest", icon: "🌳", tagline: "Vegetation greenness (NDVI) and EVI", kid: "Hear how green the forest is." },
  pulse: { title: "Earth's Pulse", short: "Pulse", icon: "💓", tagline: "Air temperature, rainfall and sunlight", kid: "Hear the weather: heat, rain and sun." },
};

export const EXPERIENCES: ExperienceDef[] = (["ocean", "forest", "pulse"] as ExperienceId[]).map((id) => {
  const e = (config.experiences as unknown as Record<string, { regions: string[]; periods: PeriodDef[] }>)[id];
  return {
    id,
    ...META[id],
    regions: e.regions,
    periods: e.periods,
    eic: (config.eic as unknown as Record<string, EicRef[]>)[id] ?? [],
  };
});

export interface ImageryDef {
  layer: string;
  time?: string;
  format: string;
  width: number;
  height: number;
  file: string;
  title: string;
}
export const IMAGERY = config.imagery as unknown as { base: ImageryDef; night: ImageryDef; overlays: Record<ExperienceId, ImageryDef> };

export function getExperience(id: ExperienceId): ExperienceDef {
  return EXPERIENCES.find((e) => e.id === id)!;
}

export function getRegion(id: string): RegionDef | undefined {
  return REGIONS.find((r) => r.id === id);
}

/** A region for an arbitrary clicked / searched point (no bundled data; live or simulated only). */
export function customRegion(lat: number, lon: number, name?: string): RegionDef & { custom: true } {
  const la = Math.round(lat * 100) / 100;
  const lo = Math.round(lon * 100) / 100;
  return {
    id: `point-${la}-${lo}`.replace(/\./g, "_"),
    name: name ?? `${Math.abs(la)}°${la >= 0 ? "N" : "S"}, ${Math.abs(lo)}°${lo >= 0 ? "E" : "W"}`,
    lat: la,
    lon: lo,
    biome: "Selected point",
    context: "A point you selected on the globe. Only data that exists for this exact point is played.",
    baseline: undefined as unknown as RegionDef["baseline"],
    custom: true,
  };
}
