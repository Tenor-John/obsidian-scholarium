"use strict";
/* seed-reconstruction-core.js — 种子文献驱动的 P1-P2 证据重建：纯函数核心。
 *
 * Agent 的职责止于「发现候选 / 审计相关性 / 分析已下载全文」，全程只读，
 * 只输出结构化 JSON；本文件负责三件事：
 *   1. 构造给 Agent 的只读 prompt（阶段 A/B 候选发现，阶段 D 内容准入分析）；
 *   2. 严格校验并过滤 Agent 回复——不信任模型自称的 DOI、引用关系、目标假设，
 *      任何缺来源摘录/缺可定位引用/引用不存在假设的条目一律丢弃；
 *   3. 只在研究者于审阅界面逐项编辑、勾选、确认之后，本地确定性构造
 *      schema-v1 Paper / Evidence / Decision 草稿——Agent 不参与这一步，
 *      本文件也绝不因为 Agent 的建议就自动生成任何 vault 对象。
 *
 * 期刊白名单判定（checkJournalWhitelist）不依赖 Agent 或外部脚本：白名单数据
 * 由可信的 Bridge 服务端读取后传入，判定本身是纯函数，可单测。
 *
 * Browser/Node 双端可用（沿用 project-mode-core.js 的壳模式）。
 */
