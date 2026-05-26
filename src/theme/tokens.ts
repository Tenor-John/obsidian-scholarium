// tokens.ts — Scholarium design tokens (ported from design_handoff prototype/src/tokens.jsx)
// Single source of truth for theme / accent / density. Emitted as --sch-* CSS variables
// by main.ts injectThemeVars(); imperative-DOM components read those variables.

export type ThemeKey = 'light' | 'dark' | 'scholar';
export type AccentKey = 'amber' | 'indigo' | 'emerald' | 'plum';
export type DensityKey = 'compact' | 'regular' | 'spacious';
export type Lang = 'zh' | 'en';

export interface ThemeTokens {
    name: { zh: string; en: string };
    bg: string;
    bgDeep: string;
    surface: string;
    surface2: string;
    line: string;
    lineSoft: string;
    ink: string;
    ink2: string;
    mute: string;
    muteSoft: string;
    paper: string;
}

export interface AccentTokens {
    name: { zh: string; en: string };
    hue: number;
    base: string;
    soft: string;
    ink: string;
}

export interface DensityTokens {
    name: { zh: string; en: string };
    pad: number;
    gap: number;
    radius: number;
    body: number;
    h1: number;
}

export const SCHOLARIUM_THEMES: Record<ThemeKey, ThemeTokens> = {
    light: {
        name: { zh: '日间', en: 'Light' },
        bg:        'oklch(0.985 0.005 80)',
        bgDeep:    'oklch(0.96 0.008 80)',
        surface:   '#ffffff',
        surface2:  'oklch(0.985 0.005 80)',
        line:      'oklch(0.91 0.006 80)',
        lineSoft:  'oklch(0.94 0.005 80)',
        ink:       'oklch(0.22 0.02 270)',
        ink2:      'oklch(0.36 0.02 270)',
        mute:      'oklch(0.55 0.012 270)',
        muteSoft:  'oklch(0.70 0.008 270)',
        paper:     'radial-gradient(1200px 800px at 80% -20%, oklch(0.98 0.025 60 / .55), transparent 55%), radial-gradient(1000px 700px at -10% 110%, oklch(0.98 0.02 220 / .45), transparent 55%), oklch(0.985 0.005 80)',
    },
    dark: {
        name: { zh: '夜间', en: 'Dark' },
        bg:        'oklch(0.165 0.012 270)',
        bgDeep:    'oklch(0.135 0.012 270)',
        surface:   'oklch(0.205 0.012 270)',
        surface2:  'oklch(0.235 0.012 270)',
        line:      'oklch(0.28 0.012 270)',
        lineSoft:  'oklch(0.24 0.012 270)',
        ink:       'oklch(0.94 0.005 80)',
        ink2:      'oklch(0.80 0.008 80)',
        mute:      'oklch(0.62 0.012 270)',
        muteSoft:  'oklch(0.45 0.012 270)',
        paper:     'radial-gradient(1200px 800px at 80% -20%, oklch(0.30 0.06 30 / .25), transparent 55%), radial-gradient(1000px 700px at -10% 110%, oklch(0.30 0.06 250 / .25), transparent 55%), oklch(0.165 0.012 270)',
    },
    scholar: {
        name: { zh: '素雅', en: 'Scholarly' },
        bg:        'oklch(0.965 0.015 75)',
        bgDeep:    'oklch(0.94 0.02 75)',
        surface:   'oklch(0.99 0.008 75)',
        surface2:  'oklch(0.97 0.013 75)',
        line:      'oklch(0.86 0.015 65)',
        lineSoft:  'oklch(0.90 0.012 70)',
        ink:       'oklch(0.20 0.025 35)',
        ink2:      'oklch(0.34 0.025 35)',
        mute:      'oklch(0.50 0.022 35)',
        muteSoft:  'oklch(0.68 0.015 50)',
        paper:     "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.85' numOctaves='2' seed='3'/%3E%3CfeColorMatrix values='0 0 0 0 0.55  0 0 0 0 0.42  0 0 0 0 0.20  0 0 0 0.035 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\"), oklch(0.965 0.015 75)",
    },
};

