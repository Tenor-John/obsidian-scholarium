// ui.ts — shared imperative-DOM component primitives for the Scholarium redesign.
// Ported from prototype/src/components.jsx. Each factory creates an HTMLElement
// styled with the --sch-* CSS variables emitted by main.injectThemeVars(),
// so every component restyles automatically when theme/accent/density change.

import { iconSvg } from '../icons';
import type { IconOptions } from '../icons';

type El = HTMLElement;

export type PillTone = 'accent' | 'mute' | 'rose' | 'moss' | 'sky' | 'iris' | 'sun' | 'coral';
export type ButtonVariant = 'primary' | 'ghost' | 'soft' | 'accent' | 'danger';
export type Size = 'sm' | 'md' | 'lg';

/** Small helper: apply a record of style props to an element. */
function applyStyle(el: HTMLElement, style?: Partial<CSSStyleDeclaration>): void {
    if (style) Object.assign(el.style, style);
}

// ─── Icon ──────────────────────────────────────────────────────────────────
export function icon(name: string, opts: IconOptions = {}): SVGSVGElement {
    return iconSvg(name, opts);
}

// ─── Card ────────────────────────────────────────────────────────────────────
export interface CardOptions {
    pad?: boolean;
    hover?: boolean;
    onClick?: () => void;
    cls?: string;
    style?: Partial<CSSStyleDeclaration>;
}

export function card(parent: El, opts: CardOptions = {}): El {
    const el = parent.createDiv({ cls: 'sch-card' + (opts.cls ? ' ' + opts.cls : '') });
    el.style.background = 'var(--sch-surface)';
    el.style.border = '1px solid var(--sch-line)';
    el.style.borderRadius = 'var(--sch-radius)';
    el.style.padding = opts.pad === false ? '0' : 'var(--sch-pad)';
    el.style.boxShadow = '0 1px 2px rgba(0,0,0,.02), 0 1px 0 rgba(255,255,255,.5) inset';
    el.style.transition = 'transform .18s ease, box-shadow .18s ease, border-color .18s ease';
    if (opts.hover || opts.onClick) el.classList.add('sch-card--hover');
    if (opts.onClick) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', opts.onClick);
    }
    applyStyle(el, opts.style);
    return el;
}

// Inset sub-surface (one shade darker) inside a card
export function insetBlock(parent: El, opts: { pad?: boolean; style?: Partial<CSSStyleDeclaration> } = {}): El {
    const el = parent.createDiv({ cls: 'sch-inset' });
    el.style.background = 'var(--sch-surface2)';
    el.style.border = '1px solid var(--sch-line-soft)';
    el.style.borderRadius = 'var(--sch-radius-inset)';
    el.style.padding = opts.pad === false ? '0' : 'calc(var(--sch-pad) - 4px)';
    applyStyle(el, opts.style);
    return el;
}

// ─── Pill ────────────────────────────────────────────────────────────────────
const PILL_FG: Record<PillTone, string> = {
    accent: 'var(--sch-accent-ink)', mute: 'var(--sch-ink2)',
    rose: 'var(--sch-rose-fg)', moss: 'var(--sch-moss-fg)', sky: 'var(--sch-sky-fg)',
    iris: 'var(--sch-iris-fg)', sun: 'var(--sch-sun-fg)', coral: 'var(--sch-coral-fg)',
};
const PILL_BG: Record<PillTone, string> = {
    accent: 'var(--sch-accent-soft)', mute: 'var(--sch-surface2)',
    rose: 'var(--sch-rose-bg)', moss: 'var(--sch-moss-bg)', sky: 'var(--sch-sky-bg)',
    iris: 'var(--sch-iris-bg)', sun: 'var(--sch-sun-bg)', coral: 'var(--sch-coral-bg)',
};

