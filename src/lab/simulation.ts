import type { ExperienceId } from "../data/types";

/**
 * EARTHSONA environmental laboratories: six interacting variables per mission.
 *
 * These are SIMPLIFIED EDUCATIONAL MODELS, not observations and not forecasts. They encode well-known,
 * qualitative relationships with smooth (non-linear, saturating) responses so that changes are gradual and
 * combinations matter. Where a number comes from the literature it is cited in a comment; everything else is
 * a dimensionless 0–1 index chosen for teaching. The UI labels every output "Simulation".
 */

export interface VarDef {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  baseline: number;
  /** One-line explanation shown under the slider. */
  help: string;
}

export interface Indicator {
  key: string;
  label: string;
  /** 0–1 where 1 is the best ecological condition (or highest level for neutral indicators). */
  value: number;
  good: "high" | "low";
}

export interface SimResult {
  /** Overall ecosystem / system health, 0–100. */
  health: number;
  indicators: Indicator[];
  /** Short sentences describing the combined effects of the current settings. */
  findings: string[];
  /** Parameters for the visual scene (all 0–1 unless noted). */
  visual: Record<string, number>;
  /** Internal stress/benefit levels (0–1) that the scenario rules (scenarios.ts) test against thresholds. */
  metrics: Record<string, number>;
}

export type Values = Record<string, number>;

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
/** Smooth bump that is 1 at the optimum and falls off with distance (Gaussian). */
const optimum = (x: number, opt: number, width: number) => Math.exp(-(((x - opt) / width) ** 2));

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------
export const VARS: Record<ExperienceId, VarDef[]> = {
  forest: [
    { key: "sun", label: "Sunlight intensity", unit: "% of normal", min: 20, max: 150, step: 5, baseline: 100, help: "Energy for photosynthesis. Benefits level off at high light." },
    { key: "rain", label: "Rainfall", unit: "% of normal", min: 0, max: 300, step: 5, baseline: 100, help: "Main water supply. Too little dries the soil; far too much waterlogs it." },
    { key: "humidity", label: "Humidity", unit: "% relative humidity", min: 20, max: 100, step: 1, baseline: 80, help: "Moist air slows water loss from leaves and soil." },
    { key: "temp", label: "Temperature", unit: "°C vs normal", min: -5, max: 8, step: 0.5, baseline: 0, help: "Warmer air dries soil and leaves faster and can cause heat stress." },
    { key: "co2", label: "Atmospheric CO₂", unit: "ppm", min: 280, max: 1000, step: 10, baseline: 420, help: "Can boost photosynthesis, but only if water, light and temperature allow it." },
    { key: "soil", label: "Soil moisture", unit: "% of field capacity", min: 0, max: 100, step: 1, baseline: 60, help: "Water stored in the ground at the start; rain and heat then add or remove water." },
  ],
  ocean: [
    { key: "sst", label: "Sea surface temperature", unit: "°C vs normal", min: -2, max: 4, step: 0.1, baseline: 0, help: "Corals start to bleach when water stays about 1 °C above the warmest normal month for weeks." },
    { key: "ph", label: "Ocean acidity (pH)", unit: "pH", min: 7.6, max: 8.2, step: 0.01, baseline: 8.05, help: "Lower pH means more acidic water and harder shell and skeleton building." },
    { key: "oxygen", label: "Dissolved oxygen", unit: "mg/L", min: 1, max: 9, step: 0.1, baseline: 6.5, help: "Below about 2 mg/L (hypoxia) most fish and invertebrates struggle." },
    { key: "pollution", label: "Ocean pollution", unit: "index 0–100", min: 0, max: 100, step: 1, baseline: 15, help: "Plastics, sediment and chemicals that cloud water and stress life." },
    { key: "nutrients", label: "Nutrient availability", unit: "% of normal", min: 0, max: 300, step: 5, baseline: 100, help: "Some nutrients feed plankton; too many fuel algal blooms." },
    { key: "reef", label: "Coral reef health (starting)", unit: "% live coral", min: 0, max: 100, step: 1, baseline: 80, help: "The reef's condition before the other stressors act on it." },
  ],
  pulse: [
    { key: "temp", label: "Air temperature", unit: "°C", min: -30, max: 45, step: 0.5, baseline: 25, help: "Daily-mean air temperature at 2 m (NASA POWER T2M). Starts at this place's latest real value." },
    { key: "rain", label: "Rainfall", unit: "mm/day", min: 0, max: 30, step: 0.5, baseline: 4, help: "Average rain per day (NASA POWER PRECTOTCORR). Starts at this place's latest real value." },
    { key: "sun", label: "Sunlight", unit: "MJ/m²/day", min: 1, max: 35, step: 0.5, baseline: 18, help: "Sunlight reaching the ground (NASA POWER ALLSKY_SFC_SW_DWN). Starts at this place's latest real value." },
    { key: "co2", label: "Atmospheric CO₂", unit: "ppm", min: 280, max: 1000, step: 10, baseline: 420, help: "≈ 420 ppm is close to recent NOAA global annual means; pre-industrial was about 280 ppm." },
    { key: "veg", label: "Plant cover", unit: "% of today", min: 0, max: 150, step: 1, baseline: 100, help: "How many plants grow here compared with today." },
    { key: "storms", label: "Stormy weather", unit: "index (1 = usual)", min: 0, max: 3, step: 0.1, baseline: 1, help: "How strong storms and downpours are overall, not any single event." },
  ],
};

