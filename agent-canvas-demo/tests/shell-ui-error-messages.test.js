"use strict";
// 2026-08-28 发布冲刺项4 P1（交付清单第2/3类，项3实测发现）：several
// recovery-relevant Bridge/action errors used to reach the chat panel as raw
// English strings with no "what do I do now" guidance — `Local Bridge is not
// running.`, `invalid or missing Agent Bridge token`, and the draft-batch /
// experiment-transition "not found or expired" / "expired; ..." family. Each
// has a different recovery path (restart npm start; fix bridge.config.json's
// token, no restart needed; just re-ask and reconfirm), so a single generic
// translation would be wrong. `humanizeActionError()` in shell-ui.js maps
// each known pattern to its own actionable Chinese text and leaves anything
// unrecognised untouched (never hide a genuinely novel failure).
//
// shell-ui.js spawns a real Bridge and isn't require()-able as a module (see
// the header comment in tests/scholarium-bridge-endpoints.test.js for the
// same constraint on server.js), so this is static source analysis, matching
// the project's established pattern for this file (see
// tests/project-context-wiring.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'shell-ui.js'), 'utf8');

test('humanizeActionError exists and covers all four known recovery-relevant patterns with distinct advice', () => {
  const start = source.indexOf('function humanizeActionError(message)');
  assert.ok(start >= 0, 'humanizeActionError must be defined');
  const end = source.indexOf('\n  }', start) + 4;
  const body = source.slice(start, end || start + 1600);
  assert.match(body, /Local Bridge is not running/);
  assert.match(body, /重新执行 npm start/);
  assert.match(body, /invalid or missing Agent Bridge token/);
  assert.match(body, /bridge\.config\.json/);
  assert.match(body, /不需要重启任何进程/);
  assert.match(body, /not found or expired/);
  assert.match(body, /重新向我提出同样的请求/);
  // Anything unrecognised must fall through unchanged, not get swallowed.
  assert.match(body, /return raw;/);
});

test('every real failure surface (chat send, draft commit, experiment.transition, queued actions) routes its error text through humanizeActionError', () => {
  const callSites = source.match(/humanizeActionError\(/g) || [];
  // One definition-site occurrence (`function humanizeActionError(message)`)
  // plus at least four call sites.
  assert.ok(callSites.length >= 5, `expected the definition plus >=4 call sites, found ${callSites.length} occurrences`);
});