export const SCHOLARIUM_ACCENTS: Record<AccentKey, AccentTokens> = {
    amber:   { name: { zh: '琥珀', en: 'Amber'   }, hue: 38,  base: 'oklch(0.66 0.16 38)',  soft: 'oklch(0.92 0.07 38)',  ink: 'oklch(0.40 0.16 38)' },
    indigo:  { name: { zh: '靛蓝', en: 'Indigo'  }, hue: 264, base: 'oklch(0.55 0.17 264)', soft: 'oklch(0.94 0.05 264)', ink: 'oklch(0.36 0.17 264)' },
    emerald: { name: { zh: '青松', en: 'Emerald' }, hue: 162, base: 'oklch(0.58 0.12 162)', soft: 'oklch(0.94 0.05 162)', ink: 'oklch(0.36 0.13 162)' },
    plum:    { name: { zh: '梅紫', en: 'Plum'    }, hue: 340, base: 'oklch(0.58 0.15 340)', soft: 'oklch(0.94 0.05 340)', ink: 'oklch(0.36 0.15 340)' },
};

// Semantic accents — constant regardless of primary accent.
// Each carries a foreground (fg) + soft background (bg) pair used by Pill tones.
export const SCHOLARIUM_SEMANTIC = {
    rose:  { base: 'oklch(0.62 0.17 18)',  fg: 'oklch(0.42 0.18 18)',  bg: 'oklch(0.95 0.04 18)' },
    sun:   { base: 'oklch(0.78 0.14 78)',  fg: 'oklch(0.40 0.13 78)',  bg: 'oklch(0.95 0.07 78)' },
    moss:  { base: 'oklch(0.58 0.10 142)', fg: 'oklch(0.36 0.10 142)', bg: 'oklch(0.94 0.05 142)' },
    sky:   { base: 'oklch(0.62 0.12 232)', fg: 'oklch(0.36 0.13 232)', bg: 'oklch(0.94 0.05 232)' },
    iris:  { base: 'oklch(0.58 0.15 290)', fg: 'oklch(0.36 0.15 290)', bg: 'oklch(0.94 0.05 290)' },
    coral: { base: 'oklch(0.70 0.14 30)',  fg: 'oklch(0.42 0.16 30)',  bg: 'oklch(0.95 0.05 30)' },
} as const;

export type SemanticKey = keyof typeof SCHOLARIUM_SEMANTIC;

export const SCHOLARIUM_DENSITY: Record<DensityKey, DensityTokens> = {
    compact:  { name: { zh: '紧凑', en: 'Compact'  }, pad: 14, gap: 10, radius: 12, body: 13.5, h1: 26 },
    regular:  { name: { zh: '标准', en: 'Standard' }, pad: 18, gap: 14, radius: 16, body: 14.5, h1: 30 },
    spacious: { name: { zh: '宽松', en: 'Spacious' }, pad: 22, gap: 18, radius: 20, body: 15.5, h1: 34 },
};

export const FONT_UI    = "'Inter Tight', system-ui, -apple-system, sans-serif";
export const FONT_SERIF = "'Source Serif 4', Georgia, serif";
export const FONT_MONO  = "'JetBrains Mono', ui-monospace, monospace";

/**
 * Build the CSS text that defines all --sch-* variables for the given
 * theme / accent / density. Scoped to `.scholarium-dashboard` so the plugin's
 * tokens never leak into the rest of Obsidian.
 */
