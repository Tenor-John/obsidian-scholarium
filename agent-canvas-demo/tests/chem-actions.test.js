// experiment.insert_chem（2026-09-04）：织研者往实验记录正文写化学结构块的
// 动作。这份测试跑真实磁盘读写（临时 vault），不是源码断言——因为这个动作的
// 全部风险都在"写出去的字节能不能被插件读回来"上：块的字段顺序、引号方式必须
// 和主插件的 parseChemBlock 对得上，frontmatter 不能被覆盖，正文不能被截断。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const S = require(path.join(TOOLS, 'schema-objects.js'));
const X = require(path.join(TOOLS, 'experiment-store.js'));
const CH = require(path.join(TOOLS, 'chem-actions.js'));
const registry = require(path.join(TOOLS, 'action-registry.js'));

const ETHYLBENZENE = 'CCBr.OB(O)c1ccccc1>>CCc1ccccc1';
// RDKit is an optional local dependency. Chemistry validation must be visible
// as unavailable on machines that do not have it, but the rest of the Bridge
// suite should remain runnable; an environment-dependent validator failure is
// not a regression in the JS action or its on-disk serialization.
const CHEMISTRY_VALIDATION_AVAILABLE = (() => {
  try { return CH.validateChem(null, { smiles: 'CC' }).status !== 'unavailable'; }
  catch { return false; }
})();
const chemistrySkip = CHEMISTRY_VALIDATION_AVAILABLE ? false : 'RDKit is not installed; chemistry validation tests are skipped.';

function makeVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-chem-'));
  const created = X.saveNew(vault, { title: '偶联条件筛选', project_uid: S.uuidV7() });
  return { vault, uid: created.object.uid, path: created.path };
}

function readNote(vault, rel) {
  return fs.readFileSync(path.join(vault, ...rel.split('/')), 'utf8');
}

test('dry run reports what it would write and leaves the note untouched', () => {
  const { vault, uid, path: rel } = makeVault();
  const before = readNote(vault, rel);
  const out = CH.insertChem(vault, { experiment_uid: uid, reaction_smiles: ETHYLBENZENE }, { dryRun: true });
  assert.equal(out.mode, 'dry_run');
  assert.equal(out.block.reaction_smiles, ETHYLBENZENE);
  assert.equal(out.block.type, 'reaction');
  assert.deepEqual(out.frontmatter_updated, ['reaction_smiles']);
  assert.equal(readNote(vault, rel), before, '空跑绝不能落盘');
});

test('the written fence round-trips: every field the plugin reads is present and correctly quoted', () => {
  const { vault, uid, path: rel } = makeVault();
  CH.insertChem(vault, { experiment_uid: uid, reaction_smiles: ETHYLBENZENE, title: 'Suzuki 偶联' });
  const note = readNote(vault, rel);
  const fence = /```scholarium-chem\n([\s\S]*?)\n```/.exec(note);
  assert.ok(fence, '正文里必须有一个 scholarium-chem 围栏');
  const fields = Object.fromEntries(fence[1].split('\n').map((line) => {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    return [kv[1], kv[2]];
  }));
  // 主插件 parseChemBlock 会读这些键；少一个就有字段读成 undefined。
  for (const key of ['id', 'type', 'title', 'locked', 'format', 'created', 'updated',
    'ket', 'rxn', 'molfile', 'smiles', 'reactionSmiles', 'previewSvg']) {
    assert.ok(key in fields, '缺少字段 ' + key);
  }
  assert.equal(JSON.parse(fields.reactionSmiles), ETHYLBENZENE);
  assert.equal(JSON.parse(fields.title), 'Suzuki 偶联');
  assert.equal(fields.locked, 'true', 'locked 是布尔，不能被引号包起来');
  assert.equal(fields.type, 'reaction');
});

