/* Read-mostly Scholarium MCP transport for the research Agent.
 *
 * Claude's WebFetch deliberately refuses localhost and its shell tool may be
 * disabled by policy.  This stdio server gives the Agent a first-class MCP
 * route to the already-running Bridge instead of asking the model to guess a
 * port or smuggle local HTTP through a shell.  The injected token is scoped by
 * server.js to the endpoints below; it cannot submit Scholarium actions or
 * commit drafts. */
'use strict';

const http = require('node:http');
const https = require('node:https');

const bridgeBase = String(process.env.SCHOLARIUM_MCP_BRIDGE_URL || '').replace(/\/$/, '');
const readToken = String(process.env.SCHOLARIUM_MCP_READ_TOKEN || '');

function request(method, route, payload) {
  return new Promise((resolve, reject) => {
    if (!bridgeBase || !readToken) return reject(new Error('Scholarium MCP was not given a Bridge read capability'));
    const target = new URL(route, bridgeBase + '/');
    const transport = target.protocol === 'https:' ? https : http;
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const req = transport.request(target, {
      method,
      headers: {
        'x-scholarium-mcp-token': readToken,
        ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
      },
      timeout: 15000,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw = `${raw}${chunk}`.slice(0, 4 * 1024 * 1024); });
      res.on('end', () => {
        let data;
        try { data = raw ? JSON.parse(raw) : {}; }
        catch { return reject(new Error(`Bridge returned non-JSON (${res.statusCode})`)); }
        if ((res.statusCode || 500) >= 400) return reject(new Error(data.error || `Bridge HTTP ${res.statusCode}`));
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Scholarium Bridge read timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const tools = [
  {
    name: 'scholarium_state',
    description: 'Read structured Scholarium state through a whitelisted L0 action. Never writes.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['action'],
      properties: { action: { type: 'string' }, input: { type: 'object', additionalProperties: true } },
    },
  },
  {
    name: 'vault_search',
    description: 'Search safe text files across the configured Obsidian vault. Returns bounded paths and excerpts; excludes settings, secrets, plugins, audit logs and binary files.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { query: { type: 'string' }, extensions: { type: 'array', items: { type: 'string' } }, limit: { type: 'integer', minimum: 1, maximum: 200 } },
    },
  },
  {
    name: 'vault_read',
    description: 'Read one safe text file returned by vault_search from the configured Obsidian vault. Never writes.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['path'],
      properties: { path: { type: 'string' }, max_chars: { type: 'integer', minimum: 1, maximum: 200000 } },
    },
  },
  {
    name: 'rescan_checkpoint_mark',
    description: 'Mark the operational rescan clock only after workspace.rescan_pending returned due=true. Does not modify research records.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
];

async function callTool(name, args) {
  if (name === 'scholarium_state') {
    const query = new URLSearchParams({ action: String(args?.action || '') });
    if (args?.input && Object.keys(args.input).length) query.set('input', JSON.stringify(args.input));
    return request('GET', `/v1/scholarium/state?${query.toString()}`);
  }
  if (name === 'vault_search') return request('POST', '/v1/scholarium/vault/search', args || {});
  if (name === 'vault_read') return request('POST', '/v1/scholarium/vault/read', args || {});
  if (name === 'rescan_checkpoint_mark') return request('GET', '/v1/scholarium/rescan-checkpoint-mark');
  throw new Error(`Unknown Scholarium tool: ${name}`);
}

function write(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'initialize') {
    return write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'scholarium', version: '1.0.0' } } });
  }
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
  if (message.method === 'ping') return write({ jsonrpc: '2.0', id: message.id, result: {} });
  if (message.method === 'tools/list') return write({ jsonrpc: '2.0', id: message.id, result: { tools } });
  if (message.method === 'prompts/list') return write({ jsonrpc: '2.0', id: message.id, result: { prompts: [] } });
  if (message.method === 'resources/list') return write({ jsonrpc: '2.0', id: message.id, result: { resources: [] } });
  if (message.method === 'tools/call') {
    try {
      const result = await callTool(String(message.params?.name || ''), message.params?.arguments || {});
      return write({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
    } catch (error) {
      return write({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: String(error?.message || error) }], isError: true } });
    }
  }
  if (message.id !== undefined) write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try { void handle(JSON.parse(line)); }
    catch (error) { process.stderr.write(`Invalid MCP JSON: ${error.message}\n`); }
  }
});
