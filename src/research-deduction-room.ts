import { App, Notice, TFile } from 'obsidian';
import { fetchWithTimeout } from './utils/network';

type PluginLike = {
    settings: {
        experimentsFolder?: string;
        aiProvider?: string;
        aiApiKey?: string;
        aiModel?: string;
        aiCustomEndpoint?: string;
        researchTheoryNativeApi?: boolean;
    };
    loadData: () => Promise<unknown>;
    saveData: (data: unknown) => Promise<void>;
};

type ProjectContext = { projectId: string; folder: string; title: string };
type DesignStatus = 'designing' | 'awaiting-experiment' | 'completed' | 'archived';

type ExperimentDesign = {
    file: TFile;
    id: string;
    title: string;
    status: DesignStatus;
    version: string;
    auditPassed: boolean;
};

type EvidenceRequest = { query?: string; search_query?: string; topic?: string; why?: string; max_results?: number };

type EvidenceRecord = {
    title: string;
    year: string | number;
    doi: string;
    openalex_id: string;
    is_oa: boolean;
    pdf_url: string;
};

type EvidenceCandidate = EvidenceRecord & { selected: boolean };

type EvidenceGroup = {
    query: string;
    why: string;
    search_id?: string;
    hit_count?: number;
    records: EvidenceRecord[];
    candidates?: EvidenceCandidate[];
    error?: string;
    downloaded?: Array<Record<string, unknown>>;
};

type TheoryReply = {
    status?: 'questions' | 'revise' | 'ready';
    summary?: string;
    questions?: Array<{ question?: string; why?: string }>;
    hypotheses?: { h0?: string; h1?: string; alternatives?: string[] };
    plan?: Record<string, unknown>;
    evidence?: { direct?: string[]; indirect?: string[]; unverified?: string[] };
    evidence_requests?: EvidenceRequest[];
    audit?: { passed?: boolean; evidence_gaps?: string[]; feasibility_gaps?: string[]; revision_action?: string };
    design?: { title?: string; scientific_question?: string };
};

type HistoryTurn = { role: 'researcher' | 'agent' | 'evidence' | 'summary'; content: unknown; at?: string };
type TheoryDraft = { message: string; reply: TheoryReply | null };
type BridgeState = { online: boolean; agents: Array<{ id: string; installed: boolean }>; error?: string };

type PendingEvidence = {
    mode: 'cli' | 'native';
    ctx: ProjectContext;
    message: string;
    pendingReply: TheoryReply;
    groups: EvidenceGroup[];
    agentId: string;
    cwd: string;
    submit: HTMLButtonElement | null;
};

export type ResearchDeductionHost = {
    app: App;
    plugin: PluginLike;
    rerender: () => void;
    openProjectProfile: () => void;
    createExperimentRecord: () => void;
};

const BRIDGE_URL = 'http://127.0.0.1:4173/bridge';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const statusLabel: Record<DesignStatus, string> = {
    designing: '设计中',
    'awaiting-experiment': '待实验',
    completed: '已完成',
    archived: '已归档',
};

const NATIVE_TOOLS = [{
    name: 'search_literature',
    description: '检索开放获取学术文献（基于 OpenAlex），用于在给出最终结构化回复前获取证据线索。可多次调用、逐步细化检索式。',
    input_schema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: '英文学术检索式' },
            why: { type: 'string', description: '为什么需要这条证据' },
        },
        required: ['query'],
    },
}];

function yaml(value: unknown): string {
    return JSON.stringify(String(value ?? '').replace(/\r?\n/g, ' ').trim());
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
}

function list(items: unknown): string {
    const values = strings(items);
    return values.length ? values.map((item) => `- ${item}`).join('\n') : '- 待补充。';
}

function projectFolder(plugin: PluginLike, projectId: string): string {
    return `${(plugin.settings.experimentsFolder || 'Experiments').replace(/\/+$/, '')}/Projects/${projectId}`;
}

async function ensureFolder(app: App, path: string): Promise<void> {
    if (app.vault.getAbstractFileByPath(path)) return;
    const parent = path.split('/').slice(0, -1).join('/');
    if (parent) await ensureFolder(app, parent);
    await app.vault.createFolder(path);
}

export class ResearchDeductionRoom {
    private selectedId: string | null = null;
    private draft: TheoryDraft | null = null;
    private history: HistoryTurn[] = [];
    private pendingEvidence: PendingEvidence | null = null;
    private historyProjectId: string | null = null;
    private compactedSummaryCache: { forTurnCount: number; text: string } | null = null;

    constructor(private readonly host: ResearchDeductionHost) {}

    async render(container: HTMLElement): Promise<void> {
        const ctx = await this.context();
        const designs = await this.designs(ctx);
        if (!this.selectedId && designs[0]) this.selectedId = designs[0].id;
        const selected = designs.find((design) => design.id === this.selectedId) ?? null;

        const root = container.createDiv({ cls: 'deduction-room' });
        const left = root.createEl('aside', { cls: 'deduction-pane deduction-list-pane' });
        const dialogue = root.createEl('section', { cls: 'deduction-pane deduction-dialogue-pane' });
        const plan = root.createEl('aside', { cls: 'deduction-pane deduction-plan-pane' });

        this.renderList(left, ctx, designs);
        await this.renderDialogue(dialogue, ctx, selected);
        await this.renderPlan(plan, selected);
    }

    private async context(): Promise<ProjectContext> {
        const data = (await this.host.plugin.loadData()) as Record<string, unknown> | null;
        const projectWorkspace = data?.projectWorkspace as Record<string, unknown> | undefined;
        const rssBoard = data?.rssBoard as Record<string, unknown> | undefined;
        const projectId = String(projectWorkspace?.activeProjectId || rssBoard?.researchProjectId || 'PRJ-001');
        const folder = projectFolder(this.host.plugin, projectId);
        const projectFile = this.host.app.vault.getAbstractFileByPath(`${folder}/project.md`);
        const frontmatter = projectFile instanceof TFile ? this.host.app.metadataCache.getFileCache(projectFile)?.frontmatter : undefined;
        return { projectId, folder, title: String(frontmatter?.title || projectId) };
    }

    private async designs(ctx: ProjectContext): Promise<ExperimentDesign[]> {
        const prefix = `${ctx.folder}/designs/`;
        const result: ExperimentDesign[] = [];
        for (const file of this.host.app.vault.getMarkdownFiles().filter((item) => item.path.startsWith(prefix))) {
            const frontmatter = this.host.app.metadataCache.getFileCache(file)?.frontmatter;
            if (frontmatter?.type !== 'experiment-design') continue;
            result.push({
                file,
                id: String(frontmatter.design_id || file.basename),
                title: String(frontmatter.title || file.basename),
                status: (frontmatter.status || 'designing') as DesignStatus,
                version: String(frontmatter.version || 'v1.0'),
                auditPassed: frontmatter.audit_passed === true || frontmatter.audit_passed === 'true',
            });
        }
        return result.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
    }

