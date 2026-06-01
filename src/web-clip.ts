// web-clip.ts — 把网页 HTML 抽取为干净正文并转成 Markdown
// 用 Mozilla Readability 提取主体文章，Turndown(+GFM) 转 Markdown。
// @ts-ignore 第三方库无内置类型声明
import { Readability } from '@mozilla/readability';
// @ts-ignore
import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'turndown-plugin-gfm';

export interface ClippedArticle {
    title: string;
    byline?: string;
    excerpt?: string;
    markdown: string;
}

function makeTurndown(): TurndownService {
    const td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        emDelimiter: '*',
    });
    try { td.use(gfm); } catch { /* gfm 可选 */ }
    // 去掉脚本/样式残留
    td.remove(['script', 'style', 'noscript']);
    return td;
}

export function htmlToMarkdownArticle(html: string, url: string): ClippedArticle {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // 注入 <base> 让相对链接 / 图片解析为绝对地址
    if (doc.head) {
        let base = doc.head.querySelector('base');
        if (!base) { base = doc.createElement('base'); doc.head.prepend(base); }
        base.setAttribute('href', url);
    }

    const td = makeTurndown();
    try {
        const reader = new Readability(doc);
        const article = reader.parse();
        if (article && article.content) {
            return {
                title: (article.title || doc.title || '网页剪藏').trim(),
                byline: article.byline ? String(article.byline).trim() : undefined,
                excerpt: article.excerpt ? String(article.excerpt).trim() : undefined,
                markdown: td.turndown(article.content).trim(),
            };
        }
    } catch (e) {
        console.warn('[web-clip] Readability 解析失败，回退整页:', e);
    }

    // 回退：转整页 body
    const body = doc.body ? doc.body.innerHTML : html;
    return {
        title: (doc.title || '网页剪藏').trim(),
        markdown: td.turndown(body).trim(),
    };
}
