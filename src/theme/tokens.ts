// tokens.ts — Scholarium design tokens (ported from design_handoff prototype/src/tokens.jsx)
// Single source of truth for theme / accent / density. Emitted as --sch-* CSS variables
// by main.ts injectThemeVars(); imperative-DOM components read those variables.

export type ThemeKey = 'light' | 'dark';
export type ThemeModeKey = ThemeKey | 'system';
export type AccentKey = AccentPresetKey | 'custom';
export type AccentPresetKey =
    | 'green' | 'teal' | 'blue' | 'purple' | 'amber' | 'coral'
    | 'classic-coral' | 'academic-blue' | 'jade' | 'lavender'
    | 'classic-teal' | 'rose' | 'rock-brown' | 'turquoise';
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
    deep: string;
    text: string;
    rgb: string;
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
        bg:        '#f5f4f0',
        bgDeep:    '#f0ede8',
        surface:   '#faf9f7',
        surface2:  '#ede9e3',
        line:      'rgba(0,0,0,0.08)',
        lineSoft:  'rgba(0,0,0,0.06)',
        ink:       '#1a1a18',
        ink2:      '#5a5955',
        mute:      '#9a9790',
        muteSoft:  '#b8b5b0',
        paper:     '#f5f4f0',
    },
    dark: {
        name: { zh: '夜间', en: 'Dark' },
        bg:        '#0a0a0a',
        bgDeep:    '#111111',
        surface:   '#141414',
        surface2:  '#1c1c1c',
        line:      'rgba(255,255,255,0.07)',
        lineSoft:  'rgba(255,255,255,0.07)',
        ink:       '#e8e8e8',
        ink2:      '#888888',
        mute:      '#888888',
        muteSoft:  '#555555',
        paper:     '#0a0a0a',
    },
};

