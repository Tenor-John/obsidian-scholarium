'use strict';
/* A PATH that contains exactly the agents a test decided to put there.
   ------------------------------------------------------------------------
   Why this exists: `agent-environment-endpoint.test.js` used to assert that
   the hermes adapter is `missing`, which is a statement about the machine the
   test runs on rather than about the code. On a host where hermes is
   installed the adapter came back `ready` and the suite went red for a reason
   that had nothing to do with the fixture's own bridge. Worse, it went red in
   the shape of a real bug, so the only ways out were to delete the assertion
   or to change production code — both of which hide the next real failure.

   The fix is not a weaker assertion but a controlled machine. agent-detect.js
   locates a binary through exactly two channels:

     1. `where`/`which <cmd>` — the PATH of the process doing the probing, and
     2. `knownLocations()` — npm's global root plus a handful of user-scoped
        directories (%APPDATA%\npm, %LOCALAPPDATA%\Programs, ~/.<cmd>/bin).

   So an isolated environment has to close both: PATH is rebuilt from scratch,
   and every user-scoped root the detector consults is redirected into the
   caller's scratch directory, where nothing is installed.

   One subtlety is worth stating because the obvious version of this fixture
   is silently worthless: PATH must keep the OS directories that hold
   `where.exe` and `cmd.exe`. Node resolves a bare command against PATH even
   for a plain spawn (no shell), so a PATH of `<fixture>:/dev/null` makes
   `spawnSync('where', ...)` fail with ENOENT — the detector then reports
   every agent as `missing`, the test passes, and it proves nothing about
   detection. That failure mode was observed while building this fixture; the
   OS directories below contain no agent binary on Windows, which is why the
   isolation stays honest.

   POSIX note: only /usr/bin and /bin are kept, deliberately not
   /usr/local/bin or /opt/homebrew/bin (where a real agent would live).
   `~/.local/bin` is excluded too, because PATH no longer names it. */

const fs = require('node:fs');
const path = require('node:path');

// The exact first line the "ready" shim prints. Tests match on it verbatim,
// so a probe that answers without reading the binary cannot fake it.
const READY_VERSION = 'hermes fixture version 1.4.2-isolated';
// Written to be recognisable in an assertion: if this sentence reaches the
// user-facing `problem` field, the refusal was carried through rather than
// replaced by a generic "not found".
const BROKEN_MESSAGE = 'hermes fixture refusing to run: required Node.js version not satisfied';

const SHIM_BODIES = {
  // Found, spawnable, and exits non-zero — the openclaw shape that produced
  // the original false green dot.
  broken: {
    win: [
      '@echo off',
      `echo ${BROKEN_MESSAGE}`,
      'exit /b 1',
    ].join('\r\n'),
    posix: ['#!/bin/sh', `echo "${BROKEN_MESSAGE}"`, 'exit 1'].join('\n'),
  },
  // Answers --version the way a working install does.
  ready: {
    win: [
      '@echo off',
      `echo ${READY_VERSION}`,
      'exit /b 0',
    ].join('\r\n'),
    posix: ['#!/bin/sh', `echo "${READY_VERSION}"`, 'exit 0'].join('\n'),
  },
};

/* Drop one shim into `binDir`. Windows gets a .cmd because that is what the
   OS actually executes and what agent-detect.js reorders to the front of its
   candidate list; POSIX gets an executable script with no extension. */
function writeShim(binDir, name, state) {
  const body = SHIM_BODIES[state];
  if (!body) throw new Error(`unknown shim state: ${state}`);
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === 'win32') {
    const file = path.join(binDir, `${name}.cmd`);
    fs.writeFileSync(file, `${body.win}\r\n`, 'utf8');
    return file;
  }
  const file = path.join(binDir, name);
  fs.writeFileSync(file, `${body.posix}\n`, { encoding: 'utf8', mode: 0o755 });
  return file;
}

/* Build the environment for a Bridge that must see only the agents named in
   `shims` ({ hermes: 'broken' } etc). Nothing here touches the caller's own
   environment: `process.env` is copied, never mutated. */
function isolatedAgentEnv(scratch, shims = {}) {
  const bin = path.join(scratch, 'isolated-bin');
  const home = path.join(scratch, 'isolated-home');
  const appData = path.join(scratch, 'isolated-appdata');
  const localAppData = path.join(scratch, 'isolated-localappdata');
  for (const dir of [bin, home, appData, localAppData]) fs.mkdirSync(dir, { recursive: true });
  for (const [name, state] of Object.entries(shims)) writeShim(bin, name, state);

  const env = { ...process.env };
  // Node keeps PATH in whatever case the OS handed it; Windows uses `Path`
  // and Git Bash uses `PATH`. Clearing both spellings first is what makes the
  // rebuilt value the only one the child can see.
  for (const key of Object.keys(env)) if (/^path$/i.test(key)) delete env[key];

  const systemRoot = process.env.SystemRoot || process.env.windir || '';
  const osDirs = process.platform === 'win32'
    ? [path.join(systemRoot, 'system32'), systemRoot].filter(Boolean)
    : ['/usr/bin', '/bin'];
  env.PATH = [bin, ...osDirs].join(path.delimiter);

  // knownLocations() reads these directly, so PATH alone is not enough: with
  // the real %APPDATA% left in place, a hermes/claude under %APPDATA%\npm is
  // still found while PATH says otherwise.
  env.HOME = home;
  env.USERPROFILE = home;
  env.APPDATA = appData;
  env.LOCALAPPDATA = localAppData;
  // agent-env.js reports hermes' config file location from this variable; an
  // inherited value would leak the host's install into the report.
  delete env.HERMES_HOME;
  return env;
}

module.exports = { isolatedAgentEnv, writeShim, SHIM_BODIES, READY_VERSION, BROKEN_MESSAGE };