export function pill(parent: El, text: string, tone: PillTone = 'mute', opts: { soft?: boolean; style?: Partial<CSSStyleDeclaration> } = {}): El {
    const soft = opts.soft !== false;
    const el = parent.createSpan({ cls: 'sch-pill', text });
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.gap = '4px';
    el.style.padding = '2px 8px';
    el.style.borderRadius = '999px';
    el.style.fontSize = '11.5px';
    el.style.fontWeight = '600';
    el.style.letterSpacing = '.01em';
    el.style.lineHeight = '1.5';
    el.style.whiteSpace = 'nowrap';
    el.style.color = PILL_FG[tone];
    el.style.background = soft ? PILL_BG[tone] : 'transparent';
    el.style.border = soft ? 'none' : `1px solid ${PILL_FG[tone]}`;
    applyStyle(el, opts.style);
    return el;
}

// ─── Button ────────────────────────────────────────────────────────────────
export interface ButtonOptions {
    text?: string;
    variant?: ButtonVariant;
    size?: Size;
    iconName?: string;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    style?: Partial<CSSStyleDeclaration>;
}

const BTN_SIZE: Record<Size, { h: number; px: number; fs: number; gap: number }> = {
    sm: { h: 28, px: 10, fs: 12.5, gap: 6 },
    md: { h: 34, px: 13, fs: 13.5, gap: 7 },
    lg: { h: 40, px: 16, fs: 14, gap: 8 },
};
const BTN_VARIANT: Record<ButtonVariant, { bg: string; fg: string; bd: string }> = {
    primary: { bg: 'var(--sch-accent)', fg: '#fff', bd: 'transparent' },
    ghost:   { bg: 'transparent', fg: 'var(--sch-ink)', bd: 'var(--sch-line)' },
    soft:    { bg: 'var(--sch-surface2)', fg: 'var(--sch-ink)', bd: 'var(--sch-line-soft)' },
    accent:  { bg: 'var(--sch-accent-soft)', fg: 'var(--sch-accent-ink)', bd: 'transparent' },
    danger:  { bg: 'var(--sch-rose-bg)', fg: 'var(--sch-rose-fg)', bd: 'transparent' },
};

export function button(parent: El, opts: ButtonOptions = {}): HTMLButtonElement {
    const size = BTN_SIZE[opts.size ?? 'md'];
    const v = BTN_VARIANT[opts.variant ?? 'ghost'];
    const el = parent.createEl('button', { cls: 'sch-btn' });
    if (opts.title) el.setAttribute('title', opts.title);
    el.disabled = !!opts.disabled;
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.gap = size.gap + 'px';
    el.style.height = size.h + 'px';
    el.style.padding = `0 ${size.px}px`;
    el.style.background = v.bg;
    el.style.color = v.fg;
    el.style.border = `1px solid ${v.bd}`;
    el.style.borderRadius = '10px';
    el.style.fontSize = size.fs + 'px';
    el.style.fontWeight = '600';
    el.style.letterSpacing = '.005em';
    el.style.cursor = opts.disabled ? 'not-allowed' : 'pointer';
    el.style.opacity = opts.disabled ? '.55' : '1';
    el.style.transition = 'all .15s ease';
    el.style.fontFamily = 'inherit';
    el.style.whiteSpace = 'nowrap';
    el.style.flexShrink = '0';
    if (opts.iconName) {
        const ic = iconSvg(opts.iconName, { size: size.fs + 1 });
        el.appendChild(ic);
    }
    if (opts.text) el.appendChild(document.createTextNode(opts.text));
    if (opts.onClick && !opts.disabled) el.addEventListener('click', opts.onClick);
    applyStyle(el, opts.style);
    return el;
}

// ─── Input ───────────────────────────────────────────────────────────────────
export interface InputOptions {
    value?: string;
    placeholder?: string;
    type?: string;
    iconName?: string;
    size?: Size;
    suffix?: string;
    onChange?: (v: string) => void;
    onEnter?: (v: string) => void;
    style?: Partial<CSSStyleDeclaration>;
}

const INPUT_SIZE: Record<Size, { h: number; px: number; fs: number }> = {
    sm: { h: 30, px: 10, fs: 12.5 },
    md: { h: 36, px: 12, fs: 13.5 },
    lg: { h: 42, px: 14, fs: 14 },
};

