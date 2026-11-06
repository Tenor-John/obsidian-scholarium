// @ts-nocheck
/* Per-Vault material Bridge transport and the read-only plotting Agent. */
import {
  schRuntimeScope,
  schVaultBridgePorts,
  schStartAndWaitLocalRuntime,
} from "./runtime-manager";

let schMaterialBridgeEndpointsCache = new Map();
export async function schMaterialBridgeEndpoints(plugin) {
  const cacheKey = schRuntimeScope(plugin.app);
  if (schMaterialBridgeEndpointsCache.has(cacheKey)) return schMaterialBridgeEndpointsCache.get(cacheKey);
  const ports = schVaultBridgePorts(plugin.app);
  const endpoints = ports?.canvasPort
    ? [{ base: `http://127.0.0.1:${ports.canvasPort}/bridge`, headers: {} }]
    : [];
  schMaterialBridgeEndpointsCache.set(cacheKey, endpoints);
  return endpoints;
}
export async function schMaterialBridgeJson(plugin, path, options = {}) {
  const retriedAfterStart = options.__schRuntimeRetried === true;
  const requestOptions = { ...options };
  delete requestOptions.__schRuntimeRetried;
  const endpoints = await schMaterialBridgeEndpoints(plugin);
  let lastError = null;
  let reachedBridge = false;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint.base}${path}`, {
        ...requestOptions,
        headers: { "content-type": "application/json", ...endpoint.headers, ...(requestOptions.headers || {}) },
      });
      reachedBridge = true;
      const result = await response.json();
      if (!response.ok) throw new Error(String(result.error || `Bridge 请求失败 (${response.status})`));
      return result;
    } catch (error) { lastError = error; }
  }
  if (!reachedBridge && !retriedAfterStart) {
    const ports = schVaultBridgePorts(plugin.app);
    if (ports) {
      const health = async () => {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 1800);
        try {
          if (!ports.canvasPort) throw new Error("runtime 尚未回报 canvas 端口");
          const response = await fetch(`http://127.0.0.1:${ports.canvasPort}/bridge/health`, {
            cache: "no-store",
            signal: ctrl.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        } finally {
          window.clearTimeout(timer);
        }
      };
      await schStartAndWaitLocalRuntime(plugin, ports, health);
      schMaterialBridgeEndpointsCache.delete(ports.scope);
      return schMaterialBridgeJson(plugin, path, { ...requestOptions, __schRuntimeRetried: true });
    }
  }
  throw lastError || new Error("Bridge 不可达");
}

export async function schMaterialRunPlotAgent(plugin, prompt) {
  const catalog = await schMaterialBridgeJson(plugin, "/v1/agents");
  const agents = catalog.agents || [];
  const agent = agents.find((entry) => entry && entry.id === "claude" && entry.installed) || agents.find((entry) => entry && entry.installed);
  if (!agent) throw new Error("未检测到本机可用的只读 Agent");
  let cwd = "";
  try {
    const ws = await schMaterialBridgeJson(plugin, "/v1/workspace");
    if (ws && ws.root && ws.isDirectory) cwd = String(ws.root);
  } catch (_) { /* Bridge uses its own configured root. */ }
  const taskBody = { agentId: agent.id, prompt, permission: "read", execute: true };
  if (cwd) taskBody.cwd = cwd;
  const created = await schMaterialBridgeJson(plugin, "/v1/tasks", {
    method: "POST",
    body: JSON.stringify(taskBody),
  });
  for (let attempt = 0; attempt < 240; attempt++) {
    const task = await schMaterialBridgeJson(plugin, `/v1/tasks/${created.id}`);
    const status = String(task.status || "");
    if (["completed", "failed", "cancelled"].includes(status)) {
      const events = Array.isArray(task.events) ? task.events : [];
      if (status !== "completed") {
        const failure = events.filter((event) => event.type === "error").at(-1);
        throw new Error((failure && failure.text) || `Agent 任务结束：${status}`);
      }
      const done = events.filter((event) => event.type === "result").at(-1);
      return String((done && done.text) || "");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 900));
  }
  throw new Error("等待绘图 Agent 超时");
}
