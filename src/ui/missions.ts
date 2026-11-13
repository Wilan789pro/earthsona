import type { ExperienceId } from "../data/types";
import { loadPref, savePref } from "./dom";

/**
 * Mission content for the astronaut-led story: the seven steps of each mission, the Earth Impact Explorer
 * (what could a change mean?), the challenges and the "What would you do?" mini-game.
 *
 * Rules kept here:
 *  - Every NUMBER shown to the child comes from loaded data (see impactMeasured in main.ts); nothing here
 *    contains invented measurements.
 *  - Consequence chains separate three kinds of statement: what the dataset MEASURED, what RESEARCH says can
 *    happen in general, and what was NOT CHECKED for this place and time.
 *  - No guilt: actions are small, positive and done with an adult where needed.
 */

export const STEPS = ["Enter", "Discover the data", "Listen", "Compare", "Why it matters", "Challenge", "What can we do?"] as const;
export type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Choice {
  t: string;
  ok: boolean;
  why: string;
}

export interface Mission {
  id: ExperienceId;
  title: string;
  icon: string;
  invite: string;
  badge: string;
  badgeIcon: string;
  enterAnim: "dive" | "land" | "clouds";
  lines: Record<StepIndex, string>;
  listenLabel: string;
  challenge: { q: string; options: Choice[] };
  actions: string[];
}

export const MISSIONS: Record<ExperienceId, Mission> = {
  ocean: {
    id: "ocean",
    title: "Ocean Symphony",
    icon: "🌊",
    invite: "Let's discover how warm the ocean is!",
    badge: "Ocean Explorer",
    badgeIcon: "🐠",
    enterAnim: "dive",
    listenLabel: "Listen to the Ocean",
    lines: {
      0: "Welcome to the ocean! So many creatures live here. But how do scientists know if the ocean is getting warmer or cooler?",
      1: "Scientists use special observations to measure how warm the ocean's surface is. This helps them understand how our oceans are changing.",
      2: "Press play! When the notes go higher, the measured ocean temperature went up. When they go lower, it went down.",
      3: "Let's pick two different years and listen to both. Can you hear a difference?",
      4: "Wow! We discovered something interesting. But why does it matter? Let's find out what warm water can mean for corals.",
      5: "Time for a challenge, explorer!",
      6: "Great job! Here are some things we can do to help the ocean.",
    },
    challenge: {
      q: "What can happen when corals get too warm for too long?",
      options: [
        { t: "They can turn white. This is called coral bleaching.", ok: true, why: "Yes! Stressed corals push out the tiny algae that give them food and colour, so they look white." },
        { t: "They turn into fish.", ok: false, why: "Not quite! Corals are animals, but they don't turn into fish. Try again." },
        { t: "Nothing ever happens to corals.", ok: false, why: "Hmm, scientists have seen that very warm water can stress corals. Try again." },
      ],
    },
    actions: ["Keep rubbish away from beaches 🗑️", "Look at sea animals without touching or disturbing them 👀", "Learn about the reefs near you 📚", "Help protect places where sea animals live 🐢"],
  },
  forest: {
    id: "forest",
    title: "Forest Voices",
    icon: "🌳",
    invite: "Let's discover how green the land looks!",
    badge: "Forest Explorer",
    badgeIcon: "🦜",
    enterAnim: "land",
    listenLabel: "Listen to the Forest",
    lines: {
      0: "Look at all these beautiful plants! But how do scientists observe changes in forests from space?",
      1: "Satellites can help scientists observe how green the land looks. This gives them clues about plants.",
      2: "Press play! Greener measurements make higher notes and a fuller sound. A soft tick means clouds hid the forest.",
      3: "Look carefully! Does the land look different in these two times? Let's listen to the difference.",
      4: "Wow! We discovered something interesting. Let's find out what plants need, and who needs plants.",
      5: "Time for a challenge, explorer!",
      6: "Great job! Here are some things we can do to help forests.",
    },
    challenge: {
      q: "What helps plants grow?",
      options: [
        { t: "Water, sunlight and good growing conditions", ok: true, why: "Yes! Plants need water, light and the right temperature and soil to grow." },
        { t: "Only darkness", ok: false, why: "Plants need light to make their food. Try again!" },
        { t: "Loud music", ok: false, why: "Fun idea, but plants need water and sunlight. Try again!" },
      ],
    },
    actions: ["Plant and care for a tree with an adult 🌱", "Be gentle with plants: don't pull or break them 🌿", "Respect animal homes in parks and forests 🦉", "Use less and waste less ♻️"],
  },
  pulse: {
    id: "pulse",
    title: "Earth's Pulse",
    icon: "💓",
    invite: "Let's discover Earth's temperature, rain and sunshine!",
    badge: "Earth's Pulse Explorer",
    badgeIcon: "⛅",
    enterAnim: "clouds",
    listenLabel: "Listen to Earth",
    lines: {
      0: "Welcome to Earth's atmosphere! Let's discover how temperature, rain and sunshine help us understand our planet.",
      1: "How warm or cool is it? How much rain fell? How much energy from the Sun reached the ground? Let's look!",
      2: "Press play! Warmer air makes higher notes, more rain makes busier beats, and more sunshine makes a brighter sound.",
      3: "Let's compare two different times and hear how the weather changed.",
      4: "Wow! We discovered something interesting. Let's find out why rain and sunshine matter.",
      5: "Time for a challenge, explorer!",
      6: "Great job! Here are some things we can do to help.",
    },
    challenge: {
      q: "What could happen when a place doesn't get enough rain for a long time?",
      options: [
        { t: "Plants and people can run short of water. This is called a drought.", ok: true, why: "Yes! A long time with too little rain can lead to drought. One dry day or month is not a drought." },
        { t: "It snows chocolate.", ok: false, why: "That would be tasty, but no! Try again." },
        { t: "Rivers get bigger.", ok: false, why: "Without rain, rivers usually get smaller. Try again!" },
      ],
    },
    actions: ["Turn off the tap while brushing your teeth 🚰", "Don't waste drinking water 💧", "Collect rainwater for plants only with an adult, where it is safe 🪣", "Learn how your town gets ready for big storms ⛈️"],
  },
};

