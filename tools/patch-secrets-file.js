"use strict";
/* Idempotent: inserts the unified secrets-file helper and its three hooks. */
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const MAIN = path.join(ROOT, "main.js");
const BEGIN = "/* SCHOLARIUM_SECRETS_FILE_BEGIN */";
const END = "/* SCHOLARIUM_SECRETS_FILE_END */";
const HOOKS = [
  ["var wi = class extends Eo.Plugin {\n", null, "helper"],
  ["  async loadSettings() {\n    var n, a;\n", "    schSecretsFile.install(this);\n", "loadSettings"],
  ["    e.empty(), e.addClass(\"scholarium-settings\");\n", "    schSecretsFile.renderSettingsBox(e, this.plugin);\n", "settings tab"],
];
function count(text, needle) { return text.split(needle).length - 1; }
function patch() {
  let text = fs.readFileSync(MAIN, "utf8");
  const start = text.indexOf(BEGIN), finish = text.indexOf(END);
  if ((start >= 0) !== (finish >= 0)) throw new Error("密钥文件标记不完整");
  if (start >= 0) { let tail = finish + END.length; if (text[tail] === "\n") tail++; text = text.slice(0, start) + text.slice(tail); }
  const helper = fs.readFileSync(path.join(__dirname, "secrets-file.jsfrag"), "utf8").trimEnd();
  for (const [anchor, line, label] of HOOKS) {
    if (count(text, anchor) !== 1) throw new Error(`${label} 锚点不是恰好一处，拒绝修改`);
    if (line === null) text = text.replace(anchor, `${BEGIN}\n${helper}\n${END}\n${anchor}`);
    else if (!text.includes(anchor + line)) text = text.replace(anchor, anchor + line);
  }
  // 统一密钥文件新增的设置默认值（OpenAlex、密钥文件位置）。
  for (const [anchor, insert, before] of [
    ["    mineruApiKey: \"\",\n", "    openalexApiKey: \"\",\n    openalexEmail: \"\",\n", true],
    ["    rssAiPrompt: \"\",\n", "    secretsFilePath: \"\",\n", false],
  ]) {
    if (text.includes(before ? insert + anchor : anchor + insert)) continue;
    if (count(text, anchor) !== 1) throw new Error("设置默认值锚点不是恰好一处");
    text = text.replace(anchor, before ? insert + anchor : anchor + insert);
  }
  fs.writeFileSync(MAIN, text, "utf8");
  return { bytes: Buffer.byteLength(text), regions: count(text, BEGIN) };
}
if (require.main === module) process.stdout.write(JSON.stringify(patch(), null, 2) + "\n");
module.exports = { patch, BEGIN, END };