export function input(parent: El, opts: InputOptions = {}): { wrap: El; input: HTMLInputElement } {
    const size = INPUT_SIZE[opts.size ?? 'md'];
    const wrap = parent.createDiv({ cls: 'sch-input' });
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.background = 'var(--sch-surface)';
    wrap.style.border = '1px solid var(--sch-line)';
    wrap.style.borderRadius = '10px';
    wrap.style.height = size.h + 'px';
    wrap.style.paddingLeft = (opts.iconName ? 10 : size.px) + 'px';
    wrap.style.paddingRight = size.px + 'px';
    wrap.style.width = '100%';
    wrap.style.gap = '8px';
    if (opts.iconName) {
        const ic = iconSvg(opts.iconName, { size: size.fs });
        ic.style.color = 'var(--sch-mute)';
        wrap.appendChild(ic);
    }
    const inp = wrap.createEl('input');
    inp.type = opts.type ?? 'text';
    inp.value = opts.value ?? '';
    if (opts.placeholder) inp.placeholder = opts.placeholder;
    inp.style.flex = '1';
    inp.style.height = '100%';
    inp.style.border = '0';
    inp.style.outline = '0';
    inp.style.background = 'transparent';
    inp.style.color = 'var(--sch-ink)';
    inp.style.fontSize = size.fs + 'px';
    inp.style.fontFamily = 'inherit';
    if (opts.onChange) inp.addEventListener('input', () => opts.onChange!(inp.value));
    if (opts.onEnter) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') opts.onEnter!(inp.value); });
    if (opts.suffix) {
        const sfx = wrap.createSpan({ text: opts.suffix });
        sfx.style.color = 'var(--sch-mute)';
        sfx.style.fontSize = '11.5px';
    }
    applyStyle(wrap, opts.style);
    return { wrap, input: inp };
}

// ─── Segmented control ────────────────────────────────────────────────────────
export interface SegOption { value: string; label: string }

export function segmented(
    parent: El,
    options: (SegOption | string)[],
    value: string,
    onChange: (v: string) => void,
    size: 'sm' | 'md' = 'md',
): El {
    const h = size === 'sm' ? 26 : 32;
    const wrap = parent.createDiv({ cls: 'sch-seg' });
    wrap.style.display = 'inline-flex';
    wrap.style.background = 'var(--sch-surface2)';
    wrap.style.border = '1px solid var(--sch-line-soft)';
    wrap.style.borderRadius = '999px';
    wrap.style.padding = '3px';
    wrap.style.height = (h + 6) + 'px';
    wrap.style.flexShrink = '0';
    for (const opt of options) {
        const v = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        const active = value === v;
        const btn = wrap.createEl('button', { text: label });
        btn.style.height = h + 'px';
        btn.style.padding = '0 12px';
        btn.style.border = '0';
        btn.style.background = active ? 'var(--sch-surface)' : 'transparent';
        btn.style.color = active ? 'var(--sch-accent-ink)' : 'var(--sch-mute)';
        btn.style.fontWeight = '600';
        btn.style.fontSize = '12.5px';
        btn.style.borderRadius = '999px';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'all .15s ease';
        btn.style.fontFamily = 'inherit';
        btn.style.whiteSpace = 'nowrap';
        btn.style.boxShadow = active ? '0 1px 2px rgba(0,0,0,.04)' : 'none';
        btn.addEventListener('click', () => onChange(v));
    }
    return wrap;
}

// ─── Toggle (iOS-style switch) ─────────────────────────────────────────────────
export function toggle(parent: El, checked: boolean, onChange: (v: boolean) => void): El {
    const wrap = parent.createDiv({ cls: 'sch-toggle' });
    wrap.style.width = '40px';
    wrap.style.height = '24px';
    wrap.style.borderRadius = '999px';
    wrap.style.background = checked ? 'var(--sch-accent)' : 'var(--sch-line)';
    wrap.style.position = 'relative';
    wrap.style.cursor = 'pointer';
    wrap.style.transition = 'background .15s ease';
    wrap.style.flexShrink = '0';
    const knob = wrap.createDiv();
    knob.style.position = 'absolute';
    knob.style.top = '2px';
    knob.style.left = checked ? '18px' : '2px';
    knob.style.width = '20px';
    knob.style.height = '20px';
    knob.style.borderRadius = '50%';
    knob.style.background = '#fff';
    knob.style.transition = 'left .15s ease';
    knob.style.boxShadow = '0 1px 2px rgba(0,0,0,.2)';
    wrap.addEventListener('click', () => onChange(!checked));
    return wrap;
}