    private renderList(container: HTMLElement, ctx: ProjectContext, designs: ExperimentDesign[]): void {
        const head = container.createDiv({ cls: 'deduction-pane-head' });
        head.createEl('h2', { text: '实验设计' });
        const add = head.createEl('button', { cls: 'scholarium-btn primary', text: '＋ 新建设计' });
        add.onclick = () => void this.createDesign(ctx);
        container.createEl('p', { cls: 'deduction-project-label', text: `${ctx.projectId} · ${ctx.title}` });

        const listEl = container.createDiv({ cls: 'deduction-design-list' });
        if (!designs.length) listEl.createEl('p', { cls: 'deduction-empty', text: '尚无设计任务。新建草案，或先在科研论中推演方案。' });
        for (const design of designs) {
            const card = listEl.createEl('button', { cls: `deduction-design-card ${design.id === this.selectedId ? 'is-selected' : ''}` });
            card.createEl('small', { text: `${design.id} · ${design.version}` });
            card.createEl('strong', { text: design.title });
            card.createSpan({ cls: `deduction-status status-${design.status}`, text: statusLabel[design.status] || design.status });
            card.onclick = () => { this.selectedId = design.id; this.draft = null; this.host.rerender(); };
        }
    }

    private async renderDialogue(container: HTMLElement, ctx: ProjectContext, selected: ExperimentDesign | null): Promise<void> {
        if (this.historyProjectId !== ctx.projectId) {
            this.history = await this.loadPersistedHistory(ctx);
            this.historyProjectId = ctx.projectId;
            this.pendingEvidence = null;
            this.compactedSummaryCache = null;
            const lastAgentTurn = [...this.history].reverse().find((turn) => turn.role === 'agent');
            const lastResearcherTurn = [...this.history].reverse().find((turn) => turn.role === 'researcher');
            this.draft = lastAgentTurn ? { message: String(lastResearcherTurn?.content ?? ''), reply: lastAgentTurn.content as TheoryReply } : null;
        }

        const head = container.createDiv({ cls: 'deduction-pane-head' });
        const copy = head.createDiv();
        copy.createEl('h2', { text: '科研论对话' });
        const nativeOn = Boolean(this.host.plugin.settings.researchTheoryNativeApi && this.host.plugin.settings.aiProvider === 'claude' && this.host.plugin.settings.aiApiKey);
        copy.createEl('p', { text: `单 Agent · 证据约束 · 仅生成草稿${nativeOn ? ' · 原生 API 工具调用' : ''}` });
        const bridge = await this.bridgeState();
        const connect = head.createEl('button', { cls: 'scholarium-btn', text: bridge.online ? 'Bridge 已连接' : '连接 Bridge' });
        connect.onclick = async () => {
            const next = await this.bridgeState();
            if (!next.online) new Notice(`无法连接本机 Bridge：${next.error || '请运行 Research Weaver 的 npm start'}`);
            this.host.rerender();
        };
        container.createEl('p', {
            cls: `deduction-bridge-state ${bridge.online ? 'is-online' : ''}`,
            text: bridge.online
                ? `本机 Bridge 已连接 · 可用 CLI：${bridge.agents.filter((agent) => agent.installed).map((agent) => agent.id).join('、') || '未检测到'}`
                : '本机 Bridge 未连接。插件只通过本地启动器代理调用，不读取或保存 Bridge token。',
        });

        const transcript = container.createDiv({ cls: 'deduction-transcript' });
        this.renderDraft(transcript);

        const form = container.createEl('form', { cls: 'deduction-composer' });
        const input = form.createEl('textarea', { attr: { placeholder: selected ? `围绕「${selected.title}」补充条件、观察或问题…` : '描述研究问题、已有证据、仪器条件和成功标准…' } });
        const send = form.createEl('button', { cls: 'scholarium-btn primary', text: '发送给科研论' });
        form.onsubmit = (event) => {
            event.preventDefault();
            const message = input.value.trim();
            if (!message) return;
            void this.runTheory(ctx, bridge, message, send);
        };
    }

    private renderDraft(container: HTMLElement): void {
        if (!this.history.length && !this.pendingEvidence) {
            container.createEl('p', { cls: 'deduction-empty deduction-intro', text: '科研论会先辨别已有证据和缺失约束；未通过自审计，不会创建实验方案或写入 Vault。' });
            return;
        }
        for (const turn of this.history) {
            if (turn.role === 'researcher') {
                const bubble = container.createDiv({ cls: 'deduction-message user' });
                bubble.createEl('small', { text: '你' });
                bubble.createEl('p', { text: String(turn.content) });
            } else if (turn.role === 'evidence') {
                this.renderEvidenceLogEntry(container, turn.content as EvidenceGroup);
            } else if (turn.role === 'agent') {
                this.renderAgentReply(container, turn.content as TheoryReply);
            }
        }
        if (this.pendingEvidence) this.renderEvidenceConfirmation(container);
    }

    private renderAgentReply(container: HTMLElement, reply: TheoryReply): void {
        const agent = container.createDiv({ cls: 'deduction-message agent' });
        agent.createEl('small', { text: '科研论主 Agent · 单一执行器' });
        agent.createEl('p', { text: reply.summary || '未返回摘要。' });
        const evidence = agent.createDiv({ cls: 'deduction-evidence' });
        for (const [key, title] of [['direct', '直接证据'], ['indirect', '间接线索'], ['unverified', '待验证']] as const) {
            const entries = reply.evidence?.[key] || [];
            const tag = evidence.createEl('span', { cls: `evidence-${key}`, text: `${title} ${entries.length}` });
            tag.title = entries.join('\n') || '未提供';
        }
        if (reply.questions?.length) {
            const questions = agent.createEl('ol', { cls: 'deduction-questions' });
            reply.questions.forEach((question) => questions.createEl('li', { text: `${question.question || '待补充'}${question.why ? ` —— ${question.why}` : ''}` }));
        }
        const gaps = [...(reply.audit?.evidence_gaps || []), ...(reply.audit?.feasibility_gaps || [])];
        agent.createEl('p', { cls: `deduction-audit ${reply.audit?.passed ? 'passed' : ''}`, text: reply.audit?.passed ? '自审计通过：可创建确认版本。' : `自审计未通过：${gaps.join('；') || reply.audit?.revision_action || '请补充关键约束或证据。'}` });
    }

