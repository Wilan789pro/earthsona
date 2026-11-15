import type { ExperienceId } from "./types";

/**
 * NASA Earth Information Center / Scientific Visualization Studio videos shown as CONTEXT in each mission.
 * Optimised copies (public/media/eic, H.264 fast-start, no audio) of the team's downloads; the originals are kept
 * untouched outside the build. They are NOT synchronised with the sonified data: different products, regions and
 * dates (each `relation` says how). Credits follow the SVS pages ("Please give credit for this item to").
 */
export interface EicVideo {
  file: string;
  poster: string;
  title: string;
  svsId: number;
  svsUrl: string;
  product: string;
  coverage: string;
  /** How the video relates to what you hear: never claims synchronisation. */
  relation: string;
  credit: string;
  /** Text alternative for screen-reader users. */
  description: string;
  kid: string;
}

const base = `${import.meta.env?.BASE_URL ?? "/"}media/eic/`;

export const EIC_VIDEOS: Record<ExperienceId, EicVideo> = {
  ocean: {
    file: `${base}ocean-mur-sst.mp4`,
    poster: `${base}ocean-mur-sst.jpg`,
    title: "Sea Surface Temperature (SST), Near Real Time",
    svsId: 5101,
    svsUrl: "https://svs.gsfc.nasa.gov/5101/",
    product: "NASA/JPL Multi-scale Ultra-high Resolution (MUR) SST analysis v4.1, daily",
    coverage: "The whole ocean, about the last two and a half years; the date is shown in the lower-left corner.",
    relation:
      "Context only. The music you hear uses a different dataset: NOAA Coral Reef Watch CoralTemp at one point near your chosen place (2020–2024). The video and the sound are not synchronised.",
    credit: "NASA's Scientific Visualization Studio. Visualizers: Kel Elkins (USRA), Greg Shirah (NASA/GSFC).",
    description:
      "A flat world map. The oceans are coloured by surface temperature: dark red and orange near the equator are the warmest water, light blue and dark blue towards the poles are the coldest. Land is grey. As the dates change, warm water spreads north and south with the seasons.",
    kid: "Watch the whole ocean warm up and cool down with the seasons!",
  },
  forest: {
    file: `${base}forest-nrt-ndvi.mp4`,
    poster: `${base}forest-nrt-ndvi.jpg`,
    title: "Near Real-Time Normalized Difference Vegetation Index (NDVI)",
    svsId: 5544,
    svsUrl: "https://svs.gsfc.nasa.gov/5544/",
    product: "Near-real-time NDVI (vegetation greenness) from NASA satellites; the SVS page does not name the exact data product",
    coverage: "All land, about the last two and a half years (per NASA SVS). This version shows no dates.",
    relation:
      "Context only. The music you hear uses NASA MODIS MOD13Q1 NDVI at one point (16-day steps, 2020–2024) and our team's own MODIS file. The video and the sound are not synchronised.",
    credit: "NASA's Scientific Visualization Studio. Data visualizer: Alex Kekesi (Global Science and Technology, Inc.).",
    description:
      "A flat world map of the land. Dark green shows lots of healthy plants, such as rainforests; tan and white show few plants, such as deserts and snow near the poles. The green areas grow and shrink through the year with the seasons.",
    kid: "Watch the land turn greener and browner with the seasons!",
  },
  pulse: {
    file: `${base}pulse-imerg.mp4`,
    poster: `${base}pulse-imerg.jpg`,
    title: "Near Real-Time Global Precipitation (GPM IMERG)",
    svsId: 4285,
    svsUrl: "https://svs.gsfc.nasa.gov/4285/",
    product: "NASA GPM IMERG near-real-time precipitation (rain and snow rates, every 30 minutes)",
    coverage: "The whole planet over a few days before it was downloaded; the date and time (UTC) are shown in the corner.",
    relation:
      "Context only. The music you hear uses NASA POWER rain, temperature and sunshine at ONE place (monthly or daily averages, 2015–2024), a different dataset from these storms. The video and the sound are not synchronised.",
    credit: "NASA's Scientific Visualization Studio. Animator: Horace Mitchell (NASA/GSFC). Scientists: George Huffman, Gail Skofronick Jackson, Dalia B Kirschbaum (NASA/GSFC).",
    description:
      "A flat world map with the land in natural colours and the oceans dark. Moving patches show rain and snow: green and yellow for light rain, orange and red for heavy rain, light blue to purple for snow. Storms swirl and move from west to east; colour keys for liquid and frozen precipitation (mm per hour) are at the bottom.",
    kid: "Watch rain and snow storms travel around the planet!",
  },
};
