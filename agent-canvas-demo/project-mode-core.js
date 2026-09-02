"use strict";
/* M3 P3-P5 pure core: bounded Agent contract -> schema-v1 Hypothesis and
 * Experiment drafts + one proposed weekly schedule artifact. Browser/Node. */
(() => {
  const text = (value, max = 800) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const list = (value, cap = 12, max = 240) => [...new Set((Array.isArray(value) ? value : []).map((v) => text(v, max)).filter(Boolean))].slice(0, cap);
  const yaml = (value) => JSON.stringify(String(value ?? ''));
  const safe = (value) => text(value, 70).replace(/[\\/:*?"<>|#[\]]/g, '-').replace(/[. ]+$/g, '') || 'draft';

  function uuidV7(now = Date.now()) {
    const bytes = new Uint8Array(16);
    const crypto_ = typeof crypto !== 'undefined' ? crypto : require('node:crypto').webcrypto;
    crypto_.getRandomValues(bytes);
    let stamp = BigInt(now);
    for (let i = 5; i >= 0; i--) { bytes[i] = Number(stamp & 255n); stamp >>= 8n; }
    bytes[6] = 0x70 | (bytes[6] & 0x0f); bytes[8] = 0x80 | (bytes[8] & 0x3f);
    const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function allocate(prefix, existing = [], count = 1) {
    const used = new Set(existing);
    const out = []; let n = 1;
    while (out.length < count) { const id = `${prefix}-${String(n++).padStart(3, '0')}`; if (!used.has(id)) { used.add(id); out.push(id); } }
    return out;
  }

  function buildProjectPlanPrompt(projectData) {
    const payload = JSON.stringify(projectData).slice(0, 18000);
    return `你是 Scholarium 课题模式的 P3-P5 规划 Agent。你可以阅读工作区内本课题已有的文献综合和知识图谱，但只能输出草案，不能声称写入文件或确认科研结论。\n\n课题状态：\n${payload}\n\n优先核对 Research/deep-research-synthesis.json、knowledge-graph/knowledge_graph.json、knowledge-graph/knowledge_graph-report.md 和本课题画像；不存在就明确证据不足。图谱中的 inferred 关系只能作为待验证假设，不能当成已确认事实。生成 1-5 条可证伪假设、每条至少一个区分性实验，以及未来一周的可调整任务草案。不要编造 DOI、实验结果、仪器可用性或已有证据。\n\n只输出 JSON：\n{"summary":"","evidence_gaps":[],"hypotheses":[{"statement":"","predicts":"","falsified_if":"","assumptions":[],"alternative_explanations":[],"required_tests":[]}],"experiments":[{"title":"","hypothesis_indexes":[0],"independent_variables":[],"dependent_variables":[],"controlled_variables":[],"replicates":"","procedure_outline":[],"estimated_hours":4,"blocked_by":[]}],"week_plan":[{"day":"周一","task":"","experiment_index":0,"hours":2,"dependency":""}]}\n\n索引从 0 开始；experiment_index 可以为 null。`;
  }

  function parseProjectPlanReply(raw) {
    let value;
    try {
      const match = String(raw || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
      value = JSON.parse(match ? match[1] : String(raw || '').slice(String(raw || '').indexOf('{'), String(raw || '').lastIndexOf('}') + 1));
    } catch { return { ok: false, error: 'Agent 返回的 P3-P5 规划不是有效 JSON' }; }
    const hypotheses = (Array.isArray(value.hypotheses) ? value.hypotheses : []).slice(0, 5).map((h) => ({
      statement: text(h.statement, 700), predicts: text(h.predicts, 700), falsified_if: text(h.falsified_if, 700),
      assumptions: list(h.assumptions), alternative_explanations: list(h.alternative_explanations), required_tests: list(h.required_tests),
    })).filter((h) => h.statement && h.predicts && h.falsified_if);
    if (!hypotheses.length) return { ok: false, error: '没有同时写明 statement、predicts、falsified_if 的可证伪假设' };
    const experiments = (Array.isArray(value.experiments) ? value.experiments : []).slice(0, 8).map((e) => ({
      title: text(e.title, 300),
      hypothesis_indexes: [...new Set((Array.isArray(e.hypothesis_indexes) ? e.hypothesis_indexes : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < hypotheses.length))],
      independent_variables: list(e.independent_variables), dependent_variables: list(e.dependent_variables), controlled_variables: list(e.controlled_variables),
      replicates: text(e.replicates, 200), procedure_outline: list(e.procedure_outline, 16), estimated_hours: Math.max(0.5, Math.min(24, Number(e.estimated_hours) || 4)), blocked_by: list(e.blocked_by),
    })).filter((e) => e.title && e.hypothesis_indexes.length);
    if (!experiments.length) return { ok: false, error: '没有与假设索引关联的实验草案' };
    const week_plan = (Array.isArray(value.week_plan) ? value.week_plan : []).slice(0, 20).map((w) => ({
      day: text(w.day, 20), task: text(w.task, 400),
      experiment_index: w.experiment_index === null || w.experiment_index === undefined ? null : Number(w.experiment_index),
      hours: Math.max(0.5, Math.min(12, Number(w.hours) || 2)), dependency: text(w.dependency, 240),
    })).filter((w) => w.day && w.task && (w.experiment_index === null || (Number.isInteger(w.experiment_index) && w.experiment_index >= 0 && w.experiment_index < experiments.length)));
    return { ok: true, value: { summary: text(value.summary, 1200), evidence_gaps: list(value.evidence_gaps, 16), hypotheses, experiments, week_plan } };
  }

  function frontmatter(object) {
    const lines = ['---'];
    for (const [key, value] of Object.entries(object)) {
      if (Array.isArray(value)) {
        if (!value.length) lines.push(`${key}: []`);
        else { lines.push(`${key}:`); for (const item of value) lines.push(`  - ${typeof item === 'object' ? JSON.stringify(item) : yaml(item)}`); }
      } else if (value && typeof value === 'object') {
        lines.push(`${key}:`); for (const [k, v] of Object.entries(value)) lines.push(`  ${k}: ${JSON.stringify(v)}`);
      } else if (typeof value === 'number' || typeof value === 'boolean') lines.push(`${key}: ${value}`);
      else lines.push(`${key}: ${yaml(value)}`);
    }
    return lines.concat('---', '').join('\n');
  }

  function isoWeek(date = new Date()) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const year = d.getUTCFullYear(); const start = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil((((d - start) / 86400000) + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }

  function buildProjectDrafts({ project, parsed, existingHypothesisIds = [], existingExperimentIds = [], at, uidFn = uuidV7 }) {
    if (!project?.uid || !project?.display_id) throw new Error('缺少正式 Project 上下文');
    const value = parsed?.value || parsed;
    const now = at || new Date().toISOString();
    const hypIds = allocate('HYP', existingHypothesisIds, value.hypotheses.length);
    const hypotheses = value.hypotheses.map((h, i) => ({ ...h, uid: uidFn(), display_id: hypIds[i] }));
    const expIds = allocate('EXP', existingExperimentIds, value.experiments.length);
    const experiments = value.experiments.map((e, i) => ({ ...e, uid: uidFn(), display_id: expIds[i] }));
    const items = [];
    hypotheses.forEach((h) => {
      const object = { uid: h.uid, display_id: h.display_id, schema_version: 1, type: 'hypothesis', created_at: now, updated_at: now,
        project_uid: project.uid, statement: h.statement, status: 'proposed', predicts: h.predicts, falsified_if: h.falsified_if,
        supporting_evidence: [], contradicting_evidence: [], assumptions: h.assumptions, alternative_explanations: h.alternative_explanations,
        required_tests: h.required_tests, history: [], created_by: 'ai', review_status: 'pending' };
      items.push({ path: `Research/Hypotheses/${h.display_id} ${safe(h.statement)}.md`, content: frontmatter(object) + `# ${h.display_id} · 假设草案\n\n## 预测\n\n${h.predicts}\n\n## 证伪条件\n\n${h.falsified_if}\n\n> AI 草案，必须由研究者审阅；未设置人工 confidence。\n` });
    });
    experiments.forEach((e, i) => {
      const tests = e.hypothesis_indexes.map((index) => hypotheses[index].uid);
      const object = { uid: e.uid, display_id: e.display_id, schema_version: 1, type: 'experiment', created_at: now, updated_at: now,
        project_uid: project.uid, title: e.title, tests_hypotheses: tests, status: 'designed', result: '', conclusion: '', produced_evidence: [],
        data_origin: 'planned', raw_data_refs: [], data_provenance_note: 'P4 设计草案，尚未执行或产生数据。', data_recorded_by: 'user', data_recorded_at: now,
        variables: { independent: e.independent_variables, dependent: e.dependent_variables, controlled: e.controlled_variables, replicates: e.replicates },
        blocked_by: e.blocked_by, estimated_hours: e.estimated_hours, created_by: 'ai', review_status: 'pending' };
      const outline = e.procedure_outline.map((step, n) => `${n + 1}. ${step}`).join('\n') || '等待研究者补充。';
      items.push({ path: `Research/Experiments/${e.display_id} ${safe(e.title)}.md`, content: frontmatter(object) + `# ${e.display_id} · ${e.title}\n\n## 操作草案\n\n${outline}\n\n> AI 生成的 designed 草案；转入 ready/running 必须人工确认。\n` });
    });
    const week = isoWeek(new Date(now));
    const rows = value.week_plan.map((task) => {
      const exp = task.experiment_index === null ? null : experiments[task.experiment_index];
      return `| ${task.day} | ${task.task} | ${exp?.display_id || '通用'} | ${task.hours} | ${task.dependency || '—'} |`;
    }).join('\n') || '| 待安排 | 研究者拖拽或补充本周任务 | 通用 | 1 | — |';
    const schedulePath = `Research/Projects/${project.display_id}/Schedule/${week}.md`;
    items.push({ path: schedulePath, content: frontmatter({ artifact: 'weekly_schedule_proposal', schema_version: 1, project_uid: project.uid, project_display_id: project.display_id, week, status: 'proposed', created_at: now, updated_at: now, experiment_uids: experiments.map((e) => e.uid) }) + `# ${project.display_id} · ${week} 周计划草案\n\n| 日期 | 任务 | 实验 | 工时 | 依赖 |\n|---|---|---:|---:|---|\n${rows}\n\n> 这是 L2 提议，不代表已经排入博士工作台；请调整后再人工确认。\n` });
    return { items, hypotheses, experiments, schedulePath, week };
  }

  const api = { buildProjectPlanPrompt, parseProjectPlanReply, buildProjectDrafts, allocate, uuidV7, isoWeek };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.weaverProjectModeCore = api;
})();
