/* knowledge-graph-core.js — pure extraction prompt + parser for the semantic
 * HTML knowledge-graph lane. The Agent proposes graph JSON; the bundled
 * zrl-knowledge-graph renderer validates and renders it deterministically. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.weaverKnowledgeGraphCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // Project-structural types (2026-09-01): specimen/synthesis/execution/observation/claim
  // project this project's own EXP-object provenance onto the same graph as the semantic
  // material/mechanism types below. Visualization-only — see zrl-knowledge-graph/SKILL.md.
  const TYPES = ['material', 'precursor', 'condition', 'process', 'structure', 'mechanism', 'characterization', 'outcome', 'paper', 'question', 'specimen', 'synthesis', 'execution', 'observation', 'claim'];
  const RELATIONS = ['contains', 'prepared_from', 'treated_by', 'under_condition', 'forms', 'changes', 'enables', 'inhibits', 'measured_by', 'correlates_with', 'supports', 'contradicts', 'tests', 'instance_of'];

  function evidencePacket(cards, maxCards = 30, maxChars = 90000) {
    const packet = [];
    let used = 0;
    for (const card of (Array.isArray(cards) ? cards : []).slice(0, maxCards)) {
      const sourcePath = String(card?.source_path || 'unknown');
      const excerpts = (Array.isArray(card?.claim_candidates) ? card.claim_candidates : [])
        .slice(0, 2).map((item) => String(item || '').replace(/\s+/g, ' ').slice(0, 3400));
      const item = { id: String(card?.id || ''), source_path: sourcePath, evidence_tier: String(card?.evidence_tier || 'needs_manual_review'), excerpts };
      const size = JSON.stringify(item).length;
      if (packet.length && used + size > maxChars) break;
      packet.push(item); used += size;
    }
    return packet;
  }

  function buildExtractionPrompt(input = {}) {
    const packet = evidencePacket(input.cards);
    return `你是科研知识图谱工程师。请根据下面“本轮证据卡片”构建一个语义实体—关系图，而不是文件—摘录关系图。

研究问题：${String(input.question || '').trim() || '未提供'}

硬性边界：
1. 只抽取材料、前驱体、条件、过程、结构、机理、表征方法、结果、论文和研究问题等语义实体，以及本课题自身的样品、制备、表征执行、观测、结论等项目结构实体。
2. 每条关系必须指向提供的 source_path，并给出 excerpt 中可定位的短 quote；不能把共同出现写成因果。
3. 直接陈述的关系 review_status=supported；合理但未被原文直接陈述的关系 review_status=inferred，且 confidence <= 0.6。
4. 无关论文不进入图；把排除原因写入 warnings。不得虚构 DOI、页码、数值或实验条件。
5. 合并同义实体（如 ceria/CeO2），节点控制在 12–45 个、关系控制在 12–90 条。证据不足时宁可少画并报警。
6. synthesis/claim 节点是对多条下游观测/证据的归纳，不是某一段原文的逐字摘录——不要为了满足 quote 字段而编造一句"引用"；这类节点的支撑关系走 supports/contradicts，可以不带 quote，但渲染器现在会把任何没有可验证 quote 的关系一律记为 review_status=inferred（2026-09-01 起，不再信任"没有引文也标 supported"的声明）——不要为了让它显示为 supported 而编造引用；在这类支撑/反驳关系缺少可验证 quote 之前，如实标 inferred 就是正确结果。characterization（表征方法）是跨样品复用的受控词表，不要每篇论文重新造一个新节点。

允许节点类型：${TYPES.join(', ')}
允许关系：${RELATIONS.join(', ')}

只输出一个 JSON 对象，不要 Markdown 代码块或解释：
{"title":"...","research_question":"...","summary":"...","nodes":[{"id":"stable-ascii-id","label":"...","type":"material","description":"...","source_refs":["source_path"]}],"edges":[{"source":"id","target":"id","relation":"changes","label":"...","confidence":0.8,"review_status":"supported","evidence":[{"source_path":"...","locator":"摘要/结果/图号（仅在摘录中真实出现时填写）","quote":"不超过80字"}]}],"warnings":["..."]}

本轮证据卡片：
${JSON.stringify(packet)}`;
  }

  function parseGraphReply(text) {
    const raw = String(text || '').trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced ? fenced[1] : raw).trim();
    let parsed;
    try { parsed = JSON.parse(candidate); }
    catch {
      const start = candidate.indexOf('{'), end = candidate.lastIndexOf('}');
      if (start < 0 || end <= start) throw new Error('Agent 未返回可解析的知识图谱 JSON。');
      parsed = JSON.parse(candidate.slice(start, end + 1));
    }
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error('知识图谱 JSON 缺少 nodes/edges。');
    if (parsed.nodes.length > 80 || parsed.edges.length > 180) throw new Error('知识图谱超过安全规模，请缩小本轮主题。');
    return parsed;
  }

  function isExplicitGraphRequest(text) {
    const value = String(text || '');
    return /(生成|绘制|创建|构建|更新).{0,8}(知识图谱|语义图谱|机理图谱)|(知识图谱|语义图谱|机理图谱).{0,8}(生成|绘制|创建|构建|更新)/i.test(value);
  }

  return { TYPES, RELATIONS, evidencePacket, buildExtractionPrompt, parseGraphReply, isExplicitGraphRequest };
});
