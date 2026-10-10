"use strict";

/**
 * Convert the four historical Experiment creation entry points into the
 * schema-v1 writer contract. This module never writes: UI code must present
 * the existing confirmation, call experiment-store.prepareNew(), then create
 * that exact content through Obsidian's Vault API.
 *
 * An AI/image import may transcribe results, but it cannot declare whether
 * those values are measured, simulated, or imported. Existing observations
 * therefore enter as data_origin=unknown and remain barred from Evidence until
 * the researcher completes the provenance editor.
 */

const text = (value) => String(value == null ? "" : value).trim();
const list = (value) => Array.isArray(value)
  ? value.map(text).filter(Boolean)
  : (text(value) ? [text(value)] : []);

function resolveProject(projects, requested) {
  const all = Array.isArray(projects) ? projects : [];
  const wanted = text(requested).toUpperCase();
  if (wanted) {
    const hit = all.find((entry) => {
      const object = entry && entry.object || entry || {};
      return text(object.uid).toUpperCase() === wanted
        || text(object.display_id).toUpperCase() === wanted
        || text(object.project_id).toUpperCase() === wanted;
    });
    if (!hit) throw new Error(`未找到所选 schema-v1 Project：${requested}`);
    return hit.object || hit;
  }
  if (all.length === 1) return all[0].object || all[0];
  throw new Error("创建 Experiment 前必须明确选择一个 schema-v1 Project；不会把记录静默写入未分类目录");
}

function planMarkdown(input) {
  const sections = [];
  const add = (heading, value) => {
    const body = text(value);
    if (body) sections.push(`### ${heading}\n\n${body}`);
  };
  add("实验目的", input.objective);
  const steps = Array.isArray(input.steps)
    ? input.steps.map(text).filter(Boolean).map((step, index) => `${index + 1}. ${step}`).join("\n")
    : text(input.steps);
  add("实验步骤", steps);
  add("催化剂", input.catalyst);
  const reagents = list(input.reagents);
  add("试剂", reagents.length ? reagents.map((item) => `- ${item}`).join("\n") : "");
  add("SMILES", input.smiles);
  add("反应 SMILES", input.reaction_smiles);
  add("问题与异常", input.issues);
  add("注意事项", input.notes);
  add("参考文献", input.references);
  return sections.join("\n\n");
}

function resultMarkdown(input) {
  const sections = [];
  const result = text(input.results);
  const observations = text(input.observations);
  if (result) sections.push(`### 结果\n\n${result}`);
  if (observations) sections.push(`### 观察与现象\n\n${observations}`);
  return sections.join("\n\n");
}

function adaptLegacyExperiment(input = {}, { project, titleSuggestion } = {}) {
  if (!project || !text(project.uid)) throw new Error("canonical Experiment requires a Project uid");
  const refs = [...new Set([...list(input.source_images), ...list(input.source_image)])];
  const result = resultMarkdown(input);
  const hasRecordedContent = Boolean(result || refs.length);
  return {
    title: text(input.title) || text(titleSuggestion) || "待命名实验",
    project_uid: text(project.uid),
    tests_hypotheses: [],
    status: hasRecordedContent ? "analyzing" : "designed",
    result,
    conclusion: "",
    data_origin: hasRecordedContent ? "unknown" : "planned",
    raw_data_refs: refs,
    data_provenance_note: hasRecordedContent
      ? "由旧版 AI/图像入口转录；数据来源类型尚未由研究者确认，确认前不得作为正式 Evidence。"
      : "",
    data_recorded_by: "user",
    plan: planMarkdown(input),
  };
}

module.exports = { resolveProject, planMarkdown, resultMarkdown, adaptLegacyExperiment };
