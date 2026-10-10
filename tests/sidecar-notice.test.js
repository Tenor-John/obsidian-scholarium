"use strict";
/**
 * C2：无 sidecar 的三件套环境下，XLSX 聊天卡入口必须响亮降级——
 * 明确提示、可行动、不静默失效、不抛出用户看不懂的原始错误。
 */
const { describe, it, assert } = require("./harness");
const { KINDS, classifyError, describeXlsxEntryUnavailable } = require("../tools/sidecar-notice.js");

const RAW_ERRORS = [
  new Error("fetch failed"),
  Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:4318"), { code: "ECONNREFUSED" }),
  new Error("request to http://127.0.0.1:4318/v1/skills failed, reason: socket hang up"),
];

describe("C2 缺失降级：三件套环境（运行时未安装）", () => {
  it("XLSX 入口给出 runtime-absent 通知，而非原始网络错误", () => {
    for (const err of RAW_ERRORS) {
      const n = describeXlsxEntryUnavailable("absent", err);
      assert.eq(n.kind, KINDS.RUNTIME_ABSENT);
      assert.eq(n.message.includes("运行时"), true, "说明是什么坏了");
      assert.eq(n.message.includes("一键下载"), true, "给出修复出路");
      assert.eq(n.message.includes("incoming/"), true, "给出离线出路");
      assert.eq(n.actions.length >= 2, true, "必须有可行动作");
      // 原始错误只允许出现在 detail，不得单独充当用户提示
      assert.eq(/^fetch failed$|^connect ECONNREFUSED/.test(n.message), false, "message 不得是原始错误");
      assert.eq(typeof n.detail, "string", "技术细节保留在 detail");
    }
  });

  it("即使没有捕获到错误对象，也返回完整可读通知（不静默）", () => {
    const n = describeXlsxEntryUnavailable("absent", null);
    assert.eq(n.kind, KINDS.RUNTIME_ABSENT);
    assert.eq(n.title.length > 0 && n.message.length > 0 && n.actions.length > 0, true);
  });
});

describe("C2 缺失降级：运行时在但 Bridge 连不上 / 技能闸门", () => {
  it("连接错误归类为 bridge-unreachable 并指引重启", () => {
    const n = describeXlsxEntryUnavailable("ready", RAW_ERRORS[1]);
    assert.eq(n.kind, KINDS.BRIDGE_UNREACHABLE);
    assert.eq(n.message.includes("重启"), true);
  });
  it("技能未启用与技能未注册各有专属可读提示", () => {
    const disabled = describeXlsxEntryUnavailable("ready", new Error("Skill「sch-data-normalize」未在设置 → 织研者 Agent → 素材库 Agent 可调用 Skills 中启用"));
    assert.eq(disabled.kind, KINDS.SKILL_DISABLED);
    assert.eq(disabled.message.includes("启用"), true);
    const missing = describeXlsxEntryUnavailable("ready", new Error("Bridge 未发现 sch-data-normalize Skill"));
    assert.eq(missing.kind, KINDS.SKILL_NOT_FOUND);
  });
  it("运行时损坏归类为 degraded 并指引修复/回滚", () => {
    const n = describeXlsxEntryUnavailable("degraded", null);
    assert.eq(n.kind, KINDS.RUNTIME_DEGRADED);
    assert.eq(n.message.includes("回滚"), true);
  });
  it("未归类错误也被包装成可读提示，技术细节不外溢", () => {
    const n = describeXlsxEntryUnavailable("ready", new Error("weird thing 0xDEAD"));
    assert.eq(n.kind, KINDS.UNKNOWN);
    assert.eq(n.message.includes("0xDEAD"), false, "原始细节不进 message");
    assert.eq(n.detail.includes("0xDEAD"), true);
  });
});

describe("C2 契约：任何输入都不抛错、不返回空通知", () => {
  it("undefined / 字符串 / 空对象全部安全", () => {
    for (const bad of [undefined, null, "", {}, "ECONNREFUSED"]) {
      const n = describeXlsxEntryUnavailable("ready", bad);
      assert.eq(typeof n.message, "string");
      assert.eq(n.message.length > 20, true, "提示必须完整");
      assert.eq(Array.isArray(n.actions) && n.actions.length > 0, true);
    }
  });
  it("classifyError 对连接类错误稳定归类", () => {
    for (const err of RAW_ERRORS) assert.eq(classifyError(err), KINDS.BRIDGE_UNREACHABLE);
  });
});
