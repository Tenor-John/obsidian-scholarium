"use strict";
/* graph-projection-core.js — 只读投影：把课题自身已存在的 Project/Experiment
 * schema-v1 对象映射成知识图谱的"项目结构节点"（specimen/synthesis/execution/
 * observation/claim，定义见 skills/zrl-knowledge-graph/scripts/render_graph.py
 * 与 skills/zrl-knowledge-graph/SKILL.md 的"Project-structural nodes"一节）。
 *
 * 硬性边界（验收报告原话）：只读取已有字段，不补造样品或结果；缺字段就不生成
 * 对应节点。这里不做任何网络调用、不做任何写入，纯函数，双端可用（沿用
 * project-mode-core.js / seed-reconstruction-core.js 的壳模式）。
 *
 * 这些边全部不带 quote（EXP 记录不是文献摘录），按 2026-09-01 已收紧的
 * `supported` 门槛，会如实渲染为 review_status: inferred——这是正确结果，
 * 不是需要绕过的限制。若未来要让 EXP 记录支持 supported，需要另一种可验证
 * 证据类型（EXP uid + 版本/hash + 结果块 locator），明确不在本文件范围。
 */
(() => {
  const isNode = typeof module !== "undefined" && module.exports;

  const text = (value, max = 800) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const slug = (value, prefix) => {
    const cleaned = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return (cleaned.slice(0, 48) || prefix);
  };

  const CONCLUDABLE_STATUSES = new Set(["concluded", "integrated"]);

  /* 单个 Experiment 对象 -> 0~3 个节点（execution 必有；observation/claim 视
   * 字段是否非空而定）+ 对应边。全部只读取已有字段。 */
  function projectExperiment(exp) {
    const nodes = [];
    const edges = [];
    if (!exp || !exp.uid || !exp.display_id || !text(exp.title)) return { nodes, edges };

    const sourcePath = text(exp.__vault_path || exp.path, 500);
    const execId = `exec-${slug(exp.display_id, exp.uid.slice(0, 8))}`;
    const isSimulated = exp.data_origin === "simulated";
    const execDescriptionParts = [`来自 ${exp.display_id}（status: ${text(exp.status, 40) || "未知"}）`];
    if (isSimulated) execDescriptionParts.push("模拟数据，非真实测量执行");
    nodes.push({
      id: execId, label: text(exp.title, 200), type: "execution",
      description: execDescriptionParts.join("；"),
      source_refs: sourcePath ? [sourcePath] : [],
    });

    const result = text(exp.result, 1200);
    if (result) {
      const obsId = `obs-${slug(exp.display_id, exp.uid.slice(0, 8))}`;
      nodes.push({
        id: obsId, label: result.slice(0, 60), type: "observation",
        description: isSimulated ? `模拟数据：${result}` : result,
        source_refs: sourcePath ? [sourcePath] : [],
      });
      edges.push({
        source: obsId, target: execId, relation: "measured_by", label: "measured_by",
        confidence: 0.5, review_status: "inferred",
        evidence: sourcePath ? [{ source_path: sourcePath, locator: "result" }] : [],
      });
    }

    const conclusion = text(exp.conclusion, 1200);
    if (conclusion && CONCLUDABLE_STATUSES.has(exp.status)) {
      const claimId = `claim-${slug(exp.display_id, exp.uid.slice(0, 8))}`;
      nodes.push({
        id: claimId, label: conclusion.slice(0, 60), type: "claim",
        description: conclusion,
        source_refs: sourcePath ? [sourcePath] : [],
      });
      edges.push({
        source: execId, target: claimId, relation: "tests", label: "tests",
        confidence: 0.5, review_status: "inferred",
        evidence: sourcePath ? [{ source_path: sourcePath, locator: "conclusion" }] : [],
      });
    }

    return { nodes, edges };
  }

  /* { project, experiments } -> { nodes, edges, warnings }。experiments 必须
   * 是已经按 project_uid 过滤过、字段未截断的完整 Experiment 对象（读取方式
   * 见计划：Bridge 端用 tools/schema-objects.js 的 readVaultObjects()，本函数
   * 不做任何文件系统访问，只做数据整形）。 */
  function buildProjectGraphProjection({ project, experiments } = {}) {
    const warnings = [];
    if (!project || !project.uid) {
      warnings.push("buildProjectGraphProjection: 缺少 project，跳过投影。");
      return { nodes: [], edges: [], warnings };
    }
    const nodes = [];
    const edges = [];
    const seenNodeIds = new Set();
    for (const exp of Array.isArray(experiments) ? experiments : []) {
      if (exp && exp.project_uid && exp.project_uid !== project.uid) continue; // 只投影本课题自己的实验
      const { nodes: expNodes, edges: expEdges } = projectExperiment(exp);
      for (const node of expNodes) {
        if (seenNodeIds.has(node.id)) continue;
        seenNodeIds.add(node.id);
        nodes.push(node);
      }
      edges.push(...expEdges);
    }
    return { nodes, edges, warnings };
  }

  /* 按节点 id 合并两份 graph 草案（语义抽取 graph + 本文件的投影 graph）。
   * 纯函数，不做网络/文件访问。语义 graph 的同名节点优先保留（它通常带更丰富
   * 的 description/source_refs），投影 graph 只补充语义 graph 里没有的节点；
   * 边直接拼接（渲染器自身会在 normalize 阶段丢弃任一端点缺失的边）。 */
  function mergeGraphDrafts(semanticGraph, projectionGraph) {
    const semantic = semanticGraph && typeof semanticGraph === "object" ? semanticGraph : {};
    const projection = projectionGraph && typeof projectionGraph === "object" ? projectionGraph : {};
    const nodes = Array.isArray(semantic.nodes) ? [...semantic.nodes] : [];
    const seen = new Set(nodes.map((n) => n && n.id).filter(Boolean));
    for (const node of Array.isArray(projection.nodes) ? projection.nodes : []) {
      if (!node || !node.id || seen.has(node.id)) continue;
      seen.add(node.id);
      nodes.push(node);
    }
    const edges = [
      ...(Array.isArray(semantic.edges) ? semantic.edges : []),
      ...(Array.isArray(projection.edges) ? projection.edges : []),
    ];
    const warnings = [
      ...(Array.isArray(semantic.warnings) ? semantic.warnings : []),
      ...(Array.isArray(projection.warnings) ? projection.warnings : []),
    ];
    return {
      title: semantic.title || projection.title || "",
      research_question: semantic.research_question || projection.research_question || "",
      summary: semantic.summary || projection.summary || "",
      nodes, edges, warnings,
    };
  }

  const api = { buildProjectGraphProjection, mergeGraphDrafts };
  if (isNode) module.exports = api;
  if (typeof window !== "undefined") window.weaverGraphProjectionCore = api;
})();
