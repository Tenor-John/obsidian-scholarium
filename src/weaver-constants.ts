// Shared constants for talking to the Research Weaver local companion app
// (agent-canvas-demo). Kept in their own file, rather than duplicated in
// research-weaver-mount.ts and bridge-client.ts separately, so the two never
// drift onto different ports.
//
// WEAVER_LOCAL_URL is the local launcher's own HTTP origin (start-local.js,
// AGENT_CANVAS_PORT, default 4173) — NOT the Bridge server's own port
// (AGENT_BRIDGE_PORT, default 4318). bridge-client.ts talks to the Bridge
// through the launcher's `/bridge/*` proxy (see start-local.js's
// proxyBridge()) rather than dialing the Bridge directly, so it reuses the
// launcher's existing `x-agent-bridge-token` injection instead of this
// plugin needing to read bridge.config.json and manage that token itself.
export const WEAVER_LOCAL_URL = 'http://127.0.0.1:4173/';