// ─── SectionHeader ─────────────────────────────────────────────────────────────
export interface SectionHeaderOptions {
    eyebrow?: string;
    title: string;
    subtitle?: string;
    level?: 1 | 2 | 3;
}

export function sectionHeader(parent: El, opts: SectionHeaderOptions): { header: El; right: El } {
    const sizes = { 1: 28, 2: 20, 3: 16 } as const;
    const fs = sizes[opts.level ?? 2];
    const header = parent.createDiv({ cls: 'sch-sechead' });
    header.style.display = 'flex';
    header.style.alignItems = 'flex-start';
    header.style.justifyContent = 'space-between';
    header.style.gap = '16px';
    header.style.marginBottom = '14px';
    header.style.flexWrap = 'wrap';
    const left = header.createDiv();
    left.style.minWidth = '0';
    left.style.flex = '1 1 280px';
    if (opts.eyebrow) {
        const eb = left.createDiv({ text: opts.eyebrow });
        eb.style.fontSize = '10.5px';
        eb.style.fontWeight = '700';
        eb.style.letterSpacing = '.12em';
        eb.style.color = 'var(--sch-mute)';
        eb.style.textTransform = 'uppercase';
        eb.style.marginBottom = '4px';
    }
    const title = left.createDiv({ text: opts.title });
    title.style.fontFamily = 'var(--sch-font-serif)';
    title.style.fontSize = fs + 'px';
    title.style.fontWeight = '500';
    title.style.lineHeight = '1.15';
    title.style.color = 'var(--sch-ink)';
    title.style.letterSpacing = '-.01em';
    if (opts.subtitle) {
        const sub = left.createDiv({ text: opts.subtitle });
        sub.style.marginTop = '4px';
        sub.style.fontSize = '12.5px';
        sub.style.color = 'var(--sch-mute)';
        sub.style.lineHeight = '1.5';
    }
    const right = header.createDiv();
    right.style.flexShrink = '0';
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';
    return { header, right };
}

// ─── Metric ────────────────────────────────────────────────────────────────────
export interface MetricOptions {
    label: string;
    value: string | number;
    unit?: string;
    delta?: number;
    iconName?: string;
}

export function metric(parent: El, opts: MetricOptions): El {
    const el = parent.createDiv({ cls: 'sch-metric' });
    const lab = el.createDiv();
    lab.style.display = 'flex';
    lab.style.alignItems = 'center';
    lab.style.gap = '6px';
    lab.style.fontSize = '11.5px';
    lab.style.color = 'var(--sch-mute)';
    lab.style.fontWeight = '600';
    lab.style.letterSpacing = '.04em';
    lab.style.textTransform = 'uppercase';
    lab.style.marginBottom = '4px';
    if (opts.iconName) {
        const ic = iconSvg(opts.iconName, { size: 12 });
        ic.style.color = 'var(--sch-accent-ink)';
        lab.appendChild(ic);
    }
    lab.appendChild(document.createTextNode(opts.label));
    const row = el.createDiv();
    row.style.display = 'flex';
    row.style.alignItems = 'baseline';
    row.style.gap = '4px';
    const val = row.createSpan({ text: String(opts.value) });
    val.style.fontFamily = 'var(--sch-font-mono)';
    val.style.fontSize = '26px';
    val.style.fontWeight = '500';
    val.style.color = 'var(--sch-ink)';
    val.style.lineHeight = '1';
    val.style.letterSpacing = '-.02em';
    if (opts.unit) {
        const u = row.createSpan({ text: opts.unit });
        u.style.fontSize = '12px';
        u.style.color = 'var(--sch-mute)';
        u.style.fontWeight = '500';
    }
    if (opts.delta !== undefined) {
        const d = opts.delta;
        const dc = d > 0 ? 'oklch(0.55 0.13 142)' : d < 0 ? 'oklch(0.55 0.16 18)' : 'var(--sch-mute)';
        const ds = row.createSpan({ text: `${d > 0 ? '↑' : d < 0 ? '↓' : '→'} ${Math.abs(d)}%` });
        ds.style.marginLeft = '6px';
        ds.style.fontSize = '11.5px';
        ds.style.color = dc;
        ds.style.fontWeight = '600';
    }
    return el;
}

