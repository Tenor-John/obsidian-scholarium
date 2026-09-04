import { App, Component, MarkdownRenderer, Notice, TFile } from 'obsidian';
import { DashboardView } from './dashboard-view';

type ProjectProfileContext = {
    projectId: string;
    folder: string;
    title: string;
    profilePath: string;
    jsonPath: string;
    detailPath: string;
    roadmapPath: string;
    projectPath: string;
};

type ProjectProfileSummary = {
    projectId: string;
    title: string;
    status: string;
    priority: string;
    stage: string;
    progress: number | null;
    thesis: string;
    primarySystem: string;
    secondarySystem: string;
    wavelengths: string[];
    nextGate: string;
    tags: string[];
    hasProfile: boolean;
};

type ProjectProfileValues = {
    projectId: string;
    title: string;
    status: string;
    priority: string;
    stage: string;
    progress: string;
    thesis: string;
    primarySystem: string;
    secondarySystem: string;
    wavelengths: string[];
    nextGate: string;
    tags: string[];
};

type RoadmapState = {
    file: TFile | null;
    text: string;
    stats: { total: number; done: number; percent: number };
};

type ExtendedDashboard = {
    app: App;
    detailPanel?: HTMLElement | null;
    allExperiments?: unknown[];
    plugin: {
        settings: { experimentsFolder?: string };
        loadData: () => Promise<unknown>;
        updateData: (mutator: (data: Record<string, unknown>) => void) => Promise<void>;
    };
    getFilteredExperiments: () => unknown[];
    getExperiments: () => Promise<unknown[]>;
    updateStats: () => void;
    renderExpList: () => void;
    renderExperimentDashboard: (container: HTMLElement, records: unknown[]) => Promise<void>;
    projectProfileContext: () => Promise<ProjectProfileContext>;
    getProjectProfileFile: (path: string) => TFile | null;
    loadProjectProfileSummary: () => Promise<{ ctx: ProjectProfileContext; summary: ProjectProfileSummary; profileFile: TFile | null }>;
    loadProjectRoadmap: (ctx: ProjectProfileContext) => Promise<RoadmapState>;
    ensureProjectProfileFile: (ctx: ProjectProfileContext, summary?: ProjectProfileSummary) => Promise<TFile>;
    syncProjectProfileJson: (ctx: ProjectProfileContext, values: ProjectProfileValues) => Promise<void>;
    renderProjectProfileBanner: (container: HTMLElement) => Promise<void>;
    openProjectProfileDrawer: (initialTab?: string) => Promise<void>;
    renderResearchProjectToolbar: (container: HTMLElement) => Promise<void>;
    refreshResearchDashboard: (container: HTMLElement) => Promise<void>;
};

const dashboardProto = DashboardView.prototype as unknown as ExtendedDashboard;

function textValue(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function listValue(value: unknown): value is string[] {
    return Array.isArray(value) && value.some((item) => String(item || '').trim());
}

function cleanList(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    return String(value || '').split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
}

function splitFrontmatter(markdown: unknown): { frontmatter: string; body: string } {
    const text = String(markdown || '');
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    return match ? { frontmatter: match[1] || '', body: text.slice(match[0].length) } : { frontmatter: '', body: text };
}

function readMeta(markdown: string): Record<string, string | string[]> {
    const meta: Record<string, string | string[]> = {};
    const lines = splitFrontmatter(markdown).frontmatter.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const match = (lines[i] || '').match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!match) continue;
        const key = match[1] || '';
        const value = (match[2] || '').trim();
        if (!key) continue;
        if (value === '') {
            const arr: string[] = [];
            while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1] || '')) {
                arr.push((lines[++i] || '').replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''));
            }
            meta[key] = arr;
        } else {
            meta[key] = value.replace(/^["']|["']$/g, '');
        }
    }
    return meta;
}

function yamlScalar(value: unknown): string {
    const text = String(value || '').replace(/\r?\n/g, ' ').trim();
    return text ? JSON.stringify(text) : '""';
}

function yamlList(items: unknown): string {
    const list = cleanList(items);
    return list.length ? '\n' + list.map((item) => `  - ${yamlScalar(item)}`).join('\n') : ' []';
}

function emptySummary(ctx: ProjectProfileContext): ProjectProfileSummary {
    return {
        projectId: ctx.projectId,
        title: ctx.title || ctx.projectId,
        status: 'active',
        priority: '',
        stage: '',
        progress: null,
        thesis: '',
        primarySystem: '',
        secondarySystem: '',
        wavelengths: [],
        nextGate: '',
        tags: [],
        hasProfile: false,
    };
}

function hasSummary(summary: ProjectProfileSummary): boolean {
    return textValue(summary.thesis)
        || textValue(summary.stage)
        || textValue(summary.primarySystem)
        || textValue(summary.secondarySystem)
        || listValue(summary.wavelengths)
        || textValue(summary.nextGate)
        || Number(summary.progress) > 0;
}

