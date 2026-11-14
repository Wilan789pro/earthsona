import type { ExperienceId } from "../data/types";
import type { SimResult } from "./simulation";

/**
 * The WHAT IF? scenario engine: a list of documented rules evaluated on the simulation's stress levels
 * (SimResult.metrics, all 0–1). Each rule states its condition (thresholds), the consequence, a kid
 * explanation in hedged words ("could", "may"), how the picture and the sound respond, and a source for the
 * underlying relationship. Several rules can be active at once (multi-slider combinations). The rules
 * describe plausible tendencies from the cited sources, never predictions, and never invent causal links:
 * a rule only fires on the variables its source relates.
 */
export interface SoundResponse {
  /** Plain description shown in the lab. */
  text: string;
  /** Moves the melody down (negative) or up (positive), in notes of the scale. */
  notes?: number;
  /** Multiplies the beat (rain hits). */
  busy?: number;
  /** Multiplies brightness (tone colour). */
  bright?: number;
  /** Adds a tense harmony (0–1). */
  tension?: number;
  /** Plays the falling "uh-oh" figure. */
  fall?: boolean;
  /** Multiplies the tempo of the lab loop. */
  tempo?: number;
}

export interface Rule {
  id: string;
  mission: ExperienceId;
  /** Human-readable condition, e.g. "drought > 0.3 and heat > 0.25". */
  condition: string;
  when: (m: Record<string, number>) => boolean;
  /** Higher = shown first and used by Luna. */
  weight: number;
  consequence: string;
  kid: string;
  visual: string;
  sound: SoundResponse;
  source: { label: string; url: string };
  mood: "concerned" | "happy" | "thoughtful" | "surprised";
}

const IPCC_WG1 = { label: "IPCC AR6 WGI, Summary for Policymakers", url: "https://www.ipcc.ch/report/ar6/wg1/chapter/summary-for-policymakers/" };
const IPCC_WG2_ECO = { label: "IPCC AR6 WGII, Ch. 2 (ecosystems)", url: "https://www.ipcc.ch/report/ar6/wg2/chapter/chapter-2/" };
const NASA_DROUGHT = { label: "NASA Earth Observatory: Drought", url: "https://earthobservatory.nasa.gov/features/Drought" };
const NASA_PHOTO = { label: "NASA Earth Observatory: Photosynthesis", url: "https://earthobservatory.nasa.gov/features/Photosynthesis" };
const NASA_CARBON = { label: "NASA Earth Observatory: The Carbon Cycle", url: "https://earthobservatory.nasa.gov/features/CarbonCycle" };
const NASA_VEG = { label: "NASA Earth Observatory: Measuring Vegetation (NDVI)", url: "https://earthobservatory.nasa.gov/features/MeasuringVegetation" };
const CRW = { label: "NOAA Coral Reef Watch: Degree Heating Weeks", url: "https://coralreefwatch.noaa.gov/product/5km/index_5km_dhw.php" };
const NOAA_BLEACH = { label: "NOAA Ocean Service: What is coral bleaching?", url: "https://oceanservice.noaa.gov/facts/coral_bleach.html" };
const NOAA_OA = { label: "NOAA Ocean Service: Ocean acidification", url: "https://oceanservice.noaa.gov/facts/acidification.html" };
const NOAA_HYPOXIA = { label: "NOAA Ocean Service: Hypoxia", url: "https://oceanservice.noaa.gov/hazards/hypoxia/" };
const NOAA_HAB = { label: "NOAA Ocean Service: Harmful algal blooms", url: "https://oceanservice.noaa.gov/hazards/hab/" };
const NOAA_DEBRIS = { label: "NOAA Marine Debris Program", url: "https://marinedebris.noaa.gov/" };
const WHO_HEAT = { label: "WHO: Climate change, heat and health", url: "https://www.who.int/news-room/fact-sheets/detail/climate-change-heat-and-health" };
const NOAA_CO2 = { label: "NOAA Climate.gov: Atmospheric carbon dioxide", url: "https://www.climate.gov/news-features/understanding-climate/climate-change-atmospheric-carbon-dioxide" };

