'use strict';

/**
 * Canonical registry of well-known CLI coding-agent adapters the Bridge can
 * auto-discover on a machine it has never seen before (see
 * GET /v1/agents/discover and POST /v1/agents/adapters in
 * bridge/server.js).
 *
 * Why this exists: GET /v1/agents (agentStatus() below) only ever reports
 * on adapters already hand-written into bridge.config.json's `adapters`
 * object. That is fine for the person who wrote that config, but it means
 * a fresh install on a different machine — a new researcher who has never
 * touched bridge.config.json — sees an empty agent list with no way to
 * find out what is actually installed. This registry is the fix: a list of
 * agents to *probe for*, independent of what is already configured.
 *
 * Each `command` is a bare command name, resolved through resolveCommand()
 * (PATH lookup, with Windows .cmd-shim unwrapping already handled there) —
 * never a hardcoded absolute path — so this registry works unmodified on
 * any user's machine, the same way the existing `opencode` entry in
 * bridge.config.example.json already does. Do not hardcode a per-machine
 * path here; that reintroduces the exact single-user assumption this
 * registry exists to remove.
 *
 * `args` is each CLI's own documented one-shot / non-interactive
 * invocation (verified against that project's own CLI reference as of
 * 2026-09 — see the commit message for sources). `{{prompt}}` is
 * substituted the same way POST /v1/full-tasks and hand-written
 * bridge.config.json adapters already do. A CLI that changes its flags in
 * a future release will need this updated, same as any other adapter entry.
 *
 * Adding an entry here (or POSTing it into bridge.config.json via
 * /v1/agents/adapters) never by itself grants execution: config.
 * allowExecution defaults false and gates every adapter regardless of how
 * it got into `adapters`, exactly as bridge.config.example.json documents.
 */
const KNOWN_AGENTS = [
    {
        id: 'claude',
        label: 'Claude Code',
        command: 'claude',
        args: ['-p', '{{prompt}}'],
        guide: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    },
    {
        id: 'codex',
        label: 'Codex CLI',
        command: 'codex',
        args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', '{{prompt}}'],
        guide: 'https://developers.openai.com/codex/cli',
    },
    {
        id: 'opencode',
        label: 'OpenCode',
        command: 'opencode',
        args: ['run', '{{prompt}}'],
        guide: 'https://opencode.ai/docs/',
    },
    {
        id: 'hermes',
        label: 'Hermes Agent',
        command: 'hermes',
        // `-z`: Hermes's own "purest one-shot entry point" — prompt in, final
        // response text out, nothing else on stdout/stderr (see NousResearch/
        // hermes-agent's CLI reference).
        args: ['-z', '{{prompt}}'],
        guide: 'https://hermes-agent.nousresearch.com/docs/reference/cli-commands',
    },
    {
        id: 'openclaw',
        label: 'OpenClaw',
        command: 'openclaw',
        // `agent exec`: OpenClaw's own documented "recommended headless entry
        // point for CI and coding automation" — an embedded one-shot turn,
        // no Gateway/--agent selector required (see docs.openclaw.ai/cli/agent).
        args: ['agent', 'exec', '{{prompt}}'],
        guide: 'https://docs.openclaw.ai/cli/agent',
    },
    {
        id: 'pi',
        label: 'Pi Coding Agent',
        command: 'pi',
        // `-p`: Pi's documented print/one-shot mode.
        args: ['-p', '{{prompt}}'],
        guide: 'https://github.com/earendil-works/pi',
    },
    {
        id: 'dsh',
        label: 'DeepSeek Harness',
        command: 'dsh',
        // `--profile headless <task>`: the official one-off headless run —
        // DeepSeek Harness removed the older `dsh run` subcommand.
        args: ['--profile', 'headless', '{{prompt}}'],
        guide: 'https://github.com/deepseek-ai/deepseek-harness',
    },
    {
        id: 'kimi',
        label: 'Kimi Code',
        command: 'kimi',
        // `-p`/`--prompt`: Kimi Code's documented single-shot, non-interactive mode.
        args: ['-p', '{{prompt}}'],
        guide: 'https://github.com/MoonshotAI/kimi-cli',
    },
];

module.exports = { KNOWN_AGENTS };
