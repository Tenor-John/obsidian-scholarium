"use strict";
/**
 * Schema-v1 objects as Markdown.
 *
 * schema-v1 §7.1 promises that a user's confirmed research cognition survives
 * the plugin: "插件消失后，用户确认过的科研认知必须仍可从 Markdown 读出". Until
 * now nothing enforced that. `tests/schema.test.js` validates six hand-written
 * JSON examples, which proves the shapes are coherent but says nothing about
 * the files actually sitting in the vault.
 *
 * This module is the contract in executable form: read an object out of a
 * Markdown note, write one back, and say whether it satisfies §4. It is also
 * deliberately dependency-free and runnable outside Obsidian, so the rules can
 * be tested without a running plugin.
 *
 *   node tools/schema-objects.js --vault <path>      # validate every object
 */
const fs = require("fs");
const path = require("path");

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const PREFIX = {
  project: "PRJ", question: "Q", hypothesis: "HYP",
  paper: "PAPER", evidence: "EVD", experiment: "EXP", idea: "IDEA",
  decision: "DEC", lesson: "LES",
};
const ENUMS = {
  project: { status: ["active", "paused", "archived"] },
  question: { status: ["open", "partial", "answered", "blocked", "abandoned"] },
  hypothesis: { status: ["proposed", "plausible", "supported", "challenged", "rejected", "superseded"] },
  // self-evolving-agent-design.md §5.1. `promoted` means a PRJ now exists for
  // this Idea (promoted_to set). M3's promotion preview/commit transaction
  // creates the PRJ and profile v0 before it writes this terminal state.
  idea: { status: ["exploring", "promoted", "shelved"] },
  // 决策持久化（2026-08-26）：一条决策默认 active（仍在生效/仍待触发条件成立）；
  // resolved 表示触发条件已经成立并已据此行动，或决策本身已不再适用——具体
  // 原因写进正文，schema 层不追加第二个状态维度（不做 superseded/追加链）。
  decision: { status: ["active", "resolved"] },
  // 经验候选提取（M5 步骤1, 2026-08-26）：一条经验默认 active（仍被采信）；
  // retired 表示后来发现它不成立或已被更细的经验取代——同 decision 一样不做
  // 二次状态维度，原因写正文。status 之外的严格性都在 REQUIRED/下面的类型
  // 专属校验里：evidence_refs/source_types 必须非空，逼着草稿引真实证据而
  // 不是空口下结论。
  lesson: { status: ["active", "retired"] },
  evidence: {
    source_type: ["paper", "experiment", "asset"],
    relation: ["SUPPORTS", "CONTRADICTS", "QUALIFIES", "REPLICATES", "FAILS_TO_REPLICATE", "DEPENDS_ON"],
    // `verified_by_user: false` used to mean both "not reviewed" and
    // "reviewed and rejected".  That ambiguity makes an AI proposal queue
    // non-convergent: a rejected irrelevant quote can be proposed forever.
    review_status: ["pending", "confirmed", "rejected", "demonstration"],
  },
  experiment: {
    status: ["idea", "designed", "ready", "running", "data_pending", "analyzing", "concluded", "integrated"],
    // `data_origin` is deliberately about provenance, not confidence.  An AI
    // may help analyse a record, but it must never make simulated output look
    // like a measurement from the laboratory.
    data_origin: ["planned", "measured", "simulated", "imported"],
  },
};
const REQUIRED = {
  project: ["title"],
  question: ["project_uid", "statement"],
  hypothesis: ["project_uid", "statement"],
  paper: ["title", "source"],
  evidence: ["source_type", "source_uid"],
  experiment: ["project_uid", "title"],
  idea: ["title"],
  // rationale 必填是刻意的：呼应 evidence 的"无来源不得写入"纪律——一条没有
  // 依据的决策，和一条没有来源的证据一样不可信，schema 层就该挡住它。
  decision: ["project_uid", "title", "decision", "rationale"],
  // 经验候选（M5 步骤1）：project_uid 刻意不在必填里——有些经验是方法论层
  // 面的、跨课题成立（比如"共享设备排期容易 blocked"），不该被强行按到某
  // 一个课题头上。scope 必填是研究员明确要求的"标明适用范围"；
  // evidence_summary（文字说明）+ evidence_refs（真 uid 数组）+ source_types
  // 三项一起，呼应 evidence 对象"无来源不得写入"的同一条纪律——一条经验，
  // 和一条证据一样，没有来源就不可信。
  lesson: ["title", "statement", "scope", "evidence_summary", "evidence_refs", "source_types"],
};
const LIST_KEYS = new Set([
  "authors", "keywords", "tags", "projects", "active_hypothesis_uids",
  "legacy_hypothesis_summaries", "current_problems", "methods_needed", "excluded_topics",
  "wavelengths", "related_hypotheses", "missing_evidence", "supporting_evidence",
  "contradicting_evidence", "assumptions", "alternative_explanations", "required_tests",
  "tests_hypotheses", "produced_evidence", "raw_data_refs",
  "hotspots", "key_papers", "gaps",
  "relates_to",
  "evidence_refs", "source_types",
]);