/** The "normal" starting point. `real` overrides come from real measurements (see Playground.realStart). */
export const baselineOf = (exp: ExperienceId, real: Values = {}): Values =>
  Object.fromEntries(
    VARS[exp].map((d) => {
      const r = real[d.key];
      return [d.key, r === undefined || !Number.isFinite(r) ? d.baseline : Math.min(d.max, Math.max(d.min, Math.round(r / d.step) * d.step))];
    }),
  );

/** Ready-made "What happens if…?" scenarios (all hypothetical). */
export const PRESETS: Record<ExperienceId, { label: string; values: Values }[]> = {
  forest: [
    { label: "…a heatwave meets a drought?", values: { temp: 4, rain: 40, humidity: 45, soil: 35 } },
    { label: "…a very wet monsoon?", values: { rain: 260, humidity: 95, soil: 95, sun: 70 } },
    { label: "…CO₂ doubles but nothing else changes?", values: { co2: 840 } },
    { label: "…CO₂ doubles in a hotter, drier world?", values: { co2: 840, temp: 3, rain: 70 } },
    { label: "…smoke dims the sunlight?", values: { sun: 45 } },
  ],
  ocean: [
    { label: "…a marine heatwave?", values: { sst: 2 } },
    { label: "…fertiliser runoff after storms?", values: { nutrients: 260, pollution: 45 } },
    { label: "…the ocean keeps acidifying?", values: { ph: 7.75 } },
    { label: "…heat, runoff and acidity combine?", values: { sst: 1.8, nutrients: 200, ph: 7.85, pollution: 40 } },
    { label: "…a healthy, protected reef?", values: { pollution: 3, reef: 95 } },
  ],
  pulse: [
    { label: "…a heatwave?", values: { temp: 36, rain: 0.5, sun: 28 } },
    { label: "…it rains for days?", values: { rain: 22, sun: 6, storms: 2 } },
    { label: "…clouds and smoke dim the sun?", values: { sun: 6 } },
    { label: "…plants are cleared?", values: { veg: 30 } },
  ],
};

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
export function simulate(exp: ExperienceId, v: Values, base: Values = baselineOf(exp)): SimResult {
  return exp === "forest" ? forest(v) : exp === "ocean" ? ocean(v) : pulse(v, base);
}