function hexToRgb(hex: string): [number, number, number] {
    const c = (hex || '').replace('#', '');
    if (c.length !== 6) return [255, 112, 67];
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}
function mixRgb(a: [number, number, number], b: [number, number, number], t: number): string {
    const m = (x: number, y: number) => Math.round(x + (y - x) * t);
    return `rgb(${m(a[0], b[0])}, ${m(a[1], b[1])}, ${m(a[2], b[2])})`;
}
/** Derive accent base/soft/ink from a user hex, theme-aware so it reads well in dark mode. */
export function accentVarsFromHex(hex: string, themeKey: ThemeKey): { base: string; soft: string; ink: string } {
    const rgb = hexToRgb(hex);
    const dark = themeKey === 'dark';
    return {
        base: hex,
        soft: dark ? mixRgb(rgb, [22, 22, 30], 0.74) : mixRgb(rgb, [255, 255, 255], 0.86),
        ink:  dark ? mixRgb(rgb, [255, 255, 255], 0.34) : mixRgb(rgb, [0, 0, 0], 0.32),
    };
}

export function scholariumThemeCss(themeKey: ThemeKey, accentKey: AccentKey, densityKey: DensityKey, accentHex?: string): string {
    const th = SCHOLARIUM_THEMES[themeKey] ?? SCHOLARIUM_THEMES.scholar;
    const preset = SCHOLARIUM_ACCENTS[accentKey] ?? SCHOLARIUM_ACCENTS.amber;
    // If a user hex is supplied it drives the accent (so the brand bar follows the colour picker).
    const ac = accentHex
        ? { ...accentVarsFromHex(accentHex, themeKey), hue: preset.hue }
        : preset;
    const dn = SCHOLARIUM_DENSITY[densityKey] ?? SCHOLARIUM_DENSITY.regular;

    const sem = SCHOLARIUM_SEMANTIC;
    return `
.scholarium-dashboard {
    --sch-bg:          ${th.bg};
    --sch-bg-deep:     ${th.bgDeep};
    --sch-surface:     ${th.surface};
    --sch-surface2:    ${th.surface2};
    --sch-line:        ${th.line};
    --sch-line-soft:   ${th.lineSoft};
    --sch-ink:         ${th.ink};
    --sch-ink2:        ${th.ink2};
    --sch-mute:        ${th.mute};
    --sch-mute-soft:   ${th.muteSoft};
    --sch-paper:       ${th.paper};

    --sch-accent:      ${ac.base};
    --sch-accent-soft: ${ac.soft};
    --sch-accent-ink:  ${ac.ink};
    --sch-accent-hue:  ${ac.hue};

    --sch-rose:  ${sem.rose.base};
    --sch-sun:   ${sem.sun.base};
    --sch-moss:  ${sem.moss.base};
    --sch-sky:   ${sem.sky.base};
    --sch-iris:  ${sem.iris.base};
    --sch-coral: ${sem.coral.base};

    --sch-rose-fg:  ${sem.rose.fg};   --sch-rose-bg:  ${sem.rose.bg};
    --sch-sun-fg:   ${sem.sun.fg};    --sch-sun-bg:   ${sem.sun.bg};
    --sch-moss-fg:  ${sem.moss.fg};   --sch-moss-bg:  ${sem.moss.bg};
    --sch-sky-fg:   ${sem.sky.fg};    --sch-sky-bg:   ${sem.sky.bg};
    --sch-iris-fg:  ${sem.iris.fg};   --sch-iris-bg:  ${sem.iris.bg};
    --sch-coral-fg: ${sem.coral.fg};  --sch-coral-bg: ${sem.coral.bg};

    --sch-pad:    ${dn.pad}px;
    --sch-gap:    ${dn.gap}px;
    --sch-radius: ${dn.radius}px;
    --sch-radius-inset: ${Math.max(4, dn.radius - 4)}px;
    --sch-body:   ${dn.body}px;
    --sch-h1:     ${dn.h1}px;

    --sch-font-ui:    ${FONT_UI};
    --sch-font-serif: ${FONT_SERIF};
    --sch-font-mono:  ${FONT_MONO};
}`;
}
