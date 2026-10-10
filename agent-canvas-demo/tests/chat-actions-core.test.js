"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { concealMalformedProtocolBlocks, detectWriteClaim, parseActionRequests, parseRunRequests, parseDraftRequests, parseLegacyNoteEditRequests, parseNormalizeRequests, parsePlotRequests, parsePlotRevisionRequests, parseSuggestReconstructionRequests } = require("../chat-actions-core.js");

test("a plot-revise block is not counted as a failed plot attempt", () => {
  // "scholarium-plot" is a prefix of "scholarium-plot-revise", and \b matches
  // between "t" and "-". Without an explicit hyphen guard every revision would
  // show up in the audit log as a rejected plot block that was never sent.
  const revise = "```scholarium-plot-revise\n"
    + JSON.stringify({ target_manifest_path: "Materials/_analysis/x/plot-manifest.json", chart_style: { theme: "publication" } })
    + "\n```";
  assert.deepEqual(parsePlotRequests(revise).stats, { attempted: 0, parsed: 0, rejected: 0 });
  assert.deepEqual(parsePlotRevisionRequests(revise).stats, { attempted: 1, parsed: 1, rejected: 0 });
});

const normalizeBlock = (payload) => "```scholarium-normalize\n" + JSON.stringify(payload) + "\n```";
const plotBlock = (payload) => "```scholarium-plot\n" + JSON.stringify(payload) + "\n```";
const plotRevisionBlock = (payload) => "```scholarium-plot-revise\n" + JSON.stringify(payload) + "\n```";

test("normalize protocol strips a valid block and keeps only bounded fields", () => {
  const result = parseNormalizeRequests(
    "先把这份工作簿转成 CSV。\n" +
    normalizeBlock({ data_path: "Materials/kinetics.xlsx", sheet: "Raw", header_row: 2, formula_mode: "cached", reason: "多 sheet 需要指定" }) +
    "\n然后再绘图。",
  );
  assert.deepEqual(result.stats, { attempted: 1, parsed: 1, rejected: 0 });
  assert.deepEqual(result.normalizations, [{
    data_path: "Materials/kinetics.xlsx",
    reason: "多 sheet 需要指定",
    sheet: "Raw",
    header_row: 2,
    formula_mode: "cached",
  }]);
  assert.ok(!result.text.includes("scholarium-normalize"));
  assert.ok(result.text.includes("然后再绘图"));
});

test("normalize protocol never lets the model pre-approve a missing formula cache", () => {
  // The researcher may lift this gate on the confirmation card; the model may
  // not, because it cannot know what those formulas were supposed to evaluate to.
  const result = parseNormalizeRequests(normalizeBlock({
    data_path: "Materials/book.xlsx",
    allow_missing_formula_cache: true,
    formula_mode: "cached",
  }));
  assert.equal(result.stats.parsed, 1);
  assert.ok(!("allow_missing_formula_cache" in result.normalizations[0]));
});

test("normalize protocol rejects escaping paths, unknown suffixes and bad options", () => {
  const rejected = [
    { data_path: "../../etc/passwd.csv" },
    { data_path: "/etc/passwd.csv" },
    { data_path: "C:/Windows/system.csv" },
    { data_path: "Materials\\..\\..\\secrets.csv" },
    { data_path: "Materials/notes.md" },
    { data_path: "Materials/archive.zip" },
    { data_path: "" },
    { data_path: "Materials/a.xlsx", header_row: 0 },
    { data_path: "Materials/a.xlsx", header_row: 1.5 },
    { data_path: "Materials/a.xlsx", formula_mode: "evaluate" },
    { data_path: "Materials/a.xlsx", sheet: "   " },
  ];
  for (const payload of rejected) {
    const result = parseNormalizeRequests(normalizeBlock(payload));
    assert.deepEqual(result.stats, { attempted: 1, parsed: 0, rejected: 1 }, JSON.stringify(payload));
    // A rejected block stays visible as prose rather than vanishing silently.
    assert.ok(result.text.includes("scholarium-normalize"), JSON.stringify(payload));
  }
});

