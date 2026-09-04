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
    if (style) el.setCssStyles(style);
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
    el.addClass('sch-static-style-176');
    el.addClass('sch-static-style-177');
    el.addClass('sch-static-style-178');
    el.setCssStyles({ padding: opts.pad === false ? '0' : 'var(--sch-pad)' });
    el.addClass('sch-static-style-179');
    el.addClass('sch-static-style-180');
    if (opts.hover || opts.onClick) el.classList.add('sch-card--hover');
    if (opts.onClick) {
        el.addClass('sch-static-style-181');
        el.addEventListener('click', opts.onClick);
    }
    applyStyle(el, opts.style);
    return el;
}

// Inset sub-surface (one shade darker) inside a card
export function insetBlock(parent: El, opts: { pad?: boolean; style?: Partial<CSSStyleDeclaration> } = {}): El {
    const el = parent.createDiv({ cls: 'sch-inset' });
    el.addClass('sch-static-style-66');
    el.addClass('sch-static-style-182');
    el.addClass('sch-static-style-183');
    el.setCssStyles({ padding: opts.pad === false ? '0' : 'calc(var(--sch-pad) - 4px)' });
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
    el.addClass('sch-static-style-184');
    el.addClass('sch-static-style-185');
    el.addClass('sch-static-style-186');
    el.addClass('sch-static-style-187');
    el.addClass('sch-static-style-188');
    el.addClass('sch-static-style-189');
    el.addClass('sch-static-style-190');
    el.addClass('sch-static-style-191');
    el.addClass('sch-static-style-192');
    el.addClass('sch-static-style-151');
    el.setCssStyles({ color: PILL_FG[tone] });
    el.setCssStyles({ background: soft ? PILL_BG[tone] : 'transparent' });
    el.setCssStyles({ border: soft ? 'none' : `1px solid ${PILL_FG[tone]}` });
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
    el.addClass('sch-static-style-184');
    el.addClass('sch-static-style-185');
    el.addClass('sch-static-style-193');
    el.setCssStyles({ gap: size.gap + 'px' });
    el.setCssStyles({ height: size.h + 'px' });
    el.setCssStyles({ padding: `0 ${size.px}px` });
    el.setCssStyles({ background: v.bg });
    el.setCssStyles({ color: v.fg });
    el.setCssStyles({ border: `1px solid ${v.bd}` });
    el.addClass('sch-static-style-194');
    el.setCssStyles({ fontSize: size.fs + 'px' });
    el.addClass('sch-static-style-190');
    el.addClass('sch-static-style-195');
    el.setCssStyles({ cursor: opts.disabled ? 'not-allowed' : 'pointer' });
    el.setCssStyles({ opacity: opts.disabled ? '.55' : '1' });
    el.addClass('sch-static-style-196');
    el.addClass('sch-static-style-197');
    el.addClass('sch-static-style-151');
    el.addClass('sch-static-style-11');
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
    wrap.addClass('sch-static-style-184');
    wrap.addClass('sch-static-style-185');
    wrap.addClass('sch-static-style-66');
    wrap.addClass('sch-static-style-177');
    wrap.addClass('sch-static-style-194');
    wrap.setCssStyles({ height: size.h + 'px' });
    wrap.setCssStyles({ paddingLeft: (opts.iconName ? 10 : size.px) + 'px' });
    wrap.setCssStyles({ paddingRight: size.px + 'px' });
    wrap.addClass('sch-static-style-157');
    wrap.addClass('sch-static-style-198');
    if (opts.iconName) {
        const ic = iconSvg(opts.iconName, { size: size.fs });
        ic.addClass('sch-static-style-121');
        wrap.appendChild(ic);
    }
    const inp = wrap.createEl('input');
    inp.type = opts.type ?? 'text';
    inp.value = opts.value ?? '';
    if (opts.placeholder) inp.placeholder = opts.placeholder;
    inp.addClass('sch-static-style-161');
    inp.addClass('sch-static-style-199');
    inp.addClass('sch-static-style-200');
    inp.addClass('sch-static-style-201');
    inp.addClass('sch-static-style-67');
    inp.addClass('sch-static-style-202');
    inp.setCssStyles({ fontSize: size.fs + 'px' });
    inp.addClass('sch-static-style-197');
    if (opts.onChange) inp.addEventListener('input', () => opts.onChange!(inp.value));
    if (opts.onEnter) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') opts.onEnter!(inp.value); });
    if (opts.suffix) {
        const sfx = wrap.createSpan({ text: opts.suffix });
        sfx.addClass('sch-static-style-121');
        sfx.addClass('sch-static-style-189');
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
    wrap.addClass('sch-static-style-184');
    wrap.addClass('sch-static-style-66');
    wrap.addClass('sch-static-style-182');
    wrap.addClass('sch-static-style-188');
    wrap.addClass('sch-static-style-203');
    wrap.setCssStyles({ height: (h + 6) + 'px' });
    wrap.addClass('sch-static-style-11');
    for (const opt of options) {
        const v = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        const active = value === v;
        const btn = wrap.createEl('button', { text: label });
        btn.setCssStyles({ height: h + 'px' });
        btn.addClass('sch-static-style-204');
        btn.addClass('sch-static-style-200');
        btn.setCssStyles({ background: active ? 'var(--sch-surface)' : 'transparent' });
        btn.setCssStyles({ color: active ? 'var(--sch-accent-ink)' : 'var(--sch-mute)' });
        btn.addClass('sch-static-style-190');
        btn.addClass('sch-static-style-205');
        btn.addClass('sch-static-style-188');
        btn.addClass('sch-static-style-181');
        btn.addClass('sch-static-style-196');
        btn.addClass('sch-static-style-197');
        btn.addClass('sch-static-style-151');
        btn.setCssStyles({ boxShadow: active ? '0 1px 2px rgba(0,0,0,.04)' : 'none' });
        btn.addEventListener('click', () => onChange(v));
    }
    return wrap;
}

// ─── Toggle (iOS-style switch) ─────────────────────────────────────────────────
export function toggle(parent: El, checked: boolean, onChange: (v: boolean) => void): El {
    const wrap = parent.createDiv({ cls: 'sch-toggle' });
    wrap.addClass('sch-static-style-206');
    wrap.addClass('sch-static-style-207');
    wrap.addClass('sch-static-style-188');
    wrap.setCssStyles({ background: checked ? 'var(--sch-accent)' : 'var(--sch-line)' });
    wrap.addClass('sch-static-style-82');
    wrap.addClass('sch-static-style-181');
    wrap.addClass('sch-static-style-208');
    wrap.addClass('sch-static-style-11');
    const knob = wrap.createDiv();
    knob.addClass('sch-static-style-209');
    knob.addClass('sch-static-style-210');
    knob.setCssStyles({ left: checked ? '18px' : '2px' });
    knob.addClass('sch-static-style-211');
    knob.addClass('sch-static-style-212');
    knob.addClass('sch-static-style-213');
    knob.addClass('sch-static-style-214');
    knob.addClass('sch-static-style-215');
    knob.addClass('sch-static-style-216');
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
    header.addClass('sch-static-style-217');
    header.addClass('sch-static-style-218');
    header.addClass('sch-static-style-219');
    header.addClass('sch-static-style-220');
    header.addClass('sch-static-style-64');
    header.addClass('sch-static-style-221');
    const left = header.createDiv();
    left.addClass('sch-static-style-148');
    left.addClass('sch-static-style-222');
    if (opts.eyebrow) {
        const eb = left.createDiv({ text: opts.eyebrow });
        eb.addClass('sch-static-style-223');
        eb.addClass('sch-static-style-224');
        eb.addClass('sch-static-style-225');
        eb.addClass('sch-static-style-121');
        eb.addClass('sch-static-style-226');
        eb.addClass('sch-static-style-227');
    }
    const title = left.createDiv({ text: opts.title });
    title.addClass('sch-static-style-228');
    title.setCssStyles({ fontSize: fs + 'px' });
    title.addClass('sch-static-style-229');
    title.addClass('sch-static-style-230');
    title.addClass('sch-static-style-202');
    title.addClass('sch-static-style-231');
    if (opts.subtitle) {
        const sub = left.createDiv({ text: opts.subtitle });
        sub.addClass('sch-static-style-232');
        sub.addClass('sch-static-style-205');
        sub.addClass('sch-static-style-121');
        sub.addClass('sch-static-style-192');
    }
    const right = header.createDiv();
    right.addClass('sch-static-style-11');
    right.addClass('sch-static-style-217');
    right.addClass('sch-static-style-185');
    right.addClass('sch-static-style-198');
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
    lab.addClass('sch-static-style-217');
    lab.addClass('sch-static-style-185');
    lab.addClass('sch-static-style-233');
    lab.addClass('sch-static-style-189');
    lab.addClass('sch-static-style-121');
    lab.addClass('sch-static-style-190');
    lab.addClass('sch-static-style-234');
    lab.addClass('sch-static-style-226');
    lab.addClass('sch-static-style-227');
    if (opts.iconName) {
        const ic = iconSvg(opts.iconName, { size: 12 });
        ic.addClass('sch-static-style-37');
        lab.appendChild(ic);
    }
    lab.appendChild(document.createTextNode(opts.label));
    const row = el.createDiv();
    row.addClass('sch-static-style-217');
    row.addClass('sch-static-style-235');
    row.addClass('sch-static-style-186');
    const val = row.createSpan({ text: String(opts.value) });
    val.addClass('sch-static-style-236');
    val.addClass('sch-static-style-237');
    val.addClass('sch-static-style-229');
    val.addClass('sch-static-style-202');
    val.addClass('sch-static-style-238');
    val.addClass('sch-static-style-239');
    if (opts.unit) {
        const u = row.createSpan({ text: opts.unit });
        u.addClass('sch-static-style-240');
        u.addClass('sch-static-style-121');
        u.addClass('sch-static-style-229');
    }
    if (opts.delta !== undefined) {
        const d = opts.delta;
        const dc = d > 0 ? 'oklch(0.55 0.13 142)' : d < 0 ? 'oklch(0.55 0.16 18)' : 'var(--sch-mute)';
        const ds = row.createSpan({ text: `${d > 0 ? '↑' : d < 0 ? '↓' : '→'} ${Math.abs(d)}%` });
        ds.addClass('sch-static-style-241');
        ds.addClass('sch-static-style-189');
        ds.setCssStyles({ color: dc });
        ds.addClass('sch-static-style-190');
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
        lab.addClass('sch-static-style-217');
        lab.addClass('sch-static-style-219');
        lab.addClass('sch-static-style-189');
        lab.addClass('sch-static-style-121');
        lab.addClass('sch-static-style-227');
        lab.addClass('sch-static-style-190');
        lab.createSpan({ text: opts.label });
        const p = lab.createSpan({ text: Math.round(pct) + '%' });
        p.addClass('sch-static-style-236');
        p.addClass('sch-static-style-55');
    }
    const track = el.createDiv();
    track.setCssStyles({ height: (opts.height ?? 6) + 'px' });
    track.addClass('sch-static-style-66');
    track.addClass('sch-static-style-188');
    track.addClass('sch-static-style-149');
    track.addClass('sch-static-style-182');
    const fill = track.createDiv();
    fill.addClass('sch-static-style-199');
    fill.setCssStyles({ width: pct + '%' });
    fill.setCssStyles({ background: opts.color ?? 'var(--sch-accent)' });
    fill.addClass('sch-static-style-188');
    fill.addClass('sch-static-style-242');
    return el;
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
export function avatar(parent: El, text: string, opts: { color?: string; size?: number } = {}): El {
    const size = opts.size ?? 32;
    const el = parent.createDiv({ cls: 'sch-avatar', text });
    el.setCssStyles({ width: size + 'px' });
    el.setCssStyles({ height: size + 'px' });
    el.setCssStyles({ borderRadius: (size / 3) + 'px' });
    el.setCssStyles({ background: opts.color ?? 'var(--sch-accent-soft)' });
    el.setCssStyles({ color: opts.color ? '#fff' : 'var(--sch-accent-ink)' });
    el.addClass('sch-static-style-217');
    el.addClass('sch-static-style-185');
    el.addClass('sch-static-style-193');
    el.addClass('sch-static-style-190');
    el.setCssStyles({ fontSize: (size * 0.42) + 'px' });
    el.addClass('sch-static-style-11');
    el.setCssStyles({ border: `1px solid ${opts.color ? 'transparent' : 'var(--sch-line-soft)'}` });
    el.addClass('sch-static-style-231');
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
    el.addClass('sch-static-style-243');
    el.addClass('sch-static-style-244');
    el.addClass('sch-static-style-245');
    el.addClass('sch-static-style-246');
    el.addClass('sch-static-style-121');
    const ic = el.createDiv({ text: opts.iconText ?? '✶' });
    ic.addClass('sch-static-style-247');
    ic.addClass('sch-static-style-248');
    ic.addClass('sch-static-style-249');
    const title = el.createDiv({ text: opts.title });
    title.addClass('sch-static-style-250');
    title.addClass('sch-static-style-55');
    title.addClass('sch-static-style-229');
    title.addClass('sch-static-style-227');
    if (opts.hint) {
        const h = el.createDiv({ text: opts.hint });
        h.addClass('sch-static-style-240');
        h.addClass('sch-static-style-192');
    }
    return el;
}
