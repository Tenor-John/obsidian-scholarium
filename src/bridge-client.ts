import { requestUrl } from 'obsidian';
import { WEAVER_LOCAL_URL } from './weaver-constants';
import { classifyScholariumState, describeScholariumReadiness } from './bridge-state-response';
import type { ScholariumStateErrorKind, ScholariumStatusLike } from './bridge-state-response';

/**
 * Typed client for the Bridge's read-only ("L0") Scholarium channel —
 * GET /v1/scholarium/status and GET /v1/scholarium/state in
 * agent-canvas-demo/bridge/server.js — reached through the local launcher's
 * `/bridge/*` proxy (agent-canvas-demo/start-local.js) on WEAVER_LOCAL_URL,
 * the same origin research-weaver-mount.ts already ensures is running
 * before it mounts the iframe.
 *
 * This is the M2 "只读上下文读取" (read-only Project/Experiment/Evidence
 * context) piece: it reads what `project.list` / `project.get` /
 * `experiment.scan_outcomes` already expose server-side (schema-v1 objects,
 * read straight from Markdown — see tools/research-state.js) without
 * duplicating that logic, and without ever calling anything above L0. It
 * deliberately has no write methods: submitting an action goes through
 * POST /v1/scholarium/actions, is queued for the plugin's own consumer
 * running inside Obsidian, and is out of scope for this milestone.
 */

export class ScholariumStateError extends Error {
    readonly kind: ScholariumStateErrorKind;
    readonly ref?: string;

    constructor(kind: ScholariumStateErrorKind, message: string, ref?: string) {
        super(message);
        this.name = 'ScholariumStateError';
        this.kind = kind;
        this.ref = ref;
    }
}

export interface ScholariumStatus extends ScholariumStatusLike {
    enabled: boolean;
    vaultRoot: string | null;
    vaultRootConfigured: boolean;
    vaultRootExists: boolean;
    allowedActions: string[];
    rescanCadenceDays: number;
}

export interface ProjectCounts {
    questions: number;
    hypotheses: number;
    experiments: number;
    evidence: number;
}

export interface ProjectSummary {
    uid: string;
    display_id: string;
    title: string;
    status: string;
    stage: string;
    updated_at: string | null;
    path: string;
    counts: ProjectCounts;
    open_questions: number;
    unsettled_experiments: number;
}

export interface EvidenceSettlement {
    supports: number;
    contradicts: number;
    qualifies: number;
    pending: number;
    rejected: number;
}

export interface HypothesisSummary {
    uid: string;
    display_id: string;
    statement: string;
    status: string;
    confidence: number | null;
    formal_supporting: number;
    formal_contradicting: number;
    settlement: EvidenceSettlement;
    path: string;
}

export interface ExperimentSummary {
    uid: string;
    display_id: string;
    title: string;
    status: string;
    project_uid: string | null;
    project_display_id: string | null;
    tests_hypotheses: Array<{ uid: string; display_id: string | null }>;
    has_conclusion: boolean;
    conclusion_excerpt: string;
    produced_evidence_count: number;
    data_origin: string | null;
    updated_at: string | null;
    path: string;
}

export interface ProjectDetail {
    project: Record<string, unknown>;
    path: string;
    hypotheses: HypothesisSummary[];
    experiments: ExperimentSummary[];
    questions: Array<{ uid: string; display_id: string; statement: string; status: string; path: string }>;
    decisions: unknown[];
    lessons: unknown[];
    counts: ProjectCounts & { decisions: number; lessons: number };
}

export interface ExperimentOutcomeScan {
    scope_project_uid: string | null;
    awaiting_integration: ExperimentSummary[];
    in_progress: Array<{ uid: string; display_id: string; title: string; status: string; updated_at: string | null; path: string }>;
    planned: number;
    settled: number;
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
    const res = await requestUrl({ url: new URL(path, WEAVER_LOCAL_URL).toString(), method: 'GET', throw: false });
    let body: unknown;
    try {
        body = JSON.parse(res.text);
    } catch {
        body = undefined;
    }
    return { status: res.status, body };
}

async function readState<T>(action: string, input?: Record<string, unknown>): Promise<T> {
    const query = new URLSearchParams({ action });
    if (input) query.set('input', JSON.stringify(input));
    const { status, body } = await getJson(`/bridge/v1/scholarium/state?${query.toString()}`);
    const classified = classifyScholariumState(status, body as { error?: string; result?: unknown });
    if (!classified.ok) throw new ScholariumStateError(classified.kind, classified.message, classified.ref);
    return classified.result as T;
}

/** GET /v1/scholarium/status — cheap, always answers even when the read channel is not usable yet. */
export async function getScholariumStatus(): Promise<ScholariumStatus> {
    const { body } = await getJson('/bridge/v1/scholarium/status');
    return body as ScholariumStatus;
}

/**
 * Check readiness for a specific action before attempting a read, so a
 * caller can show a specific "未启用 / vaultRoot 未配置 / 不在白名单" message
 * instead of only finding out from a failed state-read.
 */
export async function checkReadiness(requiredAction: string) {
    const status = await getScholariumStatus();
    return { status, readiness: describeScholariumReadiness(status, requiredAction) };
}

export async function listProjects(): Promise<ProjectSummary[]> {
    const result = await readState<{ projects: ProjectSummary[] }>('project.list');
    return result.projects;
}

export async function getProject(ref: { displayId?: string; uid?: string }): Promise<ProjectDetail> {
    const input: Record<string, unknown> = {};
    if (ref.uid) input.project_uid = ref.uid;
    if (ref.displayId) input.display_id = ref.displayId;
    return readState<ProjectDetail>('project.get', input);
}

export async function scanExperimentOutcomes(projectUid?: string): Promise<ExperimentOutcomeScan> {
    return readState<ExperimentOutcomeScan>('experiment.scan_outcomes', projectUid ? { project_uid: projectUid } : {});
}
