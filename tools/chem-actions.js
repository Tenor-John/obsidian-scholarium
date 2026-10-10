// experiment.insert_chem：把一条化学结构 / 反应式作为 ```scholarium-chem
// 代码块追加到 schema-v1 Experiment 记录的正文末尾。
//
// 为什么写正文代码块而不是只写 frontmatter：frontmatter 的 reaction_smiles
// 一条记录只能放一条，且只是给看板卡片画缩略图用的只读投影；正文里的
// scholarium-chem 块才是插件的一等公民——可以放多条、各自带标题，点"编辑"
// 能直接用 Ketcher 打开继续画。两者不是二选一：块照写，frontmatter 只在
// 该字段为空时顺手补上（见 frontmatterPatch），绝不覆盖研究员手工填过的值。
//
// 块内字段的顺序和引号方式必须与主插件的化学块 serialize/parse 一对函数
// 保持一致：字符串一律 JSON.stringify，molfile/ket 这类含换行的值靠 YAML
// 双引号里的 \n 转义无损往返。改这里之前先去看 main.js 的对应实现。
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");
const X = require("./experiment-store");
const S = require("./schema-objects");

const FENCE = "scholarium-chem";
const TYPES = ["molecule", "cycle", "scheme", "reaction"];
const FORMATS = ["ket", "rxn", "mol"];
const MAX_SMILES = 4000;
const VALIDATOR = path.join(__dirname, "chemistry-validator.py");

const text = (value) => (typeof value === "string" ? value : "");
const q = (value) => JSON.stringify(text(value));

function blockId(at) {
  const stamp = new Date(at || Date.now()).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `chem-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

// SMILES 里不允许出现空白：换行会直接破坏 YAML 标量，而空格在扩展 SMILES
// 里是"结构 + 名称"的分隔符——Agent 把一整句自然语言塞进来时最常见的表现
// 就是空格。宁可让它重报一次，也不要往笔记里写一条画不出来的结构。
function cleanSmiles(value, field) {
  const s = text(value).trim();
  if (!s) return "";
  if (/\s/.test(s)) throw new Error(field + "_must_not_contain_whitespace");
  if (s.length > MAX_SMILES) throw new Error(field + "_too_long");
  return s;
}

// molfile/ket 是多行文本，正常内容里不会出现围栏标记；真出现了就会把代码块
// 提前截断、让后面的正文变成乱码，所以宁可拒写。
function cleanBlockText(value, field) {
  const s = text(value).replace(/\r\n/g, "\n").trim();
  if (s.includes("```")) throw new Error(field + "_must_not_contain_code_fence");
  return s;
}

function validateChem(vault, input = {}) {
  const reactionSmiles = cleanSmiles(
    input.reaction_smiles !== undefined ? input.reaction_smiles : input.reactionSmiles,
    "reaction_smiles",
  );
  const smiles = cleanSmiles(input.smiles, "smiles");
  if (!smiles && !reactionSmiles) throw new Error("chem_structure_required");
  if (reactionSmiles && !reactionSmiles.includes(">"))
    throw new Error("reaction_smiles_must_contain_reaction_arrow");
  const kind = reactionSmiles ? "reaction" : "molecule";
  const commands = [process.env.SCHOLARIUM_PYTHON, "python", "python3", "py"].filter(Boolean);
  let lastError = "rdkit_unavailable";
  for (const command of commands) {
    const args = command === "py" ? ["-3", VALIDATOR] : [VALIDATOR];
    const run = spawnSync(command, args, {
      input: JSON.stringify({ kind, smiles, reaction_smiles: reactionSmiles }),
      encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
    });
    if (run.error) { lastError = run.error.code || run.error.message; continue; }
    if (run.status !== 0) { lastError = String(run.stderr || "validator_failed").trim().slice(0, 240); continue; }
    try { return JSON.parse(String(run.stdout || "{}")); }
    catch { lastError = "validator_invalid_output"; }
  }
  return { valid: false, status: "unavailable", errors: [lastError] };
}

