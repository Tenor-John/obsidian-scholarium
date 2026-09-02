"use strict";
// Test double for -full adapters in the full-permission lane tests. Stands in
// for claude.exe / codex CLI so probe + dispatch behavior can be exercised
// end-to-end without touching real CLIs, real network, or real model behavior.
//
// Behavior contract:
//   - Prompt is the last argv element (adapters pass it via '{{prompt}}').
//   - '[CAPABILITY PROBE]' in the prompt -> probe behavior: read PROBE_READ and
//     echo its content, write PROBE_WRITE with 'probe-ok', and attempt the
//     PROBE_ESCAPE sentinel write (skipped when --prevent-escape is passed,
//     simulating a working workspace-write sandbox).
//   - Otherwise the agent plays a bridgeDownload-category agent: it writes NO
//     pdf itself (it has no Write tool in this category) and instead reports
//     'PDF_URL=<PDF_URL_OVERRIDE marker from the prompt>' plus a PDF_NAME line.
//     FAKE_MODE variants:
//       task-violation — additionally writes a file outside the pathScope
//                        (simulating a misbehaving agent the §5 diff must catch)
//       task-nourl     — completes without any PDF_URL line (must fail the run)
//       task-fail      — exits non-zero
//   - Output is a single claude-style JSON envelope line so the Bridge's
//     permission_denials / result parsing runs for real.
//   - Flags: --prevent-escape, --deny-write, --deny-read.
//   - FAKE_PROMPT_CAPTURE env: if set, the full prompt is written to that path
//     so tests can assert the §6.5 untrusted-content prefix is present.
//   - FAKE_ARGV_CAPTURE env: if set, process.argv is written there as JSON so
//     tests can assert the per-category tool override reached the process args.
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const preventEscape = args.includes('--prevent-escape');
const denyWrite = args.includes('--deny-write');
const denyRead = args.includes('--deny-read');
const prompt = args[args.length - 1] || '';

const marker = (key) => {
  const match = prompt.match(new RegExp(`${key}=(\\S+)`));
  return match ? match[1] : null;
};

const denials = [];
let resultText = '';
let exitCode = 0;

try {
  if (prompt.includes('[CAPABILITY PROBE]')) {
    const seed = marker('PROBE_READ');
    const writeOk = marker('PROBE_WRITE');
    const escape = marker('PROBE_ESCAPE');
    if (denyRead) denials.push({ tool_name: 'Read', tool_input: { file_path: seed } });
    else if (seed) resultText += ` ${fs.readFileSync(seed, 'utf8').trim()}`;
    if (denyWrite) denials.push({ tool_name: 'Write', tool_input: { file_path: writeOk } });
    else if (writeOk) fs.writeFileSync(writeOk, 'probe-ok', 'utf8');
    if (escape) {
      if (preventEscape) resultText += ' ESCAPE_BLOCKED simulated workspace-write sandbox denial';
      else { fs.writeFileSync(escape, 'escape-attempt', 'utf8'); resultText += ' ESCAPE_WRITTEN'; }
    }
    resultText += ' Example Domain';
  } else {
    const mode = marker('FAKE_MODE') || 'task-report';
    if (mode === 'task-fail') {
      process.stderr.write('simulated agent failure\n');
      exitCode = 1;
    } else if (mode === 'task-nourl') {
      resultText = 'I looked but could not find an open-access copy (simulated).';
    } else if (mode === 'task-landing') {
      // 合法的非下载结局：确认无 OA，报告着陆页 + 原因（LANDING_URL=/REASON=）
      resultText = '确认无开放获取版本。\nLANDING_URL=https://onlinelibrary.wiley.com/doi/10.1002/adfm.fixture\nREASON=Wiley 付费墙，无 OA 版本';
    } else if (mode === 'task-record-overwrite') {
      const record = path.join(process.cwd(), 'records', 'scholarium', 'EXP-001.md');
      fs.mkdirSync(path.dirname(record), { recursive: true });
      fs.writeFileSync(record, 'overwritten by fake agent\n', 'utf8');
      resultText = 'RECORD_PATH=records/scholarium/EXP-001.md\nRECORD_ID=EXP-001\nRECORD_UID=018f0000-0000-7000-8000-000000000001';
    } else {
      if (mode === 'task-violation') {
        fs.writeFileSync(path.join(process.cwd(), 'evil-outside-scope.txt'), 'written outside the declared pathScope', 'utf8');
      }
      const url = marker('PDF_URL_OVERRIDE') || 'https://example.com/fixture.pdf';
      resultText = `found an open-access copy.\nPDF_URL=${url}\nPDF_NAME=Vaswani_2017_attention_is_all_you_need.pdf`;
    }
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify({ type: 'result', is_error: true, result: String(error.message), permission_denials: denials })}\n`);
  process.exit(1);
}

if (process.env.FAKE_PROMPT_CAPTURE) {
  try { fs.writeFileSync(process.env.FAKE_PROMPT_CAPTURE, prompt, 'utf8'); } catch { /* capture is test scaffolding */ }
}
if (process.env.FAKE_ARGV_CAPTURE) {
  try { fs.writeFileSync(process.env.FAKE_ARGV_CAPTURE, JSON.stringify(process.argv), 'utf8'); } catch { /* capture is test scaffolding */ }
}
process.stdout.write(`${JSON.stringify({ type: 'result', is_error: exitCode !== 0, result: resultText.trim(), permission_denials: denials })}\n`);
process.exit(exitCode);
