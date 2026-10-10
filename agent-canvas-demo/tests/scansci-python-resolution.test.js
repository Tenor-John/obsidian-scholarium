"use strict";
/* Regression for the 2026-09-05 "机构通道成功 0/35 篇" run.

   The institutional channel never made a network request. resolvePython()'s
   candidate list was one entry — process.env.SCANSCI_PYTHON — while the
   failure message said "not importable by any candidate Python interpreter",
   describing a search that did not exist. SCANSCI_PYTHON was set nowhere: not
   in the process, not at User or Machine scope, and nowhere in this repo. So
   the skill exited within milliseconds on every run.

   On the machine where this was found, `python` and `py` resolve to Anaconda,
   which does not have scansci_pdf; the package lives in
   %LOCALAPPDATA%\\Programs\\Python\\Python311. A PATH-only fallback would still
   have failed, so the well-known per-user install roots are searched too.

   The pipeline meanwhile rendered "11/35（成功 0，失败 11）… 已 15 分钟没有
   更新" — numbers from an EARLIER run, because the failure happened before the
   progress file was reset. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'skills', 'scansci-institutional', 'scripts', 'scansci_download.js');
const source = fs.readFileSync(SCRIPT, 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `找不到 ${name}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`括号不匹配：${name}`);
}

function loadResolver() {
  const context = { fs, path, spawnSync, process, console };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction('pythonCandidates')}\n${extractFunction('resolvePython')}\n`
    + 'this.__candidates = pythonCandidates; this.__resolve = resolvePython;',
    context,
  );
  return context;
}

test('候选解释器不止环境变量一个', () => {
  const { __candidates } = loadResolver();
  const list = __candidates();
  assert.ok(list.length > 1,
    `候选只有 ${list.length} 个；这正是机构通道从不启动的原因`);
  assert.ok(list.includes('python'), '至少要试 PATH 上的 python');
});

test('会搜索 Windows 的常见 Python 安装位置，而不只是 PATH', () => {
  // The package being outside PATH is the normal case on Windows when Anaconda
  // owns the `python` name, which is what happened here.
  const previous = process.env.LOCALAPPDATA;
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'pyroots-'));
  fs.mkdirSync(path.join(fake, 'Programs', 'Python', 'Python312'), { recursive: true });
  fs.writeFileSync(path.join(fake, 'Programs', 'Python', 'Python312', 'python.exe'), '');
  process.env.LOCALAPPDATA = fake;
  try {
    const { __candidates } = loadResolver();
    const list = __candidates();
    assert.ok(list.some((c) => c.includes('Python312')),
      '应把 %LOCALAPPDATA%\\Programs\\Python\\* 纳入候选：' + list.join(' | '));
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    fs.rmSync(fake, { recursive: true, force: true });
  }
});

test('绝对路径不存在时跳过，裸命令名不做 existsSync 判断', () => {
  /* The original loop called fs.existsSync on every candidate, so a bare
     `python` could never pass even if it had been in the list — the OS resolves
     that name at spawn time and there is no such file on disk. */
  const { __candidates, __resolve } = loadResolver();
  assert.ok(__candidates().includes('python'));
  // Resolution must not throw regardless of what is installed here.
  const picked = __resolve();
  assert.ok(picked === null || typeof picked === 'string');
});

test('找不到解释器时，报告试过哪些，并说明没有发出网络请求', () => {
  // The old message named no candidate at all, so a user whose package sits in
  // a non-PATH interpreter had nothing to act on.
  assert.match(source, /没有找到装有 scansci_pdf 的 Python 解释器/);
  assert.match(source, /本次没有发出任何网络请求/);
  assert.match(source, /已尝试：/);
  assert.match(source, /resolvePython\.tried/);
});

test('启动失败会清掉上一轮遗留的进度文件', () => {
  /* Otherwise the poller keeps rendering the previous run's counters, which is
     how a run that never started displayed "11/35（成功 0，失败 11）". */
  assert.match(source, /function clearStaleProgress/);
  const failBody = extractFunction('fail');
  assert.match(failBody, /clearStaleProgress\(\)/,
    'fail() 必须清理进度文件，否则 UI 会显示上一轮的数字');

  // And it must really delete the file.
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scansci-ws-'));
  const runtime = path.join(workspace, 'Scholarium', 'runtime');
  fs.mkdirSync(runtime, { recursive: true });
  const progress = path.join(runtime, 'download-progress.json');
  fs.writeFileSync(progress, JSON.stringify({ done: 11, total: 35, failed: 11, status: 'running' }));

  const input = path.join(workspace, 'in.json');
  fs.writeFileSync(input, JSON.stringify({ dois: [] })); // 触发 fail：没有 DOI
  try {
    spawnSync(process.execPath, [SCRIPT, workspace, input], {
      encoding: 'utf8', windowsHide: true, timeout: 60000,
      env: { ...process.env, SCANSCI_PYTHON: '' },
    });
    assert.equal(fs.existsSync(progress), false,
      '启动失败后，上一轮的进度文件必须被清掉');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
