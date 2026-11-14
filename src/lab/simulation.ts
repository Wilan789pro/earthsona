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
    { key: "temp", label: "Global temperature anomaly", unit: "°C vs 1850–1900", min: 0, max: 5, step: 0.1, baseline: 1.1, help: "Baseline +1.1 °C is the IPCC AR6 estimate for 2011–2020." },
    { key: "co2", label: "Atmospheric CO₂", unit: "ppm", min: 280, max: 1000, step: 10, baseline: 420, help: "Baseline ≈ 420 ppm, close to recent NOAA global annual means. Pre-industrial was about 280 ppm." },
    { key: "ice", label: "Ice cover", unit: "% of today", min: 0, max: 150, step: 1, baseline: 100, help: "Sea ice, ice sheets and glaciers together." },
    { key: "sea", label: "Sea level", unit: "m vs today", min: -0.2, max: 2, step: 0.05, baseline: 0, help: "Rises from warming water (thermal expansion) and melting land ice." },
    { key: "veg", label: "Vegetation cover", unit: "% of today", min: 0, max: 150, step: 1, baseline: 100, help: "Forests and plants store carbon and cool the land." },
    { key: "extreme", label: "Extreme weather intensity", unit: "index (1 = today)", min: 0, max: 3, step: 0.1, baseline: 1, help: "How strong heatwaves, heavy rain and droughts are overall, not any single event." },
  ],
};

export const baselineOf = (exp: ExperienceId): Values => Object.fromEntries(VARS[exp].map((v) => [v.key, v.baseline]));

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
    { label: "…CO₂ doubles from pre-industrial?", values: { co2: 560, temp: 2.5 } },
    { label: "…we reach +3 °C?", values: { temp: 3, co2: 650, ice: 60, sea: 0.6, extreme: 2 } },
    { label: "…forests are cleared worldwide?", values: { veg: 40 } },
    { label: "…emissions fall and forests regrow?", values: { co2: 400, veg: 120, temp: 1.3 } },
  ],
};

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
export function simulate(exp: ExperienceId, v: Values): SimResult {
  return exp === "forest" ? forest(v) : exp === "ocean" ? ocean(v) : pulse(v);
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
    visual: { green: clamp(health * (1 - 0.5 * drought)), density: clamp(0.25 + 0.75 * health), dry: drought, wet: waterlog, sun: clamp(v.sun / 150), rain: clamp(v.rain / 300), haze: clamp((v.humidity - 20) / 80), wildlife, heat },
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
    visual: { coral, bleach, clarity, bloom, fish, acid, oxygen: clamp(oxygen / 8), warm: clamp((v.sst + 2) / 6), pollution: pol },
  };
}

function pulse(v: Values): SimResult {
  // Equilibrium warming implied by CO₂: ECS × log2(CO₂/280), IPCC AR6 best estimate ECS = 3 °C.
  const implied = 3 * Math.log2(v.co2 / 280);
  const gap = implied - v.temp;
  // Ice: in this model ice responds to warming above today's level (slow, non-linear).
  const iceFromTemp = clamp(1 - 0.12 * Math.max(0, v.temp - 1.1) - 0.05 * Math.max(0, v.temp - 1.1) ** 2, 0, 1.2);
  const ice = clamp((v.ice / 100) * iceFromTemp, 0, 1.5);
  const impliedSea = 0.2 * Math.max(0, v.temp - 1.1) + 1.5 * Math.max(0, 1 - ice); // simplified, long-term, metres
  const veg = v.veg / 100;
  const carbonSink = clamp(veg / 1.5);
  const risk = clamp(0.15 * v.temp + 0.25 * (v.extreme - 1) + 0.25 * Math.max(0, v.sea) + 0.2 * (1 - veg));
  const health = clamp(1 - risk);
  const findings: string[] = [];
  if (Math.abs(gap) > 0.6)
    findings.push(
      gap > 0
        ? `CO₂ at ${Math.round(v.co2)} ppm implies about ${implied.toFixed(1)} °C of long-term warming (IPCC best-estimate climate sensitivity), more than the ${v.temp.toFixed(1)} °C you set, so more warming would still be "in the pipeline".`
        : `Your ${v.temp.toFixed(1)} °C is more than CO₂ at ${Math.round(v.co2)} ppm alone would imply (about ${implied.toFixed(1)} °C), so other factors would have to explain it.`,
    );
  else if (Math.abs(v.co2 - 420) >= 10)
    findings.push(`CO₂ at ${Math.round(v.co2)} ppm implies about ${implied.toFixed(1)} °C of long-term warming (IPCC best-estimate climate sensitivity of 3 °C per doubling), consistent with the ${v.temp.toFixed(1)} °C you set.`);
  if (v.temp > 1.6) findings.push("Higher temperatures melt ice and make ocean water expand, both of which raise sea level over decades to centuries.");
  if (ice < 0.6) findings.push("With much less ice, less sunlight is reflected back to space; the darker ocean and land absorb more heat (a reinforcing feedback).");
  if (v.sea > 0.3) findings.push(`A sea level ${v.sea.toFixed(2)} m higher than today puts low coasts and islands at much greater risk from storm surges and flooding.`);
  if (impliedSea > v.sea + 0.3) findings.push(`In this simplified model, your temperature and ice settings would eventually push sea level toward about +${impliedSea.toFixed(1)} m.`);
  if (veg < 0.7) findings.push("Losing vegetation removes a carbon sink and releases stored carbon, which tends to add to warming.");
  else if (veg > 1.1) findings.push("More vegetation stores more carbon, helping to slow the rise in CO₂ a little.");
  if (v.extreme > 1.5) findings.push("Stronger extremes mean more intense heatwaves, downpours and droughts on average. Individual events still have many causes.");
  if (!findings.length) findings.push("These settings match today's climate: about 1.1 °C warmer than pre-industrial, with ice and sea level as they are now.");
  return {
    health: Math.round(health * 100),
    indicators: [
      { key: "implied", label: "Warming implied by CO₂", value: clamp(implied / 6), good: "low" },
      { key: "ice", label: "Ice cover", value: clamp(ice / 1.5), good: "high" },
      { key: "sea", label: "Sea-level risk", value: clamp(Math.max(v.sea, 0) / 2), good: "low" },
      { key: "sink", label: "Carbon storage by plants", value: carbonSink, good: "high" },
      { key: "risk", label: "Overall climate risk", value: risk, good: "low" },
    ],
    findings,
    visual: { temp: clamp(v.temp / 5), ice: clamp(ice / 1.5), sea: clamp((v.sea + 0.2) / 2.2), veg: clamp(veg / 1.5), storms: clamp(v.extreme / 3), co2: clamp((v.co2 - 280) / 720) },
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
