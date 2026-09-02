const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { evidencePacket, buildExtractionPrompt, parseGraphReply, isExplicitGraphRequest } = require('../knowledge-graph-core.js');

test('evidence packet is bounded and preserves provenance', () => {
  const cards = Array.from({ length: 50 }, (_, index) => ({
    id: `E-${index}`, source_path: `paper-${index}.pdf`, evidence_tier: 'direct_pdf_text',
    claim_candidates: ['x'.repeat(8000), 'second excerpt'],
  }));
  const packet = evidencePacket(cards, 30, 20000);
  assert.ok(packet.length > 0 && packet.length < 30);
  assert.equal(packet[0].source_path, 'paper-0.pdf');
  assert.ok(packet[0].excerpts[0].length <= 3400);
});

test('extraction prompt requires semantic relations, provenance and uncertainty', () => {
  const prompt = buildExtractionPrompt({ question: 'CeO2 壳厚如何影响 Au SPR?', cards: [{ source_path: 'a.pdf', claim_candidates: ['Au@CeO2 core-shell'] }] });
  assert.match(prompt, /语义实体—关系图/);
  assert.match(prompt, /source_path/);
  assert.match(prompt, /不能把共同出现写成因果/);
  assert.match(prompt, /review_status=inferred/);
});

test('graph reply parser accepts plain and fenced JSON and enforces nodes/edges', () => {
  const graph = { title: 't', nodes: [{ id: 'au', label: 'Au', type: 'material' }], edges: [] };
  assert.equal(parseGraphReply(JSON.stringify(graph)).nodes[0].id, 'au');
  assert.equal(parseGraphReply('```json\n' + JSON.stringify(graph) + '\n```').title, 't');
  assert.throws(() => parseGraphReply('{"title":"bad"}'), /nodes\/edges/);
});