function buildBlock(input, at) {
  const smiles = cleanSmiles(input.smiles, "smiles");
  const reactionSmiles = cleanSmiles(
    input.reaction_smiles !== undefined ? input.reaction_smiles : input.reactionSmiles,
    "reaction_smiles",
  );
  if (!smiles && !reactionSmiles) throw new Error("chem_structure_required");
  // 渲染端判定"这是不是一条反应式"只看 ">"。一条被误填进 reaction_smiles
  // 的普通分子会被当成反应画出来，是错的，schema 层就该挡住。
  if (reactionSmiles && !reactionSmiles.includes(">"))
    throw new Error("reaction_smiles_must_contain_reaction_arrow");

  if (input.strict_validation === true) {
    const check = validateChem(null, { smiles, reaction_smiles: reactionSmiles });
    if (check.status === "unavailable") throw new Error("chemistry_validator_unavailable");
    if (!check.valid) throw new Error("chemistry_validation_failed:" + (check.errors || []).join(","));
    if (reactionSmiles && check.balanced !== true) throw new Error("reaction_not_balanced");
  }

  const ket = cleanBlockText(input.ket, "ket");
  const rxn = cleanBlockText(input.rxn, "rxn");
  const molfile = cleanBlockText(input.molfile, "molfile");

  const wantType = text(input.type).trim();
  if (wantType && !TYPES.includes(wantType)) throw new Error("unknown_chem_type:" + wantType);
  const type = wantType || (reactionSmiles ? "reaction" : "molecule");

  const wantFormat = text(input.format).trim();
  if (wantFormat && !FORMATS.includes(wantFormat)) throw new Error("unknown_chem_format:" + wantFormat);
  // format 说的是 ket/rxn/molfile 三个字段里哪一个承载了结构。块的副标题会把
  // 它显示出来，所以不能乱标一个空字段——按实际拿到的东西推断。
  const format = wantFormat
    || (ket ? "ket" : rxn ? "rxn" : molfile ? "mol" : reactionSmiles ? "rxn" : "ket");

  return {
    id: text(input.block_id).trim() || blockId(at),
    type,
    title: text(input.title).trim() || (type === "reaction" ? "Untitled reaction" : "Untitled molecule"),
    locked: true,
    format,
    created: at,
    updated: at,
    ket, rxn, molfile, smiles, reactionSmiles,
    // 预览 SVG 只有 Ketcher 能生成。留空不影响显示：渲染端优先用 SMILES 走
    // smiles-drawer 画图，previewSvg 只是没有 SMILES 时的兜底。
    previewSvg: "",
  };
}

function serializeBlock(b) {
  return [
    `id: ${q(b.id)}`,
    `type: ${b.type}`,
    `title: ${q(b.title)}`,
    `locked: ${b.locked}`,
    `format: ${b.format}`,
    `created: ${q(b.created)}`,
    `updated: ${q(b.updated)}`,
    `ket: ${q(b.ket)}`,
    `rxn: ${q(b.rxn)}`,
    `molfile: ${q(b.molfile)}`,
    `smiles: ${q(b.smiles)}`,
    `reactionSmiles: ${q(b.reactionSmiles)}`,
    `previewSvg: ${q(b.previewSvg)}`,
  ].join("\n");
}

function renderFence(block) {
  return "```" + FENCE + "\n" + serializeBlock(block) + "\n```";
}

// 正文里已有的化学块，只取用于判重的两个字段。Agent 重试同一条指令时不该在
// 笔记里堆出两个一模一样的结构。
function existingStructures(body) {
  const found = [];
  const fence = new RegExp("```" + FENCE + "\\r?\\n([\\s\\S]*?)```", "g");
  let hit;
  while ((hit = fence.exec(String(body || ""))) !== null) {
    const one = {};
    for (const line of hit[1].split("\n")) {
      const kv = /^(smiles|reactionSmiles):\s*(.*)$/.exec(line.trim());
      if (!kv) continue;
      try { one[kv[1]] = JSON.parse(kv[2]); } catch (e) { one[kv[1]] = kv[2].replace(/^"|"$/g, ""); }
    }
    found.push(one);
  }
  return found;
}

