"use strict";
/* chat-markdown-core.js — 安全、轻量的织研者聊天 Markdown 呈现。
 *
 * Agent 的聊天正文是非可信文本：先逐段转义，再只由本文件生成有限的
 * HTML 标签。它不解释 HTML、不执行脚本，也不处理 Scholarium 协议块；
 * 协议块会在 shell-ui.js 更早的解析阶段被剥离为确认卡片。
 */
(function initWeaverChatMarkdown(root) {
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  }

  function inlineMarkdown(value) {
    const code = [];
    let html = escapeHtml(value).replace(/`([^`\n]+)`/g, (_match, source) => {
      const token = `\u0000CODE${code.length}\u0000`;
      code.push(`<code>${source}</code>`);
      return token;
    });
    // Links are deliberately limited to http(s), preventing a chat reply from
    // rendering a javascript: or local-file link as a clickable action.
    html = html.replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g,
      (_match, label, href) => `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`);
    html = html
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    return html.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => code[Number(index)] || '');
  }

  function tableCells(line) {
    return String(line).trim().replace(/^\|/, '').replace(/\|$/, '')
      .split('|').map((cell) => cell.trim().replace(/\\\|/g, '|'));
  }

  function isTableRow(line) {
    const trimmed = String(line).trim();
    return /^\|.*\|$/.test(trimmed) && tableCells(trimmed).length >= 2;
  }

  function isTableSeparator(line) {
    return tableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function renderTable(rows) {
    const hasHeader = rows.length >= 2 && isTableSeparator(rows[1]);
    const headings = hasHeader ? tableCells(rows[0]) : null;
    const bodyRows = hasHeader ? rows.slice(2) : rows;
    const head = headings
      ? `<thead><tr>${headings.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead>`
      : '';
    const body = bodyRows.map((row) => `<tr>${tableCells(row).map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('');
    return `<div class="wv-chat-table-wrap"><table class="wv-chat-markdown-table">${head}<tbody>${body}</tbody></table></div>`;
  }

  function renderMarkdown(source) {
    const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let list = null;
    const closeList = () => {
      if (list) html.push(`</${list}>`);
      list = null;
    };
    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index];
      const trimmed = raw.trim();
      if (!trimmed) { closeList(); continue; }
      if (/^```/.test(trimmed)) {
        closeList();
        const codeLines = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index].trim())) codeLines.push(lines[index++]);
        html.push(`<pre class="wv-chat-code"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        continue;
      }
      if (isTableRow(raw)) {
        closeList();
        const rows = [raw];
        while (index + 1 < lines.length && isTableRow(lines[index + 1])) rows.push(lines[++index]);
        html.push(renderTable(rows));
        continue;
      }
      const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
      if (heading) {
        closeList();
        html.push(`<h${heading[1].length + 1}>${inlineMarkdown(heading[2])}</h${heading[1].length + 1}>`);
        continue;
      }
      if (/^(?:---|\*\*\*|___)$/.test(trimmed)) { closeList(); html.push('<hr>'); continue; }
      const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
      const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
      if (unordered || ordered) {
        const kind = unordered ? 'ul' : 'ol';
        if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; }
        html.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
        continue;
      }
      closeList();
      const quote = /^>\s?(.*)$/.exec(trimmed);
      if (quote) html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
      else html.push(`<p>${inlineMarkdown(raw)}</p>`);
    }
    closeList();
    return html.join('');
  }

  const api = { renderMarkdown, escapeHtml, inlineMarkdown };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.weaverChatMarkdown = api;
})(typeof window !== 'undefined' ? window : globalThis);
