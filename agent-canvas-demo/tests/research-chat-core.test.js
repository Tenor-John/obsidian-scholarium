const test = require('node:test');
const assert = require('node:assert/strict');
const { conversationExcerpt, researchQuestionCoachProtocol, buildResearchChatPrompt, projectContextBlock } = require('../research-chat-core.js');

test('conversation excerpt preserves prior turns and removes only the duplicated current turn', () => {
  const messages = [
    { role: 'user', text: '黑色沉淀是什么？' },
    { role: 'agent', text: '当前优先考虑金属铋，也要排查金团聚。' },
    { role: 'system', text: '不应进入科研上下文' },
    { role: 'user', text: 'Au 使用 11-MUA 配体。' },
  ];
  const text = conversationExcerpt(messages, 'Au 使用 11-MUA 配体。');
  assert.match(text, /黑色沉淀是什么/);
  assert.match(text, /当前优先考虑金属铋/);
  assert.doesNotMatch(text, /不应进入科研上下文/);
  assert.equal((text.match(/11-MUA/g) || []).length, 0);
});

test('research prompt requires contextual revision, targeted search and explicit Pipeline authorization', () => {
  const prompt = buildResearchChatPrompt({
    message: 'Au 使用 11-MUA 配体。',
    messages: [
      { role: 'user', text: '黑色沉淀是什么？' },
      { role: 'agent', text: '先考虑 Bi0。' },
      { role: 'user', text: 'Au 使用 11-MUA 配体。' },
    ],
    taskGoal: '诊断水热合成异常',
    workspace: 'F:/vault/topic',
    ragBlock: '文献库命中：一条相关记录',
    capabilities: '只读能力清单',
  });
  assert.match(prompt, /基于新信息，我修正上一轮判断/);
  assert.match(prompt, /一个短而明确的检索问题/);
  assert.match(prompt, /只有研究员明确要求系统综述、批量检索或运行完整链条/);
  assert.match(prompt, /黑色沉淀是什么/);
  assert.match(prompt, /Au 使用 11-MUA 配体/);
  assert.match(prompt, /全文已核实/);
  assert.match(prompt, /只读能力清单/);
});

test('capabilities precede large contextual blocks and are retained in full', () => {
  const capabilities = `CAPABILITY-START\n${'c'.repeat(6000)}\nCAPABILITY-END\nGET http://127.0.0.1/v1/scholarium/rescan-checkpoint-mark`;
  const projectBlock = `PROJECT-START\n${'p'.repeat(30000)}\nPROJECT-END`;
  const prompt = buildResearchChatPrompt({ message: '早上好', capabilities, projectBlock, memoryBlock: 'MEMORY', ragBlock: 'RAG' });
  assert.match(prompt, /CAPABILITY-START/);
  assert.match(prompt, /CAPABILITY-END/);
  assert.match(prompt, /rescan-checkpoint-mark/);
  assert.ok(prompt.indexOf('CAPABILITY-START') < prompt.indexOf('PROJECT-START'));
  assert.ok(prompt.indexOf('CAPABILITY-END') < prompt.indexOf('PROJECT-START'));
});

// Regression for the 2026-08-23 "五条 task_add 排不进今日时间轴" incident:
// the model chose workspace.task_add (no time) for a request that meant a
// scheduled plan, so nothing showed up in the workbench's timeline view.
// Rule 12 must tell it to use workspace.timeblock_add for time-scheduled
// asks, ground multi-day plans in project.get/experiment.scan_outcomes
// instead of generic knowledge, and allow multiple dated blocks per reply.
test('prompt instructs the model to schedule with timeblock_add (not task_add) and ground multi-day plans in project state', () => {
  const prompt = buildResearchChatPrompt({ message: '帮我设计下周的实验安排', capabilities: '' });
  assert.match(prompt, /workspace\.timeblock_add/);
  assert.match(prompt, /workspace\.task_add/);
  assert.match(prompt, /project\.get/);
  assert.match(prompt, /experiment\.scan_outcomes/);
  assert.match(prompt, /覆盖多天的多个 workspace\.timeblock_add/);
});

