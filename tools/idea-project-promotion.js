"use strict";

/**
 * Pure builders for M3 P0: promote one persisted Idea into a schema-v1
 * Project plus a versioned project-profile v0 artifact.
 *
 * Filesystem checks and the preview/commit transaction live in the Bridge.
 * Keeping construction here makes the scientific defaults and schema
 * contract independently testable and prevents the UI from inventing a
 * second representation of a project profile.
 */
const S = require("./schema-objects");

function cleanText(value, max = 1200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(value, maxItems = 12, maxChars = 240) {
  const source = Array.isArray(value) ? value : String(value || "").split(/\r?\n|；|;/);
  return [...new Set(source.map((item) => cleanText(item, maxChars)).filter(Boolean))].slice(0, maxItems);
}

function safeName(value) {
  return cleanText(value, 80).replace(/[\\/:*?"<>|#[\]]/g, "-").replace(/\s+/g, " ").replace(/[. ]+$/g, "") || "未命名课题";
}

function profileFromIdea(idea, input = {}) {
  const hotspots = cleanList(idea.hotspots, 12);
  const gaps = cleanList(idea.gaps, 12);
  const doItems = cleanList(input.boundaries_do ?? input.boundaries?.do ?? hotspots, 12);
  const dontItems = cleanList(input.boundaries_dont ?? input.boundaries?.dont, 12);
  const researchQuestion = cleanText(input.research_question || idea.title, 600);
  const successCriteria = cleanText(input.success_criteria || "待研究者在进入实验设计前补充可量化的成功标准。", 800);
  return {
    profile_version: 0,
    research_question: researchQuestion,
    boundaries: { do: doItems, dont: dontItems },
    core_concepts: cleanList(input.core_concepts ?? hotspots, 16),
    keywords_zh: cleanList(input.keywords_zh, 16),
    keywords_en: cleanList(input.keywords_en, 16),
    constraints: cleanList(input.constraints, 16),
    known: [],
    unknown: gaps.map((open_question) => ({ open_question, hypothesis_ids: [] })),
    controversial: [],
    success_criteria: successCriteria,
    revision_note: "由 Idea 卡片升级创建课题画像 v0；尚未经过 P1 文献建档与证据核验。",
  };
}

function renderProfileArtifact(project, profile, idea, now) {
  const artifact = {
    artifact: "project_profile",
    schema_version: 1,
    project_uid: project.uid,
    project_display_id: project.display_id,
    profile_version: 0,
    created_at: now,
    updated_at: now,
    source_idea_uid: idea.uid,
    source_idea_display_id: idea.display_id,
    ...profile,
  };
  const body = `\n# ${project.display_id} · 课题画像 v0\n\n` +
    `## 研究问题\n\n${profile.research_question}\n\n` +
    `## 主题概览\n\n${cleanText(idea.summary, 4000) || "尚无概览。"}\n\n` +
    `## 成功标准\n\n${profile.success_criteria}\n\n` +
    `> 本画像由 ${idea.display_id} 升级生成。v0 是进入 P1 前的起点，不代表文献或实验已经证实其中内容。\n`;
  return S.serializeObject(artifact, body);
}

function buildPromotion({ idea, existingDisplayIds = [], input = {}, now, projectUid }) {
  if (!idea || idea.type !== "idea") throw new Error("只能将 schema-v1 Idea 升级为课题");
  if (idea.status === "promoted") throw new Error("idea_already_promoted:" + (idea.promoted_to || ""));
  if (idea.status !== "exploring") throw new Error("idea_must_be_exploring");
  const at = now || new Date().toISOString();
  const profile = profileFromIdea(idea, input);
  if (!profile.research_question) throw new Error("research_question 不能为空");
  const displayId = S.nextDisplayId(existingDisplayIds, "project");
  const project = S.createObject("project", {
    title: cleanText(input.title || idea.title, 300),
    thesis: cleanText(input.thesis || idea.summary, 800),
    stage: "P0",
    status: "active",
    active_hypothesis_uids: [],
    legacy_hypothesis_summaries: [],
    current_problems: cleanList(idea.gaps, 12),
    methods_needed: [],
    excluded_topics: profile.boundaries.dont,
    primary_system: cleanText(input.primary_system, 240),
    secondary_system: cleanText(input.secondary_system, 240),
    wavelengths: cleanList(input.wavelengths, 12),
    next_gate: "P1 文献建档",
    tags: cleanList(idea.hotspots, 12),
    profile_version: 0,
    research_question: profile.research_question,
    boundaries: profile.boundaries,
    known: profile.known,
    unknown: profile.unknown,
    controversial: profile.controversial,
    success_criteria: profile.success_criteria,
    source_idea_uid: idea.uid,
  }, { now: at, uid: projectUid, display_id: displayId });
  const projectBody = `\n# ${displayId} · ${project.title}\n\n` +
    `## 当前阶段\n\nP0 立项完成，下一关：P1 文献建档。\n\n` +
    `## 来源\n\n由 [[${idea.display_id}]] 升级；课题画像见 \`Research/ProjectProfiles/${displayId}/profile-v0.md\`。\n`;
  const promotedIdea = { ...idea, status: "promoted", promoted_to: displayId, updated_at: at };
  const ideaErrors = S.validateObject(promotedIdea);
  if (ideaErrors.length) throw new Error("升级后的 Idea 不满足 schema-v1：" + ideaErrors.join("；"));
  return {
    project,
    profile,
    promotedIdea,
    projectPath: `Research/Projects/${displayId} ${safeName(project.title)}.md`,
    profilePath: `Research/ProjectProfiles/${displayId}/profile-v0.md`,
    projectContent: S.serializeObject(project, projectBody),
    profileContent: renderProfileArtifact(project, profile, idea, at),
  };
}

module.exports = { buildPromotion, profileFromIdea, cleanList, safeName };