test("normalize protocol accepts every supported extension case-insensitively", () => {
  for (const name of ["a.CSV", "b.Tsv", "c.TXT", "d.dat", "e.XLSX"]) {
    const result = parseNormalizeRequests(normalizeBlock({ data_path: `Materials/${name}` }));
    assert.equal(result.stats.parsed, 1, name);
  }
});

test("a single-backtick normalize block is concealed, not leaked as prose", () => {
  const { text, failures } = concealMalformedProtocolBlocks(
    "`scholarium-normalize\n{\"data_path\":\"Materials/a.xlsx\"}\n`",
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].protocol, "scholarium-normalize");
  assert.ok(!text.includes("data_path"));
});

test("plot protocol only creates a new bounded deterministic recipe", () => {
  const result = parsePlotRequests(plotBlock({
    data_path: "Materials/_normalized/demo/normalized.csv",
    x_column: "Time (min)", y_columns: ["Signal A", "RatioPct"], plot_kind: "line",
    title: "Signal over time", save_mode: "new",
    chart_style: { theme: "publication", line_width: 3, x_range: [0, 10], annotations: [{ type: "hline", value: 0, label: "baseline" }] },
    reason: "研究员指定的变量与图型",
  }));
  assert.deepEqual(result.stats, { attempted: 1, parsed: 1, rejected: 0 });
  assert.deepEqual(result.plots, [{
    data_path: "Materials/_normalized/demo/normalized.csv", x_column: "Time (min)", y_columns: ["Signal A", "RatioPct"], plot_kind: "line",
    title: "Signal over time", save_mode: "new", reason: "研究员指定的变量与图型",
    chart_style: { theme: "publication", line_width: 3, x_range: [0, 10], annotations: [{ type: "hline", value: 0, label: "baseline" }] },
  }]);
  assert.ok(!result.text.includes("scholarium-plot"));
});

test("plot protocol rejects escaping paths, non-recipes and model overwrite", () => {
  const rejected = [
    { data_path: "../../secret.csv", x_column: "x", y_columns: ["y"], plot_kind: "line" },
    { data_path: "Materials/demo.xlsx", x_column: "x", y_columns: ["y"], plot_kind: "line" },
    { data_path: "Materials/demo.csv", x_column: "x", y_columns: ["x"], plot_kind: "line" },
    { data_path: "Materials/demo.csv", x_column: "x", y_columns: ["y"], plot_kind: "line", save_mode: "overwrite" },
    { data_path: "Materials/demo.csv", x_column: "x", y_columns: ["y"], plot_kind: "line", target_manifest_path: "Materials/_analysis/x/plot-manifest.json" },
    { data_path: "Materials/demo.csv", x_column: "x", y_columns: ["y"], plot_kind: "line", chart_style: { smooth: true } },
  ];
  for (const payload of rejected) {
    const result = parsePlotRequests(plotBlock(payload));
    assert.deepEqual(result.stats, { attempted: 1, parsed: 0, rejected: 1 }, JSON.stringify(payload));
    assert.ok(result.text.includes("scholarium-plot"));
  }
});