test('authoritative project context is injected, while an unbound or failed lookup is explicitly unverified', () => {
  const state = { project: { display_id: 'PRJ-002' }, experiments: [{ display_id: 'EXP-009', status: 'designed' }] };
  const block = projectContextBlock('PRJ-002', state, { counts: { planned: 4 } });
  const prompt = buildResearchChatPrompt({ message: '继续上次那个课题', projectBlock: block });
  assert.match(prompt, /项目状态（Bridge L0 实读）/);
  assert.match(prompt, /EXP-009/);
  assert.match(prompt, /不得用工作目录下的局部 Glob\/Grep 覆盖它/);
  assert.match(projectContextBlock('', null, null), /未验证/);
  assert.match(projectContextBlock('PRJ-002', null, null, 'Bridge offline'), /不得断言任何记录不存在/);
});

// 2026-08-28 发布冲刺项3实测发现的 P0（真实根因是 /v1/drafts/batch 里由
// AI 起草的 EXP 记录，不是 main.js 原生"新建实验"弹窗——后者的
// tools/experiment-store.js saveNew() 早就有防御性默认值，见
// tests/experiment-data-provenance.test.js）：模型此前完全没有被告知
// data_origin/data_recorded_by/data_recorded_at 这三个字段的存在，遇到
// 研究员提到数据来源时，模型会照着其它字段的填法把这三个也一起写上——
// 但 data_recorded_by 只有 "user" 合法，模型永远给不出这个值，草稿在
// preview 阶段会被 schema 校验拒绝（本轮已修的 /v1/drafts/batch 校验），
// 或者更早的、没有该校验的 Bridge 进程上会先写入成功、直到下一次
// experiment.transition 才因为同一批 validateObject 规则炸掉——两种情况
// 研究员看到的都是一次跟"我刚才明明保存成功了"矛盾的莫名失败。
test('prompt forbids the model from ever setting data_origin/data_recorded_by/data_recorded_at on an EXP draft', () => {
  const prompt = buildResearchChatPrompt({ message: '帮我把这个实验设计保存成正式记录', capabilities: '' });
  assert.match(prompt, /绝不要自己填 data_origin \/ data_recorded_by \/ data_recorded_at/);
  assert.match(prompt, /只能由研究员本人通过原生"补充数据来源"编辑器逐条确认/);
  assert.match(prompt, /data_recorded_by 必须等于 "user"/);
});

// 2026-08-26: 时间块 ↔ 实验正式关联——排期规则必须要求 experiment_uid，
// 且漂移检查结果要作为项目状态事实源的一部分注入，未读取和"零漂移"必须
// 是两种不同的措辞，否则模型会把"这轮没查"读成"查了，很干净"。
test('prompt tells the model to link timeblocks with experiment_uid, not just prose in note', () => {
  const prompt = buildResearchChatPrompt({ message: '帮我把下周的表征安排写进日程', capabilities: '' });
  assert.match(prompt, /experiment_uid/);
  assert.match(prompt, /experiment_display_id/);
  assert.match(prompt, /不产生关联/);
});

// 2026-08-26: 执行回填——研究员告诉模型某个已排期时间块的完成情况后，模型
// 应该写回 execution_status/execution_note。
// 2026-08-27 发布冲刺项2起，experiment.transition 已经接通（走
// /v1/edits/experiment-transition 两阶段确认，不经 Obsidian 队列，见
// server.js 与 shell-ui.js 的 executeScholariumActions 特判分支）。提示词
// 不再说"没打通"，而是教模型这条通道自己的约束：单步状态迁移（不能跳级）、
// reason 必填、犹豫时宁可只 append_note 不要替研究员做决定。
test('prompt tells the model how to backfill execution status and append an experiment log', () => {
  const prompt = buildResearchChatPrompt({ message: '昨天那个实验做完了，产率还不错', capabilities: '' });
  assert.match(prompt, /execution_status/);
  assert.match(prompt, /execution_note/);
  assert.match(prompt, /experiment\.append_note/);
});

