"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('chat prefetches its explicitly bound project before assembling every prompt', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'shell-ui.js'), 'utf8');
  const projectRead = source.indexOf("action: 'project.get'");
  const promptBuild = source.indexOf('buildResearchChatPrompt({');
  assert.ok(projectRead >= 0, 'chat must issue the authoritative project.get read');
  assert.ok(projectRead < promptBuild, 'project state must be fetched before prompt assembly');
  assert.match(source, /activeTopic\?\.projectId/);
  assert.match(source, /action: 'workspace\.timeblock_drift_audit'/);
  assert.match(source, /projectContextBlock\(projectId, projectState, outcomeState, projectStateError, driftState\)/);
});