export const RULES: Rule[] = [
  // ---------------- Forest ----------------
  {
    id: "forest-heat-drought", mission: "forest", weight: 10, mood: "concerned",
    condition: "drought > 0.25 and heat stress > 0.25",
    when: (m) => m.drought > 0.25 && m.heat > 0.25,
    consequence: "Heat raises water loss from leaves and soil while less water arrives; trees close their pores, growth stops and leaves may brown and drop.",
    kid: "Hot AND dry together could make the trees very thirsty. Their leaves may turn brown and fall.",
    visual: "Leaves turn brown and fall; the soil cracks.",
    sound: { text: "The tune drops lower, slows down and sounds tense.", notes: -3, tempo: 0.8, tension: 0.8, fall: true },
    source: IPCC_WG2_ECO,
  },
  {
    id: "forest-drought", mission: "forest", weight: 8, mood: "concerned",
    condition: "drought > 0.3",
    when: (m) => m.drought > 0.3 && m.heat <= 0.25,
    consequence: "With less water reaching the roots, soil dries and leaves wilt and yellow.",
    kid: "Without enough rain, the soil may dry out and the leaves could droop and fall.",
    visual: "Leaves wilt and some fall; the ground turns pale.",
    sound: { text: "Lower notes and fewer beats.", notes: -2, busy: 0.5, fall: true },
    source: NASA_DROUGHT,
  },
  {
    id: "forest-heat", mission: "forest", weight: 7, mood: "concerned",
    condition: "heat stress > 0.3",
    when: (m) => m.heat > 0.3 && m.drought <= 0.25,
    consequence: "Above the plants' comfortable range, photosynthesis slows even with water available.",
    kid: "Too much heat could make the plants tired, so they may grow more slowly.",
    visual: "An orange heat glow over the forest.",
    sound: { text: "A tense, shimmering harmony.", tension: 0.6, bright: 1.2 },
    source: IPCC_WG2_ECO,
  },
  {
    id: "forest-waterlog", mission: "forest", weight: 6, mood: "thoughtful",
    condition: "waterlogging > 0.3",
    when: (m) => m.waterlog > 0.3,
    consequence: "Waterlogged soil pushes air out of the ground, so roots can't breathe.",
    kid: "Too much water might fill the soil so the roots can't breathe. Plants need air too!",
    visual: "Puddles cover the ground.",
    sound: { text: "A muffled, darker sound.", bright: 0.5 },
    source: NASA_VEG,
  },
  {
    id: "forest-dim", mission: "forest", weight: 5, mood: "thoughtful",
    condition: "sunlight < 60 % of normal",
    when: (m) => m.dim > 0,
    consequence: "Dim light limits photosynthesis, so the canopy thins and growth slows.",
    kid: "Plants make their food from sunlight. With less sun, they may grow more slowly.",
    visual: "The sun shrinks and the sky darkens.",
    sound: { text: "A duller, quieter tone.", bright: 0.6, notes: -1 },
    source: NASA_PHOTO,
  },
  {
    id: "forest-co2-limited", mission: "forest", weight: 4, mood: "thoughtful",
    condition: "CO₂ > 500 ppm and (drought > 0.3 or heat > 0.3)",
    when: (m) => m.co2 > 0.14 && (m.drought > 0.3 || m.heat > 0.3),
    consequence: "Extra CO₂ could feed photosynthesis, but water and heat limits stop the forest using it.",
    kid: "More CO₂ might help plants grow, but not when they are too hot or thirsty.",
    visual: "No extra growth appears.",
    sound: { text: "No brighter sound: the boost is blocked.", bright: 1 },
    source: IPCC_WG2_ECO,
  },
  {
    id: "forest-co2-boost", mission: "forest", weight: 3, mood: "surprised",
    condition: "CO₂ > 500 ppm with enough water and mild temperature",
    when: (m) => m.co2 > 0.14 && m.drought <= 0.3 && m.heat <= 0.3,
    consequence: "A modest growth boost and slightly better water use, because water, light and temperature are not limiting.",
    kid: "Here the plants may grow a little more with extra CO₂, because they have water and the heat is OK.",
    visual: "Slightly fuller tree crowns.",
    sound: { text: "A slightly brighter sound.", bright: 1.15 },
    source: IPCC_WG2_ECO,
  },
  {
    id: "forest-healthy", mission: "forest", weight: 1, mood: "happy",
    condition: "health ≥ 0.75",
    when: (m) => m.health >= 0.75,
    consequence: "Conditions are close to normal, so the forest stays green and active.",
    kid: "The forest looks happy and green! Birds are singing.",
    visual: "New leaves sprout and birds fly.",
    sound: { text: "Bright notes and a full chord.", bright: 1.1, notes: 1 },
    source: NASA_VEG,
  },
  // ---------------- Ocean ----------------
  {
    id: "ocean-heat-runoff", mission: "ocean", weight: 10, mood: "concerned",
    condition: "bleaching risk > 0.3 and runoff (nutrients > 160 %)",
    when: (m) => m.bleach > 0.3 && m.runoff > 0,
    consequence: "Heat makes corals expel their algae while extra nutrients feed seaweed that can crowd them out.",
    kid: "Warm water AND too much plant food could be double trouble: corals may lose their colours and seaweed could grow over them.",
    visual: "Corals fade to white and green seaweed spreads.",
    sound: { text: "Very tense harmony and a falling tune.", tension: 1, notes: -2, fall: true },
    source: NOAA_BLEACH,
  },
  {
    id: "ocean-bleach", mission: "ocean", weight: 9, mood: "concerned",
    condition: "sea about ≥ 1 °C above normal for weeks (bleaching risk > 0.3)",
    when: (m) => m.bleach > 0.3 && m.runoff <= 0,
    consequence: "Water this warm for weeks causes thermal stress: corals expel their algae and turn white.",
    kid: "When the sea stays too warm, corals may lose their colourful algae and turn white. That's called bleaching.",
    visual: "The corals turn pale, then white; fewer fish.",
    sound: { text: "A tense harmony; the notes thin out.", tension: 0.9, busy: 0.6 },
    source: CRW,
  },
  {
    id: "ocean-acid", mission: "ocean", weight: 7, mood: "concerned",
    condition: "pH below ≈ 7.93 (acidity > 0.3)",
    when: (m) => m.acid > 0.3,
    consequence: "More acidic water makes it harder for corals and shellfish to build shells and skeletons.",
    kid: "More acidic water could make it harder for corals and shellfish to build their homes and shells.",
    visual: "Coral branches become thinner.",
    sound: { text: "Thinner, quieter notes.", bright: 0.7, busy: 0.7 },
    source: NOAA_OA,
  },
  {
    id: "ocean-dead-zone", mission: "ocean", weight: 8, mood: "concerned",
    condition: "algal bloom > 0.3 and low oxygen > 0.3",
    when: (m) => m.bloom > 0.3 && m.hypoxia > 0.3,
    consequence: "A bloom fuelled by excess nutrients dies and decays, using up oxygen (a low-oxygen 'dead zone').",
    kid: "Too much algae could use up the oxygen when it rots, so fish may have to swim away.",
    visual: "Green murky water, fewer and slower fish, fewer bubbles.",
    sound: { text: "Slow, low and muffled.", notes: -2, tempo: 0.75, bright: 0.5 },
    source: NOAA_HYPOXIA,
  },
  {
    id: "ocean-bloom", mission: "ocean", weight: 6, mood: "thoughtful",
    condition: "algal bloom > 0.3",
    when: (m) => m.bloom > 0.3 && m.hypoxia <= 0.3,
    consequence: "Excess nutrients fuel an algal bloom that turns the water green and blocks light.",
    kid: "Lots of plant food in the water may make algae grow fast and turn the water green.",
    visual: "Green scum near the surface.",
    sound: { text: "A cloudier, duller sound.", bright: 0.6 },
    source: NOAA_HAB,
  },
  {
    id: "ocean-pollution", mission: "ocean", weight: 5, mood: "concerned",
    condition: "pollution index > 40",
    when: (m) => m.pollution > 0.4,
    consequence: "Debris and chemicals cloud water and harm marine life.",
    kid: "Rubbish in the sea could hurt turtles, fish and birds and make the water cloudy.",
    visual: "Floating rubbish and murky water.",
    sound: { text: "Crackly, dull sound.", bright: 0.7 },
    source: NOAA_DEBRIS,
  },
  {
    id: "ocean-healthy", mission: "ocean", weight: 1, mood: "happy",
    condition: "health ≥ 0.75",
    when: (m) => m.health >= 0.75,
    consequence: "Corals keep their colour and the reef stays busy with fish.",
    kid: "The reef looks colourful and busy with fish!",
    visual: "Colourful corals and lots of fish.",
    sound: { text: "Bright and lively.", bright: 1.1, notes: 1 },
    source: NOAA_BLEACH,
  },
  // ---------------- Earth's Pulse (local weather) ----------------
  {
    id: "pulse-heat-drought", mission: "pulse", weight: 10, mood: "concerned",
    condition: "heat stress > 0.3 and drought > 0.3",
    when: (m) => m.heat > 0.3 && m.drought > 0.3,
    consequence: "Water may evaporate faster while less rain arrives, so soil and plants could dry out quickly.",
    kid: "Very hot AND very dry could dry out the soil fast. Plants may wilt and people need lots of water.",
    visual: "A bigger, hotter sun; cracked brown ground; plants wilt.",
    sound: { text: "A higher, tense tune with fewer beats.", tension: 0.9, busy: 0.4, fall: true },
    source: IPCC_WG1,
  },
  {
    id: "pulse-heatwave", mission: "pulse", weight: 8, mood: "concerned",
    condition: "daily mean ≥ ~31 °C or 5 °C above this place's normal (heat stress > 0.3)",
    when: (m) => m.heat > 0.3 && m.drought <= 0.3,
    consequence: "A heatwave can make it hard for people, animals and plants to stay cool.",
    kid: "This could be a heatwave! People and animals may need shade and water.",
    visual: "Heat shimmer and an orange sky.",
    sound: { text: "A shimmering, tense harmony.", tension: 0.7, bright: 1.25 },
    source: WHO_HEAT,
  },
  {
    id: "pulse-drought", mission: "pulse", weight: 7, mood: "concerned",
    condition: "rain well below this place's normal (drought > 0.3)",
    when: (m) => m.drought > 0.3 && m.heat <= 0.3,
    consequence: "Much less rain than normal could lead to a drought: soil dries and plants may wilt.",
    kid: "Much less rain than usual could cause a drought. The ground may crack and plants could wilt.",
    visual: "Cracked brown ground; fewer clouds.",
    sound: { text: "Fewer rain beats and lower notes.", busy: 0.3, notes: -2, fall: true },
    source: NASA_DROUGHT,
  },
  {
    id: "pulse-flood", mission: "pulse", weight: 7, mood: "concerned",
    condition: "rain ≥ max(14 mm/day, 2.5 × normal) (flood risk > 0.3)",
    when: (m) => m.flood > 0.3,
    consequence: "This much rain every day could flood rivers and streets and wash soil away.",
    kid: "So much rain could make rivers overflow and flood the streets.",
    visual: "Dark clouds, heavy rain and puddles.",
    sound: { text: "Very busy beats and a darker tone.", busy: 1.8, bright: 0.7 },
    source: IPCC_WG1,
  },
  {
    id: "pulse-dim", mission: "pulse", weight: 6, mood: "thoughtful",
    condition: "sunlight < ~55 % of this place's normal",
    when: (m) => m.dim > 0.3,
    consequence: "With much less sunlight plants may grow more slowly and days feel dull and cool.",
    kid: "With less sunshine, plants may grow more slowly. They need light to make food.",
    visual: "The sun shrinks and dims; grey sky.",
    sound: { text: "A darker, softer sound.", bright: 0.45 },
    source: NASA_PHOTO,
  },
  {
    id: "pulse-storms", mission: "pulse", weight: 6, mood: "surprised",
    condition: "storminess > 1.6 × usual",
    when: (m) => m.storm > 0.3,
    consequence: "Stronger storms could bring strong winds and heavy downpours. Single storms have many causes.",
    kid: "Stormy weather could bring strong winds and lightning. Stay safe inside!",
    visual: "Lightning and swirling storm clouds.",
    sound: { text: "Rumbling, faster beats.", busy: 1.5, tempo: 1.15 },
    source: IPCC_WG1,
  },
  {
    id: "pulse-plants", mission: "pulse", weight: 5, mood: "thoughtful",
    condition: "plant cover < 70 % of today",
    when: (m) => m.plantLoss > 0.3,
    consequence: "Fewer plants means less shade and less carbon stored by plants.",
    kid: "With fewer plants, there's less shade and less CO₂ taken in by leaves.",
    visual: "Fewer trees on the hills.",
    sound: { text: "A thinner chord.", busy: 0.8, bright: 0.85 },
    source: NASA_CARBON,
  },
  {
    id: "pulse-co2", mission: "pulse", weight: 4, mood: "thoughtful",
    condition: "CO₂ > 500 ppm",
    when: (m) => m.co2 > 0.14,
    consequence: "CO₂ traps heat; over many years more CO₂ could warm places, but it doesn't change today's weather on its own.",
    kid: "CO₂ is a gas that traps heat. Over many years, more of it could make Earth warmer.",
    visual: "The CO₂ gauge rises.",
    sound: { text: "A low drone appears under the music.", tension: 0.3 },
    source: NOAA_CO2,
  },
  {
    id: "pulse-normal", mission: "pulse", weight: 1, mood: "happy",
    condition: "health ≥ 0.75",
    when: (m) => m.health >= 0.75,
    consequence: "Close to the real, normal weather for this place.",
    kid: "This is close to the real weather here. Everything looks normal!",
    visual: "Sunny, calm sky over green hills.",
    sound: { text: "The real data's normal tune.", notes: 0 },
    source: { label: "NASA POWER (the real starting values)", url: "https://power.larc.nasa.gov/" },
  },
];

/** Rules that fire for these simulation results, most important first. */
export function activeRules(mission: ExperienceId, r: SimResult): Rule[] {
  return RULES.filter((x) => x.mission === mission && x.when(r.metrics)).sort((a, b) => b.weight - a.weight);
}

/** Combine the sound responses of all active rules into one set of adjustments. */
export function combinedSound(rules: Rule[]): Required<Omit<SoundResponse, "text">> {
  const out = { notes: 0, busy: 1, bright: 1, tension: 0, fall: false, tempo: 1 };
  for (const r of rules) {
    out.notes += r.sound.notes ?? 0;
    out.busy *= r.sound.busy ?? 1;
    out.bright *= r.sound.bright ?? 1;
    out.tension = Math.max(out.tension, r.sound.tension ?? 0);
    out.fall ||= !!r.sound.fall;
    out.tempo *= r.sound.tempo ?? 1;
  }
  out.notes = Math.max(-5, Math.min(3, out.notes));
  out.tempo = Math.max(0.6, Math.min(1.4, out.tempo));
  return out;
}