function metaString(meta: Record<string, string | string[]>, ...keys: string[]): string {
    for (const key of keys) {
        const value = meta[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function fromMeta(ctx: ProjectProfileContext, meta: Record<string, string | string[]>): ProjectProfileSummary {
    const summary = emptySummary(ctx);
    summary.projectId = metaString(meta, 'project_id', 'projectId') || summary.projectId;
    summary.title = metaString(meta, 'title') || summary.title;
    summary.status = metaString(meta, 'status') || summary.status;
    summary.priority = metaString(meta, 'priority');
    summary.stage = metaString(meta, 'stage', 'current_stage');
    summary.thesis = metaString(meta, 'thesis', 'core_thesis', 'summary', 'hypothesis');
    summary.primarySystem = metaString(meta, 'primary_system', 'primarySystem');
    summary.secondarySystem = metaString(meta, 'secondary_system', 'secondarySystem');
    summary.nextGate = metaString(meta, 'next_gate', 'nextGate');
    const progress = Number(metaString(meta, 'progress'));
    summary.progress = Number.isFinite(progress) ? progress : null;
    summary.wavelengths = Array.isArray(meta.wavelengths) ? cleanList(meta.wavelengths) : cleanList(metaString(meta, 'wavelengths'));
    summary.tags = Array.isArray(meta.tags) ? cleanList(meta.tags) : cleanList(metaString(meta, 'tags'));
    summary.hasProfile = hasSummary(summary);
    return summary;
}

function stripInline(value: unknown): string {
    return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function fromBody(ctx: ProjectProfileContext, body: string): ProjectProfileSummary {
    const summary = emptySummary(ctx);
    const thesisMatch = body.match(/<section[^>]*class=["'][^"']*rp-thesis[^"']*["'][\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
        || body.match(/-\s+\*\*(?:核心命题|Core Thesis)[^*]*\*\*[^\n：:]*[：:]\s*([^\n]+)/i)
        || body.match(/-\s+\*\*(?:一句话核心命题|核心命题)[^*]*\*\*[^\n：:]*[：:]\s*([^\n]+)/i);
    summary.thesis = stripInline(thesisMatch?.[1]);
    summary.hasProfile = hasSummary(summary);
    return summary;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function fromJson(ctx: ProjectProfileContext, data: Record<string, unknown>): ProjectProfileSummary {
    const summary = emptySummary(ctx);
    const meaningful = textValue(data.summary)
        || textValue(data.hypothesis)
        || listValue(data.entities)
        || listValue(data.methods)
        || listValue(data.currentFocus)
        || textValue(data.nextGate)
        || Number(data.progress) > 0;
    if (!meaningful) return summary;
    summary.projectId = textValue(data.projectId) ? data.projectId : ctx.projectId;
    summary.title = textValue(data.title) ? data.title : ctx.title;
    summary.status = textValue(data.status) ? data.status : 'active';
    summary.priority = textValue(data.priority) ? data.priority : '';
    summary.thesis = textValue(data.hypothesis) ? data.hypothesis : (textValue(data.summary) ? data.summary : '');
    summary.stage = listValue(data.currentFocus) ? data.currentFocus.filter(Boolean).join(' / ') : (textValue(data.stage) ? data.stage : '');
    summary.primarySystem = listValue(data.entities) ? String(data.entities[0] || '') : (textValue(data.primarySystem) ? data.primarySystem : '');
    summary.secondarySystem = listValue(data.entities) ? String(data.entities[1] || '') : (textValue(data.secondarySystem) ? data.secondarySystem : '');
    summary.wavelengths = listValue(data.methods) ? data.methods.filter(Boolean).slice(0, 4) : cleanList(data.wavelengths);
    summary.nextGate = textValue(data.nextGate) ? data.nextGate : (textValue(data.next_gate) ? data.next_gate : '');
    summary.progress = Number.isFinite(Number(data.progress)) ? Number(data.progress) : null;
    summary.tags = cleanList(data.literatureTags);
    summary.hasProfile = true;
    return summary;
}

function mergeSummary(primary: ProjectProfileSummary, ...fallbacks: Array<ProjectProfileSummary | null | undefined>): ProjectProfileSummary {
    const merged = { ...primary, wavelengths: [...primary.wavelengths], tags: [...primary.tags] };
    for (const item of fallbacks.filter(Boolean) as ProjectProfileSummary[]) {
        for (const key of ['projectId', 'title', 'status', 'priority', 'stage', 'thesis', 'primarySystem', 'secondarySystem', 'nextGate'] as const) {
            if (!textValue(merged[key]) && textValue(item[key])) merged[key] = item[key];
        }
        if ((merged.progress === null || merged.progress === undefined) && item.progress !== null && item.progress !== undefined) merged.progress = item.progress;
        if (!listValue(merged.wavelengths) && listValue(item.wavelengths)) merged.wavelengths = item.wavelengths;
        if (!listValue(merged.tags) && listValue(item.tags)) merged.tags = item.tags;
    }
    merged.hasProfile = hasSummary(merged);
    return merged;
}

function parseRoadmap(markdown: string): RoadmapState['stats'] {
    const matches = [...markdown.matchAll(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/gm)];
    const total = matches.length;
    const done = matches.filter((match) => String(match[1]).toLowerCase() === 'x').length;
    return { total, done, percent: total ? Math.round(done / total * 100) : 0 };
}

function valuesFromSummary(summary: ProjectProfileSummary): ProjectProfileValues {
    return {
        projectId: summary.projectId || '',
        title: summary.title || '',
        status: summary.status || 'active',
        priority: summary.priority || '',
        stage: summary.stage || '',
        progress: summary.progress === null || summary.progress === undefined ? '' : String(summary.progress),
        thesis: summary.thesis || '',
        primarySystem: summary.primarySystem || '',
        secondarySystem: summary.secondarySystem || '',
        wavelengths: cleanList(summary.wavelengths),
        nextGate: summary.nextGate || '',
        tags: cleanList(summary.tags),
    };
}

function frontmatter(values: ProjectProfileValues): string {
    return `---\ntype: project-profile\nproject_id: ${yamlScalar(values.projectId)}\ntitle: ${yamlScalar(values.title)}\nstatus: ${yamlScalar(values.status || 'active')}\npriority: ${yamlScalar(values.priority)}\nstage: ${yamlScalar(values.stage)}\nprogress: ${values.progress === '' || values.progress === null ? 'null' : Number(values.progress) || 0}\nthesis: ${yamlScalar(values.thesis)}\nprimary_system: ${yamlScalar(values.primarySystem)}\nsecondary_system: ${yamlScalar(values.secondarySystem)}\nwavelengths:${yamlList(values.wavelengths)}\nnext_gate: ${yamlScalar(values.nextGate)}\nprofile_version: 1\nlast_updated: ${new Date().toISOString().slice(0, 10)}\ntags:${yamlList(values.tags)}\n---\n\n`;
}

function summaryMarkdown(values: ProjectProfileValues): string {
    const wave = cleanList(values.wavelengths).join(' / ') || '待补充';
    return `## 画像摘要\n\n- **课题名称**：${values.title || '待补充'}\n- **核心命题**：${values.thesis || '待补充'}\n- **状态 / 优先级**：${values.status || 'active'}${values.priority ? ' / ' + values.priority : ''}\n- **当前阶段**：${values.stage || '待补充'}\n- **主体系**：${values.primarySystem || '待补充'}\n- **拓展体系**：${values.secondarySystem || '待补充'}\n- **关键波长 / 通道**：${wave}\n- **下一道验证闸门**：${values.nextGate || '待补充'}\n\n`;
}

function upsertSummary(body: string, values: ProjectProfileValues): string {
    const section = summaryMarkdown(values);
    const pattern = /##\s+画像摘要\s*\n[\s\S]*?(?=\n##\s+|\n<div\s|$)/;
    return pattern.test(body) ? body.replace(pattern, section.trimEnd() + '\n') : section + String(body || '').replace(/^\s+/, '');
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function installProjectProfileExtensions(): void {
    if ((dashboardProto as unknown as { __projectProfileStructuredEditor?: boolean }).__projectProfileStructuredEditor) return;
    (dashboardProto as unknown as { __projectProfileStructuredEditor?: boolean }).__projectProfileStructuredEditor = true;
    const originalRenderExperimentDashboard = dashboardProto.renderExperimentDashboard;

    dashboardProto.projectProfileContext = async function projectProfileContext(this: ExtendedDashboard): Promise<ProjectProfileContext> {
        let data: Record<string, unknown> = {};
        try { data = asRecord(await this.plugin.loadData()); } catch (error) { console.warn('[Scholarium] project data read failed:', error); }
        const projectWorkspace = asRecord(data.projectWorkspace);
        const rssBoard = asRecord(data.rssBoard);
        const projectId = (textValue(projectWorkspace.activeProjectId) ? projectWorkspace.activeProjectId : '')
            || (textValue(rssBoard.researchProjectId) ? rssBoard.researchProjectId : '')
            || 'PRJ-001';
        const base = (this.plugin.settings.experimentsFolder || 'Experiments').replace(/\/+$/, '') + '/Projects/' + projectId;
        let title = projectId;
        const projectFile = this.app.vault.getAbstractFileByPath(base + '/project.md');
        if (projectFile instanceof TFile) {
            const cache = this.app.metadataCache.getFileCache(projectFile);
            const fm = asRecord(cache?.frontmatter);
            title = textValue(fm.title) ? fm.title : (projectFile.basename || title);
        }
        return {
            projectId,
            folder: base,
            title,
            profilePath: base + '/00_课题画像.md',
            jsonPath: base + '/project_profile.json',
            detailPath: base + '/01_完整课题内容.md',
            roadmapPath: base + '/02_Roadmap.md',
            projectPath: base + '/project.md',
        };
    };

    dashboardProto.getProjectProfileFile = function getProjectProfileFile(this: ExtendedDashboard, path: string): TFile | null {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile && file.extension === 'md' ? file : null;
    };

    dashboardProto.loadProjectRoadmap = async function loadProjectRoadmap(this: ExtendedDashboard, ctx: ProjectProfileContext): Promise<RoadmapState> {
        const file = this.getProjectProfileFile(ctx.roadmapPath);
        if (!file) return { file: null, text: '', stats: { total: 0, done: 0, percent: 0 } };
        const text = await this.app.vault.cachedRead(file);
        return { file, text, stats: parseRoadmap(text) };
    };

    dashboardProto.loadProjectProfileSummary = async function loadProjectProfileSummary(this: ExtendedDashboard): Promise<{ ctx: ProjectProfileContext; summary: ProjectProfileSummary; profileFile: TFile | null }> {
        const ctx = await this.projectProfileContext();
        let summary = emptySummary(ctx);
        const profileFile = this.getProjectProfileFile(ctx.profilePath);
        try {
            let fromMd: ProjectProfileSummary | null = null;
            let fromMdBody: ProjectProfileSummary | null = null;
            let fromJsonFile: ProjectProfileSummary | null = null;
            if (profileFile) {
                const md = await this.app.vault.cachedRead(profileFile);
                fromMd = fromMeta(ctx, readMeta(md));
                fromMdBody = fromBody(ctx, splitFrontmatter(md).body);
            }
            const jsonFile = this.app.vault.getAbstractFileByPath(ctx.jsonPath);
            if (jsonFile instanceof TFile) fromJsonFile = fromJson(ctx, JSON.parse(await this.app.vault.cachedRead(jsonFile)) as Record<string, unknown>);
            summary = mergeSummary(fromMd || summary, fromMdBody, fromJsonFile);
        } catch (error) {
            console.warn('[Scholarium] project profile read failed:', error);
        }
        return { ctx, summary, profileFile };
    };

    dashboardProto.ensureProjectProfileFile = async function ensureProjectProfileFile(this: ExtendedDashboard, ctx: ProjectProfileContext, summary?: ProjectProfileSummary): Promise<TFile> {
        const existing = this.getProjectProfileFile(ctx.profilePath);
        if (existing) return existing;
        let acc = '';
        for (const part of ctx.folder.split('/')) {
            acc = acc ? acc + '/' + part : part;
            if (!this.app.vault.getAbstractFileByPath(acc)) await this.app.vault.createFolder(acc);
        }
        const values = valuesFromSummary(summary || emptySummary(ctx));
        return await this.app.vault.create(ctx.profilePath, frontmatter(values) + summaryMarkdown(values) + `# ${values.title || ctx.projectId}\n\n`);
    };

    dashboardProto.syncProjectProfileJson = async function syncProjectProfileJson(this: ExtendedDashboard, ctx: ProjectProfileContext, values: ProjectProfileValues): Promise<void> {
        const payload = {
            schemaVersion: 'project-profile-v1',
            projectId: values.projectId || ctx.projectId,
            profileVersion: 1,
            title: values.title || ctx.title,
            summary: values.thesis || '',
            entities: [values.primarySystem, values.secondarySystem].filter(Boolean),
            methods: cleanList(values.wavelengths),
            problems: [],
            currentFocus: values.stage ? [values.stage] : [],
            hypothesis: values.thesis || '',
            literatureTags: cleanList(values.tags),
            excludedTags: [],
            nextGate: values.nextGate || '',
            progress: values.progress === '' ? null : Number(values.progress) || 0,
            generatedAt: Date.now(),
            generatedBy: { mode: 'structured-editor', model: '' },
        };
        const file = this.app.vault.getAbstractFileByPath(ctx.jsonPath);
        const text = JSON.stringify(payload, null, 2);
        if (file instanceof TFile) await this.app.vault.modify(file, text);
        else await this.app.vault.create(ctx.jsonPath, text);
    };

    dashboardProto.renderResearchProjectToolbar = async function renderResearchProjectToolbar(this: ExtendedDashboard, container: HTMLElement): Promise<void> {
        const tools = container.querySelector<HTMLElement>('.exp-board-tools');
        if (!tools || tools.querySelector('.project-profile-project-select')) return;
        const loaded = await this.loadProjectProfileSummary();
        const activeProject = { id: loaded.ctx.projectId, title: loaded.summary.title || loaded.ctx.title };
        const select = tools.createEl('select', {
            cls: 'scholarium-btn project-profile-project-select',
            attr: { title: `研究课题：${activeProject.id} · ${activeProject.title}`, 'aria-label': '研究课题' },
        });
        select.createEl('option', { text: `${activeProject.id} · ${activeProject.title}`, attr: { value: loaded.ctx.projectId } });
        select.value = loaded.ctx.projectId;
        select.onchange = async () => {
            const projectId = select.value;
            if (projectId === loaded.ctx.projectId) return;
            select.disabled = true;
            try {
                await this.plugin.updateData((data) => {
                    data.projectWorkspace = { ...asRecord(data.projectWorkspace), activeProjectId: projectId };
                    data.rssBoard = {
                        ...asRecord(data.rssBoard),
                        researchProjectId: projectId,
                        researchProfilePath: (this.plugin.settings.experimentsFolder || 'Experiments').replace(/\/+$/, '') + '/Projects/' + projectId + '/project.md',
                    };
                });
                await this.refreshResearchDashboard(container);
                new Notice('已切换研究课题：' + projectId);
            } catch (error) {
                select.disabled = false;
                new Notice('切换课题失败：' + message(error));
            }
        };
        tools.prepend(select);
    };

    dashboardProto.refreshResearchDashboard = async function refreshResearchDashboard(this: ExtendedDashboard, container: HTMLElement): Promise<void> {
        this.allExperiments = await this.getExperiments() as never;
        this.updateStats();
        this.renderExpList();
        if (container.isConnected) await this.renderExperimentDashboard(container, this.getFilteredExperiments());
    };

    dashboardProto.renderProjectProfileBanner = async function renderProjectProfileBanner(this: ExtendedDashboard, container: HTMLElement): Promise<void> {
        const loaded = await this.loadProjectProfileSummary();
        const { ctx, summary } = loaded;
        const roadmap = await this.loadProjectRoadmap(ctx);
        const watermark = cleanList(summary.wavelengths).slice(0, 2).join(' ↔ ');
        const banner = container.createEl('section', { cls: `project-profile-banner${summary.hasProfile ? '' : ' is-empty'}` });
        const copy = banner.createDiv({ cls: 'project-profile-copy' });
        copy.createDiv({ cls: 'project-profile-kicker', text: `Project Profile · ${summary.projectId}` });
        copy.createEl('h2', { text: summary.title || ctx.title });
        copy.createEl('p', { text: summary.hasProfile ? summary.thesis : '当前课题还没有生成或填写课题画像。' });
        const tags = copy.createDiv({ cls: 'project-profile-tags' });
        tags.createSpan({ text: `${summary.status === 'active' ? 'Active' : summary.status}${summary.priority ? ' · ' + summary.priority : ''}` });
        if (summary.hasProfile && summary.primarySystem) tags.createSpan({ text: summary.primarySystem });
        if (summary.hasProfile) for (const item of cleanList(summary.wavelengths)) tags.createSpan({ text: item });
        if (summary.hasProfile && cleanList(summary.tags).some((tag) => /redox/i.test(tag))) tags.createSpan({ text: 'Paired Redox' });
        if (summary.hasProfile && watermark) copy.createDiv({ cls: 'project-profile-watermark', text: watermark });
        const grid = banner.createDiv({ cls: 'project-profile-summary-grid' });
        const tile = (label: string, value: string): void => {
            const el = grid.createDiv();
            el.createEl('small', { text: label });
            el.createEl('strong', { text: value || '待补充' });
        };
        tile('当前阶段', summary.stage);
        tile('画像成熟度', summary.progress === null ? '待 AI 评估' : `${summary.progress}%`);
        tile('Roadmap', roadmap.stats.total ? `${roadmap.stats.done}/${roadmap.stats.total} · ${roadmap.stats.percent}%` : '待建立');
        tile('下一闸门', summary.nextGate);
        const actions = banner.createDiv({ cls: 'project-profile-actions' });
        actions.createEl('button', { cls: 'scholarium-btn primary', text: summary.hasProfile ? '打开课题画像' : '新建课题画像' }).onclick = () => void this.openProjectProfileDrawer(summary.hasProfile ? 'overview' : 'edit');
        actions.createEl('button', { cls: 'scholarium-btn', text: '编辑画像内容' }).onclick = () => void this.openProjectProfileDrawer('edit');
        if (roadmap.file) actions.createEl('button', { cls: 'scholarium-btn', text: '打开 Roadmap' }).onclick = () => void this.openProjectProfileDrawer('roadmap');
    };

    dashboardProto.openProjectProfileDrawer = async function openProjectProfileDrawer(this: ExtendedDashboard, initialTab = 'overview'): Promise<void> {
        const loaded = await this.loadProjectProfileSummary();
        const ctx = loaded.ctx;
        let summary = loaded.summary;
        let profileFile = loaded.profileFile;
        if (!profileFile && initialTab === 'edit') profileFile = await this.ensureProjectProfileFile(ctx, summary);
        if (!profileFile) {
            new Notice('当前课题还没有课题画像。');
            return;
        }
        const detailFile = this.getProjectProfileFile(ctx.detailPath) || this.getProjectProfileFile(ctx.projectPath) || profileFile;
        let roadmap = await this.loadProjectRoadmap(ctx);
        let profileText = '';
        let detailText = '';
        let roadmapText = '';
        let draftBody = '';
        let formValues = valuesFromSummary(summary);
        try {
            profileText = await this.app.vault.cachedRead(profileFile);
            const parts = splitFrontmatter(profileText);
            summary = mergeSummary(fromMeta(ctx, readMeta(profileText)), fromBody(ctx, parts.body), summary);
            formValues = valuesFromSummary(summary);
            draftBody = parts.body;
            detailText = await this.app.vault.cachedRead(detailFile);
            roadmapText = roadmap.text;
        } catch (error) {
            new Notice('课题画像读取失败：' + message(error));
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'project-profile-overlay';
        const drawer = overlay.createDiv({ cls: 'project-profile-drawer' });
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
        const close = (): void => {
            overlay.remove();
            document.removeEventListener('keydown', esc);
        };
        const esc = (event: KeyboardEvent): void => { if (event.key === 'Escape') close(); };
        document.addEventListener('keydown', esc);
        overlay.onmousedown = (event: MouseEvent): void => { if (event.target === overlay) close(); };

        const header = drawer.createEl('header', { cls: 'project-profile-drawer-header' });
        const heading = header.createDiv();
        heading.createEl('small', { text: `Research Project Profile · ${formValues.projectId}` });
        heading.createEl('h2', { text: formValues.title || ctx.title });
        heading.createEl('p', { text: '课题工作台将画像参数与研究路线图统一管理：字段保存到课题画像，任务变更自动同步到 Roadmap 与看板进度。' });
        const headerActions = header.createDiv({ cls: 'project-profile-drawer-actions' });
        headerActions.createEl('button', { cls: 'project-profile-icon-button', text: '↗', attr: { title: '在 Obsidian 中打开课题画像', 'aria-label': '在 Obsidian 中打开课题画像' } }).onclick = () => void this.app.workspace.getLeaf('tab').openFile(profileFile as TFile, { active: true });
        headerActions.createEl('button', { cls: 'project-profile-close', text: '×' }).onclick = close;
        const tabs = drawer.createEl('nav', { cls: 'project-profile-tabs' });
        const body = drawer.createEl('main', { cls: 'project-profile-body' });
        let active = initialTab;

        const renderDocumentEditor = (markdown: string, file: TFile, config: { label: string; kind: string; save: (next: string) => Promise<void> }): void => {
            body.empty();
            const toolbar = body.createDiv({ cls: 'project-profile-document-toolbar' });
            const copy = toolbar.createDiv();
            copy.createEl('strong', { text: config.label });
            copy.createSpan({ text: '编辑视图', cls: 'project-profile-document-mode is-editing' });
            const toolbarActions = toolbar.createDiv({ cls: 'project-profile-document-toolbar-actions' });
            const save = toolbarActions.createEl('button', { cls: 'scholarium-btn', text: '保存修改' });
            const back = toolbarActions.createEl('button', { cls: 'scholarium-btn primary', text: '保存并返回阅读视图' });
            const editorShell = body.createDiv({ cls: 'project-profile-document-editor' });
            editorShell.createDiv({ text: '直接编辑并保存到当前项目文件', cls: 'project-profile-document-editor-note' });
            const editor = editorShell.createEl('textarea', { cls: 'project-profile-document-source' });
            editor.value = markdown;
            const persist = async (returnToReading = false): Promise<void> => {
                try {
                    save.disabled = true;
                    back.disabled = true;
                    const next = editor.value;
                    await config.save(next);
                    new Notice(config.label + '已保存');
                    if (returnToReading) void renderMarkdown(next, file, config);
                    else {
                        save.disabled = false;
                        back.disabled = false;
                    }
                } catch (error) {
                    save.disabled = false;
                    back.disabled = false;
                    new Notice('保存失败：' + message(error));
                }
            };
            save.onclick = () => void persist(false);
            back.onclick = () => void persist(true);
        };

        const renderMarkdown = async (markdown: string, file: TFile, config: { label: string; kind: string; save: (next: string) => Promise<void> }): Promise<void> => {
            body.empty();
            const toolbar = body.createDiv({ cls: 'project-profile-document-toolbar' });
            const copy = toolbar.createDiv();
            copy.createEl('strong', { text: config.label });
            copy.createSpan({ text: '阅读视图', cls: 'project-profile-document-mode' });
            toolbar.createEl('button', { cls: 'scholarium-btn', text: '编辑并保存' }).onclick = () => renderDocumentEditor(markdown, file, config);
            const surface = body.createDiv({ cls: `project-profile-document-surface is-${config.kind || 'detail'}` });
            if (config.kind === 'overview') {
                const brief = surface.createDiv({ cls: 'project-profile-brief' });
                const briefCopy = brief.createDiv();
                briefCopy.createEl('small', { text: 'PROJECT BRIEF' });
                briefCopy.createEl('h3', { text: formValues.title || ctx.title });
                briefCopy.createEl('p', { text: formValues.thesis || '以课题画像定义研究命题与验证路径。' });
                const metrics = brief.createDiv({ cls: 'project-profile-brief-metrics' });
                for (const [label, value] of [['当前阶段', formValues.stage], ['成熟度', formValues.progress === '' ? '待评估' : formValues.progress + '%'], ['核心体系', formValues.primarySystem]]) {
                    const metric = metrics.createDiv();
                    metric.createEl('small', { text: label });
                    metric.createEl('strong', { text: value || '待补充' });
                }
            }
            const layout = config.kind === 'detail' ? surface.createDiv({ cls: 'project-profile-document-layout' }) : surface;
            const article = layout.createDiv({ cls: 'project-profile-markdown markdown-rendered' });
            try {
                await MarkdownRenderer.render(this.app, markdown, article, file.path, this as unknown as Component);
            } catch (error) {
                article.setText(markdown);
            }
            for (const table of Array.from(article.querySelectorAll('table'))) {
                const scroll = document.createElement('div');
                scroll.className = 'project-profile-table-scroll';
                scroll.tabIndex = 0;
                scroll.setAttribute('role', 'region');
                scroll.setAttribute('aria-label', '宽表格，可横向滚动查看全部列');
                table.parentElement?.insertBefore(scroll, table);
                scroll.appendChild(table);
            }
            if (config.kind === 'detail') {
                const outline = layout.createEl('aside', { cls: 'project-profile-document-outline' });
                outline.createEl('small', { text: 'DOCUMENT OUTLINE' });
                outline.createEl('h4', { text: '章节导航' });
                const headings = Array.from(article.querySelectorAll('h2,h3'));
                for (const [index, heading] of headings.entries()) {
                    heading.id = heading.id || 'project-profile-heading-' + index;
                    const link = outline.createEl('button', { text: heading.textContent || '未命名章节', cls: 'project-profile-outline-item' });
                    if (heading.tagName === 'H3') link.addClass('is-subsection');
                    link.onclick = () => heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        };

        const renderEdit = (): void => {
            body.empty();
            const form = body.createDiv({ cls: 'project-profile-form' });
            const field = (label: string, key: keyof ProjectProfileValues, type = 'text'): HTMLInputElement | HTMLTextAreaElement => {
                const wrap = form.createDiv({ cls: 'project-profile-field' });
                wrap.createEl('label', { text: label });
                const input = type === 'textarea' ? wrap.createEl('textarea') : wrap.createEl('input', { attr: { type } });
                input.value = Array.isArray(formValues[key]) ? (formValues[key] as string[]).join(', ') : String(formValues[key] ?? '');
                input.oninput = () => {
                    const next = input.value;
                    if (key === 'wavelengths' || key === 'tags') formValues[key] = cleanList(next);
                    else formValues[key] = next as never;
                };
                return input;
            };
            field('课题名称', 'title');
            field('一句话核心命题', 'thesis', 'textarea');
            field('状态', 'status');
            field('优先级', 'priority');
            field('当前阶段', 'stage');
            field('画像成熟度（%）', 'progress', 'number');
            field('主体系', 'primarySystem');
            field('拓展体系', 'secondarySystem');
            field('关键波长 / 通道', 'wavelengths');
            field('下一道验证闸门', 'nextGate', 'textarea');
            field('顶部 tags（逗号分隔）', 'tags');
            const details = form.createEl('details', { cls: 'project-profile-raw-details' });
            details.createEl('summary', { text: '高级：编辑画像文件正文 Markdown' });
            const raw = details.createEl('textarea', { cls: 'project-profile-editor' });
            raw.value = draftBody;
            raw.oninput = () => { draftBody = raw.value; };
            const saveRow = body.createDiv({ cls: 'project-profile-save-row' });
            saveRow.createEl('button', { cls: 'scholarium-btn primary', text: '保存画像字段' }).onclick = async () => {
                try {
                    const next = frontmatter(formValues) + upsertSummary(draftBody, formValues);
                    await this.app.vault.modify(profileFile as TFile, next);
                    profileText = next;
                    draftBody = splitFrontmatter(next).body;
                    await this.syncProjectProfileJson(ctx, formValues);
                    new Notice('课题画像已保存');
                    setTab('overview');
                    if (this.detailPanel) void this.renderExperimentDashboard(this.detailPanel, this.getFilteredExperiments());
                } catch (error) {
                    new Notice('保存课题画像失败：' + message(error));
                }
            };
            saveRow.createEl('p', { cls: 'project-profile-editor-note', text: '字段会写入同一 Markdown 文件的 frontmatter，并同步更新正文“画像摘要”。' });
        };

        const renderRoadmap = (): void => {
            body.empty();
            body.createDiv({ cls: 'project-profile-editor-note', text: '在此修改 Roadmap 并保存；清单中 - [x] / - [ ] 会反映到看板进度。' });
            if (!roadmap.file) {
                body.createEl('button', { cls: 'scholarium-btn primary', text: '新建 Roadmap' }).onclick = async () => {
                    try {
                        const file = await this.app.vault.create(ctx.roadmapPath, '# Roadmap\n\n- [ ] 第一个里程碑\n');
                        roadmap = { file, text: await this.app.vault.cachedRead(file), stats: parseRoadmap('- [ ] 第一个里程碑') };
                        roadmapText = roadmap.text;
                        setTab('roadmap');
                    } catch (error) {
                        new Notice('新建 Roadmap 失败：' + message(error));
                    }
                };
                return;
            }
            const editor = body.createEl('textarea', { cls: 'project-profile-editor project-profile-roadmap-editor' });
            editor.value = roadmapText;
            const saveRow = body.createDiv({ cls: 'project-profile-save-row' });
            const save = saveRow.createEl('button', { cls: 'scholarium-btn primary', text: '保存 Roadmap' });
            saveRow.createEl('button', { cls: 'scholarium-btn', text: '在 Obsidian 中打开' }).onclick = () => void this.app.workspace.getLeaf('tab').openFile(roadmap.file as TFile, { active: true });
            save.onclick = async () => {
                try {
                    save.disabled = true;
                    save.setText('保存中…');
                    roadmapText = editor.value;
                    await this.app.vault.modify(roadmap.file as TFile, roadmapText);
                    roadmap = { file: roadmap.file, text: roadmapText, stats: parseRoadmap(roadmapText) };
                    new Notice('Roadmap 已保存，进度已更新');
                    if (this.detailPanel) await this.renderExperimentDashboard(this.detailPanel, this.getFilteredExperiments());
                    save.disabled = false;
                    save.setText('保存 Roadmap');
                } catch (error) {
                    save.disabled = false;
                    save.setText('保存 Roadmap');
                    new Notice('保存 Roadmap 失败：' + message(error));
                }
            };
        };

        const setTab = (tab: string): void => {
            active = tab === 'roadmap' ? 'edit' : tab;
            Array.from(tabs.children).forEach((btn) => btn.toggleClass('active', (btn as HTMLElement).dataset.tab === active));
            if (tab === 'overview') {
                void renderMarkdown(profileText, profileFile as TFile, {
                    label: '课题画像总览',
                    kind: 'overview',
                    save: async (next: string) => {
                        await this.app.vault.modify(profileFile as TFile, next);
                        profileText = next;
                        const parts = splitFrontmatter(next);
                        draftBody = parts.body;
                        formValues = valuesFromSummary(mergeSummary(fromMeta(ctx, readMeta(next)), fromBody(ctx, parts.body), summary));
                        await this.syncProjectProfileJson(ctx, formValues);
                        if (this.detailPanel) await this.renderExperimentDashboard(this.detailPanel, this.getFilteredExperiments());
                    },
                });
            } else if (tab === 'detail') {
                void renderMarkdown(detailText, detailFile, {
                    label: '完整课题内容',
                    kind: 'detail',
                    save: async (next: string) => {
                        await this.app.vault.modify(detailFile, next);
                        detailText = next;
                        if (detailFile.path === (profileFile as TFile).path) {
                            profileText = next;
                            draftBody = splitFrontmatter(next).body;
                        }
                        if (this.detailPanel) await this.renderExperimentDashboard(this.detailPanel, this.getFilteredExperiments());
                    },
                });
            } else if (tab === 'roadmap') renderRoadmap();
            else renderEdit();
        };

        for (const [tab, label] of [['overview', '画像总览'], ['detail', '完整课题内容'], ['edit', '编辑画像字段'], ['roadmap', 'Roadmap']] as Array<[string, string]>) {
            const btn = tabs.createEl('button', { text: label });
            btn.dataset.tab = tab;
            btn.onclick = () => setTab(tab);
        }
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.addClass('is-open'));
        setTab(active);
    };

    dashboardProto.renderExperimentDashboard = async function renderExperimentDashboard(this: ExtendedDashboard, container: HTMLElement, records: unknown[]): Promise<void> {
        await originalRenderExperimentDashboard.call(this, container, records);
        try {
            await this.renderResearchProjectToolbar(container);
            const anchor = container.querySelector('.exp-board-stats,.exp-board-empty,.exp-card-dashboard');
            if (!anchor || container.querySelector('.project-profile-banner')) return;
            const host = document.createElement('div');
            anchor.parentNode?.insertBefore(host, anchor);
            await this.renderProjectProfileBanner(host);
        } catch (error) {
            console.warn('[Scholarium] project profile banner failed:', error);
        }
    };
}

installProjectProfileExtensions();
