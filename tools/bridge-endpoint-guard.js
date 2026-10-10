"use strict";

/**
 * Build guard: a release candidate must not carry a hardcoded loopback Bridge
 * endpoint, and must still derive its endpoint from the runtime's own reported
 * ports.
 *
 * Why a separate module: the rule is asserted by tests and can be pointed at a
 * candidate bundle before it is published (`SCHOLARIUM_CANDIDATE=<path>`), so
 * the check must be callable as a pure function over bundle text rather than
 * only as a test body.
 *
 * What went wrong, concretely.  The frozen deployment candidate
 * (main.js SHA-256 160e10f0…) spawns the Canvas/Bridge runtime with
 * `AGENT_CANVAS_PORT="0"` / `AGENT_BRIDGE_PORT="0"`, i.e. it asks the OS for
 * two ephemeral ports and learns them from the child's `listening` IPC message
 * (`schSpawnLocalRuntime` → `schRuntimePortsByScope`).  Twenty-four
 * `bridgeFetch` call sites, however, resolve their base from the module-level
 * constant `Md = "http://127.0.0.1:4173/bridge"`, which is assigned once and
 * never re-assigned.  Every one of those calls therefore targets port 4173 —
 * a port nothing is listening on — while the live Bridge sits on the port the
 * IPC reported.  The `schMaterialBridgeJson` path next to it does it
 * correctly, from `ports.canvasPort`, which is how we know the intended shape.
 *
 * Two rules are FATAL and two are ADVISORY.  The advisory rule exists because
 * the candidate legitimately contains one bare `http://127.0.0.1:4173` used as
 * a one-shot *migration source* (it copies this Vault's pre-isolation browser
 * state out of the old shared origin).  That origin is not a Bridge endpoint
 * and its absence is handled, so failing on it by default would train people
 * to silence the guard; `--strict` still reports it for a later change.
 */

const FATAL_HARDCODED_4173_BRIDGE = "hardcoded-4173-bridge";
const FATAL_LOOPBACK_PORT_SCAN = "loopback-port-scan";
const FATAL_LOCALHOST_BRIDGE = "localhost-bridge-base";
const FATAL_MISSING_DYNAMIC_WIRING = "missing-dynamic-endpoint-wiring";
const ADVISORY_BARE_4173_ORIGIN = "bare-4173-legacy-origin";

/** The one port range the retired candidate scanning walked. */
const SCAN_RANGE_START = 4173;
const SCAN_RANGE_END = 4178;

function occurrences(source, needle) {
  const lines = String(source).split(/\r?\n/);
  const hits = [];
  lines.forEach((line, index) => {
    let from = 0;
    for (;;) {
      const at = line.indexOf(needle, from);
      if (at < 0) break;
      hits.push({ line: index + 1, column: at + 1, text: line.trim().slice(0, 160) });
      from = at + needle.length;
    }
  });
  return hits;
}

/** Every literal `127.0.0.1:<port>` / `localhost:<port>` port in the bundle. */
function literalLoopbackPorts(source) {
  const ports = new Map();
  const re = /\b(?:127\.0\.0\.1|localhost):(\d{2,5})\b/gi;
  let match;
  while ((match = re.exec(String(source))) !== null) {
    const port = Number(match[1]);
    const line = String(source).slice(0, match.index).split("\n").length;
    if (!ports.has(port)) ports.set(port, []);
    ports.get(port).push(line);
  }
  return ports;
}