// ---------------------------------------------------------------------------
// Earth Impact Explorer (Scene 8)
// ---------------------------------------------------------------------------
export type ChainKind = "measured" | "research" | "not-checked";
export interface Impact {
  title: string;
  scene: { emoji: string; name: string; fact: string; x: number; y: number }[];
  chain: { icon: string; text: string; kind: ChainKind }[];
  ask: { q: string; a: string }[];
  predict: { q: string; options: Choice[] };
  sources: { label: string; url: string }[];
}

export const IMPACT: Record<ExperienceId, Impact> = {
  ocean: {
    title: "Coral reefs and warm water",
    scene: [
      { emoji: "🪸", name: "Coral", fact: "Corals are tiny animals that build reefs. Little algae live inside them, give them food and colour.", x: 22, y: 70 },
      { emoji: "🐠", name: "Fish", fact: "Many fish live, hide and find food in coral reefs.", x: 62, y: 45 },
      { emoji: "🐢", name: "Sea turtle", fact: "Sea turtles visit reefs to eat and to get cleaned by small fish.", x: 80, y: 68 },
      { emoji: "☀️", name: "Sun", fact: "Sunshine warms the top of the sea. Satellites measure how warm the surface is.", x: 85, y: 12 },
      { emoji: "🛰️", name: "Satellite", fact: "Satellites measure the temperature of the sea surface from space, every day.", x: 20, y: 14 },
    ],
    chain: [
      { icon: "🛰️", text: "Satellites measured the sea surface temperature here.", kind: "measured" },
      { icon: "🌡️", text: "If water stays unusually warm for many weeks…", kind: "research" },
      { icon: "🪸", text: "…corals can get stressed and push out their tiny algae…", kind: "research" },
      { icon: "⚪", text: "…so they turn white. This is coral bleaching.", kind: "research" },
      { icon: "🐠", text: "Animals that live in the reef can lose food and shelter.", kind: "research" },
      { icon: "❓", text: "EARTHSONA did not look at any reef here. Bleaching has to be seen by scientists and divers at the reef.", kind: "not-checked" },
    ],
    ask: [
      { q: "Is the coral here bleached?", a: "We don't know! Our data is the sea temperature, not pictures of corals. Scientists check reefs by diving and with special reports." },
      { q: "Can corals get better?", a: "Yes, sometimes. If the water cools down in time, corals can take their algae back and get their colour again." },
      { q: "How do scientists watch for danger?", a: "NOAA Coral Reef Watch looks for water that stays hotter than the warmest normal month for several weeks. EARTHSONA does not calculate that." },
    ],
    predict: {
      q: "If the sea stays warmer than usual for many weeks, what could corals do?",
      options: [
        { t: "Get stressed and maybe turn white", ok: true, why: "That's what scientists have seen. Whether it happens depends on how hot and for how long." },
        { t: "Grow ten times faster", ok: false, why: "Too much heat stresses corals. Try again!" },
      ],
    },
    sources: [
      { label: "NOAA Ocean Service: What is coral bleaching?", url: "https://oceanservice.noaa.gov/facts/coral_bleach.html" },
      { label: "NOAA Coral Reef Watch: Degree Heating Weeks", url: "https://coralreefwatch.noaa.gov/product/5km/tutorial/crw10a_dhw_product.php" },
      { label: "NOAA Ocean Service: How does climate change affect coral reefs?", url: "https://oceanservice.noaa.gov/facts/coralreef-climate.html" },
    ],
  },
  forest: {
    title: "Plants, seasons and animals",
    scene: [
      { emoji: "🌳", name: "Tree", fact: "Trees use sunlight, water and air to make their food. Their leaves reflect infrared light that satellites can see.", x: 20, y: 55 },
      { emoji: "🦜", name: "Bird", fact: "Birds need trees for nests, food and shelter.", x: 58, y: 22 },
      { emoji: "🌧️", name: "Rain cloud", fact: "Rain gives plants the water they need to grow.", x: 82, y: 14 },
      { emoji: "🐒", name: "Monkey", fact: "Many animals eat leaves, fruit and seeds from plants.", x: 70, y: 62 },
      { emoji: "🛰️", name: "Satellite", fact: "A satellite camera compares red and infrared light to see how green the land looks.", x: 18, y: 12 },
    ],
    chain: [
      { icon: "🛰️", text: "Satellites measured how green the land looks here (NDVI and EVI).", kind: "measured" },
      { icon: "🍂", text: "Greenness goes up and down with seasons, rain, sunshine and temperature.", kind: "research" },
      { icon: "💧", text: "When plants get less water or light, they can look less green.", kind: "research" },
      { icon: "🦜", text: "Animals depend on plants for food and shelter.", kind: "research" },
      { icon: "❓", text: "Less green does not prove that trees were cut down. EARTHSONA did not check for tree loss here.", kind: "not-checked" },
    ],
    ask: [
      { q: "Does less green mean trees were cut down?", a: "Not by itself! Dry seasons, clouds or snow can also change greenness. Scientists use other maps to check for tree loss." },
      { q: "Why does greenness change in a year?", a: "Many plants grow more leaves in the wet or warm season and fewer in the dry or cold season." },
      { q: "What does the satellite really see?", a: "It sees light! Healthy leaves reflect lots of infrared light and soak up red light." },
    ],
    predict: {
      q: "What could happen to the forest after a long dry season?",
      options: [
        { t: "It might look less green for a while", ok: true, why: "Yes, plants can look less green when they get less water. They often green up again when the rain comes back." },
        { t: "It turns blue", ok: false, why: "Forests don't turn blue! Try again." },
      ],
    },
    sources: [
      { label: "NASA Earth Observatory: Measuring Vegetation (NDVI & EVI)", url: "https://earthobservatory.nasa.gov/features/MeasuringVegetation" },
    ],
  },
  pulse: {
    title: "Rain, sunshine and living things",
    scene: [
      { emoji: "☀️", name: "Sun", fact: "The Sun's energy warms the land and helps plants grow.", x: 84, y: 14 },
      { emoji: "🌧️", name: "Rain cloud", fact: "Rain fills rivers, lakes and the soil with water.", x: 24, y: 16 },
      { emoji: "🌾", name: "Plants", fact: "Plants need the right amount of water: not too little, not too much.", x: 30, y: 70 },
      { emoji: "🏞️", name: "River", fact: "Rivers carry rainwater. After very heavy rain they can overflow.", x: 70, y: 66 },
      { emoji: "🧮", name: "Computer model", fact: "NASA computer models combine many measurements to estimate temperature and rain everywhere.", x: 52, y: 38 },
    ],
    chain: [
      { icon: "🧮", text: "A NASA model estimated temperature, rain and sunshine here.", kind: "measured" },
      { icon: "🏜️", text: "A long time with too little rain can lead to drought: plants and people can run short of water.", kind: "research" },
      { icon: "🌊", text: "A lot of rain in a short time can cause floods.", kind: "research" },
      { icon: "🌡️", text: "Temperature and sunshine affect how plants grow and how animals and people feel.", kind: "research" },
      { icon: "❓", text: "One dry or rainy month does not prove a drought or a flood. EARTHSONA did not check for either here.", kind: "not-checked" },
    ],
    ask: [
      { q: "Was there a drought here?", a: "Our numbers can't tell us that alone. A drought is a long dry period, and experts look at many things before calling it one." },
      { q: "Where do these numbers come from?", a: "From NASA POWER. A computer model combines satellite and weather-station measurements to estimate them." },
      { q: "Why does the sound get brighter?", a: "More sunshine energy reaching the ground makes EARTHSONA's sound brighter. That's our music rule." },
    ],
    predict: {
      q: "What could happen after many days of very heavy rain?",
      options: [
        { t: "Rivers could overflow and cause floods", ok: true, why: "Yes, lots of rain in a short time can make rivers rise and flood." },
        { t: "The rain turns into sand", ok: false, why: "Rain stays water! Try again." },
      ],
    },
    sources: [
      { label: "Drought.gov: What is drought?", url: "https://www.drought.gov/what-is-drought" },
      { label: "NOAA NSSL: Severe Weather 101, Floods", url: "https://www.nssl.noaa.gov/education/svrwx101/floods/" },
    ],
  },
};