test('prompt tells the model experiment.transition is wired via the two-stage /v1/edits confirmation, not the Obsidian queue', () => {
  const prompt = buildResearchChatPrompt({ message: '这批数据出来了，该推进状态了', capabilities: '' });
  assert.match(prompt, /experiment\.transition \{experiment_uid, to_status, reason\}/);
  assert.match(prompt, /这条通道已经接通/);
  assert.match(prompt, /不经 Obsidian 队列/);
});

test('prompt constrains experiment.transition to a single lifecycle step with a mandatory reason', () => {
  const prompt = buildResearchChatPrompt({ message: '这批数据出来了，该推进状态了', capabilities: '' });
  assert.match(prompt, /一次只能走一步，不能跳级/);
  assert.match(prompt, /reason 必填/);
});

test('prompt tells the model to default to append_note (not transition) when unsure the researcher made a real status call', () => {
  const prompt = buildResearchChatPrompt({ message: '这批数据出来了，该推进状态了', capabilities: '' });
  assert.match(prompt, /不确定当前状态或研究员的话是否够格构成一次正式的状态判断时，宁可只做 append_note/);
  assert.match(prompt, /不要替研究员做这个决定/);
});

// 2026-08-26: 决策持久化——研究员把结论定为最终结果时，模型应输出一个
// decision 型 scholarium-draft，字段和 EXP/HYP 那条 §7 draft 通道不同
// （没有 review_status/verified_by_user，但 rationale 必填、relates_to 必须
// 是真 uid），必须在提示词里单独讲清楚，不能指望模型套用 EXP/HYP 的模板。
test('prompt tells the model how to persist a finalized decision as a scholarium-draft', () => {
  const prompt = buildResearchChatPrompt({ message: '这个实验这周先不排了，记一条决策', capabilities: '' });
  assert.match(prompt, /type: decision/);
  assert.match(prompt, /DEC-NNN/);
  assert.match(prompt, /rationale（依据/);
  assert.match(prompt, /relates_to/);
  assert.match(prompt, /不得编造/);
});

test('prompt tells the model to check existing decisions before proposing a new schedule', () => {
  const prompt = buildResearchChatPrompt({ message: '下周怎么安排', capabilities: '' });
  assert.match(prompt, /decisions 数组/);
  assert.match(prompt, /trigger_condition 现在已经满足/);
});

// 2026-08-26: M4 全量回扫——聊天在会话第一条消息时应该主动查
// workspace.rescan_pending（不限于当前绑定课题），并且知道要用
// workspace.get_state 的 tasks 去重，不能每次打开对话都重复生成同一批任务。
test('prompt tells the model to rescan the whole vault on the first turn of a session', () => {
  const prompt = buildResearchChatPrompt({ message: '早上好', capabilities: '' });
  assert.match(prompt, /workspace\.rescan_pending/);
  assert.match(prompt, /暂无此前对话/);
  assert.match(prompt, /RESCAN-TB/);
  assert.match(prompt, /RESCAN-DEC/);
});

test('prompt tells the model to dedup rescan proposals against existing tasks instead of repeating every session', () => {
  const prompt = buildResearchChatPrompt({ message: '早上好', capabilities: '' });
  assert.match(prompt, /workspace\.get_state \{"section":"tasks"\}/);
  assert.match(prompt, /不要重复生成/);
});

// 2026-08-26: M4 第二步——回扫节流。due 是服务端算好的唯一判据，模型不该
// 自己心算日期；due 为 true 时提议完还要调用记账端点重置计时，否则下次还
// 是会判 due，节流形同虚设。
test('prompt gates the rescan on the server-computed due flag and forbids self-computed dates', () => {
  const prompt = buildResearchChatPrompt({ message: '早上好', capabilities: '' });
  assert.match(prompt, /due 为 false/);
  assert.match(prompt, /due 为 true/);
  assert.match(prompt, /不要自己算日期/);
  assert.match(prompt, /cadence_days/);
});

test('prompt tells the model to reset the rescan checkpoint after a due-triggered proposal cycle, not otherwise', () => {
  const prompt = buildResearchChatPrompt({ message: '早上好', capabilities: '' });
  assert.match(prompt, /rescan-checkpoint-mark/);
  assert.match(prompt, /不需要研究员确认/);
  assert.match(prompt, /这个端点只在 due 为 true 这一分支里才允许调用/);
});