/* ------------------------------------------------------------------ */
/* markdown <-> object                                                 */
/* ------------------------------------------------------------------ */
function splitFrontmatter(text) {
  const hit = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  return hit ? { frontmatter: hit[1], body: text.slice(hit[0].length) } : { frontmatter: "", body: text };
}

function unquote(value) {
  const v = String(value).trim();
  if (!/^".*"$/.test(v)) return v.replace(/^'|'$/g, "");
  // Written with JSON.stringify, so read it back the same way. Stripping the
  // outer quotes by hand adds a backslash level on every save — a bug this
  // project has already shipped once.
  try { return JSON.parse(v); } catch (e) { return v.slice(1, -1); }
}

function parseObject(text) {
  const { frontmatter, body } = splitFrontmatter(text);
  const out = {};
  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].trim();
    if (raw === "") {
      const next = lines[i + 1] || "";
      if (/^\s+[A-Za-z0-9_]+:/.test(next) && !/^\s*-\s/.test(next)) {
        // A nested mapping such as `locator:`. Reading this by slicing the
        // frontmatter at the key's character offset silently produced an empty
        // object, because the slice began with the line break and the very
        // first line failed the indent test — which cost every Evidence its
        // locator on the first save.
        const nested = {};
        while (i + 1 < lines.length && /^\s+[A-Za-z0-9_]+:/.test(lines[i + 1])) {
          const childLine = lines[++i];
          const child = /^(\s+)([A-Za-z0-9_]+):\s*(.*)$/.exec(childLine);
          if (!child) continue;
          const [, childIndent, childKey, childRaw] = child;
          if (childRaw) {
            nested[childKey] = unquote(childRaw);
            continue;
          }
          // Nested maps may contain lists, e.g. project profile boundaries:
          //   boundaries:
          //     do:
          //       - "define the mechanism"
          //     dont:
          //       - "claim causality early"
          // Treating the empty child value as a scalar used to discard those
          // list items on the next read, even though serialization was right.
          const items = [];
          const itemIndent = childIndent.length;
          while (i + 1 < lines.length) {
            const itemLine = lines[i + 1];
            const item = /^(\s*)-\s+(.*)$/.exec(itemLine);
            if (!item || item[1].length <= itemIndent) break;
            i += 1;
            const rawItem = item[2];
            if (rawItem.startsWith("{")) {
              try { items.push(JSON.parse(rawItem)); continue; } catch (e) { /* fall through */ }
            }
            items.push(unquote(rawItem));
          }
          nested[childKey] = items;
        }
        out[key] = nested;
      } else {
        const items = [];
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
          const item = lines[++i].replace(/^\s*-\s+/, "");
          // History entries are objects; they are written as one-line JSON so a
          // round trip returns them unchanged instead of "[object Object]".
          if (item.startsWith("{")) {
            try { items.push(JSON.parse(item)); continue; } catch (e) { /* fall through */ }
          }
          items.push(unquote(item));
        }
        out[key] = items;
      }
    } else if (raw === "[]") out[key] = [];
    else if (raw === "{}") out[key] = {};
    else if (raw === "true" || raw === "false") out[key] = raw === "true";
    else if (/^-?\d+(\.\d+)?$/.test(raw)) out[key] = Number(raw);
    else out[key] = unquote(raw);
  }
  return { object: out, body };
}

