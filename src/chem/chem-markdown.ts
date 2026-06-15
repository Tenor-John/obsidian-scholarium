/* eslint-disable obsidianmd/no-static-styles-assignment -- Runtime sizing reflects the rendered chemical structure and cannot be represented by fixed CSS classes. */
import { MarkdownView, Notice, TFile } from 'obsidian';
import type { MarkdownPostProcessorContext } from 'obsidian';
import type ChemELNPlugin from '../main';
import { ChemEditorModal } from './chem-editor-modal';
import {
    CHEM_CODE_BLOCK,
    createEmptyChemBlock,
    parseChemBlock,
    serializeChemBlock,
    type ChemBlock,
    type ChemBlockType,
} from './chem-block';
import { getChemPreviewSmiles } from './chem-source';
import { namespaceSvgIds } from './svg-ids';
// 本地打包 smiles-drawer（兼容 esbuild 的 ESM→CJS 转换）
// @ts-ignore
import _SD from 'smiles-drawer';
// esbuild 打包时 default export 可能挂在 .default 上
const SD = (_SD as { default?: unknown } & Record<string, unknown>)?.default ?? _SD;

type DrawerCtor = new (o: object) => { draw(t: unknown, c: HTMLCanvasElement | string, th: string, iso: boolean): void };
type ParseFn = (s: string, ok: (t: unknown) => void, err: (e: unknown) => void) => void;
type SmiDrawerCtor = new (mol: object, rxn: object) => {
    draw(smiles: string, target: SVGElement | string, theme: string, ok: ((x: unknown) => void) | null, err: ((e: unknown) => void) | null, weights?: unknown): void;
};

function getSmilesDrawerAPI(): { DrawerClass: DrawerCtor | null; parseFn: ParseFn | null } {
    try {
        const lib = SD as Record<string, unknown>;
        if (typeof lib.Drawer === 'function') {
            const DrawerClass = lib.Drawer as DrawerCtor;
            const parseFn = (lib.parse as ParseFn)
                || ((DrawerClass as unknown as Record<string, unknown>).parse as ParseFn);
            if (typeof parseFn === 'function') return { DrawerClass, parseFn };
        }
        if (typeof SD === 'function') {
            const DrawerClass = SD as unknown as DrawerCtor;
            const parseFn = (SD as unknown as Record<string, unknown>).parse as ParseFn;
            if (typeof parseFn === 'function') return { DrawerClass, parseFn };
        }
    } catch (e) {
        console.error('[Scholarium] getSmilesDrawerAPI:', e);
    }
    return { DrawerClass: null, parseFn: null };
}

// canvas 降级渲染（仅单分子；反应式取产物）
function drawWithCanvas(container: HTMLElement, smiles: string, isReaction: boolean): boolean {
    const { DrawerClass, parseFn } = getSmilesDrawerAPI();
    if (!DrawerClass || !parseFn) return false;
    const canvas = container.createEl('canvas', { cls: 'sch-chem-canvas' });
    canvas.width = 420;
    canvas.height = 220;
    canvas.id = 'sch-chem-canvas-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
    const drawableSmiles = normalizeReactionPreviewSmiles(smiles, isReaction);
    const target = isReaction
        ? ((drawableSmiles.split('>>').pop() ?? drawableSmiles).split('.')[0] || drawableSmiles)
        : drawableSmiles;
    try {
        const drawer = new DrawerClass({ width: canvas.width, height: canvas.height, bondThickness: 1.4 });
        parseFn(target,
            (tree) => {
                try { drawer.draw(tree, canvas, 'light', false); }
                catch { try { drawer.draw(tree, canvas.id, 'light', false); } catch (e) { console.error('[Scholarium] canvas draw err:', e); } }
            },
            (err) => { console.warn('[Scholarium] smiles parse err:', err); }
        );
    } catch (e) {
        console.error('[Scholarium] drawWithCanvas:', e);
        return false;
    }
    return true;
}

