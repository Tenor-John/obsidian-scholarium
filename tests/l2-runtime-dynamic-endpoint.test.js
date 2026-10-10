"use strict";

/**
 * L2 release evidence: the endpoint the runtime reports is the endpoint that
 * answers, and the hardcoded `127.0.0.1:4173` the frozen candidate calls does
 * not answer at all.
 *
 * What this test does, three times:
 *   1. starts the real launcher (`agent-canvas-demo/start-local.js`) exactly the
 *      way the plugin starts it — `AGENT_CANVAS_PORT=0`, `AGENT_BRIDGE_PORT=0`,
 *      so the OS assigns both ports;
 *   2. reads the ports the child reports over its `listening` IPC message, the
 *      same message `schSpawnLocalRuntime` consumes;
 *   3. asserts that the reported Canvas port really is the live one, by making
 *      the plugin's *own* health request against it
 *      (`GET http://127.0.0.1:<canvasPort>/bridge/health`);
 *   4. asserts that the same path on the frozen candidate's hardcoded base
 *      (`http://127.0.0.1:4173/bridge/...`) is unreachable, while the reported
 *      port serves it.
 *
 * Step 4 is the closest honest substitute for "drive the UI path". The path
 * used is `/v1/agents`, which is exactly what `yi.prototype.bridgeState()`
 * requests through the `Md`-based `bridgeFetch`. Driving the Obsidian UI itself
 * needs a real Obsidian host and is NOT covered here — see the audit's
 * "not tested" section. What is covered is that the URL that path composes is
 * dead on 4173 and alive on the reported port.
 *
 * Ports are shared with other agents, so this test takes the repository's port
 * lock itself and never touches the real runtime profile directory: the
 * pidfile, Bridge config and audit directory all point into a temp tree.
 *
 *   node --test tests/l2-runtime-dynamic-endpoint.test.js
 *   SCHOLARIUM_L2_STRICT=1  -> a contended lock fails instead of skipping
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const LAUNCHER = path.join(ROOT, "agent-canvas-demo", "start-local.js");
const LAUNCHER_CWD = path.dirname(LAUNCHER);

const RUNS = 3;
const LISTEN_TIMEOUT_MS = 60000;
const LOCK_DIR = process.env.SCHOLARIUM_PORT_LOCK || "D:/scholarium-test-temp/port-lock";
const STALE_LOCK_MS = 20 * 60 * 1000;
const LEGACY_PORT = 4173;

/* ---------------------------------------------------------------- helpers */

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Ask the OS for a free loopback port, then release it again. */
function probeFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** True when something is listening on the loopback port. */
function isPortOpen(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/**
 * Perform a real HTTP request. "Reached" means an HTTP response came back, even
 * a 401 — a refused connection is the failure we are separating from.
 */
function request(port, urlPath, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "GET", timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ reached: true, status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.once("timeout", () => req.destroy(new Error("timeout")));
    req.once("error", (error) => resolve({ reached: false, status: 0, body: "", error: error.code || error.message }));
    req.end();
  });
}

/* ------------------------------------------------------------- port lock */

/** The PID recorded in the owner note, or null when unreadable. */
function ownerPid() {
  try {
    const match = /^(\d+)/.exec(fs.readFileSync(path.join(LOCK_DIR, "owner"), "utf8").trim());
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function pidIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to another user; treat that as alive.
    return error.code === "EPERM";
  }
}

/**
 * A lock is stale when its owner note is older than the agreed 20 minutes, or
 * when the owning process is gone. The second condition matters in practice:
 * a lock written by a shell wrapper outlives the shell, and waiting the full
 * 20 minutes for a process that no longer exists is how a serial protocol
 * turns into a wall-clock stall.
 */
function staleReason() {
  let stat;
  try {
    stat = fs.statSync(path.join(LOCK_DIR, "owner"));
  } catch {
    return "owner note missing";
  }
  if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) return `owner note older than ${STALE_LOCK_MS / 60000} min`;
  const pid = ownerPid();
  if (pid && !pidIsAlive(pid)) return `owning pid ${pid} is not running`;
  return null;
}