    private renderEvidenceLogEntry(container: HTMLElement, group: EvidenceGroup): void {
        const card = container.createDiv({ cls: 'deduction-message tool' });
        const top = card.createDiv({ cls: 'deduction-tool-top' });
        top.createEl('small', { text: '文献检索工具' });
        top.createSpan({ text: group.error ? '失败' : '已执行' });
        card.createEl('p', { text: `检索式：${group.query || ''}` });
        if (group.error) {
            card.createEl('p', { text: `检索失败：${group.error}` });
            return;
        }
        const downloaded = group.downloaded || [];
        const okItems = downloaded.filter((item) => item && !('error' in item));
        const failItems = downloaded.filter((item) => item && 'error' in item);
        let summary = `命中 ${group.hit_count ?? (group.records ? group.records.length : 0)} 条`;
        summary += downloaded.length
            ? `；成功下载 ${okItems.length} 篇${failItems.length ? `，失败 ${failItems.length} 篇` : ''}`
            : '；本轮未下载全文（无可下载 OA 候选或研究员未确认）';
        card.createEl('p', { text: summary });
        if (okItems.length || failItems.length) {
            const detail = card.createDiv({ cls: 'deduction-download-detail' });
            for (const item of okItems) {
                detail.createEl('p', { cls: 'ok', text: `✓ ${String(item.title || item.path || '（未命名）')}` });
            }
            for (const item of failItems) {
                detail.createEl('p', { cls: 'fail', text: `✗ ${String(item.title || '（未命名）')} —— ${String(item.error || '未知原因').slice(0, 160)}` });
            }
        }
    }

    private renderEvidenceConfirmation(container: HTMLElement): void {
        const pending = this.pendingEvidence;
        if (!pending) return;
        for (const group of pending.groups) {
            const card = container.createDiv({ cls: 'deduction-message tool pending' });
            const top = card.createDiv({ cls: 'deduction-tool-top' });
            top.createEl('small', { text: '文献检索工具 · 待确认下载' });
            top.createSpan({ text: group.error ? '失败' : `命中 ${group.hit_count ?? 0} 条` });
            card.createEl('p', { text: `检索式：${group.query || ''}` });
            if (group.error) { card.createEl('p', { text: `检索失败：${group.error}` }); continue; }
            if (!group.candidates?.length) { card.createEl('p', { text: '未发现可直接下载的开放获取全文，以下结果仅作线索参考，不会自动下载。' }); continue; }
            card.createEl('p', { text: '以下为开放获取（OA）候选，勾选后点击下方按钮下载；不勾选则跳过该篇：' });
            const list = card.createDiv({ cls: 'deduction-evidence-candidates' });
            for (const candidate of group.candidates) {
                const row = list.createDiv({ cls: 'deduction-candidate-row' });
                const label = row.createEl('label');
                const box = label.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
                box.checked = candidate.selected !== false;
                box.onchange = () => { candidate.selected = box.checked; };
                label.createSpan({ text: ` ${candidate.title || '（无标题）'}${candidate.year ? ` (${candidate.year})` : ''}` });
                if (candidate.doi) row.createEl('small', { text: `DOI: ${candidate.doi}` });
            }
        }
        const actions = container.createDiv({ cls: 'deduction-evidence-actions' });
        const confirmBtn = actions.createEl('button', { cls: 'scholarium-btn primary', text: '下载所选并继续对话' });
        const skipBtn = actions.createEl('button', { cls: 'scholarium-btn', text: '不下载，直接继续' });
        confirmBtn.onclick = async () => {
            confirmBtn.disabled = true; skipBtn.disabled = true; confirmBtn.setText('下载中…');
            await this.finalizePendingEvidence(false);
        };
        skipBtn.onclick = async () => {
            confirmBtn.disabled = true; skipBtn.disabled = true; skipBtn.setText('继续中…');
            await this.finalizePendingEvidence(true);
        };
    }

