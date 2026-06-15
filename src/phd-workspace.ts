import { App, Notice, Modal } from 'obsidian';
import ChemELNPlugin from './main';
import { t } from './i18n';
import { iconSvg } from './icons';
import { card as uiCard, sectionHeader, pill, button as uiButton, input as uiInput, metric as uiMetric, insetBlock } from './components/ui';
import { PROVIDER_CONFIG } from './settings';
import type { AIProvider } from './settings';
import { requestUrlWithTimeout, safeParseJson } from './utils/network';

// ─────────── 数据结构 ───────────

interface PeriodRecord { start: string; end: string; }
interface CheckinDay {
    wake?: string; sleep?: string;
    morning: PeriodRecord[];
    afternoon: PeriodRecord[];
    evening: PeriodRecord[];
    activePeriod?: { period: 'morning' | 'afternoon' | 'evening'; since: string } | null;
}

interface TimeBlock {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    category: string;
    title: string;
    note: string;
}

interface AIScheduleBlock {
    date?: string;
    startTime: string;
    endTime: string;
    category?: string;
    title: string;
    note?: string;
}

interface Task {
    id: string;
    title: string;
    status: 'active' | 'done';
    createdAt: string;
    completedAt?: string;
}

type CaptureKind = 'task' | 'idea' | 'contact' | 'experiment';

interface QuickCapture {
    id: string;
    kind: CaptureKind;
    content: string;
    date: string;
    time: string;
}

interface FocusSession {
    id: string;
    date: string;
    title: string;
    start: string;
    end: string;
    minutes: number;
    taskId?: string;
}

interface ActiveFocus {
    id: string;
    title: string;
    startTs: number;
    taskId?: string;
}

interface HabitItem {
    id: string;
    name: string;
    icon: string;
    color: string;
}

interface FoodEntry {
    id: string;
    date: string;
    meal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    content: string;
}

interface EmotionEntry {
    emoji: string;
    text: string;
    savedAt: string;
}

interface JournalEntry {
    proud: string;
    change: string;
    insight: string;
    grateful: string;
    savedAt: string;
}

interface PhoneLog {
    date: string;
    time: string;
    resisted: boolean;
    reason: string;
}

type SubmissionStage = '选题中' | '写作中' | '待投稿' | '已投稿' | '审稿中' | '返修中' | '已接收' | '搁置/拒稿';

interface Submission {
    id: string;
    title: string;
    venue: string;
    type: string;
    stage: SubmissionStage;
    priority: 'high' | 'medium' | 'low';
    deadline: string;
    notes: string;
    version: string;
    createdAt: string;
}

interface LeaveRecord {
    id: string;
    date: string;
    type: string;
    reason: string;
}

type TimelineRange = 'day' | 'week' | 'month';

export interface WorkspaceData {
    checkin: Record<string, CheckinDay>;
    timeblocks: TimeBlock[];
    tasks: Task[];
    captures: QuickCapture[];
    focus: { sessions: FocusSession[]; active: ActiveFocus | null };
    habits: { list: HabitItem[]; logs: Record<string, Record<string, boolean>> };
    food: { entries: FoodEntry[] };
    emotions: Record<string, EmotionEntry>;
    journal: Record<string, JournalEntry>;
    phone: { logs: PhoneLog[] };
    submissions: Submission[];
    leave: LeaveRecord[];
}

// ─────────── 常量 ───────────

const STAGES: SubmissionStage[] = ['选题中','写作中','待投稿','已投稿','审稿中','返修中','已接收','搁置/拒稿'];

const STAGE_COLOR: Record<SubmissionStage, string> = {
    '选题中': '#9fbcdb', '写作中': '#bbaecc', '待投稿': '#eecba8',
    '已投稿': '#4D9DE0', '审稿中': '#F9C74F', '返修中': '#FF8C42',
    '已接收': '#43AA8B', '搁置/拒稿': '#e0a2a2',
};

const DEFAULT_HABITS: HabitItem[] = [
    { id: 'h1', name: '阅读论文', icon: '📖', color: '#FF8A65' },
    { id: 'h2', name: '学术写作', icon: '✍️', color: '#AB47BC' },
    { id: 'h3', name: '运动', icon: '🏃', color: '#42A5F5' },
    { id: 'h4', name: '喝水', icon: '💧', color: '#26C6DA' },
    { id: 'h5', name: '按时睡觉', icon: '🌙', color: '#7E57C2' },
    { id: 'h6', name: '观心记录', icon: '🧘', color: '#EC407A' },
];

type PageId = '今日' | '总览首页' | '起居与考勤' | '时间块日历' | '专注与任务' | '习惯与饮食' | '情绪与观心' | '手机克制与成就' | '投稿管理' | '设置/数据管理' | '数据看板';

// ─────────── 辅助函数 ───────────

function today(): string { return new Date().toISOString().split('T')[0]!; }

function nowHHMM(): string {
    const n = new Date();
    return `${n.getHours().toString().padStart(2,'0')}:${n.getMinutes().toString().padStart(2,'0')}`;
}

function diffMin(start: string, end: string): number {
    const [sh,sm] = start.split(':').map(Number) as [number,number];
    const [eh,em] = end.split(':').map(Number) as [number,number];
    return Math.max(0, (eh*60+em) - (sh*60+sm));
}