test("plot revision is manifest-pinned and cannot replace its data recipe", () => {
  const valid = parsePlotRevisionRequests(plotRevisionBlock({
    target_manifest_path: "Materials/_analysis/demo-a1b2/plot-manifest.json",
    chart_style: { theme: "dark", legend: "right", y_range: null }, reason: "投稿版视觉调整",
  }));
  assert.deepEqual(valid.stats, { attempted: 1, parsed: 1, rejected: 0 });
  assert.deepEqual(valid.revisions, [{
    target_manifest_path: "Materials/_analysis/demo-a1b2/plot-manifest.json",
    chart_style: { theme: "dark", legend: "right", y_range: null }, save_mode: "new", reason: "投稿版视觉调整",
  }]);
  const rejected = [
    { target_manifest_path: "Materials/_analysis/demo/plot-manifest.json", chart_style: { theme: "soft" }, data_path: "Materials/other.csv" },
    { target_manifest_path: "Materials/_analysis/demo/plot-manifest.json", chart_style: { theme: "soft" }, x_column: "other" },
    { target_manifest_path: "Materials/_analysis/demo/plot-manifest.json", chart_style: { theme: "soft" }, y_columns: ["other"] },
    { target_manifest_path: "Materials/_analysis/demo/plot-manifest.json", chart_style: { theme: "soft" }, plot_kind: "bar" },
    { target_manifest_path: "Materials/_analysis/demo/plot-manifest.json", chart_style: { theme: "soft" }, save_mode: "overwrite" },
    { target_manifest_path: "Materials/_analysis/demo/plot-manifest.json", chart_style: { theme: "soft" }, overwriteConfirmedByResearcher: true },
    { target_manifest_path: "Materials/_analysis/demo/plot.svg", chart_style: { theme: "soft" } },
  ];
  for (const payload of rejected) {
    const result = parsePlotRevisionRequests(plotRevisionBlock(payload));
    assert.deepEqual(result.stats, { attempted: 1, parsed: 0, rejected: 1 }, JSON.stringify(payload));
    assert.ok(result.text.includes("scholarium-plot-revise"));
  }
});

test("a single-backtick plot revision is concealed, not leaked as prose", () => {
  const { text, failures } = concealMalformedProtocolBlocks(
    "`scholarium-plot-revise\n{\"target_manifest_path\":\"Materials/_analysis/a/plot-manifest.json\"}\n`",
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].protocol, "scholarium-plot-revise");
  assert.ok(!text.includes("target_manifest_path"));
});

test("protocol parsers report attempted, parsed and rejected block counts", () => {
  const malformed = '```scholarium-action\n不是 JSON\n```';
  const valid = '```scholarium-action\n{"action":"workspace.task_add","input":{"title":"x"}}\n```';
  const parsed = parseActionRequests(`${malformed}\n${valid}`);
  assert.deepEqual(parsed.stats, { attempted: 2, parsed: 1, rejected: 1 });

  const unclosed = parseDraftRequests('```scholarium-draft\n{"path":"x.md","content":"x"}');
  assert.deepEqual(unclosed.stats, { attempted: 1, parsed: 0, rejected: 1 });
  assert.deepEqual(
    parseRunRequests('```scholarium-run\n{"operation":"unknown"}\n```').stats,
    { attempted: 1, parsed: 0, rejected: 1 },
  );
  assert.deepEqual(
    parseSuggestReconstructionRequests('```scholarium-suggest-reconstruction\n{}\n```').stats,
    { attempted: 1, parsed: 0, rejected: 1 },
  );
});

test("write-claim detector ignores negated protocol guidance", () => {
  assert.equal(detectWriteClaim('已添加实验记录。'), '已添加');
  assert.equal(detectWriteClaim('保存完成，请查看。'), '保存完成');
  assert.equal(detectWriteClaim('尚未保存，等待你确认。'), '');
  assert.equal(detectWriteClaim('你不得声称已保存。'), '');
  assert.equal(detectWriteClaim('已提交修改请求，等你确认后生效。'), '已提交修改请求');
});

test("parses conversational Pipeline/search/rerun requests into confirmation-only records", () => {
  const reply = [
    '```scholarium-run\n{"operation":"pipeline.run","topic":"plasmonic photocatalysis","reason":"用户明确要求"}\n```',
    '```scholarium-run\n{"operation":"literature.search","query":"Au TiO2 CO2 reduction"}\n```',
    '```scholarium-run\n{"operation":"pipeline.rerun","run_id":"latest","from_step":"quality-gate","query":"Au AND TiO2"}\n```',
  ].join('\n');
  const { text, runs } = parseRunRequests(reply);
  assert.equal(text, '');
  assert.deepEqual(runs.map((item) => item.operation), ["pipeline.run", "literature.search", "pipeline.rerun"]);
  assert.equal(runs[1].topic, "Au TiO2 CO2 reduction");
  assert.equal(runs[2].from_step, "quality-gate");
  assert.equal(runs[2].query, "Au AND TiO2");
});

