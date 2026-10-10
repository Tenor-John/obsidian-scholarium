"use strict";

/*
 * The dashboard content element does not always expose a resolvable percentage
 * height to nested flex children in Obsidian. In that state an empty native
 * Weaver panel shrinks to its side rail, while opening a long tool happens to
 * stretch it again. Pin the persistent shell to the content element's measured
 * screen rectangle and keep it synchronized as the leaf/window changes size.
 *
 * This is a guarded, idempotent patch just like the other generated regions in
 * this worktree: rerunning the embed restores the original anchor before it
 * inserts one fresh region.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MAIN = path.join(ROOT, "main.js");
const BEGIN = "/* SCHOLARIUM_NATIVE_WEAVER_LAYOUT_BEGIN */";
const END = "/* SCHOLARIUM_NATIVE_WEAVER_LAYOUT_END */";
const ANCHOR = '        shell.style.cssText = "display:flex;flex:1 1 auto;min-width:0;min-height:0;position:relative;overflow:hidden;";\n';

function count(text, needle) { return text.split(needle).length - 1; }

function restore(text) {
  const start = text.indexOf(BEGIN);
  const finish = text.indexOf(END);
  if ((start >= 0) !== (finish >= 0) || (start >= 0 && finish < start)) throw new Error("原生织研者布局标记不完整");
  if (start < 0) return text;
  if (count(text, BEGIN) !== 1 || count(text, END) !== 1) throw new Error("原生织研者布局标记重复");
  let tail = finish + END.length;
  if (text[tail] === "\n") tail += 1;
  return text.slice(0, start) + ANCHOR + text.slice(tail);
}

function patch() {
  let text = restore(fs.readFileSync(MAIN, "utf8"));
  if (count(text, ANCHOR) !== 1) throw new Error("持久面板布局锚点不是恰好一处，拒绝修改");
  const body = `${BEGIN}\n` +
`        shell.style.cssText = "display:flex;position:fixed;min-width:0;min-height:0;overflow:hidden;";
        const syncPersistentShellBounds = () => {
          const rect = content.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return;
          shell.style.left = \`${"${Math.round(rect.left)}"}px\`;
          shell.style.top = \`${"${Math.round(rect.top)}"}px\`;
          shell.style.width = \`${"${Math.round(rect.width)}"}px\`;
          shell.style.height = \`${"${Math.round(rect.height)}"}px\`;
        };
        syncPersistentShellBounds();
        this.__scholariumPersistentShellObserver?.disconnect?.();
        if (typeof ResizeObserver === "function") {
          this.__scholariumPersistentShellObserver = new ResizeObserver(syncPersistentShellBounds);
          this.__scholariumPersistentShellObserver.observe(content);
        }
${END}\n`;
  text = text.replace(ANCHOR, body);
  fs.writeFileSync(MAIN, text, "utf8");
  return { bytes: Buffer.byteLength(text), regions: count(text, BEGIN) };
}

if (require.main === module) process.stdout.write(JSON.stringify(patch(), null, 2) + "\n");
module.exports = { patch, BEGIN, END, ANCHOR };