test('a molfile with newlines survives the YAML round trip and does not break the fence', () => {
  const { vault, uid, path: rel } = makeVault();
  const molfile = '\n  Ketcher\n\n  2  1  0  0\n    0.0000    0.0000    0.0000 C\nM  END';
  CH.insertChem(vault, { experiment_uid: uid, smiles: 'CC', molfile });
  const note = readNote(vault, rel);
  const fence = /```scholarium-chem\n([\s\S]*?)\n```/.exec(note);
  const line = /^molfile:\s*(.*)$/m.exec(fence[1]);
  assert.equal(JSON.parse(line[1]), molfile.trim(), '换行必须以 \\n 转义的形式无损往返');
  assert.equal((note.match(/```/g) || []).length, 2, '围栏标记只能有开合两处');
});

test('frontmatter is filled only when empty, and a researcher-set value is reported as skipped', () => {
  const { vault, uid, path: rel } = makeVault();
  CH.insertChem(vault, { experiment_uid: uid, reaction_smiles: ETHYLBENZENE });
  assert.equal(S.parseObject(readNote(vault, rel)).object.reaction_smiles, ETHYLBENZENE);

  const other = 'CCI.OB(O)c1ccccc1>>CCc1ccccc1';
  const out = CH.insertChem(vault, { experiment_uid: uid, reaction_smiles: other });
  assert.deepEqual(out.frontmatter_updated, [], '已有值时不写 frontmatter');
  assert.deepEqual(out.frontmatter_skipped, ['reaction_smiles']);
  assert.equal(S.parseObject(readNote(vault, rel)).object.reaction_smiles, ETHYLBENZENE, '研究员的值不能被覆盖');
});

test('the researcher-authored body is preserved, and each call appends one more block', () => {
  const { vault, uid, path: rel } = makeVault();
  const record = X.loadAll(vault).find((e) => e.object.uid === uid);
  X.saveExisting(vault, record.path, record.object, { body: '# 手写正文\n\n这段不能被吃掉。\n' });

  CH.insertChem(vault, { experiment_uid: uid, smiles: 'c1ccccc1' });
  CH.insertChem(vault, { experiment_uid: uid, smiles: 'CCO' });
  const note = readNote(vault, rel);
  assert.match(note, /这段不能被吃掉。/);
  assert.equal((note.match(/```scholarium-chem/g) || []).length, 2);
});