export const SCHOLARIUM_ACCENTS: Record<AccentPresetKey, AccentTokens> = {
    green:  { name: { zh: '绿色', en: 'Green' },  hue: 152, base: '#1aff8c', soft: 'rgba(26,255,140,0.10)',  ink: '#1aff8c', deep: '#0f6e56', text: '#0a0a0a', rgb: '26, 255, 140' },
    teal:   { name: { zh: '青色', en: 'Teal' },   hue: 177, base: '#00d4c8', soft: 'rgba(0,212,200,0.10)',   ink: '#00d4c8', deep: '#0a5f5c', text: '#0a0a0a', rgb: '0, 212, 200' },
    blue:   { name: { zh: '蓝色', en: 'Blue' },   hue: 212, base: '#4d9fff', soft: 'rgba(77,159,255,0.10)',  ink: '#4d9fff', deep: '#1a4a80', text: '#0a0a0a', rgb: '77, 159, 255' },
    purple: { name: { zh: '紫色', en: 'Purple' }, hue: 255, base: '#a78bfa', soft: 'rgba(167,139,250,0.10)', ink: '#a78bfa', deep: '#4c3580', text: '#0a0a0a', rgb: '167, 139, 250' },
    amber:  { name: { zh: '琥珀', en: 'Amber' },  hue: 43,  base: '#fbbf24', soft: 'rgba(251,191,36,0.10)',  ink: '#fbbf24', deep: '#7a5a10', text: '#0a0a0a', rgb: '251, 191, 36' },
    coral:  { name: { zh: '珊瑚', en: 'Coral' },  hue: 6,   base: '#ff7c6e', soft: 'rgba(255,124,110,0.10)', ink: '#ff7c6e', deep: '#7a2a20', text: '#0a0a0a', rgb: '255, 124, 110' },
    'classic-coral': { name: { zh: '橙红', en: 'Classic coral' }, hue: 14, base: '#ff7043', soft: 'rgba(255,112,67,0.10)', ink: '#ff7043', deep: '#e64a19', text: '#0a0a0a', rgb: '255, 112, 67' },
    'academic-blue': { name: { zh: '学术蓝', en: 'Academic blue' }, hue: 210, base: '#1976d2', soft: 'rgba(25,118,210,0.10)', ink: '#1976d2', deep: '#0d47a1', text: '#ffffff', rgb: '25, 118, 210' },
    jade: { name: { zh: '翠绿', en: 'Jade' }, hue: 124, base: '#2e7d32', soft: 'rgba(46,125,50,0.10)', ink: '#2e7d32', deep: '#1b5e20', text: '#ffffff', rgb: '46, 125, 50' },
    lavender: { name: { zh: '薰衣草', en: 'Lavender' }, hue: 291, base: '#7b1fa2', soft: 'rgba(123,31,162,0.10)', ink: '#7b1fa2', deep: '#4a148c', text: '#ffffff', rgb: '123, 31, 162' },
    'classic-teal': { name: { zh: '经典青色', en: 'Classic teal' }, hue: 186, base: '#00838f', soft: 'rgba(0,131,143,0.10)', ink: '#00838f', deep: '#006064', text: '#ffffff', rgb: '0, 131, 143' },
    rose: { name: { zh: '玫瑰粉', en: 'Rose' }, hue: 333, base: '#c2185b', soft: 'rgba(194,24,91,0.10)', ink: '#c2185b', deep: '#880e4f', text: '#ffffff', rgb: '194, 24, 91' },
    'rock-brown': { name: { zh: '岩棕', en: 'Rock brown' }, hue: 27, base: '#6b5b4d', soft: 'rgba(107,91,77,0.10)', ink: '#6b5b4d', deep: '#3e342b', text: '#ffffff', rgb: '107, 91, 77' },
    turquoise: { name: { zh: '松石青', en: 'Turquoise' }, hue: 180, base: '#008080', soft: 'rgba(0,128,128,0.10)', ink: '#008080', deep: '#005454', text: '#ffffff', rgb: '0, 128, 128' },
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
 * theme / accent / density. Scoped to `.scholarium-root` so tokens only affect
 * plugin views and its settings panel.
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
/** Derive compatible accent values for legacy custom colors. */
export function accentVarsFromHex(hex: string, _themeKey: ThemeKey): { base: string; soft: string; ink: string; deep: string; text: string; rgb: string } {
    const rgb = hexToRgb(hex);
    return {
        base: hex,
        soft: `rgba(${rgb.join(', ')}, 0.10)`,
        ink: hex,
        deep: mixRgb(rgb, [0, 0, 0], 0.55),
        text: '#0a0a0a',
        rgb: rgb.join(', '),
    };
}

export function scholariumThemeCss(themeKey: ThemeKey, accentKey: AccentKey, densityKey: DensityKey, accentHex?: string): string {
    const dn = SCHOLARIUM_DENSITY[densityKey] ?? SCHOLARIUM_DENSITY.regular;
    const sem = SCHOLARIUM_SEMANTIC;
    return `
.scholarium-root[data-theme="light"] {
    --bg-base: #f5f4f0; --bg-panel: #f0ede8; --bg-surface: #faf9f7; --bg-elevated: #ede9e3;
    --text-primary: #1a1a18; --text-secondary: #5a5955; --text-muted: #9a9790; --text-placeholder: #b8b5b0;
    --border: rgba(0,0,0,0.08); --border-soft: rgba(0,0,0,0.06); --border-strong: rgba(0,0,0,0.14);
    --sch-rose-fg: #a83c5d; --sch-rose-bg: rgba(194,24,91,0.12);
    --sch-sun-fg: #936107; --sch-sun-bg: rgba(251,191,36,0.17);
    --sch-moss-fg: #197147; --sch-moss-bg: rgba(26,140,90,0.12);
    --sch-sky-fg: #246b9b; --sch-sky-bg: rgba(77,159,255,0.13);
    --sch-iris-fg: #6848ad; --sch-iris-bg: rgba(167,139,250,0.15);
    --sch-coral-fg: #a54a37; --sch-coral-bg: rgba(255,124,110,0.15);
}
.scholarium-root[data-theme="dark"] {
    --bg-base: #0a0a0a; --bg-panel: #111111; --bg-surface: #141414; --bg-elevated: #1c1c1c;
    --text-primary: #f3f3f1; --text-secondary: #c0c0ba; --text-muted: #969690; --text-placeholder: #85857f;
    --border: rgba(255,255,255,0.07); --border-soft: rgba(255,255,255,0.07); --border-strong: rgba(255,255,255,0.13);
    --sch-rose-fg: #ff81a0; --sch-rose-bg: rgba(255,100,140,0.15);
    --sch-sun-fg: #fbc63a; --sch-sun-bg: rgba(251,191,36,0.17);
    --sch-moss-fg: #49d994; --sch-moss-bg: rgba(26,255,140,0.12);
    --sch-sky-fg: #78bbff; --sch-sky-bg: rgba(77,159,255,0.15);
    --sch-iris-fg: #c3adff; --sch-iris-bg: rgba(167,139,250,0.16);
    --sch-coral-fg: #ff9a8e; --sch-coral-bg: rgba(255,124,110,0.16);
}
.scholarium-root[data-accent="green"] { --accent:#1aff8c; --accent-rgb:26,255,140; --accent-dim:rgba(26,255,140,0.10); --accent-deep:#0f6e56; --accent-text:#0a0a0a; --accent-hue:152; }
.scholarium-root[data-accent="teal"] { --accent:#00d4c8; --accent-rgb:0,212,200; --accent-dim:rgba(0,212,200,0.10); --accent-deep:#0a5f5c; --accent-text:#0a0a0a; --accent-hue:177; }
.scholarium-root[data-accent="blue"] { --accent:#4d9fff; --accent-rgb:77,159,255; --accent-dim:rgba(77,159,255,0.10); --accent-deep:#1a4a80; --accent-text:#0a0a0a; --accent-hue:212; }
.scholarium-root[data-accent="purple"] { --accent:#a78bfa; --accent-rgb:167,139,250; --accent-dim:rgba(167,139,250,0.10); --accent-deep:#4c3580; --accent-text:#0a0a0a; --accent-hue:255; }
.scholarium-root[data-accent="amber"] { --accent:#fbbf24; --accent-rgb:251,191,36; --accent-dim:rgba(251,191,36,0.10); --accent-deep:#7a5a10; --accent-text:#0a0a0a; --accent-hue:43; }
.scholarium-root[data-accent="coral"] { --accent:#ff7c6e; --accent-rgb:255,124,110; --accent-dim:rgba(255,124,110,0.10); --accent-deep:#7a2a20; --accent-text:#0a0a0a; --accent-hue:6; }
.scholarium-root[data-accent="classic-coral"] { --accent:#ff7043; --accent-rgb:255,112,67; --accent-dim:rgba(255,112,67,0.10); --accent-deep:#e64a19; --accent-text:#0a0a0a; --accent-hue:14; }
.scholarium-root[data-accent="academic-blue"] { --accent:#1976d2; --accent-rgb:25,118,210; --accent-dim:rgba(25,118,210,0.10); --accent-deep:#0d47a1; --accent-text:#ffffff; --accent-hue:210; }
.scholarium-root[data-accent="jade"] { --accent:#2e7d32; --accent-rgb:46,125,50; --accent-dim:rgba(46,125,50,0.10); --accent-deep:#1b5e20; --accent-text:#ffffff; --accent-hue:124; }
.scholarium-root[data-accent="lavender"] { --accent:#7b1fa2; --accent-rgb:123,31,162; --accent-dim:rgba(123,31,162,0.10); --accent-deep:#4a148c; --accent-text:#ffffff; --accent-hue:291; }
.scholarium-root[data-accent="classic-teal"] { --accent:#00838f; --accent-rgb:0,131,143; --accent-dim:rgba(0,131,143,0.10); --accent-deep:#006064; --accent-text:#ffffff; --accent-hue:186; }
.scholarium-root[data-accent="rose"] { --accent:#c2185b; --accent-rgb:194,24,91; --accent-dim:rgba(194,24,91,0.10); --accent-deep:#880e4f; --accent-text:#ffffff; --accent-hue:333; }
.scholarium-root[data-accent="rock-brown"] { --accent:#6b5b4d; --accent-rgb:107,91,77; --accent-dim:rgba(107,91,77,0.10); --accent-deep:#3e342b; --accent-text:#ffffff; --accent-hue:27; }
.scholarium-root[data-accent="turquoise"] { --accent:#008080; --accent-rgb:0,128,128; --accent-dim:rgba(0,128,128,0.10); --accent-deep:#005454; --accent-text:#ffffff; --accent-hue:180; }
.scholarium-root {
    --sch-bg: var(--bg-base); --sch-bg-deep: var(--bg-panel); --sch-surface: var(--bg-surface); --sch-surface2: var(--bg-elevated);
    --sch-line: var(--border); --sch-line-soft: var(--border-soft); --sch-ink: var(--text-primary); --sch-ink2: var(--text-secondary);
    --sch-mute: var(--text-muted); --sch-mute-soft: var(--text-placeholder); --sch-paper: var(--bg-base);
    --sch-accent: var(--accent); --sch-accent-soft: var(--accent-dim); --sch-accent-ink: var(--accent); --sch-accent-hue: var(--accent-hue);
    --celn-accent: var(--accent); --celn-accent-rgb: var(--accent-rgb); --celn-accent-light: var(--accent); --celn-accent-light-rgb: var(--accent-rgb);
    --celn-accent-medium: var(--accent); --celn-accent-medium-rgb: var(--accent-rgb); --celn-accent-dark: var(--accent-deep); --celn-accent-dark-rgb: var(--accent-rgb);

    --sch-rose:  ${sem.rose.base};
    --sch-sun:   ${sem.sun.base};
    --sch-moss:  ${sem.moss.base};
    --sch-sky:   ${sem.sky.base};
    --sch-iris:  ${sem.iris.base};
    --sch-coral: ${sem.coral.base};

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
