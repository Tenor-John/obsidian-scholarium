// rss-feed-board.ts — 文献订阅工作台（RSS / Atom / Crossref）
import { App, Notice, Modal, TFile, requestUrl } from 'obsidian';
import type ChemELNPlugin from './main';
import { iconSvg } from './icons';
import { htmlToMarkdownArticle } from './web-clip';
import { summarizeArticle, type WriterSettings } from './vision-writer';

export interface RssFeed {
    id: string;
    title: string;
    url: string;
    siteUrl?: string;
    sourceType?: 'rss' | 'crossref';
    issn?: string;
    group?: string;
    addedAt: number;
    lastFetched?: number;
    error?: string;
}

export interface RssArticle {
    id: string;
    feedId: string;
    title: string;
    link: string;
    author?: string;
    affiliations?: string[];   // 研究机构（元数据，供知识图谱使用）
    summary: string;
    contentHtml?: string;
    imageUrl?: string;
    published: number;
    fetchedAt: number;
    read: boolean;
    starred: boolean;
    enriched?: boolean;
    abstractEdited?: boolean;   // 用户手动编辑过 Abstract（抓取不再覆盖）
    aiSummary?: string;
}

interface RssBoardData {
    feeds: RssFeed[];
    articles: RssArticle[];
    collapsedGroups?: string[];
    readerWidth?: number;
}

const UNGROUPED = '未分组';
type FeedFilter = 'all' | 'unread' | 'starred';
const MAX_ARTICLES = 1500;
const MAX_PER_FEED = 200;

export class RssFeedBoard {
    private app: App;
    private plugin: ChemELNPlugin;
    private container: HTMLElement | null = null;
    private data: RssBoardData = { feeds: [], articles: [] };