function forest(v: Values): SimResult {
  // Evaporative demand rises ~7 %/°C (Clausius–Clapeyron) and with drier air (vapour-pressure deficit).
  const vpd = ((1 + 0.07 * v.temp) * (1 - v.humidity / 100)) / 0.2; // 1 at baseline (80 % RH, +0 °C)
  // Elevated CO₂ partly closes stomata, improving water-use efficiency a little.
  const wue = 1 + 0.15 * Math.log(v.co2 / 420);
  const supply = v.rain / 100;
  const balance = supply * wue - (vpd - 1) * 0.6; // ≈1 at baseline
  const soilEff = clamp((v.soil / 60) * 0.55 * (0.4 + 0.6 * clamp(balance, 0, 2)) + 0.12 * (v.humidity - 80) / 20);
  const water = clamp(soilEff / 0.55); // 1 ≈ normal water availability
  const drought = clamp(1 - water / 0.75);
  const waterlog = clamp(sigmoid((v.rain - 220) / 25) * 0.7 + sigmoid((v.soil - 92) / 3) * 0.5);
  const heat = clamp(sigmoid((v.temp - 3) / 1.2) * (0.6 + 0.4 * drought));
  const cold = clamp(sigmoid((-v.temp - 3) / 1));
  const light = (1 - Math.exp((-2 * v.sun) / 100)) / (1 - Math.exp(-2)); // saturating light response
  // CO₂ fertilisation is logarithmic and only realised when water and temperature are not limiting.
  const co2Boost = 1 + 0.25 * Math.log(v.co2 / 420) * (1 - drought) * (1 - heat);
  const tempEff = optimum(v.temp, 0.5, 6);
  const photo = clamp(light * co2Boost * tempEff * (0.25 + 0.75 * (1 - drought)) * (1 - 0.5 * waterlog), 0, 1.3);
  const health = clamp(photo * (1 - 0.55 * heat) * (1 - 0.4 * waterlog) * (1 - 0.4 * cold));
  const wildlife = clamp(health * (1 - 0.3 * heat) * (0.7 + 0.3 * clamp(water)));
  const findings: string[] = [];
  if (heat > 0.25 && drought > 0.25) findings.push("Heat and dry soil are acting together: hot air pulls water out of leaves and soil faster while less water arrives, so the trees close their pores, stop growing and leaves turn brown.");
  else if (drought > 0.3) findings.push("With less water reaching the roots, the soil dries out and leaves wilt and yellow.");
  else if (heat > 0.3) findings.push("High temperatures cause heat stress even with water available; photosynthesis slows above the plants' comfortable range.");
  if (waterlog > 0.3) findings.push("Waterlogged soil pushes air out of the ground, so roots can't breathe; too much water is also a stress.");
  if (v.co2 > 500 && (drought > 0.3 || heat > 0.3)) findings.push("Extra CO₂ could feed more photosynthesis, but water and heat limits stop the forest from using it, so more CO₂ does not mean a healthier forest here.");
  else if (v.co2 > 500) findings.push("Extra CO₂ gives a modest growth boost and slightly better water use, because water, light and temperature are not limiting in this setting.");
  if (v.sun < 60) findings.push("Dim light limits photosynthesis, so the canopy thins and growth slows.");
  if (v.humidity < 50 && drought <= 0.3) findings.push("Dry air raises water loss from leaves; the forest copes for now because soil water is adequate.");
  if (cold > 0.3) findings.push("Much colder conditions slow growth and can damage frost-sensitive plants.");
  if (!findings.length) findings.push("Conditions are close to normal, so the forest stays green and active.");
  return {
    health: Math.round(health * 100),
    indicators: [
      { key: "water", label: "Water availability", value: clamp(water), good: "high" },
      { key: "photo", label: "Photosynthesis", value: clamp(photo / 1.15), good: "high" },
      { key: "heat", label: "Heat stress", value: heat, good: "low" },
      { key: "waterlog", label: "Waterlogging", value: waterlog, good: "low" },
      { key: "wildlife", label: "Wildlife activity", value: wildlife, good: "high" },
    ],
    findings,
    visual: { green: clamp(health * (1 - 0.5 * drought)), density: clamp(0.25 + 0.75 * health), dry: drought, wet: waterlog, sun: clamp(v.sun / 150), rain: clamp(v.rain / 300), haze: clamp((v.humidity - 20) / 80), wildlife, heat, fall: clamp(Math.max(drought, heat) * 1.3 - 0.15), health },
    metrics: { drought, heat, waterlog, cold, photo: clamp(photo / 1.15), health, co2: clamp((v.co2 - 420) / 580), dim: clamp((60 - v.sun) / 40) },
  };
}