// 2026-08-26 M5 步骤1：经验候选提取——只在研究员明确要求总结经验/规律时才
// 做，绝不能挂在会话首条消息的规则16回扫里，也不能凭一次巧合就下结论。
test('prompt only extracts lesson candidates when the researcher explicitly asks for a summary, not on session start', () => {
  const prompt = buildResearchChatPrompt({ message: '这类实验有什么共性问题', capabilities: '' });
  assert.match(prompt, /只在研究员明确要求总结经验/);
  assert.match(prompt, /不要在没人问的时候主动提炼/);
  assert.match(prompt, /不能自己决定研究员现在需要一条经验总结/);
});

test('prompt requires independent, multi-source evidence before drafting a lesson — one coincidence is not a lesson', () => {
  const prompt = buildResearchChatPrompt({ message: '总结一下最近的经验教训', capabilities: '' });
  assert.match(prompt, /同一现象只出现一次就写经验草稿，几乎总是把巧合当规律/);
  assert.match(prompt, /目前只看到一次，样本不够，还不构成经验/);
});

test('prompt spells out the lesson draft frontmatter: type, evidence_refs (real uids only), source_types, scope', () => {
  const prompt = buildResearchChatPrompt({ message: '有没有什么规律', capabilities: '' });
  assert.match(prompt, /type: lesson/);
  assert.match(prompt, /LES-NNN/);
  assert.match(prompt, /evidence_refs（真实 uid 数组/);
  assert.match(prompt, /source_types（数组，只能是 execution_backfill \/ drift_audit \/ decision/);
  assert.match(prompt, /scope（适用范围/);
  assert.match(prompt, /不确定边界多宽时宁可写窄一点，不要默认普适/);
});

test('prompt forbids treating a just-confirmed lesson as an unquestioned premise in later turns', () => {
  const prompt = buildResearchChatPrompt({ message: '总结一下经验', capabilities: '' });
  assert.match(prompt, /不代表你可以据此改变后续的排期\/建议策略/);
  assert.match(prompt, /不要因为"自己刚提出过这条经验"就在后续对话里把它当成不言自明的前提反复强化/);
});

test('projectContextBlock folds drift findings into the same L0 fact source, distinguishing "not fetched" from "clean"', () => {
  const state = { project: { display_id: 'PRJ-002' }, experiments: [] };
  const withFindings = projectContextBlock('PRJ-002', state, {}, '', { findings: [{ id: 't1', flags: ['blocked', 'unreviewed'] }] });
  assert.match(withFindings, /时间块↔实验漂移检查/);
  assert.match(withFindings, /blocked/);

  const cleanAudit = projectContextBlock('PRJ-002', state, {}, '', { findings: [] });
  assert.match(cleanAudit, /当前没有已关联实验的时间块存在漂移/);

  const notFetched = projectContextBlock('PRJ-002', state, {}, '', null);
  assert.match(notFetched, /本轮未读取/);
  assert.doesNotMatch(notFetched, /当前没有已关联实验的时间块存在漂移/);
});

test('conversation excerpt is bounded for long-running topic chats', () => {
  const messages = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'agent' : 'user', text: `${i}-` + 'x'.repeat(800) }));
  const text = conversationExcerpt(messages, 'new', 14, 4000);
  assert.ok(text.length <= 5000);
  assert.doesNotMatch(text, /^研究员：0-/);
  assert.match(text, /39-/);
});

test('question coach operationalizes QFT, PICOT, FINER, falsification and a persistent project skeleton', () => {
  const protocol = researchQuestionCoachProtocol();
  assert.match(protocol, /What（发生什么）、Why（为何发生）、How（如何调控）/);
  assert.match(protocol, /PICOT/);
  assert.match(protocol, /FINER/);
  assert.match(protocol, /我可能错了/);
  assert.match(protocol, /谁在乎/);
  assert.match(protocol, /当前课题骨架/);
  assert.match(protocol, /一页课题声明/);
});