    private selectedFeedId: string | null = null;
    private selectedArticleId: string | null = null;
    private inlineWebUrl: string | null = null;
    private currentWebview: (HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> }) | null = null;
    private readerCoverSlot: HTMLElement | null = null;
    private readerCoverArticleId: string | null = null;
    private refreshAbstract: (() => void) | null = null;
    private refreshAiSummary: (() => void) | null = null;
    private filter: FeedFilter = 'all';
    private refreshing = false;

    constructor(app: App, plugin: ChemELNPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async load(): Promise<void> {
        try {
            const pluginData = await this.plugin.loadData() as Record<string, unknown> | null;
            const d = pluginData?.rssBoard as RssBoardData | undefined;
            this.data = { feeds: d?.feeds ?? [], articles: d?.articles ?? [], collapsedGroups: d?.collapsedGroups ?? [], readerWidth: d?.readerWidth };
        } catch (e) {
            console.error('[RssFeedBoard] 加载失败:', e);
            this.data = { feeds: [], articles: [] };
        }
    }

    async save(): Promise<void> {
        try {
            await this.plugin.updateData((pluginData) => { pluginData.rssBoard = this.data; });
        } catch (e) {
            console.error('[RssFeedBoard] 保存失败:', e);
        }
    }

    destroy(): void { /* 无定时器 */ }

    private rerender(): void {
        if (this.container) this.render(this.container);
    }

    render(container: HTMLElement): void {
        const prevStreamScroll = (this.container?.querySelector('.rss-stream') as HTMLElement | null)?.scrollTop ?? 0;
        const prevSidebarScroll = (this.container?.querySelector('.rss-sidebar') as HTMLElement | null)?.scrollTop ?? 0;

        this.container = container;
        container.empty();
        container.addClass('rss-root');

        const toolbar = container.createDiv({ cls: 'rss-toolbar' });
        const addWrap = toolbar.createDiv({ cls: 'rss-add-wrap' });
        const urlInput = addWrap.createEl('input', {
            cls: 'rss-add-input',
            attr: { type: 'text', placeholder: '粘贴 RSS/Atom 地址，或期刊 ISSN（如 0002-7863）回车添加…' },
        });
        const addBtn = addWrap.createEl('button', { cls: 'rss-btn rss-btn-primary', text: '添加订阅' });
        const submitAdd = () => {
            const url = urlInput.value.trim();
            if (url) { urlInput.value = ''; void this.addFeed(url); }
        };
        addBtn.onclick = submitAdd;
        urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdd(); });

        const refreshBtn = toolbar.createEl('button', { cls: 'rss-btn' });
        refreshBtn.appendChild(iconSvg('refresh', { size: 14 }));
        refreshBtn.appendChild(document.createTextNode(this.refreshing ? ' 刷新中…' : ' 全部刷新'));
        refreshBtn.disabled = this.refreshing || this.data.feeds.length === 0;
        refreshBtn.onclick = () => void this.refreshAll();

        container.createDiv({
            cls: 'rss-hint',
            text: '提示：ACS / RSC / Wiley / Cell 的 RSS 多已失效或被封，填期刊 ISSN 即可通过 Crossref 订阅最新文章。',
        });

        const selected = this.selectedArticleId
            ? this.data.articles.find(a => a.id === this.selectedArticleId)
            : null;
        if (!selected) this.selectedArticleId = null;

        const body = container.createDiv({ cls: 'rss-body' + (selected ? ' has-reader' : '') });
        const sidebar = body.createDiv({ cls: 'rss-sidebar' });
        const stream = body.createDiv({ cls: 'rss-stream' });
        this.renderSidebar(sidebar);
        this.renderStream(stream);
        if (selected) {
            const resizer = body.createDiv({ cls: 'rss-reader-resizer', attr: { title: '拖动调整宽度' } });
            const reader = body.createDiv({ cls: 'rss-reader-pane' });
            reader.style.width = (this.data.readerWidth || 460) + 'px';
            this.attachReaderResizer(body, resizer, reader);
            this.renderReaderPane(reader, selected);
        }

        if (prevStreamScroll) stream.scrollTop = prevStreamScroll;
        if (prevSidebarScroll) sidebar.scrollTop = prevSidebarScroll;
    }

    private renderSidebar(sidebar: HTMLElement): void {
        sidebar.empty();
        sidebar.createEl('div', { cls: 'rss-sidebar-title', text: '订阅源' });

        const unreadOf = (feedId: string | null) =>
            this.data.articles.filter(a => !a.read && (feedId === null || a.feedId === feedId)).length;

        const mkItem = (label: string, count: number, active: boolean, onClick: () => void, feed?: RssFeed) => {
            const item = sidebar.createDiv({ cls: 'rss-feed-item' + (active ? ' active' : '') });
            const name = item.createDiv({ cls: 'rss-feed-name' });
            name.setText(label);
            if (feed?.error) { name.addClass('has-error'); name.setAttribute('title', '抓取失败：' + feed.error); }
            if (count > 0) item.createDiv({ cls: 'rss-feed-count', text: String(count) });
            item.onclick = onClick;
            if (feed) {
                const grp = item.createDiv({ cls: 'rss-feed-act', attr: { title: '设置分组' } });
                grp.appendChild(iconSvg('folder', { size: 13 }));
                grp.onclick = (e) => { e.stopPropagation(); this.editFeedGroup(feed); };
                const del = item.createDiv({ cls: 'rss-feed-act rss-feed-del', attr: { title: '删除订阅' } });
                del.appendChild(iconSvg('trash', { size: 13 }));
                del.onclick = (e) => { e.stopPropagation(); void this.removeFeed(feed); };
            }
            return item;
        };

        mkItem('📚 全部文章', unreadOf(null), this.selectedFeedId === null, () => {
            this.selectedFeedId = null; this.rerender();
        });

        if (this.data.feeds.length === 0) {
            sidebar.createDiv({ cls: 'rss-empty-hint', text: '还没有订阅源，在上方粘贴地址添加。' });
            return;
        }

        const groups = new Map<string, RssFeed[]>();
        for (const feed of this.data.feeds) {
            const g = feed.group || UNGROUPED;
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g)!.push(feed);
        }
        const groupNames = [...groups.keys()].sort((a, b) =>
            a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b));
        const collapsed = new Set(this.data.collapsedGroups ?? []);

        for (const gName of groupNames) {
            const feeds = groups.get(gName)!.sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url));
            const groupUnread = feeds.reduce((n, f) => n + unreadOf(f.id), 0);
            const isCollapsed = collapsed.has(gName);

            const header = sidebar.createDiv({ cls: 'rss-group-header' + (isCollapsed ? ' collapsed' : '') });
            header.appendChild(iconSvg(isCollapsed ? 'chevronRight' : 'chevronDown', { size: 14 }));
            header.createSpan({ cls: 'rss-group-name', text: gName });
            if (groupUnread > 0) header.createDiv({ cls: 'rss-feed-count', text: String(groupUnread) });
            header.onclick = () => this.toggleGroup(gName);

            if (isCollapsed) continue;
            for (const feed of feeds) {
                mkItem(feed.title || feed.url, unreadOf(feed.id), this.selectedFeedId === feed.id, () => {
                    this.selectedFeedId = feed.id; this.rerender();
                }, feed);
            }
        }
    }

    private toggleGroup(gName: string): void {
        const set = new Set(this.data.collapsedGroups ?? []);
        if (set.has(gName)) set.delete(gName); else set.add(gName);
        this.data.collapsedGroups = [...set];
        void this.save();
        this.rerender();
    }

    private editFeedGroup(feed: RssFeed): void {
        const existing = [...new Set(this.data.feeds.map(f => f.group || UNGROUPED))].filter(g => g !== UNGROUPED);
        new GroupEditModal(this.app, this.plugin, feed.group || '', existing, async (val) => {
            const v = val.trim();
            feed.group = v && v !== UNGROUPED ? v : undefined;
            await this.save();
            this.rerender();
        }).open();
    }

    private renderStream(stream: HTMLElement): void {
        stream.empty();
        const bar = stream.createDiv({ cls: 'rss-filter-bar' });
        const filters: Array<[FeedFilter, string]> = [['all', '全部'], ['unread', '未读'], ['starred', '⭐ 收藏']];
        for (const [key, label] of filters) {
            const b = bar.createEl('button', { cls: 'rss-filter' + (this.filter === key ? ' active' : ''), text: label });
            b.onclick = () => { this.filter = key; this.rerender(); };
        }
        const spacer = bar.createDiv({ cls: 'rss-filter-spacer' });
        spacer.setCssProps({ "flex": '1' });
        const visible = this.getVisibleArticles();
        if (visible.some(a => !a.read)) {
            const mark = bar.createEl('button', { cls: 'rss-filter', text: '全部标为已读' });
            mark.onclick = () => { visible.forEach(a => a.read = true); void this.save(); this.rerender(); };
        }

        const list = stream.createDiv({ cls: 'rss-card-list' });
        if (visible.length === 0) {
            list.createDiv({ cls: 'rss-empty-hint', text: this.data.feeds.length ? '没有符合条件的文章，点「全部刷新」抓取最新内容。' : '添加订阅源后即可在这里看到文献信息流。' });
            return;
        }
        for (const a of visible) this.renderCard(list, a);
    }

    private getVisibleArticles(): RssArticle[] {
        return this.data.articles
            .filter(a => this.selectedFeedId === null || a.feedId === this.selectedFeedId)
            .filter(a => this.filter === 'all' || (this.filter === 'unread' ? !a.read : a.starred))
            .sort((a, b) => b.published - a.published);
    }

    private feedTitle(feedId: string): string {
        return this.data.feeds.find(f => f.id === feedId)?.title ?? '';
    }

    private renderCard(list: HTMLElement, a: RssArticle): void {
        const card = list.createDiv({ cls: 'rss-card' + (a.read ? ' is-read' : '') + (this.selectedArticleId === a.id ? ' is-active' : '') });
        if (a.imageUrl) {
            const cover = card.createDiv({ cls: 'rss-card-cover' });
            const img = cover.createEl('img', { attr: { src: a.imageUrl, loading: 'lazy', alt: '' } });
            img.onerror = () => cover.remove();
        }
        const bodyWrap = card.createDiv({ cls: 'rss-card-body' });
        const top = bodyWrap.createDiv({ cls: 'rss-card-top' });
        top.createSpan({ cls: 'rss-card-feed', text: this.feedTitle(a.feedId) });
        if (a.published) top.createSpan({ cls: 'rss-card-date', text: this.fmtDate(a.published) });
        bodyWrap.createEl('h4', { cls: 'rss-card-title', text: a.title || '(无标题)' });
        // 滚动区：抓到摘要 / AI 总结才显示（图片+标题固定，这块固定高度内滚动）
        const absText = (a.contentHtml ? stripHtml(a.contentHtml) : '') || a.summary || '';
        if (absText || a.aiSummary) {
            const sc = bodyWrap.createDiv({ cls: 'rss-card-scroll' });
            if (absText) {
                sc.createDiv({ cls: 'rss-card-sec-label', text: '摘要' });
                sc.createDiv({ cls: 'rss-card-sec-text', text: absText });
            }
            if (a.aiSummary) {
                sc.createDiv({ cls: 'rss-card-sec-label', text: '🤖 AI 总结' });
                appendSanitizedHtml(sc.createDiv({ cls: 'rss-card-sec-text rss-card-ai' }), mdToHtml(a.aiSummary));
            }
        }

        const actions = bodyWrap.createDiv({ cls: 'rss-card-actions' });
        const starBtn = actions.createEl('button', { cls: 'rss-card-btn' + (a.starred ? ' active' : '') });
        starBtn.appendChild(iconSvg('star', { size: 14 }));
        starBtn.appendChild(document.createTextNode(a.starred ? ' 已收藏' : ' 收藏'));
        starBtn.onclick = (e) => { e.stopPropagation(); a.starred = !a.starred; void this.save(); this.rerender(); };
        const readBtn = actions.createEl('button', { cls: 'rss-card-btn' });
        readBtn.appendChild(iconSvg('check', { size: 14 }));
        readBtn.appendChild(document.createTextNode(a.read ? ' 标为未读' : ' 标为已读'));
        readBtn.onclick = (e) => { e.stopPropagation(); a.read = !a.read; void this.save(); this.rerender(); };

        card.onclick = () => this.openReader(a);
    }

    private openReader(a: RssArticle): void {
        if (!a.read) a.read = true;
        this.selectedArticleId = a.id;
        this.inlineWebUrl = null;
        void this.save();
        this.rerender();
    }

    private attachReaderResizer(body: HTMLElement, handle: HTMLElement, pane: HTMLElement): void {
        handle.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = pane.getBoundingClientRect().width;
            body.addClass('is-resizing');
            const onMove = (ev: MouseEvent) => {
                const next = Math.min(Math.max(startW + (startX - ev.clientX), 320), 980);
                pane.style.width = next + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                body.removeClass('is-resizing');
                this.data.readerWidth = Math.round(pane.getBoundingClientRect().width);
                void this.save();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    private renderReaderPane(container: HTMLElement, a: RssArticle): void {
        container.empty();
        const head = container.createDiv({ cls: 'rss-reader-head' });
        const topRow = head.createDiv({ cls: 'rss-reader-toprow' });
        topRow.createDiv({ cls: 'rss-reader-feed', text: this.feedTitle(a.feedId) });
        const closeBtn = topRow.createDiv({ cls: 'rss-reader-close', attr: { title: '关闭' } });
        closeBtn.appendChild(iconSvg('close', { size: 16 }));
        closeBtn.onclick = () => { this.selectedArticleId = null; this.currentWebview = null; this.rerender(); };
        head.createEl('h2', { cls: 'rss-reader-title', text: a.title || '(无标题)' });

        const scroll = container.createDiv({ cls: 'rss-reader-scroll' });

        const meta = scroll.createDiv({ cls: 'rss-reader-meta' });
        const renderMeta = () => {
            meta.empty();
            if (a.author) meta.createSpan({ cls: 'rss-reader-author', text: a.author });
            if (a.published) meta.createSpan({ text: new Date(a.published).toLocaleString() });
            if (a.link) {
                const link = meta.createEl('a', { cls: 'rss-reader-link', text: doiOrHost(a.link), href: a.link });
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener');
            }
            // 研究机构（作者下方）
            if (a.affiliations?.length) {
                const af = meta.createDiv({ cls: 'rss-reader-affil' });
                af.createSpan({ cls: 'rss-reader-affil-label', text: '机构 · ' });
                af.appendText(a.affiliations.join('；'));
            }
        };
        renderMeta();

        const bodyEl = scroll.createDiv({ cls: 'rss-reader-body' });
        const absHead = bodyEl.createDiv({ cls: 'rss-reader-ai-head' });
        absHead.createSpan({ cls: 'rss-reader-section-label', text: 'Abstract' });
        const absEdit = absHead.createEl('button', { cls: 'rss-btn rss-btn-sm', text: '编辑' });
        absEdit.onclick = () => new TextEditModal(this.app, this.plugin, '编辑 Abstract', stripHtml(a.contentHtml || a.summary || ''), async (val) => {
            const t = val.trim();
            a.summary = t.slice(0, 600);
            a.contentHtml = t ? `<p>${t.slice(0, 4000).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : undefined;
            a.enriched = true;
            a.abstractEdited = true;
            await this.save();
            renderContent();
        }).open();
        const contentBox = bodyEl.createDiv({ cls: 'rss-reader-content' });
        const renderContent = () => {
            contentBox.empty();
            // 直接渲染纯文本，保证整段摘要完整显示（避免 HTML 注入的渲染怪问题）
            const text = (a.contentHtml ? stripHtml(a.contentHtml) : '') || (a.summary || '');
            if (text) contentBox.createDiv({ cls: 'rss-abstract-text' }).setText(text);
            else contentBox.createDiv({ cls: 'rss-empty-hint', text: '暂无摘要——打开网页可自动抓取，或点「编辑」手动填写。' });
        };
        renderContent();
        this.refreshAbstract = renderContent;

        const coverSlot = bodyEl.createDiv({ cls: 'rss-reader-cover-slot' });
        this.readerCoverSlot = coverSlot;
        this.readerCoverArticleId = a.id;
        if (a.imageUrl) this.fillCoverImage(coverSlot, a.imageUrl);

        const doi = extractDoi(a);
        const thin = !a.contentHtml || stripHtml(a.contentHtml).length < 60;
        if (doi && thin && !a.enriched) {
            const loading = bodyEl.createDiv({ cls: 'rss-reader-loading', text: '正在从 Crossref 获取作者与摘要…' });
            void enrichFromCrossref(doi, a).then((ok) => {
                loading.remove();
                a.enriched = true;
                if (ok) { renderMeta(); renderContent(); void this.save(); }
            }).catch(() => { loading.remove(); });
        }

        const footer = scroll.createDiv({ cls: 'rss-reader-footer' });
        const starBtn = footer.createEl('button', { cls: 'rss-btn' + (a.starred ? ' rss-btn-primary' : ''), text: a.starred ? '★ 已收藏' : '☆ 收藏' });
        starBtn.onclick = () => {
            a.starred = !a.starred;
            starBtn.setText(a.starred ? '★ 已收藏' : '☆ 收藏');
            starBtn.toggleClass('rss-btn-primary', a.starred);
            void this.save();
        };
        if (a.link) {
            const webOpen = this.inlineWebUrl === a.link;
            const inlineBtn = footer.createEl('button', { cls: 'rss-btn' + (webOpen ? ' rss-btn-primary' : ''), text: webOpen ? '收起网页' : '在此打开网页' });
            inlineBtn.onclick = () => { this.inlineWebUrl = webOpen ? null : (a.link || null); this.rerender(); };
            const ext = footer.createEl('button', { cls: 'rss-btn', text: '浏览器打开 ↗' });
            ext.onclick = () => window.open(a.link, '_blank');
        }

        // AI 总结放在网页框上方，避免被 64vh 的网页框顶到看不见
        this.renderAiSummary(scroll, a);

        if (a.link && this.inlineWebUrl === a.link) this.renderInlineWeb(scroll, a);
    }

    private renderAiSummary(container: HTMLElement, a: RssArticle): void {
        const sec = container.createDiv({ cls: 'rss-reader-ai' });
        const head = sec.createDiv({ cls: 'rss-reader-ai-head' });
        head.createSpan({ cls: 'rss-reader-section-label', text: '🤖 AI 总结' });
        const btnWrap = head.createDiv({ cls: 'rss-reader-ai-btns' });
        const editBtn = btnWrap.createEl('button', { cls: 'rss-btn rss-btn-sm', text: '编辑' });
        const btn = btnWrap.createEl('button', { cls: 'rss-btn', text: a.aiSummary ? '重新总结' : '生成总结' });
        btn.onclick = () => void this.summarizeCurrent(a, btn);
        const bodyWrap = sec.createDiv();
        const renderBody = () => {
            bodyWrap.empty();
            btn.setText(a.aiSummary ? '重新总结' : '生成总结');
            if (a.aiSummary) appendSanitizedHtml(bodyWrap.createDiv({ cls: 'rss-reader-ai-body' }), mdToHtml(a.aiSummary));
            else bodyWrap.createDiv({ cls: 'rss-empty-hint', text: '点「生成总结」用配置的 AI 总结（先打开网页基于全文），或点「编辑」手动填写。' });
        };
        renderBody();
        this.refreshAiSummary = renderBody;
        editBtn.onclick = () => new TextEditModal(this.app, this.plugin, '编辑 AI 总结（支持 Markdown）', a.aiSummary || '', async (val) => {
            a.aiSummary = val.trim() || undefined;
            await this.save();
            renderBody();
        }).open();
    }

    private buildWriterSettings(): WriterSettings {
        const s = this.plugin.settings;
        // 文献订阅用独立的 RSS AI 设置；key/型号留空时智能复用主 AI（同 provider）
        const sameAsMain = String(s.rssAiProvider) === String(s.aiProvider);
        return {
            provider: s.rssAiProvider,
            apiKey: s.rssAiApiKey || (sameAsMain || s.rssAiProvider === 'deepseek' ? s.aiApiKey : ''),
            model: s.rssAiModel || (sameAsMain ? s.aiModel : '') || undefined,
            customEndpoint: s.rssAiCustomEndpoint || undefined,
        };
    }

    private async summarizeCurrent(a: RssArticle, btn: HTMLElement): Promise<void> {
        const writer = this.buildWriterSettings();
        if (!writer.apiKey) { new Notice('请先在设置 → 文献订阅(RSS) 里配置 AI API Key'); return; }
        btn.setAttribute('disabled', 'true');
        const prev = btn.textContent;
        btn.setText('总结中…');
        try {
            let bodyText = stripHtml(a.contentHtml || a.summary || '');
            const live = this.inlineWebUrl === a.link ? this.currentWebview : null;
            if (live && typeof live.executeJavaScript === 'function' && live.isConnected) {
                try {
                    btn.setText('读取网页正文…');
                    // 直接取页面纯文本（页面端瞬时，不在本地跑 Readability，避免卡住）
                    const pageText = String((await live.executeJavaScript(
                        `(function(){var el=document.querySelector('.hlFld-Fulltext, .article_content, .articleBody, #articleBody, [class*="fulltext" i], article, main, [role="main"]')||document.body;return (el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();})()`
                    )) ?? '');
                    if (pageText && pageText.length > bodyText.length) bodyText = pageText;
                } catch { /* 退回摘要 */ }
                btn.setText('总结中…');
            }
            if (bodyText.trim().length < 20) {
                new Notice('暂无足够文本可总结，请先打开网页或等摘要补全');
                btn.removeAttribute('disabled'); btn.setText(prev || '生成总结');
                return;
            }
            // 限制输入长度：过大的请求体在部分网络下会被重置(ERR_CONNECTION_RESET)
            const text = [a.title, a.author ? '作者：' + a.author : '', a.affiliations?.length ? '机构：' + a.affiliations.join('; ') : '', bodyText.slice(0, 8000)].filter(Boolean).join('\n\n');
            const summary = await summarizeArticle(text, writer, this.plugin.settings.rssAiPrompt);
            a.aiSummary = summary;
            await this.save();
            btn.removeAttribute('disabled');
            if (this.refreshAiSummary) this.refreshAiSummary(); else this.rerender();
        } catch (e) {
            new Notice('AI 总结失败：' + (e as Error).message);
            btn.removeAttribute('disabled'); btn.setText(prev || '生成总结');
        }
    }

    private fillCoverImage(slot: HTMLElement, url: string): void {
        slot.empty();
        const cover = slot.createDiv({ cls: 'rss-reader-cover' });
        const im = cover.createEl('img', { attr: { src: url, alt: '' } });
        im.onerror = () => cover.remove();
    }

    private renderInlineWeb(container: HTMLElement, a: RssArticle): void {
        const url = a.link;
        const web = container.createDiv({ cls: 'rss-reader-web' });
        const bar = web.createDiv({ cls: 'rss-web-bar' });
        bar.createSpan({ cls: 'rss-web-url', text: url.replace(/^https?:\/\//, '') });
        const clipBtn = bar.createEl('button', { cls: 'rss-web-btn', attr: { title: '抓取网页正文保存为笔记' } });
        clipBtn.appendChild(iconSvg('submit', { size: 13 }));
        const aiBtn = bar.createEl('button', { cls: 'rss-web-btn', attr: { title: 'AI 总结这篇文章' } });
        aiBtn.appendChild(iconSvg('brain', { size: 14 }));
        const reloadBtn = bar.createEl('button', { cls: 'rss-web-btn', attr: { title: '刷新' } });
        reloadBtn.appendChild(iconSvg('refresh', { size: 13 }));
        const extBtn = bar.createEl('button', { cls: 'rss-web-btn', attr: { title: '在浏览器打开' } });
        extBtn.appendChild(iconSvg('arrowRight', { size: 13 }));
        const closeBtn = bar.createEl('button', { cls: 'rss-web-btn', attr: { title: '收起网页' } });
        closeBtn.appendChild(iconSvg('close', { size: 14 }));

        const wv = document.createElement('webview') as HTMLElement & {
            reload?: () => void; executeJavaScript?: (code: string) => Promise<unknown>; getURL?: () => string;
        };
        wv.setAttribute('src', url);
        wv.setAttribute('allowpopups', '');
        wv.addClass('rss-webview');
        web.appendChild(wv);
        this.currentWebview = wv;

        wv.addEventListener('did-finish-load', () => { void this.grabPageMeta(wv, a); });

        reloadBtn.onclick = () => { try { wv.reload?.(); } catch { /* noop */ } };
        extBtn.onclick = () => window.open(url, '_blank');
        closeBtn.onclick = () => { this.inlineWebUrl = null; this.currentWebview = null; this.rerender(); };
        clipBtn.onclick = () => void this.clipWebToNote(wv, a, clipBtn);
        aiBtn.onclick = () => void this.summarizeCurrent(a, aiBtn);
    }

    private async grabPageMeta(wv: { executeJavaScript?: (code: string) => Promise<unknown> }, a: RssArticle, attempt = 0): Promise<void> {
        if (typeof wv.executeJavaScript !== 'function') return;
        let changed = false;
        try {
            if (!a.imageUrl) {
                const img = String((await wv.executeJavaScript(
                    `(document.querySelector('meta[property="og:image"]')||document.querySelector('meta[name="og:image"]')||{}).content||''`
                )) ?? '').trim();
                if (img) {
                    a.imageUrl = img; changed = true;
                    if (this.readerCoverSlot && this.readerCoverArticleId === a.id && !this.readerCoverSlot.hasChildNodes()) {
                        this.fillCoverImage(this.readerCoverSlot, img);
                    }
                }
            }
            // 摘要：用户没手动编辑过时，从页面抽取真实摘要并按需替换（RSS 短讯/meta 垃圾）
            if (!a.abstractEdited) {
                const curLen = stripHtml(a.contentHtml || a.summary || '').length;
                const abs = await this.extractPageAbstract(wv);
                // 抓到真实摘要（≥120）且明显比现有更长 → 替换；现有本就很短也替换
                if (abs.length >= 120 && (curLen < 120 || abs.length > curLen * 1.15)) {
                    a.summary = abs.slice(0, 600);
                    a.contentHtml = `<p>${abs.slice(0, 4000).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
                    changed = true;
                    if (this.selectedArticleId === a.id && this.refreshAbstract) this.refreshAbstract();
                } else if (curLen < 120 && abs.length < 120 && attempt < 3) {
                    // 摘要可能异步渲染，稍后重试
                    window.setTimeout(() => { void this.grabPageMeta(wv, a, attempt + 1); }, 2000);
                }
            }
            // 研究机构（Highwire citation_author_institution，去重）
            if (!a.affiliations?.length) {
                const raw = String((await wv.executeJavaScript(
                    `Array.from(document.querySelectorAll('meta[name="citation_author_institution"]')).map(function(m){return m.content;}).join('|||')`
                )) ?? '').trim();
                const affs = [...new Set(raw.split('|||').map(x => x.trim()).filter(Boolean))];
                if (affs.length) { a.affiliations = affs.slice(0, 12); changed = true; }
            }
        } catch (e) { console.warn('[RssFeedBoard] grabPageMeta:', e); }
        if (changed) void this.save();
    }

    // 在页面端抽取真实摘要：优先出版社专用容器（取最长），meta 仅兜底
    private async extractPageAbstract(wv: { executeJavaScript?: (code: string) => Promise<unknown> }): Promise<string> {
        if (typeof wv.executeJavaScript !== 'function') return '';
        try {
            const abs = String((await wv.executeJavaScript(`(function(){
                function t(el){return el?(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim():'';}
                var sels=[
                    '#Abs1-content','#abstract-content','#Abs1','div[id^="Abs"][id$="-content"]',
                    '.articleBody_abstractText','.hlFld-Abstract','.abstractSection','.NLM_abstract',
                    'section[data-title="Abstract" i]','section[id*="abstract" i]',
                    '.c-article-section__content','div.article-section__content',
                    'div[class*="abstract" i]','#abstract','#abstracts'
                ];
                var best='';
                for(var i=0;i<sels.length;i++){
                    var ns=document.querySelectorAll(sels[i]);
                    for(var j=0;j<ns.length;j++){ var s=t(ns[j]); if(s.length>best.length) best=s; }
                }
                // 去掉可能的 "Abstract" 前缀
                best=best.replace(/^\\s*abstract[\\s:：]*/i,'').trim();
                if(best.length<120){
                    var m=document.querySelector('meta[name="citation_abstract"],meta[name="dc.Description"],meta[name="description"],meta[property="og:description"]');
                    var meta=m&&m.content?m.content.trim():'';
                    if(meta.length>best.length) best=meta;
                }
                return best||'';
            })()`)) ?? '').trim();
            return abs;
        } catch (e) {
            console.warn('[RssFeedBoard] extractPageAbstract:', e);
            return '';
        }
    }

    private async clipWebToNote(
        wv: { executeJavaScript?: (code: string) => Promise<unknown>; getURL?: () => string },
        a: RssArticle,
        btn: HTMLElement,
    ): Promise<void> {
        if (typeof wv.executeJavaScript !== 'function') { new Notice('当前环境不支持抓取网页内容（仅桌面端可用）'); return; }
        btn.setAttribute('disabled', 'true');
        try {
            new Notice('正在抓取网页正文…');
            const html = String((await wv.executeJavaScript('document.documentElement.outerHTML')) ?? '');
            if (!html || html.length < 50) throw new Error('未读取到网页内容，请等网页加载完再试');
            const realUrl = (typeof wv.getURL === 'function' && wv.getURL()) || a.link;
            const article = htmlToMarkdownArticle(html, realUrl);
            // 针对性抓全文容器（Readability 有时只取到部分），取更完整的版本
            try {
                const fullHtml = String((await wv.executeJavaScript(
                    `(function(){var el=document.querySelector('.hlFld-Fulltext, .article_content, .articleBody, #articleBody, [class*="fulltext" i], article, main, [role="main"]')||document.body;return el?el.innerHTML:'';})()`
                )) ?? '');
                if (fullHtml && fullHtml.length > 200) {
                    const art2 = htmlToMarkdownArticle('<html><head><base href="' + realUrl + '"></head><body>' + fullHtml + '</body></html>', realUrl);
                    if (art2.markdown && art2.markdown.length > article.markdown.length) {
                        article.markdown = art2.markdown;
                        if (!article.excerpt && art2.excerpt) article.excerpt = art2.excerpt;
                    }
                }
            } catch { /* 退回 Readability 结果 */ }
            if (!article.markdown) throw new Error('未能从该网页提取到正文');
            const ogImg = /<meta[^>]+(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1]
                || /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image["']/i.exec(html)?.[1];
            if (ogImg && !a.imageUrl) a.imageUrl = ogImg;
            // 抓取时把页面真实 Abstract 填到 Abstract 区（用户没手动编辑过时）
            if (!a.abstractEdited) {
                const curLen = stripHtml(a.contentHtml || a.summary || '').length;
                let abs = await this.extractPageAbstract(wv);
                if (abs.length < 40) abs = stripHtml(article.excerpt || '');
                if (abs.length >= 120 && (curLen < 120 || abs.length > curLen * 1.15)) {
                    a.summary = abs.slice(0, 600);
                    a.contentHtml = `<p>${abs.slice(0, 4000).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
                    if (this.selectedArticleId === a.id && this.refreshAbstract) this.refreshAbstract();
                }
            }
            void this.save();
            const file = await this.saveClipNote(article, realUrl);
            new Notice('已保存为笔记：' + file.basename);
            await this.app.workspace.getLeaf(false).openFile(file);
        } catch (e) {
            new Notice('保存失败：' + (e as Error).message);
            console.warn('[RssFeedBoard] clipWebToNote:', e);
        } finally {
            btn.removeAttribute('disabled');
        }
    }

    private async saveClipNote(article: { title: string; byline?: string; excerpt?: string; markdown: string }, url: string): Promise<TFile> {
        const root = (this.plugin.settings.experimentsFolder?.replace(/\/+$/, '') || 'Experiments');
        const folder = `${root}/WebClips`;
        for (const p of [root, folder]) {
            if (!this.app.vault.getAbstractFileByPath(p)) await this.app.vault.createFolder(p);
        }
        const q = (s: string) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        const now = new Date();
        const frontLines = ['---', `title: ${q(article.title)}`, `source: ${q(url)}`];
        if (article.byline) frontLines.push(`author: ${q(article.byline)}`);
        frontLines.push(`clipped: ${now.toISOString()}`);
        frontLines.push('tags: [web-clip, 文献订阅]');
        frontLines.push('---');
        const body = `# ${article.title}\n\n> 来源：[${url}](${url})${article.byline ? ' · ' + article.byline : ''}\n\n${article.markdown}\n`;
        const base = (article.title || '网页剪藏').replace(/[\\/:*?"<>|#^[\]]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '网页剪藏';
        const dateStr = now.toISOString().slice(0, 10);
        let path = `${folder}/${dateStr}-${base}.md`;
        let n = 2;
        while (this.app.vault.getAbstractFileByPath(path)) path = `${folder}/${dateStr}-${base}-${n++}.md`;
        return this.app.vault.create(path, frontLines.join('\n') + '\n\n' + body);
    }

    private async addFeed(input: string): Promise<void> {
        const raw = input.trim();
        const newId = () => 'feed-' + Date.now() + '-' + Math.floor(Math.random() * 1e4);
        const issnCandidate = raw.replace(/^issn[:\s]*/i, '').trim();
        if (/^\d{4}-\d{3}[\dxX]$/.test(issnCandidate)) {
            const issn = issnCandidate.toUpperCase();
            if (this.data.feeds.some(f => f.sourceType === 'crossref' && f.issn === issn)) { new Notice('该期刊（ISSN）已订阅。'); return; }
            const feed: RssFeed = { id: newId(), title: 'ISSN ' + issn, url: 'crossref:' + issn, sourceType: 'crossref', issn, addedAt: Date.now() };
            this.data.feeds.push(feed);
            await this.save();
            this.rerender();
            new Notice('正在通过 Crossref 抓取期刊…');
            await this.refreshFeed(feed);
            return;
        }
        const normalized = raw.replace(/^feed:\/\//i, 'https://');
        if (this.data.feeds.some(f => f.url === normalized)) { new Notice('该订阅源已存在。'); return; }
        const feed: RssFeed = { id: newId(), title: normalized, url: normalized, sourceType: 'rss', addedAt: Date.now() };
        this.data.feeds.push(feed);
        await this.save();
        this.rerender();
        new Notice('正在抓取订阅…');
        await this.refreshFeed(feed);
    }

    private async removeFeed(feed: RssFeed): Promise<void> {
        this.data.feeds = this.data.feeds.filter(f => f.id !== feed.id);
        this.data.articles = this.data.articles.filter(a => a.feedId !== feed.id);
        if (this.selectedFeedId === feed.id) this.selectedFeedId = null;
        await this.save();
        this.rerender();
    }

    private async refreshAll(): Promise<void> {
        if (this.refreshing || this.data.feeds.length === 0) return;
        this.refreshing = true;
        this.rerender();
        try {
            for (const feed of this.data.feeds) await this.refreshFeed(feed, false);
        } finally {
            this.refreshing = false;
            this.trimArticles();
            await this.save();
            this.rerender();
        }
    }

    private async refreshFeed(feed: RssFeed, persist = true): Promise<void> {
        try {
            const parsed = feed.sourceType === 'crossref' ? await this.fetchCrossref(feed) : await this.fetchRss(feed);
            if (!parsed) throw new Error('无法解析为 RSS/Atom');
            if (parsed.title) feed.title = parsed.title;
            feed.siteUrl = parsed.siteUrl;
            feed.lastFetched = Date.now();
            feed.error = undefined;
            const existing = new Set(this.data.articles.filter(a => a.feedId === feed.id).map(a => a.id));
            let added = 0;
            for (const item of parsed.items) {
                const id = item.id || item.link || (feed.id + ':' + item.title);
                if (!id || existing.has(id)) continue;
                existing.add(id);
                this.data.articles.push({
                    id, feedId: feed.id,
                    title: item.title || '(无标题)',
                    link: item.link || feed.siteUrl || '',
                    author: item.author,
                    summary: item.summary,
                    contentHtml: item.contentHtml,
                    imageUrl: item.image,
                    published: item.published || Date.now(),
                    fetchedAt: Date.now(),
                    read: false, starred: false,
                });
                added++;
            }
            if (persist) { this.trimArticles(); await this.save(); this.rerender(); }
            if (persist && added > 0) new Notice(`「${feed.title}」新增 ${added} 篇`);
        } catch (e) {
            feed.error = (e as Error).message || String(e);
            console.warn('[RssFeedBoard] 抓取失败:', feed.url, e);
            if (persist) { await this.save(); this.rerender(); new Notice(`抓取失败：${feed.error}`); }
        }
    }

    private async fetchRss(feed: RssFeed): Promise<ParsedFeed | null> {
        const res = await requestUrl({ url: feed.url, headers: { 'User-Agent': 'Mozilla/5.0 Scholarium-RSS' } });
        return parseFeedXml(res.text);
    }

    private async fetchCrossref(feed: RssFeed): Promise<ParsedFeed | null> {
        const issn = (feed.issn || '').trim();
        if (!issn) throw new Error('缺少 ISSN');
        const mailto = 'scholarium-obsidian@users.noreply.github.com';
        const fields = 'DOI,title,author,published,issued,created,abstract,container-title,URL';
        const url = `https://api.crossref.org/journals/${encodeURIComponent(issn)}/works`
            + `?sort=published&order=desc&rows=40&select=${fields}&mailto=${mailto}`;
        const res = await requestUrl({ url, headers: { 'User-Agent': `Scholarium-RSS (Obsidian plugin; mailto:${mailto})` } });
        const json = res.json as CrossrefResponse | undefined;
        const list = json?.message?.items;
        if (!Array.isArray(list)) throw new Error('Crossref 未返回文章数据（ISSN 可能有误）');
        const items = list.map(crossrefToItem);
        const journalTitle = list.find(it => it['container-title']?.length)?.['container-title']?.[0];
        return { title: journalTitle || ('ISSN ' + issn), siteUrl: '', items };
    }

    private trimArticles(): void {
        const byFeed = new Map<string, RssArticle[]>();
        for (const a of this.data.articles) {
            if (!byFeed.has(a.feedId)) byFeed.set(a.feedId, []);
            byFeed.get(a.feedId)!.push(a);
        }
        let kept: RssArticle[] = [];
        for (const arr of byFeed.values()) {
            arr.sort((x, y) => y.published - x.published);
            const starred = arr.filter(a => a.starred);
            const rest = arr.filter(a => !a.starred).slice(0, MAX_PER_FEED);
            kept = kept.concat(starred, rest);
        }
        if (kept.length > MAX_ARTICLES) {
            const starred = kept.filter(a => a.starred);
            const rest = kept.filter(a => !a.starred).sort((x, y) => y.published - x.published).slice(0, MAX_ARTICLES - starred.length);
            kept = starred.concat(rest);
        }
        this.data.articles = kept;
    }

    private fmtDate(ms: number): string {
        const d = new Date(ms);
        const diff = Date.now() - ms;
        if (diff < 36e5) return Math.max(1, Math.round(diff / 6e4)) + ' 分钟前';
        if (diff < 864e5) return Math.round(diff / 36e5) + ' 小时前';
        if (diff < 6048e5) return Math.round(diff / 864e5) + ' 天前';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
}

// ───────────────────────────────────────────────
// 解析与工具
// ───────────────────────────────────────────────
interface ParsedItem {
    id?: string; title: string; link?: string; author?: string;
    summary: string; contentHtml?: string; image?: string; published?: number;
}
interface ParsedFeed { title?: string; siteUrl?: string; items: ParsedItem[]; }

function firstImgSrc(html: string): string | undefined {
    if (!html) return undefined;
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
    return m ? m[1] : undefined;
}

function rssItemImage(el: Element, html: string): string | undefined {
    const media = el.getElementsByTagName('media:content')[0]
        || el.getElementsByTagName('media:thumbnail')[0]
        || el.getElementsByTagName('content')[0];
    const murl = media?.getAttribute('url');
    if (murl) return murl;
    const encs = el.getElementsByTagName('enclosure');
    for (let i = 0; i < encs.length; i++) {
        const enc = encs[i];
        if (!enc) continue;
        const type = enc.getAttribute('type') || '';
        const u = enc.getAttribute('url');
        if (u && (type.startsWith('image') || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u))) return u;
    }
    return firstImgSrc(html);
}

interface CrossrefDate { 'date-parts'?: number[][]; }
interface CrossrefAuthor { given?: string; family?: string; name?: string; affiliation?: Array<{ name?: string }>; }
interface CrossrefItem {
    DOI?: string; URL?: string; title?: string[]; 'container-title'?: string[];
    author?: CrossrefAuthor[]; abstract?: string;
    published?: CrossrefDate; issued?: CrossrefDate; created?: CrossrefDate;
}
interface CrossrefResponse { message?: { items?: CrossrefItem[] }; }

function crossrefDateMs(it: CrossrefItem): number {
    const parts = (it.published?.['date-parts'] || it.issued?.['date-parts'] || it.created?.['date-parts'] || [])[0];
    if (!parts || !parts.length) return 0;
    const [y, m = 1, d = 1] = parts;
    const ms = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
    return isNaN(ms) ? 0 : ms;
}

function jatsToHtml(abs: string): string {
    return abs.replace(/<\/?jats:/g, (m) => m.replace('jats:', ''));
}

function crossrefToItem(it: CrossrefItem): ParsedItem {
    const doi = (it.DOI || '').trim();
    const link = doi ? 'https://doi.org/' + doi : (it.URL || '');
    const rawTitle = (it.title && it.title[0]) ? it.title[0] : '(无标题)';
    const names = (it.author || []).map(a => a.name || [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean);
    const author = names.length > 3 ? names.slice(0, 3).join(', ') + ' 等' : names.join(', ');
    const absHtml = it.abstract ? jatsToHtml(it.abstract) : '';
    return {
        id: doi || link || rawTitle,
        title: stripHtml(rawTitle) || rawTitle,
        link,
        author: author || undefined,
        summary: absHtml ? stripHtml(absHtml).replace(/^Abstract[:：]?\s*/i, '').slice(0, 360) : '',
        contentHtml: absHtml || undefined,
        published: crossrefDateMs(it),
    };
}

function txt(el: Element | null | undefined): string {
    return (el?.textContent ?? '').trim();
}

function stripHtml(html: string): string {
    const tmp = new DOMParser().parseFromString(html || '', 'text/html');
    return (tmp.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function parseDate(s: string): number {
    if (!s) return 0;
    const t = Date.parse(s);
    return isNaN(t) ? 0 : t;
}

export function parseFeedXml(xml: string): ParsedFeed | null {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) {
        const alt = new DOMParser().parseFromString(xml, 'text/html');
        if (!alt.querySelector('item, entry')) return null;
        return parseFromDoc(alt);
    }
    return parseFromDoc(doc);
}

function getByTag(parent: Element | Document, name: string): Element | null {
    const direct = parent.getElementsByTagName(name);
    if (direct.length) return direct[0] ?? null;
    const all = parent.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
        const candidate = all[i];
        if (candidate?.localName === name) return candidate;
    }
    return null;
}

function extractDoi(a: RssArticle): string | undefined {
    const re = /10\.\d{4,9}\/[^\s"'<>)]+/;
    const fromLink = re.exec(a.link || '');
    if (fromLink) return fromLink[0].replace(/[.,;]+$/, '');
    const fromText = re.exec((a.summary || '') + ' ' + (a.contentHtml || ''));
    return fromText ? fromText[0].replace(/[.,;]+$/, '') : undefined;
}

async function enrichFromCrossref(doi: string, article: RssArticle): Promise<boolean> {
    const mailto = 'scholarium-obsidian@users.noreply.github.com';
    const url = `https://api.crossref.org/works/${encodeURI(doi)}?mailto=${mailto}`;
    const res = await requestUrl({ url, headers: { 'User-Agent': `Scholarium-RSS (Obsidian plugin; mailto:${mailto})` }, throw: false });
    if (res.status !== 200) return false;
    const msg = (res.json as { message?: CrossrefItem } | undefined)?.message;
    if (!msg) return false;
    let got = false;
    const names = (msg.author || []).map(a => a.name || [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean);
    if (names.length) { article.author = names.length > 8 ? names.slice(0, 8).join(', ') + ' 等' : names.join(', '); got = true; }
    // 研究机构（去重）
    const affs = [...new Set((msg.author || []).flatMap(a => (a.affiliation || []).map(x => (x.name || '').trim())).filter(Boolean))];
    if (affs.length) { article.affiliations = affs.slice(0, 12); got = true; }
    if (msg.abstract) {
        const html = jatsToHtml(msg.abstract);
        article.contentHtml = html;
        article.summary = stripHtml(html).replace(/^Abstract[:：]?\s*/i, '').slice(0, 360);
        got = true;
    }
    if (!article.link && doi) article.link = 'https://doi.org/' + doi;
    return got;
}

function parseFromDoc(doc: Document): ParsedFeed | null {
    const atomFeed = doc.querySelector('feed');
    const rssChannel = doc.querySelector('channel');

    if (rssChannel) {
        const title = txt(getByTag(rssChannel, 'title'));
        const siteUrl = txt(getByTag(rssChannel, 'link'));
        const itemEls = Array.from(doc.getElementsByTagName('item'));
        const items: ParsedItem[] = itemEls.map((el) => {
            const contentHtml = txt(getByTag(el, 'encoded')) || txt(getByTag(el, 'description'));
            const desc = txt(getByTag(el, 'description'));
            return {
                id: txt(getByTag(el, 'guid')) || txt(getByTag(el, 'link')),
                title: txt(getByTag(el, 'title')),
                link: txt(getByTag(el, 'link')),
                author: txt(getByTag(el, 'creator')) || txt(getByTag(el, 'author')) || undefined,
                summary: stripHtml(desc).slice(0, 360),
                contentHtml: contentHtml || undefined,
                image: rssItemImage(el, contentHtml),
                published: parseDate(txt(getByTag(el, 'pubDate')) || txt(getByTag(el, 'date'))),
            };
        });
        return { title, siteUrl, items };
    }

    if (atomFeed) {
        const title = txt(getByTag(atomFeed, 'title'));
        let siteUrl = '';
        const links = atomFeed.getElementsByTagName('link');
        for (let i = 0; i < links.length; i++) {
            const l = links[i];
            if (!l) continue;
            if (l.parentElement !== atomFeed) continue;
            const rel = l.getAttribute('rel');
            if (!rel || rel === 'alternate') { siteUrl = l.getAttribute('href') || ''; break; }
        }
        const entryEls = Array.from(doc.getElementsByTagName('entry'));
        const items: ParsedItem[] = entryEls.map((el) => {
            let link = '';
            const elinks = el.getElementsByTagName('link');
            for (let i = 0; i < elinks.length; i++) {
                const elink = elinks[i];
                if (!elink) continue;
                const rel = elink.getAttribute('rel');
                if (!rel || rel === 'alternate') { link = elink.getAttribute('href') || ''; break; }
            }
            const content = txt(getByTag(el, 'content'));
            const summary = txt(getByTag(el, 'summary')) || content;
            const authorEl = getByTag(el, 'author');
            return {
                id: txt(getByTag(el, 'id')) || link,
                title: txt(getByTag(el, 'title')),
                link,
                author: authorEl ? txt(getByTag(authorEl, 'name')) : undefined,
                summary: stripHtml(summary).slice(0, 360),
                contentHtml: content || undefined,
                image: firstImgSrc(content) || (el.getElementsByTagName('media:content')[0]?.getAttribute('url') ?? undefined),
                published: parseDate(txt(getByTag(el, 'published')) || txt(getByTag(el, 'updated'))),
            };
        });
        return { title, siteUrl, items };
    }

    return null;
}

function appendSanitizedHtml(container: HTMLElement, html: string): void {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(n => n.remove());
    doc.querySelectorAll('*').forEach((node) => {
        for (const attr of Array.from(node.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim().toLowerCase();
            if (name.startsWith('on') || value.startsWith('javascript:')) node.removeAttribute(attr.name);
        }
        if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener'); }
    });
    // 追加 body 的子节点（而不是整个 <body> 元素，避免嵌套 body 渲染异常）
    const imported = document.importNode(doc.body, true);
    while (imported.firstChild) container.appendChild(imported.firstChild);
}

function mdToHtml(md: string): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (t: string) => esc(t)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
    const lines = md.split(/\r?\n/);
    let html = '';
    let inList = false;
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) { if (inList) { html += '</ul>'; inList = false; } continue; }
        const li = /^[-*]\s+(.*)$/.exec(line);
        const h = /^(#{1,4})\s+(.*)$/.exec(line);
        if (li) {
            if (!inList) { html += '<ul>'; inList = true; }
            html += `<li>${inline(li[1] ?? '')}</li>`;
        } else {
            if (inList) { html += '</ul>'; inList = false; }
            if (h) html += `<p><strong>${inline(h[2] ?? '')}</strong></p>`;
            else html += `<p>${inline(line)}</p>`;
        }
    }
    if (inList) html += '</ul>';
    return html;
}

function doiOrHost(link: string): string {
    const doi = /doi\.org\/(.+)$/i.exec(link);
    if (doi && doi[1]) return 'DOI: ' + decodeURIComponent(doi[1]);
    try { return new URL(link).hostname.replace(/^www\./, '') + ' ↗'; }
    catch { return '打开原文 ↗'; }
}

// 通用文本编辑弹窗（手动补充 Abstract / AI 总结）
class TextEditModal extends Modal {
    constructor(
        app: App,
        private plugin: ChemELNPlugin,
        private title: string,
        private current: string,
        private onSubmit: (value: string) => void | Promise<void>,
    ) { super(app); }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        modalEl.addClass('rss-group-modal');
        this.plugin.applyThemeAttributes(modalEl);
        contentEl.empty();
        contentEl.createEl('h3', { text: this.title });
        const ta = contentEl.createEl('textarea', { cls: 'rss-edit-textarea' });
        ta.value = this.current;
        ta.rows = 12;
        const footer = contentEl.createDiv({ cls: 'rss-group-footer' });
        const save = footer.createEl('button', { cls: 'rss-btn rss-btn-primary', text: '保存' });
        save.onclick = async () => { await this.onSubmit(ta.value); this.close(); };
        setTimeout(() => ta.focus(), 30);
    }

    onClose(): void { this.contentEl.empty(); }
}

class GroupEditModal extends Modal {
    constructor(
        app: App,
        private plugin: ChemELNPlugin,
        private current: string,
        private existing: string[],
        private onSubmit: (value: string) => void | Promise<void>,
    ) { super(app); }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        modalEl.addClass('rss-group-modal');
        this.plugin.applyThemeAttributes(modalEl);
        contentEl.empty();
        contentEl.createEl('h3', { text: '设置订阅分组' });
        contentEl.createEl('p', { cls: 'rss-group-tip', text: '输入分组名（留空则归入「未分组」）。已有分组：' + (this.existing.length ? this.existing.join('、') : '无') });

        const input = contentEl.createEl('input', {
            cls: 'rss-add-input', attr: { type: 'text', placeholder: '例如：光催化 / 材料 / 预印本', list: 'rss-group-list' },
        });
        input.value = this.current;
        const datalist = contentEl.createEl('datalist');
        datalist.id = 'rss-group-list';
        for (const g of this.existing) datalist.createEl('option', { attr: { value: g } });

        const footer = contentEl.createDiv({ cls: 'rss-group-footer' });
        const save = footer.createEl('button', { cls: 'rss-btn rss-btn-primary', text: '保存' });
        const submit = async () => { await this.onSubmit(input.value); this.close(); };
        save.onclick = () => void submit();
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void submit(); });
        setTimeout(() => input.focus(), 30);
    }

    onClose(): void { this.contentEl.empty(); }
}