// 只填空位。Agent 不该覆盖研究员手工写过的 SMILES，冲突时如实报 skipped，
// 让确认卡片和审计记录里都能看见"这个字段没动"。
function frontmatterPatch(object, block) {
  const patch = {};
  const skipped = [];
  const wanted = { smiles: block.smiles, reaction_smiles: block.reactionSmiles };
  for (const [key, value] of Object.entries(wanted)) {
    if (!value) continue;
    const current = text(object[key]).trim();
    if (!current) patch[key] = value;
    else if (current !== value) skipped.push(key);
  }
  return { patch, skipped };
}

// 块必须落在自己的二级小节里，不能直接接在正文末尾。experiment-store 的
// recoverStructuredFields 会把 "## 结论" 之后的全部内容当成 conclusion 回填进
// frontmatter——生成的实验正文正好以空的 "## 结论" 收尾，块接在后面会被整个
// 吞进 frontmatter 的 conclusion 字段里。起一个新的 "## 化学结构" 标题就把那个
// 小节封住了。已经有这个小节时不再重复加标题。
const HEADING = "## 化学结构";

function appendToBody(body, block) {
  const base = String(body || "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
  const headings = base.match(/(?:^|\n)##[ \t]+[^\n]*/g) || [];
  const last = headings.length ? headings[headings.length - 1].trim() : "";
  const parts = [];
  if (base) parts.push(base);
  if (last !== HEADING) parts.push(HEADING);
  parts.push(renderFence(block));
  return parts.join("\n\n") + "\n";
}

function insertChem(vault, input = {}, options = {}) {
  const uid = text(input.experiment_uid).trim();
  if (!uid) throw new Error("experiment_uid_required");
  const entry = X.loadAll(vault).find((item) => item.object.uid === uid);
  if (!entry) throw new Error("experiment_not_found:" + uid);
  if (entry.object.type !== "experiment") throw new Error("experiment_required");

  // 刻意不走 X.readRecord：它做两件我们不想要的事——正文为空时返回一份现生成
  // 的可读投影（一旦连同新块写回去就成了真实正文），以及把正文小节的内容
  // "恢复"进 result/conclusion 字段。这个动作只是往正文追加一个块，没有理由
  // 顺带改写任何结构化字段。要的是磁盘上原样的 frontmatter 和正文。
  const file = path.join(vault, ...entry.path.split("/"));
  const parsed = S.parseObject(fs.readFileSync(file, "utf8"));
  const body = parsed.body;
  const object = entry.object;

  const at = options.now || new Date().toISOString();
  const block = buildBlock(input, at);

  const duplicate = existingStructures(body).some((one) =>
    (block.reactionSmiles && one.reactionSmiles === block.reactionSmiles)
    || (block.smiles && !block.reactionSmiles && one.smiles === block.smiles && !one.reactionSmiles));
  if (duplicate && input.allow_duplicate !== true)
    return {
      noop: true, reason: "structure_already_present",
      path: entry.path, display_id: object.display_id,
      smiles: block.smiles, reaction_smiles: block.reactionSmiles,
    };

  const { patch, skipped } = frontmatterPatch(object, block);
  const outcome = {
    path: entry.path,
    display_id: object.display_id,
    block: {
      id: block.id, type: block.type, title: block.title, format: block.format,
      smiles: block.smiles, reaction_smiles: block.reactionSmiles,
      has_ket: !!block.ket, has_rxn: !!block.rxn, has_molfile: !!block.molfile,
    },
    frontmatter_updated: Object.keys(patch),
    frontmatter_skipped: skipped,
    chemistry_status: input.strict_validation === true ? "validated_balanced" : "unverified_structure",
    by: options.by || "agent",
  };
  if (options.dryRun) return { mode: "dry_run", ...outcome };

  X.saveExisting(vault, entry.path, { ...object, ...patch, updated_at: at },
    { body: appendToBody(body, block) });
  return outcome;
}

module.exports = { insertChem, validateChem, serializeBlock, renderFence, existingStructures };
