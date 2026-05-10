import { App, Notice } from 'obsidian';
import ChemELNPlugin from './main';

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

interface Task {
    id: string;
    title: string;
    status: 'active' | 'done';
    createdAt: string;
    completedAt?: string;
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

export interface WorkspaceData {
    checkin: Record<string, CheckinDay>;
    timeblocks: TimeBlock[];
    tasks: Task[];
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

type PageId = '总览首页' | '起居与考勤' | '时间块日历' | '专注与任务' | '习惯与饮食' | '情绪与观心' | '手机克制与成就' | '投稿管理' | '设置/数据管理' | '数据看板';

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
    private activePage: PageId = '总览首页';
    private focusTimer: number | null = null;
    private focusDisplayEl: HTMLElement | null = null;
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
        const raw = ((await this.plugin.loadData()) as Record<string, unknown> | null) ?? {};
        raw.workspace = this.data;
        await this.plugin.saveData(raw);
    }

    private rerender() {
        if (this.container) this.render(this.container);
    }

    // ──── 主渲染 ────
    render(container: HTMLElement) {
        if (this.focusTimer) { window.clearInterval(this.focusTimer); this.focusTimer = null; }
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

        const navItems: Array<[PageId, string]> = [
            ['总览首页', '🏠'],
            ['起居与考勤', '⏰'],
            ['时间块日历', '📅'],
            ['专注与任务', '🎯'],
            ['习惯与饮食', '🌿'],
            ['情绪与观心', '❤️'],
            ['手机克制与成就', '🛡️'],
            ['投稿管理', '✈️'],
            ['设置/数据管理', '≡'],
            ['数据看板', '📊'],
        ];

        const nav = el.createDiv({ cls: 'ws2-nav' });
        for (const [pageId, emoji] of navItems) {
            const item = nav.createDiv({
                cls: `ws2-nav-item${this.activePage === pageId ? ' active' : ''}`
            });
            item.createEl('span', { text: emoji, cls: 'ws2-nav-emoji' });
            item.createEl('span', { text: pageId, cls: 'ws2-nav-label' });
            item.onclick = () => {
                this.activePage = pageId;
                this.rerender();
            };
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

        // Scrollable body
        const body = el.createDiv({ cls: 'ws2-page-body' });

        if (this.activePage === '总览首页') this.renderOverview(body);
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
                    seg.style.width = `${Math.max(4, value / dayTotal * 100)}%`;
                    seg.style.background = cat.color;
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
            dot.style.background = cat.color;
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
            fill.style.width = `${p.toFixed(1)}%`;
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

            const card = periodsRow.createDiv({ cls: 'ws2-period-card', attr: { style: `--accent: ${p.accentColor}` } });
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

        const left = wrap.createDiv({ cls: 'ws2-timeblock-left' });
        const form = left.createDiv({ cls: 'ws2-card' });
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

        const right = wrap.createDiv({ cls: 'ws2-timeblock-right' });
        const todayBlocks = this.data.timeblocks.filter(b => b.date === today());
        const scheduleCard = right.createDiv({ cls: 'ws2-card' });
        scheduleCard.createEl('h4', { text: '当日日程', cls: 'ws2-card-title' });

        if (todayBlocks.length === 0) {
            scheduleCard.createEl('div', { text: '无日程', cls: 'ws2-empty-hint' });
        } else {
            const list = scheduleCard.createDiv({ cls: 'ws2-timeblock-list' });
            for (const block of todayBlocks.sort((a, b) => a.startTime.localeCompare(b.startTime))) {
                const item = list.createDiv({ cls: 'ws2-timeblock-item' });
                item.createEl('div', { text: `${block.startTime} - ${block.endTime}`, cls: 'ws2-timeblock-time' });
                item.createEl('div', { text: block.title, cls: 'ws2-timeblock-title' });
                item.createEl('div', { text: `[${block.category}]`, cls: 'ws2-timeblock-category' });
                if (block.note) item.createEl('div', { text: block.note, cls: 'ws2-timeblock-note' });
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
            this.focusTimer = window.setInterval(() => this.updateTimerDisplay(), 1000);
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
        svg.style.maxWidth = '100%';

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
        // No-op
    }
}
