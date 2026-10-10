const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const downloader = fs.readFileSync(path.join(
  root, 'skills', 'paper-downloader', 'scripts', 'browser_downloader.js'
), 'utf8');
const ui = fs.readFileSync(path.join(root, 'bridge-ui.js'), 'utf8');

test('WebVPN login writes a fresh terminal status when detached startup fails', () => {
  assert.match(downloader, /writeWebvpnLoginStatus\(root, \{/);
  assert.match(downloader, /status: 'starting'/);
  assert.match(downloader, /status: 'login_failed'/);
  assert.match(downloader, /missing_playwright/);
});

test('portable WebVPN login tries Chrome, Edge, then Playwright Chromium', () => {
  assert.match(downloader, /if \(requested === 'chrome'\) candidates\.push\('msedge'\)/);
  assert.match(downloader, /candidates\.push\(false\)/);
  assert.match(downloader, /npx playwright install chromium/);
});

test('WebVPN UI ignores stale status from the auto-login attempt', () => {
  assert.match(ui, /async function pollWebvpnLoginStatus\(timeoutMs, pollMs = 2000, notBefore = 0\)/);
  assert.match(ui, /stamp >= notBefore - 5000/);
  assert.match(ui, /const manualStartedAt = Date\.now\(\)/);
});