test("malformed or underspecified conversational run request stays visible", () => {
  for (const body of [
    '{"operation":"pipeline.run"}',
    '{"operation":"pipeline.rerun","run_id":"latest"}',
    '{"operation":"os.exec","topic":"x"}',
  ]) {
    const { text, runs } = parseRunRequests(`\`\`\`scholarium-run\n${body}\n\`\`\``);
    assert.equal(runs.length, 0);
    assert.match(text, /scholarium-run/);
  }
});

test("parses a DOI list into a confirmation-only manual download queue", () => {
  const reply = '```scholarium-run\n{"operation":"literature.queue","items":[{"doi":"https://doi.org/10.1039/C3CC39096A","title":"Au/TiO2 paper","priority":"P0"}],"open":true}\n```';
  const { text, runs } = parseRunRequests(reply);
  assert.equal(text, '');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].operation, 'literature.queue');
  assert.equal(runs[0].items[0].doi, '10.1039/C3CC39096A');
  assert.equal(runs[0].items[0].url, 'https://doi.org/10.1039/C3CC39096A');
  assert.equal(runs[0].open, true);
});

test("manual download queue rejects missing or malformed DOI items", () => {
  const reply = '```scholarium-run\n{"operation":"literature.queue","items":[{"title":"No DOI"}]}\n```';
  const { text, runs } = parseRunRequests(reply);
  assert.equal(runs.length, 0);
  assert.match(text, /scholarium-run/);
});

test("parses a well-formed action block and strips it from the text", () => {
  const reply = '收到，明天上午安排 HPLC。\n```scholarium-action\n{"action":"workspace.timeblock_add","input":{"date":"2026-08-21","start":"09:00","end":"11:00","title":"HPLC"},"reason":"研究员要求"}\n```\n已提交修改请求，等你确认后生效。';
  const { text, actions } = parseActionRequests(reply);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "workspace.timeblock_add");
  assert.equal(actions[0].input.date, "2026-08-21");
  assert.equal(actions[0].reason, "研究员要求");
  assert.ok(!text.includes("scholarium-action"), "block must be stripped from the visible text");
  assert.ok(text.includes("等你确认后生效"), "surrounding prose survives");
});

test("parses multiple blocks in one reply", () => {
  const reply = '```scholarium-action\n{"action":"workspace.task_add","input":{"title":"配标样"}}\n```\n中间的话\n```scholarium-action\n{"action":"workspace.emotion_log","input":{"mood":"平静"}}\n```';
  const { actions } = parseActionRequests(reply);
  assert.equal(actions.length, 2);
  assert.deepEqual(actions.map((a) => a.action), ["workspace.task_add", "workspace.emotion_log"]);
});

test("malformed JSON stays visible and produces no action", () => {
  const reply = '```scholarium-action\n{"action":"workspace.task_add", input 缺引号\n```';
  const { text, actions } = parseActionRequests(reply);
  assert.equal(actions.length, 0);
  assert.ok(text.includes("scholarium-action"), "malformed block must NOT be silently swallowed");
});

test("parseSuggestReconstructionRequests only carries seed_doi/reason — no executable payload", () => {
  const reply = '这篇种子文献值得做一轮引用链重建。\n```scholarium-suggest-reconstruction\n{"seed_doi":"10.1039/D0TA00811G","reason":"课题画像的种子文献从未被 P1 覆盖"}\n```\n打开面板后可以逐项审阅。';
  const { text, suggestions } = parseSuggestReconstructionRequests(reply);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].seed_doi, "10.1039/D0TA00811G");
  assert.ok(!text.includes("scholarium-suggest-reconstruction"));
  assert.ok(text.includes("打开面板后可以逐项审阅"));
});

test("parseSuggestReconstructionRequests requires a non-empty seed_doi, otherwise leaves the block visible", () => {
  const reply = '```scholarium-suggest-reconstruction\n{"reason":"忘了写 DOI"}\n```';
  const { text, suggestions } = parseSuggestReconstructionRequests(reply);
  assert.equal(suggestions.length, 0);
  assert.ok(text.includes("scholarium-suggest-reconstruction"));
});

test("a block without a dotted action name is rejected", () => {
  const reply = '```scholarium-action\n{"action":"delete_everything","input":{}}\n```';
  const { actions } = parseActionRequests(reply);
  assert.equal(actions.length, 0);
});