function auditBundle(source) {
  const text = String(source);
  const violations = [];
  const advisories = [];

  // FATAL — a hardcoded Bridge base on 4173. This is the defect itself.
  const hardcoded = occurrences(text, "127.0.0.1:4173/bridge");
  if (hardcoded.length) {
    violations.push({
      id: FATAL_HARDCODED_4173_BRIDGE,
      severity: "fatal",
      detail:
        "a Bridge base URL is hardcoded to port 4173. The runtime binds an " +
        "OS-assigned port and reports it over IPC, so calls to 4173 fail when " +
        "nothing is listening on it.",
      hits: hardcoded,
    });
  }

  // FATAL — a candidate list walking 4173..4178.
  const ports = literalLoopbackPorts(text);
  const scanned = [...ports.keys()]
    .filter((port) => port >= SCAN_RANGE_START && port <= SCAN_RANGE_END)
    .sort((a, b) => a - b);
  if (scanned.length > 1) {
    violations.push({
      id: FATAL_LOOPBACK_PORT_SCAN,
      severity: "fatal",
      detail:
        `the bundle names ${scanned.length} distinct loopback ports in ` +
        `${SCAN_RANGE_START}..${SCAN_RANGE_END} (${scanned.join(", ")}). ` +
        "More than one candidate means something still searches for a port " +
        "instead of using the one the runtime reported.",
      ports: scanned,
      hits: scanned.map((port) => ({ port, lines: ports.get(port) })),
    });
  }

  // FATAL — `localhost` is a different origin than `127.0.0.1` and must never
  // be used to reach the Bridge (the runtime binds 127.0.0.1).
  const localhostHits = [];
  const localhostRe = /localhost:\d{2,5}\/bridge/gi;
  let localhostMatch;
  while ((localhostMatch = localhostRe.exec(text)) !== null) {
    localhostHits.push({
      line: text.slice(0, localhostMatch.index).split("\n").length,
      column: localhostMatch.index + 1,
      text: localhostMatch[0],
    });
  }
  if (localhostHits.length) {
    violations.push({
      id: FATAL_LOCALHOST_BRIDGE,
      severity: "fatal",
      detail: "a Bridge base URL is built from `localhost`, which is not the origin the runtime binds.",
      hits: localhostHits,
    });
  }

  // FATAL (positive control) — the dynamic wiring must still be present. A
  // candidate that simply deleted every loopback literal would satisfy the
  // rules above while being strictly worse, so require the two halves of the
  // real mechanism: the child's `listening` report, and a base built from the
  // reported canvas port.
  const missing = [];
  if (!/message\?\.type\s*===\s*["']listening["']/.test(text)) {
    missing.push("no `listening` IPC handler (the child never reports its bound ports)");
  }
  if (!/`http:\/\/127\.0\.0\.1:\$\{[^}]*canvasPort[^}]*\}\/bridge`/.test(text)) {
    missing.push("no Bridge base derived from a reported `canvasPort`");
  }
  if (missing.length) {
    violations.push({
      id: FATAL_MISSING_DYNAMIC_WIRING,
      severity: "fatal",
      detail:
        "the dynamic endpoint mechanism is absent, so removing the hardcoded " +
        "URL would leave no way to reach the Bridge at all: " + missing.join("; "),
      missing,
    });
  }

  // ADVISORY — the bare legacy origin used only as a browser-state migration
  // source. Not a Bridge endpoint, and its absence is a no-op, so this does not
  // fail a release; it is reported so the residual hardcoded origin is visible
  // rather than forgotten.
  const bare = occurrences(text, "127.0.0.1:4173").filter(
    (hit) => !/127\.0\.0\.1:4173\/bridge/.test(hit.text),
  );
  if (bare.length) {
    advisories.push({
      id: ADVISORY_BARE_4173_ORIGIN,
      severity: "advisory",
      detail:
        "a bare `http://127.0.0.1:4173` literal remains. It is not a Bridge " +
        "endpoint (the legacy browser-state migration source reads it and " +
        "tolerates its absence), but it is a hardcoded cross-Vault origin and " +
        "should be gated or removed in a change of its own.",
      hits: bare,
    });
  }

  return {
    ok: violations.length === 0,
    violations,
    advisories,
    scannedPorts: scanned,
    fatalCount: violations.length,
  };
}

function formatReport(result) {
  const lines = [];
  if (result.ok) {
    lines.push("Bridge endpoint guard: PASS (no hardcoded 4173 Bridge base, no 4173..4178 scan)");
  } else {
    lines.push(`Bridge endpoint guard: FAIL (${result.fatalCount} violation(s))`);
    for (const violation of result.violations) {
      lines.push(`  [${violation.severity}] ${violation.id}: ${violation.detail}`);
      if (violation.hits) {
        for (const hit of violation.hits.slice(0, 5)) {
          if (hit.line !== undefined) lines.push(`      L${hit.line}: ${hit.text}`);
          else lines.push(`      port ${hit.port} at line(s) ${hit.lines.join(", ")}`);
        }
      }
      if (violation.missing) for (const item of violation.missing) lines.push(`      ${item}`);
    }
  }
  for (const advisory of result.advisories) {
    lines.push(`  [${advisory.severity}] ${advisory.id}: ${advisory.detail}`);
    for (const hit of advisory.hits.slice(0, 5)) lines.push(`      L${hit.line}: ${hit.text}`);
  }
  return lines.join("\n");
}

module.exports = {
  auditBundle,
  formatReport,
  literalLoopbackPorts,
  FATAL_HARDCODED_4173_BRIDGE,
  FATAL_LOOPBACK_PORT_SCAN,
  FATAL_LOCALHOST_BRIDGE,
  FATAL_MISSING_DYNAMIC_WIRING,
  ADVISORY_BARE_4173_ORIGIN,
  SCAN_RANGE_START,
  SCAN_RANGE_END,
};
