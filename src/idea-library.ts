// idea-library.ts — Notebook → Ideas (NEW module, Scholarium redesign M5)
// Capture-from-chat wizard + library + detail. Persists each idea as a markdown
// file under <experimentsFolder>/_ideas/IDEA-<n>.md (front-matter + a cleaned
// note + the original markdown source preserved verbatim).

import { App, Modal, Notice, TFile, TFolder, normalizePath, Component, MarkdownRenderer } from 'obsidian';
import ChemELNPlugin from './main';
import { PROVIDER_CONFIG } from './settings';
import type { AIProvider } from './settings';
import { iconSvg } from './icons';
import { card as uiCard, sectionHeader, pill, button as uiButton, input as uiInput, segmented, empty as emptyState, type PillTone } from './components/ui';
import { requestUrlWithTimeout, safeParseJson } from './utils/network';

export type IdeaSource = 'claude' | 'gpt' | 'paper' | 'manual';
export type IdeaStatus = 'draft' | 'refined' | 'integrated';

export interface Idea {
    id: string;            // 'IDEA-0042'
    title: string;
    source: IdeaSource;
    date: string;          // YYYY-MM-DD
    status: IdeaStatus;
    excerpt: string;
    tags: string[];
    relatedExp: string[];
    relatedNotes: string[];
    relatedChapter?: string;
    pinned: boolean;
    raw: string;
}

export interface ExperimentRef { id: string; title: string }
interface NoteRef { path: string; title: string }

const SOURCE_META: Record<IdeaSource, { tone: PillTone; zh: string; en: string }> = {
    claude: { tone: 'iris', zh: 'Claude', en: 'Claude' },
    gpt:    { tone: 'moss', zh: 'GPT', en: 'GPT' },
    paper:  { tone: 'sky', zh: '文献', en: 'Paper' },
    manual: { tone: 'coral', zh: '手动', en: 'Manual' },
};
const STATUS_META: Record<IdeaStatus, { tone: PillTone; zh: string; en: string }> = {
    draft:      { tone: 'mute', zh: '草稿', en: 'Draft' },
    refined:    { tone: 'accent', zh: '已精炼', en: 'Refined' },
    integrated: { tone: 'moss', zh: '已落地', en: 'Integrated' },
};

const SOURCE_ACCENT: Record<IdeaSource, string> = {
    claude: 'var(--sch-iris-fg)',
    gpt: 'var(--sch-moss-fg)',
    paper: 'var(--sch-sky-fg)',
    manual: 'var(--sch-coral-fg)',
};

const TAG_TONES: PillTone[] = ['sky', 'iris', 'moss', 'sun', 'coral', 'rose'];

const REFINED_START = '<!-- scholarium:refined:start -->';
const REFINED_END = '<!-- scholarium:refined:end -->';
const RAW_START = '<!-- scholarium:raw:start -->';
const RAW_END = '<!-- scholarium:raw:end -->';