function ocean(v: Values): SimResult {
  // Bleaching risk climbs once water stays ~1 °C above the normal maximum (NOAA Coral Reef Watch "HotSpot").
  const bleach = clamp(sigmoid((v.sst - 1.2) / 0.35));
  // Lower pH lowers carbonate saturation; calcification weakens (0 = normal, 1 = severe).
  const acid = clamp((8.05 - v.ph) / 0.4);
  // Warmer water holds less oxygen (~0.15–0.2 mg/L per °C near tropical temperatures).
  const bloom = clamp(sigmoid((v.nutrients - 170) / 30) * (0.7 + 0.3 * clamp(v.sst / 2 + 0.5)));
  const oxygen = v.oxygen - 0.18 * v.sst - 3 * bloom * 0.8; // decaying blooms consume oxygen
  const hypoxia = clamp(sigmoid((2.5 - oxygen) / 0.5));
  const pol = v.pollution / 100;
  const clarity = clamp(1 - 0.55 * pol - 0.45 * bloom);
  const starve = clamp(sigmoid((30 - v.nutrients) / 10)); // very low nutrients starve plankton food webs
  const coral = clamp((v.reef / 100) * (1 - 0.75 * bleach) * (1 - 0.45 * acid) * (1 - 0.6 * hypoxia) * (1 - 0.35 * pol) * (1 - 0.3 * bloom));
  const fish = clamp((0.35 + 0.65 * coral / 0.8) * (1 - 0.8 * hypoxia) * (1 - 0.3 * pol) * (1 - 0.3 * starve));
  const health = clamp(0.45 * coral / 0.8 + 0.35 * fish + 0.2 * clarity);
  const findings: string[] = [];
  if (bleach > 0.3 && v.nutrients > 160) findings.push("Warm water and nutrient runoff hit corals together: heat makes them expel their algae (bleaching), while the extra nutrients feed seaweed that crowds them out.");
  else if (bleach > 0.3) findings.push("Water this warm for weeks causes thermal stress: corals expel the algae that feed and colour them, and turn white.");
  if (acid > 0.3) findings.push("More acidic water makes it harder for corals, shellfish and some plankton to build calcium carbonate shells and skeletons.");
  if (bloom > 0.3 && hypoxia > 0.3) findings.push("An algal bloom fuelled by excess nutrients dies and decays, using up oxygen and creating a low-oxygen zone where fish can't survive.");
  else if (bloom > 0.3) findings.push("Excess nutrients are fuelling an algal bloom that turns the water green and blocks light.");
  else if (hypoxia > 0.3) findings.push("Oxygen is low enough to stress fish and invertebrates; many swim away or die.");
  if (v.sst > 0.5 && hypoxia > 0.1) findings.push("Warmer water also holds less oxygen, which makes the low-oxygen problem worse.");
  if (pol > 0.4) findings.push("Pollution clouds the water and harms marine life, reducing biodiversity.");
  if (starve > 0.4) findings.push("With very few nutrients, plankton (the base of the food web) become scarce, so there's less food for fish.");
  if (v.reef < 40) findings.push("The reef started in poor condition, so it has less resilience to any extra stress.");
  if (!findings.length) findings.push("Conditions are close to normal: corals keep their colour and the reef stays busy with fish.");
  return {
    health: Math.round(health * 100),
    indicators: [
      { key: "coral", label: "Live coral", value: coral, good: "high" },
      { key: "bleach", label: "Bleaching risk", value: bleach, good: "low" },
      { key: "oxygen", label: "Oxygen stress", value: hypoxia, good: "low" },
      { key: "clarity", label: "Water clarity", value: clarity, good: "high" },
      { key: "fish", label: "Marine biodiversity", value: fish, good: "high" },
    ],
    findings,
    visual: { coral, bleach, clarity, bloom, fish, acid, oxygen: clamp(oxygen / 8), warm: clamp((v.sst + 2) / 6), pollution: pol, health },
    metrics: { bleach, acid, bloom, hypoxia, pollution: pol, starve, coral, fish, health, runoff: clamp((v.nutrients - 160) / 100) },
  };
}

/**
 * Earth's Pulse lab: the LOCAL weather of one place (NASA POWER point data — not global weather), plus CO₂,
 * plant cover and storminess. "Normal" is this place's latest real measurement, so a polar station and a
 * tropical port both start healthy and are judged against their own normal.
 */