// 这两条是实测踩出来的，不是补的形式测试：块原本直接接在正文末尾，而生成的
// 实验正文正好以空的 "## 结论" 收尾，于是 recoverStructuredFields 把整个化学块
// 当成 conclusion 回填进了 frontmatter。
test('the block lands in its own "## 化学结构" section, never inside the trailing 结论 section', () => {
  const { vault, uid, path: rel } = makeVault();
  CH.insertChem(vault, { experiment_uid: uid, reaction_smiles: ETHYLBENZENE });
  const object = S.parseObject(readNote(vault, rel)).object;
  assert.ok(!String(object.conclusion || '').includes('scholarium-chem'), '化学块绝不能进 conclusion');
  assert.ok(!String(object.result || '').includes('scholarium-chem'), '化学块绝不能进 result');
  assert.match(S.parseObject(readNote(vault, rel)).body, /\n## 化学结构\n/);

  // 第二个块进同一个小节，不再重复加标题。
  CH.insertChem(vault, { experiment_uid: uid, smiles: 'CCO' });
  const body = S.parseObject(readNote(vault, rel)).body;
  assert.equal((body.match(/## 化学结构/g) || []).length, 1);
});

test('an empty "## 结果" section no longer swallows the rest of the note into result', () => {
  const { vault, uid, path: rel } = makeVault();
  // 只要读一遍记录（append_note / transition 都会做）就会触发字段恢复。
  const entry = X.loadAll(vault).find((e) => e.object.uid === uid);
  const recovered = X.readRecord(vault, entry).object;
  assert.equal(recovered.result || '', '', '空小节必须恢复成空，不能把下一个标题当成结果');
  assert.equal(recovered.conclusion || '', '');
  assert.ok(rel);
});

test('re-inserting the same structure is a noop unless allow_duplicate is set', () => {
  const { vault, uid, path: rel } = makeVault();
  CH.insertChem(vault, { experiment_uid: uid, reaction_smiles: ETHYLBENZENE });
  const again = CH.insertChem(vault, { experiment_uid: uid, reaction_smiles: ETHYLBENZENE });
  assert.equal(again.noop, true);
  assert.equal(again.reason, 'structure_already_present');
  assert.equal((readNote(vault, rel).match(/```scholarium-chem/g) || []).length, 1);

  CH.insertChem(vault, { experiment_uid: uid, reaction_smiles: ETHYLBENZENE, allow_duplicate: true });
  assert.equal((readNote(vault, rel).match(/```scholarium-chem/g) || []).length, 2);
});

test('bad input is refused rather than written as a structure nobody can draw', () => {
  const { vault, uid } = makeVault();
  const rejects = [
    [{}, /experiment_uid_required/],
    [{ experiment_uid: uid }, /chem_structure_required/],
    // 一条被误填进反应字段的普通分子会被渲染端当成反应画出来，是错的。
    [{ experiment_uid: uid, reaction_smiles: 'c1ccccc1' }, /reaction_smiles_must_contain_reaction_arrow/],
    // Agent 把一整句自然语言塞进结构字段的典型表现就是空格。
    [{ experiment_uid: uid, smiles: '苯 c1ccccc1' }, /smiles_must_not_contain_whitespace/],
    [{ experiment_uid: uid, smiles: 'CC', type: 'polymer' }, /unknown_chem_type/],
    [{ experiment_uid: uid, smiles: 'CC', format: 'cml' }, /unknown_chem_format/],
    // 围栏标记会把代码块提前截断，让后面的正文变成乱码。
    [{ experiment_uid: uid, smiles: 'CC', molfile: 'x\n```\ny' }, /molfile_must_not_contain_code_fence/],
    [{ experiment_uid: S.uuidV7(), smiles: 'CC' }, /experiment_not_found/],
  ];
  for (const [input, pattern] of rejects) {
    assert.throws(() => CH.insertChem(vault, input), pattern, JSON.stringify(input));
  }
});

test('the chemistry gate reports structure validity and atom/charge balance', { skip: chemistrySkip }, () => {
  const { vault } = makeVault();
  const balanced = CH.validateChem(vault, { reaction_smiles: 'O.O>>[H][H].[H][H].O=O' });
  assert.equal(balanced.valid, true);
  assert.equal(balanced.status, 'balanced');
  const unbalanced = CH.validateChem(vault, { reaction_smiles: 'O.O>>O=O' });
  assert.equal(unbalanced.valid, true, '结构能解析，但仍须单独报告守恒失败');
  assert.equal(unbalanced.status, 'unbalanced');
  assert.ok(unbalanced.element_delta.H);
});

test('strict chemistry insertion refuses an unbalanced equation and accepts a balanced one', { skip: chemistrySkip }, () => {
  const { vault, uid } = makeVault();
  assert.throws(
    () => CH.insertChem(vault, { experiment_uid: uid, reaction_smiles: 'O.O>>O=O', strict_validation: true }),
    /reaction_not_balanced/,
  );
  const out = CH.insertChem(vault, {
    experiment_uid: uid,
    reaction_smiles: 'O.O>>[H][H].[H][H].O=O',
    strict_validation: true,
  });
  assert.equal(out.chemistry_status, 'validated_balanced');
});

test('the action is registered as an L1 write that cannot run without explicit confirmation', () => {
  assert.equal(registry.describe('experiment.validate_chem').level, 'L0');
  assert.equal(registry.describe('experiment.validate_chem').requires_confirmation, false);
  const described = registry.describe('experiment.insert_chem');
  assert.equal(described.level, 'L1');
  assert.equal(described.requires_confirmation, true);

  const { vault, uid } = makeVault();
  assert.throws(
    () => registry.run(vault, 'experiment.insert_chem', { experiment_uid: uid, smiles: 'CC' }, { dryRun: false }),
    /explicit_confirmation_required/,
  );
  const manifest = registry.run(vault, 'experiment.insert_chem',
    { experiment_uid: uid, smiles: 'CC' }, { dryRun: false, confirmed: true, by: 'agent:research-weaver' });
  assert.equal(manifest.action, 'experiment.insert_chem');
  assert.equal(manifest.actor, 'agent:research-weaver');
  // 每次真实执行都要在 Research/_runs/actions/ 留下审计记录。
  const runs = fs.readdirSync(path.join(vault, 'Research', '_runs', 'actions'));
  assert.ok(runs.some((name) => name.includes('experiment-insert_chem')), runs.join(','));
});