    private async renderPlan(container: HTMLElement, selected: ExperimentDesign | null): Promise<void> {
        const head = container.createDiv({ cls: 'deduction-pane-head' });
        const copy = head.createDiv();
        copy.createEl('h2', { text: '实验方案卡片' });
        copy.createEl('p', { text: '仅展示已确认版本，不随对话自动落盘' });
        if (!selected) {
            container.createEl('p', { cls: 'deduction-empty', text: '尚未选择确认设计。科研论通过自审计后，可在此创建不可覆盖的确认版本。' });
            this.renderDraftActions(container);
            return;
        }
        head.createEl('button', { cls: 'scholarium-btn', text: '打开方案' }).onclick = () => void this.host.app.workspace.getLeaf('tab').openFile(selected.file, { active: true });
        const card = container.createDiv({ cls: 'deduction-plan-card' });
        const markdown = await this.host.app.vault.cachedRead(selected.file);
        card.createEl('small', { text: `${selected.id} · ${selected.version}` });
        card.createEl('h3', { text: selected.title });
        card.createSpan({ cls: `deduction-status status-${selected.status}`, text: statusLabel[selected.status] || selected.status });
        [...markdown.matchAll(/^##\s+(.+?)\s*\n([\s\S]*?)(?=^##\s+|$)/gm)].slice(0, 5).forEach((match) => {
            const section = card.createDiv({ cls: 'deduction-plan-section' });
            section.createEl('h4', { text: match[1] });
            section.createEl('p', { text: (match[2] || '').replace(/\|.*\|/g, '表格见原方案').replace(/[-*#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220) || '待补充' });
        });
        const create = container.createEl('button', { cls: 'scholarium-btn primary deduction-create-experiment', text: '创建实验记录' });
        const ready = selected.status === 'awaiting-experiment' && selected.auditPassed;
        create.disabled = !ready;
        create.title = ready ? '从已确认方案进入实验记录' : '仅限通过自审计的已确认方案';
        create.onclick = () => { if (ready) this.host.createExperimentRecord(); };
        this.renderDraftActions(container);
    }

    private renderDraftActions(container: HTMLElement): void {
        const draft = this.draft;
        if (!draft || !draft.reply || this.pendingEvidence) return;
        const actions = container.createDiv({ cls: 'deduction-draft-actions' });
        actions.createEl('button', { cls: 'scholarium-btn', text: '保存本轮对话' }).onclick = () => void this.saveTurn();
        if (draft.reply.status === 'ready' && draft.reply.audit?.passed === true) {
            actions.createEl('button', { cls: 'scholarium-btn primary', text: '创建确认版本' }).onclick = () => void this.confirmDesign();
        } else actions.createEl('p', { text: '方案仍是内存草稿；仅自审计通过后允许创建确认版本。' });
    }

    private async createDesign(ctx: ProjectContext): Promise<void> {
        const title = window.prompt('设计任务名称：', '新的实验设计');
        if (!title?.trim()) return;
        const id = await this.nextId(ctx);
        const path = `${ctx.folder}/designs/${id}.md`;
        const content = this.markdown(id, ctx.projectId, title.trim(), 'designing', false);
        if (!window.confirm(`将新建（不会覆盖已有文件）：\n${path}\n\n${content.slice(0, 1000)}\n\n确认创建吗？`)) return;
        await this.createOnly(path, content);
        this.selectedId = id;
        new Notice(`已新建设计草案：${id}`);
        this.host.rerender();
    }

    private async confirmDesign(): Promise<void> {
        const reply = this.draft?.reply;
        if (!reply || reply.status !== 'ready' || reply.audit?.passed !== true) throw new Error('方案未通过自审计，不能创建确认版本。');
        const ctx = await this.context();
        const id = await this.nextId(ctx);
        const title = reply.design?.title || '科研论确认设计';
        const sections = `\n## 科学问题\n\n${reply.design?.scientific_question || reply.summary || '待补充。'}\n\n## 核心假设（H0 / H1）\n\n- **H0**：${reply.hypotheses?.h0 || '待补充。'}\n- **H1**：${reply.hypotheses?.h1 || '待补充。'}\n\n## 竞争解释 / 替代假设\n\n${list(reply.hypotheses?.alternatives)}\n\n## 关键变量设计\n\n${list(reply.plan?.variables)}\n\n## 对照实验组\n\n${list(reply.plan?.controls)}\n\n## 表征与测试\n\n${list(reply.plan?.measurements)}\n\n## 预期结果\n\n${list(reply.plan?.expected_results)}\n\n## 潜在风险与对策\n\n${list(reply.plan?.risks)}\n\n## 下一步计划\n\n${String(reply.plan?.next_action || '待补充。')}\n\n## 证据范围\n\n- **直接证据**：${list(reply.evidence?.direct).replace(/^- /gm, '')}\n- **间接线索**：${list(reply.evidence?.indirect).replace(/^- /gm, '')}\n- **待验证**：${list(reply.evidence?.unverified).replace(/^- /gm, '')}\n`;
        const path = `${ctx.folder}/designs/${id}.md`;
        const content = this.markdown(id, ctx.projectId, title, 'awaiting-experiment', true, sections);
        if (!window.confirm(`以下确认版本将被新建，不会覆盖历史版本：\n${path}\n\n${content.slice(0, 1800)}\n\n确认创建吗？`)) return;
        await this.createOnly(path, content);
        this.selectedId = id;
        this.draft = null;
        new Notice(`已创建已确认方案：${id}`);
        this.host.rerender();
    }

    private async saveTurn(): Promise<void> {
        const draft = this.draft;
        if (!draft || !draft.reply) return;
        const ctx = await this.context();
        const id = this.selectedId || 'unassigned';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const path = `${ctx.folder}/03_科研论对话/${id}/${stamp}.md`;
        const content = `---\ntype: research-theory-turn\nproject_id: ${yaml(ctx.projectId)}\ndesign_id: ${yaml(id)}\ncreated_at: ${yaml(new Date().toISOString())}\nsource: research-deduction-room\n---\n\n# 科研论对话\n\n## 研究员\n\n${draft.message}\n\n## 科研论主 Agent\n\n\`\`\`json\n${JSON.stringify(draft.reply, null, 2)}\n\`\`\`\n`;
        if (!window.confirm(`将保存本轮对话（仅新建）：\n${path}\n\n确认吗？`)) return;
        await this.createOnly(path, content);
        new Notice('本轮科研论对话已保存');
    }

    // ---- 调度入口：CLI 单次执行 vs 原生 API 工具调用 ----
    private async runTheory(ctx: ProjectContext, bridge: BridgeState, message: string, submit: HTMLButtonElement): Promise<void> {
        if (!bridge.online) { new Notice('请先连接本机 Bridge。'); return; }
        submit.disabled = true;
        submit.setText('科研论审计中…');
        const { aiProvider, aiApiKey, researchTheoryNativeApi } = this.host.plugin.settings;
        if (researchTheoryNativeApi && aiProvider === 'claude' && aiApiKey) {
            await this.runTheoryNative(ctx, bridge, message, submit);
        } else {
            await this.runTheoryCli(ctx, bridge, message, submit);
        }
    }

    // ---- 路径一：本机 CLI 只读单次执行（默认） ----
    private async runTheoryCli(ctx: ProjectContext, bridge: BridgeState, message: string, submit: HTMLButtonElement): Promise<void> {
        const agent = bridge.agents.find((item) => item.id === 'codex' && item.installed) || bridge.agents.find((item) => item.installed);
        const base = (this.host.app.vault.adapter as unknown as { getBasePath?: () => string }).getBasePath?.();
        if (!agent || !base) { new Notice('Bridge 未检测到可用本机 Agent，或当前 Vault 不是桌面本地 Vault。'); submit.disabled = false; submit.setText('发送给科研论'); return; }
        const cwd = `${base.replace(/[\\/]+$/, '')}\\${ctx.folder.replace(/\//g, '\\')}`;
        try {
            this.pendingEvidence = null;
            const compacted = await this.getCompactedHistory((dropped) => this.summarizeViaCli(dropped, agent.id, cwd));
            const created = await this.bridgeFetch('/v1/tasks', { method: 'POST', body: JSON.stringify({ agentId: agent.id, cwd, permission: 'read', execute: true, prompt: this.protocol(ctx, message, compacted) }) });
            const raw = await this.waitTask(String(created.id));
            let reply = this.parseReply(raw);

            const gapText = [...(reply.audit?.evidence_gaps || []), ...(reply.audit?.feasibility_gaps || []), reply.summary || ''].join(' ');
            if (!(reply.evidence_requests?.length) && /literature|published|external evidence|文献|已发表|外部证据|检索支持/i.test(gapText)) {
                try {
                    const coercePrompt = `Your previous reply mentioned a missing public-literature / external-evidence gap in audit.evidence_gaps or summary, but evidence_requests was empty. Output ONLY one JSON object with a single field evidence_requests: 1-3 concrete English academic search phrases for that gap. No other fields, no explanation, no code fence: {"evidence_requests":[{"query":"","why":""}]}\nprevious summary: ${reply.summary || ''}\nprevious evidence_gaps: ${JSON.stringify(reply.audit?.evidence_gaps || [])}`;
                    const coerceTask = await this.bridgeFetch('/v1/tasks', { method: 'POST', body: JSON.stringify({ agentId: agent.id, cwd, permission: 'read', execute: true, prompt: coercePrompt }) });
                    const coerceRaw = await this.waitTask(String(coerceTask.id));
                    const coerceMatch = coerceRaw.match(/\{[\s\S]*\}/);
                    const coerced = coerceMatch ? JSON.parse(coerceMatch[0]) as { evidence_requests?: EvidenceRequest[] } : null;
                    if (coerced?.evidence_requests?.length) reply.evidence_requests = coerced.evidence_requests;
                    else {
                        const fallbackQuery = await this.deriveEvidenceQueryFallback(message, cwd, bridge);
                        if (fallbackQuery) reply.evidence_requests = [{ query: fallbackQuery, why: '自动兜底：Agent 未给出检索式，系统从课题目标提取英文检索词' }];
                        else this.history.push({ role: 'evidence', content: { query: '(追问与兜底都未返回有效检索式)', error: coerceRaw ? String(coerceRaw).slice(0, 300) : 'Agent 未返回结构化 JSON' } });
                    }
                } catch (evErr) {
                    this.history.push({ role: 'evidence', content: { query: '(追问请求失败)', error: evErr instanceof Error ? evErr.message : String(evErr) } });
                }
            }

            this.history.push({ role: 'researcher', content: message });

            if (reply.evidence_requests?.length) {
                const groups = await this.searchEvidenceCandidates(reply.evidence_requests, cwd);
                const hasCandidates = groups.some((g) => g.candidates?.length);
                if (hasCandidates) {
                    this.pendingEvidence = { mode: 'cli', ctx, message, pendingReply: reply, groups, agentId: agent.id, cwd, submit };
                    this.draft = { message, reply: null };
                    this.history = this.history.slice(-60);
                    submit.disabled = false;
                    submit.setText('发送给科研论');
                    this.host.rerender();
                    await this.persistHistory(ctx);
                    return;
                }
                for (const g of groups) this.history.push({ role: 'evidence', content: { ...g, downloaded: [] } });
                const evText = groups.length ? 'Automatic literature search completed but found no open-access downloadable full text this round. Treat as leads only:\n' + JSON.stringify(groups) : '';
                if (evText) reply = await this.continueCliTurn(ctx, agent.id, cwd, evText);
            }

            this.history.push({ role: 'agent', content: reply });
            this.history = this.history.slice(-60);
            this.draft = { message, reply };
            submit.disabled = false;
            submit.setText('发送给科研论');
            this.host.rerender();
            await this.persistHistory(ctx);
        } catch (error) {
            new Notice(`科研论对话失败：${error instanceof Error ? error.message : String(error)}`);
            submit.disabled = false;
            submit.setText('重试科研论');
        }
    }

    private async continueCliTurn(ctx: ProjectContext, agentId: string, cwd: string, evText: string): Promise<TheoryReply> {
        const follow = 'Automatic evidence retrieval has completed. Use the following OpenAlex / open-access results as retrieved evidence or leads. Do not invent unread full-text details. If evidence is still insufficient, ask concise follow-up questions.\n\n' + evText;
        const compacted = await this.getCompactedHistory((dropped) => this.summarizeViaCli(dropped, agentId, cwd));
        const task = await this.bridgeFetch('/v1/tasks', { method: 'POST', body: JSON.stringify({ agentId, cwd, permission: 'read', execute: true, prompt: this.protocol(ctx, follow, compacted) }) });
        const raw = await this.waitTask(String(task.id));
        return this.parseReply(raw);
    }

    // ---- 路径二：原生 API function calling（实验性，仅 Claude） ----
    private async runTheoryNative(ctx: ProjectContext, bridge: BridgeState, message: string, submit: HTMLButtonElement): Promise<void> {
        const base = (this.host.app.vault.adapter as unknown as { getBasePath?: () => string }).getBasePath?.();
        if (!base) { new Notice('当前 Vault 不是桌面本地 Vault，无法确定检索工作目录。'); submit.disabled = false; submit.setText('发送给科研论'); return; }
        const cwd = `${base.replace(/[\\/]+$/, '')}\\${ctx.folder.replace(/\//g, '\\')}`;
        try {
            this.pendingEvidence = null;
            this.history.push({ role: 'researcher', content: message });
            let reply = await this.runNativeLoop(ctx, cwd);
            if (reply.evidence_requests?.length) {
                const groups = await this.searchEvidenceCandidates(reply.evidence_requests, cwd);
                const hasCandidates = groups.some((g) => g.candidates?.length);
                if (hasCandidates) {
                    this.pendingEvidence = { mode: 'native', ctx, message, pendingReply: reply, groups, agentId: '', cwd, submit };
                    this.draft = { message, reply: null };
                    this.history = this.history.slice(-60);
                    submit.disabled = false;
                    submit.setText('发送给科研论');
                    this.host.rerender();
                    await this.persistHistory(ctx);
                    return;
                }
                for (const g of groups) this.history.push({ role: 'evidence', content: { ...g, downloaded: [] } });
                reply = await this.runNativeLoop(ctx, cwd, '以上是补充检索结果，未发现可下载全文，仅作线索参考，请给出更新后的最终 JSON 回复。');
            }
            this.history.push({ role: 'agent', content: reply });
            this.history = this.history.slice(-60);
            this.draft = { message, reply };
            submit.disabled = false;
            submit.setText('发送给科研论');
            this.host.rerender();
            await this.persistHistory(ctx);
        } catch (error) {
            new Notice(`科研论对话失败：${error instanceof Error ? error.message : String(error)}`);
            submit.disabled = false;
            submit.setText('重试科研论');
        }
    }

    private async runNativeLoop(ctx: ProjectContext, cwd: string, trailingNudge?: string): Promise<TheoryReply> {
        const { aiApiKey, aiModel } = this.host.plugin.settings;
        if (!aiApiKey) throw new Error('请先在设置中填写 Claude API Key。');
        const system = this.nativeSystemPrompt(ctx);
        const compacted = await this.getCompactedHistory((dropped) => this.summarizeViaNativeApi(dropped));
        const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
        for (const turn of compacted) {
            const converted = this.turnToNativeMessage(turn);
            if (converted) messages.push(converted);
        }
        if (trailingNudge) messages.push({ role: 'user', content: [{ type: 'text', text: trailingNudge }] });

        for (let round = 0; round < 6; round++) {
            const res = await fetchWithTimeout(ANTHROPIC_URL, {
                method: 'POST',
                headers: { 'x-api-key': aiApiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
                body: JSON.stringify({ model: aiModel || 'claude-sonnet-5', max_tokens: 4096, system, tools: NATIVE_TOOLS, messages }),
            });
            if (!res.ok) throw new Error(`Claude API 错误 ${res.status}: ${await res.text()}`);
            const data = await res.json() as { content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>; stop_reason?: string };
            messages.push({ role: 'assistant', content: data.content });
            if (data.stop_reason !== 'tool_use') {
                const text = data.content.filter((block) => block.type === 'text').map((block) => block.text || '').join('\n');
                return this.parseReply(text);
            }
            const toolResults: Array<Record<string, unknown>> = [];
            for (const block of data.content.filter((item) => item.type === 'tool_use')) {
                if (block.name === 'search_literature') {
                    const query = String(block.input?.query || '').trim();
                    const why = String(block.input?.why || '');
                    const groups = query ? await this.searchEvidenceCandidates([{ query, why }], cwd) : [];
                    const group = groups[0];
                    const summary = !group
                        ? '检索式为空，未执行检索。'
                        : group.error
                            ? `检索失败：${group.error}`
                            : `命中 ${group.hit_count ?? 0} 条，其中 ${group.candidates?.length ?? 0} 篇有开放获取全文可供下载（下载需研究员确认）：\n${(group.records || []).slice(0, 6).map((r) => `- ${r.title}${r.year ? ` (${r.year})` : ''}${r.doi ? ` DOI:${r.doi}` : ''}`).join('\n') || '（无结果）'}`;
                    if (group) this.history.push({ role: 'evidence', content: { ...group, downloaded: [] } });
                    this.host.rerender();
                    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: summary });
                } else {
                    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: '未知工具', is_error: true });
                }
            }
            messages.push({ role: 'user', content: toolResults });
        }
        throw new Error('科研论 Agent 工具调用轮次超限，请重试或简化问题。');
    }

    private nativeSystemPrompt(ctx: ProjectContext): string {
        return `你是"科研论主 Agent"。课题：${ctx.title} (${ctx.projectId})。你可以多次调用 search_literature 工具检索开放获取文献，在获得检索结果后继续推理、按需再次检索。完成推理后不要再调用工具，直接以纯文本回复且只包含一个 JSON 对象（不要用代码块包裹）：{"status":"questions|revise|ready","summary":"","questions":[{"question":"","why":""}],"hypotheses":{"h0":"","h1":"","alternatives":[]},"plan":{"variables":[],"controls":[],"measurements":[],"expected_results":[],"risks":[],"next_action":""},"evidence":{"direct":[],"indirect":[],"unverified":[]},"evidence_requests":[{"query":"","why":""}],"audit":{"passed":false,"evidence_gaps":[],"feasibility_gaps":[]},"design":{"title":"","scientific_question":""}}\n规则：只引用 search_literature 工具实际返回的资料，不得编造未检索到的内容；未知内容标待验证；缺少关键约束时最多提出 5 个问题；只有 H0/H1、替代解释、变量、对照、测量、重复/统计、stop/go、风险齐备且 audit.passed=true 时才能 ready；不得写文件。若你认为某几篇检索到的开放获取全文值得下载精读，把对应检索式列入 evidence_requests，系统会先征求研究员同意后才下载，不会自动下载。`;
    }

    private turnToNativeMessage(turn: HistoryTurn): { role: 'user' | 'assistant'; content: unknown } | null {
        if (turn.role === 'researcher') return { role: 'user', content: [{ type: 'text', text: String(turn.content) }] };
        if (turn.role === 'agent') return { role: 'assistant', content: [{ type: 'text', text: JSON.stringify(turn.content) }] };
        if (turn.role === 'evidence') return { role: 'user', content: [{ type: 'text', text: `[literature search result] ${JSON.stringify(turn.content)}` }] };
        if (turn.role === 'summary') return { role: 'user', content: [{ type: 'text', text: `[earlier conversation summary] ${String(turn.content)}` }] };
        return null;
    }

    private async summarizeViaNativeApi(droppedJson: string): Promise<string> {
        const { aiApiKey, aiModel } = this.host.plugin.settings;
        const res = await fetchWithTimeout(ANTHROPIC_URL, {
            method: 'POST',
            headers: { 'x-api-key': aiApiKey || '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
                model: aiModel || 'claude-sonnet-5',
                max_tokens: 500,
                messages: [{ role: 'user', content: `以下是更早的科研论对话历史（JSON 数组），请压缩为不超过 300 字的中文摘要，保留关键假设、已确认证据结论和未决问题；只输出摘要正文：\n${droppedJson}` }],
            }),
        });
        if (!res.ok) throw new Error(`摘要请求失败 (${res.status})`);
        const data = await res.json() as { content: Array<{ type: string; text?: string }> };
        return data.content.find((block) => block.type === 'text')?.text ?? '';
    }

