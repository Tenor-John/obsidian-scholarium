"use strict";
/* Idempotent: inserts runtime diagnosis helpers and routes runtime errors through them. */
const fs = require("node:fs");
const path = require("node:path");
const MAIN = path.join(path.resolve(__dirname, ".."), "main.js");
const BEGIN = "/* SCHOLARIUM_RUNTIME_DIAGNOSIS_BEGIN */";
const END = "/* SCHOLARIUM_RUNTIME_DIAGNOSIS_END */";
function count(text, needle) { return text.split(needle).length - 1; }
const REPLACEMENTS = [
  [
    "    throw new Error(`Scholarium core runtime ${SCH_RUNTIME_RELEASE.version} 正在安装或尚未就绪；请稍候后重试`);\n",
    "    throw new Error(schRuntimeExplain(new Error(`Scholarium 本机运行时 ${SCH_RUNTIME_RELEASE.version} 没有就绪`)));\n",
    "证据工具运行时提示",
  ],
  [
    "      try {\n        return await starting;\n      } finally {\n        runtime.startingByScope.delete(ports.scope);\n      }\n",
    "      try {\n        return await starting;\n      } catch (error) {\n        // 原样的 “Failed to fetch” 对用户没有意义：附上诊断和修复步骤。\n        throw new Error(schRuntimeExplain(error));\n      } finally {\n        runtime.startingByScope.delete(ports.scope);\n      }\n",
    "连接运行时错误说明",
  ],
  [
    "    schSecretsFile.install(this);\n",
    "    schSecretsFile.install(this);\n    this.addCommand({ id: \"diagnose-runtime\", name: \"诊断本机运行时\", callback: () => schOpenRuntimeDiagnosis(this.app) });\n",
    "诊断命令",
  ],
];
function patch() {
  let text = fs.readFileSync(MAIN, "utf8");
  const start = text.indexOf(BEGIN), finish = text.indexOf(END);
  if ((start >= 0) !== (finish >= 0)) throw new Error("运行时诊断标记不完整");
  if (start >= 0) { let tail = finish + END.length; if (text[tail] === "\n") tail++; text = text.slice(0, start) + text.slice(tail); }
  const anchor = "function schRuntimeLaunchSpec(plugin, state) {\n";
  if (count(text, anchor) !== 1) throw new Error("运行时诊断锚点不是恰好一处");
  const helper = fs.readFileSync(path.join(__dirname, "runtime-diagnosis.jsfrag"), "utf8").trimEnd();
  text = text.replace(anchor, `${BEGIN}\n${helper}\n${END}\n${anchor}`);
  for (const [needle, value, label] of REPLACEMENTS) {
    if (text.includes(value)) continue;
    if (count(text, needle) !== 1) throw new Error(`${label} 锚点不是恰好一处`);
    text = text.replace(needle, value);
  }
  fs.writeFileSync(MAIN, text, "utf8");
  return { bytes: Buffer.byteLength(text) };
}
if (require.main === module) process.stdout.write(JSON.stringify(patch()) + "\n");
module.exports = { patch, BEGIN, END };