test("common input aliases are accepted without losing the action payload", () => {
  for (const key of ["params", "arguments", "payload"]) {
    const reply = `\`\`\`scholarium-action\n{"action":"workspace.timeblock_update","${key}":{"id":"tb-001","execution_status":"completed"}}\n\`\`\``;
    const { text, actions } = parseActionRequests(reply);
    assert.equal(actions.length, 1, `${key} must be accepted`);
    assert.deepEqual(actions[0].input, { id: "tb-001", execution_status: "completed" });
    assert.equal(text, "");
  }
});

test("missing, empty, or non-object input stays visible instead of making an empty action card", () => {
  for (const body of [
    '{"action":"workspace.timeblock_update"}',
    '{"action":"workspace.timeblock_update","input":{}}',
    '{"action":"workspace.timeblock_update","input":"bogus"}',
  ]) {
    const reply = `\`\`\`scholarium-action\n${body}\n\`\`\``;
    const { text, actions } = parseActionRequests(reply);
    assert.equal(actions.length, 0);
    assert.ok(text.includes("scholarium-action"), "invalid payload must remain visible");
  }
});

test("a reply with no blocks passes through unchanged", () => {
  const reply = "普通回复，没有动作块。";
  const { text, actions } = parseActionRequests(reply);
  assert.equal(text, reply);
  assert.equal(actions.length, 0);
});

/* --- scholarium-draft（/v1/drafts/batch 预防式落盘，设计文档 §7）--- */

test("scholarium-draft: 单文件块被解析并剥离正文", () => {
  const reply = '已整理好实验记录。\n```scholarium-draft\n{"path":"records/scholarium/EXP-006.md","content":"---\\nuid: \\"abc\\"\\n---\\n双 85 老化","reason":"研究员要求保存"}\n```\n等你确认后写入。';
  const { text, drafts } = parseDraftRequests(reply);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].items.length, 1);
  assert.equal(drafts[0].items[0].path, "records/scholarium/EXP-006.md");
  assert.ok(drafts[0].items[0].content.includes("uid"));
  assert.ok(!text.includes("scholarium-draft"));
  assert.ok(text.includes("等你确认后写入"));
});

test("scholarium-draft: items 批量形态（EXP+HYP 关联对）", () => {
  const reply = '```scholarium-draft\n{"items":[{"path":"a/EXP-006.md","content":"x"},{"path":"a/HYP-004.md","content":"y"}]}\n```';
  const { drafts } = parseDraftRequests(reply);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].items.length, 2);
});

test("scholarium-draft: accepts a spaced or long Markdown fence", () => {
  const reply = '```` scholarium-draft\n{"path":"Research/Experiments/EXP-007.md","content":"x"}\n````';
  const { text, drafts } = parseDraftRequests(reply);
  assert.equal(text, "");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].items[0].path, "Research/Experiments/EXP-007.md");
});

test("scholarium-draft can request opening the first committed note", () => {
  const reply = '```scholarium-draft\n{"path":"Literature/paper.md","content":"---\\ntype: paper\\n---\\n摘要","open_after_commit":true}\n```';
  const { drafts } = parseDraftRequests(reply);
  assert.equal(drafts[0].openAfterCommit, true);
});

test("scholarium-draft: 越界/绝对/非 .md 路径被拒绝且原块保留", () => {
  for (const bad of ["../escape.md", "/abs/path.md", "C:\\\\win.md", "records/x.txt", ""]) {
    const reply = `\`\`\`scholarium-draft\n{"path":${JSON.stringify(bad)},"content":"x"}\n\`\`\``;
    const { text, drafts } = parseDraftRequests(reply);
    assert.equal(drafts.length, 0, `path ${bad} must be rejected`);
    assert.ok(text.includes("scholarium-draft"), "rejected block stays visible");
  }
});

test("scholarium-draft: 空内容或坏 JSON 不产生草稿", () => {
  assert.equal(parseDraftRequests('```scholarium-draft\n{"path":"a/x.md","content":"  "}\n```').drafts.length, 0);
  assert.equal(parseDraftRequests('```scholarium-draft\n不是 JSON\n```').drafts.length, 0);
});

