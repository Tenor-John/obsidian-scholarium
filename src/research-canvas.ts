import { App, TFile } from 'obsidian';
import ChemELNPlugin from './main';

// ─── Constants ───────────────────────────────────────────
const UNCLASSIFIED_ID = '__unclassified__';
const CARD_W = 240;
const CARD_H = 200;

// Connection colors
const CONN_COLORS = ['#42A5F5', '#66BB6A', '#AB47BC', '#EF5350', '#FF7043', '#26C6DA'];
let connColorIdx = 0;

const ZONE_PALETTES = [
    { bg: 'rgba(99,179,237,0.07)',   border: 'rgba(99,179,237,0.55)',   header: 'rgba(99,179,237,0.16)'   },
    { bg: 'rgba(104,211,145,0.07)',  border: 'rgba(104,211,145,0.55)',  header: 'rgba(104,211,145,0.16)'  },
    { bg: 'rgba(246,173,85,0.07)',   border: 'rgba(246,173,85,0.55)',   header: 'rgba(246,173,85,0.16)'   },
    { bg: 'rgba(196,132,200,0.07)',  border: 'rgba(196,132,200,0.55)',  header: 'rgba(196,132,200,0.16)'  },
    { bg: 'rgba(252,129,74,0.07)',   border: 'rgba(252,129,74,0.55)',   header: 'rgba(252,129,74,0.16)'   },
    { bg: 'rgba(129,230,217,0.07)',  border: 'rgba(129,230,217,0.55)',  header: 'rgba(129,230,217,0.16)'  },
    { bg: 'rgba(239,154,154,0.07)',  border: 'rgba(239,154,154,0.55)',  header: 'rgba(239,154,154,0.16)'  },
];

// ─── Interfaces ──────────────────────────────────────────
interface LiteratureNote {
    file: TFile;
    title: string;
    journal: string;
    year: string;
    tags: string[];
    abstract: string;
    doi: string;
    stage: string;
    leadsTo: string[];
    relatedTo: string[];
}

interface CardPosition { x: number; y: number; }

interface Zone {
    id: string;
    name: string;
    paletteIdx: number;
    x: number;
    y: number;
    w: number;
    h: number;
}

interface ManualConnection {
    id: string;
    from: string;   // file path
    to: string;     // file path
    color: string;  // hex
    label?: string; // optional label
}

interface CanvasData {
    positions: Record<string, CardPosition>;
    zones: Zone[];
    cardZones: Record<string, string>; // filePath → zoneId
    connections: ManualConnection[];   // manually drawn connections
    zoom: number;
    offsetX: number;
    offsetY: number;
    folder: string;
}

// ─── Main Class ──────────────────────────────────────────
export class ResearchCanvas {
    private data: CanvasData = {
        positions: {},
        zones: [],
        cardZones: {},
        connections: [],
        zoom: 0.75,
        offsetX: 40,
        offsetY: 40,
        folder: '',
    };
    private notes: LiteratureNote[] = [];
    private container: HTMLElement | null = null;
    private canvasEl: HTMLElement | null = null;
    private svgEl: SVGSVGElement | null = null;
    private isDraggingCard = false;

    // ─── Connection mode state ────────────────────────────
    private connectMode    = false;
    private connectSource: string | null = null; // filePath
    private _escCleanups: Array<() => void> = [];

    constructor(private app: App, private plugin: ChemELNPlugin) {}

    // ─── Persist ─────────────────────────────────────────
    async load(): Promise<void> {
        const raw = (await this.plugin.loadData()) as Record<string, unknown>;
        const saved = raw?.['researchCanvasData'] as CanvasData | undefined;
        if (saved) {
            this.data = { ...this.data, ...saved };
            if (!this.data.zones)       this.data.zones       = [];
            if (!this.data.cardZones)   this.data.cardZones   = {};
            if (!this.data.connections) this.data.connections = [];
        }
    }

    async save(): Promise<void> {
        const current = ((await this.plugin.loadData()) as Record<string, unknown>) ?? {};
        current['researchCanvasData'] = this.data;
        await this.plugin.saveData(current);
    }

    // ─── Ensure default unclassified zone ────────────────
    private ensureUnclassifiedZone(): void {
        if (!this.data.zones.find(z => z.id === UNCLASSIFIED_ID)) {
            this.data.zones.unshift({
                id: UNCLASSIFIED_ID,
                name: '未分类区',
                paletteIdx: -1,
                x: 40, y: 40,
                w: 960, h: 360,
            });
        }
    }