function renderSmilesPreview(container: HTMLElement, smiles: string, isReaction: boolean): boolean {
    if (!smiles) return false;
    const lib = SD as Record<string, unknown>;
    const SmiDrawer = lib.SmiDrawer as SmiDrawerCtor | undefined;
    const drawableSmiles = normalizeReactionPreviewSmiles(smiles, isReaction);

    // 优先：SmiDrawer + SVG —— 能正确绘制整条反应式（含 + 号与箭头）
    if (typeof SmiDrawer === 'function') {
        const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
        container.appendChild(svgEl);
        setTimeout(() => {
            try {
                const sd = new SmiDrawer({}, {});
                sd.draw(drawableSmiles, svgEl, 'light', () => {
                    namespaceSvgIds(svgEl);
                    svgEl.style.removeProperty('width');
                    svgEl.style.removeProperty('height');
                    svgEl.removeAttribute('width');
                    svgEl.removeAttribute('height');
                    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                    const vb = svgEl.getAttribute('viewBox');
                    if (vb) {
                        const p = vb.split(/[\s,]+/).map(Number);
                        if (p.length === 4 && !p.some(isNaN)) {
                            const [x = 0, y = 0, w = 0, h = 0] = p;
                            const pad = Math.max(Math.max(w, h) * 0.12, 8);
                            svgEl.setAttribute('viewBox', `${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}`);
                        }
                    }
                    svgEl.style.overflow = 'visible';
                    svgEl.setAttribute('overflow', 'visible');
                }, (err) => {
                    console.warn('[Scholarium] SmiDrawer failed, fallback to canvas:', err);
                    svgEl.remove();
                    if (!drawWithCanvas(container, drawableSmiles, isReaction)) {
                        container.setText(smiles);
                    }
                });
            } catch (e) {
                console.warn('[Scholarium] SmiDrawer threw, fallback to canvas:', e);
                svgEl.remove();
                if (!drawWithCanvas(container, drawableSmiles, isReaction)) {
                    container.setText(smiles);
                }
            }
        }, 60);
        return true;
    }

    // 没有 SmiDrawer 时退回 canvas
    return drawWithCanvas(container, drawableSmiles, isReaction);
}

function normalizeReactionPreviewSmiles(smiles: string, isReaction: boolean): string {
    if (!isReaction || !smiles.includes('>>')) return smiles;
    return smiles
        .split('>>')
        .map((side) => side
            .split('.')
            .map((fragment) => HYDROGEN_HALIDE_PREVIEW[fragment.trim()] ?? fragment)
            .join('.'))
        .join('>>');
}

const HYDROGEN_HALIDE_PREVIEW: Record<string, string> = {
    F: '[H]F',
    Cl: '[H]Cl',
    Br: '[H]Br',
    I: '[H]I',
};

export function registerChemMarkdown(plugin: ChemELNPlugin): void {
    plugin.registerMarkdownCodeBlockProcessor(CHEM_CODE_BLOCK, (source, el, ctx) => {
        renderChemBlock(plugin, source, el, ctx);
    });
}

export function openInsertChemModal(plugin: ChemELNPlugin, type: ChemBlockType = 'reaction'): void {
    const file = plugin.app.workspace.getActiveFile();
    if (!file) {
        new Notice('请先打开一篇笔记，再插入化学方程。');
        return;
    }

    const block = createEmptyChemBlock(type);
    new ChemEditorModal(plugin.app, plugin, {
        block,
        onSave: async (saved) => {
            await appendChemBlockToActiveNote(plugin, saved);
        },
    }).open();
}

export function openInsertChemModalForFile(plugin: ChemELNPlugin, file: TFile, type: ChemBlockType = 'reaction'): void {
    const block = createEmptyChemBlock(type);
    new ChemEditorModal(plugin.app, plugin, {
        block,
        onSave: async (saved) => {
            await appendChemBlockToFile(plugin, file, saved);
        },
    }).open();
}

function renderChemBlock(plugin: ChemELNPlugin, source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const block = parseChemBlock(source);
    el.empty();
    el.addClass('sch-chem-block');
    plugin.applyThemeAttributes(el);

    const toolbar = el.createDiv({ cls: 'sch-chem-toolbar' });
    const meta = toolbar.createDiv({ cls: 'sch-chem-meta' });
    meta.createEl('div', { text: block.title || 'Untitled chemistry', cls: 'sch-chem-title' });
    meta.createEl('div', { text: `${typeLabel(block.type)} · ${block.format.toUpperCase()}`, cls: 'sch-chem-subtitle' });

    const actions = toolbar.createDiv({ cls: 'sch-chem-actions' });
    const editButton = actions.createEl('button', { text: '编辑', cls: 'sch-chem-action-btn' });
    editButton.onclick = () => {
        new ChemEditorModal(plugin.app, plugin, {
            block,
            onSave: async (updated) => {
                await replaceRenderedChemBlock(plugin, ctx, el, updated);
            },
        }).open();
    };

    const body = el.createDiv({ cls: 'sch-chem-preview' });
    const isReaction = !!block.reactionSmiles || block.type === 'reaction';
    const smilesForPreview = getChemPreviewSmiles(block);
    let rendered = false;
    if (smilesForPreview) {
        rendered = renderSmilesPreview(body.createDiv({ cls: 'sch-chem-svg' }), smilesForPreview, isReaction);
    } else if (block.previewSvg) {
        setSanitizedSvg(body.createDiv({ cls: 'sch-chem-svg' }), block.previewSvg);
        rendered = true;
    }
    if (!rendered) {
        body.empty();
        const empty = body.createDiv({ cls: 'sch-chem-empty' });
        empty.createEl('div', { text: '暂无预览' });
        empty.createEl('span', { text: '选择编辑，用 Ketcher 画出结构或反应式。' });
    }

    const footer = el.createDiv({ cls: 'sch-chem-footer' });
    if (block.smiles || block.reactionSmiles) {
        footer.createEl('code', { text: block.reactionSmiles || block.smiles });
    } else {
        footer.createSpan({ text: 'SMILES / reaction SMILES 会在可生成时自动保存。' });
    }
}

