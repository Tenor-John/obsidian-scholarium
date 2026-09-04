// i18n.ts — localisation dictionary (ported from prototype/src/tokens.jsx SCHOLARIUM_STRINGS)
// Mirrors the prototype keys and adds English translations. Look up with t(key, lang).

import type { Lang } from './theme/tokens';

export interface StringEntry { zh: string; en: string }

export const SCHOLARIUM_STRINGS: Record<string, StringEntry> = {
    // top tabs
    notebook:    { zh: '实验记录', en: 'Notebook' },
    workspace:   { zh: '工作台',   en: 'Workspace' },
    materials:   { zh: '素材库',   en: 'Materials' },
    tools:       { zh: '科研库',   en: 'Tools' },
    ai:          { zh: 'AI 助手',  en: 'AI' },
    settings:    { zh: '设置',     en: 'Settings' },

    // workspace subnav groups
    group_today:  { zh: '今日',       en: 'Today' },
    group_work:   { zh: '项目与论文', en: 'Work' },
    group_self:   { zh: '健康与心灵', en: 'Self' },
    group_data:   { zh: '数据与回顾', en: 'Data' },

    // workspace pages
    ws_today:     { zh: '今日',     en: 'Today' },
    ws_inbox:     { zh: '收件箱',   en: 'Inbox' },
    ws_projects:  { zh: '项目看板', en: 'Projects' },
    ws_thesis:    { zh: '博士论文', en: 'Thesis' },
    ws_submit:    { zh: '投稿管理', en: 'Submissions' },
    ws_mentor:    { zh: '导师沟通', en: 'Mentor' },
    ws_habit:     { zh: '健康习惯', en: 'Habits' },
    ws_mind:      { zh: '心灵关怀', en: 'Mind' },
    ws_review:    { zh: '每日复盘', en: 'Review' },
    ws_achv:      { zh: '成就殿堂', en: 'Trophies' },
    ws_analytics: { zh: '数据看板', en: 'Analytics' },

    // common UI
    search:   { zh: '搜索',     en: 'Search' },
    cmd_hint: { zh: '⌘K 命令', en: '⌘K Command' },
    add:      { zh: '新建',     en: 'New' },
    save:     { zh: '保存',     en: 'Save' },
    cancel:   { zh: '取消',     en: 'Cancel' },
    edit:     { zh: '编辑',     en: 'Edit' },
    delete:   { zh: '删除',     en: 'Delete' },
    more:     { zh: '更多',     en: 'More' },

    // Today page (used by milestone 4)
    greeting_dawn:    { zh: '深夜好', en: 'Late night' },
    greeting_morning: { zh: '早上好', en: 'Good morning' },
    greeting_noon:    { zh: '中午好', en: 'Good noon' },
    greeting_afternoon:{ zh: '下午好', en: 'Good afternoon' },
    greeting_evening: { zh: '晚上好', en: 'Good evening' },
    greeting_night:   { zh: '夜深了', en: 'Late night' },
    metric_focus:  { zh: '专注', en: 'Focus' },
    metric_done:   { zh: '完成', en: 'Done' },
    metric_energy: { zh: '能量', en: 'Energy' },
    metric_mood:   { zh: '心情', en: 'Mood' },
    today_spine:   { zh: '今日时间轴', en: 'Time spine' },
    today_total_focus: { zh: '今日专注', en: 'Focus today' },
    checkin:       { zh: '考勤',   en: 'Check-in' },
    checkin_in:    { zh: '到位',   en: 'Clock in' },
    checkin_out:   { zh: '离开',   en: 'Clock out' },
    state_working: { zh: '工作中', en: 'Working' },
    state_resting: { zh: '休息中', en: 'Resting' },
    focus_timer:   { zh: '专注计时', en: 'Focus timer' },
    focus_title_ph:{ zh: '专注于…', en: 'Focusing on…' },
    start:         { zh: '开始', en: 'Start' },
    pause:         { zh: '暂停', en: 'Pause' },
    stop:          { zh: '结束', en: 'Stop' },
    quick_capture: { zh: '快速记录', en: 'Quick capture' },
    cap_task:      { zh: '任务',   en: 'Task' },
    cap_idea:      { zh: '想法',   en: 'Idea' },
    cap_contact:   { zh: '联系人', en: 'Contact' },
    cap_exp:       { zh: '实验',   en: 'Experiment' },
    todays_tasks:  { zh: '今日任务', en: "Today's tasks" },
    now:           { zh: '此刻', en: 'NOW' },
    no_events:     { zh: '今天还没有安排', en: 'Nothing scheduled yet' },
    min_unit:      { zh: '分钟', en: 'min' },
};

/** Translate a key into the current language; falls back to zh then the key itself. */
export function t(key: string, lang: Lang): string {
    const entry = SCHOLARIUM_STRINGS[key];
    if (!entry) return key;
    return entry[lang] || entry.zh || key;
}

/** Bind a language once and return a lightweight translate function. */
export function makeT(lang: Lang): (key: string) => string {
    return (key: string) => t(key, lang);
}