export const CHAIN_LABEL: Record<ChainKind, string> = {
  measured: "Real data from the dataset",
  research: "What research says can happen",
  "not-checked": "Not checked for this place",
};

// ---------------------------------------------------------------------------
// "What would you do?" (Scene 9)
// ---------------------------------------------------------------------------
export const GAME: { icon: string; situation: string; q: string; options: Choice[] }[] = [
  {
    icon: "🏖️",
    situation: "You find rubbish on the beach.",
    q: "How can you help keep the beach clean?",
    options: [
      { t: "Ask an adult and put it in a bin", ok: true, why: "Super! Rubbish in the bin can't wash into the sea. Always ask an adult before picking things up." },
      { t: "Push it into the sea", ok: false, why: "The sea animals wouldn't like that. Try another idea!" },
    ],
  },
  {
    icon: "🪴",
    situation: "A plant at school is drooping and dry.",
    q: "What does the plant need?",
    options: [
      { t: "Some water and a sunny spot", ok: true, why: "Yes! Water and light help plants stay healthy." },
      { t: "A dark cupboard", ok: false, why: "Plants need light to make food. Try again!" },
    ],
  },
  {
    icon: "🚰",
    situation: "A tap is left running.",
    q: "How can you save water?",
    options: [
      { t: "Turn the tap off", ok: true, why: "Well done! Every drop counts." },
      { t: "Leave it on, it's fine", ok: false, why: "Drinking water is precious. Try again!" },
    ],
  },
  {
    icon: "🐢",
    situation: "A reef is home to many sea animals.",
    q: "How can we protect their home?",
    options: [
      { t: "Look, don't touch, and keep the water clean", ok: true, why: "Perfect! Gentle visitors help reefs stay healthy." },
      { t: "Take some coral home", ok: false, why: "Corals are living animals and should stay in the reef. Try again!" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Progress (per viewer, in this browser only)
// ---------------------------------------------------------------------------
export interface MissionProgress {
  step: number;
  done: boolean[];
  badge: boolean;
}
export interface Progress {
  intro: boolean;
  game: boolean;
  finale: boolean;
  name: string;
  ocean: MissionProgress;
  forest: MissionProgress;
  pulse: MissionProgress;
}

const blank = (): MissionProgress => ({ step: 0, done: [false, false, false, false, false, false, false], badge: false });
export const emptyProgress = (): Progress => ({ intro: false, game: false, finale: false, name: "", ocean: blank(), forest: blank(), pulse: blank() });

export function loadProgress(): Progress {
  const p = loadPref<Progress>("missions1", emptyProgress());
  for (const id of ["ocean", "forest", "pulse"] as const) {
    const m = p[id];
    if (!m || !Array.isArray(m.done) || m.done.length !== STEPS.length) p[id] = blank();
  }
  return p;
}
export const saveProgress = (p: Progress) => savePref("missions1", p);
export const badgeCount = (p: Progress) => (["ocean", "forest", "pulse"] as const).filter((id) => p[id].badge).length;
