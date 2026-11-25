"use strict";

// Synthetic history: three pending plot cards and Chinese column names,
// independent of local Vault contents or private conversations.
module.exports = function history() {
  const header = { type: "session", sessionId: "test-history", scopeKey: "test-scope", projectId: "test-project", topicId: "test-topic", title: "绘图卡恢复测试" };
  const message = (i, role, text) => ({ type: "message", messageId: `test-message-${i}`, role, text, at: `2026-11-01T00:00:0${i}.000Z` });
  const plot = (i) => message(i, "agent", "已重新提交绘图请求\n\n```scholarium-plot-tool\n" + JSON.stringify({ name: "render_plot", arguments: { dataset_path: "Materials/AuCdSPt-0_50--信号文件.CSV", recipe: { plot_kind: "line", x_column: "时间(分钟)", y_columns: ["信号值(微伏)"], chart_style: {} } } }) + "\n```");
  return [header, message(1, "user", "请绘图"), message(2, "agent", "准备读取列名"), plot(3), message(4, "user", "调整图表"), plot(5), message(6, "user", "重新提交"), plot(7)];
};
