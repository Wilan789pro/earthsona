import type { ExperienceId } from "../data/types";

/**
 * Luna's "Tell me more" tips: short (about 5–12 s when spoken), one idea each. Spoken by Luna's voice
 * (see luna.ts) and always shown in her speech bubble.
 */
export const TIPS: Record<ExperienceId, string[]> = {
  ocean: [
    "Satellites measure how warm the top of the sea is. Warmer water makes higher notes in the music.",
    "When the sea is warmer than usual for that time of year, the music sounds a bit tense. Near normal, it sounds calm.",
    "The waves you hear are made by the computer. Warmer water makes them sound brighter and fizzier.",
  ],
  forest: [
    "Plants reflect a kind of light our eyes can't see. Satellites use it to measure how green a forest is.",
    "Greener forest makes higher notes and more birds and insects. If clouds hid the forest, you hear a soft tick instead.",
    "Greenness is not the same as counting trees. It shows how leafy the plants look from space.",
  ],
  pulse: [
    "Warmer air makes higher notes. More rain makes busier beats and a heavier rain sound.",
    "More sunshine makes the music brighter and brings out more birds. Listen to the seasons come and go.",
    "These numbers come from a NASA computer model that uses lots of measurements. They are estimates, not thermometer readings.",
  ],
};
