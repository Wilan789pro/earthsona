import config from "../../scripts/regions.json";
import type { ExperienceId, RegionDef, SeriesDef } from "./types";

/** Same config file the pre-fetch script reads, so app and bundled data never drift apart. */
export const REGIONS: RegionDef[] = config.regions as RegionDef[];

export interface ExperienceDef {
  id: ExperienceId;
  title: string;
  tagline: string;
  regions: string[];
  series: SeriesDef[];
  eic: { svsId: number; itemTitle?: string };
}

const META: Record<ExperienceId, { title: string; tagline: string }> = {
  ocean: { title: "Ocean Symphony", tagline: "Sea surface temperature as a warm-to-cool melody" },
  forest: { title: "Forest Voices", tagline: "Vegetation greenness (NDVI) as a breathing chord" },
  pulse: { title: "Earth's Pulse", tagline: "Air temperature and rainfall as the planet's heartbeat" },
};

export const EXPERIENCES: ExperienceDef[] = (["ocean", "forest", "pulse"] as ExperienceId[]).map((id) => {
  const e = (config.experiences as Record<string, { regions: string[]; series: SeriesDef[] }>)[id];
  return {
    id,
    ...META[id],
    regions: e.regions,
    series: e.series,
    eic: (config.eic as Record<string, { svsId: number; itemTitle?: string }>)[id],
  };
});

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
    baseline: undefined as unknown as RegionDef["baseline"],
    custom: true,
  };
}