test("a one-backtick draft-looking line is audited as rejected rather than invisible prose", () => {
  const reply = '`scholarium-draft\n{"path":"Experiments/x.md","content":"x"}\n`';
  const parsed = parseDraftRequests(reply);
  assert.deepEqual(parsed.stats, { attempted: 1, parsed: 0, rejected: 1 });
  assert.equal(parsed.drafts.length, 0);
  assert.match(parsed.text, /scholarium-draft/);
});

test("malformed protocol payload is replaced by a small non-executable render record", () => {
  const reply = '`scholarium-draft\n' + JSON.stringify({
    path: 'Experiments/FTO.md', content: '# FTO\n\n'.repeat(500), reason: 'test',
  }) + '\n`';
  const rendered = concealMalformedProtocolBlocks(reply);
  assert.equal(rendered.text, '');
  assert.deepEqual(rendered.failures, [{
    protocol: 'scholarium-draft', target: 'Experiments/FTO.md',
    guidance: '这是既有笔记；它不能用新建草稿协议覆盖。请重新生成可确认的笔记修改请求。',
  }]);
});

test("an orphaned historical draft JSON body is concealed even when its fence is gone", () => {
  const reply = '模型说明：以下内容等待确认。\n' + JSON.stringify({
    path: 'Experiments/FTO.md', content: '# FTO\n\n'.repeat(500), reason: 'test', open_after_commit: false,
  }) + '\n`';
  const rendered = concealMalformedProtocolBlocks(reply);
  assert.equal(rendered.text, '模型说明：以下内容等待确认。');
  assert.equal(rendered.failures.length, 1);
  assert.equal(rendered.failures[0].target, 'Experiments/FTO.md');
});

test("scholarium-note-edit parses a legacy Experiments edit and preserves a human review table", () => {
  const reply = '```scholarium-note-edit\n' + JSON.stringify({
    path: 'Experiments/FTO.md', content: '# FTO\n\n0.5 M Na₂SO₄', reason: '移除电解质中的乙醇',
    changes: [{ location: '测试方法', before: '0.5 M Na₂SO₄ + 1% 乙醇', after: '0.5 M Na₂SO₄' }],
  }) + '\n```';
  const parsed = parseLegacyNoteEditRequests(reply);
  assert.equal(parsed.text, '');
  assert.deepEqual(parsed.stats, { attempted: 1, parsed: 1, rejected: 0 });
  assert.equal(parsed.edits.length, 1);
  assert.equal(parsed.edits[0].path, 'Experiments/FTO.md');
  assert.deepEqual(parsed.edits[0].changes, [{ location: '测试方法', before: '0.5 M Na₂SO₄ + 1% 乙醇', after: '0.5 M Na₂SO₄' }]);
});

test("scholarium-note-edit cannot target Research, traversal, or a non-Markdown file", () => {
  for (const path of ['Research/Experiments/EXP-001.md', '../Experiments/x.md', 'Experiments/x.txt']) {
    const reply = `\`\`\`scholarium-note-edit\n${JSON.stringify({ path, content: 'x', reason: 'test' })}\n\`\`\``;
    const parsed = parseLegacyNoteEditRequests(reply);
    assert.equal(parsed.edits.length, 0, path);
    assert.equal(parsed.stats.rejected, 1, path);
    assert.match(parsed.text, /scholarium-note-edit/);
  }
});

test("scholarium-note-edit without review rows stays visible instead of rendering an unreviewable confirm card", () => {
  const reply = '```scholarium-note-edit\n' + JSON.stringify({
    path: 'Experiments/FTO.md', content: '# FTO\n\n0.5 M Na₂SO₄', reason: '移除乙醇', changes: [],
  }) + '\n```';
  const parsed = parseLegacyNoteEditRequests(reply);
  assert.deepEqual(parsed.stats, { attempted: 1, parsed: 0, rejected: 1 });
  assert.match(parsed.text, /scholarium-note-edit/);
});