function splitSentences(text: string): string[] {
    return text.match(/[^。.!?！？]+[。.!?！？]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
}

export class IdeaLibrary {
    private app: App;
    private plugin: ChemELNPlugin;
    private ideas: Idea[] = [];
    private container: HTMLElement | null = null;
    private selected: Idea | null = null;
    private editing = false;
    private mdComponent: Component | null = null;
    private editDraft = { title: '', excerpt: '', tags: '', status: 'refined' as IdeaStatus, relatedChapter: '' };
    private filterText = '';
    private filterStatus: 'all' | IdeaStatus = 'all';
    private filterSource: 'all' | IdeaSource = 'all';
    /** Set by the dashboard before render so the AI can suggest real connections. */
    experimentIndex: ExperimentRef[] = [];
    thesisChapters: string[] = [];

    constructor(app: App, plugin: ChemELNPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    private get lang(): 'zh' | 'en' { return this.plugin.settings.language; }

    folderPath(): string {
        const base = this.plugin.settings.experimentsFolder || 'Experiments';
        return normalizePath(`${base}/_ideas`);
    }

    private async ensureFolder(): Promise<void> {
        const p = this.folderPath();
        if (!this.app.vault.getAbstractFileByPath(p)) {
            try { await this.app.vault.createFolder(p); } catch (error) { console.warn('[Scholarium] Idea folder create skipped:', error); }
        }
    }

    async load(): Promise<void> {
        this.ideas = [];
        const folder = this.app.vault.getAbstractFileByPath(this.folderPath());
        if (!(folder instanceof TFolder)) return;
        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === 'md') {
                try {
                    const content = await this.app.vault.read(child);
                    const idea = this.parseIdea(content, child.basename);
                    if (idea) this.ideas.push(idea);
                } catch (error) { console.warn('[Scholarium] Unable to read idea file:', child.path, error); }
            }
        }
        this.ideas.sort((a, b) => (b.date).localeCompare(a.date));
    }

    private parseIdea(content: string, basename: string): Idea | null {
        const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        const fmText = m ? m[1]! : '';
        const body = m ? m[2]! : content;
        const fm: Record<string, string> = {};
        for (const line of fmText.split('\n')) {
            const idx = line.indexOf(':');
            if (idx === -1) continue;
            fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
        const parseArr = (v: string | undefined): string[] => {
            if (!v) return [];
            const inner = v.replace(/^\[/, '').replace(/\]$/, '').trim();
            if (!inner) return [];
            return inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        };
        const markedExcerpt = this.betweenMarkers(body, REFINED_START, REFINED_END);
        const markedRaw = this.betweenMarkers(body, RAW_START, RAW_END);
        let excerpt = markedExcerpt?.trim() ?? body.trim();
        let raw = markedRaw ?? '';
        if (markedRaw === null) {
            const dm = body.match(/<details>[\s\S]*?<summary>[\s\S]*?<\/summary>\n?([\s\S]*?)\n?<\/details>/i);
            if (dm) {
                excerpt = body.slice(0, body.toLowerCase().indexOf('<details>')).trim();
                raw = dm[1] ?? '';
            }
        }
        const unquote = (s: string | undefined) => (s ?? '').replace(/^["']|["']$/g, '');
        return {
            id: unquote(fm.id) || basename,
            title: unquote(fm.title) || (this.lang === 'zh' ? '未命名想法' : 'Untitled idea'),
            source: (unquote(fm.source) as IdeaSource) || 'manual',
            date: unquote(fm.date) || new Date().toISOString().split('T')[0]!,
            status: (unquote(fm.status) as IdeaStatus) || 'draft',
            excerpt,
            tags: parseArr(fm.tags),
            relatedExp: parseArr(fm.relatedExp),
            relatedNotes: parseArr(fm.relatedNotes),
            relatedChapter: unquote(fm.relatedChapter) || undefined,
            pinned: unquote(fm.pinned) === 'true',
            raw,
        };
    }

    private serialize(idea: Idea): string {
        const arr = (a: string[]) => `[${a.map(x => x.replace(/[[\],]/g, '')).join(', ')}]`;
        const fm = [
            '---',
            'type: idea',
            `id: ${idea.id}`,
            `title: ${JSON.stringify(idea.title)}`,
            `source: ${idea.source}`,
            `date: ${idea.date}`,
            `status: ${idea.status}`,
            `tags: ${arr(idea.tags)}`,
            `relatedExp: ${arr(idea.relatedExp)}`,
            `relatedNotes: ${arr(idea.relatedNotes)}`,
            `relatedChapter: ${idea.relatedChapter ? JSON.stringify(idea.relatedChapter) : '""'}`,
            `pinned: ${idea.pinned}`,
            '---',
            '',
            '## 整理稿',
            '',
            REFINED_START,
            idea.excerpt.trim(),
            REFINED_END,
            '',
            '',
        ];
        return fm.join('\n');
    }

    private betweenMarkers(text: string, start: string, end: string): string | null {
        const startIdx = text.indexOf(start);
        if (startIdx === -1) return null;
        const contentStart = startIdx + start.length;
        const endIdx = text.indexOf(end, contentStart);
        if (endIdx === -1) return null;
        let value = text.slice(contentStart, endIdx);
        if (value.startsWith('\r\n')) value = value.slice(2);
        else if (value.startsWith('\n')) value = value.slice(1);
        if (value.endsWith('\r\n')) value = value.slice(0, -2);
        else if (value.endsWith('\n')) value = value.slice(0, -1);
        return value;
    }

    nextId(): string {
        let max = 0;
        for (const i of this.ideas) {
            const n = parseInt(i.id.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(n) && n > max) max = n;
        }
        return `IDEA-${String(max + 1).padStart(4, '0')}`;
    }

    async saveIdea(idea: Idea): Promise<void> {
        await this.ensureFolder();
        const path = normalizePath(`${this.folderPath()}/${idea.id}.md`);
        const existing = this.app.vault.getAbstractFileByPath(path);
        const data = this.serialize(idea);
        if (existing instanceof TFile) await this.app.vault.modify(existing, data);
        else await this.app.vault.create(path, data);
        // refresh in-memory list
        const i = this.ideas.findIndex(x => x.id === idea.id);
        if (i >= 0) this.ideas[i] = idea; else this.ideas.unshift(idea);
    }

    async deleteIdea(idea: Idea): Promise<void> {
        const path = normalizePath(`${this.folderPath()}/${idea.id}.md`);
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f instanceof TFile) await this.app.fileManager.trashFile(f);
        this.ideas = this.ideas.filter(x => x.id !== idea.id);
        if (this.selected?.id === idea.id) this.selected = null;
    }

    // ─── promote to experiment: create a new md from the experiment template ───
    async promoteToExperiment(idea: Idea): Promise<void> {
        const today = new Date().toISOString().split('T')[0]!;
        const folder = this.plugin.settings.experimentsFolder || 'Experiments';
        try { if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder); } catch (error) { console.warn('[Scholarium] Unable to prepare experiment folder:', error); }
        const safe = idea.title.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 40).trim() || '实验记录';
        let path = normalizePath(`${folder}/${today}-${safe}.md`);
        let n = 1;
        while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${folder}/${today}-${safe}-${++n}.md`);
        const tpl = `---
type: experiment
title: ${JSON.stringify(idea.title)}
date: ${today}
status: planned
reagents: []
smiles: ""
reaction_smiles: ""
results: ""
source_idea: ${idea.id}
---

## 目的

${idea.excerpt}

## 步骤


## 结果


## 备注

> 由想法 ${idea.id} 升级而来。
${idea.tags.length ? '\n标签：' + idea.tags.join('、') + '\n' : ''}`;
        try {
            const f = await this.app.vault.create(path, tpl);
            await this.app.workspace.getLeaf(false).openFile(f);
            new Notice(this.lang === 'zh' ? '已创建实验记录' : 'Experiment created');
        } catch (e) {
            new Notice('创建失败：' + (e as Error).message);
        }
    }

    private filtered(): Idea[] {
        const q = this.filterText.trim().toLowerCase();
        return this.ideas.filter(i => {
            if (this.filterStatus !== 'all' && i.status !== this.filterStatus) return false;
            if (this.filterSource !== 'all' && i.source !== this.filterSource) return false;
            if (q && !(i.title.toLowerCase().includes(q) || i.excerpt.toLowerCase().includes(q) || i.tags.some(t => t.toLowerCase().includes(q)))) return false;
            return true;
        });
    }

    // ─── render ───
    render(container: HTMLElement): void {
        this.container = container;
        container.empty();
        if (this.mdComponent) { this.mdComponent.unload(); this.mdComponent = null; }

        // Fixed-height shell: toolbar pinned on top, body fills the rest. The two
        // columns each scroll independently (overflow-y auto + min-height 0) so the
        // list and the detail never affect each other's scroll position.
        const root = container.createDiv();
        root.addClass('sch-static-style-12');

        const tb = root.createDiv();
        tb.addClass('sch-static-style-11');
        this.renderToolbar(tb);

        const body = root.createDiv();
        body.setCssStyles({
            flex: '1', minHeight: '0', marginTop: '14px', display: 'grid',
            gridTemplateColumns: this.selected ? 'minmax(0, 1fr) minmax(340px, clamp(360px, 30vw, 460px))' : '1fr',
            gap: '14px', overflow: 'hidden',
        });

        const cardsCol = body.createDiv();
        cardsCol.addClass('sch-static-style-13');
        this.cardsHost = cardsCol;
        this.renderCardsInto(cardsCol);

        if (this.selected) {
            const detailCol = body.createDiv();
            detailCol.addClass('sch-static-style-14');
            this.renderDetailInto(detailCol);
        }
    }

    private rerender(): void { if (this.container) this.render(this.container); }

    private renderToolbar(root: HTMLElement): void {
        const zh = this.lang === 'zh';
        const c = uiCard(root, { cls: 'idea-toolbar' });
        const row = c.createDiv();
        row.addClass('sch-static-style-15');

        const searchWrap = row.createDiv();
        searchWrap.addClass('sch-static-style-16');
        const { input: si } = uiInput(searchWrap, { value: this.filterText, placeholder: zh ? '搜索想法、标签…' : 'Search ideas, tags…', iconName: 'search' });
        si.addEventListener('input', () => { this.filterText = si.value; this.refreshCardsOnly(); });

        segmented(row,
            [{ value: 'all', label: zh ? '全部' : 'All' }, { value: 'draft', label: STATUS_META.draft[this.lang] }, { value: 'refined', label: STATUS_META.refined[this.lang] }, { value: 'integrated', label: STATUS_META.integrated[this.lang] }],
            this.filterStatus, (v) => { this.filterStatus = v as 'all' | IdeaStatus; this.rerender(); });

        segmented(row,
            [{ value: 'all', label: zh ? '来源' : 'Source' }, { value: 'claude', label: 'Claude' }, { value: 'gpt', label: 'GPT' }, { value: 'paper', label: zh ? '文献' : 'Paper' }, { value: 'manual', label: zh ? '手动' : 'Manual' }],
            this.filterSource, (v) => { this.filterSource = v as 'all' | IdeaSource; this.rerender(); });

        const actions = row.createDiv();
        actions.addClass('sch-static-style-17');
        uiButton(actions, { text: zh ? '从对话捕获' : 'From chat', iconName: 'sparkle', variant: 'soft', onClick: () => this.openCapture() });
        uiButton(actions, { text: zh ? '新建想法' : 'New idea', iconName: 'plus', variant: 'primary', onClick: () => this.openCapture('', 'manual') });
    }

    private cardsHost: HTMLElement | null = null;
    private refreshCardsOnly(): void { if (this.cardsHost) this.renderCardsInto(this.cardsHost); }

    private renderCards(left: HTMLElement): void {
        this.cardsHost = left.createDiv();
        this.renderCardsInto(this.cardsHost);
    }

    private renderCardsInto(host: HTMLElement): void {
        const zh = this.lang === 'zh';
        host.empty();
        const list = this.filtered();
        if (list.length === 0) {
            emptyState(host, { iconText: '✶', title: zh ? '还没有想法' : 'No ideas yet', hint: zh ? '点击「从对话捕获」把灵感存下来' : 'Capture an insight from a chat to start' });
            return;
        }
        const pinned = list.filter(i => i.pinned);
        const others = list.filter(i => !i.pinned);
        const section = (title: string, items: Idea[]) => {
            if (items.length === 0) return;
            const head = host.createDiv({ text: title });
            head.addClass('sch-static-style-18');
            const grid = host.createDiv();
            grid.addClass('sch-static-style-19');
            for (const idea of items) this.renderCard(grid, idea);
        };
        section(zh ? '置顶' : 'Pinned', pinned);
        section(zh ? '其余' : 'Others', others);
    }

    private renderCard(grid: HTMLElement, idea: Idea): void {
        const active = this.selected?.id === idea.id;
        const sourceAccent = SOURCE_ACCENT[idea.source];
        const c = uiCard(grid, { cls: `idea-card idea-source-${idea.source}${active ? ' is-selected' : ''}`, onClick: () => { if (this.selected?.id === idea.id) { this.selected = null; } else { this.selected = idea; this.editing = false; } this.rerender(); }, style: { borderLeft: `3px solid ${sourceAccent}`, position: 'relative' } });
        if (active) c.setCssStyles({ boxShadow: `0 0 0 1px ${sourceAccent}` });
        const titleRow = c.createDiv();
        titleRow.addClass('sch-static-style-20');
        const ttl = titleRow.createDiv({ text: idea.title });
        ttl.addClass('sch-static-style-21');
        if (idea.pinned) { const p = iconSvg('pin', { size: 13 }); p.addClass('sch-static-style-22'); p.addClass('sch-static-style-11'); titleRow.appendChild(p); }
        const ex = c.createDiv({ text: idea.excerpt });
        ex.addClass('sch-static-style-23');
        ex.addClass('sch-static-style-24');
        ex.addClass('sch-static-style-25');
        ex.addClass('sch-static-style-26');
        if (idea.tags.length) {
            const tagRow = c.createDiv();
            tagRow.addClass('sch-static-style-27');
            idea.tags.slice(0, 4).forEach((tg, index) => pill(tagRow, tg, this.tagTone(tg, index)));
        }
        // source ribbon at bottom
        const foot = c.createDiv();
        foot.addClass('sch-static-style-28');
        const sm = SOURCE_META[idea.source];
        const meta = foot.createDiv();
        meta.addClass('sch-static-style-29');
        pill(meta, sm[this.lang], sm.tone);
        const status = STATUS_META[idea.status];
        pill(meta, status[this.lang], status.tone);
        const dt = foot.createSpan({ text: idea.date });
        dt.addClass('sch-static-style-30');
    }

    private tagTone(tag: string, offset = 0): PillTone {
        let hash = 0;
        for (const char of tag) hash = (hash + char.charCodeAt(0)) % TAG_TONES.length;
        return TAG_TONES[(hash + offset) % TAG_TONES.length] ?? 'sky';
    }

    /** Render markdown as a formatted preview (not raw text) into host. */
    private renderMd(host: HTMLElement, md: string): void {
        if (!this.mdComponent) { this.mdComponent = new Component(); this.mdComponent.load(); }
        host.empty();
        void MarkdownRenderer.render(this.app, md || '', host, '', this.mdComponent);
    }

    private renderDetailInto(host: HTMLElement): void {
        const idea = this.selected;
        if (!idea) return;
        const c = uiCard(host);
        if (this.editing) { this.renderEditForm(c, idea); return; }

        const zh = this.lang === 'zh';
        const { right: hr } = sectionHeader(c, { eyebrow: idea.id, title: idea.title, level: 2 });
        const sm = SOURCE_META[idea.source];
        pill(hr, sm[this.lang], sm.tone);
        const stm = STATUS_META[idea.status];
        pill(hr, stm[this.lang], stm.tone);
        uiButton(hr, { iconName: 'close', variant: 'ghost', size: 'sm', title: zh ? '关闭' : 'Close', onClick: () => { this.selected = null; this.rerender(); } });

        // refined insight — rendered markdown preview, iris-bordered
        const quote = c.createDiv();
        quote.addClass('sch-static-style-31');
        const quoteBody = quote.createDiv({ cls: 'markdown-rendered' });
        quoteBody.addClass('sch-static-style-32');
        this.renderMd(quoteBody, idea.excerpt);

        if (idea.tags.length) {
            const tagRow = c.createDiv();
            tagRow.addClass('sch-static-style-33');
            idea.tags.forEach((tg, index) => pill(tagRow, tg, this.tagTone(tg, index)));
        }

        // connections
        if (idea.relatedExp.length || idea.relatedNotes.length || idea.relatedChapter) {
            const conn = c.createDiv();
            conn.addClass('sch-static-style-34');
            const lbl = conn.createDiv({ text: zh ? '关联' : 'Connections' });
            lbl.addClass('sch-static-style-35');
            for (const ex of idea.relatedExp) {
                const link = conn.createDiv();
                link.addClass('sch-static-style-36');
                const ic = iconSvg('link', { size: 13 }); ic.addClass('sch-static-style-37');
                link.appendChild(ic);
                const ref = this.experimentIndex.find(e => e.id === ex);
                link.appendChild(document.createTextNode(ref ? `${ex} · ${ref.title}` : ex));
            }
            for (const note of idea.relatedNotes) {
                const link = conn.createDiv();
                link.addClass('sch-static-style-38');
                const ic = iconSvg('notebook', { size: 13 }); ic.addClass('sch-static-style-37');
                link.appendChild(ic);
                link.appendChild(document.createTextNode(note));
                link.addEventListener('click', async () => {
                    const f = this.app.vault.getAbstractFileByPath(note);
                    if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
                });
            }
            if (idea.relatedChapter) {
                const ch = conn.createDiv({ text: `📖 ${idea.relatedChapter}` });
                ch.addClass('sch-static-style-39');
            }
        }

        // raw source — rendered preview, collapsible
        if (idea.raw) {
            const det = c.createEl('details');
            det.addClass('sch-static-style-40');
            const sum = det.createEl('summary', { text: zh ? '原始来源' : 'Raw source' });
            sum.addClass('sch-static-style-41');
            const rawBody = det.createDiv({ cls: 'markdown-rendered' });
            rawBody.addClass('sch-static-style-42');
            this.renderMd(rawBody, idea.raw);
        }

        // actions
        const acts = c.createDiv();
        acts.addClass('sch-static-style-43');
        uiButton(acts, { text: zh ? '编辑' : 'Edit', iconName: 'bolt', variant: 'soft', onClick: () => {
            this.editDraft = { title: idea.title, excerpt: idea.excerpt, tags: idea.tags.join(', '), status: idea.status, relatedChapter: idea.relatedChapter || '' };
            this.editing = true; this.rerender();
        } });
        uiButton(acts, { text: idea.pinned ? (zh ? '取消置顶' : 'Unpin') : (zh ? '置顶' : 'Pin'), iconName: 'pin', variant: 'soft', onClick: async () => { idea.pinned = !idea.pinned; await this.saveIdea(idea); this.rerender(); } });
        uiButton(acts, { text: zh ? '升级为实验' : 'To experiment', iconName: 'arrowRight', variant: 'accent', onClick: () => this.promoteToExperiment(idea) });
        uiButton(acts, { text: zh ? '删除' : 'Delete', iconName: 'close', variant: 'danger', onClick: async () => { await this.deleteIdea(idea); this.rerender(); } });
    }

    private renderEditForm(c: HTMLElement, idea: Idea): void {
        const zh = this.lang === 'zh';
        const { right: hr } = sectionHeader(c, { eyebrow: idea.id, title: zh ? '编辑想法' : 'Edit idea', level: 2 });
        uiButton(hr, { iconName: 'close', variant: 'ghost', size: 'sm', title: zh ? '取消' : 'Cancel', onClick: () => { this.editing = false; this.rerender(); } });

        const field = (label: string): HTMLElement => {
            const w = c.createDiv(); w.addClass('sch-static-style-34');
            const l = w.createDiv({ text: label });
            l.addClass('sch-static-style-44');
            return w;
        };

        const { input: titleIn } = uiInput(field(zh ? '标题' : 'Title'), { value: this.editDraft.title });
        titleIn.addEventListener('input', () => { this.editDraft.title = titleIn.value; });

        const ew = field(zh ? '精炼洞见（支持 Markdown）' : 'Insight (Markdown)');
        const exTa = ew.createEl('textarea');
        exTa.addClass('sch-static-style-45');
        exTa.value = this.editDraft.excerpt;
        exTa.addEventListener('input', () => { this.editDraft.excerpt = exTa.value; });

        const { input: tagIn } = uiInput(field(zh ? '标签（逗号分隔）' : 'Tags (comma-separated)'), { value: this.editDraft.tags });
        tagIn.addEventListener('input', () => { this.editDraft.tags = tagIn.value; });

        const sw = field(zh ? '状态' : 'Status');
        segmented(sw, [{ value: 'draft', label: STATUS_META.draft[this.lang] }, { value: 'refined', label: STATUS_META.refined[this.lang] }, { value: 'integrated', label: STATUS_META.integrated[this.lang] }], this.editDraft.status, (v) => { this.editDraft.status = v as IdeaStatus; this.rerender(); });

        const { input: chIn } = uiInput(field(zh ? '关联章节（可选）' : 'Chapter (optional)'), { value: this.editDraft.relatedChapter });
        chIn.addEventListener('input', () => { this.editDraft.relatedChapter = chIn.value; });

        const acts = c.createDiv();
        acts.addClass('sch-static-style-46');
        uiButton(acts, { text: zh ? '保存' : 'Save', iconName: 'check', variant: 'primary', onClick: async () => {
            idea.title = this.editDraft.title.trim() || idea.title;
            idea.excerpt = this.editDraft.excerpt.trim();
            idea.tags = this.editDraft.tags.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
            idea.status = this.editDraft.status;
            idea.relatedChapter = this.editDraft.relatedChapter.trim() || undefined;
            try {
                await this.saveIdea(idea);
                this.editing = false; this.rerender();
                new Notice(zh ? '已保存' : 'Saved');
            } catch (e) { new Notice('保存失败：' + (e as Error).message); }
        } });
        uiButton(acts, { text: zh ? '取消' : 'Cancel', variant: 'ghost', onClick: () => { this.editing = false; this.rerender(); } });
    }

    // ─── capture wizard ───
    openCapture(prefill = '', source: IdeaSource = 'claude'): void {
        new ChatCaptureDialog(this.app, this.plugin, this, prefill, source).open();
    }
}

// ════════════════ ChatCaptureDialog ════════════════
type CaptureStep = 'paste' | 'extracting' | 'review';

class ChatCaptureDialog extends Modal {
    private plugin: ChemELNPlugin;
    private lib: IdeaLibrary;
    private step: CaptureStep = 'paste';
    private rawText: string;
    private source: IdeaSource;
    // review fields
    private draft = { title: '', excerpt: '', tags: '', status: 'refined' as IdeaStatus, relatedExp: [] as string[], relatedNotes: [] as string[], relatedChapter: '' as string };

    constructor(app: App, plugin: ChemELNPlugin, lib: IdeaLibrary, prefill: string, source: IdeaSource) {
        super(app);
        this.plugin = plugin;
        this.lib = lib;
        this.rawText = prefill;
        this.source = source;
    }

    private get lang(): 'zh' | 'en' { return this.plugin.settings.language; }

    onOpen(): void {
        this.modalEl.addClass('scholarium-dashboard'); // bring --sch-* vars into modal scope
        this.modalEl.addClass('sch-static-style-47');
        this.contentEl.addClass('sch-static-style-48');
        this.renderStep();
    }
    onClose(): void { this.contentEl.empty(); }

    private renderStep(): void {
        const zh = this.lang === 'zh';
        const c = this.contentEl;
        c.empty();
        if (this.step === 'paste') {
            sectionHeader(c, { eyebrow: zh ? '捕获' : 'Capture', title: zh ? '粘贴对话或文献片段' : 'Paste a chat or paper snippet', level: 2 });
            this.renderSourcePicker(c);
            const ta = c.createEl('textarea');
            ta.addClass('sch-static-style-49');
            ta.value = this.rawText;
            ta.placeholder = zh ? '把你和 AI 的对话、或论文里打动你的段落粘到这里…' : 'Paste the chat or the paragraph that struck you…';
            ta.addEventListener('input', () => { this.rawText = ta.value; });
            ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void this.runExtract(); } });

            const sampleRow = c.createDiv();
            sampleRow.addClass('sch-static-style-50');
            const sample = sampleRow.createEl('a', { text: zh ? '试试示例' : 'Try a sample' });
            sample.addClass('sch-static-style-51');
            sample.addEventListener('click', () => { ta.value = this.sampleText(); this.rawText = ta.value; });

            const btnRow = c.createDiv();
            btnRow.addClass('sch-static-style-52');
            uiButton(btnRow, { text: zh ? '取消' : 'Cancel', variant: 'ghost', onClick: () => this.close() });
            uiButton(btnRow, { text: zh ? '整理文本  ⌘↵' : 'Clean up text  ⌘↵', iconName: 'sparkle', variant: 'primary', onClick: () => void this.runExtract() });
        } else if (this.step === 'extracting') {
            const wrap = c.createDiv();
            wrap.addClass('sch-static-style-53');
            const sp = wrap.createDiv();
            sp.addClass('sch-static-style-54');
            wrap.createDiv({ text: zh ? '正在整理成自然的研究笔记…' : 'Cleaning this into a natural research note…' }).addClass('sch-static-style-55');
            wrap.createDiv({ text: zh ? '原文会按 Markdown 原样保存，不会被改写' : 'The original markdown will be saved verbatim' }).addClass('sch-static-style-56');
        } else {
            this.renderReview();
        }
    }

    private renderReview(): void {
        const zh = this.lang === 'zh';
        const c = this.contentEl;
        sectionHeader(c, { eyebrow: zh ? '复核' : 'Review', title: zh ? '确认这条想法' : 'Confirm this idea', level: 2 });

        const field = (label: string) => {
            const w = c.createDiv(); w.addClass('sch-static-style-34');
            const l = w.createDiv({ text: label });
            l.addClass('sch-static-style-44');
            return w;
        };
        const tw = field(zh ? '标题' : 'Title');
        const { input: titleIn } = uiInput(tw, { value: this.draft.title });
        titleIn.addEventListener('input', () => { this.draft.title = titleIn.value; });

        const ew = field(zh ? '整理文稿' : 'Cleaned note');
        const exTa = ew.createEl('textarea');
        exTa.addClass('sch-static-style-57');
        exTa.value = this.draft.excerpt;
        exTa.addEventListener('input', () => { this.draft.excerpt = exTa.value; });

        const gw = field(zh ? '标签（逗号分隔）' : 'Tags (comma-separated)');
        const { input: tagIn } = uiInput(gw, { value: this.draft.tags, placeholder: zh ? '如：催化, 机理' : 'e.g. catalysis, mechanism' });
        tagIn.addEventListener('input', () => { this.draft.tags = tagIn.value; });

        const sw = field(zh ? '状态' : 'Status');
        this.renderStatusPicker(sw);

        // connections — checkboxes against existing experiments (AI-suggested pre-checked)
        if (this.lib.experimentIndex.length) {
            const cw = field(zh ? '关联实验（AI 建议已勾选）' : 'Linked experiments (AI-suggested checked)');
            const box = cw.createDiv();
            box.addClass('sch-static-style-58');
            if (!this.draft.relatedExp.length) {
                const noSuggestion = box.createDiv({ text: zh ? 'AI 无建议，可手动勾选。' : 'AI has no suggestion. Select manually if needed.' });
                noSuggestion.addClass('sch-static-style-59');
            }
            for (const ex of this.lib.experimentIndex.slice(0, 30)) {
                const row = box.createDiv();
                row.addClass('sch-static-style-60');
                const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
                cb.checked = this.draft.relatedExp.includes(ex.id);
                cb.addEventListener('change', () => {
                    if (cb.checked) { if (!this.draft.relatedExp.includes(ex.id)) this.draft.relatedExp.push(ex.id); }
                    else this.draft.relatedExp = this.draft.relatedExp.filter(x => x !== ex.id);
                });
                row.appendChild(document.createTextNode(`${ex.id} · ${ex.title}`));
            }
        }

        const nw = field(zh ? '关联其他笔记（可手动添加）' : 'Linked notes (manual allowed)');
        const { input: noteIn } = uiInput(nw, {
            value: this.draft.relatedNotes.join(', '),
            placeholder: zh ? '输入笔记路径或标题，逗号分隔' : 'Note paths or titles, comma-separated'
        });
        noteIn.addEventListener('input', () => {
            this.draft.relatedNotes = this.parseCsv(noteIn.value);
        });
        const noteHint = nw.createDiv({ text: zh ? 'AI 会优先从最近的 Markdown 笔记中选择；你也可以自己补充。' : 'AI suggests from recent markdown notes; you can add more.' });
        noteHint.addClass('sch-static-style-61');

        const btnRow = c.createDiv();
        btnRow.addClass('sch-static-style-52');
        uiButton(btnRow, { text: zh ? '返回' : 'Back', variant: 'ghost', onClick: () => { this.step = 'paste'; this.renderStep(); } });
        uiButton(btnRow, { text: zh ? '保存 · 建立想法  ⌘↵' : 'Save · create idea  ⌘↵', iconName: 'check', variant: 'primary', onClick: () => void this.save() });

        this.scope.register(['Mod'], 'Enter', () => { void this.save(); return false; });
    }

    private renderSourcePicker(parent: HTMLElement): void {
        const zh = this.lang === 'zh';
        const wrap = parent.createDiv();
        wrap.addClass('sch-static-style-62');
        const options: Array<{ value: IdeaSource; label: string }> = [
            { value: 'claude', label: 'Claude' },
            { value: 'gpt', label: 'GPT' },
            { value: 'paper', label: zh ? '文献' : 'Paper' },
            { value: 'manual', label: zh ? '手动' : 'Manual' },
        ];
        for (const opt of options) {
            const active = this.source === opt.value;
            const btn = wrap.createEl('button', { text: opt.label });
            btn.setCssStyles({
                height: '28px',
                padding: '0 14px',
                border: '0',
                borderRadius: '999px',
                background: active ? 'var(--sch-surface)' : 'transparent',
                color: active ? 'var(--sch-accent-ink)' : 'var(--sch-mute)',
                fontWeight: '700',
                cursor: 'pointer',
                transition: 'all .15s ease',
            });
            btn.addEventListener('click', () => {
                this.source = opt.value;
                this.renderStep();
            });
        }
    }

    private renderStatusPicker(parent: HTMLElement): void {
        const options: IdeaStatus[] = ['draft', 'refined', 'integrated'];
        const wrap = parent.createDiv();
        wrap.addClass('sch-static-style-62');
        for (const value of options) {
            const meta = STATUS_META[value];
            const active = this.draft.status === value;
            const btn = wrap.createEl('button', { text: meta[this.lang] });
            btn.setCssStyles({
                height: '28px',
                padding: '0 14px',
                border: '0',
                borderRadius: '999px',
                background: active ? 'var(--sch-surface)' : 'transparent',
                color: active ? 'var(--sch-accent-ink)' : 'var(--sch-mute)',
                fontWeight: '700',
                cursor: 'pointer',
                transition: 'all .15s ease',
            });
            btn.addEventListener('click', () => {
                this.draft.status = value;
                this.renderStep();
            });
        }
    }

    private async runExtract(): Promise<void> {
        if (!this.rawText.trim()) { new Notice(this.lang === 'zh' ? '请先粘贴内容' : 'Paste something first'); return; }
        this.step = 'extracting';
        this.renderStep();
        try {
            const r = await this.callIdeaAI(this.rawText);
            this.draft.excerpt = this.buildCleanNote(r.excerpt, this.rawText);
            this.draft.title = this.titleFromContent(this.rawText, this.draft.excerpt, r.title);
            const tags = this.normalizeTags(r.tags);
            this.draft.tags = (tags.length ? tags : this.inferTags(this.rawText + '\n' + this.draft.excerpt)).join(', ');
            const aiRelated = this.normalizeRelatedExperiments(r.relatedExpIds || []);
            this.draft.relatedExp = aiRelated.length ? aiRelated : this.inferRelatedExperiments(this.rawText + '\n' + this.draft.excerpt);
            this.draft.relatedNotes = (r.relatedNotes || []).filter(path => this.app.vault.getAbstractFileByPath(path) instanceof TFile);
            this.draft.relatedChapter = r.relatedChapter || '';
        } catch (e) {
            new Notice((this.lang === 'zh' ? 'AI 提炼失败，已用基础提取：' : 'AI failed, using basic extract: ') + (e as Error).message);
            this.fallbackExtract();
        }
        this.step = 'review';
        this.renderStep();
    }

    private fallbackExtract(): void {
        const text = this.rawText.trim();
        this.draft.title = (text.split('\n').find(l => l.trim())?.slice(0, 40)) || (this.lang === 'zh' ? '新想法' : 'New idea');
        const sentences = splitSentences(text).slice(0, 2).join(' ');
        this.draft.excerpt = this.deAiText(sentences || text.slice(0, 280));
        this.draft.excerpt = this.buildCleanNote('', text);
        this.draft.title = this.titleFromContent(text, this.draft.excerpt, '');
        this.draft.tags = this.inferTags(text).join(', ');
        this.draft.relatedExp = this.inferRelatedExperiments(text);
        this.draft.relatedNotes = [];
    }

    private buildCleanNote(aiText: string, sourceText: string): string {
        const cleanedAi = this.deAiText(this.removeAssistantPreamble(aiText || ''));
        if (cleanedAi.length >= 24 && !this.isMetaReply(cleanedAi)) return cleanedAi;
        const extracted = this.extractSubstantiveNote(sourceText);
        return this.deAiText(extracted || sourceText.trim().slice(0, 600));
    }

    private titleFromContent(sourceText: string, cleanNote: string, aiTitle: string): string {
        const cleanedAiTitle = this.deAiText(this.removeAssistantPreamble(aiTitle || '')).replace(/^#+\s*/, '').trim();
        if (cleanedAiTitle.length >= 4 && !this.isMetaReply(cleanedAiTitle)) return cleanedAiTitle.slice(0, 56);

        const combined = `${cleanNote}\n${sourceText}`;
        const lower = combined.toLowerCase();
        if (/飞秒|瞬态|transient/.test(combined) && /吸收|absorption/.test(combined) && /深度学习|deep learning/.test(combined)) {
            return '飞秒瞬态吸收光谱深度学习笔记';
        }
        if (/tio2/i.test(combined) && /\bau\b/i.test(combined) && /光催化|photocatal/.test(lower)) {
            return 'Au/TiO2 光催化瞬态吸收分析';
        }
        if (/lspr/i.test(combined) && /瞬态|transient|pump/i.test(combined)) {
            return 'LSPR 激发下的瞬态吸收机制';
        }

        const line = this.extractSubstantiveLines(combined)
            .map(l => l.replace(/^[-*#>\d.\s、)]+/, '').trim())
            .find(l => l.length >= 6 && !this.isMetaReply(l));
        return (line || (this.lang === 'zh' ? '新的研究想法' : 'New research idea')).slice(0, 56);
    }

    private isMetaReply(text: string): boolean {
        const value = text.trim();
        if (!value) return true;
        const head = value.slice(0, 160);
        return /^(可以|好的|当然|没问题|行|好|我来|我会|我将|让我|下面|以下|这里|sure|okay|here is|i can|i will)\b/i.test(head)
            || /我把.{0,50}(上传|提供|现在).{0,50}(文献|内容|对话).{0,50}(合并|整理|生成|写成)/.test(head)
            || /(上传的|你提供的).{0,40}(文献|内容|对话).{0,40}(合并成|整理成|生成)/.test(head)
            || /(帮你|为你).{0,40}(生成|整理|合并|写一段|写成)/.test(head);
    }

    private removeAssistantPreamble(text: string): string {
        let value = text.trim();
        value = value.replace(/^\s*(可以|好的|当然|没问题|行|好)[，,。.!！\s]*/i, '');
        const sentences = splitSentences(value);
        if (sentences.length > 1 && this.isMetaReply(sentences[0] || '')) {
            value = sentences.slice(1).join(' ').trim();
        }
        const lines = value.split(/\r?\n/).filter(line => {
            const t = line.trim();
            if (!t) return true;
            return !this.isMetaReply(t);
        });
        return lines.join('\n').trim();
    }

    private extractSubstantiveNote(sourceText: string): string {
        const lines = this.extractSubstantiveLines(this.removeAssistantPreamble(sourceText));
        if (lines.length) return lines.join('\n');
        const cleaned = this.removeAssistantPreamble(sourceText);
        return splitSentences(cleaned).filter(s => !this.isMetaReply(s)).slice(0, 6).join(' ').trim();
    }

    private extractSubstantiveLines(text: string): string[] {
        const domain = /(TA|LSPR|TRPL|PL|EPR|TiO2|Au|pump|probe|transient|absorption|photocatal|飞秒|瞬态|吸收|光谱|深度学习|光催化|载流子|复合|动力学|机理|文献)/i;
        const lines = text.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !this.isMetaReply(line));
        const preferred = lines.filter(line => /^#{1,6}\s|^[-*]\s|^\d+[.)、]\s/.test(line) || domain.test(line));
        return (preferred.length >= 2 ? preferred : lines).slice(0, 18);
    }

    private deAiText(text: string): string {
        let value = text.trim();
        value = this.removeAssistantPreamble(value);
        const replacements: Array<[RegExp, string]> = [
            [/^\s*(可以[，,。]?|当然[，,。]?|好的[，,。]?|没问题[，,。]?|我来帮你|下面是|以下是|这里是|总的来说[，,]?|综上[，,]?)/g, ''],
            [/^\s*(那我来|我会|我将|让我们|我们可以先)[^。.!?！？]{0,40}[。.!?！？]\s*/g, ''],
            [/(值得注意的是|需要注意的是|可以看出|这表明|这说明)[，,]?/g, ''],
            [/(进一步而言|此外|另外|同时)[，,]?/g, ''],
            [/通过(.{1,24})可以(.{1,24})/g, '$1能$2'],
            [/具有重要意义/g, '有用'],
            [/提供了新的思路/g, '给了一个思路'],
            [/进行系统性/g, '系统'],
            [/深入探究/g, '继续看'],
            [/[ \t]{2,}/g, ' '],
        ];
        for (const [pattern, replacement] of replacements) {
            value = value.replace(pattern, replacement);
        }
        return value.trim();
    }

    private normalizeTags(tags: string[]): string[] {
        return Array.from(new Set(tags
            .map(t => this.deAiText(t).replace(/^#/, '').trim())
            .filter(t => t.length > 0 && t.length <= 16)))
            .slice(0, 8);
    }

    private inferTags(text: string): string[] {
        const dict = ['文献', '深度学习', '吸收光谱', '飞秒瞬态吸收', '光谱', '催化', '机理', '纳米材料', '复合材料', 'TiO2', 'Au', '等离激元', '光催化', '数据分析', '实验设计'];
        const lower = text.toLowerCase();
        const hits = dict.filter(tag => lower.includes(tag.toLowerCase()));
        return Array.from(new Set(hits)).slice(0, 6);
    }

    private normalizeRelatedExperiments(values: string[]): string[] {
        const out: string[] = [];
        for (const raw of values) {
            const value = (raw || '').trim().toLowerCase();
            if (!value) continue;
            const found = this.lib.experimentIndex.find(exp => {
                const id = exp.id.toLowerCase();
                const title = exp.title.toLowerCase();
                return value === id
                    || value.includes(id)
                    || id.includes(value)
                    || value.includes(title)
                    || title.includes(value);
            });
            if (found && !out.includes(found.id)) out.push(found.id);
        }
        return out.slice(0, 5);
    }

    private inferRelatedExperiments(text: string): string[] {
        const tokens = this.keywordTokens(text);
        if (!tokens.length) return [];
        return this.lib.experimentIndex
            .map(exp => {
                const hay = `${exp.id} ${exp.title}`.toLowerCase();
                const body = text.toLowerCase();
                let score = body.includes(exp.id.toLowerCase()) ? 6 : 0;
                if (exp.title && body.includes(exp.title.toLowerCase())) score += 6;
                score += tokens.reduce((n, token) => n + (hay.includes(token) ? 1 : 0), 0);
                return { id: exp.id, score };
            })
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(x => x.id);
    }

    private keywordTokens(text: string): string[] {
        const ascii = text.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? [];
        const zh = text.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
        const stop = new Set(['可以', '这个', '这些', '我们', '现在', '上传', '合并', '文献', '标题', '内容', '实验记录']);
        return Array.from(new Set([...ascii, ...zh]
            .map(x => x.toLowerCase())
            .filter(x => !stop.has(x) && x.length >= 2)))
            .slice(0, 40);
    }

    private parseCsv(value: string): string[] {
        return value.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    }

    private noteCandidates(limit: number): NoteRef[] {
        const ideaFolder = this.lib.folderPath();
        return this.app.vault.getMarkdownFiles()
            .filter(file => !file.path.startsWith(ideaFolder + '/'))
            .sort((a, b) => b.stat.mtime - a.stat.mtime)
            .slice(0, limit)
            .map(file => ({ path: file.path, title: file.basename }));
    }

    private async save(): Promise<void> {
        if (this.step !== 'review') return;
        const tags = this.draft.tags.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
        const idea: Idea = {
            id: this.lib.nextId(),
            title: this.draft.title.trim() || (this.lang === 'zh' ? '未命名想法' : 'Untitled idea'),
            source: this.source,
            date: new Date().toISOString().split('T')[0]!,
            status: this.draft.status,
            excerpt: this.draft.excerpt.trim(),
            tags,
            relatedExp: this.draft.relatedExp,
            relatedNotes: this.draft.relatedNotes,
            relatedChapter: this.draft.relatedChapter || undefined,
            pinned: false,
            raw: this.rawText,
        };
        try {
            await this.lib.saveIdea(idea);
            new Notice(this.lang === 'zh' ? `已保存 ${idea.id}` : `Saved ${idea.id}`);
            this.close();
            this.plugin.refreshDashboards();
        } catch (e) {
            new Notice('保存失败：' + (e as Error).message);
        }
    }

    // self-contained AI call returning structured JSON
    private async callIdeaAI(text: string): Promise<{ title: string; excerpt: string; tags: string[]; relatedExpIds: string[]; relatedNotes: string[]; relatedChapter?: string }> {
        const { aiProvider, aiApiKey, aiModel, aiCustomEndpoint, aiTemperature } = this.plugin.settings;
        if (!aiApiKey) throw new Error(this.lang === 'zh' ? '未配置 AI API Key' : 'No AI API key configured');
        const expList = this.lib.experimentIndex.slice(0, 40).map(e => `${e.id}: ${e.title}`).join('\n') || '(none)';
        const noteCandidates = this.noteCandidates(50);
        const noteList = noteCandidates.map(n => `${n.path}: ${n.title}`).join('\n') || '(none)';
        const chapters = this.lib.thesisChapters.join(', ') || '(none)';
        const system = `You turn pasted text into a researcher's private note, not AI-flavoured copy.
Return ONLY a JSON object, no markdown fences, of shape:
{"title": string (<=40 chars), "excerpt": string (natural rewritten note), "tags": string[], "relatedExpIds": string[], "relatedNotes": string[], "relatedChapter": string|null}
Required:
- title must be a concise content title, never a sentence like "I can help..." or a copy of the user's request.
- If the pasted text contains an assistant reply, discard the conversational preamble and keep only the substantive research content.
- Never copy phrases like "I will help you", "I merged the uploaded papers", "here is", "below is", or their Chinese equivalents into title or excerpt.
- tags must contain 3-8 short topic tags extracted from the pasted content.
- relatedExpIds should include every clearly related experiment from the provided list, up to 5 items.
- relatedNotes should include clearly related note paths from the provided note list, up to 5 items.
Style rules for excerpt:
- Write like the user is making a note to themselves.
- If the source asks to merge/summarise files, write the resulting note directly. Do not mention that you are helping, generating, uploading, or processing text.
- Rewrite the actual content into a polished note. Do not describe the task you performed.
- Keep concrete details from the source. Do not add claims not in the source.
- Avoid AI-summary phrases such as "sure", "I can help", "here is", "it is worth noting", "this indicates", "in conclusion", "provides a new perspective", or broad value judgments.
- Prefer plain verbs, short clauses, and uncertainty when appropriate.
- No bullet list unless the source itself is a list and bullets are the clearest form.
Pick relatedExpIds ONLY from this list of the user's experiments:
${expList}
Pick relatedNotes ONLY from this list of markdown notes:
${noteList}
Thesis chapters: ${chapters}
Match the language of the source text for title/excerpt.`;
        const raw = await this.providerCall(aiProvider, aiApiKey, aiModel, aiCustomEndpoint, aiTemperature, system, text);
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('no JSON in AI response');
        const parsed = safeParseJson<{ title?: string; excerpt?: string; tags?: string[]; relatedExpIds?: string[]; relatedNotes?: string[]; relatedChapter?: string | null }>(jsonMatch[0], 'idea extraction');
        if (!parsed) throw new Error('AI returned invalid JSON');
        return {
            title: parsed.title || '',
            excerpt: parsed.excerpt || '',
            tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            relatedExpIds: Array.isArray(parsed.relatedExpIds) ? parsed.relatedExpIds : [],
            relatedNotes: Array.isArray(parsed.relatedNotes) ? parsed.relatedNotes : [],
            relatedChapter: parsed.relatedChapter || undefined,
        };
    }

    private async providerCall(provider: AIProvider, apiKey: string, model: string, customEndpoint: string, temp: number, system: string, user: string): Promise<string> {
        if (provider === 'claude') {
            const res = await requestUrlWithTimeout({
                url: 'https://api.anthropic.com/v1/messages',
                method: 'POST',
                headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
                body: JSON.stringify({ model: model || 'claude-sonnet-4-6', max_tokens: 1024, system, messages: [{ role: 'user', content: user }] }),
            });
            if (res.status < 200 || res.status >= 300) throw new Error(`Claude ${res.status}`);
            const d = res.json as { content: Array<{ type: string; text: string }> };
            return d.content.find(x => x.type === 'text')?.text ?? '';
        }
        const cfg = PROVIDER_CONFIG[provider];
        const endpoint = provider === 'custom' ? customEndpoint : cfg.endpoint;
        if (!endpoint) throw new Error(this.lang === 'zh' ? '缺少 API 端点' : 'Missing API endpoint');
        const res = await requestUrlWithTimeout({
            url: endpoint,
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1024, temperature: temp }),
        });
        if (res.status < 200 || res.status >= 300) throw new Error(`${cfg.label} ${res.status}`);
        const d = res.json as { choices: Array<{ message: { content: string } }> };
        return d.choices[0]?.message?.content ?? '';
    }

    private sampleText(): string {
        return this.lang === 'zh'
            ? '在讨论钯催化偶联时，AI 指出配体的电子效应可能是收率波动的主因：富电子膦配体加速氧化加成，但过量会抑制还原消除。也许可以系统筛选一组配体的电子参数与收率的关系。'
            : 'While discussing Pd-catalysed coupling, the model noted ligand electronics likely drive the yield scatter: electron-rich phosphines speed oxidative addition but excess suppresses reductive elimination. Worth screening a ligand electronic-parameter vs. yield series.';
    }
}
