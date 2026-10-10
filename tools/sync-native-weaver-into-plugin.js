"use strict";
/*
 * 把 worktree main.js 里的“原生织研者”区块（以及样式区块）替换进一个已安装插件的
 * main.js / styles.css，其余内容（例如内置运行时包）原样保留。
 *
 *   node tools/sync-native-weaver-into-plugin.js "D:\scholarium-v2-testvault\.obsidian\plugins\obsidian-scholarium"
 *
 * 同时给实验记录看板打上“显示全部笔记段落”的补丁。
 * 写之前会备份为 main.js.bak / styles.css.bak。
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const target = process.argv[2] || "D:\\scholarium-v2-testvault\\.obsidian\\plugins\\obsidian-scholarium";
const REGIONS = {
  "main.js": ["/* SCHOLARIUM_NATIVE_WEAVER_EMBED_BEGIN */", "/* SCHOLARIUM_NATIVE_WEAVER_EMBED_END */"],
};

function swap(file, begin, end) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const destPath = path.join(target, file);
  const dest = fs.readFileSync(destPath, "utf8");
  const si = source.indexOf(begin), sj = source.indexOf(end);
  const di = dest.indexOf(begin), dj = dest.indexOf(end);
  if (si < 0 || sj < si) throw new Error(`worktree ${file} 里没有完整的区块 ${begin}`);
  if (di < 0 || dj < di) throw new Error(`${destPath} 里没有完整的区块 ${begin}`);
  const next = dest.slice(0, di) + source.slice(si, sj + end.length) + dest.slice(dj + end.length);
  if (next === dest) return `${file}：已是最新`;
  fs.copyFileSync(destPath, destPath + ".bak");
  fs.writeFileSync(destPath, next, "utf8");
  return `${file}：已更新（${dest.length} → ${next.length} 字节，旧文件备份为 ${file}.bak）`;
}

for (const [file, [begin, end]] of Object.entries(REGIONS)) console.log(swap(file, begin, end));
// 样式文件没有内置大包，直接用 worktree 的完整版本。
const css = path.join(target, "styles.css");
fs.copyFileSync(css, css + ".bak");
fs.copyFileSync(path.join(ROOT, "styles.css"), css);
console.log("styles.css：已更新（旧文件备份为 styles.css.bak）");
// 实验记录看板的段落显示补丁（不在原生织研者区块里，单独修补；可重复运行）。
console.log(require("./patch-experiment-board-sections.js").run(target));
console.log("完成。请在 Obsidian 里重新加载插件（或重启 Obsidian）。");