// ─── ProgressBar ───────────────────────────────────────────────────────────────
export interface ProgressOptions {
    value: number;
    max?: number;
    color?: string;
    height?: number;
    label?: string;
}

export function progressBar(parent: El, opts: ProgressOptions): El {
    const pct = Math.max(0, Math.min(100, (opts.value / (opts.max ?? 100)) * 100));
    const el = parent.createDiv({ cls: 'sch-progress' });
    if (opts.label) {
        const lab = el.createDiv();
        lab.style.display = 'flex';
        lab.style.justifyContent = 'space-between';
        lab.style.fontSize = '11.5px';
        lab.style.color = 'var(--sch-mute)';
        lab.style.marginBottom = '4px';
        lab.style.fontWeight = '600';
        lab.createSpan({ text: opts.label });
        const p = lab.createSpan({ text: Math.round(pct) + '%' });
        p.style.fontFamily = 'var(--sch-font-mono)';
        p.style.color = 'var(--sch-ink2)';
    }
    const track = el.createDiv();
    track.style.height = (opts.height ?? 6) + 'px';
    track.style.background = 'var(--sch-surface2)';
    track.style.borderRadius = '999px';
    track.style.overflow = 'hidden';
    track.style.border = '1px solid var(--sch-line-soft)';
    const fill = track.createDiv();
    fill.style.height = '100%';
    fill.style.width = pct + '%';
    fill.style.background = opts.color ?? 'var(--sch-accent)';
    fill.style.borderRadius = '999px';
    fill.style.transition = 'width .4s ease';
    return el;
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
export function avatar(parent: El, text: string, opts: { color?: string; size?: number } = {}): El {
    const size = opts.size ?? 32;
    const el = parent.createDiv({ cls: 'sch-avatar', text });
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.borderRadius = (size / 3) + 'px';
    el.style.background = opts.color ?? 'var(--sch-accent-soft)';
    el.style.color = opts.color ? '#fff' : 'var(--sch-accent-ink)';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.fontWeight = '600';
    el.style.fontSize = (size * 0.42) + 'px';
    el.style.flexShrink = '0';
    el.style.border = `1px solid ${opts.color ? 'transparent' : 'var(--sch-line-soft)'}`;
    el.style.letterSpacing = '-.01em';
    return el;
}

// ─── Empty state ───────────────────────────────────────────────────────────────
export interface EmptyOptions {
    iconText?: string;
    title: string;
    hint?: string;
}

export function empty(parent: El, opts: EmptyOptions): El {
    const el = parent.createDiv({ cls: 'sch-empty' });
    el.style.padding = '32px 16px';
    el.style.textAlign = 'center';
    el.style.border = '1px dashed var(--sch-line)';
    el.style.borderRadius = '12px';
    el.style.color = 'var(--sch-mute)';
    const ic = el.createDiv({ text: opts.iconText ?? '✶' });
    ic.style.fontSize = '24px';
    ic.style.marginBottom = '8px';
    ic.style.opacity = '.6';
    const title = el.createDiv({ text: opts.title });
    title.style.fontSize = '14px';
    title.style.color = 'var(--sch-ink2)';
    title.style.fontWeight = '500';
    title.style.marginBottom = '4px';
    if (opts.hint) {
        const h = el.createDiv({ text: opts.hint });
        h.style.fontSize = '12px';
        h.style.lineHeight = '1.5';
    }
    return el;
}