    // ─── Load Notes from Vault ───────────────────────────
    async loadNotes(folder: string): Promise<void> {
        this.notes = [];
        this.data.folder = folder;

        let files: TFile[] = [];
        if (!folder.trim()) {
            files = this.app.vault.getMarkdownFiles();
        } else {
            const folderObj = this.app.vault.getAbstractFileByPath(folder);
            if (!folderObj || !('children' in folderObj)) return;
            const walk = (parent: { children?: unknown[] }) => {
                if (!parent.children) return;
                for (const child of parent.children) {
                    if (child instanceof TFile && child.extension === 'md') files.push(child);
                    else if (child && typeof child === 'object' && 'children' in child)
                        walk(child as { children?: unknown[] });
                }
            };
            walk(folderObj as unknown as { children?: unknown[] });
        }

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter ?? {};

            const title = (fm['title'] as string) || file.basename;
            const journal = (fm['journal'] as string) || '';
            const year = String(fm['year'] ?? '').replace(/"/g, '');
            const doi = (fm['doi'] as string) || '';

            let tags: string[] = [];
            const tagData = fm['tags'];
            if (Array.isArray(tagData)) tags = tagData.map((t: unknown) => String(t).replace(/^#/, ''));
            else if (typeof tagData === 'string') tags = [tagData.replace(/^#/, '')];

            const abstract = String(fm['abstract'] || fm['summary'] || fm['摘要'] || '');

            let stage = '';
            if (typeof fm['stage'] === 'string') stage = fm['stage'].replace(/"/g, '');
            else {
                const stageTag = tags.find(t => t.startsWith('stage/'));
                if (stageTag) stage = stageTag.substring(6);
            }

            let leadsTo: string[] = [];
            const ltd = fm['leads_to'] || fm['leadsTo'] || fm['lead_to'];
            if (Array.isArray(ltd)) leadsTo = ltd.map((v: unknown) => String(v).trim());
            else if (typeof ltd === 'string') leadsTo = [ltd.trim()];

            let relatedTo: string[] = [];
            const rtd = fm['related_to'] || fm['relatedTo'];
            if (Array.isArray(rtd)) relatedTo = rtd.map((v: unknown) => String(v).trim());
            else if (typeof rtd === 'string') relatedTo = [rtd.trim()];

            this.notes.push({
                file, title: title || '(无标题)', journal, year, tags,
                abstract: abstract.substring(0, 100), doi, stage, leadsTo, relatedTo,
            });
            if (!(file.path in this.data.positions)) {
                this.data.positions[file.path] = { x: 0, y: 0 };
            }
        }

        // Ensure zones for stages
        this.ensureUnclassifiedZone();
        const existingNames = new Set(this.data.zones.map(z => z.name));
        const stages = [...new Set(this.notes.map(n => n.stage).filter(Boolean))];
        let pIdx = this.data.zones.filter(z => z.id !== UNCLASSIFIED_ID).length;
        for (const stage of stages) {
            if (!existingNames.has(stage)) {
                this.data.zones.push({
                    id: `zone_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
                    name: stage,
                    paletteIdx: pIdx++ % ZONE_PALETTES.length,
                    x: 0, y: 0, w: 960, h: 360,
                });
            }
        }

        // Assign unassigned cards
        for (const note of this.notes) {
            if (!(note.file.path in this.data.cardZones)) {
                if (note.stage) {
                    const z = this.data.zones.find(z => z.name === note.stage);
                    this.data.cardZones[note.file.path] = z ? z.id : UNCLASSIFIED_ID;
                } else {
                    this.data.cardZones[note.file.path] = UNCLASSIFIED_ID;
                }
            }
        }

        // Auto-layout if all positions are zero
        const allZero = this.notes.every(n => {
            const p = this.data.positions[n.file.path];
            return !p || (p.x === 0 && p.y === 0);
        });
        if (allZero) this.autoLayout();
    }

    // ─── Auto Layout ─────────────────────────────────────
    private autoLayout(): void {
        const COLS = 3;
        const CARD_GAP_X = 20;
        const CARD_GAP_Y = 20;
        const ZONE_PAD  = 50;
        const ZONE_HDR  = 48;
        const ZONE_GAP  = 40;
        const ZONE_W    = COLS * (CARD_W + CARD_GAP_X) + ZONE_PAD * 2 - CARD_GAP_X;

        const ordered = [
            ...this.data.zones.filter(z => z.id === UNCLASSIFIED_ID),
            ...this.data.zones.filter(z => z.id !== UNCLASSIFIED_ID),
        ];

        let curY = 40;
        for (const zone of ordered) {
            const inZone = this.notes.filter(n => this.data.cardZones[n.file.path] === zone.id);
            const rows = Math.max(1, Math.ceil(inZone.length / COLS));
            const zoneH = ZONE_HDR + ZONE_PAD + rows * (CARD_H + CARD_GAP_Y) - CARD_GAP_Y + ZONE_PAD;

            zone.x = 40; zone.y = curY; zone.w = ZONE_W; zone.h = zoneH;

            inZone.forEach((note, i) => {
                const col = i % COLS;
                const row = Math.floor(i / COLS);
                this.data.positions[note.file.path] = {
                    x: zone.x + ZONE_PAD + col * (CARD_W + CARD_GAP_X),
                    y: zone.y + ZONE_HDR + ZONE_PAD + row * (CARD_H + CARD_GAP_Y),
                };
            });
            curY += zoneH + ZONE_GAP;
        }
    }

    // ─── Connection Mode Helpers ─────────────────────────
    private updateConnectHint(el: HTMLElement): void {
        if (!this.connectMode) {
            el.textContent = '';
            el.style.display = 'none';
            return;
        }
        el.style.display = 'inline';
        el.textContent = this.connectSource
            ? '点击目标卡片完成连线  [Esc 取消]'
            : '点击源卡片选择起点  [Esc 退出]';
    }

    private updateCardConnectClasses(): void {
        if (!this.canvasEl) return;
        this.canvasEl.querySelectorAll('.rc-card').forEach(el => {
            const path = (el as HTMLElement).dataset['path'] ?? '';
            el.classList.toggle('rc-card-connect-mode', this.connectMode);
            el.classList.toggle('rc-card-connect-source', path === this.connectSource);
        });
    }

    // ─── Main Render ─────────────────────────────────────
    render(container: HTMLElement): void {
        this.container = container;
        container.empty();
        container.addClass('rc-full-panel');

        /* ── Toolbar ── */
        const toolbar = container.createDiv({ cls: 'rc-toolbar' });
        const tLeft   = toolbar.createDiv({ cls: 'rc-toolbar-left' });
        const tRight  = toolbar.createDiv({ cls: 'rc-toolbar-right' });

        tLeft.createSpan({ text: '文件夹:', cls: 'rc-toolbar-label' });
        const folderInput = tLeft.createEl('input', {
            attr: { type: 'text', placeholder: 'folder/path  或留空扫描全库', value: this.data.folder },
            cls: 'rc-folder-input',
        });
        const loadBtn   = tLeft.createEl('button', { text: '载入',    cls: 'rc-toolbar-btn rc-toolbar-btn-primary' });
        const layoutBtn = tLeft.createEl('button', { text: '重新布局', cls: 'rc-toolbar-btn' });
        const fitBtn    = tLeft.createEl('button', { text: '适配窗口', cls: 'rc-toolbar-btn' });

        const addZoneBtn  = tRight.createEl('button', { text: '＋ 新建分区', cls: 'rc-toolbar-btn rc-btn-zone' });
        const connectBtn  = tRight.createEl('button', {
            text: '🔗 连线',
            cls: `rc-toolbar-btn rc-btn-connect${this.connectMode ? ' active' : ''}`,
        });
        const connectHint = tRight.createSpan({ cls: 'rc-connect-hint' });
        this.updateConnectHint(connectHint);
        const zoomLabel   = tRight.createSpan({ text: `${Math.round(this.data.zoom * 100)}%`, cls: 'rc-zoom-label' });

        loadBtn.addEventListener('click', async () => {
            await this.loadNotes(folderInput.value); this.render(container); await this.save();
        });
        layoutBtn.addEventListener('click', async () => {
            this.autoLayout(); this.render(container); await this.save();
        });
        fitBtn.addEventListener('click', () => this.fitToScreen());
        folderInput.addEventListener('keypress', async e => {
            if (e.key === 'Enter') { await this.loadNotes(folderInput.value); this.render(container); await this.save(); }
        });
        addZoneBtn.addEventListener('click', () => this.promptAddZone(container));

        // Toggle connection mode
        connectBtn.addEventListener('click', () => {
            this.connectMode   = !this.connectMode;
            this.connectSource = null;
            connectBtn.classList.toggle('active', this.connectMode);
            this.updateConnectHint(connectHint);
            // Refresh card classes
            this.updateCardConnectClasses();
        });

        // Esc cancels connection mode / clears source
        const escHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.connectMode) {
                if (this.connectSource) {
                    this.connectSource = null;
                    this.updateCardConnectClasses();
                    this.updateConnectHint(connectHint);
                } else {
                    this.connectMode = false;
                    connectBtn.classList.remove('active');
                    this.updateConnectHint(connectHint);
                    this.updateCardConnectClasses();
                }
            }
        };
        document.addEventListener('keydown', escHandler);
        // Store cleanup for when the canvas is destroyed / re-rendered
        if (!this._escCleanups) this._escCleanups = [];
        // Remove previous handler
        this._escCleanups.forEach(fn => fn());
        this._escCleanups = [() => document.removeEventListener('keydown', escHandler)];

        /* ── Viewport ── */
        const viewport = container.createDiv({ cls: 'rc-viewport' });
        this.setupCanvasPan(viewport, zoomLabel);

        const canvas = viewport.createDiv({ cls: 'rc-canvas-layer' });
        this.canvasEl = canvas;
        this.applyTransform();

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'rc-svg-layer');
        svg.setAttribute('width', '8000');
        svg.setAttribute('height', '6000');
        canvas.appendChild(svg);
        this.svgEl = svg;

        if (this.notes.length === 0) {
            this.ensureUnclassifiedZone();
        }

        /* ── Zones (rendered behind cards) ── */
        this.ensureUnclassifiedZone();
        const zoneOrder = [
            ...this.data.zones.filter(z => z.id === UNCLASSIFIED_ID),
            ...this.data.zones.filter(z => z.id !== UNCLASSIFIED_ID),
        ];
        for (const zone of zoneOrder) {
            this.renderZone(canvas, zone, container);
        }

        /* ── Cards ── */
        for (const note of this.notes) {
            const pos = this.data.positions[note.file.path] ?? { x: 80, y: 100 };
            const card = document.createElement('div');
            card.className = 'rc-card';
            card.style.left = pos.x + 'px';
            card.style.top  = pos.y + 'px';
            card.setAttribute('data-path', note.file.path);

            let html = '';
            html += `<div class="rc-card-title">${this.esc(note.title)}</div>`;
            html += `<div class="rc-card-meta">`;
            if (note.journal) html += `<span class="rc-journal">${this.esc(note.journal)}</span>`;
            if (note.year)    html += `<span class="rc-year"> · ${note.year}</span>`;
            html += `</div>`;
            if (note.abstract) html += `<div class="rc-card-abstract">${this.esc(note.abstract)}</div>`;
            if (note.tags.length) {
                html += `<div class="rc-card-tags">`;
                note.tags.slice(0, 3).forEach(t => { html += `<span class="rc-tag">#${this.esc(t)}</span>`; });
                html += `</div>`;
            }
            html += `<div class="rc-card-footer">`;
            if (note.doi) html += `<span class="rc-doi" title="打开 DOI">DOI ↗</span>`;
            html += `<span class="rc-open" title="打开笔记">📄</span>`;
            html += `</div>`;
            card.innerHTML = html;

            card.querySelector('.rc-doi')?.addEventListener('click', e => {
                e.stopPropagation(); window.open(`https://doi.org/${note.doi}`, '_blank');
            });
            card.querySelector('.rc-open')?.addEventListener('click', e => {
                e.stopPropagation(); this.app.workspace.openLinkText(note.file.path, '', false);
            });

            // Connect-mode click
            card.addEventListener('click', async (e: Event) => {
                if (!this.connectMode) return;
                e.stopPropagation();
                const path = note.file.path;

                if (!this.connectSource) {
                    // Select as source
                    this.connectSource = path;
                    this.updateCardConnectClasses();
                    // hint is in toolbar — update
                    const hint = container.querySelector('.rc-connect-hint') as HTMLElement | null;
                    if (hint) this.updateConnectHint(hint);
                } else if (this.connectSource === path) {
                    // Deselect source
                    this.connectSource = null;
                    this.updateCardConnectClasses();
                    const hint = container.querySelector('.rc-connect-hint') as HTMLElement | null;
                    if (hint) this.updateConnectHint(hint);
                } else {
                    // Create connection
                    const color = CONN_COLORS[connColorIdx++ % CONN_COLORS.length]!;
                    const newConn: ManualConnection = {
                        id: `c_${Date.now().toString(36)}`,
                        from: this.connectSource,
                        to: path,
                        color,
                    };
                    this.data.connections.push(newConn);
                    this.connectSource = null;
                    this.updateCardConnectClasses();
                    this.updateSVGConnections();
                    const hint = container.querySelector('.rc-connect-hint') as HTMLElement | null;
                    if (hint) this.updateConnectHint(hint);
                    await this.save();
                }
            });

            canvas.appendChild(card);
            this.setupCardDrag(card, note, canvas, container);
        }

        this.updateSVGConnections();
    }

    // ─── Render Single Zone ───────────────────────────────
    private renderZone(canvas: HTMLElement, zone: Zone, fullContainer: HTMLElement): void {
        const isUnclassified = zone.id === UNCLASSIFIED_ID;
        const pal = isUnclassified
            ? { bg: 'rgba(140,140,140,0.05)', border: 'rgba(160,160,160,0.45)', header: 'rgba(140,140,140,0.12)' }
            : ZONE_PALETTES[zone.paletteIdx % ZONE_PALETTES.length]!;

        const zoneEl = document.createElement('div');
        zoneEl.className = 'rc-zone';
        zoneEl.setAttribute('data-zone-id', zone.id);
        zoneEl.style.left        = `${zone.x}px`;
        zoneEl.style.top         = `${zone.y}px`;
        zoneEl.style.width       = `${zone.w}px`;
        zoneEl.style.height      = `${zone.h}px`;
        zoneEl.style.background  = pal.bg;
        zoneEl.style.borderColor = pal.border;

        /* Header */
        const header = document.createElement('div');
        header.className = 'rc-zone-header';
        header.style.background = pal.header;

        const nameSpan = document.createElement('span');
        nameSpan.className   = 'rc-zone-name';
        nameSpan.textContent = zone.name;

        /* Rename on dblclick */
        nameSpan.addEventListener('dblclick', e => {
            e.stopPropagation();
            const inp = document.createElement('input');
            inp.className = 'rc-zone-name-input';
            inp.value = zone.name;
            nameSpan.replaceWith(inp);
            inp.focus(); inp.select();
            const commit = async () => {
                const v = inp.value.trim();
                if (v) zone.name = v;
                this.render(fullContainer); await this.save();
            };
            inp.addEventListener('blur', () => void commit());
            inp.addEventListener('keypress', ke => { if (ke.key === 'Enter') void commit(); });
        });

        const countEl = document.createElement('span');
        countEl.className   = 'rc-zone-count';
        countEl.textContent = `${this.notes.filter(n => this.data.cardZones[n.file.path] === zone.id).length} 篇`;

        const actions = document.createElement('div');
        actions.className = 'rc-zone-actions';

        if (!isUnclassified) {
            const del = document.createElement('button');
            del.className   = 'rc-zone-del-btn';
            del.textContent = '✕';
            del.title       = '删除分区（卡片移至未分类区）';
            del.addEventListener('click', async e => {
                e.stopPropagation();
                for (const n of this.notes) {
                    if (this.data.cardZones[n.file.path] === zone.id)
                        this.data.cardZones[n.file.path] = UNCLASSIFIED_ID;
                }
                this.data.zones = this.data.zones.filter(z => z.id !== zone.id);
                this.render(fullContainer); await this.save();
            });
            actions.appendChild(del);
        }

        header.append(nameSpan, countEl, actions);
        this.setupZoneDrag(header, zone, zoneEl);

        /* Resize handle */
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'rc-zone-resize';
        this.setupZoneResize(resizeHandle, zone, zoneEl);

        zoneEl.append(header, resizeHandle);
        canvas.appendChild(zoneEl);
    }

    // ─── Zone Drag ───────────────────────────────────────
    private setupZoneDrag(headerEl: HTMLElement, zone: Zone, zoneEl: HTMLElement): void {
        let dragging = false, sx = 0, sy = 0, szx = 0, szy = 0;

        headerEl.addEventListener('mousedown', (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('.rc-zone-actions, .rc-zone-del-btn, input')) return;
            e.preventDefault(); e.stopPropagation();
            dragging = true; sx = e.clientX; sy = e.clientY; szx = zone.x; szy = zone.y;

            const onMove = (e2: MouseEvent) => {
                if (!dragging) return;
                zone.x = szx + (e2.clientX - sx) / this.data.zoom;
                zone.y = szy + (e2.clientY - sy) / this.data.zoom;
                zoneEl.style.left = `${zone.x}px`;
                zoneEl.style.top  = `${zone.y}px`;
            };
            const onUp = async () => {
                dragging = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                await this.save();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ─── Zone Resize ─────────────────────────────────────
    private setupZoneResize(handleEl: HTMLElement, zone: Zone, zoneEl: HTMLElement): void {
        let resizing = false, sx = 0, sy = 0, sw = 0, sh = 0;

        handleEl.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault(); e.stopPropagation();
            resizing = true; sx = e.clientX; sy = e.clientY; sw = zone.w; sh = zone.h;

            const onMove = (e2: MouseEvent) => {
                if (!resizing) return;
                zone.w = Math.max(300, sw + (e2.clientX - sx) / this.data.zoom);
                zone.h = Math.max(200, sh + (e2.clientY - sy) / this.data.zoom);
                zoneEl.style.width  = `${zone.w}px`;
                zoneEl.style.height = `${zone.h}px`;
            };
            const onUp = async () => {
                resizing = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                await this.save();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ─── Add Zone ────────────────────────────────────────
    private promptAddZone(container: HTMLElement): void {
        // Use a custom inline prompt on the toolbar
        const modal = container.createDiv({ cls: 'rc-add-zone-modal' });
        const inner = modal.createDiv({ cls: 'rc-add-zone-inner' });
        inner.createEl('h4', { text: '新建分区', cls: 'rc-add-zone-title' });
        const inp = inner.createEl('input', {
            cls: 'rc-add-zone-input',
            attr: { type: 'text', placeholder: '输入分区名称…' }
        });
        const row = inner.createDiv({ cls: 'rc-add-zone-btns' });
        const okBtn = row.createEl('button', { text: '创建', cls: 'rc-toolbar-btn rc-toolbar-btn-primary' });
        const cancelBtn = row.createEl('button', { text: '取消', cls: 'rc-toolbar-btn' });

        inp.focus();

        const doCreate = async () => {
            const name = inp.value.trim();
            if (!name) { modal.remove(); return; }
            const userZones = this.data.zones.filter(z => z.id !== UNCLASSIFIED_ID);
            let maxY = 40;
            for (const z of this.data.zones) maxY = Math.max(maxY, z.y + z.h + 40);
            this.data.zones.push({
                id: `zone_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
                name,
                paletteIdx: userZones.length % ZONE_PALETTES.length,
                x: 40, y: maxY, w: 960, h: 360,
            });
            modal.remove();
            this.render(container); await this.save();
        };

        inp.addEventListener('keypress', e => { if (e.key === 'Enter') void doCreate(); });
        okBtn.addEventListener('click', () => void doCreate());
        cancelBtn.addEventListener('click', () => modal.remove());
    }

    // ─── Hit-test: which zone contains point ────────────
    private getZoneAt(cx: number, cy: number): Zone | null {
        // Classified zones take priority over unclassified
        const classified = this.data.zones.filter(z => z.id !== UNCLASSIFIED_ID);
        for (let i = classified.length - 1; i >= 0; i--) {
            const z = classified[i]!;
            if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) return z;
        }
        const unc = this.data.zones.find(z => z.id === UNCLASSIFIED_ID);
        if (unc && cx >= unc.x && cx <= unc.x + unc.w && cy >= unc.y && cy <= unc.y + unc.h) return unc;
        return null;
    }

    // ─── Card Drag ───────────────────────────────────────
    private setupCardDrag(
        cardEl: Element,
        note: LiteratureNote,
        canvas: HTMLElement,
        fullContainer: HTMLElement,
    ): void {
        let dragging = false;
        let sMouseX = 0, sMouseY = 0, sCardX = 0, sCardY = 0;

        cardEl.addEventListener('mousedown', (e: Event) => {
            const me = e as MouseEvent;
            if ((e.target as HTMLElement).closest('.rc-doi, .rc-open')) return;
            e.preventDefault(); e.stopPropagation();

            dragging = true;
            this.isDraggingCard = true;
            sMouseX = me.clientX; sMouseY = me.clientY;

            const pos = this.data.positions[note.file.path] ?? { x: 0, y: 0 };
            sCardX = pos.x; sCardY = pos.y;
            (cardEl as HTMLElement).classList.add('rc-card-dragging');

            const onMove = (e2: MouseEvent) => {
                if (!dragging) return;
                const nx = sCardX + (e2.clientX - sMouseX) / this.data.zoom;
                const ny = sCardY + (e2.clientY - sMouseY) / this.data.zoom;
                this.data.positions[note.file.path] = { x: nx, y: ny };
                (cardEl as HTMLElement).style.left = `${nx}px`;
                (cardEl as HTMLElement).style.top  = `${ny}px`;

                // Highlight target zone
                const zone = this.getZoneAt(nx + CARD_W / 2, ny + CARD_H / 2);
                canvas.querySelectorAll('.rc-zone').forEach(el =>
                    el.classList.toggle('rc-zone-drop-target',
                        zone !== null && (el as HTMLElement).dataset['zoneId'] === zone.id));

                this.updateSVGConnections();
            };

            const onUp = async () => {
                dragging = false;
                this.isDraggingCard = false;
                (cardEl as HTMLElement).classList.remove('rc-card-dragging');
                canvas.querySelectorAll('.rc-zone').forEach(el => el.classList.remove('rc-zone-drop-target'));

                const p = this.data.positions[note.file.path]!;
                const zone = this.getZoneAt(p.x + CARD_W / 2, p.y + CARD_H / 2);
                const newZoneId = zone ? zone.id : UNCLASSIFIED_ID;
                const changed = this.data.cardZones[note.file.path] !== newZoneId;
                this.data.cardZones[note.file.path] = newZoneId;

                if (changed) this.render(fullContainer);

                await this.save();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ─── Canvas Pan & Zoom ────────────────────────────────
    private setupCanvasPan(viewport: HTMLElement, zoomLabel: HTMLElement): void {
        let panning = false, sx = 0, sy = 0, sox = 0, soy = 0;

        viewport.addEventListener('mousedown', (e: MouseEvent) => {
            if (this.isDraggingCard) return;
            if ((e.target as HTMLElement).closest('.rc-card, .rc-zone-header, .rc-zone-resize, .rc-zone-actions, .rc-zone-del-btn')) return;
            panning = true;
            sx = e.clientX; sy = e.clientY;
            sox = this.data.offsetX; soy = this.data.offsetY;
            viewport.style.cursor = 'grabbing';

            const onMove = (e2: MouseEvent) => {
                if (!panning) return;
                this.data.offsetX = sox + (e2.clientX - sx);
                this.data.offsetY = soy + (e2.clientY - sy);
                this.applyTransform();
            };
            const onUp = async () => {
                panning = false;
                viewport.style.cursor = 'grab';
                zoomLabel.textContent = `${Math.round(this.data.zoom * 100)}%`;
                await this.save();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        viewport.addEventListener('wheel', e => {
            e.preventDefault();
            this.data.zoom = Math.max(0.2, Math.min(3, this.data.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
            this.applyTransform();
            zoomLabel.textContent = `${Math.round(this.data.zoom * 100)}%`;
            void this.save();
        }, { passive: false });
    }

    private applyTransform(): void {
        if (!this.canvasEl) return;
        this.canvasEl.style.transform = `translate(${this.data.offsetX}px, ${this.data.offsetY}px) scale(${this.data.zoom})`;
        this.canvasEl.style.transformOrigin = '0 0';
    }

    // ─── SVG Connections ─────────────────────────────────
    private updateSVGConnections(): void {
        if (!this.svgEl) return;
        while (this.svgEl.firstChild) this.svgEl.removeChild(this.svgEl.firstChild);

        const NS = 'http://www.w3.org/2000/svg';

        // ── Defs: arrow markers ──
        const defs = document.createElementNS(NS, 'defs');

        const makeMarker = (id: string, color: string) => {
            const m = document.createElementNS(NS, 'marker');
            m.setAttribute('id', id);
            m.setAttribute('markerWidth', '8'); m.setAttribute('markerHeight', '8');
            m.setAttribute('refX', '6');        m.setAttribute('refY', '3');
            m.setAttribute('orient', 'auto');
            const p = document.createElementNS(NS, 'path');
            p.setAttribute('d', 'M0,0 L0,6 L8,3 z'); p.setAttribute('fill', color);
            m.appendChild(p);
            return m;
        };

        defs.appendChild(makeMarker('rc-arrow-orange', 'var(--celn-accent)'));

        // Markers for each unique manual connection color
        const uniqueColors = [...new Set(this.data.connections.map(c => c.color))];
        uniqueColors.forEach((col, i) => defs.appendChild(makeMarker(`rc-arrow-c${i}`, col)));

        this.svgEl.appendChild(defs);

        // Helper: draw a bezier path
        const makePath = (x1: number, y1: number, x2: number, y2: number): string => {
            const dx = Math.abs(x2 - x1) * 0.5 + 40;
            return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
        };

        // ── 1. Frontmatter connections (orange, read-only) ──
        for (const note of this.notes) {
            const from = this.data.positions[note.file.path];
            if (!from) continue;
            const targets = [...(note.leadsTo ?? []), ...(note.relatedTo ?? [])];
            for (const tName of targets) {
                const tNote = this.notes.find(n =>
                    n.file.name === tName || n.file.basename === tName || n.file.path.includes(tName));
                if (!tNote) continue;
                const to = this.data.positions[tNote.file.path];
                if (!to) continue;

                const x1 = from.x + CARD_W, y1 = from.y + CARD_H / 2;
                const x2 = to.x,            y2 = to.y   + CARD_H / 2;

                const path = document.createElementNS(NS, 'path');
                path.setAttribute('d', makePath(x1, y1, x2, y2));
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', 'var(--celn-accent)');
                path.setAttribute('stroke-width', '1.8');
                path.setAttribute('opacity', '0.6');
                path.setAttribute('marker-end', 'url(#rc-arrow-orange)');
                this.svgEl.appendChild(path);
            }
        }

        // ── 2. Manual connections (colored, deletable) ──
        this.data.connections.forEach((conn, idx) => {
            const from = this.data.positions[conn.from];
            const to   = this.data.positions[conn.to];
            if (!from || !to) return;

            const colorIdx = uniqueColors.indexOf(conn.color);
            const markerId = `rc-arrow-c${colorIdx}`;

            // Determine connection points (right edge → left edge, or bottom→top)
            const x1 = from.x + CARD_W, y1 = from.y + CARD_H / 2;
            const x2 = to.x,            y2 = to.y   + CARD_H / 2;

            const g = document.createElementNS(NS, 'g');
            g.setAttribute('class', 'rc-conn-group');

            // Invisible wide hitbox for easier clicking
            const hitbox = document.createElementNS(NS, 'path');
            hitbox.setAttribute('d', makePath(x1, y1, x2, y2));
            hitbox.setAttribute('fill', 'none');
            hitbox.setAttribute('stroke', 'transparent');
            hitbox.setAttribute('stroke-width', '18');
            hitbox.style.cursor = 'pointer';
            g.appendChild(hitbox);

            // Visible path
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', makePath(x1, y1, x2, y2));
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', conn.color);
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-dasharray', '7,4');
            path.setAttribute('opacity', '0.85');
            path.setAttribute('marker-end', `url(#${markerId})`);
            g.appendChild(path);

            // Delete button at midpoint
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;

            const delCircle = document.createElementNS(NS, 'circle');
            delCircle.setAttribute('cx', String(mx)); delCircle.setAttribute('cy', String(my));
            delCircle.setAttribute('r', '10');
            delCircle.setAttribute('fill', 'var(--background-primary)');
            delCircle.setAttribute('stroke', conn.color);
            delCircle.setAttribute('stroke-width', '1.5');
            delCircle.style.cursor = 'pointer';
            delCircle.style.opacity = '0';
            delCircle.setAttribute('class', 'rc-conn-del-circle');

            const delText = document.createElementNS(NS, 'text');
            delText.setAttribute('x', String(mx)); delText.setAttribute('y', String(my + 4));
            delText.setAttribute('text-anchor', 'middle');
            delText.setAttribute('font-size', '11');
            delText.setAttribute('fill', conn.color);
            delText.setAttribute('class', 'rc-conn-del-text');
            delText.textContent = '✕';
            delText.style.cursor = 'pointer';
            delText.style.opacity = '0';
            delText.style.pointerEvents = 'none';

            g.appendChild(delCircle);
            g.appendChild(delText);

            // Show delete button on group hover
            g.addEventListener('mouseenter', () => {
                delCircle.style.opacity = '1';
                delText.style.opacity = '1';
            });
            g.addEventListener('mouseleave', () => {
                delCircle.style.opacity = '0';
                delText.style.opacity = '0';
            });

            // Delete on click
            const deleteConn = async (e: Event) => {
                e.stopPropagation();
                this.data.connections = this.data.connections.filter(c => c.id !== conn.id);
                this.updateSVGConnections();
                await this.save();
            };
            delCircle.addEventListener('click', deleteConn);
            hitbox.addEventListener('click', async (e: Event) => {
                if (!this.connectMode) await deleteConn(e);
            });

            // Label (optional)
            if (conn.label) {
                const lbl = document.createElementNS(NS, 'text');
                lbl.setAttribute('x', String(mx + 14)); lbl.setAttribute('y', String(my - 6));
                lbl.setAttribute('font-size', '11');
                lbl.setAttribute('fill', conn.color);
                lbl.setAttribute('opacity', '0.9');
                lbl.textContent = conn.label;
                g.appendChild(lbl);
            }

            void idx; // suppress unused warning
            this.svgEl?.appendChild(g);
        });
    }

    // ─── Fit to Screen ───────────────────────────────────
    private fitToScreen(): void {
        if (!this.container || this.data.zones.length === 0) return;
        const vp = this.container.querySelector('.rc-viewport') as HTMLElement | null;
        if (!vp) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const z of this.data.zones) {
            minX = Math.min(minX, z.x); minY = Math.min(minY, z.y);
            maxX = Math.max(maxX, z.x + z.w); maxY = Math.max(maxY, z.y + z.h);
        }
        if (!isFinite(minX)) return;

        const vw = vp.clientWidth - 80, vh = vp.clientHeight - 80;
        const zoom = Math.min(vw / (maxX - minX), vh / (maxY - minY), 1.5);
        this.data.zoom  = zoom;
        this.data.offsetX = 40 - minX * zoom;
        this.data.offsetY = 40 - minY * zoom;
        this.applyTransform();
        void this.save();
    }

    private esc(text: string): string {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    destroy(): void {
        this.container?.empty();
        this.container = null;
        this.canvasEl  = null;
        this.svgEl     = null;
    }
}
