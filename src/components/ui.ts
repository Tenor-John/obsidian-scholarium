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
    el.setCssProps({ "background": 'var(--sch-surface)' });
    el.setCssProps({ "border": '1px solid var(--sch-line)' });
    el.setCssProps({ "border-radius": 'var(--sch-radius)' });
    el.style.padding = opts.pad === false ? '0' : 'var(--sch-pad)';
    el.setCssProps({ "box-shadow": 'none' });
    el.setCssProps({ "transition": 'transform .18s ease, box-shadow .18s ease, border-color .18s ease' });
    if (opts.hover || opts.onClick) el.classList.add('sch-card--hover');
    if (opts.onClick) {
        el.setCssProps({ "cursor": 'pointer' });
        el.addEventListener('click', opts.onClick);
    }
    applyStyle(el, opts.style);
    return el;
}

// Inset sub-surface (one shade darker) inside a card
export function insetBlock(parent: El, opts: { pad?: boolean; style?: Partial<CSSStyleDeclaration> } = {}): El {
    const el = parent.createDiv({ cls: 'sch-inset' });
    el.setCssProps({ "background": 'var(--sch-surface2)' });
    el.setCssProps({ "border": '1px solid var(--sch-line-soft)' });
    el.setCssProps({ "border-radius": 'var(--sch-radius-inset)' });
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
    el.setCssProps({ "display": 'inline-flex' });
    el.setCssProps({ "align-items": 'center' });
    el.setCssProps({ "gap": '4px' });
    el.setCssProps({ "padding": '2px 8px' });
    el.setCssProps({ "border-radius": '999px' });
    el.setCssProps({ "font-size": '11.5px' });
    el.setCssProps({ "font-weight": '600' });
    el.setCssProps({ "letter-spacing": '.01em' });
    el.setCssProps({ "line-height": '1.5' });
    el.setCssProps({ "white-space": 'nowrap' });
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
    primary: { bg: 'var(--sch-accent)', fg: '#0a0a0a', bd: 'var(--sch-accent)' },
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
    el.setCssProps({ "display": 'inline-flex' });
    el.setCssProps({ "align-items": 'center' });
    el.setCssProps({ "justify-content": 'center' });
    el.style.gap = size.gap + 'px';
    el.style.height = size.h + 'px';
    el.style.padding = `0 ${size.px}px`;
    el.style.background = v.bg;
    el.style.color = v.fg;
    el.style.border = `1px solid ${v.bd}`;
    el.setCssProps({ "border-radius": '8px' });
    el.style.fontSize = size.fs + 'px';
    el.setCssProps({ "font-weight": '600' });
    el.setCssProps({ "letter-spacing": '.005em' });
    el.style.cursor = opts.disabled ? 'not-allowed' : 'pointer';
    el.style.opacity = opts.disabled ? '.55' : '1';
    el.setCssProps({ "transition": 'all .15s ease' });
    el.setCssProps({ "font-family": 'inherit' });
    el.setCssProps({ "white-space": 'nowrap' });
    el.setCssProps({ "flex-shrink": '0' });
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
    wrap.setCssProps({ "display": 'inline-flex' });
    wrap.setCssProps({ "align-items": 'center' });
    wrap.setCssProps({ "background": 'var(--sch-surface2)' });
    wrap.setCssProps({ "border": '1px solid var(--sch-line)' });
    wrap.setCssProps({ "border-radius": '8px' });
    wrap.style.height = size.h + 'px';
    wrap.style.paddingLeft = (opts.iconName ? 10 : size.px) + 'px';
    wrap.style.paddingRight = size.px + 'px';
    wrap.setCssProps({ "width": '100%' });
    wrap.setCssProps({ "gap": '8px' });
    if (opts.iconName) {
        const ic = iconSvg(opts.iconName, { size: size.fs });
        ic.setCssProps({ "color": 'var(--sch-mute)' });
        wrap.appendChild(ic);
    }
    const inp = wrap.createEl('input');
    inp.type = opts.type ?? 'text';
    inp.value = opts.value ?? '';
    if (opts.placeholder) inp.placeholder = opts.placeholder;
    inp.setCssProps({ "flex": '1' });
    inp.setCssProps({ "height": '100%' });
    inp.setCssProps({ "border": '0' });
    inp.setCssProps({ "outline": '0' });
    inp.setCssProps({ "background": 'transparent' });
    inp.setCssProps({ "color": 'var(--sch-ink)' });
    inp.style.fontSize = size.fs + 'px';
    inp.setCssProps({ "font-family": 'inherit' });
    if (opts.onChange) inp.addEventListener('input', () => opts.onChange!(inp.value));
    if (opts.onEnter) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') opts.onEnter!(inp.value); });
    if (opts.suffix) {
        const sfx = wrap.createSpan({ text: opts.suffix });
        sfx.setCssProps({ "color": 'var(--sch-mute)' });
        sfx.setCssProps({ "font-size": '11.5px' });
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
    wrap.setCssProps({ "display": 'inline-flex' });
    wrap.setCssProps({ "background": 'var(--sch-surface2)' });
    wrap.setCssProps({ "border": '1px solid var(--sch-line-soft)' });
    wrap.setCssProps({ "border-radius": '999px' });
    wrap.setCssProps({ "padding": '3px' });
    wrap.style.height = (h + 6) + 'px';
    wrap.setCssProps({ "flex-shrink": '0' });
    for (const opt of options) {
        const v = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        const active = value === v;
        const btn = wrap.createEl('button', { text: label });
        btn.style.height = h + 'px';
        btn.setCssProps({ "padding": '0 12px' });
        btn.setCssProps({ "border": '0' });
        btn.style.background = active ? 'var(--sch-surface)' : 'transparent';
        btn.style.color = active ? 'var(--sch-accent-ink)' : 'var(--sch-mute)';
        btn.setCssProps({ "font-weight": '600' });
        btn.setCssProps({ "font-size": '12.5px' });
        btn.setCssProps({ "border-radius": '999px' });
        btn.setCssProps({ "cursor": 'pointer' });
        btn.setCssProps({ "transition": 'all .15s ease' });
        btn.setCssProps({ "font-family": 'inherit' });
        btn.setCssProps({ "white-space": 'nowrap' });
        btn.style.boxShadow = active ? '0 1px 2px rgba(0,0,0,.04)' : 'none';
        btn.addEventListener('click', () => onChange(v));
    }
    return wrap;
}

// ─── Toggle (iOS-style switch) ─────────────────────────────────────────────────
export function toggle(parent: El, checked: boolean, onChange: (v: boolean) => void): El {
    const wrap = parent.createDiv({ cls: 'sch-toggle' });
    wrap.setCssProps({ "width": '40px' });
    wrap.setCssProps({ "height": '24px' });
    wrap.setCssProps({ "border-radius": '999px' });
    wrap.style.background = checked ? 'var(--sch-accent)' : 'var(--sch-line)';
    wrap.setCssProps({ "position": 'relative' });
    wrap.setCssProps({ "cursor": 'pointer' });
    wrap.setCssProps({ "transition": 'background .15s ease' });
    wrap.setCssProps({ "flex-shrink": '0' });
    const knob = wrap.createDiv();
    knob.setCssProps({ "position": 'absolute' });
    knob.setCssProps({ "top": '2px' });
    knob.style.left = checked ? '18px' : '2px';
    knob.setCssProps({ "width": '20px' });
    knob.setCssProps({ "height": '20px' });
    knob.setCssProps({ "border-radius": '50%' });
    knob.setCssProps({ "background": '#fff' });
    knob.setCssProps({ "transition": 'left .15s ease' });
    knob.setCssProps({ "box-shadow": '0 1px 2px rgba(0,0,0,.2)' });
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
    header.setCssProps({ "display": 'flex' });
    header.setCssProps({ "align-items": 'flex-start' });
    header.setCssProps({ "justify-content": 'space-between' });
    header.setCssProps({ "gap": '16px' });
    header.setCssProps({ "margin-bottom": '14px' });
    header.setCssProps({ "flex-wrap": 'wrap' });
    const left = header.createDiv();
    left.setCssProps({ "min-width": '0' });
    left.setCssProps({ "flex": '1 1 280px' });
    if (opts.eyebrow) {
        const eb = left.createDiv({ text: opts.eyebrow });
        eb.setCssProps({ "font-size": '10.5px' });
        eb.setCssProps({ "font-weight": '700' });
        eb.setCssProps({ "letter-spacing": '.12em' });
        eb.setCssProps({ "color": 'var(--sch-mute)' });
        eb.setCssProps({ "text-transform": 'uppercase' });
        eb.setCssProps({ "margin-bottom": '4px' });
    }
    const title = left.createDiv({ text: opts.title });
    title.setCssProps({ "font-family": 'var(--sch-font-serif)' });
    title.style.fontSize = fs + 'px';
    title.setCssProps({ "font-weight": '500' });
    title.setCssProps({ "line-height": '1.15' });
    title.setCssProps({ "color": 'var(--sch-ink)' });
    title.setCssProps({ "letter-spacing": '-.01em' });
    if (opts.subtitle) {
        const sub = left.createDiv({ text: opts.subtitle });
        sub.setCssProps({ "margin-top": '4px' });
        sub.setCssProps({ "font-size": '12.5px' });
        sub.setCssProps({ "color": 'var(--sch-mute)' });
        sub.setCssProps({ "line-height": '1.5' });
    }
    const right = header.createDiv();
    right.setCssProps({ "flex-shrink": '0' });
    right.setCssProps({ "display": 'flex' });
    right.setCssProps({ "align-items": 'center' });
    right.setCssProps({ "gap": '8px' });
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
    lab.setCssProps({ "display": 'flex' });
    lab.setCssProps({ "align-items": 'center' });
    lab.setCssProps({ "gap": '6px' });
    lab.setCssProps({ "font-size": '11.5px' });
    lab.setCssProps({ "color": 'var(--sch-mute)' });
    lab.setCssProps({ "font-weight": '600' });
    lab.setCssProps({ "letter-spacing": '.04em' });
    lab.setCssProps({ "text-transform": 'uppercase' });
    lab.setCssProps({ "margin-bottom": '4px' });
    if (opts.iconName) {
        const ic = iconSvg(opts.iconName, { size: 12 });
        ic.setCssProps({ "color": 'var(--sch-accent-ink)' });
        lab.appendChild(ic);
    }
    lab.appendChild(document.createTextNode(opts.label));
    const row = el.createDiv();
    row.setCssProps({ "display": 'flex' });
    row.setCssProps({ "align-items": 'baseline' });
    row.setCssProps({ "gap": '4px' });
    const val = row.createSpan({ text: String(opts.value) });
    val.setCssProps({ "font-family": 'var(--sch-font-mono)' });
    val.setCssProps({ "font-size": '26px' });
    val.setCssProps({ "font-weight": '500' });
    val.setCssProps({ "color": 'var(--sch-ink)' });
    val.setCssProps({ "line-height": '1' });
    val.setCssProps({ "letter-spacing": '-.02em' });
    if (opts.unit) {
        const u = row.createSpan({ text: opts.unit });
        u.setCssProps({ "font-size": '12px' });
        u.setCssProps({ "color": 'var(--sch-mute)' });
        u.setCssProps({ "font-weight": '500' });
    }
    if (opts.delta !== undefined) {
        const d = opts.delta;
        const dc = d > 0 ? 'oklch(0.55 0.13 142)' : d < 0 ? 'oklch(0.55 0.16 18)' : 'var(--sch-mute)';
        const ds = row.createSpan({ text: `${d > 0 ? '↑' : d < 0 ? '↓' : '→'} ${Math.abs(d)}%` });
        ds.setCssProps({ "margin-left": '6px' });
        ds.setCssProps({ "font-size": '11.5px' });
        ds.style.color = dc;
        ds.setCssProps({ "font-weight": '600' });
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
        lab.setCssProps({ "display": 'flex' });
        lab.setCssProps({ "justify-content": 'space-between' });
        lab.setCssProps({ "font-size": '11.5px' });
        lab.setCssProps({ "color": 'var(--sch-mute)' });
        lab.setCssProps({ "margin-bottom": '4px' });
        lab.setCssProps({ "font-weight": '600' });
        lab.createSpan({ text: opts.label });
        const p = lab.createSpan({ text: Math.round(pct) + '%' });
        p.setCssProps({ "font-family": 'var(--sch-font-mono)' });
        p.setCssProps({ "color": 'var(--sch-ink2)' });
    }
    const track = el.createDiv();
    track.style.height = (opts.height ?? 6) + 'px';
    track.setCssProps({ "background": 'var(--sch-surface2)' });
    track.setCssProps({ "border-radius": '999px' });
    track.setCssProps({ "overflow": 'hidden' });
    track.setCssProps({ "border": '1px solid var(--sch-line-soft)' });
    const fill = track.createDiv();
    fill.setCssProps({ "height": '100%' });
    fill.style.width = pct + '%';
    fill.style.background = opts.color ?? 'var(--sch-accent)';
    fill.setCssProps({ "border-radius": '999px' });
    fill.setCssProps({ "transition": 'width .4s ease' });
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
    el.setCssProps({ "display": 'flex' });
    el.setCssProps({ "align-items": 'center' });
    el.setCssProps({ "justify-content": 'center' });
    el.setCssProps({ "font-weight": '600' });
    el.style.fontSize = (size * 0.42) + 'px';
    el.setCssProps({ "flex-shrink": '0' });
    el.style.border = `1px solid ${opts.color ? 'transparent' : 'var(--sch-line-soft)'}`;
    el.setCssProps({ "letter-spacing": '-.01em' });
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
    el.setCssProps({ "padding": '32px 16px' });
    el.setCssProps({ "text-align": 'center' });
    el.setCssProps({ "border": '1px dashed var(--sch-line)' });
    el.setCssProps({ "border-radius": '12px' });
    el.setCssProps({ "color": 'var(--sch-mute)' });
    const ic = el.createDiv({ text: opts.iconText ?? '✶' });
    ic.setCssProps({ "font-size": '24px' });
    ic.setCssProps({ "margin-bottom": '8px' });
    ic.setCssProps({ "opacity": '.6' });
    const title = el.createDiv({ text: opts.title });
    title.setCssProps({ "font-size": '14px' });
    title.setCssProps({ "color": 'var(--sch-ink2)' });
    title.setCssProps({ "font-weight": '500' });
    title.setCssProps({ "margin-bottom": '4px' });
    if (opts.hint) {
        const h = el.createDiv({ text: opts.hint });
        h.setCssProps({ "font-size": '12px' });
        h.setCssProps({ "line-height": '1.5' });
    }
    return el;
}