function uid(): string { return Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

function formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function getMonthDays(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
    return new Date(year, month, 1).getDay();
}

// ─────────── 主类 ───────────

export class PhDWorkspace {
    private app: App;
    private plugin: ChemELNPlugin;
    data: WorkspaceData = this.blank();
    private container: HTMLElement | null = null;
    private activePage: PageId = '今日';
    private focusTimer: number | null = null;
    private focusDisplayEl: HTMLElement | null = null;
    private todayTimer: number | null = null;
    private timelineRange: TimelineRange = 'day';
    private calendarMonth: { year: number; month: number } = (() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() };
    })();
    private dashboardRange: 7 | 30 | 90 | 365 = 7;

    constructor(app: App, plugin: ChemELNPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    blank(): WorkspaceData {
        return {
            checkin: {},
            timeblocks: [],
            tasks: [],
            captures: [],
            focus: { sessions: [], active: null },
            habits: { list: DEFAULT_HABITS.map(h => ({ ...h })), logs: {} },
            food: { entries: [] },
            emotions: {},
            journal: {},
            phone: { logs: [] },
            submissions: [],
            leave: [],
        };
    }

    // ──── 持久化 ────
    async load() {
        const raw = (await this.plugin.loadData()) as Record<string, unknown> | null ?? {};
        this.data = (raw.workspace as WorkspaceData) ?? this.blank();
        // 数据迁移补全
        if (!this.data.checkin)     this.data.checkin     = {};
        if (!this.data.timeblocks)  this.data.timeblocks  = [];
        if (!this.data.tasks)       this.data.tasks       = [];
        if (!this.data.captures)    this.data.captures    = [];
        if (!this.data.focus)       this.data.focus       = { sessions: [], active: null };
        if (!this.data.habits)      this.data.habits      = { list: DEFAULT_HABITS.map(h => ({ ...h })), logs: {} };
        if (!this.data.food)        this.data.food        = { entries: [] };
        if (!this.data.emotions)    this.data.emotions    = {};
        if (!this.data.journal)     this.data.journal     = {};
        if (!this.data.phone)       this.data.phone       = { logs: [] };
        if (!this.data.submissions) this.data.submissions = [];
        if (!this.data.leave)       this.data.leave       = [];
    }

    async save() {
        await this.plugin.updateData((data) => {
            data.workspace = this.data;
        });
    }

    private rerender() {
        if (this.container) this.render(this.container);
    }

    // ──── 主渲染 ────
    render(container: HTMLElement) {
        if (this.focusTimer) { window.clearInterval(this.focusTimer); this.focusTimer = null; }
        if (this.todayTimer) { window.clearInterval(this.todayTimer); this.todayTimer = null; }
        this.focusDisplayEl = null;

        this.container = container;
        container.empty();
        container.addClass('ws2-root');

        const root = container.createDiv({ cls: 'ws2-layout' });
        const sidebar = root.createDiv({ cls: 'ws2-sidebar' });
        const content = root.createDiv({ cls: 'ws2-content' });

        this.renderSidebar(sidebar);
        this.renderPage(content);
    }

    // ──── 侧边栏 ────
    private renderSidebar(el: HTMLElement) {
        const s = this.plugin.settings;
        // 根据角色生成图标和副标题
        const roleSubtitles: Record<string, string> = {
            undergraduate: '整合版 · 学习 / 科研 / 规划',
            master:        '整合版 · 科研 / 自律 / 论文',
            phd:           '整合版 · 自律 / 科研 / 投稿',
            advisor:       '整合版 · 指导 / 科研 / 管理',
            custom:        '整合版 · 自律 / 科研',
        };
        const roleIcons: Record<string, string> = {
            undergraduate: '🎓', master: '📖', phd: '🔬', advisor: '🏛️', custom: '⚙️',
        };
        const role = s.workspaceRole ?? 'phd';
        const wsTitle = s.workspaceRole !== 'custom'
            ? (s.workspaceTabLabel || (s.pluginDisplayName?.replace(/^[^\s]+\s*/, '') || 'Workspace'))
            : (s.workspaceTabLabel || 'Workspace');
        const logoText = wsTitle || 'PhD Master Workspace';
        const subtitle = roleSubtitles[role] ?? roleSubtitles['phd'];
        const logoIcon = roleIcons[role] ?? '🎓';

        const branding = el.createDiv({ cls: 'ws2-sidebar-header' });
        branding.createDiv({ cls: 'ws2-logo-circle', text: logoIcon });
        branding.createEl('h2', { text: logoText, cls: 'ws2-logo-title' });
        branding.createEl('div', { text: subtitle, cls: 'ws2-logo-subtitle' });
        const now = new Date();
        branding.createEl('div', {
            text: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${nowHHMM()}`,
            cls: 'ws2-logo-datetime'
        });

        // ── 分组子导航（重设计 M3：今日 / 项目与论文 / 健康与心灵 / 数据与回顾）──
        const lang = s.language;
        type NavItem = { page: PageId; icon: string; labelKey?: string; label?: { zh: string; en: string } };
        const groups: Array<{ key: string; items: NavItem[] }> = [
            { key: 'group_today', items: [
                { page: '今日',       icon: 'today',    labelKey: 'ws_today' },
                { page: '总览首页',   icon: 'panel',    label: { zh: '总览', en: 'Overview' } },
                { page: '起居与考勤', icon: 'clock',    labelKey: 'checkin' },
            ] },
            { key: 'group_work', items: [
                { page: '专注与任务', icon: 'bolt',     label: { zh: '专注与任务', en: 'Focus & Tasks' } },
                { page: '时间块日历', icon: 'calendar', label: { zh: '时间块', en: 'Time blocks' } },
                { page: '投稿管理',   icon: 'submit',   labelKey: 'ws_submit' },
            ] },
            { key: 'group_self', items: [
                { page: '习惯与饮食',     icon: 'habit',  labelKey: 'ws_habit' },
                { page: '情绪与观心',     icon: 'mind',   labelKey: 'ws_mind' },
                { page: '手机克制与成就', icon: 'trophy', labelKey: 'ws_achv' },
            ] },
            { key: 'group_data', items: [
                { page: '数据看板',      icon: 'chart',    labelKey: 'ws_analytics' },
                { page: '设置/数据管理', icon: 'database', label: { zh: '数据管理', en: 'Data' } },
            ] },
        ];

        const nav = el.createDiv({ cls: 'ws2-nav sch-subnav' });
        for (const group of groups) {
            const groupEl = nav.createDiv();
            groupEl.addClass('sch-static-style-64');
            const head = groupEl.createDiv({ text: t(group.key, lang) });
            head.addClass('sch-static-style-65');
            for (const it of group.items) {
                const label = it.labelKey ? t(it.labelKey, lang) : (it.label ? it.label[lang] : it.page);
                const active = this.activePage === it.page;
                const item = groupEl.createDiv();
                item.setCssStyles({
                    display: 'flex', alignItems: 'center', gap: '9px',
                    padding: '7px 10px', borderRadius: '9px', cursor: 'pointer',
                    color: active ? 'var(--sch-accent-ink)' : 'var(--sch-ink2)',
                    background: active ? 'var(--sch-accent-soft)' : 'transparent',
                    fontWeight: active ? '600' : '500', fontSize: '13px',
                    transition: 'all .15s ease',
                });
                const ic = iconSvg(it.icon, { size: 16 });
                ic.setCssStyles({ color: active ? 'var(--sch-accent-ink)' : 'var(--sch-mute)' });
                ic.addClass('sch-static-style-11');
                item.appendChild(ic);
                item.appendChild(document.createTextNode(label));
                if (!active) {
                    item.addEventListener('mouseenter', () => { item.addClass('sch-static-style-66'); });
                    item.addEventListener('mouseleave', () => { item.addClass('sch-static-style-67'); });
                }
                item.onclick = () => { this.activePage = it.page; this.rerender(); };
            }
        }

        // 今日快照
        const snapshot = el.createDiv({ cls: 'ws2-snapshot' });
        snapshot.createEl('h4', { text: '今日快照', cls: 'ws2-snapshot-title' });

        const todayFocus = this.data.focus.sessions.filter(s => s.date === today()).reduce((s, r) => s + r.minutes, 0);
        const activeTasks = this.data.tasks.filter(t => t.status === 'active').length;
        const phoneResist = this.data.phone.logs.filter(l => l.date === today() && l.resisted).length;
        const todayHabits = this.data.habits.list.length ? this.data.habits.logs[today()]
            ? Object.values(this.data.habits.logs[today()]!).filter(v => v).length : 0 : 0;
        const activeSubmissions = this.data.submissions.filter(s => !['已接收','搁置/拒稿'].includes(s.stage)).length;

        const stats = [
            { label: '专注时长', value: `${todayFocus}m` },
            { label: '进行中任务', value: String(activeTasks) },
            { label: '手机克制', value: String(phoneResist) },
            { label: '习惯完成度', value: `${this.data.habits.list.length ? Math.round(todayHabits/this.data.habits.list.length*100) : 0}%` },
            { label: '投稿进行中', value: String(activeSubmissions) },
        ];

        const statsGrid = snapshot.createDiv({ cls: 'ws2-snapshot-stats' });
        for (const stat of stats) {
            const card = statsGrid.createDiv({ cls: 'ws2-snapshot-card' });
            card.createEl('div', { text: stat.label, cls: 'ws2-snapshot-label' });
            card.createEl('div', { text: stat.value, cls: 'ws2-snapshot-value' });
        }
    }

    // ──── 页面路由 ────
    private readonly PAGE_META: Record<string, { icon: string; subtitle: string }> = {
        '今日':           { icon: '🗓️', subtitle: '一条时间主线，串起今天' },
        '总览首页':       { icon: '🏠', subtitle: '今日概况一览' },
        '起居与考勤':     { icon: '⏰', subtitle: '记录作息，追踪出勤' },
        '时间块日历':     { icon: '📅', subtitle: '规划每日日程' },
        '专注与任务':     { icon: '🎯', subtitle: '深度工作，完成目标' },
        '习惯与饮食':     { icon: '🌿', subtitle: '养成好习惯，关注健康' },
        '情绪与观心':     { icon: '❤️', subtitle: '记录内心，正念觉察' },
        '手机克制与成就': { icon: '🛡️', subtitle: '克制手机，积累成就' },
        '投稿管理':       { icon: '✈️', subtitle: '论文投稿全流程管理' },
        '设置/数据管理':  { icon: '≡',  subtitle: '数据备份与设置' },
        '数据看板':       { icon: '📊', subtitle: '多维数据可视化' },
    };

    private renderPage(el: HTMLElement) {
        el.addClass('ws2-page');

        // 今日页（重设计）有自己的头卡，跳过通用 hero
        if (this.activePage !== '今日') {
            // Hero banner — 公开版风格：左侧标题+副标题，右侧 WK 徽章
            const meta = this.PAGE_META[this.activePage] ?? { icon: '📋', subtitle: '' };
            const hero = el.createDiv({ cls: 'ws2-page-hero' });

            const titleWrap = hero.createDiv({ cls: 'ws2-page-hero-title-wrap' });
            titleWrap.createEl('h2', { text: `${meta.icon}  ${this.activePage}`, cls: 'ws2-page-hero-title' });
            if (meta.subtitle) titleWrap.createEl('p', { text: meta.subtitle, cls: 'ws2-page-hero-sub' });

            // 右上 WK 徽章 (xl-page-wk-badge)
            const now = new Date();
            const isoWk = (d: Date): number => {
                const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
                let n = t.getUTCDay(); if (n === 0) n = 7;
                t.setUTCDate(t.getUTCDate() + 4 - n);
                const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
                return Math.ceil((((+t - +y0) / 86400000) + 1) / 7);
            };
            const wk = isoWk(now).toString().padStart(2, '0');
            const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;
            const wkBadge = hero.createDiv({ cls: 'xl-page-wk-badge' });
            wkBadge.createSpan({ text: `WK${wk}`, cls: 'xl-page-wk-num' });
            wkBadge.createSpan({ text: ` · ${dateStr}`, cls: 'xl-page-wk-date' });
        }

        // Scrollable body
        const body = el.createDiv({ cls: 'ws2-page-body' });

        if (this.activePage === '今日') this.renderToday(body);
        else if (this.activePage === '总览首页') this.renderOverview(body);
        else if (this.activePage === '起居与考勤') this.renderCheckin(body);
        else if (this.activePage === '时间块日历') this.renderTimeblock(body);
        else if (this.activePage === '专注与任务') this.renderFocus(body);
        else if (this.activePage === '习惯与饮食') this.renderHabits(body);
        else if (this.activePage === '情绪与观心') this.renderEmotions(body);
        else if (this.activePage === '手机克制与成就') this.renderPhone(body);
        else if (this.activePage === '投稿管理') this.renderSubmission(body);
        else if (this.activePage === '设置/数据管理') this.renderSettings(body);
        else if (this.activePage === '数据看板') this.renderDashboard(body);
    }

    // ════════════════════════════════
    // 今日（重设计 M4：时间轴）
    // ════════════════════════════════
    private renderToday(el: HTMLElement) {
        const lang = this.plugin.settings.language;
        const td = this.getToday();
        const dnow = new Date();

        const root = el.createDiv();
        root.addClass('sch-static-style-68');

        // ── 统计 ──
        const focusMins = this.data.focus.sessions.filter(s => s.date === today()).reduce((s, r) => s + r.minutes, 0);
        const activeTasksArr = this.data.tasks.filter(t => t.status === 'active');
        const doneToday = this.data.tasks.filter(t => t.status === 'done' && t.completedAt === today()).length;
        const totalTasks = this.data.tasks.length;
        const todayEmotion = this.data.emotions[today()];
        const fh = Math.floor(focusMins / 60), fm = focusMins % 60;

        // ── 头卡：日期 + 问候 + 概述 + 4 指标 ──
        const header = uiCard(root);
        const hRow = header.createDiv();
        hRow.addClass('sch-static-style-69');
        const hLeft = hRow.createDiv();
        const hr = dnow.getHours();
        const greetKey = hr < 11 ? 'greeting_morning' : hr < 14 ? 'greeting_noon' : hr < 18 ? 'greeting_afternoon' : hr < 22 ? 'greeting_evening' : 'greeting_night';
        const dayCh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dnow.getDay()] || '';
        const isoWk = (d: Date): number => {
            const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            let n = x.getUTCDay(); if (n === 0) n = 7;
            x.setUTCDate(x.getUTCDate() + 4 - n);
            const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
            return Math.ceil((((+x - +y0) / 86400000) + 1) / 7);
        };
        const dateLabel = lang === 'zh'
            ? `${dnow.getFullYear()} 年 ${dnow.getMonth() + 1} 月 ${dnow.getDate()} 日 · ${dayCh} · 第 ${isoWk(dnow)} 周`
            : `${dnow.toDateString()} · Week ${isoWk(dnow)}`;
        const eb = hLeft.createDiv({ text: dateLabel });
        eb.addClass('sch-static-style-70');
        const userName = (this.plugin.settings.pluginDisplayName || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
        const greet = hLeft.createDiv({ text: t(greetKey, lang) + (userName ? `，${userName}` : '') });
        greet.addClass('sch-static-style-71');
        const summary = hLeft.createDiv();
        summary.addClass('sch-static-style-72');
        const blocksToday = this.data.timeblocks.filter(b => b.date === today()).length;
        summary.setText(lang === 'zh'
            ? `今天 ${blocksToday} 个时间块、${activeTasksArr.length} 件待办，已专注 ${fh}h${fm}m。`
            : `${blocksToday} blocks, ${activeTasksArr.length} open tasks, ${fh}h${fm}m focused so far.`);

        const metrics = hRow.createDiv();
        metrics.addClass('sch-static-style-73');
        uiMetric(metrics, { label: t('metric_focus', lang), value: `${fh}h${fm}` });
        uiMetric(metrics, { label: t('metric_done', lang), value: String(doneToday), unit: `/${totalTasks}` });
        uiMetric(metrics, { label: t('metric_energy', lang), value: focusMins > 0 ? Math.min(99, 40 + Math.round(focusMins / 6)) : 50, unit: '%' });
        uiMetric(metrics, { label: t('metric_mood', lang), value: todayEmotion?.emoji || '◯', unit: todayEmotion?.text || '' });

        // ── 两栏：时间轴 | 右侧操作 ──
        const grid = root.createDiv();
        grid.addClass('sch-static-style-74');

        // 时间轴卡
        const spineCard = uiCard(grid, { pad: false });
        const spineHead = spineCard.createDiv();
        spineHead.addClass('sch-static-style-75');
        const { right: shRight } = sectionHeader(spineHead, { eyebrow: t('today_spine', lang), title: lang === 'zh' ? '从早到晚，一条主线串起' : 'One thread, dawn to dusk', level: 2 });
        // sectionHeader adds marginBottom; neutralize inside flex
        (spineHead.firstElementChild as HTMLElement).addClass('sch-static-style-76');
        pill(shRight, lang === 'zh' ? `专注 ${fh}h ${fm}m` : `${fh}h ${fm}m focus`, 'accent');
        this.renderTimelineRangePicker(shRight, lang);
        const spineBody = spineCard.createDiv();
        spineBody.addClass('sch-static-style-77');
        this.renderTimeSpine(spineBody, td, lang, this.timelineRange);

        // 右栏
        const rail = grid.createDiv();
        rail.addClass('sch-static-style-78');
        this.renderCheckinCard(rail, td, lang);
        this.renderFocusTimerCard(rail, lang);
        this.renderAIScheduleCard(rail, lang);
        this.renderQuickCaptureCard(rail, lang);
        this.renderIdeaCalendarCard(rail, lang);
        this.renderTodaysTasksCard(rail, activeTasksArr, lang);
    }

    private todayKindColor(kind: string): string {
        switch (kind) {
            case 'focus':   return 'var(--sch-accent)';
            case 'meeting': return 'var(--sch-iris)';
            case 'meal':    return 'var(--sch-moss)';
            case 'review':  return 'var(--sch-iris)';
            case 'checkin': return 'var(--sch-mute-soft)';
            default:        return 'var(--sch-sky)'; // task
        }
    }

    private renderTimelineRangePicker(host: HTMLElement, lang: 'zh' | 'en') {
        const wrap = host.createDiv();
        wrap.addClass('sch-static-style-79');
        const opts: Array<{ value: TimelineRange; zh: string; en: string }> = [
            { value: 'day', zh: '今日', en: 'Day' },
            { value: 'week', zh: '本周', en: 'Week' },
            { value: 'month', zh: '本月', en: 'Month' },
        ];
        for (const opt of opts) {
            const active = this.timelineRange === opt.value;
            const btn = wrap.createEl('button', { text: lang === 'zh' ? opt.zh : opt.en });
            btn.setCssStyles({
                height: '24px',
                padding: '0 9px',
                border: '0',
                borderRadius: '999px',
                background: active ? 'var(--sch-surface)' : 'transparent',
                color: active ? 'var(--sch-accent-ink)' : 'var(--sch-mute)',
                fontSize: '11.5px',
                fontWeight: '700',
                cursor: 'pointer',
            });
            btn.addEventListener('click', () => {
                this.timelineRange = opt.value;
                this.rerender();
            });
        }
    }

    private renderTimeSpine(host: HTMLElement, td: CheckinDay, lang: 'zh' | 'en', range: TimelineRange = 'day') {
        if (range !== 'day') {
            this.renderRangeTimeline(host, range, lang);
            return;
        }
        type Ev = { start: string; end?: string; kind: 'focus' | 'meeting' | 'meal' | 'task' | 'checkin'; title: string; tbId?: string };
        const events: Ev[] = [];

        // 专注 sessions
        for (const s of this.data.focus.sessions.filter(s => s.date === today())) {
            events.push({ start: s.start, end: s.end, kind: 'focus', title: s.title });
        }
        // 时间块
        const catKind = (c: string): Ev['kind'] => {
            if (/会议|讨论|组会|社交|周会/.test(c)) return 'meeting';
            if (/用餐|午餐|晚餐|早餐|吃饭|餐|饭/.test(c)) return 'meal';
            if (/专注|学习|写作|实验/.test(c)) return 'focus';
            return 'task';
        };
        for (const b of this.data.timeblocks.filter(b => b.date === today())) {
            events.push({ start: b.startTime, end: b.endTime, kind: catKind(b.category + b.title), title: b.title, tbId: b.id });
        }
        // 考勤时段（在岗）
        const periodLabel: Record<string, string> = { morning: lang === 'zh' ? '在岗 · 上午' : 'On-site · AM', afternoon: lang === 'zh' ? '在岗 · 下午' : 'On-site · PM', evening: lang === 'zh' ? '在岗 · 晚上' : 'On-site · Eve' };
        (['morning', 'afternoon', 'evening'] as const).forEach(pk => {
            for (const seg of td[pk]) events.push({ start: seg.start, end: seg.end, kind: 'checkin', title: periodLabel[pk]! });
        });
        if (td.activePeriod) {
            events.push({ start: td.activePeriod.since, end: nowHHMM(), kind: 'checkin', title: (lang === 'zh' ? '在岗（进行中）' : 'On-site (now)') });
        }

        // 起止小时
        const ROW_H = 56;
        let startHour = 8, endHour = 22;
        if (events.length) {
            const hours = events.flatMap(e => [parseInt(e.start.slice(0, 2), 10), e.end ? parseInt(e.end.slice(0, 2), 10) : parseInt(e.start.slice(0, 2), 10)]);
            startHour = Math.max(6, Math.min(8, Math.min(...hours)));
            endHour = Math.min(23, Math.max(22, Math.max(...hours) + 1));
        }
        const hourCount = endHour - startHour + 1;

        const wrap = host.createDiv();
        wrap.addClass('sch-static-style-80');

        // 时刻轨
        const rail = wrap.createDiv();
        for (let h = startHour; h <= endHour; h++) {
            const row = rail.createDiv();
            row.setCssStyles({ height: ROW_H + 'px', position: 'relative', borderTop: h === startHour ? 'none' : '1px dashed var(--sch-line-soft)' });
            const label = row.createSpan({ text: String(h).padStart(2, '0') + ':00' });
            label.addClass('sch-static-style-81');
        }

        // 事件列
        const col = wrap.createDiv();
        col.addClass('sch-static-style-82');
        const spineLine = col.createDiv();
        spineLine.addClass('sch-static-style-83');

        const kindText = (k: Ev['kind']): string => {
            const m: Record<Ev['kind'], [string, string]> = { task: ['任务', 'TASK'], focus: ['专注', 'FOCUS'], meeting: ['会议', 'MEETING'], meal: ['用餐', 'MEAL'], checkin: ['考勤', 'CHECK-IN'] };
            return lang === 'zh' ? m[k][0] : m[k][1];
        };

        // ── 碰撞分列布局：无重叠时占满整行，重叠时左右分列、各自变窄 ──
        const toMin = (hhmm: string) => parseInt(hhmm.slice(0, 2), 10) * 60 + (parseInt(hhmm.slice(3, 5), 10) || 0);
        const evs = events.map((e, i) => {
            const s = toMin(e.start);
            const e2 = e.end ? Math.max(toMin(e.end), s + 15) : s + 24;
            return { ev: e, i, s, e2 };
        }).sort((a, b) => a.s - b.s || a.e2 - b.e2);

        // 贪心列分配：同一连通重叠组内列数一致
        type Placed = { ev: Ev; i: number; col: number; cols: number };
        const placed: Placed[] = [];
        let group: Array<{ ev: Ev; i: number; s: number; e2: number; col: number }> = [];
        let groupEnd = -1;
        const flush = () => {
            const cols = group.reduce((m, g) => Math.max(m, g.col + 1), 0);
            for (const g of group) placed.push({ ev: g.ev, i: g.i, col: g.col, cols });
            group = []; groupEnd = -1;
        };
        for (const item of evs) {
            if (group.length && item.s >= groupEnd) flush();
            const used = new Set(group.filter(g => g.e2 > item.s).map(g => g.col));
            let cidx = 0; while (used.has(cidx)) cidx++;
            group.push({ ev: item.ev, i: item.i, s: item.s, e2: item.e2, col: cidx });
            groupEnd = Math.max(groupEnd, item.e2);
        }
        flush();

        // 每个事件分配一个独立颜色（循环调色板）
        const palette = ['var(--sch-accent)', 'var(--sch-iris)', 'var(--sch-moss)', 'var(--sch-sky)', 'var(--sch-coral)', 'var(--sch-sun)', 'var(--sch-rose)'];
        const GUT_L = 38, GUT_R = 6, GAP = 4;

        for (const p of placed) {
            const ev = p.ev;
            const sh = parseInt(ev.start.slice(0, 2), 10);
            const sm = parseInt(ev.start.slice(3, 5), 10) || 0;
            const startFrac = (sh - startHour) + sm / 60;
            const eh = ev.end ? parseInt(ev.end.slice(0, 2), 10) : sh;
            const em = ev.end ? (parseInt(ev.end.slice(3, 5), 10) || 0) : sm;
            const endFrac = ev.end ? (eh - startHour) + em / 60 : startFrac + 0.4;
            const top = startFrac * ROW_H;
            const height = Math.max((endFrac - startFrac) * ROW_H, 26);
            const color = palette[p.i % palette.length]!;
            const colW = `calc((100% - ${GUT_L + GUT_R}px) / ${p.cols})`;
            const leftCss = `calc(${GUT_L}px + ${p.col} * ${colW})`;
            const widthCss = p.cols > 1 ? `calc(${colW} - ${GAP}px)` : colW;

            const block = col.createDiv();
            block.setCssStyles({
                position: 'absolute', top: top + 'px', height: height + 'px',
                left: leftCss, width: widthCss,
                borderRadius: '10px',
                background: 'var(--sch-surface)',
                border: '1px solid var(--sch-line-soft)',
                borderLeft: `3px solid ${color}`,
                padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '2px',
                overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.03)',
                cursor: ev.tbId ? 'pointer' : 'default',
            });
            block.setAttribute('title', `${ev.start}${ev.end ? '–' + ev.end : ''} · ${kindText(ev.kind)}\n${ev.title}`);
            const kh = block.createDiv();
            kh.setCssStyles({ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontFamily: 'var(--sch-font-mono)', fontWeight: '700', color, letterSpacing: '.04em', flexShrink: '0' });
            const dot = kh.createSpan(); dot.setCssStyles({ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: '0' });
            kh.appendChild(document.createTextNode(`${ev.start}${ev.end ? '–' + ev.end : ''} · ${kindText(ev.kind)}`));
            // 标题：在块高度内自动换行显示，不再固定单行省略
            const ttl = block.createDiv({ text: ev.title });
            ttl.addClass('sch-static-style-84');
            if (ev.tbId) block.addEventListener('click', () => this.openTimeBlockEditor(ev.tbId!));
        }

        if (events.length === 0) {
            const empty = col.createDiv({ text: t('no_events', lang) });
            empty.addClass('sch-static-style-85');
        }

        // NOW 指示线（每分钟更新）
        const nowLine = col.createDiv();
        nowLine.addClass('sch-static-style-86');
        const nowPill = nowLine.createSpan();
        nowPill.addClass('sch-static-style-87');
        const updateNow = () => {
            const n = new Date();
            const frac = (n.getHours() - startHour) + n.getMinutes() / 60;
            if (frac < 0 || frac > hourCount) { nowLine.addClass('sch-static-style-63'); return; }
            nowLine.addClass('sch-static-style-88');
            nowLine.setCssStyles({ top: (frac * ROW_H - 1) + 'px' });
            nowPill.setText(`${t('now', lang)} ${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`);
        };
        updateNow();
        this.todayTimer = this.plugin.registerInterval(window.setInterval(updateNow, 30000));

        // 撑高
        const spacer = col.createDiv();
        spacer.setCssStyles({ height: (hourCount * ROW_H) + 'px' });
    }

    // 点击时间块事件 → 编辑（重设计：已添加的任务可修改）
    private openTimeBlockEditor(id: string): void {
        const block = this.data.timeblocks.find(b => b.id === id);
        if (!block) return;
        new TimeBlockEditModal(
            this.app, block, this.plugin.settings.language,
            async () => { await this.save(); this.rerender(); },
            async () => { this.data.timeblocks = this.data.timeblocks.filter(b => b.id !== id); await this.save(); this.rerender(); },
        ).open();
    }

    private renderRangeTimeline(host: HTMLElement, range: TimelineRange, lang: 'zh' | 'en') {
        if (range === 'week') {
            this.renderWeekCalendar(host, lang);
            return;
        }
        if (range === 'month') {
            this.renderMonthCalendar(host, lang);
            return;
        }
        const dates = this.getTimelineDates(range);
        const wrap = host.createDiv();
        wrap.addClass('sch-static-style-89');
        for (const date of dates) {
            const blocks = this.data.timeblocks.filter(b => b.date === date).sort((a, b) => a.startTime.localeCompare(b.startTime));
            const sessions = this.data.focus.sessions.filter(s => s.date === date).sort((a, b) => a.start.localeCompare(b.start));
            const day = wrap.createDiv();
            day.addClass('sch-static-style-90');
            const head = day.createDiv();
            head.addClass('sch-static-style-91');
            const title = head.createDiv({ text: this.formatTimelineDate(date, lang) });
            title.addClass('sch-static-style-92');
            pill(head, String(blocks.length + sessions.length), blocks.length + sessions.length ? 'accent' : 'mute');
            if (!blocks.length && !sessions.length) {
                const empty = day.createDiv({ text: lang === 'zh' ? '暂无安排' : 'No schedule' });
                empty.addClass('sch-static-style-93');
                continue;
            }
            const list = day.createDiv();
            list.addClass('sch-static-style-94');
            for (const b of blocks) this.renderTimelineMiniItem(list, `${b.startTime}-${b.endTime}`, b.title, b.category || 'task', b.note);
            for (const s of sessions) this.renderTimelineMiniItem(list, `${s.start}-${s.end}`, s.title, lang === 'zh' ? '专注' : 'Focus', `${s.minutes}m`);
        }
        if (!wrap.childElementCount) {
            const empty = wrap.createDiv({ text: lang === 'zh' ? '这个范围还没有日程安排' : 'No schedule in this range' });
            empty.addClass('sch-static-style-95');
        }
    }

    private renderWeekCalendar(host: HTMLElement, lang: 'zh' | 'en') {
        const dates = this.getTimelineDates('week');
        const ROW_H = 54;
        const startHour = 1;
        const endHour = 22;
        const hours = endHour - startHour + 1;
        const wrap = host.createDiv();
        wrap.addClass('sch-static-style-96');

        const head = wrap.createDiv();
        head.addClass('sch-static-style-97');
        const tz = head.createDiv({ text: 'GMT+8' });
        tz.addClass('sch-static-style-98');
        for (const date of dates) {
            const d = new Date(date + 'T00:00:00');
            const cell = head.createDiv();
            cell.addClass('sch-static-style-99');
            const week = cell.createDiv({ text: this.weekdayLabel(d, lang) });
            week.setCssStyles({ fontSize: '12px', color: date === today() ? 'var(--sch-accent-ink)' : 'var(--sch-mute)', fontWeight: '700' });
            const num = cell.createDiv({ text: String(d.getDate()) });
            num.setCssStyles({ fontSize: '20px', color: date === today() ? 'var(--sch-accent-ink)' : 'var(--sch-ink2)', fontWeight: '700', lineHeight: '1.1' });
        }

        const grid = wrap.createDiv();
        grid.addClass('sch-static-style-100');
        const rail = grid.createDiv();
        for (let h = startHour; h <= endHour; h++) {
            const r = rail.createDiv();
            r.setCssStyles({ height: ROW_H + 'px', borderTop: '1px solid var(--sch-line-soft)', position: 'relative' });
            const label = r.createSpan({ text: String(h).padStart(2, '0') + ':00' });
            label.addClass('sch-static-style-101');
        }
        for (const date of dates) {
            const col = grid.createDiv();
            col.addClass('sch-static-style-102');
            for (let h = startHour; h <= endHour; h++) {
                const row = col.createDiv();
                row.setCssStyles({ height: ROW_H + 'px', borderTop: '1px solid var(--sch-line-soft)' });
            }
            this.renderCalendarDayEvents(col, date, startHour, ROW_H);
        }
        if (dates.includes(today())) this.renderCalendarNowLine(grid, startHour, ROW_H, hours, dates.indexOf(today()));
    }

    private renderMonthCalendar(host: HTMLElement, lang: 'zh' | 'en') {
        const base = new Date(today() + 'T00:00:00');
        const year = base.getFullYear();
        const month = base.getMonth();
        const first = new Date(year, month, 1);
        const mondayOffset = (first.getDay() + 6) % 7;
        const start = new Date(first);
        start.setDate(first.getDate() - mondayOffset);
        const wrap = host.createDiv();
        wrap.addClass('sch-static-style-103');
        const weekHead = wrap.createDiv();
        weekHead.addClass('sch-static-style-104');
        for (let i = 0; i < 7; i++) {
            const h = weekHead.createDiv({ text: this.weekdayLabel(new Date(2026, 0, 5 + i), lang) });
            h.addClass('sch-static-style-105');
        }
        const grid = wrap.createDiv();
        grid.addClass('sch-static-style-106');
        for (let i = 0; i < 42; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const date = d.toISOString().split('T')[0]!;
            const cell = grid.createDiv();
            cell.setCssStyles({
                minHeight: '112px',
                padding: '8px',
                borderLeft: i % 7 === 0 ? '0' : '1px solid var(--sch-line-soft)',
                borderTop: i < 7 ? '0' : '1px solid var(--sch-line-soft)',
                background: d.getMonth() === month ? 'var(--sch-surface)' : 'var(--sch-surface2)',
            });
            const dayNum = cell.createDiv({ text: d.getDate() === 1 ? `${d.getMonth() + 1}月${d.getDate()}日` : String(d.getDate()) });
            dayNum.setCssStyles({
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '22px',
                height: '22px',
                borderRadius: '999px',
                padding: '0 6px',
                color: date === today() ? 'var(--sch-bg)' : d.getMonth() === month ? 'var(--sch-ink)' : 'var(--sch-mute)',
                background: date === today() ? 'var(--sch-accent)' : 'transparent',
                fontWeight: '700',
            });
            const items = cell.createDiv();
            items.addClass('sch-static-style-107');
            const blocks = this.data.timeblocks.filter(b => b.date === date).sort((a, b) => a.startTime.localeCompare(b.startTime));
            const sessions = this.data.focus.sessions.filter(s => s.date === date).sort((a, b) => a.start.localeCompare(b.start));
            for (const b of blocks.slice(0, 3)) this.renderMonthEvent(items, b.title);
            for (const s of sessions.slice(0, Math.max(0, 3 - blocks.length))) this.renderMonthEvent(items, s.title);
            const more = blocks.length + sessions.length - items.childElementCount;
            if (more > 0) {
                const m = items.createDiv({ text: `+ ${more}` });
                m.addClass('sch-static-style-108');
            }
        }
    }

    private renderCalendarDayEvents(col: HTMLElement, date: string, startHour: number, rowH: number) {
        const events = [
            ...this.data.timeblocks.filter(b => b.date === date).map(b => ({ start: b.startTime, end: b.endTime, title: b.title })),
            ...this.data.focus.sessions.filter(s => s.date === date).map(s => ({ start: s.start, end: s.end, title: s.title })),
        ].sort((a, b) => a.start.localeCompare(b.start));
        for (const ev of events) {
            const sh = parseInt(ev.start.slice(0, 2), 10);
            const sm = parseInt(ev.start.slice(3, 5), 10) || 0;
            const eh = parseInt(ev.end.slice(0, 2), 10);
            const em = parseInt(ev.end.slice(3, 5), 10) || 0;
            const top = ((sh - startHour) + sm / 60) * rowH;
            const height = Math.max(((eh - sh) + (em - sm) / 60) * rowH, 26);
            const item = col.createDiv({ text: ev.title });
            item.setCssStyles({
                position: 'absolute',
                left: '6px',
                right: '6px',
                top: top + 'px',
                height: height + 'px',
                borderRadius: '7px',
                borderLeft: '3px solid var(--sch-accent)',
                background: 'var(--sch-accent-soft)',
                color: 'var(--sch-accent-ink)',
                padding: '4px 7px',
                fontSize: '12px',
                fontWeight: '700',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                zIndex: '2',
            });
            item.title = `${ev.start}-${ev.end} ${ev.title}`;
        }
    }

    private renderCalendarNowLine(grid: HTMLElement, startHour: number, rowH: number, hours: number, dayIndex: number) {
        const line = grid.createDiv();
        line.addClass('sch-static-style-109');
        const dot = line.createSpan();
        dot.setCssStyles({ position: 'absolute', left: `calc(${dayIndex * 100 / 7}% - 5px)`, top: '-4px', width: '10px', height: '10px', borderRadius: '50%', background: 'var(--sch-accent)' });
        const label = line.createSpan();
        label.addClass('sch-static-style-110');
        const update = () => {
            const n = new Date();
            const frac = (n.getHours() - startHour) + n.getMinutes() / 60;
            if (frac < 0 || frac > hours) { line.addClass('sch-static-style-63'); return; }
            line.addClass('sch-static-style-88');
            line.setCssStyles({ top: (frac * rowH) + 'px' });
            label.setText(`${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`);
        };
        update();
        this.todayTimer = this.plugin.registerInterval(window.setInterval(update, 30000));
    }

    private renderMonthEvent(host: HTMLElement, title: string) {
        const item = host.createDiv({ text: title });
        item.addClass('sch-static-style-111');
    }

    private weekdayLabel(d: Date, lang: 'zh' | 'en'): string {
        const zh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const en = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return lang === 'zh' ? zh[d.getDay()]! : en[d.getDay()]!;
    }

    private renderTimelineMiniItem(host: HTMLElement, time: string, title: string, category: string, note?: string) {
        const item = host.createDiv();
        item.addClass('sch-static-style-112');
        const top = item.createDiv({ text: time });
        top.addClass('sch-static-style-113');
        const ttl = item.createDiv({ text: title });
        ttl.addClass('sch-static-style-114');
        const meta = item.createDiv({ text: note ? `${category} · ${note}` : category });
        meta.addClass('sch-static-style-115');
    }

    private getTimelineDates(range: TimelineRange): string[] {
        const base = new Date(today() + 'T00:00:00');
        const dates: string[] = [];
        if (range === 'week') {
            const monday = new Date(base);
            const day = monday.getDay() || 7;
            monday.setDate(monday.getDate() - day + 1);
            for (let i = 0; i < 7; i++) {
                const d = new Date(monday);
                d.setDate(monday.getDate() + i);
                dates.push(d.toISOString().split('T')[0]!);
            }
            return dates;
        }
        const year = base.getFullYear();
        const month = base.getMonth();
        for (let d = 1; d <= getMonthDays(year, month); d++) {
            dates.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
        }
        return dates;
    }

    private formatTimelineDate(date: string, lang: 'zh' | 'en'): string {
        const d = new Date(date + 'T00:00:00');
        const weekZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
        return lang === 'zh' ? `${d.getMonth() + 1}月${d.getDate()}日 · ${weekZh}` : d.toDateString();
    }

    private renderCheckinCard(host: HTMLElement, td: CheckinDay, lang: 'zh' | 'en') {
        const c = uiCard(host);
        const working = !!td.activePeriod;
        const { right } = sectionHeader(c, { eyebrow: t('checkin', lang), title: lang === 'zh' ? '今日打卡' : "Today's check-ins", level: 3 });
        pill(right, working ? t('state_working', lang) : t('state_resting', lang), working ? 'moss' : 'mute');

        const btnRow = c.createDiv();
        btnRow.addClass('sch-static-style-46');
        const inBtn = uiButton(btnRow, { text: t('checkin_in', lang), iconName: 'play', variant: working ? 'soft' : 'primary', style: { flex: '1' } });
        const outBtn = uiButton(btnRow, { text: t('checkin_out', lang), iconName: 'stop', variant: working ? 'primary' : 'soft', style: { flex: '1' } });
        inBtn.addEventListener('click', async () => {
            if (td.activePeriod) { new Notice(lang === 'zh' ? '已在岗，请先离开' : 'Already checked in'); return; }
            const hr = new Date().getHours();
            const period: 'morning' | 'afternoon' | 'evening' = hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening';
            td.activePeriod = { period, since: nowHHMM() };
            await this.save(); this.rerender();
        });
        outBtn.addEventListener('click', async () => {
            if (!td.activePeriod) { new Notice(lang === 'zh' ? '当前不在岗' : 'Not checked in'); return; }
            td[td.activePeriod.period].push({ start: td.activePeriod.since, end: nowHHMM() });
            td.activePeriod = null;
            await this.save(); this.rerender();
        });

        // 今日工作汇总
        const inset = insetBlock(c, { style: { marginTop: '10px' } });
        const totalMin = (['morning', 'afternoon', 'evening'] as const).reduce((sum, pk) => sum + td[pk].reduce((s, r) => s + diffMin(r.start, r.end), 0), 0)
            + (td.activePeriod ? diffMin(td.activePeriod.since, nowHHMM()) : 0);
        const row1 = inset.createDiv();
        row1.addClass('sch-static-style-116');
        const lbl = row1.createSpan({ text: lang === 'zh' ? '今日在岗' : "Today's work" });
        lbl.addClass('sch-static-style-117');
        const valEl = row1.createSpan({ text: `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` });
        valEl.addClass('sch-static-style-118');
        const tokens = inset.createDiv();
        tokens.addClass('sch-static-style-119');
        const segs: string[] = [];
        (['morning', 'afternoon', 'evening'] as const).forEach(pk => td[pk].forEach(r => { segs.push(`${r.start}→`); segs.push(r.end); }));
        if (td.activePeriod) { segs.push(`${td.activePeriod.since}→`); segs.push('···'); }
        for (const tk of segs.slice(0, 8)) {
            const s = tokens.createSpan({ text: tk });
            s.addClass('sch-static-style-120');
        }
        if (segs.length === 0) tokens.createSpan({ text: lang === 'zh' ? '尚未打卡' : 'No check-ins yet' }).addClass('sch-static-style-121');
    }

    private renderFocusTimerCard(host: HTMLElement, lang: 'zh' | 'en') {
        const c = uiCard(host);
        const active = this.data.focus.active;
        const { right } = sectionHeader(c, { eyebrow: t('focus_timer', lang), title: lang === 'zh' ? '专注计时' : 'Pomodoro', level: 3 });
        pill(right, active ? (lang === 'zh' ? '进行中' : 'Running') : (lang === 'zh' ? '空闲' : 'Idle'), active ? 'accent' : 'mute');

        const disp = c.createDiv();
        disp.setCssStyles({ textAlign: 'center', padding: '14px 0', fontFamily: 'var(--sch-font-mono)', fontSize: '38px', fontWeight: '500', color: active ? 'var(--sch-accent-ink)' : 'var(--sch-ink)', letterSpacing: '0' });
        this.focusDisplayEl = disp;
        this.updateTimerDisplay();
        if (active) this.focusTimer = this.plugin.registerInterval(window.setInterval(() => this.updateTimerDisplay(), 1000));

        const { input: titleInput } = uiInput(c, { placeholder: t('focus_title_ph', lang), iconName: 'bolt', size: 'sm' });
        if (active) titleInput.value = active.title;

        const btnRow = c.createDiv();
        btnRow.addClass('sch-static-style-122');
        if (!active) {
            const startBtn = uiButton(btnRow, { text: t('start', lang), iconName: 'play', variant: 'primary', style: { flex: '1' } });
            startBtn.addEventListener('click', async () => {
                this.data.focus.active = { id: uid(), title: titleInput.value.trim() || (lang === 'zh' ? '专注记录' : 'Focus'), startTs: Date.now() };
                await this.save(); this.rerender();
            });
        } else {
            const stopBtn = uiButton(btnRow, { text: t('stop', lang), iconName: 'stop', variant: 'primary', style: { flex: '1' } });
            stopBtn.addEventListener('click', async () => {
                const a = this.data.focus.active; if (!a) return;
                const minutes = Math.round((Date.now() - a.startTs) / 60000);
                this.data.focus.sessions.push({ id: a.id, date: today(), title: a.title, start: new Date(a.startTs).toTimeString().slice(0, 5), end: nowHHMM(), minutes, taskId: a.taskId });
                this.data.focus.active = null;
                await this.save(); this.rerender();
                new Notice(`✅ ${a.title}（${minutes}m）`);
            });
        }
    }

    private renderAIScheduleCard(host: HTMLElement, lang: 'zh' | 'en') {
        const c = uiCard(host);
        sectionHeader(c, { eyebrow: lang === 'zh' ? 'AI 日程助手' : 'AI planner', title: lang === 'zh' ? '规划今日任务' : 'Plan schedule', level: 3 });
        const ta = c.createEl('textarea');
        ta.addClass('sch-static-style-123');
        ta.placeholder = lang === 'zh'
            ? '例如：9:00-10:30 看文献，10:45-12:00 写实验方案，下午做 HPLC 数据。'
            : 'Example: 9:00-10:30 read papers, 10:45-12:00 draft protocol.';
        const hint = c.createDiv({ text: lang === 'zh' ? '会写入时间块，并显示在中间时间轴。写“覆盖今日”会替换今天已有日程。' : 'Saved as time blocks and shown in the center timeline. Include "replace today" to overwrite today.' });
        hint.addClass('sch-static-style-124');
        const btnRow = c.createDiv();
        btnRow.addClass('sch-static-style-125');
        const planBtn = uiButton(btnRow, { text: lang === 'zh' ? 'AI 规划并加入' : 'Plan and add', iconName: 'sparkle', variant: 'primary', style: { flex: '1' } });
        const clearBtn = uiButton(btnRow, { text: lang === 'zh' ? '清空今日' : 'Clear today', variant: 'soft' });
        planBtn.addEventListener('click', async () => {
            const text = ta.value.trim();
            if (!text) { new Notice(lang === 'zh' ? '先写下你的日程想法' : 'Write a schedule first'); return; }
            planBtn.setText(lang === 'zh' ? '规划中...' : 'Planning...');
            try {
                const blocks = await this.planScheduleWithAI(text);
                const replace = /覆盖|替换|重新安排|清空|replace|overwrite/i.test(text);
                this.applyScheduleBlocks(blocks, replace);
                await this.save();
                new Notice(lang === 'zh' ? `已加入 ${blocks.length} 个时间块` : `Added ${blocks.length} blocks`);
                this.rerender();
            } catch (e) {
                new Notice((lang === 'zh' ? 'AI 日程规划失败：' : 'Planning failed: ') + (e as Error).message);
            }
        });
        clearBtn.addEventListener('click', async () => {
            this.data.timeblocks = this.data.timeblocks.filter(b => b.date !== today());
            await this.save();
            this.rerender();
        });
    }

    private async planScheduleWithAI(text: string): Promise<AIScheduleBlock[]> {
        const { aiProvider, aiApiKey, aiModel, aiCustomEndpoint, aiTemperature } = this.plugin.settings;
        if (!aiApiKey) return this.parseScheduleLocally(text);
        const existing = this.data.timeblocks.filter(b => b.date === today())
            .sort((a, b) => a.startTime.localeCompare(b.startTime))
            .map(b => `${b.startTime}-${b.endTime} ${b.title} [${b.category}]`).join('\n') || '(none)';
        const system = `You are a schedule planner inside an Obsidian research workspace.
Return ONLY JSON: {"blocks":[{"date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","category":"work|study|experiment|writing|meeting|rest|admin","title":"short task title","note":"optional"}]}.
Rules:
- Use today's date ${today()} unless the user explicitly says another date.
- Preserve the user's intended times. If an end time is missing, choose a reasonable 45-90 minute block.
- Split separate tasks into separate blocks.
- Keep titles concrete and short.
- Existing schedule today:
${existing}`;
        const raw = await this.scheduleProviderCall(aiProvider, aiApiKey, aiModel, aiCustomEndpoint, aiTemperature, system, text);
        const json = raw.match(/\{[\s\S]*\}/)?.[0];
        if (!json) throw new Error('AI 没有返回日程 JSON');
        const parsed = safeParseJson<{ blocks?: AIScheduleBlock[] }>(json, 'schedule planning');
        if (!parsed) throw new Error('AI 返回的日程格式无法解析');
        const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
        return this.normalizeScheduleBlocks(blocks.length ? blocks : this.parseScheduleLocally(text));
    }

    private parseScheduleLocally(text: string): AIScheduleBlock[] {
        const blocks: AIScheduleBlock[] = [];
        const re = /(\d{1,2})[:：点](\d{0,2})\s*(?:[-~到至—–]\s*(\d{1,2})[:：点]?(\d{0,2})?)?\s*([^，,；;\n]+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const sh = Number(m[1]);
            const sm = m[2] ? Number(m[2]) : 0;
            const eh = m[3] ? Number(m[3]) : sh + 1;
            const em = m[4] ? Number(m[4]) : sm;
            const title = (m[5] || '').replace(/^(干|做|进行|安排)/, '').trim() || '日程安排';
            blocks.push({ date: today(), startTime: this.hhmm(sh, sm), endTime: this.hhmm(eh, em), category: this.inferScheduleCategory(title), title, note: '' });
        }
        return this.normalizeScheduleBlocks(blocks);
    }

    private normalizeScheduleBlocks(blocks: AIScheduleBlock[]): AIScheduleBlock[] {
        return blocks
            .map(b => ({
                date: b.date || today(),
                startTime: this.normalizeHHMM(b.startTime),
                endTime: this.normalizeHHMM(b.endTime),
                category: this.inferScheduleCategory(b.category || b.title),
                title: (b.title || '日程安排').trim().slice(0, 40),
                note: (b.note || '').trim().slice(0, 120),
            }))
            .filter(b => b.startTime && b.endTime && b.startTime < b.endTime)
            .slice(0, 16);
    }

    private applyScheduleBlocks(blocks: AIScheduleBlock[], replaceToday: boolean) {
        if (replaceToday) this.data.timeblocks = this.data.timeblocks.filter(b => b.date !== today());
        for (const b of blocks) {
            const date = b.date || today();
            this.data.timeblocks = this.data.timeblocks.filter(x => !(x.date === date && x.startTime === b.startTime && x.endTime === b.endTime));
            this.data.timeblocks.push({
                id: uid(),
                date,
                startTime: b.startTime,
                endTime: b.endTime,
                category: b.category || 'work',
                title: b.title,
                note: b.note || '',
            });
        }
    }

    private inferScheduleCategory(text: string): string {
        if (/实验|hplc|合成|测试|表征|experiment/i.test(text)) return 'experiment';
        if (/写|论文|投稿|draft|writing/i.test(text)) return 'writing';
        if (/文献|阅读|学习|read|study/i.test(text)) return 'study';
        if (/会|讨论|组会|meeting/i.test(text)) return 'meeting';
        if (/休息|吃饭|午休|rest|meal/i.test(text)) return 'rest';
        return 'work';
    }

    private normalizeHHMM(value: string): string {
        const m = String(value || '').match(/(\d{1,2})[:：]?(\d{0,2})/);
        if (!m) return '';
        return this.hhmm(Number(m[1]), m[2] ? Number(m[2]) : 0);
    }

    private hhmm(hour: number, minute: number): string {
        const h = Math.min(23, Math.max(0, hour));
        const m = Math.min(59, Math.max(0, minute));
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    private async scheduleProviderCall(provider: AIProvider, apiKey: string, model: string, customEndpoint: string, temp: number, system: string, user: string): Promise<string> {
        if (provider === 'claude') {
            const res = await requestUrlWithTimeout({
                url: 'https://api.anthropic.com/v1/messages',
                method: 'POST',
                headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
                body: JSON.stringify({ model: model || 'claude-sonnet-4-6', max_tokens: 1200, temperature: temp, system, messages: [{ role: 'user', content: user }] }),
            });
            if (res.status < 200 || res.status >= 300) throw new Error(`Claude ${res.status}`);
            const d = res.json as { content: Array<{ type: string; text: string }> };
            return d.content.find(x => x.type === 'text')?.text ?? '';
        }
        const cfg = PROVIDER_CONFIG[provider];
        const endpoint = provider === 'custom' ? customEndpoint : cfg.endpoint;
        if (!endpoint) throw new Error('缺少 API 端点');
        const res = await requestUrlWithTimeout({
            url: endpoint,
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ model: model || cfg.defaultModel, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1200, temperature: temp }),
        });
        if (res.status < 200 || res.status >= 300) throw new Error(`${cfg.label} ${res.status}`);
        const d = res.json as { choices: Array<{ message: { content: string } }> };
        return d.choices[0]?.message?.content ?? '';
    }

    private renderQuickCaptureCard(host: HTMLElement, lang: 'zh' | 'en') {
        const c = uiCard(host);
        sectionHeader(c, { eyebrow: t('quick_capture', lang), title: lang === 'zh' ? '随手捕获' : 'Quick capture', level: 3 });
        let selectedKind: CaptureKind = 'idea';
        const types: Array<{ kind: CaptureKind; zh: string; en: string; tone: string }> = [
            { kind: 'task', zh: '任务', en: 'Task', tone: 'var(--sch-surface2)' },
            { kind: 'idea', zh: '想法', en: 'Idea', tone: 'var(--sch-sun-bg)' },
            { kind: 'contact', zh: '联系人', en: 'Contact', tone: 'var(--sch-sky-bg)' },
            { kind: 'experiment', zh: '实验', en: 'Experiment', tone: 'var(--sch-moss-bg)' },
        ];
        const chooser = c.createDiv();
        chooser.addClass('sch-static-style-126');
        const typeButtons = new Map<CaptureKind, HTMLButtonElement>();
        const refreshTypeButtons = () => {
            for (const type of types) {
                const btn = typeButtons.get(type.kind);
                if (!btn) continue;
                const selected = type.kind === selectedKind;
                btn.setCssStyles({ background: selected ? type.tone : 'transparent' });
                btn.setCssStyles({ borderColor: selected ? 'var(--sch-accent)' : 'var(--sch-line)' });
                btn.setCssStyles({ color: selected ? 'var(--sch-ink)' : 'var(--sch-mute)' });
                btn.setAttribute('aria-pressed', String(selected));
            }
        };
        for (const type of types) {
            const label = lang === 'zh' ? type.zh : type.en;
            const btn = chooser.createEl('button', { text: label, attr: { type: 'button', 'aria-label': label } });
            btn.addClass('sch-static-style-127');
            typeButtons.set(type.kind, btn);
            btn.addEventListener('click', () => {
                selectedKind = type.kind;
                refreshTypeButtons();
                capInput.placeholder = lang === 'zh' ? `记录${type.zh}，按回车保存` : `Write a ${type.en.toLowerCase()}, press Enter to save`;
                capInput.focus();
            });
        }
        refreshTypeButtons();
        const { input: capInput } = uiInput(c, { placeholder: lang === 'zh' ? '记录想法，按回车保存' : 'Write an idea, press Enter to save', iconName: 'plus' });
        capInput.addEventListener('keydown', async (e) => {
            if (e.key !== 'Enter') return;
            const content = capInput.value.trim();
            if (!content) return;
            this.data.captures.push({ id: uid(), kind: selectedKind, content, date: today(), time: nowHHMM() });
            if (selectedKind === 'task') {
                this.data.tasks.push({ id: uid(), title: content, status: 'active', createdAt: today() });
            }
            capInput.value = '';
            await this.save();
            this.rerender();
        });
        const hint = c.createDiv({ text: lang === 'zh' ? '保存在工作台数据中；任务会同步加入今日任务。' : 'Saved in workspace data; tasks also appear in today tasks.' });
        hint.addClass('sch-static-style-128');
    }

    private renderIdeaCalendarCard(host: HTMLElement, lang: 'zh' | 'en') {
        const c = uiCard(host);
        const ideas = this.data.captures.filter(entry => entry.kind === 'idea').sort((a, b) =>
            `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)
        );
        const { right } = sectionHeader(c, { eyebrow: lang === 'zh' ? '想法日历' : 'Idea calendar', title: lang === 'zh' ? '按日期回看' : 'By date', level: 3 });
        pill(right, String(ideas.length), 'sun');
        if (!ideas.length) {
            const empty = c.createDiv({ text: lang === 'zh' ? '选择“想法”并保存后，会在这里按日期归档。' : 'Ideas saved in quick capture appear here by date.' });
            empty.addClass('sch-static-style-129');
            return;
        }
        const grouped = new Map<string, QuickCapture[]>();
        for (const idea of ideas) {
            const day = grouped.get(idea.date) ?? [];
            day.push(idea);
            grouped.set(idea.date, day);
        }
        const calendar = c.createDiv();
        calendar.addClass('sch-static-style-89');
        for (const [date, entries] of Array.from(grouped.entries()).slice(0, 7)) {
            const day = calendar.createDiv();
            day.addClass('sch-static-style-130');
            const d = new Date(date + 'T00:00:00');
            const stamp = day.createDiv();
            const dateNum = stamp.createDiv({ text: String(d.getDate()).padStart(2, '0') });
            dateNum.addClass('sch-static-style-131');
            const month = stamp.createDiv({ text: lang === 'zh' ? `${d.getMonth() + 1} 月` : d.toLocaleDateString('en', { month: 'short' }) });
            month.addClass('sch-static-style-132');
            const notes = day.createDiv();
            notes.addClass('sch-static-style-133');
            for (const entry of entries) {
                const item = notes.createDiv();
                item.addClass('sch-static-style-134');
                const content = item.createDiv({ text: entry.content });
                content.addClass('sch-static-style-135');
                const time = item.createDiv({ text: entry.time });
                time.addClass('sch-static-style-136');
            }
        }
    }

    private renderTodaysTasksCard(host: HTMLElement, activeTasks: Task[], lang: 'zh' | 'en') {
        const c = uiCard(host);
        const { right } = sectionHeader(c, { eyebrow: t('todays_tasks', lang), title: lang === 'zh' ? '锁定的任务' : 'Locked in', level: 3 });
        pill(right, String(activeTasks.length), 'accent');
        const list = c.createDiv();
        list.addClass('sch-static-style-137');
        if (activeTasks.length === 0) {
            const e = list.createDiv({ text: lang === 'zh' ? '今天还没有锁定任务' : 'No tasks locked in' });
            e.addClass('sch-static-style-138');
            return;
        }
        for (const task of activeTasks.slice(0, 6)) {
            const item = list.createDiv();
            item.addClass('sch-static-style-139');
            const cb = item.createDiv();
            cb.addClass('sch-static-style-140');
            cb.addEventListener('click', async () => {
                task.status = 'done'; task.completedAt = today();
                await this.save(); this.rerender();
            });
            const ttl = item.createDiv({ text: task.title });
            ttl.addClass('sch-static-style-141');
            const d = item.createSpan({ text: task.createdAt });
            d.addClass('sch-static-style-142');
        }
    }

    // ════════════════════════════════
    // 总览首页
    // ════════════════════════════════
    private renderOverview(el: HTMLElement) {
        const wrap = el.createDiv({ cls: 'ws2-overview' });

        const todayFocus = this.data.focus.sessions.filter(s => s.date === today()).reduce((s, r) => s + r.minutes, 0);
        const activeTasks = this.data.tasks.filter(t => t.status === 'active').length;
        const activeSubmissions = this.data.submissions.filter(s => !['已接收','搁置/拒稿'].includes(s.stage)).length;
        const todayEmotion = this.data.emotions[today()];

        const overviewHead = wrap.createDiv({ cls: 'ws2-overview-head' });
        overviewHead.createEl('div', { text: '今日概况', cls: 'ws2-overview-kicker' });
        overviewHead.createEl('h3', { text: '把今天需要看的东西放在一屏里', cls: 'ws2-overview-title' });

        const cards = [
            { emoji: '✅', title: '进行中任务', value: String(activeTasks), hint: '正在推进' },
            { emoji: '🎯', title: '今日专注', value: `${todayFocus} min`, hint: '已记录时长' },
            { emoji: '📝', title: '投稿进行中', value: String(activeSubmissions), hint: '点击查看详情' },
            { emoji: '😊', title: '今日状态', value: todayEmotion?.emoji || '—', hint: todayEmotion?.text || '尚未记录' },
        ];

        const cardGrid = wrap.createDiv({ cls: 'ws2-card-grid' });
        for (const card of cards) {
            const div = cardGrid.createDiv({ cls: 'ws2-summary-card' });
            div.createEl('div', { text: card.emoji, cls: 'ws2-card-emoji' });
            div.createEl('div', { text: card.title, cls: 'ws2-card-title' });
            div.createEl('div', { text: card.value, cls: 'ws2-card-value' });
            div.createEl('div', { text: card.hint, cls: 'ws2-card-hint' });
        }

        this.renderWeekAllocation(wrap);

        const section = wrap.createDiv({ cls: 'ws2-card ws2-quick-card' });
        section.createEl('h4', { text: '快速跳转', cls: 'ws2-sub-title' });
        const links: Array<[string, string, string]> = [
            ['⏰', '今日打卡', '起居与考勤'],
            ['🎯', '开始专注', '专注与任务'],
            ['✈️', '投稿管理', '投稿管理'],
            ['📊', '数据看板', '数据看板'],
        ];
        const linkRow = section.createDiv({ cls: 'ws2-quick-links-row' });
        for (const [icon, label, page] of links) {
            const btn = linkRow.createEl('button', { text: `${icon} ${label}`, cls: 'ws2-btn' });
            btn.onclick = () => { this.activePage = page as typeof this.activePage; this.rerender(); };
        }
    }

    private renderWeekAllocation(el: HTMLElement) {
        const card = el.createDiv({ cls: 'ws2-card ws2-stack-chart-card' });
        card.createEl('h4', { text: '本周时间分配', cls: 'ws2-sub-title' });

        const now = new Date();
        const day = now.getDay();
        const toMonday = day === 0 ? -6 : (1 - day);
        const monday = new Date(now);
        monday.setDate(now.getDate() + toMonday);

        const categories = [
            { key: '专注学习', color: '#cfe7d6' },
            { key: '预备阅读', color: '#d5e6f7' },
            { key: '娱乐休息', color: '#f5e8bf' },
            { key: '运动健身', color: '#f1d1cf' },
            { key: '社交会议', color: '#f4d9ca' },
            { key: '其他', color: '#dfe9e2' },
        ];

        const normalizeCategory = (value: string): string => {
            if (/专注|学习|写作|实验/.test(value)) return '专注学习';
            if (/阅读|预备|文献/.test(value)) return '预备阅读';
            if (/娱乐|休息|睡眠/.test(value)) return '娱乐休息';
            if (/运动|健身/.test(value)) return '运动健身';
            if (/社交|会议|讨论|组会/.test(value)) return '社交会议';
            return '其他';
        };

        const labels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
        const weekDates: string[] = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            weekDates.push(d.toISOString().split('T')[0]!);
        }

        for (let i = 0; i < 7; i++) {
            const dateStr = weekDates[i]!;
            const blocks = this.data.timeblocks.filter(b => b.date === dateStr);
            const totals = new Map<string, number>();
            for (const block of blocks) {
                const minutes = diffMin(block.startTime, block.endTime);
                const cat = normalizeCategory(block.category || block.title || '');
                totals.set(cat, (totals.get(cat) || 0) + minutes);
            }
            const dayTotal = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);

            const row = card.createDiv({ cls: `ws2-stack-row${dateStr === today() ? ' ws2-stack-today' : ''}` });
            row.createEl('div', { text: labels[i]!, cls: 'ws2-stack-day-label' });
            const bar = row.createDiv({ cls: 'ws2-stack-bar-wrap' });
            if (dayTotal > 0) {
                for (const cat of categories) {
                    const value = totals.get(cat.key) || 0;
                    if (value <= 0) continue;
                    const seg = bar.createDiv({ cls: 'ws2-stack-seg' });
                    seg.setCssStyles({ width: `${Math.max(4, value / dayTotal * 100)}%` });
                    seg.setCssStyles({ background: cat.color });
                    seg.title = `${cat.key}: ${value} min`;
                }
            } else {
                bar.createDiv({ cls: 'ws2-stack-empty' });
            }
            row.createEl('div', { text: dayTotal ? `${dayTotal}m` : '–', cls: 'ws2-stack-total' });
        }

        const legend = card.createDiv({ cls: 'ws2-stack-legend' });
        for (const cat of categories) {
            const item = legend.createDiv({ cls: 'ws2-stack-legend-item' });
            const dot = item.createSpan({ cls: 'ws2-stack-legend-dot' });
            dot.setCssStyles({ background: cat.color });
            item.createSpan({ text: cat.key, cls: 'ws2-stack-legend-label' });
        }
    }

    // ════════════════════════════════
    // ★ 公开版「WK 周仪表盘」组件
    // ════════════════════════════════
    private renderWeekDashboard(el: HTMLElement) {
        // ── 日期与周计算 ──
        const now = new Date();
        const day = now.getDay();
        const toMonday = day === 0 ? -6 : (1 - day);
        const monday = new Date(now);
        monday.setDate(now.getDate() + toMonday);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        // ISO 周序号
        const isoWeek = (d: Date): number => {
            const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            let n = t.getUTCDay(); if (n === 0) n = 7;
            t.setUTCDate(t.getUTCDate() + 4 - n);
            const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
            return Math.ceil((((+t - +y0) / 86400000) + 1) / 7);
        };
        const wk = isoWeek(now).toString().padStart(2, '0');
        const todayDate = now.getDate();

        // 问候语
        const hr = now.getHours();
        const greet = hr < 6 ? '深夜好' : hr < 12 ? '早上好' : hr < 14 ? '中午好'
            : hr < 18 ? '下午好' : hr < 22 ? '晚上好' : '夜深了';

        // ── 容器 ──
        const card = el.createDiv({ cls: 'xl-wk-card' });

        // Header
        const head = card.createDiv({ cls: 'xl-wk-header' });
        head.createSpan({ text: `WK${wk}`, cls: 'xl-wk-num' });
        const cn = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
        head.createSpan({ text: `${cn(monday)} – ${cn(sunday)}`, cls: 'xl-wk-range' });
        head.createSpan({ text: `${greet} · 今天是 ${todayDate} 号`, cls: 'xl-wk-greet' });

        // Day grid
        const grid = card.createDiv({ cls: 'xl-wk-grid' });
        const labels = ['一', '二', '三', '四', '五', '六', '日'];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            const isToday = d.toDateString() === now.toDateString();
            const isWeekend = i >= 5;
            const dayBox = grid.createDiv({ cls: 'xl-wk-day' + (isToday ? ' today' : '') + (isWeekend ? ' weekend' : '') });
            dayBox.createSpan({ text: labels[i] || '', cls: 'xl-wk-day-label' });
            dayBox.createDiv({ text: String(d.getDate()), cls: 'xl-wk-day-num' });
        }

        // 进度条：年 / 月 / 周 / 日
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const endOfYear = new Date(now.getFullYear() + 1, 0, 1);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const endOfWeek = new Date(monday); endOfWeek.setDate(monday.getDate() + 7);
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

        const pct = (s: Date, e: Date) =>
            Math.min(100, Math.max(0, ((+now - +s) / (+e - +s)) * 100));

        const progRow = card.createDiv({ cls: 'xl-wk-progress-row' });
        const progressItems: Array<[string, number]> = [
            ['年进度', pct(startOfYear, endOfYear)],
            ['月进度', pct(startOfMonth, endOfMonth)],
            ['周进度', pct(monday, endOfWeek)],
            ['日进度', pct(startOfDay, endOfDay)],
        ];
        for (const [label, p] of progressItems) {
            const item = progRow.createDiv({ cls: 'xl-wk-prog' });
            const head = item.createDiv({ cls: 'xl-wk-prog-head' });
            head.createSpan({ text: label });
            head.createSpan({ text: `${p.toFixed(1)}%`, cls: 'xl-wk-prog-pct' });
            const bar = item.createDiv({ cls: 'xl-wk-prog-bar' });
            const fill = bar.createDiv({ cls: 'xl-wk-prog-fill' });
            fill.setCssStyles({ width: `${p.toFixed(1)}%` });
        }

        // 底部导航：上周 / 本周 / 下周（仅展示，无路由）
        const foot = card.createDiv({ cls: 'xl-wk-foot' });
        foot.createEl('button', { text: '◀ 上周', cls: 'xl-wk-nav' });
        foot.createEl('button', { text: '● 本周', cls: 'xl-wk-nav current' });
        foot.createEl('button', { text: '下周 ▶', cls: 'xl-wk-nav' });
    }

    // ════════════════════════════════
    // 起居与考勤
    // ════════════════════════════════
    private renderCheckin(el: HTMLElement) {
        const td = this.getToday();
        const wrap = el.createDiv({ cls: 'ws2-checkin-container' });

        // 左侧：打卡和时段
        const left = wrap.createDiv({ cls: 'ws2-checkin-left' });

        // 起床/睡觉打卡
        const sleepRow = left.createDiv({ cls: 'ws2-checkin-sleep-row' });
        this.makeWakeSleepCard(sleepRow, '☀️ 起床打卡', '目标 09:00 前', td.wake, async () => {
            td.wake = nowHHMM();
            await this.save();
            this.rerender();
        });
        this.makeWakeSleepCard(sleepRow, '🌙 睡觉打卡', '目标 23:30 前', td.sleep, async () => {
            td.sleep = nowHHMM();
            await this.save();
            this.rerender();
        });

        // 三时段
        const periods: Array<{ key: 'morning' | 'afternoon' | 'evening'; label: string; time: string; accentColor: string }> = [
            { key: 'morning', label: '上午', time: '08:00–12:00', accentColor: '#FF8A65' },
            { key: 'afternoon', label: '下午', time: '14:00–18:00', accentColor: '#7E57C2' },
            { key: 'evening', label: '晚上', time: '19:00–22:00', accentColor: '#5C6BC0' },
        ];

        const periodsRow = left.createDiv({ cls: 'ws2-periods-row' });
        for (const p of periods) {
            const segs = td[p.key];
            const isActive = td.activePeriod?.period === p.key;
            const totalMin = segs.reduce((s, r) => s + diffMin(r.start, r.end), 0);

            const card = periodsRow.createDiv({ cls: 'ws2-period-card' });
            card.setCssProps({ '--accent': p.accentColor });
            card.createEl('div', { text: p.label, cls: 'ws2-period-title' });
            card.createEl('div', { text: p.time, cls: 'ws2-period-time' });

            const btnRow = card.createDiv({ cls: 'ws2-period-btns' });
            const startBtn = btnRow.createEl('button', {
                text: isActive ? '进行中…' : '开始',
                cls: `ws2-btn${isActive ? ' ws2-btn-disabled' : ''}`
            });
            const endBtn = btnRow.createEl('button', {
                text: '结束',
                cls: `ws2-btn ws2-btn-outline${!isActive ? ' ws2-btn-disabled' : ''}`
            });

            startBtn.onclick = async () => {
                if (td.activePeriod) { new Notice('请先结束当前进行中的时段'); return; }
                td.activePeriod = { period: p.key, since: nowHHMM() };
                await this.save();
                this.rerender();
            };
            endBtn.onclick = async () => {
                if (!isActive || !td.activePeriod) return;
                const seg: PeriodRecord = { start: td.activePeriod.since, end: nowHHMM() };
                td[p.key].push(seg);
                td.activePeriod = null;
                await this.save();
                this.rerender();
            };

            card.createEl('div', { text: `累计：${totalMin} 分钟`, cls: 'ws2-period-total' });
            if (segs.length > 0) {
                const recs = card.createDiv({ cls: 'ws2-period-recs' });
                segs.forEach((s, i) => {
                    const row = recs.createDiv({ cls: 'ws2-period-rec-row' });
                    row.createEl('span', { text: `${s.start}–${s.end}（${diffMin(s.start, s.end)}m）` });
                    const del = row.createEl('button', { text: '×', cls: 'ws2-del-btn' });
                    del.onclick = async () => {
                        td[p.key].splice(i, 1);
                        await this.save();
                        this.rerender();
                    };
                });
            }
        }

        // 右侧：日历 + 请假
        const right = wrap.createDiv({ cls: 'ws2-checkin-right' });
        this.renderCalendar(right, this.calendarMonth.year, this.calendarMonth.month);

        const leaveForm = right.createDiv({ cls: 'ws2-card' });
        leaveForm.createEl('h4', { text: '请假管理', cls: 'ws2-card-title' });
        const leaveDate = leaveForm.createEl('input', { cls: 'ws2-input', attr: { type: 'date' } }) as HTMLInputElement;
        const leaveType = leaveForm.createEl('select', { cls: 'ws2-input' }) as HTMLSelectElement;
        ['病假', '事假', '公假'].forEach(t => leaveType.createEl('option', { text: t, attr: { value: t } }));
        const leaveReason = leaveForm.createEl('textarea', { cls: 'ws2-input', attr: { placeholder: '请假原因', rows: '3' } }) as HTMLTextAreaElement;
        const leaveBtn = leaveForm.createEl('button', { text: '提交请假', cls: 'ws2-btn' });
        leaveBtn.onclick = async () => {
            if (!leaveDate.value) { new Notice('请选择请假日期'); return; }
            this.data.leave.push({
                id: uid(),
                date: leaveDate.value,
                type: leaveType.value,
                reason: leaveReason.value
            });
            leaveDate.value = '';
            leaveReason.value = '';
            await this.save();
            this.rerender();
        };
    }

    private renderCalendar(el: HTMLElement, year: number, month: number) {
        const card = el.createDiv({ cls: 'ws2-card ws2-calendar-card' });
        const header = card.createDiv({ cls: 'ws2-calendar-header' });
        const prevBtn = header.createEl('button', { text: '◀', cls: 'ws2-calendar-nav' });
        header.createEl('span', { text: `${year} 年 ${month+1} 月`, cls: 'ws2-calendar-month' });
        const nextBtn = header.createEl('button', { text: '▶', cls: 'ws2-calendar-nav' });

        prevBtn.onclick = () => {
            if (month === 0) { this.calendarMonth.year--; this.calendarMonth.month = 11; }
            else this.calendarMonth.month--;
            this.rerender();
        };
        nextBtn.onclick = () => {
            if (month === 11) { this.calendarMonth.year++; this.calendarMonth.month = 0; }
            else this.calendarMonth.month++;
            this.rerender();
        };

        const daysHeader = card.createDiv({ cls: 'ws2-calendar-days-header' });
        ['日','一','二','三','四','五','六'].forEach(d => daysHeader.createEl('div', { text: d }));

        const days = card.createDiv({ cls: 'ws2-calendar-days' });
        const firstDay = getFirstDayOfMonth(year, month);
        const daysInMonth = getMonthDays(year, month);

        for (let i = 0; i < firstDay; i++) {
            days.createDiv({ cls: 'ws2-calendar-empty' });
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const dayEl = days.createDiv({ cls: 'ws2-calendar-day' });
            dayEl.createEl('span', { text: String(d) });

            // 标记出勤情况
            const checkinData = this.data.checkin[dateStr];
            if (checkinData && (checkinData.wake || checkinData.sleep || checkinData.morning.length > 0)) {
                dayEl.addClass('ws2-calendar-present');
            }
        }
    }

    private makeWakeSleepCard(container: HTMLElement, title: string, hint: string, value: string | undefined, onClick: () => void) {
        const card = container.createDiv({ cls: 'ws2-card ws2-sleep-card' });
        card.createEl('div', { text: title, cls: 'ws2-sleep-title' });
        card.createEl('div', { text: hint, cls: 'ws2-sleep-hint' });
        if (value) {
            card.createEl('div', { text: `✅ ${value}`, cls: 'ws2-sleep-val' });
        } else {
            const btn = card.createEl('button', { text: '打卡', cls: 'ws2-btn' });
            btn.onclick = onClick;
        }
    }

    private renderTimeblockAIHelper(host: HTMLElement) {
        const card = host.createDiv({ cls: 'ws2-card' });
        card.addClass('sch-static-style-143');
        card.createEl('h3', { text: 'AI 日程助手', cls: 'ws2-card-title' });
        const prompt = card.createEl('textarea', {
            cls: 'ws2-input',
            attr: {
                rows: '4',
                placeholder: '写下你的安排，例如：9点到10点看文献，10:30-12:00 合成 TiO2，下午整理数据。输入“覆盖今日”会替换今天已有日程。'
            }
        }) as HTMLTextAreaElement;
        const actions = card.createDiv();
        actions.addClass('sch-static-style-144');
        const addBtn = actions.createEl('button', { text: '生成并加入日程', cls: 'ws2-btn' });
        const replaceBtn = actions.createEl('button', { text: '覆盖今日', cls: 'ws2-btn ws2-btn-outline' });
        const tip = card.createDiv({ text: 'AI 会生成时间块建议；没有 API key 时，也会识别明确的“几点到几点做什么”。' });
        tip.addClass('sch-static-style-145');

        const run = async (replace: boolean) => {
            const text = prompt.value.trim();
            if (!text) { new Notice('先写下你的日程安排'); return; }
            addBtn.setText('生成中...');
            try {
                const blocks = await this.planScheduleWithAI(replace ? `覆盖今日：${text}` : text);
                this.applyScheduleBlocks(blocks, replace);
                await this.save();
                new Notice(`已加入 ${blocks.length} 个时间块`);
                this.rerender();
            } catch (e) {
                new Notice('AI 日程助手失败：' + (e as Error).message);
                addBtn.setText('生成并加入日程');
            }
        };
        addBtn.onclick = () => void run(false);
        replaceBtn.onclick = () => void run(true);
    }

    private getToday(): CheckinDay {
        const d = today();
        if (!this.data.checkin[d]) {
            this.data.checkin[d] = { morning: [], afternoon: [], evening: [], activePeriod: null };
        }
        return this.data.checkin[d]!;
    }

    // ════════════════════════════════
    // 时间块日历
    // ════════════════════════════════
    private renderTimeblock(el: HTMLElement) {
        const wrap = el.createDiv({ cls: 'ws2-timeblock-container' });
        wrap.addClass('sch-static-style-146');

        const left = wrap.createDiv({ cls: 'ws2-timeblock-left' });
        const form = left.createDiv({ cls: 'ws2-card' });
        form.addClass('sch-static-style-147');
        form.createEl('h3', { text: '添加时间块', cls: 'ws2-card-title' });

        const date = form.createEl('input', { cls: 'ws2-input', attr: { type: 'date' } }) as HTMLInputElement;
        date.value = today();

        const startTime = form.createEl('input', { cls: 'ws2-input', attr: { type: 'time' } }) as HTMLInputElement;
        const endTime = form.createEl('input', { cls: 'ws2-input', attr: { type: 'time' } }) as HTMLInputElement;
        const category = form.createEl('select', { cls: 'ws2-input' }) as HTMLSelectElement;
        ['工作', '学习', '休闲', '运动'].forEach(c => category.createEl('option', { text: c, attr: { value: c } }));

        const title = form.createEl('input', { cls: 'ws2-input', attr: { placeholder: '标题' } }) as HTMLInputElement;
        const note = form.createEl('textarea', { cls: 'ws2-input', attr: { placeholder: '备注', rows: '2' } }) as HTMLTextAreaElement;

        const addBtn = form.createEl('button', { text: '添加', cls: 'ws2-btn' });
        addBtn.onclick = async () => {
            if (!date.value || !startTime.value || !endTime.value) { new Notice('请填写日期和时间'); return; }
            this.data.timeblocks.push({
                id: uid(),
                date: date.value,
                startTime: startTime.value,
                endTime: endTime.value,
                category: category.value,
                title: title.value || '无标题',
                note: note.value
            });
            date.value = today();
            startTime.value = '';
            endTime.value = '';
            title.value = '';
            note.value = '';
            await this.save();
            this.rerender();
        };
        this.renderTimeblockAIHelper(left);

        const right = wrap.createDiv({ cls: 'ws2-timeblock-right' });
        right.addClass('sch-static-style-148');
        const todayBlocks = this.data.timeblocks.filter(b => b.date === today());
        const scheduleCard = right.createDiv({ cls: 'ws2-card' });
        scheduleCard.addClass('sch-static-style-149');
        scheduleCard.createEl('h4', { text: '当日日程', cls: 'ws2-card-title' });

        if (todayBlocks.length === 0) {
            scheduleCard.createEl('div', { text: '无日程', cls: 'ws2-empty-hint' });
        } else {
            const list = scheduleCard.createDiv({ cls: 'ws2-timeblock-list' });
            list.addClass('sch-static-style-89');
            for (const block of todayBlocks.sort((a, b) => a.startTime.localeCompare(b.startTime))) {
                const item = list.createDiv({ cls: 'ws2-timeblock-item' });
                item.addClass('sch-static-style-150');
                const timeEl = item.createEl('div', { text: `${block.startTime}-${block.endTime}`, cls: 'ws2-timeblock-time' });
                timeEl.addClass('sch-static-style-151');
                const titleEl = item.createEl('div', { text: block.title, cls: 'ws2-timeblock-title' });
                titleEl.addClass('sch-static-style-152');
                const catEl = item.createEl('div', { text: block.category, cls: 'ws2-timeblock-category' });
                catEl.addClass('sch-static-style-153');
                if (block.note) {
                    const noteEl = item.createEl('div', { text: block.note, cls: 'ws2-timeblock-note' });
                    noteEl.addClass('sch-static-style-154');
                }
                const del = item.createEl('button', { text: '×', cls: 'ws2-del-btn' });
                del.onclick = async () => {
                    this.data.timeblocks = this.data.timeblocks.filter(b => b.id !== block.id);
                    await this.save();
                    this.rerender();
                };
            }
        }
    }

    // ════════════════════════════════
    // 专注与任务
    // ════════════════════════════════
    private renderFocus(el: HTMLElement) {
        const wrap = el.createDiv({ cls: 'ws2-focus-container' });

        const left = wrap.createDiv({ cls: 'ws2-focus-left' });

        // 计时器
        const timerCard = left.createDiv({ cls: 'ws2-card' });
        this.focusDisplayEl = timerCard.createEl('div', { cls: 'ws2-timer-display' });
        this.updateTimerDisplay();

        if (this.data.focus.active) {
            this.focusTimer = this.plugin.registerInterval(window.setInterval(() => this.updateTimerDisplay(), 1000));
            timerCard.createEl('div', { text: `🎯 ${this.data.focus.active.title}`, cls: 'ws2-timer-label' });
        } else {
            timerCard.createEl('div', { text: '暂无进行中的专注', cls: 'ws2-timer-label' });
        }

        // 控制区
        const ctrl = left.createDiv({ cls: 'ws2-card' });
        ctrl.createEl('h4', { text: '专注计时器', cls: 'ws2-card-title' });
        const titleInput = ctrl.createEl('input', { cls: 'ws2-input', attr: { placeholder: '专注主题' } }) as HTMLInputElement;
        if (this.data.focus.active) titleInput.value = this.data.focus.active.title;

        const taskSelect = ctrl.createEl('select', { cls: 'ws2-input' }) as HTMLSelectElement;
        taskSelect.createEl('option', { text: '不关联任务', attr: { value: '' } });
        for (const task of this.data.tasks.filter(t => t.status === 'active')) {
            taskSelect.createEl('option', { text: task.title, attr: { value: task.id } });
        }

        const btnRow = ctrl.createDiv({ cls: 'ws2-focus-btn-row' });
        const startBtn = btnRow.createEl('button', {
            text: this.data.focus.active ? '已在专注中' : '▶ 开始',
            cls: `ws2-btn${this.data.focus.active ? ' ws2-btn-disabled' : ''}`
        });
        const endBtn = btnRow.createEl('button', { text: '⏹ 结束', cls: `ws2-btn ws2-btn-outline${!this.data.focus.active ? ' ws2-btn-disabled' : ''}` });

        startBtn.onclick = async () => {
            if (this.data.focus.active) { new Notice('请先结束当前专注'); return; }
            this.data.focus.active = {
                id: uid(),
                title: titleInput.value.trim() || '专注记录',
                startTs: Date.now(),
                taskId: taskSelect.value || undefined
            };
            await this.save();
            this.rerender();
        };
        endBtn.onclick = async () => {
            const a = this.data.focus.active;
            if (!a) return;
            const minutes = Math.round((Date.now() - a.startTs) / 60000);
            const nowStr = nowHHMM();
            const startStr = new Date(a.startTs).toTimeString().slice(0,5);
            this.data.focus.sessions.push({ id: a.id, date: today(), title: a.title, start: startStr, end: nowStr, minutes, taskId: a.taskId });
            this.data.focus.active = null;
            await this.save();
            this.rerender();
            new Notice(`✅ 专注结束：${a.title}（${minutes} 分钟）`);
        };

        // 手动补录
        const manual = left.createDiv({ cls: 'ws2-card' });
        manual.createEl('h4', { text: '手动补录', cls: 'ws2-card-title' });
        const manTitle = manual.createEl('input', { cls: 'ws2-input', attr: { placeholder: '主题' } }) as HTMLInputElement;
        const manStart = manual.createEl('input', { cls: 'ws2-input', attr: { type: 'time' } }) as HTMLInputElement;
        const manEnd = manual.createEl('input', { cls: 'ws2-input', attr: { type: 'time' } }) as HTMLInputElement;
        const manBtn = manual.createEl('button', { text: '添加记录', cls: 'ws2-btn' });
        manBtn.onclick = async () => {
            if (!manStart.value || !manEnd.value) { new Notice('请填写时间'); return; }
            const min = diffMin(manStart.value, manEnd.value);
            if (min <= 0) { new Notice('时间有误'); return; }
            this.data.focus.sessions.push({
                id: uid(), date: today(), title: manTitle.value || '补录',
                start: manStart.value, end: manEnd.value, minutes: min
            });
            manTitle.value = '';
            manStart.value = '';
            manEnd.value = '';
            await this.save();
            this.rerender();
        };

        // 右侧：任务管理
        const right = wrap.createDiv({ cls: 'ws2-focus-right' });
        const taskCard = right.createDiv({ cls: 'ws2-card' });
        taskCard.createEl('h4', { text: '任务管理', cls: 'ws2-card-title' });

        const taskInput = taskCard.createEl('input', { cls: 'ws2-input', attr: { placeholder: '新任务' } }) as HTMLInputElement;
        const addTaskBtn = taskCard.createEl('button', { text: '添加', cls: 'ws2-btn' });
        addTaskBtn.onclick = async () => {
            const title = taskInput.value.trim();
            if (!title) return;
            this.data.tasks.push({ id: uid(), title, status: 'active', createdAt: today() });
            taskInput.value = '';
            await this.save();
            this.rerender();
        };

        const activeTasks = this.data.tasks.filter(t => t.status === 'active');
        const doneTasks = this.data.tasks.filter(t => t.status === 'done');

        if (activeTasks.length > 0) {
            const activeSection = taskCard.createDiv({ cls: 'ws2-task-section' });
            activeSection.createEl('h5', { text: '进行中', cls: 'ws2-task-section-title' });
            for (const task of activeTasks) {
                const item = activeSection.createDiv({ cls: 'ws2-task-item' });
                item.createEl('span', { text: task.title });
                const completeBtn = item.createEl('button', { text: '✓', cls: 'ws2-task-btn' });
                const delBtn = item.createEl('button', { text: '×', cls: 'ws2-task-btn' });
                completeBtn.onclick = async () => {
                    task.status = 'done';
                    task.completedAt = today();
                    await this.save();
                    this.rerender();
                };
                delBtn.onclick = async () => {
                    this.data.tasks = this.data.tasks.filter(t => t.id !== task.id);
                    await this.save();
                    this.rerender();
                };
            }
        }

        if (doneTasks.length > 0) {
            const doneSection = taskCard.createDiv({ cls: 'ws2-task-section' });
            doneSection.createEl('h5', { text: '已完成', cls: 'ws2-task-section-title' });
            for (const task of doneTasks) {
                const item = doneSection.createDiv({ cls: 'ws2-task-item ws2-task-done' });
                item.createEl('span', { text: task.title });
                const delBtn = item.createEl('button', { text: '×', cls: 'ws2-task-btn' });
                delBtn.onclick = async () => {
                    this.data.tasks = this.data.tasks.filter(t => t.id !== task.id);
                    await this.save();
                    this.rerender();
                };
            }
        }

        // 时间线
        const timelineCard = right.createDiv({ cls: 'ws2-card' });
        timelineCard.createEl('h4', { text: '今日专注时间线', cls: 'ws2-card-title' });
        const todaySessions = this.data.focus.sessions.filter(s => s.date === today()).sort((a, b) => a.start.localeCompare(b.start));
        if (todaySessions.length === 0) {
            timelineCard.createEl('div', { text: '无记录', cls: 'ws2-empty-hint' });
        } else {
            const timeline = timelineCard.createDiv({ cls: 'ws2-timeline' });
            for (const s of todaySessions) {
                const entry = timeline.createDiv({ cls: 'ws2-timeline-entry' });
                entry.createEl('div', { text: `${s.start}–${s.end}`, cls: 'ws2-timeline-time' });
                entry.createEl('div', { text: s.title, cls: 'ws2-timeline-title' });
                entry.createEl('div', { text: `${s.minutes}m`, cls: 'ws2-timeline-duration' });
            }
        }
    }

    private updateTimerDisplay() {
        if (!this.focusDisplayEl) return;
        const a = this.data.focus.active;
        if (!a) { this.focusDisplayEl.setText('00:00:00'); return; }
        const sec = Math.floor((Date.now() - a.startTs) / 1000);
        const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
        this.focusDisplayEl.setText(
            `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`
        );
    }

    // ════════════════════════════════
    // 习惯与饮食
    // ════════════════════════════════
    private renderHabits(el: HTMLElement) {
        const td = today();
        if (!this.data.habits.logs[td]) this.data.habits.logs[td] = {};
        const log = this.data.habits.logs[td]!;

        const wrap = el.createDiv({ cls: 'ws2-habits-container' });

        const left = wrap.createDiv({ cls: 'ws2-habits-left' });
        const habitCard = left.createDiv({ cls: 'ws2-card' });
        habitCard.createEl('h3', { text: '每日习惯', cls: 'ws2-card-title' });

        const done = this.data.habits.list.filter(h => log[h.id]).length;
        const total = this.data.habits.list.length;
        const pct = total ? Math.round(done/total*100) : 0;

        habitCard.createEl('div', { text: `完成度 ${pct}%（${done}/${total}）`, cls: 'ws2-progress-text' });

        const habitGrid = habitCard.createDiv({ cls: 'ws2-habit-grid' });
        for (const h of this.data.habits.list) {
            const checked = !!log[h.id];
            const item = habitGrid.createDiv({ cls: `ws2-habit-item${checked ? ' done' : ''}` });
            const check = item.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
            check.checked = checked;
            check.onchange = async () => {
                log[h.id] = check.checked;
                await this.save();
                this.rerender();
            };
            item.createEl('span', { text: h.icon, cls: 'ws2-habit-icon' });
            item.createEl('span', { text: h.name, cls: 'ws2-habit-name' });
        }

        const addHabitRow = habitCard.createDiv({ cls: 'ws2-add-row' });
        const addHabitInput = addHabitRow.createEl('input', { cls: 'ws2-input', attr: { placeholder: '新习惯' } }) as HTMLInputElement;
        const addHabitBtn = addHabitRow.createEl('button', { text: '添加', cls: 'ws2-btn' });
        addHabitBtn.onclick = async () => {
            const name = addHabitInput.value.trim();
            if (!name) return;
            this.data.habits.list.push({ id: uid(), name, icon: '📌', color: '#FF8A65' });
            addHabitInput.value = '';
            await this.save();
            this.rerender();
        };

        // 右侧：饮食日记
        const right = wrap.createDiv({ cls: 'ws2-habits-right' });
        const foodCard = right.createDiv({ cls: 'ws2-card' });
        foodCard.createEl('h4', { text: '饮食日记', cls: 'ws2-card-title' });

        const foodDate = foodCard.createEl('input', { cls: 'ws2-input', attr: { type: 'date' } }) as HTMLInputElement;
        foodDate.value = today();

        const foodMeal = foodCard.createEl('select', { cls: 'ws2-input' }) as HTMLSelectElement;
        ['早餐', '午餐', '晚餐', '零食'].forEach(m => foodMeal.createEl('option', { text: m, attr: { value: m } }));

        const foodContent = foodCard.createEl('textarea', { cls: 'ws2-input', attr: { placeholder: '饮食内容', rows: '3' } }) as HTMLTextAreaElement;
        const foodBtn = foodCard.createEl('button', { text: '记录', cls: 'ws2-btn' });
        foodBtn.onclick = async () => {
            if (!foodContent.value.trim()) { new Notice('请输入饮食内容'); return; }
            this.data.food.entries.push({
                id: uid(),
                date: foodDate.value,
                meal: (foodMeal.value === '早餐' ? 'breakfast' : foodMeal.value === '午餐' ? 'lunch' : foodMeal.value === '晚餐' ? 'dinner' : 'snack'),
                content: foodContent.value
            });
            foodContent.value = '';
            await this.save();
            this.rerender();
        };

        const foodList = foodCard.createDiv({ cls: 'ws2-food-list' });
        const todayFood = this.data.food.entries.filter(f => f.date === today());
        if (todayFood.length === 0) {
            foodList.createEl('div', { text: '无记录', cls: 'ws2-empty-hint' });
        } else {
            for (const entry of todayFood) {
                const item = foodList.createDiv({ cls: 'ws2-food-item' });
                item.createEl('span', { text: entry.meal, cls: 'ws2-food-meal' });
                item.createEl('span', { text: entry.content, cls: 'ws2-food-content' });
                const del = item.createEl('button', { text: '×', cls: 'ws2-del-btn' });
                del.onclick = async () => {
                    this.data.food.entries = this.data.food.entries.filter(f => f.id !== entry.id);
                    await this.save();
                    this.rerender();
                };
            }
        }
    }

    // ════════════════════════════════
    // 情绪与观心
    // ════════════════════════════════
    private renderEmotions(el: HTMLElement) {
        const wrap = el.createDiv({ cls: 'ws2-emotions-container' });

        const left = wrap.createDiv({ cls: 'ws2-emotions-left' });
        const emotionCard = left.createDiv({ cls: 'ws2-card' });
        emotionCard.createEl('h3', { text: '今日情绪', cls: 'ws2-card-title' });

        const emojis = ['😤', '😊', '😐', '😔', '😩'];
        const selectorRow = emotionCard.createDiv({ cls: 'ws2-emoji-selector' });
        for (const emoji of emojis) {
            const btn = selectorRow.createEl('button', { text: emoji, cls: 'ws2-emoji-btn' });
            btn.onclick = () => {
                document.querySelectorAll('.ws2-emoji-btn.selected').forEach(b => b.classList.remove('selected'));
                btn.addClass('selected');
            };
        }

        const emotionText = emotionCard.createEl('textarea', { cls: 'ws2-input', attr: { placeholder: '心情描述', rows: '4' } }) as HTMLTextAreaElement;
        const emotionBtns = emotionCard.createDiv({ cls: 'ws2-emotion-btns' });
        const saveMoodBtn = emotionBtns.createEl('button', { text: '保存', cls: 'ws2-btn' });
        const clearMoodBtn = emotionBtns.createEl('button', { text: '清除', cls: 'ws2-btn ws2-btn-outline' });

        saveMoodBtn.onclick = async () => {
            const selected = document.querySelector('.ws2-emoji-btn.selected') as HTMLElement;
            const emoji = selected ? selected.textContent! : '😐';
            this.data.emotions[today()] = { emoji, text: emotionText.value, savedAt: today() };
            await this.save();
            this.rerender();
            new Notice('✅ 心情已保存');
        };
        clearMoodBtn.onclick = () => {
            emotionText.value = '';
        };

        // 右侧：观心反思
        const right = wrap.createDiv({ cls: 'ws2-emotions-right' });
        const journalCard = right.createDiv({ cls: 'ws2-card' });
        journalCard.createEl('h4', { text: '观心反思', cls: 'ws2-card-title' });

        const proudInput = journalCard.createEl('textarea', {
            cls: 'ws2-input',
            attr: { placeholder: '最值得肯定的事', rows: '2' }
        }) as HTMLTextAreaElement;

        const changeInput = journalCard.createEl('textarea', {
            cls: 'ws2-input',
            attr: { placeholder: '最想调整的事', rows: '2' }
        }) as HTMLTextAreaElement;

        const insightInput = journalCard.createEl('textarea', {
            cls: 'ws2-input',
            attr: { placeholder: '洞察 / 灵感', rows: '2' }
        }) as HTMLTextAreaElement;

        const gratefulInput = journalCard.createEl('textarea', {
            cls: 'ws2-input',
            attr: { placeholder: '感谢什么', rows: '2' }
        }) as HTMLTextAreaElement;

        const saveJournalBtn = journalCard.createEl('button', { text: '保存反思', cls: 'ws2-btn' });
        saveJournalBtn.onclick = async () => {
            this.data.journal[today()] = {
                proud: proudInput.value,
                change: changeInput.value,
                insight: insightInput.value,
                grateful: gratefulInput.value,
                savedAt: today()
            };
            await this.save();
            new Notice('✅ 反思已保存');
        };
    }

    // ════════════════════════════════
    // 手机克制与成就
    // ════════════════════════════════
    private renderPhone(el: HTMLElement) {
        const wrap = el.createDiv({ cls: 'ws2-phone-container' });

        const left = wrap.createDiv({ cls: 'ws2-phone-left' });
        const phoneCard = left.createDiv({ cls: 'ws2-card' });
        phoneCard.createEl('h3', { text: '手机克制', cls: 'ws2-card-title' });

        const totalResist = this.data.phone.logs.filter(l => l.resisted).length;
        phoneCard.createEl('div', { text: `累计成功克制 ${totalResist} 次`, cls: 'ws2-phone-count' });

        const reasonInput = phoneCard.createEl('input', { cls: 'ws2-input', attr: { placeholder: '克制理由（可选）' } }) as HTMLInputElement;
        const resistBtns = phoneCard.createDiv({ cls: 'ws2-phone-btns' });

        const resistBtn = resistBtns.createEl('button', { text: '✊ 成功克制', cls: 'ws2-btn' });
        const failBtn = resistBtns.createEl('button', { text: '📱 没忍住', cls: 'ws2-btn ws2-btn-outline' });

        resistBtn.onclick = async () => {
            this.data.phone.logs.push({ date: today(), time: nowHHMM(), resisted: true, reason: reasonInput.value });
            reasonInput.value = '';
            await this.save();
            this.rerender();
            new Notice('💪 坚持住了！');
        };

        failBtn.onclick = async () => {
            this.data.phone.logs.push({ date: today(), time: nowHHMM(), resisted: false, reason: reasonInput.value });
            reasonInput.value = '';
            await this.save();
            this.rerender();
        };

        // 右侧：成就
        const right = wrap.createDiv({ cls: 'ws2-achievements' });
        right.createEl('h3', { text: '成就殿堂', cls: 'ws2-card-title' });

        const achievements = [
            { name: '进入心流', desc: '累计专注 ≥ 300分钟', unlocked: this.getTotalFocusMinutes() >= 300 },
            { name: '深度工作者', desc: '累计专注 ≥ 1000分钟', unlocked: this.getTotalFocusMinutes() >= 1000 },
            { name: '意志初现', desc: '成功克制 ≥ 10次', unlocked: this.data.phone.logs.filter(l => l.resisted).length >= 10 },
            { name: '手机克星', desc: '成功克制 ≥ 100次', unlocked: this.data.phone.logs.filter(l => l.resisted).length >= 100 },
            { name: '执行闭环', desc: '完成任务 ≥ 20个', unlocked: this.data.tasks.filter(t => t.status === 'done').length >= 20 },
            { name: '日日精进', desc: '习惯连续打卡 ≥ 7天', unlocked: this.calcLongestStreak() >= 7 },
            { name: '观心之人', desc: '完成观心记录 ≥ 7天', unlocked: Object.keys(this.data.journal).length >= 7 },
            { name: '开始投稿', desc: '建立第1个投稿项目', unlocked: this.data.submissions.length >= 1 },
            { name: '论文被接收', desc: '至少1个项目进入已接收', unlocked: this.data.submissions.some(s => s.stage === '已接收') },
        ];

        const achievementGrid = right.createDiv({ cls: 'ws2-achievement-grid' });
        for (const ach of achievements) {
            const card = achievementGrid.createDiv({ cls: `ws2-achievement-card${ach.unlocked ? ' unlocked' : ''}` });
            if (!ach.unlocked) card.createEl('span', { text: '🔒', cls: 'ws2-achievement-lock' });
            card.createEl('div', { text: ach.name, cls: 'ws2-achievement-name' });
            card.createEl('div', { text: ach.desc, cls: 'ws2-achievement-desc' });
        }
    }

    // ════════════════════════════════
    // 投稿管理
    // ════════════════════════════════
    private renderSubmission(el: HTMLElement) {
        const wrap = el.createDiv({ cls: 'ws2-submission-container' });

        // 左侧：表单
        const left = wrap.createDiv({ cls: 'ws2-submission-left' });
        const form = left.createDiv({ cls: 'ws2-card' });
        form.createEl('h3', { text: '新建投稿', cls: 'ws2-card-title' });

        const title = form.createEl('input', { cls: 'ws2-input', attr: { placeholder: '论文标题' } }) as HTMLInputElement;
        const type = form.createEl('select', { cls: 'ws2-input' }) as HTMLSelectElement;
        ['期刊', '会议', '其他'].forEach(t => type.createEl('option', { text: t, attr: { value: t } }));

        const priority = form.createEl('select', { cls: 'ws2-input' }) as HTMLSelectElement;
        ['高', '中', '低'].forEach(p => priority.createEl('option', { text: p, attr: { value: p } }));

        const venue = form.createEl('input', { cls: 'ws2-input', attr: { placeholder: '期刊 / 会议名称' } }) as HTMLInputElement;
        const deadline = form.createEl('input', { cls: 'ws2-input', attr: { type: 'date' } }) as HTMLInputElement;

        const stage = form.createEl('select', { cls: 'ws2-input' }) as HTMLSelectElement;
        STAGES.forEach(s => stage.createEl('option', { text: s, attr: { value: s } }));

        const version = form.createEl('input', { cls: 'ws2-input', attr: { placeholder: '版本号（如 v1.0）' } }) as HTMLInputElement;
        const notes = form.createEl('textarea', { cls: 'ws2-input', attr: { placeholder: '备注', rows: '3' } }) as HTMLTextAreaElement;

        const submitBtn = form.createEl('button', { text: '添加投稿', cls: 'ws2-btn' });
        submitBtn.onclick = async () => {
            const t = title.value.trim();
            if (!t) { new Notice('请填写标题'); return; }
            this.data.submissions.push({
                id: uid(),
                title: t,
                venue: venue.value,
                type: type.value,
                stage: stage.value as SubmissionStage,
                priority: priority.value as 'high' | 'medium' | 'low',
                deadline: deadline.value,
                notes: notes.value,
                version: version.value,
                createdAt: today()
            });
            title.value = venue.value = deadline.value = version.value = notes.value = '';
            await this.save();
            this.rerender();
            new Notice('✅ 投稿已添加');
        };

        // 右侧：统计和看板
        const right = wrap.createDiv({ cls: 'ws2-submission-right' });

        // 统计条
        const statsBar = right.createDiv({ cls: 'ws2-stats-bar' });
        const total = this.data.submissions.length;
        const active = this.data.submissions.filter(s => !['已接收','搁置/拒稿'].includes(s.stage)).length;
        const accepted = this.data.submissions.filter(s => s.stage === '已接收').length;
        const urgent = this.data.submissions.filter(s => {
            const d = new Date(s.deadline).getTime();
            return d > 0 && (d - Date.now()) / 86400000 <= 14;
        }).length;

        const stats = [
            { label: '总项目', value: String(total) },
            { label: '进行中', value: String(active) },
            { label: '已接收', value: String(accepted) },
            { label: '14天截止', value: String(urgent) },
        ];

        for (const stat of stats) {
            const chip = statsBar.createDiv({ cls: 'ws2-stat-chip' });
            chip.createEl('span', { text: stat.label });
            chip.createEl('span', { text: stat.value, cls: 'ws2-stat-value' });
        }

        // Kanban 看板
        const kanban = right.createDiv({ cls: 'ws2-kanban' });
        for (const s of STAGES) {
            const items = this.data.submissions.filter(sub => sub.stage === s);
            const col = kanban.createDiv({ cls: 'ws2-kanban-col' });
            const colHead = col.createDiv({ cls: 'ws2-kanban-col-head' });
            colHead.createEl('h5', { text: `${s} (${items.length})`, cls: 'ws2-kanban-title' });

            for (const sub of items) {
                const card = col.createDiv({ cls: 'ws2-sub-card' });
                card.createEl('div', { text: sub.title, cls: 'ws2-sub-title' });
                if (sub.venue) card.createEl('div', { text: `📍 ${sub.venue}`, cls: 'ws2-sub-venue' });
                const cardBtns = card.createDiv({ cls: 'ws2-sub-card-btns' });
                const editBtn = cardBtns.createEl('button', { text: '✏️', cls: 'ws2-mini-btn' });
                const delBtn = cardBtns.createEl('button', { text: '×', cls: 'ws2-mini-btn' });

                editBtn.onclick = async () => {
                    const newStage = prompt('选择新阶段', sub.stage);
                    if (newStage && STAGES.includes(newStage as SubmissionStage)) {
                        sub.stage = newStage as SubmissionStage;
                        await this.save();
                        this.rerender();
                    }
                };

                delBtn.onclick = async () => {
                    this.data.submissions = this.data.submissions.filter(x => x.id !== sub.id);
                    await this.save();
                    this.rerender();
                };
            }
        }
    }

    // ════════════════════════════════
    // 设置/数据管理
    // ════════════════════════════════
    private renderSettings(el: HTMLElement) {
        const wrap = el.createDiv({ cls: 'ws2-settings-container' });

        const storageCard = wrap.createDiv({ cls: 'ws2-card' });
        storageCard.createEl('h3', { text: '存储信息', cls: 'ws2-card-title' });
        const storageKey = storageCard.createDiv({ cls: 'ws2-settings-key' });
        storageKey.createEl('span', { text: '存储 Key: ' });
        const keyDisplay = storageKey.createEl('code', { text: 'workspace', cls: 'ws2-code' });
        const copyBtn = storageKey.createEl('button', { text: '复制', cls: 'ws2-btn ws2-btn-outline' });
        copyBtn.onclick = () => {
            navigator.clipboard.writeText('workspace');
            new Notice('已复制到剪贴板');
        };

        const exportCard = wrap.createDiv({ cls: 'ws2-card' });
        exportCard.createEl('h3', { text: '导出备份', cls: 'ws2-card-title' });
        const exportJSON = exportCard.createEl('button', { text: '📥 导出 JSON', cls: 'ws2-btn' });
        const exportCopy = exportCard.createEl('button', { text: '📋 复制 JSON', cls: 'ws2-btn ws2-btn-outline' });

        exportJSON.onclick = () => {
            const dataStr = JSON.stringify(this.data, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `phd-workspace-${today()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        };

        exportCopy.onclick = () => {
            navigator.clipboard.writeText(JSON.stringify(this.data, null, 2));
            new Notice('已复制到剪贴板');
        };

        const importCard = wrap.createDiv({ cls: 'ws2-card' });
        importCard.createEl('h3', { text: '导入恢复', cls: 'ws2-card-title' });
        const importBtn = importCard.createEl('button', { text: '导入 JSON 文件', cls: 'ws2-btn' });
        importBtn.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                const text = await file.text();
                try {
                    const newData = JSON.parse(text) as WorkspaceData;
                    this.data = newData;
                    await this.save();
                    this.rerender();
                    new Notice('✅ 导入成功');
                } catch {
                    new Notice('❌ 格式错误');
                }
            };
            input.click();
        };

        const maintenanceCard = wrap.createDiv({ cls: 'ws2-card' });
        maintenanceCard.createEl('h3', { text: '修复与清理', cls: 'ws2-card-title' });
        const repairBtn = maintenanceCard.createEl('button', { text: '修复数据结构', cls: 'ws2-btn ws2-btn-outline' });
        repairBtn.onclick = async () => {
            this.data = this.blank();
            await this.save();
            this.rerender();
            new Notice('✅ 数据已重置');
        };

        const dangerCard = wrap.createDiv({ cls: 'ws2-card ws2-danger-card' });
        dangerCard.createEl('h3', { text: '危险操作', cls: 'ws2-card-title' });
        const clearBtn = dangerCard.createEl('button', { text: '⚠️ 清空所有数据', cls: 'ws2-btn ws2-btn-danger' });
        clearBtn.onclick = async () => {
            const confirm = prompt('输入 DELETE 来确认清空所有数据：');
            if (confirm === 'DELETE') {
                this.data = this.blank();
                await this.save();
                this.rerender();
                new Notice('✅ 所有数据已清空');
            }
        };
    }

    // ════════════════════════════════
    // 数据看板
    // ════════════════════════════════
    private renderDashboard(el: HTMLElement) {
        const wrap = el.createDiv({ cls: 'ws2-dashboard-container' });

        // 时间范围选择
        const rangeSelector = wrap.createDiv({ cls: 'ws2-range-selector' });
        rangeSelector.createEl('span', { text: '时间范围：' });
        for (const range of [7, 30, 90, 365] as const) {
            const btn = rangeSelector.createEl('button', {
                text: range === 7 ? '7天' : range === 30 ? '30天' : range === 90 ? '90天' : '365天',
                cls: `ws2-range-btn${this.dashboardRange === range ? ' active' : ''}`
            });
            btn.onclick = () => {
                this.dashboardRange = range;
                this.rerender();
            };
        }

        // 统计芯片
        const statsRow = wrap.createDiv({ cls: 'ws2-stats-row' });
        const totalFocus = this.getTotalFocusMinutesInRange(this.dashboardRange);
        const totalTasks = this.data.tasks.filter(t => t.status === 'done').length;
        const totalResist = this.data.phone.logs.filter(l => l.resisted).length;
        const avgHabit = this.data.habits.list.length ? Math.round(
            Object.values(this.data.habits.logs).filter(d => Object.values(d).some(v => v)).length / this.dashboardRange * 100
        ) : 0;

        const dashStats = [
            { label: '专注总时长', value: `${totalFocus}分钟` },
            { label: '完成任务数', value: String(totalTasks) },
            { label: '手机克制次', value: String(totalResist) },
            { label: '习惯完成率', value: `${avgHabit}%` },
        ];

        for (const stat of dashStats) {
            const chip = statsRow.createDiv({ cls: 'ws2-stat-chip' });
            chip.createEl('div', { text: stat.label, cls: 'ws2-stat-label' });
            chip.createEl('div', { text: stat.value, cls: 'ws2-stat-value-large' });
        }

        // 图表区域
        const chartsRow = wrap.createDiv({ cls: 'ws2-charts-row' });

        // 每日专注时长（折线）
        const focusChart = chartsRow.createDiv({ cls: 'ws2-chart' });
        focusChart.createEl('h4', { text: '每日专注时长', cls: 'ws2-chart-title' });
        const focusSvg = this.createLineChart(this.getDailyFocusData(this.dashboardRange));
        focusChart.appendChild(focusSvg);

        // 工位出勤情况（柱状）
        const attendanceChart = chartsRow.createDiv({ cls: 'ws2-chart' });
        attendanceChart.createEl('h4', { text: '工位出勤情况', cls: 'ws2-chart-title' });
        const attendanceSvg = this.createBarChart(this.getDailyAttendanceData(this.dashboardRange));
        attendanceChart.appendChild(attendanceSvg);

        const chartsRow2 = wrap.createDiv({ cls: 'ws2-charts-row' });

        // 手机克制趋势（折线）
        const phoneChart = chartsRow2.createDiv({ cls: 'ws2-chart' });
        phoneChart.createEl('h4', { text: '手机克制趋势', cls: 'ws2-chart-title' });
        const phoneSvg = this.createLineChart(this.getDailyPhoneData(this.dashboardRange));
        phoneChart.appendChild(phoneSvg);

        // 习惯完成度（折线）
        const habitChart = chartsRow2.createDiv({ cls: 'ws2-chart' });
        habitChart.createEl('h4', { text: '习惯完成度', cls: 'ws2-chart-title' });
        const habitSvg = this.createLineChart(this.getDailyHabitData(this.dashboardRange));
        habitChart.appendChild(habitSvg);
    }

    // ──── 工具函数 ────

    private getDailyFocusData(days: number): { date: string; value: number }[] {
        const data: { date: string; value: number }[] = [];
        const now = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0]!;
            const minutes = this.data.focus.sessions.filter(s => s.date === dateStr).reduce((s, r) => s + r.minutes, 0);
            data.push({ date: dateStr.slice(5), value: minutes });
        }
        return data;
    }

    private getDailyAttendanceData(days: number): { date: string; value: number }[] {
        const data: { date: string; value: number }[] = [];
        const now = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0]!;
            const checkin = this.data.checkin[dateStr];
            const attended = checkin ? (checkin.morning.length + checkin.afternoon.length + checkin.evening.length > 0 ? 1 : 0) : 0;
            data.push({ date: dateStr.slice(5), value: attended });
        }
        return data;
    }

    private getDailyPhoneData(days: number): { date: string; value: number }[] {
        const data: { date: string; value: number }[] = [];
        const now = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0]!;
            const count = this.data.phone.logs.filter(l => l.date === dateStr && l.resisted).length;
            data.push({ date: dateStr.slice(5), value: count });
        }
        return data;
    }

    private getDailyHabitData(days: number): { date: string; value: number }[] {
        const data: { date: string; value: number }[] = [];
        const now = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0]!;
            const day = this.data.habits.logs[dateStr] || {};
            const doneCount = Object.values(day).filter(v => v === true).length;
            data.push({ date: dateStr.slice(5), value: doneCount });
        }
        return data;
    }

    // ──── 通用工具方法 ────

    private getTotalFocusMinutes(): number {
        return this.data.focus.sessions.reduce((s, r) => s + (r.minutes || 0), 0);
    }

    private getTotalFocusMinutesInRange(days: number): number {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().split('T')[0]!;
        return this.data.focus.sessions
            .filter(s => (s.date || '') >= cutoffStr)
            .reduce((s, r) => s + (r.minutes || 0), 0);
    }

    private calcLongestStreak(): number {
        const dates = Object.keys(this.data.habits.logs).sort();
        if (dates.length === 0) return 0;
        let best = 1, cur = 1;
        for (let i = 1; i < dates.length; i++) {
            const prev = new Date(dates[i - 1]!);
            const next = new Date(dates[i]!);
            const diff = Math.round((+next - +prev) / 86400000);
            if (diff === 1) { cur += 1; best = Math.max(best, cur); }
            else cur = 1;
        }
        return best;
    }

    private createLineChart(data: { date: string; value: number }[]): SVGSVGElement {
        return this.createMiniChart(data, 'line');
    }

    private createBarChart(data: { date: string; value: number }[]): SVGSVGElement {
        return this.createMiniChart(data, 'bar');
    }

    private createMiniChart(data: { date: string; value: number }[], kind: 'line' | 'bar'): SVGSVGElement {
        const W = 320, H = 120, P = 18;
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg') as SVGSVGElement;
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', String(H));
        svg.addClass('sch-static-style-155');

        if (data.length === 0) {
            const t = document.createElementNS(svgNS, 'text');
            t.setAttribute('x', String(W / 2));
            t.setAttribute('y', String(H / 2));
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('fill', 'var(--text-faint)');
            t.setAttribute('font-size', '12');
            t.textContent = '暂无数据';
            svg.appendChild(t);
            return svg;
        }

        const max = Math.max(1, ...data.map(d => d.value));
        const stepX = (W - P * 2) / Math.max(1, data.length - 1);
        const accent = 'var(--celn-accent)';

        if (kind === 'line') {
            const pts = data.map((d, i) => `${P + i * stepX},${H - P - (d.value / max) * (H - P * 2)}`).join(' ');
            const poly = document.createElementNS(svgNS, 'polyline');
            poly.setAttribute('points', pts);
            poly.setAttribute('fill', 'none');
            poly.setAttribute('stroke', accent);
            poly.setAttribute('stroke-width', '2');
            poly.setAttribute('stroke-linejoin', 'round');
            poly.setAttribute('stroke-linecap', 'round');
            svg.appendChild(poly);
            data.forEach((d, i) => {
                const c = document.createElementNS(svgNS, 'circle');
                c.setAttribute('cx', String(P + i * stepX));
                c.setAttribute('cy', String(H - P - (d.value / max) * (H - P * 2)));
                c.setAttribute('r', '2');
                c.setAttribute('fill', accent);
                svg.appendChild(c);
            });
        } else {
            const bw = Math.max(2, stepX * 0.6);
            data.forEach((d, i) => {
                const h = (d.value / max) * (H - P * 2);
                const r = document.createElementNS(svgNS, 'rect');
                r.setAttribute('x', String(P + i * stepX - bw / 2));
                r.setAttribute('y', String(H - P - h));
                r.setAttribute('width', String(bw));
                r.setAttribute('height', String(h));
                r.setAttribute('fill', accent);
                r.setAttribute('rx', '2');
                svg.appendChild(r);
            });
        }
        return svg;
    }

    public destroy(): void {
        if (this.focusTimer) { window.clearInterval(this.focusTimer); this.focusTimer = null; }
        if (this.todayTimer) { window.clearInterval(this.todayTimer); this.todayTimer = null; }
    }
}

// ─── 时间块编辑弹窗（点击时间轴上的任务块打开）───
class TimeBlockEditModal extends Modal {
    private block: TimeBlock;
    private lang: 'zh' | 'en';
    private onSaveCb: () => Promise<void>;
    private onDeleteCb: () => Promise<void>;

    constructor(app: App, block: TimeBlock, lang: 'zh' | 'en', onSave: () => Promise<void>, onDelete: () => Promise<void>) {
        super(app);
        this.block = block;
        this.lang = lang;
        this.onSaveCb = onSave;
        this.onDeleteCb = onDelete;
    }

    onOpen(): void {
        const zh = this.lang === 'zh';
        const c = this.contentEl;
        c.empty();
        c.createEl('h3', { text: zh ? '编辑时间块' : 'Edit time block' });

        const mk = (label: string, value: string, type = 'text'): HTMLInputElement => {
            const w = c.createDiv(); w.addClass('sch-static-style-34');
            const fieldLabel = w.createEl('div', { text: label });
            fieldLabel.addClass('sch-static-style-156');
            const inp = w.createEl('input', { cls: 'ws2-input', attr: { type } }) as HTMLInputElement;
            inp.value = value; inp.addClass('sch-static-style-157');
            return inp;
        };
        const titleIn = mk(zh ? '标题' : 'Title', this.block.title);
        const startIn = mk(zh ? '开始' : 'Start', this.block.startTime, 'time');
        const endIn = mk(zh ? '结束' : 'End', this.block.endTime, 'time');
        const catIn = mk(zh ? '分类' : 'Category', this.block.category);

        const noteW = c.createDiv(); noteW.addClass('sch-static-style-34');
        const noteLabel = noteW.createEl('div', { text: zh ? '备注' : 'Note' });
        noteLabel.addClass('sch-static-style-156');
        const noteIn = noteW.createEl('textarea', { cls: 'ws2-input' }) as HTMLTextAreaElement;
        noteIn.value = this.block.note || ''; noteIn.addClass('sch-static-style-157'); noteIn.rows = 3;

        const btns = c.createDiv();
        btns.addClass('sch-static-style-158');
        const del = btns.createEl('button', { text: zh ? '删除' : 'Delete' });
        del.addClass('sch-static-style-159');
        del.onclick = async () => { await this.onDeleteCb(); this.close(); };
        const right = btns.createDiv();
        right.addClass('sch-static-style-160');
        right.createEl('button', { text: zh ? '取消' : 'Cancel' }).onclick = () => this.close();
        const save = right.createEl('button', { text: zh ? '保存' : 'Save', cls: 'mod-cta' });
        save.onclick = async () => {
            this.block.title = titleIn.value.trim() || this.block.title;
            this.block.startTime = startIn.value || this.block.startTime;
            this.block.endTime = endIn.value || this.block.endTime;
            this.block.category = catIn.value.trim();
            this.block.note = noteIn.value;
            await this.onSaveCb();
            this.close();
        };
    }

    onClose(): void { this.contentEl.empty(); }
}