    // ---- 待确认证据：下载 / 跳过 ----
    private async finalizePendingEvidence(skip: boolean): Promise<void> {
        const pe = this.pendingEvidence;
        if (!pe) return;
        this.pendingEvidence = null;
        const pushedCount = pe.groups.length;
        for (const g of pe.groups) {
            if (g.error) { this.history.push({ role: 'evidence', content: g }); continue; }
            const downloaded: Array<Record<string, unknown>> = [];
            if (!skip) {
                for (const cand of (g.candidates || []).filter((c) => c.selected !== false)) {
                    try { downloaded.push(await this.bridgeFetch(`/v1/literature/${g.search_id}/download`, { method: 'POST', body: JSON.stringify({ openalexId: cand.openalex_id, confirm: true }) })); }
                    catch (err) { downloaded.push({ title: cand.title, error: err instanceof Error ? err.message : String(err) }); }
                }
            }
            this.history.push({ role: 'evidence', content: { query: g.query, why: g.why, search_id: g.search_id, hit_count: g.hit_count, records: g.records, downloaded } });
        }
        const evidenceEntries = this.history.filter((t) => t.role === 'evidence').slice(-pushedCount);
        const evText = evidenceEntries.length
            ? (skip
                ? 'Literature search completed. The researcher reviewed the candidates and chose NOT to download any full text this round; treat the following as unread leads only, not verified evidence:\n'
                : 'Automatic literature evidence retrieval results (researcher reviewed the candidate list and approved the following downloads):\n') + JSON.stringify(evidenceEntries.map((t) => t.content))
            : '';
        await this.continueAfterEvidence(pe, evText, skip);
    }

