import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = path.join(root, "main.js");
const main = fs.readFileSync(mainPath, "utf8");

const forbidden = [
  { label: "动态 script 元素", pattern: /(?:createElement|createEl)\s*\(\s*["'`]script["'`]/gi },
  { label: "PaperScript 运行时", pattern: /PaperScript|Paperscript|text\/paperscript/g },
  { label: "eval 代码执行", pattern: /\beval\s*\(/g },
  { label: "Function 构造器代码生成", pattern: /\bnew\s+Function\s*\(|\bFunction\s*\(\s*["'`]/g },
];

const failures = [];
for (const { label, pattern } of forbidden) {
  for (const match of main.matchAll(pattern)) {
    const index = match.index ?? 0;
    const line = main.slice(0, index).split("\n").length;
    failures.push(`${label}: main.js:${line}: ${match[0]}`);
  }
}

if (/\bprevious-release-main\.js\b/.test(main)) {
  failures.push("发布包引用了 previous-release-main.js");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`release bundle static check passed (${Buffer.byteLength(main)} bytes)`);
}