(() => {
  const isNode = typeof module !== "undefined" && module.exports;
  const ProjectCore = isNode ? require("./project-mode-core.js") : window.weaverProjectModeCore;
  const { allocate, uuidV7, isoWeek } = ProjectCore;

  const text = (value, max = 800) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const list = (value, cap = 12, max = 240) => [...new Set((Array.isArray(value) ? value : []).map((v) => text(v, max)).filter(Boolean))].slice(0, cap);
  const yaml = (value) => JSON.stringify(String(value ?? ""));
  const safe = (value) => text(value, 70).replace(/[\\/:*?"<>|#[\]]/g, "-").replace(/[. ]+$/g, "") || "draft";
  const DOI_RE = /^10\.\d{4,9}\/\S+$/i;

  function frontmatter(object) {
    const lines = ["---"];
    for (const [key, value] of Object.entries(object)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        if (!value.length) lines.push(`${key}: []`);
        else { lines.push(`${key}:`); for (const item of value) lines.push(`  - ${typeof item === "object" ? JSON.stringify(item) : yaml(item)}`); }
      } else if (value && typeof value === "object") {
        lines.push(`${key}:`); for (const [k, v] of Object.entries(value)) lines.push(`  ${k}: ${JSON.stringify(v)}`);
      } else if (typeof value === "number" || typeof value === "boolean") lines.push(`${key}: ${value}`);
      else lines.push(`${key}: ${yaml(value)}`);
    }
    return lines.concat("---", "").join("\n");
  }

  /* ---------- 身份门：Project 标题 vs 工作区 topic.json.name ---------- */

  function normalizeTitle(value) {
    return String(value || "")
      // topic.json often stores formula subscripts as plain ASCII while the
      // Project title uses Unicode (for example CeO2 vs CeO₂). NFKD folds
      // compatibility glyphs without weakening the actual title comparison.
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[\s　]+/g, "")
      .replace(/[·•,，。.:：;；!！?？'"“”‘’()（）[\]【】\-_/\\]+/g, "");
  }

  /* 只做语义比对（Project 标题 vs 工作区 topic.json 的 name）；workspace 与
   * allowedRoots 的路径级校验交给已有的 allowedRoot()（server 端），这里不重
   * 复实现路径比较。任一不一致都返回 ok:false，调用方必须整体阻断，不允许
   * 部分继续——这是 PRJ-004 身份配 PRJ-002 cwd 那次故障的直接修复。 */
  function identityGateCheck({ projectTitle, topicName }) {
    const reasons = [];
    const a = normalizeTitle(projectTitle);
    const b = normalizeTitle(topicName);
    if (!a || !b || a !== b) {
      reasons.push(`Project 标题（${text(projectTitle, 120) || "空"}）与工作区 topic.json 的 name（${text(topicName, 120) || "空"}）规范化后不一致`);
    }
    return reasons.length ? { ok: false, reasons } : { ok: true };
  }

  /* ---------- 阶段 A/B：候选发现 + 相关性初筛（只读 prompt） ---------- */

  function buildCandidateDiscoveryPrompt({ project, seeds, sourceManifest = [] }) {
    const crossrefSources = (Array.isArray(sourceManifest) ? sourceManifest : []).map((source) => ({
      source: source?.source,
      endpoint: source?.endpoint,
      seed_doi: source?.seed_doi,
      fetched_at: source?.fetched_at,
      work: source?.work,
      // Crossref's own reference records are the only permitted external
      // evidence at this stage. Keep enough metadata to let the researcher
      // recognise a method-chain paper without making the Agent re-fetch it.
      references: (Array.isArray(source?.references) ? source.references : []).slice(0, 200).map((reference) => ({
        doi: text(reference.doi, 200), title: text(reference.title, 300), journal: text(reference.journal, 180),
        authors: text(reference.authors, 180), year: Number.isFinite(Number(reference.year)) ? Number(reference.year) : null,
      })),
    }));
    const payload = JSON.stringify({
      project_display_id: project?.display_id,
      project_title: project?.title,
      research_question: project?.research_question || project?.thesis || "",
      seeds: list(seeds, 10, 120),
      crossref_source_manifest: crossrefSources,
    }).slice(0, 48000);
    return [
      "你是 Scholarium 种子文献证据重建的候选发现 Agent，只读权限：只能用检索/抓取类工具查找已发表文献的元数据（标题、期刊、ISSN、年份、作者、DOI）与引用关系（谁引用了种子文献、种子文献引用了谁），不能写入任何文件，不能声称已经准入或确认任何科研结论。",
      "",
      `课题状态：\n${payload}`,
      "",
      "下面的 crossref_source_manifest 是 Bridge 刚刚从 Crossref 固定 HTTPS 端点读取并附在本提示里的原始来源清单。候选发现阶段不得调用 WebFetch、WebSearch 或其他工具；只能从这份清单的 references 中挑选候选，不能补写训练记忆里的 DOI。最多输出 12 条候选，且不要输出 tentative_relevance=exclude 的条目。不要把泛泛的“期刊领域相近”当成相关性。题名非空时，必须能从题名直接看出同一材料/核壳体系或可复用的合成/表征方法；题名缺失时，只可保留作者字段与 seed work.authors 中姓氏精确匹配的同作者链条，其他缺题名条目必须省略。对每个候选，source_query 必须原样填写它所属 source_manifest 的 endpoint（不是另拼一个逐篇 URL）；source_response_excerpt 必须摘录该条 reference 的 DOI 和题名/作者字段。题名、期刊、作者、年份必须逐字采用 source_manifest 的相应字段；缺失就留空，绝不可补写或猜测。符合上述条件但应用不同的同体系、同作者链或方法学论文标为 methodology_reference；不要因为不是直接结论证据静默丢弃。Crossref 条目若只有 DOI 而缺题名，但满足同作者条件，仍可作为 methodology_reference 输出，并在 relevance_reason 说明“元数据待后续审阅”。如果清单确实没有任何相关条目，才输出空 candidates 数组；这属于正常结果。",
      "",
      "只输出 JSON：",
      '{"candidates":[{"doi":"","title":"","journal":"","issn":"","year":0,"authors":[],"relation_to_seed":"references|cited_by","source_query":"","source_response_excerpt":"","tentative_relevance":"direct_evidence|methodology_reference|exclude","relevance_reason":""}]}',
    ].join("\n");
  }

  /* 来源门：doi 必须像 DOI，source_query 与 source_response_excerpt 必须非空
   * （逼迫 Agent 交出可核查的检索依据，而不是凭空报告一条候选）。按 doi 去重，
   * 数量封顶，防止一次性回复过长。整批候选全部不合格才返回 ok:false —— 部分
   * 不合格只是被静默丢弃，不阻塞其余候选进入审阅包。 */
  function parseCandidateDiscoveryReply(raw, { allowedSourceQueries = [], sourceManifest = [] } = {}) {
    let value;
    try {
      const s = String(raw || "");
      const match = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
      value = JSON.parse(match ? match[1] : s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
    } catch { return { ok: false, error: "Agent 返回的候选发现结果不是有效 JSON" }; }
    const rawCandidates = Array.isArray(value.candidates) ? value.candidates : null;
    // "没有找到候选" 是预算受限的正常研究结果，不是来源门失败。只有模型
    // 声称找到了候选、却不给可核查来源/摘录时才拒绝整批；否则 UI 无法区分
    // 诚实的零结果和一次不合规的伪造尝试。
    if (rawCandidates && rawCandidates.length === 0) return { ok: true, value: { candidates: [], empty_result: true } };
    const seen = new Set();
    const allowedSources = new Set((allowedSourceQueries || []).map((value) => text(value, 300)));
    const sourceByDoi = new Map();
    const seedSurnames = new Set();
    for (const source of Array.isArray(sourceManifest) ? sourceManifest : []) {
      const endpoint = text(source?.endpoint, 300);
      for (const author of Array.isArray(source?.work?.authors) ? source.work.authors : []) {
        const words = text(author, 180).toLowerCase().split(/[^a-z]+/).filter(Boolean);
        if (words.length) seedSurnames.add(words.at(-1));
      }
      for (const reference of Array.isArray(source?.references) ? source.references : []) {
        const doi = text(reference?.doi, 200).toLowerCase();
        if (DOI_RE.test(doi) && endpoint) sourceByDoi.set(doi, {
          endpoint, title: text(reference?.title, 400), journal: text(reference?.journal, 200),
          authors: text(reference?.authors, 150), year: Number.isFinite(Number(reference?.year)) ? Number(reference.year) : null,
        });
      }
    }
    const candidates = (rawCandidates || []).slice(0, 80).map((c) => ({
      doi: text(c.doi, 200).replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""),
      title: text(c.title, 400),
      journal: text(c.journal, 200),
      issn: text(c.issn, 20),
      year: Number.isFinite(Number(c.year)) ? Number(c.year) : null,
      authors: list(c.authors, 20, 150),
      relation_to_seed: ["references", "cited_by"].includes(c.relation_to_seed) ? c.relation_to_seed : "cited_by",
      source_query: text(c.source_query, 300),
      source_response_excerpt: text(c.source_response_excerpt, 600),
      tentative_relevance: ["direct_evidence", "methodology_reference", "exclude"].includes(c.tentative_relevance) ? c.tentative_relevance : "exclude",
      relevance_reason: text(c.relevance_reason, 500),
    })).filter((c) => DOI_RE.test(c.doi) && c.source_query && c.source_response_excerpt)
      .filter((c) => !allowedSources.size || allowedSources.has(c.source_query))
      .filter((c) => c.source_response_excerpt.toLowerCase().includes(c.doi.toLowerCase()))
      .filter((c) => !sourceByDoi.size || sourceByDoi.has(c.doi.toLowerCase()))
      .filter((c) => c.tentative_relevance !== "exclude")
      // A missing reference title cannot justify a generic methodology guess.
      // It is admissible only as an exact same-author chain, determined from
      // the Bridge manifest rather than the model's explanation string.
      .filter((c) => {
        const source = sourceByDoi.get(c.doi.toLowerCase());
        if (!source || source.title || !seedSurnames.size) return true;
        const authorWords = source.authors.toLowerCase().split(/[^a-z]+/).filter(Boolean);
        return authorWords.some((word) => seedSurnames.has(word));
      })
      .map((c) => {
        const source = sourceByDoi.get(c.doi.toLowerCase());
        if (!source) return c;
        return {
          ...c, source_query: source.endpoint, title: source.title, journal: source.journal,
          authors: source.authors ? [source.authors] : [], year: source.year, issn: "",
          source_response_excerpt: `DOI: ${c.doi}; title: ${source.title || "(empty)"}; journal: ${source.journal || "(empty)"}; authors: ${source.authors || "(empty)"}; year: ${source.year || "(empty)"}`,
        };
      })
      .filter((c) => (seen.has(c.doi) ? false : (seen.add(c.doi), true)));
    if (!candidates.length && rawCandidates.every((c) => String(c?.tentative_relevance || "") === "exclude")) return { ok: true, value: { candidates: [], empty_result: true } };
    if (!candidates.length) return { ok: false, error: "没有附带可核查检索来源与摘录的候选（来源门未通过）" };
    return { ok: true, value: { candidates } };
  }

  /* Crossref 的 seed reference 列表常常只有 DOI/作者，无法支持研究者作出
   * 有意义的下载决定。Bridge 对已通过来源门的少量候选逐篇做固定域名 GET 后，
   * 用这个纯函数把返回的 `work` 元数据以宿主优先级回填；绝不信任模型补写的
   * 题名。请求失败不会把候选伪装成“不存在”，而是明确标为不可审阅。 */
  function enrichCandidatesWithCrossrefMetadata(candidates, metadataResults = []) {
    const byDoi = new Map();
    for (const result of Array.isArray(metadataResults) ? metadataResults : []) {
      const doi = text(result?.doi || result?.manifest?.work?.doi || result?.manifest?.seed_doi, 200).toLowerCase();
      if (DOI_RE.test(doi)) byDoi.set(doi, result || {});
    }
    return (candidates || []).map((candidate) => {
      const doi = text(candidate?.doi, 200).toLowerCase();
      const result = byDoi.get(doi);
      const work = result?.manifest?.work || null;
      const title = text(work?.title, 400) || text(candidate?.title, 400);
      const wasTitleless = !text(candidate?.title, 400);
      const authors = Array.isArray(work?.authors) && work.authors.length ? list(work.authors, 20, 150) : list(candidate?.authors, 20, 150);
      const issn = Array.isArray(work?.issn) ? text(work.issn[0], 20) : text(candidate?.issn, 20);
      return {
        ...candidate, title, authors, issn,
        journal: text(work?.journal, 200) || text(candidate?.journal, 200),
        year: Number.isFinite(Number(work?.year)) ? Number(work.year) : (Number.isFinite(Number(candidate?.year)) ? Number(candidate.year) : null),
        metadata_status: title ? (work ? "enriched" : "available") : (result?.error ? "unavailable" : "incomplete"),
        metadata_source: work ? text(result?.manifest?.endpoint, 300) : "",
        metadata_fetched_at: work ? text(result?.manifest?.fetched_at, 80) : "",
        metadata_error: result?.error ? text(result.error, 300) : "",
        // The Agent made this inclusion decision before the title backfill.
        // Do not leave a now-false “metadata pending” explanation in the
        // review card; make the remaining human judgement explicit instead.
        relevance_reason: work && wasTitleless
          ? "Bridge 已补全 Crossref 题名；本项仅因同作者链进入候选，需研究者按题名人工复核。"
          : text(candidate?.relevance_reason, 500),
      };
    });
  }

  /* 白名单判定：确定性本地函数，不依赖 Agent 或外部脚本。whitelistData 形状：
   * { byIssn: { [issn]: { tier, score } }, blacklistNames: string[] }（与
   * 共享白名单数据 whitelist_journals.json 按 ISSN 索引、blacklist.json 按刊名
   * 索引的既有约定一致），由服务端从可信数据源加载后传入。查不到 issn、或 issn
   * 不在名单里，一律 'unknown'，由研究者在审阅界面自行判断是否保留——不默认放行。 */
  function checkJournalWhitelist(candidates, whitelistData) {
    const byIssn = whitelistData?.byIssn || {};
    const blacklistNames = new Set((whitelistData?.blacklistNames || []).map((n) => normalizeTitle(n)));
    return (candidates || []).map((c) => {
      const issn = text(c.issn, 20);
      const journalKey = normalizeTitle(c.journal);
      if (journalKey && blacklistNames.has(journalKey)) return { ...c, whitelistStatus: "blacklist", whitelistTier: null };
      if (issn && byIssn[issn]) return { ...c, whitelistStatus: "whitelist", whitelistTier: byIssn[issn].tier || null };
      return { ...c, whitelistStatus: "unknown", whitelistTier: null };
    });
  }

  /* ---------- 阶段 D：内容准入分析（只读，严格限定于 admittedInputs） ---------- */

  function buildContentAdmissionPrompt({ project, admittedInputs, existingHypotheses }) {
    const payload = JSON.stringify({
      project_display_id: project?.display_id,
      admitted_inputs: (admittedInputs || []).map((a) => ({ doi: a.doi, path: a.path })),
      existing_hypotheses: (existingHypotheses || []).map((h) => ({ uid: h.uid, display_id: h.display_id, statement: text(h.statement, 300) })),
    }).slice(0, 14000);
    return [
      "你是 Scholarium 种子文献证据重建的内容准入分析 Agent，只读权限。你只能读取下面 admitted_inputs 列出的精确文件路径，严禁扫描或读取 literature/downloaded-pdfs/ 或任何未在列表中出现的路径——本轮分析必须只基于本轮新下载、已通过下载校验的文献。",
      "",
      `任务上下文：\n${payload}`,
      "",
      "对每篇文献：判断正文是否同时命中课题体系关键词与目标变量/结果关键词；每一条结论都必须提供一句可在原文定位的直接引用（quote）与定位信息（anchor，如小节标题或图表编号）——拿不出可定位引用就不要生成这条结论，改为把该点标记为 insufficient_evidence:true 并说明原因。可以针对 existing_hypotheses 里给出的具体 uid 提出建议关系（relation）与混杂说明，但这只是建议，不代表已经确认，不要使用「确认」「证实」这类措辞。",
      "",
      "只输出 JSON：",
      '{"papers":[{"doi":"","suggested_role":"direct_evidence|methodology_reference|exclude","role_reason":"","findings":[{"quote":"","anchor":"","target_hypothesis_uid":"","relation":"SUPPORTS|CONTRADICTS|QUALIFIES|INCONCLUSIVE|NONE","claim":"","confound_note":"","insufficient_evidence":false,"insufficient_reason":""}]}]}',
    ].join("\n");
  }

  const RELATIONS = new Set(["SUPPORTS", "CONTRADICTS", "QUALIFIES", "INCONCLUSIVE", "NONE"]);

  /* 内容门 + 草案门的第一道防线：doi 必须在 admittedInputs 里出现（不是 Agent
   * 凭空提到的文献）；每条 finding 必须有非空 quote+anchor，或显式标记
   * insufficient_evidence；target_hypothesis_uid 若非空必须在
   * existingHypothesisUids 白名单里，否则整条 finding 丢弃（不能引用不存在
   * 的假设）。 */
  function parseContentAdmissionReply(raw, { admittedInputs = [], existingHypothesisUids = [] } = {}) {
    let value;
    try {
      const s = String(raw || "");
      const match = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
      value = JSON.parse(match ? match[1] : s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
    } catch { return { ok: false, error: "Agent 返回的内容准入分析不是有效 JSON" }; }
    const allowedDois = new Set((admittedInputs || []).map((a) => a.doi));
    const hypUids = new Set(existingHypothesisUids || []);
    const papers = (Array.isArray(value.papers) ? value.papers : []).map((p) => {
      const doi = text(p.doi, 200).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
      if (!allowedDois.has(doi)) return null; // 拒绝不在本轮下载清单里的 DOI
      const findings = (Array.isArray(p.findings) ? p.findings : []).slice(0, 20).map((f) => {
        const insufficient = Boolean(f.insufficient_evidence);
        const quote = text(f.quote, 2000);
        const anchor = text(f.anchor, 300);
        if (!insufficient && !(quote && anchor)) return null; // 无可定位引用又不是显式"不足以判断" -> 丢弃
        const targetUid = text(f.target_hypothesis_uid, 60);
        if (targetUid && !hypUids.has(targetUid)) return null; // 引用不存在的假设 -> 丢弃
        const relation = RELATIONS.has(f.relation) ? f.relation : "NONE";
        return {
          quote, anchor, target_hypothesis_uid: targetUid || null, relation,
          claim: text(f.claim, 1200), confound_note: text(f.confound_note, 1200),
          insufficient_evidence: insufficient, insufficient_reason: text(f.insufficient_reason, 500),
        };
      }).filter(Boolean);
      const suggestedRole = ["direct_evidence", "methodology_reference", "exclude"].includes(p.suggested_role) ? p.suggested_role : "exclude";
      return { doi, suggested_role: suggestedRole, role_reason: text(p.role_reason, 800), findings };
    }).filter(Boolean);
    if (!papers.length) return { ok: false, error: "没有任何一篇通过内容准入分析（可能全部缺少可定位引用，或 DOI 不在本轮下载清单内）" };
    return { ok: true, value: { papers } };
  }

  /* ---------- 审阅包：运行时数据，不是 vault 对象 ---------- */

  /* 纯函数，产出供审阅界面渲染/编辑的结构化对象。dedupHits 由调用方（server
   * 端）预先查询 research.ids / 现有 Paper·Evidence 得到，这里只是把命中结果
   * 挂到对应条目上，供 UI 做"已存在对象，只读展示"的提示，不在这里处理。 */
  function buildReviewPackage({ discovery, contentFindings, admittedInputs = [], dedupHits = {}, existingHypotheses = [] }) {
    const hypByUid = new Map((existingHypotheses || []).map((h) => [h.uid, h]));
    const candidateByDoi = new Map((discovery?.candidates || []).map((candidate) => [candidate.doi, candidate]));
    const papersDedup = dedupHits.papers || {};
    const evidenceDedup = Array.isArray(dedupHits.evidence) ? dedupHits.evidence : [];
    const papers = (contentFindings?.papers || []).map((p) => {
      const input = admittedInputs.find((a) => a.doi === p.doi) || {};
      // 内容分析只关心正文与 Evidence，不能丢掉候选发现阶段已核查过的
      // 书目信息。审阅者应该看到、也能修订 title/journal/year/authors，而不是
      // 最终把 DOI 当作标题写进 Paper 对象。
      const candidate = candidateByDoi.get(p.doi) || {};
      return {
        doi: p.doi,
        title: candidate.title || p.doi,
        journal: candidate.journal || "",
        year: candidate.year || null,
        authors: candidate.authors || [],
        source_query: candidate.source_query || "",
        source_response_excerpt: candidate.source_response_excerpt || "",
        pdf_path: input.path || null,
        pdf_sha256: input.sha256 || null,
        suggested_role: p.suggested_role,
        role_reason: p.role_reason,
        existing_paper: papersDedup[p.doi] || null,
        findings: p.findings.map((f) => ({
          ...f,
          target_hypothesis_display_id: f.target_hypothesis_uid ? (hypByUid.get(f.target_hypothesis_uid)?.display_id || null) : null,
          existing_evidence: evidenceDedup.find((e) => e.source_doi === p.doi && e.target_uid === f.target_hypothesis_uid) || null,
        })),
      };
    });
    return { candidates: discovery?.candidates || [], papers, generated_at: new Date().toISOString() };
  }

  // An Agent's explicit exclusion is advisory rather than irreversible: the
  // researcher may still open and deliberately include it. It must never,
  // however, arrive preselected in the review card just because it was a
  // successfully downloaded PDF.
  function defaultPaperIncluded(paper) {
    return Boolean(paper && !paper.existing_paper && paper.suggested_role !== "exclude");
  }

  /* ---------- 阶段 F：本地确定性构造草稿（只在研究者确认后运行） ---------- */

  /* selections 是研究者在审阅界面编辑/勾选之后的最终数据，形状：
   *  { papers: [{ include, doi, title, journal, year, authors, tags, notes }],
   *    evidence: [{ include, source_doi, target_hypothesis_uid, relation, claim,
   *                 limitations, conditions, strength, quote, quote_hash, anchor }],
   *    decision: { include, title, decision, rationale, trigger_condition } }
   * quote_hash 必须由调用方预先算好（浏览器端用 crypto.subtle.digest 异步算，
   * Node 端可用 crypto.createHash('sha256') 同步算）——这个函数本身保持同步
   * 纯函数，不在这里做哈希计算，也不信任 Agent 给的任何哈希。 */
  function buildAdmissionDrafts({ project, selections, uidFn = uuidV7, existingPaperIds = [], existingPaperDois = [], existingEvidenceIds = [], existingDecisionIds = [], admittedInputs = [], existingHypothesisIds = [], at }) {
    if (!project?.uid || !project?.display_id) throw new Error("缺少正式 Project 上下文");
    const now = at || new Date().toISOString();
    const allowedDois = new Set((admittedInputs || []).map((a) => a.doi));
    const hypUidSet = new Set(existingHypothesisIds || []);

    const selectedPapers = (selections?.papers || []).filter((p) => p.include && allowedDois.has(p.doi));
    const existingDoiSet = new Set((existingPaperDois || []).map((doi) => String(doi).toLowerCase()));
    const duplicate = selectedPapers.find((p) => existingDoiSet.has(String(p.doi).toLowerCase()));
    if (duplicate) throw new Error(`已有 Paper 使用 DOI ${duplicate.doi}；本工作流只能查看/跳过既有对象，不能新建重复记录`);
    const papers = selectedPapers;
    const paperIds = allocate("PAPER", existingPaperIds, papers.length);
    const items = [];
    const paperUidByDoi = new Map();
    papers.forEach((p, i) => {
      const input = admittedInputs.find((a) => a.doi === p.doi);
      const uid = uidFn();
      paperUidByDoi.set(p.doi, uid);
      const object = {
        uid, display_id: paperIds[i], schema_version: 1, type: "paper", created_at: now, updated_at: now,
        title: text(p.title, 400) || p.doi, source: `https://doi.org/${p.doi}`, doi: p.doi,
        journal: text(p.journal, 200), year: Number(p.year) || undefined,
        authors: list(p.authors, 30, 200), keywords: list(p.tags, 16, 80),
        projects: [project.uid],
        source_kind: "local_pdf", source_pdf_path: text(input?.path, 500), source_pdf_sha256: text(input?.sha256, 64),
        bibliographic_status: "doi_only", created_by: "ai", review_status: "pending", verified_by_user: false,
      };
      items.push({
        path: `Research/Papers/${paperIds[i]} Local PDF · ${safe(p.doi.replace(/\//g, "-"))}.md`,
        content: frontmatter(object) + `# ${text(p.title, 300) || p.doi}\n\n${p.notes ? text(p.notes, 2000) + "\n\n" : ""}> 经种子文献重建工作流准入，AI 起草，研究者已在审阅界面确认纳入；未设置人工 confidence。\n`,
      });
    });

    const evidenceSelections = (selections?.evidence || []).filter((e) =>
      e.include && allowedDois.has(e.source_doi) && paperUidByDoi.has(e.source_doi) &&
      e.target_hypothesis_uid && hypUidSet.has(e.target_hypothesis_uid) &&
      text(e.quote, 1) && text(e.anchor, 1) && text(e.quote_hash, 1));
    const evIds = allocate("EVD", existingEvidenceIds, evidenceSelections.length);
    evidenceSelections.forEach((e, i) => {
      const source = admittedInputs.find((a) => a.doi === e.source_doi);
      const object = {
        uid: uidFn(), display_id: evIds[i], schema_version: 1, type: "evidence", created_at: now, updated_at: now,
        claim: text(e.claim, 1500), source_type: "paper", source_uid: paperUidByDoi.get(e.source_doi), target_uid: e.target_hypothesis_uid,
        relation: RELATIONS.has(e.relation) && e.relation !== "NONE" ? e.relation : "QUALIFIES",
        strength: Math.max(0, Math.min(5, Number(e.strength) || 2)),
        limitations: text(e.limitations, 1500), conditions: text(e.conditions, 800),
        quote: text(e.quote, 2000),
        created_by: "ai", verified_by_user: false, review_status: "pending", candidate_only: false,
        // ai_review 复用 tools/evidence-agent-review.js 的既有词汇（decision/relation/
        // claim/reason/model/reviewed_at/prompt_sha256），由调用方（Bridge 端）用
        // makeReview() 构造好传入；本函数只做结构透传，不重新发明这套审阅词汇。
        ...(e.ai_review ? { ai_review: e.ai_review } : {}),
        locator: { source_sha256: text(source?.sha256, 64), anchor: text(e.anchor, 300), quote_hash: text(e.quote_hash, 128), original_url: `https://doi.org/${e.source_doi}` },
      };
      items.push({
        path: `Research/Evidence/${evIds[i]} ${safe(e.claim)}.md`,
        content: frontmatter(object) + `# ${evIds[i]}\n\n${text(e.claim, 1500)}\n\n> AI 起草的待审候选证据，未经研究者确认，不构成对目标 Hypothesis 正式支持/反驳数组的写入。\n`,
      });
    });

    let decisionUid = null;
    if (selections?.decision?.include && (papers.length || evidenceSelections.length)) {
      const decIds = allocate("DEC", existingDecisionIds, 1);
      decisionUid = uidFn();
      const decisionText = text(selections.decision.decision, 3000) || `准入 ${papers.length} 篇 Paper、${evidenceSelections.length} 条待审 Evidence，均为 review_status: pending，未结算为对任一假设的正式支持。`;
      const rationaleText = text(selections.decision.rationale, 6000);
      const triggerText = text(selections.decision.trigger_condition, 2000);
      const object = {
        uid: decisionUid, display_id: decIds[0], schema_version: 1, type: "decision", created_at: now, updated_at: now,
        project_uid: project.uid, title: text(selections.decision.title, 200) || `${project.display_id} 种子文献重建准入`,
        decision: decisionText, rationale: rationaleText, trigger_condition: triggerText,
        relates_to: [...paperUidByDoi.values()], status: "active", created_by: "ai", review_status: "pending", verified_by_user: false,
      };
      items.push({
        path: `Research/Decisions/${decIds[0]} ${safe(object.title)}.md`,
        content: frontmatter(object) + `## 决议\n\n${decisionText}\n\n## 依据\n\n${rationaleText}\n\n## 触发重新评估的条件\n\n${triggerText}\n\n> AI 起草的流程决议，需研究者审阅确认；未设置人工 confidence。\n`,
      });
    }

    if (!items.length) throw new Error("没有任何一项被勾选纳入——请先在审阅界面选择要准入的 Paper/Evidence");
    return { items, paperCount: papers.length, evidenceCount: evidenceSelections.length, decisionUid };
  }

  /* ---------- 阶段 G：P2 版本化图谱的输入清单 ---------- */

  function buildGraphManifest({ admittedInputs = [], paperUids = [], evidenceUids = [], runId, project }) {
    return {
      run_id: runId,
      project_uid: project?.uid,
      project_display_id: project?.display_id,
      generated_at: new Date().toISOString(),
      inputs: admittedInputs.map((a) => ({ doi: a.doi, path: a.path, sha256: a.sha256 })),
      paper_uids: paperUids,
      evidence_uids: evidenceUids,
    };
  }

  const api = {
    normalizeTitle, identityGateCheck,
    buildCandidateDiscoveryPrompt, parseCandidateDiscoveryReply, enrichCandidatesWithCrossrefMetadata, checkJournalWhitelist,
    buildContentAdmissionPrompt, parseContentAdmissionReply,
    buildReviewPackage, defaultPaperIncluded, buildAdmissionDrafts, buildGraphManifest,
    allocate, uuidV7, isoWeek,
  };
  if (isNode) module.exports = api;
  if (typeof window !== "undefined") window.weaverSeedReconstructionCore = api;
})();