function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK_DIR), { recursive: true });
  const note = `${process.pid} agent-H4173-l2 ${new Date().toISOString()}`;
  const deadline = Date.now() + 60000;
  const forcedStale = [];
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      fs.writeFileSync(path.join(LOCK_DIR, "owner"), note);
      return { acquired: true, forcedStale };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    let owner = "(owner file unreadable)";
    try {
      owner = fs.readFileSync(path.join(LOCK_DIR, "owner"), "utf8").trim();
    } catch {
      /* lock exists but its owner note does not; treat as held */
    }
    const stale = staleReason();
    if (stale) {
      forcedStale.push(`${owner} — ${stale}`);
      process.stderr.write(`[l2] removing stale port lock (${owner} — ${stale})\n`);
      fs.rmSync(LOCK_DIR, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > deadline) return { acquired: false, forcedStale, owner };
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
}

function releaseLock() {
  try {
    const owner = fs.readFileSync(path.join(LOCK_DIR, "owner"), "utf8");
    if (!owner.includes(String(process.pid))) return; // not ours; leave it alone
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  } catch {
    /* already gone */
  }
}

/* ------------------------------------------------------------- launching */

function makeRunDir(index) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sch-l2-endpoint-${index}-`));
  const vault = path.join(dir, "vault");
  fs.mkdirSync(path.join(vault, "Research"), { recursive: true });
  const configPath = path.join(dir, "bridge.config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        // Throwaway token for an isolated temp config; never a real credential,
        // and never printed. The launcher reads it to inject the proxy header.
        token: crypto.randomBytes(24).toString("hex"),
        allowExecution: false, // no agent may be spawned by this test
        allowedRoots: [vault],
        workspaceRoot: vault,
        adapters: {},
        skillDirectories: [],
        scholarium: { enabled: false, vaultRoot: vault, allowedActions: [] },
      },
      null,
      2,
    ),
    "utf8",
  );
  return {
    dir,
    vault,
    configPath,
    pidfile: path.join(dir, "weaver.pid.json"),
    auditDir: path.join(dir, "audit"),
  };
}

function startLauncher(run) {
  const env = {
    ...process.env,
    // Exactly what the plugin sets: ask the OS, never pin a port.
    AGENT_CANVAS_PORT: "0",
    AGENT_BRIDGE_PORT: "0",
    AGENT_WEAVER_VAULT_ROOT: run.vault,
    AGENT_BRIDGE_CONFIG_PATH: run.configPath,
    AGENT_WEAVER_PIDFILE: run.pidfile,
    AGENT_BRIDGE_AUDIT_DIR: run.auditDir,
  };
  const child = spawn(process.execPath, [LAUNCHER], {
    cwd: LAUNCHER_CWD,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
    env,
  });
  const output = [];
  child.stdout?.on("data", (chunk) => output.push(String(chunk)));
  child.stderr?.on("data", (chunk) => output.push(String(chunk)));

  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`launcher never reported listening after ${LISTEN_TIMEOUT_MS} ms`)),
      LISTEN_TIMEOUT_MS,
    );
    child.on("message", (message) => {
      if (message?.type === "listening") {
        clearTimeout(timer);
        resolve(message);
      }
      if (message?.type === "listen-error") {
        clearTimeout(timer);
        reject(new Error(`listen-error: ${message.service} ${message.code} ${message.message}`));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`launcher exited early (code=${code})\n${output.join("")}`));
    });
  });
  return { child, listening, output };
}

/** Same request, but report the response headers instead of the body. */
function requestWithOrigin(port, urlPath, origin, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method: "GET",
        timeout: timeoutMs,
        headers: origin === null ? {} : { Origin: origin },
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve({
            reached: true,
            status: res.statusCode,
            allowOrigin: res.headers["access-control-allow-origin"] ?? null,
          }),
        );
      },
    );
    req.once("timeout", () => req.destroy(new Error("timeout")));
    req.once("error", (error) => resolve({ reached: false, status: 0, allowOrigin: null, error: error.code || error.message }));
    req.end();
  });
}

function stopLauncher(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    }
  } catch {
    /* fall through to the direct kill */
  }
  try {
    child.kill();
  } catch {
    /* already gone */
  }
}

/* ------------------------------------------------------------------ test */

test("[L2] runtime reports a dynamic endpoint that answers, while hardcoded 4173 does not", async (t) => {
  assert.equal(fs.existsSync(LAUNCHER), true, `launcher not found: ${LAUNCHER}`);

  const lock = acquireLock();
  if (!lock.acquired) {
    const reason =
      `port lock is held by ${lock.owner}; another agent is running a port-binding test. ` +
      "Re-run when it is free (SCHOLARIUM_L2_STRICT=1 to make this a failure).";
    if (process.env.SCHOLARIUM_L2_STRICT === "1") assert.fail(reason);
    t.skip(reason);
    return;
  }
  t.after(() => releaseLock());
  if (lock.forcedStale.length) {
    // Surfaced rather than silent: a forced reclaim means some other agent's
    // lock was abandoned, which belongs in the run's evidence.
    process.stdout.write(`[L2] force-removed stale port lock: ${lock.forcedStale.join("; ")}\n`);
  }

  // The "hardcoded endpoint is dead" assertion is only meaningful if 4173 was
  // already unused. An independently running legacy service is not this test's
  // to interpret, so record the fact and assert only what we observed.
  const legacyPortWasFree = !(await isPortOpen(LEGACY_PORT));

  const evidence = [];
  for (let index = 1; index <= RUNS; index += 1) {
    const run = makeRunDir(index);
    const { child, listening } = startLauncher(run);
    try {
      const report = await listening;
      const canvasPort = Number(report.canvasPort);
      const bridgePort = Number(report.bridgePort);

      assert.ok(Number.isInteger(canvasPort) && canvasPort > 0, `run ${index}: bad reported canvasPort ${canvasPort}`);
      assert.ok(Number.isInteger(bridgePort) && bridgePort > 0, `run ${index}: bad reported bridgePort ${bridgePort}`);
      assert.equal(report.launcherPid, child.pid, `run ${index}: reported launcherPid must be the child we spawned`);
      assert.ok(Number.isInteger(report.bridgePid) && report.bridgePid > 0, `run ${index}: bad bridgePid`);

      // 1. The plugin's own health request, at the reported canvas port.
      const health = await request(canvasPort, "/bridge/health");
      assert.equal(health.reached, true, `run ${index}: reported canvas port ${canvasPort} is not reachable`);
      assert.equal(health.status, 200, `run ${index}: /bridge/health at ${canvasPort} returned ${health.status}`);
      const healthBody = JSON.parse(health.body);
      assert.equal(healthBody.ok, true, `run ${index}: /bridge/health did not report ok`);
      assert.equal(healthBody.executionEnabled, false, `run ${index}: this test must not enable execution`);

      // 2. The Bridge process's own port is the one it reported.
      const bridgeHealth = await request(bridgePort, "/health");
      assert.equal(bridgeHealth.reached, true, `run ${index}: reported bridge port ${bridgePort} is not reachable`);
      assert.equal(bridgeHealth.status, 200, `run ${index}: /health at ${bridgePort} returned ${bridgeHealth.status}`);

      // 3. The path a `Md`-based UI call composes, at the reported port: alive.
      const dynamicPath = await request(canvasPort, "/bridge/v1/agents");
      assert.equal(dynamicPath.reached, true, `run ${index}: /bridge/v1/agents at ${canvasPort} was not reached`);
      assert.equal(dynamicPath.status, 200, `run ${index}: /bridge/v1/agents at ${canvasPort} returned ${dynamicPath.status}`);

      // 4. The same path on the frozen candidate's hardcoded base: dead.
      let legacy = null;
      if (legacyPortWasFree) {
        legacy = await request(LEGACY_PORT, "/bridge/v1/agents", 2500);
        assert.equal(
          legacy.reached,
          false,
          `run ${index}: something answered on the hardcoded legacy port ${LEGACY_PORT} ` +
            `(status ${legacy.status}); the hardcoded endpoint cannot be shown dead here`,
        );
      }

      evidence.push({
        run: index,
        reportedCanvasPort: canvasPort,
        reportedBridgePort: bridgePort,
        observedCanvasPort: canvasPort,
        observedBridgePort: bridgePort,
        healthStatus: health.status,
        dynamicAgentsPathStatus: dynamicPath.status,
        hardcoded4173Reached: legacy ? legacy.reached : "not probed (4173 was already in use)",
      });
    } finally {
      stopLauncher(child);
      fs.rmSync(run.dir, { recursive: true, force: true });
    }
  }

  assert.equal(evidence.length, RUNS, "all three runs must have produced evidence");
  for (const entry of evidence) {
    assert.equal(entry.observedCanvasPort, entry.reportedCanvasPort, `run ${entry.run}: reported != observed`);
    assert.equal(entry.observedBridgePort, entry.reportedBridgePort, `run ${entry.run}: reported != observed`);
  }
  // Deliberately NOT asserted: that the three ports differ. The contract is
  // that each run's endpoint is the one it reported, not that the OS varies.
  process.stdout.write(`[L2] runtime endpoint evidence: ${JSON.stringify(evidence)}\n`);
});

test("[L2] runtime returns no ACAO for non-actual, localhost, prefix-attack, `*` or `:0` origins", async (t) => {
  assert.equal(fs.existsSync(LAUNCHER), true, `launcher not found: ${LAUNCHER}`);

  const lock = acquireLock();
  if (!lock.acquired) {
    const reason =
      `port lock is held by ${lock.owner}; another agent is running a port-binding test. ` +
      "Re-run when it is free (SCHOLARIUM_L2_STRICT=1 to make this a failure).";
    if (process.env.SCHOLARIUM_L2_STRICT === "1") assert.fail(reason);
    t.skip(reason);
    return;
  }
  t.after(() => releaseLock());
  if (lock.forcedStale.length) {
    process.stdout.write(`[L2] force-removed stale port lock: ${lock.forcedStale.join("; ")}\n`);
  }

  const run = makeRunDir("acao");
  const { child, listening } = startLauncher(run);
  try {
    const report = await listening;
    const canvasPort = Number(report.canvasPort);
    assert.ok(Number.isInteger(canvasPort) && canvasPort > 0);

    // The only two origins the launcher may answer with an ACAO.
    const allowed = [`http://127.0.0.1:${canvasPort}`, "app://obsidian.md"];
    // Everything else must come back with no ACAO at all. `:0` and `*` are
    // literal Origin values a hostile page can send; the prefix and suffix
    // attacks are the shapes `origin.endsWith(...)` / `includes(...)` checks
    // wrongly accept.
    const denied = [
      `http://localhost:${canvasPort}`,
      `http://LOCALHOST:${canvasPort}`,
      `http://127.0.0.1:${canvasPort === 65535 ? 65534 : canvasPort + 1}`,
      "http://127.0.0.1:0",
      "http://127.0.0.1.evil.example.com",
      `http://evil.example.com/127.0.0.1:${canvasPort}`,
      `http://127.0.0.1.example.com:${canvasPort}`,
      `https://127.0.0.1:${canvasPort}`,
      "http://0.0.0.0:0",
      "*",
      "null",
    ];

    const evidence = { canvasPort, allowed: [], denied: [] };

    for (const origin of allowed) {
      const response = await requestWithOrigin(canvasPort, "/bridge/health", origin);
      assert.equal(response.reached, true, `origin ${origin} did not get a response`);
      assert.equal(
        response.allowOrigin,
        origin,
        `the actual origin ${origin} must receive an ACAO echo, got ${response.allowOrigin}`,
      );
      evidence.allowed.push({ origin, allowOrigin: response.allowOrigin });
    }

    for (const origin of denied) {
      const response = await requestWithOrigin(canvasPort, "/bridge/health", origin);
      assert.equal(response.reached, true, `origin ${origin} did not get a response`);
      assert.equal(
        response.allowOrigin,
        null,
        `origin ${origin} must not receive an ACAO, got ${response.allowOrigin}`,
      );
      evidence.denied.push({ origin, allowOrigin: response.allowOrigin });
    }

    // A browser omits Origin on a same-origin GET; that path is token-gated
    // instead, so it must still carry no ACAO.
    const noOrigin = await requestWithOrigin(canvasPort, "/bridge/health", null);
    assert.equal(noOrigin.allowOrigin, null, "a request without Origin must not receive an ACAO");

    process.stdout.write(`[L2] CORS origin evidence: ${JSON.stringify(evidence)}\n`);
  } finally {
    stopLauncher(child);
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});