function pulse(v: Values, base: Values): SimResult {
  const warmer = v.temp - base.temp;
  // Heat stress: very hot daily means (≥ ~30 °C) or much hotter than this place's normal.
  const heat = clamp(Math.max(sigmoid((v.temp - 31) / 1.5), sigmoid((warmer - 5) / 1.2)));
  const coldSnap = clamp(sigmoid((-warmer - 6) / 1.5));
  // Evaporation demand rises ~7 %/°C (Clausius–Clapeyron); water supply is rain relative to normal.
  const evap = Math.max(0.3, 1 + 0.07 * warmer);
  const water = (v.rain / Math.max(0.5, base.rain)) / evap; // 1 = normal
  const drought = clamp(sigmoid((0.45 - water) / 0.12));
  const flood = clamp(sigmoid((v.rain - Math.max(14, 2.5 * base.rain)) / 2.2));
  const sunRatio = v.sun / Math.max(1, base.sun);
  const dim = clamp(sigmoid((0.55 - sunRatio) / 0.08));
  const storm = clamp((v.storms - 1) / 2 + 0.25 * flood);
  const veg = v.veg / 100;
  const co2Boost = 1 + 0.2 * Math.log(v.co2 / 420) * (1 - drought) * (1 - heat); // only if water and heat allow
  const light = (1 - Math.exp(-2 * Math.min(2, sunRatio))) / (1 - Math.exp(-2));
  const growth = clamp(veg * light * Math.min(1, water) ** 0.5 * co2Boost * (1 - 0.6 * heat) * (1 - 0.4 * flood) * (1 - 0.5 * coldSnap), 0, 1.3);
  const health = clamp(1 - 0.35 * heat - 0.3 * drought - 0.25 * flood - 0.25 * storm - 0.15 * dim - 0.2 * coldSnap - 0.25 * Math.max(0, 1 - veg));
  const findings: string[] = [];
  if (heat > 0.3 && drought > 0.3) findings.push("Very hot and dry at the same time: water may evaporate faster while less rain arrives, so soil and plants could dry out quickly.");
  else if (heat > 0.3) findings.push("Daily temperatures this high could make a heatwave: people, animals and plants may struggle to stay cool.");
  else if (drought > 0.3) findings.push("Much less rain than normal for this place could lead to a drought: soil dries and plants may wilt.");
  if (flood > 0.3) findings.push("This much rain every day could flood rivers and streets and wash soil away.");
  if (dim > 0.3) findings.push("With much less sunlight, plants may grow more slowly and days feel dull and cool.");
  if (storm > 0.3) findings.push("Stronger storms could bring strong winds and heavy downpours.");
  if (veg < 0.7) findings.push("With fewer plants there is less shade and less carbon stored, and the ground may get hotter in the sun.");
  if (v.co2 > 500) findings.push("CO₂ traps heat. Over many years, more CO₂ could make places warmer, but it doesn't change today's weather on its own. Try the temperature slider too.");
  if (coldSnap > 0.3) findings.push("Much colder than normal for this place: frost could damage plants that are not used to it.");
  if (!findings.length) findings.push("This is close to the real, normal weather for this place.");
  return {
    health: Math.round(health * 100),
    indicators: [
      { key: "heat", label: "Heat stress", value: heat, good: "low" },
      { key: "water", label: "Water for plants", value: clamp(water / 1.5), good: "high" },
      { key: "growth", label: "Plant growth", value: clamp(growth / 1.15), good: "high" },
      { key: "flood", label: "Flood risk", value: flood, good: "low" },
      { key: "storm", label: "Storm risk", value: storm, good: "low" },
    ],
    findings,
    visual: {
      sun: clamp(v.sun / 35),
      sunRatio: clamp(sunRatio / 2),
      temp: clamp((v.temp + 30) / 75),
      heat,
      rain: clamp(v.rain / 30),
      clouds: clamp(0.1 + 0.5 * clamp(v.rain / 15) + 0.4 * dim),
      veg: clamp(veg / 1.5),
      green: clamp(growth / 1.15),
      storms: clamp(v.storms / 3),
      co2: clamp((v.co2 - 280) / 720),
      dry: drought,
      snow: clamp((2 - v.temp) / 8),
      health,
    },
    metrics: { heat, drought, flood, dim, storm, plantLoss: clamp(1 - veg), co2: clamp((v.co2 - 420) / 580), coldSnap, health, growth: clamp(growth / 1.15) },
  };
}

/** Describe what changed vs the baseline, for Luna and the UI. */
export function changesFromBaseline(exp: ExperienceId, v: Values): string[] {
  return VARS[exp]
    .filter((d) => Math.abs(v[d.key] - d.baseline) > d.step / 2)
    .map((d) => `${d.label}: ${fmt(v[d.key], d)} (baseline ${fmt(d.baseline, d)})`);
}

export function fmt(x: number, d: VarDef): string {
  const dp = d.step < 0.1 ? 2 : d.step < 1 ? 1 : 0;
  const s = x.toFixed(dp);
  return d.unit.startsWith("°C vs") && x > 0 ? `+${s} ${d.unit.replace(" vs normal", "").replace(" vs 1850–1900", "")}` : `${s} ${d.unit.startsWith("%") ? "%" : d.unit.split(" ")[0]}`;
}
