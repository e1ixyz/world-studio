// The studio's themes. A theme is a set of CSS variables (themes.css) applied by
// <html data-theme="…"> in the studio page and, over the bridge, in the game frame, plus the web
// fonts it needs. The choice is a studio setting (.harness/settings.json), so the browser and the
// desktop app share it.

export const THEME_IDS = ['control-room', 'floating', 'blueprint', 'terminal', 'arcade', 'atlas'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DEFAULT_THEME: ThemeId = 'control-room';

export interface Theme {
  id: ThemeId;
  name: string;
  blurb: string;
  // ground, panel, accent, selection: for the picker's swatches
  swatches: [string, string, string, string];
  // Google Fonts css2 `family=` values
  fonts: string[];
}

export const THEMES: Theme[] = [
  {
    id: 'control-room',
    name: 'Control Room',
    blurb: 'Dark navy, cyan and Chakra Petch. The original.',
    swatches: ['#070b12', '#0b111c', '#3cf2ff', '#ffd24a'],
    fonts: ['Chakra+Petch:wght@400;500;600;700'],
  },
  {
    id: 'floating',
    name: 'Floating Canvas',
    blurb: 'Light, rounded panels floating over a full-bleed world.',
    swatches: ['#f4f4f6', '#ffffff', '#5b38f0', '#f0b429'],
    fonts: ['Manrope:wght@400;500;600;700;800'],
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    blurb: 'Drafting sheet: navy, white line work, yellow marker.',
    swatches: ['#0e2c54', '#0b2547', '#ffd34d', '#7fe0ff'],
    fonts: ['IBM+Plex+Sans+Condensed:wght@400;600;700', 'IBM+Plex+Mono:wght@400;500;600'],
  },
  {
    id: 'terminal',
    name: 'Terminal',
    blurb: 'Phosphor green and amber, all monospace.',
    swatches: ['#0a0c0a', '#050605', '#c8f7c5', '#ffb000'],
    fonts: ['JetBrains+Mono:wght@400;500;700'],
  },
  {
    id: 'arcade',
    name: 'Arcade',
    blurb: 'Purple cabinet, pixel headings, offset shadows.',
    swatches: ['#1b0f3b', '#2a1a5e', '#ffe14d', '#4dffb8'],
    fonts: ['Press+Start+2P', 'Space+Mono:wght@400;700'],
  },
  {
    id: 'atlas',
    name: 'Atlas',
    blurb: 'Sage paper, deep teal and ochre, map-like.',
    swatches: ['#dde4d3', '#f1f4ec', '#0f5e66', '#b7791f'],
    fonts: ['Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800', 'DM+Mono:wght@400;500'],
  },
];

export const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

// The last theme this browser profile used, so a page paints in it before settings arrive.
const STORAGE_KEY = 'worldstudio:theme';
export function rememberedTheme(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isThemeId(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

// Sets data-theme on <html>, loads the theme's fonts once, and remembers the choice.
export function applyTheme(id: string, doc: Document = document) {
  const theme = themeById(id);
  doc.documentElement.dataset.theme = theme.id;
  const linkId = `ws-theme-fonts-${theme.id}`;
  if (!doc.getElementById(linkId) && theme.fonts.length) {
    const link = doc.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${theme.fonts.map((f) => `family=${f}`).join('&')}&display=swap`;
    doc.head.appendChild(link);
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    /* storage blocked */
  }
  return theme.id;
}