function setSanitizedSvg(container: HTMLElement, svgText: string): void {
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = parsed.querySelector('svg');
    if (!svg) {
        container.setText('SVG 预览解析失败');
        return;
    }

    svg.querySelectorAll('script, foreignObject').forEach((node) => node.remove());
    svg.querySelectorAll('*').forEach((node) => {
        for (const attr of Array.from(node.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim().toLowerCase();
            if (name.startsWith('on') || value.startsWith('javascript:')) {
                node.removeAttribute(attr.name);
            }
        }
    });
    namespaceSvgIds(svg);
    prepareChemSvg(svg);
    container.appendChild(document.importNode(svg, true));
}

function prepareChemSvg(svg: SVGSVGElement): void {
    svg.style.removeProperty('width');
    svg.style.removeProperty('height');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.overflow = 'visible';
    svg.setAttribute('overflow', 'visible');
    padSvgViewBox(svg);
}

function padSvgViewBox(svg: SVGSVGElement, ratio = 0.12, min = 8): void {
    const vb = svg.getAttribute('viewBox');
    if (!vb) return;
    const p = vb.split(/[\s,]+/).map(Number);
    if (p.length !== 4 || p.some(isNaN)) return;
    const [x = 0, y = 0, w = 0, h = 0] = p;
    const pad = Math.max(Math.max(w, h) * ratio, min);
    svg.setAttribute('viewBox', `${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}`);
}

async function replaceRenderedChemBlock(plugin: ChemELNPlugin, ctx: MarkdownPostProcessorContext, el: HTMLElement, block: ChemBlock): Promise<void> {
    const section = ctx.getSectionInfo?.(el);
    const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!section || !(file instanceof TFile)) {
        new Notice('没有找到原始代码块位置，无法自动回写。');
        return;
    }

    const replacement = [
        `\`\`\`${CHEM_CODE_BLOCK}`,
        serializeChemBlock(block),
        '```',
    ].join('\n');

    await plugin.app.vault.process(file, (content) => {
        const lines = content.split('\n');
        lines.splice(section.lineStart, section.lineEnd - section.lineStart + 1, replacement);
        return lines.join('\n');
    });
    plugin.refreshDashboards();
}

async function appendChemBlockToActiveNote(plugin: ChemELNPlugin, block: ChemBlock): Promise<void> {
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const text = [
        '',
        `\`\`\`${CHEM_CODE_BLOCK}`,
        serializeChemBlock(block),
        '```',
        '',
    ].join('\n');

    if (view?.editor) {
        view.editor.replaceSelection(text);
        plugin.refreshDashboards();
        return;
    }

    const file = plugin.app.workspace.getActiveFile();
    if (!file) throw new Error('没有可写入的当前笔记。');
    await plugin.app.vault.append(file, text);
    plugin.refreshDashboards();
}

async function appendChemBlockToFile(plugin: ChemELNPlugin, file: TFile, block: ChemBlock): Promise<void> {
    const text = [
        '',
        `\`\`\`${CHEM_CODE_BLOCK}`,
        serializeChemBlock(block),
        '```',
        '',
    ].join('\n');
    await plugin.app.vault.append(file, text);
    plugin.refreshDashboards();
}

function typeLabel(type: ChemBlockType): string {
    if (type === 'molecule') return '分子';
    if (type === 'cycle') return '循环图';
    if (type === 'scheme') return '方案图';
    return '反应式';
}
