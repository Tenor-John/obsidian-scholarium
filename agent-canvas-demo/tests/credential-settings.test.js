"use strict";
/**
 * 凭据设置：校验、掩码回显、env 注入。
 *
 * 三个互相独立、但叠在一起才造成"配了等于没配"的问题：
 *
 *   1. Semantic Scholar 的校验是 /^[A-Za-z0-9]{20,}$/，不允许连字符，而现行
 *      key 形如 s2k-XXXX…，合法 key 直接被判非法、存不进去；
 *   2. 保存成功后 input.value = ''，字段看起来跟从没填过一样，和"校验静默失败"
 *      在肉眼上无法区分；
 *   3. Bridge 只把 MINERU_API_KEY / HF_TOKEN 注入 skill 环境，注册表里其余五个
 *      即使存好了 skill 也读不到——而 api_resolver.js 的约定是"key 缺失就静默
 *      跳过该数据源"，于是检索安静地少几个源，没有任何报错。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../settings-core.js");
const root = path.join(__dirname, "..");
const ui = fs.readFileSync(path.join(root, "settings-ui.js"), "utf8");
const server = fs.readFileSync(path.join(root, "bridge", "server.js"), "utf8");
const validatorFor = (envVar) => core.CREDENTIAL_REGISTRY.find((c) => c.envVar === envVar).validate;

/* ── 校验：拦手滑，不替服务方定义合法 ──────────────────────────────── */

test("Semantic Scholar 接受 s2k- 前缀的 key", () => {
  const v = validatorFor("SEMANTIC_SCHOLAR_API_KEY");
  assert.equal(v("s2k-" + "A1b2C3d4E5f6G7h8J9k0"), true, "带连字符的现行格式必须能存进去");
  assert.equal(v("A".repeat(40)), true, "旧的纯字母数字格式仍然接受");
  assert.equal(v("abc" + "_" + "D".repeat(20)), true);
});

test("Semantic Scholar 仍然拦得住明显的手滑", () => {
  const v = validatorFor("SEMANTIC_SCHOLAR_API_KEY");
  assert.notEqual(v(""), true, "空值");
  assert.notEqual(v("s2k-abc"), true, "粘贴不全");
  assert.notEqual(v("有中文的值也不该通过还要够长够长够长"), true);
  assert.notEqual(v("has space " + "A".repeat(30)), true, "含空格通常是复制多了");
});

test("邮箱类凭据仍按邮箱校验，没被这次放宽波及", () => {
  assert.equal(validatorFor("UNPAYWALL_EMAIL")("a@b.co"), true);
  assert.notEqual(validatorFor("UNPAYWALL_EMAIL")("not-an-email"), true);
  assert.equal(validatorFor("OPENALEX_EMAIL")("x@y.org"), true);
});

test("掩码只露头尾，短值全遮", () => {
  assert.equal(core.maskSecret("s2k-ABCDEFGHIJKLMNOP"), "s2k-••••MNOP");
  assert.equal(core.maskSecret("short"), "••••");
  assert.equal(core.maskSecret(""), "");
});

/* ── env 注入：注册表是唯一事实来源 ───────────────────────────────── */

test("注册表里每一个 envVar 都会被注入 skill 环境", () => {
  // 按注册表遍历而不是逐个手写：漏注入不会报错，只会安静地少干活。
  assert.match(server, /for \(const item of settingsCore\.CREDENTIAL_REGISTRY\) \{\s*\n\s*credentialEnv\[item\.envVar\] = resolveSecret\(item\.envVar, item\.legacyConfigField\)\?\.value \|\| '';/);
  assert.match(server, /\.\.\.credentialEnv,/);
});

test("不再只挑 MINERU/HF 两个硬编码注入", () => {
  const block = server.slice(server.indexOf("const credentialEnv = {}"), server.indexOf("SCHOLARIUM_RAG_MODEL"));
  assert.doesNotMatch(block, /MINERU_API_KEY:/, "又出现硬编码逐个注入，新增凭据时必然再次漏掉");
  assert.doesNotMatch(block, /HF_TOKEN:/);
});

test("注册表覆盖了检索链路实际会读的那些变量", () => {
  const declared = new Set(core.CREDENTIAL_REGISTRY.map((c) => c.envVar));
  for (const envVar of ["SEMANTIC_SCHOLAR_API_KEY", "SCOPUS_API_KEY", "UNPAYWALL_EMAIL", "OPENALEX_EMAIL", "NCBI_API_KEY"]) {
    assert.ok(declared.has(envVar), `${envVar} 不在注册表里，就永远不会被注入`);
  }
});

/* ── 明文回读端点 ───────────────────────────────────────────────────── */

test("列表端点只给掩码，明文走单独端点", () => {
  const list = server.slice(
    server.indexOf("if (req.method === 'GET' && url.pathname === '/v1/settings/credentials')"),
    server.indexOf("if (req.method === 'POST' && url.pathname === '/v1/settings/credentials')"));
  assert.match(list, /credentialStatus/);
  assert.doesNotMatch(list, /value: found\.value/, "列表端点不得下发明文——它是打开设置页就会调的");
  assert.match(server, /'\/v1\/settings\/credentials\/reveal'/);
});

test("明文端点只认注册表内的 envVar，且未配置时 404", () => {
  const block = server.slice(
    server.indexOf("'/v1/settings/credentials/reveal'"),
    server.indexOf("'/v1/settings/credentials/migrate'"));
  assert.match(block, /CREDENTIAL_REGISTRY\.find\(\(c\) => c\.envVar === String\(input\.envVar \|\| ''\)\)/,
    "不校验就成了任意环境变量读取器");
  assert.match(block, /unknown credential envVar/);
  assert.match(block, /return send\(res, 404, \{ error: 'credential is not configured' \}\)/);
});

/* ── UI 行为 ────────────────────────────────────────────────────────── */

test("保存后不再清空输入框", () => {
  const handler = ui.slice(ui.indexOf("save.addEventListener"), ui.indexOf("const apply = document.createElement"));
  assert.doesNotMatch(handler, /input\.value = ''/, "清空会让'已保存'和'静默失败'看起来一模一样");
  assert.match(handler, /await loadCredentials\(\)/, "重新加载后卡片应以已配置+掩码重建");
});

test("已配置时输入框显示掩码，并有眼睛按钮", () => {
  assert.match(ui, /const setMasked = \(\) => \{/);
  assert.match(ui, /input\.value = item\.configured \? item\.masked : ''/);
  assert.match(ui, /const eye = document\.createElement\('button'\)/);
  assert.match(ui, /row\.append\(input, eye, save, apply\)/);
  assert.match(ui, /setMasked\(\);/);
});

test("掩码不会被当成新值提交", () => {
  // 掩码本身不是密钥；留在框里点保存会把 "s2k-••••MNOP" 存进去。
  assert.match(ui, /input\.addEventListener\('focus'[\s\S]{0,200}input\.dataset\.masked === 'true'[\s\S]{0,80}input\.value = ''/);
});

test("眼睛按钮按需单取明文，未配置时禁用", () => {
  assert.match(ui, /'\/v1\/settings\/credentials\/reveal'/);
  assert.match(ui, /body: JSON\.stringify\(\{ envVar: item\.envVar \}\)/);
  assert.match(ui, /eye\.disabled = !item\.configured/);
  assert.match(ui, /input\.dataset\.revealed === 'true'/, "再次点击应收回明文");
});