function emit(key, value, indent = "") {
  if (Array.isArray(value)) {
    if (!value.length) return indent + key + ": []";
    return [indent + key + ":", ...value.map((v) =>
      // `String(v)` on a history entry yields "[object Object]", which would
      // destroy the very record §4.3 requires every transition to leave.
      indent + "  - " + (v && typeof v === "object" ? JSON.stringify(v) : JSON.stringify(String(v))),
    )].join("\n");
  }
  if (value && typeof value === "object")
    return [indent + key + ":", ...Object.entries(value).map(([k, v]) => emit(k, v, indent + "  "))].join("\n");
  if (typeof value === "boolean" || typeof value === "number") return indent + key + ": " + value;
  return indent + key + ": " + JSON.stringify(String(value));
}

const HEAD = ["uid", "display_id", "schema_version", "type", "created_at", "updated_at"];

function serializeObject(object, body = "") {
  const keys = [...HEAD.filter((k) => object[k] !== undefined),
    ...Object.keys(object).filter((k) => !HEAD.includes(k))];
  const lines = keys.map((k) => emit(k, object[k]));
  return "---\n" + lines.join("\n") + "\n---\n" + body;
}

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */
function validateObject(object) {
  const errors = [];
  const type = object.type;
  const add = (m) => errors.push(m);

  // 曾经写死"六类"，但类型早就超过六个了（idea 是第七类，decision 是第八
  // 类）且这条消息已经跟着漂移过一次——2026-08-26 改成不写死数量，避免再
  // 漂移第二次。
  if (!PREFIX[type]) { add("type 不是已知的 schema-v1 对象类型之一：" + JSON.stringify(type) + "（已知类型：" + Object.keys(PREFIX).join(", ") + "）"); return errors; }
  if (!UUID_V7.test(String(object.uid || ""))) add("uid 必须是 UUIDv7");
  if (object.schema_version !== 1) add("schema_version 必须为 1");
  if (!new RegExp("^" + PREFIX[type] + "-\\d+$").test(String(object.display_id || "")))
    add("display_id 必须是 " + PREFIX[type] + "-NNN");
  for (const key of ["created_at", "updated_at"])
    if (!ISO.test(String(object[key] || ""))) add(key + " 必须是 ISO8601");
  for (const key of REQUIRED[type] || [])
    if (object[key] === undefined || object[key] === "") add(type + " 缺少必填字段 " + key);
  for (const [key, allowed] of Object.entries(ENUMS[type] || {}))
    if (object[key] !== undefined && !allowed.includes(object[key]))
      add(key + " 必须是 " + allowed.join(" | ") + "，实际为 " + JSON.stringify(object[key]));
  for (const key of ["project_uid", "source_uid", "target_uid", "next_test", "method_uid", "protocol_uid"])
    if (object[key] !== undefined && object[key] !== "" && !UUID_V7.test(String(object[key])))
      add(key + " 必须引用 UUIDv7，不得引用路径或标题");
  for (const key of LIST_KEYS)
    if (object[key] !== undefined && !Array.isArray(object[key])) add(key + " 必须是数组");

  if (type === "hypothesis") {
    if (object.confidence !== undefined) {
      const c = Number(object.confidence);
      if (!(c >= 0 && c <= 1)) add("confidence 必须在 0 到 1 之间");
      // §4.3: AI may only submit a draft. A confidence that no human set is not
      // a weaker signal, it is an invalid one.
      if (object.confidence_set_by !== "user")
        add("confidence 只接受人工写入，confidence_set_by 必须为 user");
    }
  }

  if (type === "idea") {
    // §5.1: promoted_to is empty until promotion, then holds the PRJ
    // display_id it became — a display_id, not a uid, because at the point
    // an Idea is written its downstream PRJ (if any) may not exist yet and
    // there is nothing to mint a uid reference against. Never fabricate one.
    const promotedTo = String(object.promoted_to || "").trim();
    if (promotedTo && !/^PRJ-\d+$/.test(promotedTo)) add("promoted_to 必须是 PRJ-NNN 或留空");
    if (object.status === "promoted" && !promotedTo) add("status 为 promoted 时 promoted_to 必须指向已创建的课题");
    if (object.status !== "promoted" && promotedTo) add("promoted_to 只能在 status 为 promoted 时填写");
  }

  if (type === "decision") {
    // relates_to 的成员必须是 UUIDv7 格式的引用（真正的 uid，不是 EXP-007
    // 这种 display_id）——和 §4 全库的"关系字段一律引用 uid"约定一致；是否
    // 真的存在，由 validateVault() 的跨对象引用完整性检查负责，这里只管形状。
    for (const uid of Array.isArray(object.relates_to) ? object.relates_to : [])
      if (!UUID_V7.test(String(uid))) add("relates_to 的每一项都必须是 UUIDv7：" + JSON.stringify(uid));
    if (object.decided_at !== undefined && !ISO.test(String(object.decided_at || "")))
      add("decided_at 如果填写，必须是 ISO8601");
  }

  if (type === "lesson") {
    // §evidence 的"无来源不得写入"纪律搬到经验候选上：REQUIRED 已经挡掉
    // "整个字段缺失"，这里补上 REQUIRED 挡不住的"字段存在但是空数组"——
    // 一条经验候选如果一条真实证据都不引用，就是空口下结论，必须挡住。
    const refs = Array.isArray(object.evidence_refs) ? object.evidence_refs : [];
    if (!refs.length) add("evidence_refs 不能为空——经验候选必须至少引用一条真实证据（EXP/DEC 等对象的 uid）");
    for (const uid of refs)
      if (!UUID_V7.test(String(uid))) add("evidence_refs 的每一项都必须是 UUIDv7：" + JSON.stringify(uid));
    const sources = Array.isArray(object.source_types) ? object.source_types : [];
    const allowedSources = ["execution_backfill", "drift_audit", "decision"];
    if (!sources.length) add("source_types 不能为空——必须说明这条经验候选来自执行回填、漂移检查还是决策");
    for (const s of sources)
      if (!allowedSources.includes(s))
        add("source_types 的每一项必须是 " + allowedSources.join(" | ") + "，实际为 " + JSON.stringify(s));
  }

  if (type === "evidence") {
    // Retrieval may establish a reproducible passage and target without yet
    // being able to state a scientific claim.  Do not fabricate a template
    // claim merely to satisfy schema shape: candidate_only is the explicit
    // pre-claim state and can never be confirmed or linked formally.
    const candidateOnly = object.candidate_only === true;
    if (!candidateOnly && !String(object.claim || "").trim())
      add("evidence 缺少必填字段 claim");
    if (candidateOnly) {
      if (!['pending', 'rejected'].includes(object.review_status) || object.verified_by_user !== false)
        add("candidate_only Evidence 只能保持 pending 或 rejected，且未由用户确认");
      if (object.created_by !== "ai")
        add("candidate_only Evidence 只能由 ai 创建");
      if (String(object.claim || "").trim())
        add("candidate_only Evidence 不得写入占位 claim；等待 AI 或研究者形成主张");
    }
    if (typeof object.verified_by_user !== "boolean") add("verified_by_user 必须是布尔值");
    // Legacy Evidence predates this field. It remains readable and is treated
    // as pending/confirmed from verified_by_user; new Evidence is explicit.
    const review = object.review_status;
    if (review === "confirmed") {
      if (candidateOnly) add("candidate_only Evidence 不能直接确认；须先形成 claim");
      if (object.verified_by_user !== true)
        add("review_status 为 confirmed 时 verified_by_user 必须为 true");
      if (!ISO.test(String(object.verified_at || "")))
        add("review_status 为 confirmed 时必须记录 verified_at");
    }
    if (review === "rejected") {
      if (object.verified_by_user !== false)
        add("review_status 为 rejected 时 verified_by_user 必须为 false");
      if (!String(object.rejection_reason || "").trim())
        add("驳回的 Evidence 必须记录 rejection_reason");
      if (!ISO.test(String(object.rejected_at || "")))
        add("驳回的 Evidence 必须记录 rejected_at");
    }
    if (review === "demonstration") {
      if (candidateOnly) add("candidate_only Evidence 不能标为 demonstration；须先形成可核对的 claim");
      if (object.verified_by_user !== false)
        add("review_status 为 demonstration 时 verified_by_user 必须为 false");
      if (!String(object.demonstration_reason || "").trim())
        add("流程演示 Evidence 必须记录 demonstration_reason");
      if (!ISO.test(String(object.demonstrated_at || "")))
        add("流程演示 Evidence 必须记录 demonstrated_at");
      if (object.demonstrated_by !== "user")
        add("流程演示 Evidence 必须由研究者标记，demonstrated_by 必须为 user");
    }
    if (review === "pending" && object.verified_by_user === true)
      add("review_status 为 pending 时 verified_by_user 必须为 false");
    // AI review is an auditable draft, not a substitute for review_status.
    // Keeping it separate prevents a model response from impersonating a human
    // confirmation while still making its proposed rationale durable and editable.
    if (object.ai_review !== undefined) {
      const a = object.ai_review;
      if (!a || typeof a !== "object" || Array.isArray(a)) add("ai_review 必须是对象");
      else {
        if (!['confirm', 'reject', 'uncertain'].includes(a.decision))
          add("ai_review.decision 必须是 confirm | reject | uncertain");
        if (!ISO.test(String(a.reviewed_at || ""))) add("ai_review.reviewed_at 必须是 ISO8601");
        if (!String(a.model || "").trim()) add("ai_review.model 必填");
        if (!String(a.reason || "").trim()) add("ai_review.reason 必填");
        if (!SHA256.test(String(a.prompt_sha256 || ""))) add("ai_review.prompt_sha256 必须是 64 位 SHA-256");
        if (a.target_uid && !UUID_V7.test(String(a.target_uid))) add("ai_review.target_uid 必须引用 UUIDv7");
        if (a.decision === "confirm") {
          if (!(ENUMS.evidence.relation || []).includes(a.relation)) add("ai_review.relation 不合法");
          if (!String(a.claim || "").trim()) add("ai_review.claim 必填");
        }
      }
    }
    const l = object.locator || {};
    // §6: 四项缺一不可.
    for (const key of ["source_sha256", "anchor", "quote_hash", "original_url"])
      if (!String(l[key] || "").trim()) add("locator." + key + " 缺失：§6 四项缺一不可");
    if (l.source_sha256 && !SHA256.test(String(l.source_sha256))) add("locator.source_sha256 必须是 64 位 SHA-256");
    if (/^[.#[]|\s>\s/.test(String(l.anchor || "")))
      add("locator.anchor 看起来是 CSS selector；§6 禁止以出版社选择器定位");

    /* §6.2 — an experiment has no publisher and no URL.
       §4.5 has always allowed `source_type: experiment`, but every one of §6's
       four fields was written for a web archive, so an experiment result could
       not be expressed at all: the whole Hypothesis → Experiment → Evidence
       chain was blocked at the contract, not in code.

       The four fields still apply; only what they point at changes. The
       reasoning behind `source_sha256` shifts in an instructive way. For a
       paper it pins bytes we do not control, so a publisher redesign cannot
       silently move the quote. For an experiment it pins OUR OWN record as it
       read when the evidence was drawn, because the researcher will keep
       editing that record — and a conclusion resting on a superseded result is
       exactly as broken as a citation into a re-rendered page.

       `original_url` cannot be a vault path. §2.1 refuses paths as relation
       anchors precisely because renaming breaks them, and a review entry point
       that dies on rename is no better than a dangling citation. The uid does
       not move. */
    if (object.source_type === "experiment") {
      const url = String(l.original_url || "");
      const m = /^scholarium:\/\/experiment\/([0-9a-f-]{36})$/i.exec(url);
      if (!m) add("实验来源的 locator.original_url 必须是 scholarium://experiment/<uid>（§6.2）");
      else {
        if (!UUID_V7.test(m[1])) add("locator.original_url 中的实验 uid 必须是 UUIDv7");
        else if (object.source_uid && m[1].toLowerCase() !== String(object.source_uid).toLowerCase())
          add("locator.original_url 指向的实验与 source_uid 不一致");
      }
    } else if (l.original_url && !/^https?:\/\//i.test(String(l.original_url))) {
      add("locator.original_url 必须是 http(s) 地址；实验来源见 §6.2");
    }
  }

  if (type === "experiment") {
    /* `"|"` is a YAML block-scalar indicator. EXP-001 was serialised with the
       indicator and none of the text it introduces, so `result` and
       `conclusion` each held one character while the actual 1,059 characters
       sat in the note body. The field was non-empty, so the guard passed and
       the experiment reached `concluded` carrying no conclusion at all — a
       requirement defeated by a single punctuation mark. */
    const substantive = (v) => String(v || "").replace(/[|>+\-\s]/g, "").length > 0;
    if (object.status === "concluded" && !substantive(object.conclusion))
      add("进入 concluded 前 conclusion 必填，且不得只是 YAML 块标量指示符");
    if (object.status === "integrated" && !(object.produced_evidence || []).length)
      add("进入 integrated 前 produced_evidence 必须非空");

    // Provenance fields were added after the first Experiment records had
    // already been written.  Their absence therefore means legacy/unknown,
    // not an invented claim that old data were measured.  Every newly-written
    // record carries data_origin; once it does, validate the declaration.
    if (object.data_origin !== undefined) {
      const origin = object.data_origin;
      const refs = Array.isArray(object.raw_data_refs) ? object.raw_data_refs : [];
      if (!String(object.data_recorded_by || "").trim())
        add("data_recorded_by 必填；数据来源只能由研究者声明");
      else if (object.data_recorded_by !== "user")
        add("data_recorded_by 必须为 user；Agent 不得声明数据来源");
      if (!ISO.test(String(object.data_recorded_at || "")))
        add("data_recorded_at 必须是 ISO8601");
      if (refs.some((ref) => !String(ref || "").trim()))
        add("raw_data_refs 不得包含空的数据来源引用");
      if (["measured", "imported"].includes(origin)) {
        if (!refs.length) add("实测或导入数据必须至少提供一条 raw_data_refs");
        if (!substantive(object.data_provenance_note))
          add("实测或导入数据必须说明 data_provenance_note");
      }
      if (origin === "simulated" && !substantive(object.data_provenance_note))
        add("模拟数据必须说明 data_provenance_note，避免与实测混淆");
      if (["concluded", "integrated"].includes(object.status) && origin === "planned")
        add("尚未产生数据（planned）的 Experiment 不能进入 concluded 或 integrated");
      if (object.status === "integrated" && origin === "simulated")
        add("模拟数据可用于流程演练，但 Experiment 不能进入 integrated");
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ */
/* creation and change                                                 */
/* ------------------------------------------------------------------ */
function uuidV7(now = Date.now(), random = require("crypto").randomBytes) {
  const bytes = random(16);
  const time = BigInt(now);
  for (let i = 5; i >= 0; i--) bytes[i] = Number((time >> BigInt((5 - i) * 8)) & 255n);
  bytes[6] = 112 | (bytes[6] & 15);
  bytes[8] = 128 | (bytes[8] & 63);
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

function nextDisplayId(existing, type) {
  const used = new Set(existing);
  let n = 1, id;
  do { id = PREFIX[type] + "-" + String(n++).padStart(3, "0"); } while (used.has(id));
  return id;
}

function createObject(type, fields, options = {}) {
  if (!PREFIX[type]) throw new Error("不支持的对象类型：" + type);
  const now = options.now || new Date().toISOString();
  const object = {
    uid: options.uid || uuidV7(),
    display_id: options.display_id || nextDisplayId(options.existingDisplayIds || [], type),
    schema_version: 1,
    type,
    created_at: now,
    updated_at: now,
    ...fields,
  };
  if (type === "hypothesis") {
    // A hypothesis starts as `proposed` with no confidence at all. Seeding one
    // would be a machine-set confidence wearing a default's clothes, and §4.3
    // reserves that field for a person.
    if (object.status === undefined) object.status = "proposed";
    for (const key of ["supporting_evidence", "contradicting_evidence", "assumptions",
      "alternative_explanations", "required_tests"])
      if (object[key] === undefined) object[key] = [];
    if (object.history === undefined) object.history = [];
  }
  if (type === "evidence") {
    if (object.verified_by_user === undefined) object.verified_by_user = false;
    if (object.review_status === undefined) object.review_status = object.verified_by_user ? "confirmed" : "pending";
  }
  if (type === "decision") {
    if (object.status === undefined) object.status = "active";
    if (object.relates_to === undefined) object.relates_to = [];
    // decided_at 默认等于 created_at（多数决策是"当场记录"），但允许显式
    // 传入更早的日期——研究员在聊天里定稿一个结论、隔几天才让织研者补记
    // 成正式记录时，"决策发生的时间"和"文件写入的时间"是两回事。
    if (object.decided_at === undefined) object.decided_at = now;
  }
  if (type === "lesson") {
    if (object.status === undefined) object.status = "active";
  }
  const errors = validateObject(object);
  if (errors.length) throw new Error("新对象不满足 schema v1：" + errors.join("；"));
  return object;
}

/**
 * Change a hypothesis's status or confidence, recording why.
 *
 * §4.3 asks for two things that are easy to implement separately and wrong
 * separately: confidence is human-only, and every transition records its cause.
 * Doing them in one place means a caller cannot get one without the other.
 */
function applyHypothesisChange(object, change, options = {}) {
  if (object.type !== "hypothesis") throw new Error("只能用于 hypothesis");
  const now = options.now || new Date().toISOString();
  const by = change.by;
  if (change.confidence !== undefined && by !== "user")
    throw new Error("confidence 只接受人工写入：AI 只能提交草案");
  if (change.status !== undefined && !ENUMS.hypothesis.status.includes(change.status))
    throw new Error("未知 status：" + change.status);

  const entry = {
    at: now,
    from_status: object.status,
    to_status: change.status !== undefined ? change.status : object.status,
    from_conf: object.confidence === undefined ? "" : object.confidence,
    to_conf: change.confidence !== undefined ? change.confidence
      : (object.confidence === undefined ? "" : object.confidence),
    cause_uid: change.cause_uid || "",
    by: by || "",
  };
  const next = { ...object, updated_at: now, history: [...(object.history || []), entry] };
  if (change.status !== undefined) next.status = change.status;
  if (change.confidence !== undefined) {
    next.confidence = change.confidence;
    next.confidence_set_by = "user";
  }
  const errors = validateObject(next);
  if (errors.length) throw new Error("变更后不满足 schema v1：" + errors.join("；"));
  return next;
}

const SUPPORTING_RELATIONS = new Set(["SUPPORTS", "REPLICATES"]);
const CONTRADICTING_RELATIONS = new Set(["CONTRADICTS", "FAILS_TO_REPLICATE"]);

/**
 * Link a piece of evidence to the hypothesis it bears on.
 *
 * §4.3 gives a Hypothesis exactly two arrays. QUALIFIES and DEPENDS_ON belong
 * in neither: evidence that narrows a hypothesis's conditions is not evidence
 * for it. An earlier version filed everything that was not CONTRADICTS as
 * support, which quietly turned every qualification into a vote in favour.
 * Those relations stay reachable through the evidence's own `target_uid` and
 * are shown separately, rather than being forced into a slot the frozen schema
 * does not have.
 */
function linkEvidence(hypothesis, evidenceUid, relation) {
  if (hypothesis.type !== "hypothesis") throw new Error("只能用于 hypothesis");
  if (!SUPPORTING_RELATIONS.has(relation) && !CONTRADICTING_RELATIONS.has(relation)) return hypothesis;
  const key = CONTRADICTING_RELATIONS.has(relation) ? "contradicting_evidence" : "supporting_evidence";
  const other = key === "supporting_evidence" ? "contradicting_evidence" : "supporting_evidence";
  if ((hypothesis[other] || []).includes(evidenceUid))
    throw new Error("同一条证据不能同时支持与反驳：" + evidenceUid);
  if ((hypothesis[key] || []).includes(evidenceUid)) return hypothesis;
  return { ...hypothesis, [key]: [...(hypothesis[key] || []), evidenceUid] };
}

// A workflow demonstration remains a readable Evidence object, but it must no
// longer count as a formal vote for or against its target hypothesis.
function unlinkEvidence(hypothesis, evidenceUid) {
  if (hypothesis.type !== "hypothesis") throw new Error("只能用于 hypothesis");
  return {
    ...hypothesis,
    supporting_evidence: (hypothesis.supporting_evidence || []).filter((uid) => uid !== evidenceUid),
    contradicting_evidence: (hypothesis.contradicting_evidence || []).filter((uid) => uid !== evidenceUid),
  };
}

/* ------------------------------------------------------------------ */
/* vault scan                                                          */
/* ------------------------------------------------------------------ */
function readVaultObjects(vault) {
  const root = path.join(vault, "Research");
  const found = [];
  if (!fs.existsSync(root)) return found;
  const visit = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "assets") continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 2) visit(abs, depth + 1); continue; }
      if (!e.name.endsWith(".md")) continue;
      const { object } = parseObject(fs.readFileSync(abs, "utf8"));
      if (!object.type || !PREFIX[object.type]) continue;
      found.push({ path: path.relative(vault, abs).split(path.sep).join("/"), object });
    }
  };
  visit(root, 0);
  return found;
}

function validateVault(vault) {
  const objects = readVaultObjects(vault);
  const byUid = new Map();
  const problems = [];
  for (const { path: p, object } of objects) {
    for (const message of validateObject(object)) problems.push({ path: p, message });
    if (object.uid) {
      if (byUid.has(object.uid)) problems.push({ path: p, message: "uid 与 " + byUid.get(object.uid) + " 重复" });
      else byUid.set(object.uid, p);
    }
  }
  // Every formal relation must resolve, or the graph is decorative.
  for (const { path: p, object } of objects) {
    const refs = [
      ...["project_uid", "source_uid", "target_uid", "next_test", "method_uid", "protocol_uid"]
        .filter((k) => object[k]).map((k) => [k, object[k]]),
      ...["active_hypothesis_uids", "related_hypotheses", "supporting_evidence",
        "contradicting_evidence", "tests_hypotheses", "produced_evidence", "projects", "relates_to",
        "evidence_refs"]
        .flatMap((k) => (object[k] || []).map((v) => [k, v])),
    ];
    for (const [key, uid] of refs)
      if (!byUid.has(uid)) problems.push({ path: p, message: key + " 指向不存在的 uid：" + uid });
  }
  const counts = {};
  for (const { object } of objects) counts[object.type] = (counts[object.type] || 0) + 1;
  return { valid: problems.length === 0, problems, counts, scanned: objects.length };
}

function main() {
  const i = process.argv.indexOf("--vault");
  const vault = path.resolve(i > 0 ? process.argv[i + 1] : path.join(__dirname, "..", "..", "..", ".."));
  const report = validateVault(vault);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.valid ? 0 : 1;
}
if (require.main === module) main();

module.exports = {
  parseObject, serializeObject, validateObject, readVaultObjects, validateVault,
  splitFrontmatter, createObject, applyHypothesisChange, linkEvidence, unlinkEvidence,
  uuidV7, nextDisplayId, PREFIX, ENUMS,
  SUPPORTING_RELATIONS, CONTRADICTING_RELATIONS,
};