test('render_graph.py rejects a fabricated quote and keeps a real one supported', (t) => {
  const probe = spawnSync('python', ['-c', 'import sys'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('python unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zrl-kg-quote-test-'));
  const cardsDir = path.join(root, 'literature', 'evidence-cards');
  fs.mkdirSync(cardsDir, { recursive: true });
  fs.writeFileSync(
    path.join(cardsDir, 'evidence-test.json'),
    JSON.stringify({ id: 'evidence-test', source_path: 'paper.pdf', claim_candidates: ['S1 shows a regular sheet-like morphology with shell thickness about 20 nm.'] }),
    'utf8'
  );
  const input = path.join(root, 'input.json');
  const graph = {
    graph: {
      title: 'Quote verification test',
      nodes: [
        { id: 'mat', label: 'BiVO4', type: 'material' },
        { id: 'spec', label: 'S1', type: 'specimen' },
      ],
      edges: [
        { source: 'spec', target: 'mat', relation: 'instance_of', label: 'real quote', confidence: .9, review_status: 'supported', evidence: [{ source_path: 'paper.pdf', quote: 'S1 shows a regular sheet-like morphology with shell thickness about 20 nm.' }] },
      ],
      warnings: [],
    },
  };
  fs.writeFileSync(input, JSON.stringify(graph), 'utf8');
  const script = path.join(__dirname, '..', 'skills', 'zrl-knowledge-graph', 'scripts', 'render_graph.py');
  const run = spawnSync('python', [script, root, input], { encoding: 'utf8' });
  try {
    assert.equal(run.status, 0, run.stderr);
    const jsonGraph = JSON.parse(fs.readFileSync(path.join(root, 'knowledge-graph', 'knowledge_graph.json'), 'utf8'));
    assert.equal(jsonGraph.edges[0].review_status, 'supported');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('render_graph.py downgrades an edge whose quote is not actually in the source card', (t) => {
  const probe = spawnSync('python', ['-c', 'import sys'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('python unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zrl-kg-quote-test-'));
  const cardsDir = path.join(root, 'literature', 'evidence-cards');
  fs.mkdirSync(cardsDir, { recursive: true });
  fs.writeFileSync(
    path.join(cardsDir, 'evidence-test.json'),
    JSON.stringify({ id: 'evidence-test', source_path: 'paper.pdf', claim_candidates: ['S1 shows a regular sheet-like morphology with shell thickness about 20 nm.'] }),
    'utf8'
  );
  const input = path.join(root, 'input.json');
  const graph = {
    graph: {
      title: 'Quote verification test',
      nodes: [
        { id: 'exec', label: 'SEM run', type: 'execution' },
        { id: 'obs', label: 'Shell thickness', type: 'observation' },
      ],
      edges: [
        { source: 'exec', target: 'obs', relation: 'measured_by', label: 'fabricated quote', confidence: .9, review_status: 'supported', evidence: [{ source_path: 'paper.pdf', quote: 'this exact sentence was never written anywhere in the paper' }] },
      ],
      warnings: [],
    },
  };
  fs.writeFileSync(input, JSON.stringify(graph), 'utf8');
  const script = path.join(__dirname, '..', 'skills', 'zrl-knowledge-graph', 'scripts', 'render_graph.py');
  const run = spawnSync('python', [script, root, input], { encoding: 'utf8' });
  try {
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(run.stdout);
    assert.match(manifest.warnings.join('\n'), /claimed quote not found verbatim/);
    const jsonGraph = JSON.parse(fs.readFileSync(path.join(root, 'knowledge-graph', 'knowledge_graph.json'), 'utf8'));
    assert.equal(jsonGraph.edges[0].review_status, 'inferred');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('render_graph.py refuses to keep an edge supported when it has a locator but no quote at all', (t) => {
  // The gap this locks in: an edge that claims review_status=supported and
  // carries a source_path/locator but never actually supplies a quote used
  // to skip the per-quote verification loop entirely (an empty `quoted`
  // list left the initial "supported" guess untouched), so it kept
  // `supported` without a single verified quote. A literature-evidence
  // edge must never be supported on locator alone.
  const probe = spawnSync('python', ['-c', 'import sys'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('python unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zrl-kg-quote-test-'));
  const cardsDir = path.join(root, 'literature', 'evidence-cards');
  fs.mkdirSync(cardsDir, { recursive: true });
  fs.writeFileSync(
    path.join(cardsDir, 'evidence-test.json'),
    JSON.stringify({ id: 'evidence-test', source_path: 'paper.pdf', claim_candidates: ['S1 shows a regular sheet-like morphology with shell thickness about 20 nm.'] }),
    'utf8'
  );
  const input = path.join(root, 'input.json');
  const graph = {
    graph: {
      title: 'Locator-only evidence test',
      nodes: [
        { id: 'exec', label: 'SEM run', type: 'execution' },
        { id: 'obs', label: 'Shell thickness', type: 'observation' },
      ],
      edges: [
        { source: 'exec', target: 'obs', relation: 'measured_by', label: 'locator only, no quote', confidence: .9, review_status: 'supported', evidence: [{ source_path: 'paper.pdf', locator: 'abstract' }] },
      ],
      warnings: [],
    },
  };
  fs.writeFileSync(input, JSON.stringify(graph), 'utf8');
  const script = path.join(__dirname, '..', 'skills', 'zrl-knowledge-graph', 'scripts', 'render_graph.py');
  const run = spawnSync('python', [script, root, input], { encoding: 'utf8' });
  try {
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(run.stdout);
    assert.match(manifest.warnings.join('\n'), /cannot be supported without a verified quote/);
    const jsonGraph = JSON.parse(fs.readFileSync(path.join(root, 'knowledge-graph', 'knowledge_graph.json'), 'utf8'));
    assert.equal(jsonGraph.edges[0].review_status, 'inferred');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('render_graph.py --dry-run runs the full normalize/verify pipeline but never touches knowledge-graph/', (t) => {
  const probe = spawnSync('python', ['-c', 'import sys'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('python unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zrl-kg-dry-run-test-'));
  const input = path.join(root, 'input.json');
  const graph = {
    graph: {
      title: 'Dry run test',
      nodes: [{ id: 'a', label: 'A', type: 'material' }, { id: 'b', label: 'B', type: 'outcome' }],
      edges: [{ source: 'a', target: 'b', relation: 'correlates_with', review_status: 'inferred', evidence: [] }],
      warnings: [],
    },
    dry_run: true,
  };
  fs.writeFileSync(input, JSON.stringify(graph), 'utf8');
  const script = path.join(__dirname, '..', 'skills', 'zrl-knowledge-graph', 'scripts', 'render_graph.py');
  const before = fs.existsSync(path.join(root, 'knowledge-graph'));
  const run = spawnSync('python', [script, root, input], { encoding: 'utf8' });
  try {
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(run.stdout);
    assert.equal(manifest.dry_run, true);
    assert.equal(manifest.graph.nodes.length, 2);
    assert.equal(fs.existsSync(path.join(root, 'knowledge-graph')), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('only explicit generation wording triggers file creation lane', () => {
  assert.equal(isExplicitGraphRequest('请根据本轮论文生成知识图谱'), true);
  assert.equal(isExplicitGraphRequest('知识图谱和概念图有什么区别？'), false);
});

test('bundled renderer emits a self-contained interactive semantic HTML graph', (t) => {
  const probe = spawnSync('python', ['-c', 'import sys'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('python unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zrl-kg-test-'));
  const input = path.join(root, 'input.json');
  const graph = {
    graph: {
      title: 'Au@CeO2 mechanism graph', research_question: 'How does shell thickness affect HER?',
      nodes: [
        { id: 'au', label: 'Au', type: 'material' },
        { id: 'spr', label: 'SPR hot electrons', type: 'mechanism' },
        { id: 'her', label: 'Hydrogen evolution', type: 'outcome' },
      ],
      edges: [
        { source: 'au', target: 'spr', relation: 'enables', label: '激发', confidence: .8, review_status: 'supported', evidence: [{ source_path: 'paper.pdf', locator: 'abstract' }] },
        { source: 'spr', target: 'her', relation: 'correlates_with', label: '相关', confidence: .5, review_status: 'inferred', evidence: [] },
      ], warnings: [],
    },
  };
  fs.writeFileSync(input, JSON.stringify(graph), 'utf8');
  const script = path.join(__dirname, '..', 'skills', 'zrl-knowledge-graph', 'scripts', 'render_graph.py');
  const run = spawnSync('python', [script, root, input], { encoding: 'utf8' });
  try {
    assert.equal(run.status, 0, run.stderr);
    const manifest = JSON.parse(run.stdout);
    assert.equal(manifest.nodes, 3);
    assert.equal(manifest.edges, 2);
    const html = fs.readFileSync(path.join(root, manifest.html), 'utf8');
  assert.match(html, /<svg id="graph"(?:\s|>)/);
    assert.match(html, /SPR hot electrons/);
    assert.match(html, /滚轮缩放/);
  assert.match(html, /Semantic layers/);
  assert.match(html, /#090b10/);
  assert.match(html, /zrl-kg-layout:/);
  assert.match(html, /document\.addEventListener\('pointerdown'/);
    assert.doesNotMatch(html, /<script[^>]+src=|\bfetch\s*\(/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