    private async continueAfterEvidence(pe: PendingEvidence, evText: string, skip: boolean): Promise<void> {
        let reply = pe.pendingReply;
        if (evText) {
            try {
                reply = pe.mode === 'native'
                    ? await this.runNativeLoop(pe.ctx, pe.cwd, skip ? '以上为研究员选择不下载的检索线索，请给出更新后的最终 JSON 回复。' : '以上为研究员已确认下载的检索结果，请给出更新后的最终 JSON 回复。')
                    : await this.continueCliTurn(pe.ctx, pe.agentId, pe.cwd, evText);
            } catch (err) {
                new Notice(`科研论继续失败：${err instanceof Error ? err.message : String(err)}`);
            }
        }
        this.history.push({ role: 'agent', content: reply });
        this.history = this.history.slice(-60);
        this.draft = { message: pe.message, reply };
        if (pe.submit) { pe.submit.disabled = false; pe.submit.setText('发送给科研论'); }
        this.host.rerender();
        await this.persistHistory(pe.ctx);
    }

    // ---- 检索（不下载）----
    private async searchEvidenceCandidates(requests: Array<EvidenceRequest | string>, workspace: string): Promise<EvidenceGroup[]> {
        const jobs = (Array.isArray(requests) ? requests : [])
            .map((item): EvidenceRequest => (typeof item === 'string' ? { query: item } : item))
            .filter((item) => item && String(item.query || item.search_query || item.topic || '').trim().length >= 3)
            .slice(0, 3);
        if (!jobs.length) return [];
        const out: EvidenceGroup[] = [];
        for (const job of jobs) {
            const q = String(job.query || job.search_query || job.topic || '').trim().slice(0, 8000);
            try {
                new Notice(`Research-theory evidence search: ${q.slice(0, 80)}`);
                const search = await this.bridgeFetch('/v1/literature/search', { method: 'POST', body: JSON.stringify({ workspace, query: q }) });
                const manifest = (search.manifest as Record<string, unknown>) || {};
                const recs = (Array.isArray(manifest.records) ? manifest.records : Array.isArray(search.records) ? search.records : []) as Array<Record<string, unknown>>;
                const maxN = Math.max(1, Math.min(Number(job.max_results) || 8, 12));
                const records: EvidenceRecord[] = recs.slice(0, maxN).map((item) => ({
                    title: String(item.title || ''),
                    year: (item.year || item.publication_year || '') as string | number,
                    doi: String(item.doi || ''),
                    openalex_id: String(item.openalex_id || item.id || ''),
                    is_oa: Boolean(item.is_oa),
                    pdf_url: String(item.pdf_url || ''),
                }));
                const candidates: EvidenceCandidate[] = records.filter((r) => r.is_oa && r.pdf_url && r.openalex_id).slice(0, 6).map((r) => ({ ...r, selected: true }));
                out.push({ query: q, why: job.why || '', search_id: String(search.id || ''), hit_count: Number(manifest.total || manifest.count || recs.length), records, candidates });
            } catch (err) {
                out.push({ query: q, why: job.why || '', error: err instanceof Error ? err.message : String(err), records: [], candidates: [] });
            }
        }
        return out;
    }

    private async deriveEvidenceQueryFallback(topic: string, cwd: string, bridge: BridgeState): Promise<string> {
        try {
            const skills = ((await this.bridgeFetch('/v1/skills')).skills as Array<Record<string, unknown>>) || [];
            const builder = skills.find((s) => s.name === 'research-query-builder');
            if (builder) {
                const run = await this.bridgeFetch('/v1/skills/run', { method: 'POST', body: JSON.stringify({ skillId: builder.id, workspace: cwd, input: topic }) });
                const manifest = run.manifest as { concept_matrix?: Array<{ block?: string; terms?: string[] }> } | undefined;
                const matrix = manifest?.concept_matrix;
                if (Array.isArray(matrix) && matrix.length && !(matrix.length === 1 && matrix[0]?.block === 'topic')) {
                    const terms = Array.from(new Set(matrix.flatMap((block) => (block.terms || []).map((term) => String(term).replace(/[*"]/g, ''))))).slice(0, 14).join(' ');
                    if (terms) return terms;
                }
            }
        } catch { /* ignore, fall through to keyword translation */ }
        try {
            const agent = bridge.agents.find((item) => item.id === 'codex' && item.installed) || bridge.agents.find((item) => item.installed);
            if (!agent) return '';
            const task = await this.bridgeFetch('/v1/tasks', { method: 'POST', body: JSON.stringify({ agentId: agent.id, cwd, permission: 'read', execute: true, prompt: `Translate the following research question into 3 to 6 concise English academic search keyword phrases suitable for OpenAlex title/abstract search. Output only the keyword phrases separated by spaces, no explanation, no punctuation, no quotes, no Chinese characters: ${topic}` }) });
            const raw = await this.waitTask(String(task.id));
            return raw.replace(/[`"\n]/g, ' ').trim().slice(0, 300);
        } catch { return ''; }
    }

    // ---- 三层上下文压缩：微压缩 → 丢弃旧轮次 → LLM 摘要兜底 ----
    private async getCompactedHistory(summarize: (droppedJson: string) => Promise<string>): Promise<HistoryTurn[]> {
        const MICRO_LIMIT = 1200;
        const BUDGET = 9000;
        const KEEP_RECENT_MIN = 4;
        const micro: HistoryTurn[] = this.history.map((turn) => {
            const full = JSON.stringify(turn);
            if (full.length <= MICRO_LIMIT) return turn;
            if (turn.role === 'evidence') {
                const g = turn.content as EvidenceGroup;
                return { role: 'evidence', content: { query: g.query, hit_count: g.hit_count, downloaded: (g.downloaded || []).length, titles: (g.records || []).slice(0, 3).map((r) => r.title) } };
            }
            return { role: turn.role, content: JSON.stringify(turn.content).slice(0, MICRO_LIMIT) };
        });
        if (JSON.stringify(micro).length <= BUDGET) return micro;
        let keepFrom = 0;
        while (JSON.stringify(micro.slice(keepFrom)).length > BUDGET && micro.length - keepFrom > KEEP_RECENT_MIN) keepFrom++;
        const dropped = micro.slice(0, keepFrom);
        const kept = micro.slice(keepFrom);
        if (!dropped.length) return kept;
        if (this.compactedSummaryCache && this.compactedSummaryCache.forTurnCount === keepFrom) {
            return [{ role: 'summary', content: this.compactedSummaryCache.text }, ...kept];
        }
        try {
            const text = (await summarize(JSON.stringify(dropped).slice(0, 12000))).trim().slice(0, 600) || '（早期对话摘要为空）';
            this.compactedSummaryCache = { forTurnCount: keepFrom, text };
            return [{ role: 'summary', content: text }, ...kept];
        } catch {
            return kept;
        }
    }

    private async summarizeViaCli(droppedJson: string, agentId: string, cwd: string): Promise<string> {
        const prompt = `以下是更早的科研论对话历史（JSON 数组），请压缩为不超过 300 字的中文摘要，保留关键假设、已确认证据结论和未决问题；只输出摘要正文：\n${droppedJson}`;
        const task = await this.bridgeFetch('/v1/tasks', { method: 'POST', body: JSON.stringify({ agentId, cwd, permission: 'read', execute: true, prompt }) });
        return await this.waitTask(String(task.id));
    }

    // ---- 持久化：随插件 data.json 保存/恢复每个课题的科研论对话历史 ----
    private async loadPersistedHistory(ctx: ProjectContext): Promise<HistoryTurn[]> {
        try {
            const data = (await this.host.plugin.loadData()) as Record<string, unknown> | null;
            const store = data?.researchDeduction as Record<string, { history?: HistoryTurn[] }> | undefined;
            const entry = store?.[ctx.projectId];
            return Array.isArray(entry?.history) ? entry!.history! : [];
        } catch { return []; }
    }

    private async persistHistory(ctx: ProjectContext): Promise<void> {
        try {
            const data = ((await this.host.plugin.loadData()) as Record<string, unknown> | null) || {};
            const store = (data.researchDeduction as Record<string, unknown> | undefined) || {};
            store[ctx.projectId] = { history: this.history.slice(-60), updatedAt: new Date().toISOString() };
            data.researchDeduction = store;
            await this.host.plugin.saveData(data);
        } catch (error) {
            console.warn('[Scholarium] 科研论对话持久化失败', error);
        }
    }

    private parseReply(raw: string): TheoryReply {
        const match = raw.match(/\{[\s\S]*\}/);
        try { return match ? JSON.parse(match[0]) as TheoryReply : { status: 'questions', summary: raw, audit: { passed: false, evidence_gaps: ['Agent 未返回结构化 JSON'] } }; }
        catch { return { status: 'questions', summary: raw, audit: { passed: false, evidence_gaps: ['科研论 JSON 解析失败'] } }; }
    }

    private protocol(ctx: ProjectContext, message: string, compactedHistory: HistoryTurn[]): string {
        return `你是"科研论主 Agent"，只读执行。课题：${ctx.title} (${ctx.projectId})。历史：${JSON.stringify(compactedHistory)}。研究员本轮输入：${message}
规则：只引用实际读取的本地资料；未知内容标待验证；缺少关键约束时最多提出 5 个问题；只有 H0/H1、替代解释、变量、对照、测量、重复/统计、stop/go、风险齐备且 audit.passed=true 时才能 ready。不得写文件。
如果自审计 evidence_gaps 或 summary 提到缺少公开发表的文献/外部证据，则 evidence_requests 必须非空，至少给出一个具体的英文学术检索短语；不允许一边在 evidence_gaps 里写缺文献、一边把 evidence_requests 留空。
只输出 JSON：{"status":"questions|revise|ready","summary":"","questions":[{"question":"","why":""}],"hypotheses":{"h0":"","h1":"","alternatives":[]},"plan":{"variables":[],"controls":[],"measurements":[],"expected_results":[],"risks":[],"next_action":""},"evidence":{"direct":[],"indirect":[],"unverified":[]},"evidence_requests":[{"query":"","why":""}],"audit":{"passed":false,"evidence_gaps":[],"feasibility_gaps":[]},"design":{"title":"","scientific_question":""}}`;
    }

    private async bridgeState(): Promise<BridgeState> {
        try { const response = await this.bridgeFetch('/v1/agents'); return { online: true, agents: response.agents as Array<{ id: string; installed: boolean }> || [] }; }
        catch (error) { return { online: false, agents: [], error: error instanceof Error ? error.message : String(error) }; }
    }

    private async bridgeFetch(path: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
        const response = await fetch(`${BRIDGE_URL}${path}`, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
        const payload = await response.json() as Record<string, unknown>;
        if (!response.ok) throw new Error(String(payload.error || `Bridge 请求失败 (${response.status})`));
        return payload;
    }

    private async waitTask(id: string): Promise<string> {
        for (let attempt = 0; attempt < 600; attempt++) {
            const task = await this.bridgeFetch(`/v1/tasks/${id}`);
            const status = String(task.status || '');
            if (['completed', 'failed', 'cancelled'].includes(status)) {
                const events = Array.isArray(task.events) ? task.events as Array<{ type?: string; text?: string }> : [];
                if (status !== 'completed') throw new Error(events.filter((event) => event.type === 'error').at(-1)?.text || `任务结束：${status}`);
                return events.filter((event) => event.type === 'result').at(-1)?.text || '任务完成，但未返回结果。';
            }
            await new Promise((resolve) => window.setTimeout(resolve, 900));
        }
        throw new Error('等待科研论 Agent 超时');
    }

    private async nextId(ctx: ProjectContext): Promise<string> {
        const values = (await this.designs(ctx)).map((design) => Number(design.id.match(/EXP-D-(\d+)/)?.[1]) || 0);
        return `EXP-D-${String((values.length ? Math.max(...values) : 0) + 1).padStart(3, '0')}`;
    }

    private async createOnly(path: string, content: string): Promise<void> {
        const parts = path.split('/');
        parts.pop();
        await ensureFolder(this.host.app, parts.join('/'));
        if (this.host.app.vault.getAbstractFileByPath(path)) throw new Error('目标文件已经存在，已取消以避免覆盖。');
        await this.host.app.vault.create(path, content);
    }

    private markdown(id: string, projectId: string, title: string, status: DesignStatus, auditPassed: boolean, sections = ''): string {
        const fallback = `\n## 科学问题\n\n待通过科研论对话补充。\n\n## 核心假设（H0 / H1）\n\n- **H0**：待验证。\n- **H1**：待验证。\n\n## 竞争解释 / 替代假设\n\n待验证。\n\n## 关键变量设计\n\n| 变量 | 设置 | 目的 |\n| --- | --- | --- |\n| 待补充 | 待补充 | 待补充 |\n\n## 对照实验组\n\n| 组别 | 设置 | 排除的效应 |\n| --- | --- | --- |\n| 待补充 | 待补充 | 待补充 |\n\n## 表征与测试\n\n待补充。\n\n## 预期结果\n\n待补充。\n\n## 潜在风险与对策\n\n待补充。\n\n## 下一步计划\n\n先在科研论对话中补齐证据、约束与决策门。\n\n## 证据范围\n\n- **直接证据**：待补充。\n- **间接线索**：待补充。\n- **待验证**：待补充。\n`;
        return `---\ntype: experiment-design\ndesign_id: ${yaml(id)}\nproject_id: ${yaml(projectId)}\ntitle: ${yaml(title)}\nstatus: ${yaml(status)}\nversion: "v1.0"\nsource: research-deduction-room\nconfirmed_at: ${yaml(new Date().toISOString())}\naudit_passed: ${auditPassed}\ntags: []\n---\n\n# ${title}\n${sections || fallback}`;
    }
}
