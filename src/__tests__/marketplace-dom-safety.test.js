const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../..');
test('marketplace rendering paths do not assign untrusted HTML or create style elements',()=>{
 for(const name of ['src/material-plotting.ts','src/material-library.ts','src/rss-feed-board.ts']) {
  const text=fs.readFileSync(path.join(root,name),'utf8');
  assert.doesNotMatch(text,/\.innerHTML\s*=/,name);
  assert.match(text,/sanitizeHTMLToDom/,name);
 }
 for(const name of ['src/material-plotting.ts','src/chem/ketcher-runtime.tsx']) {
  const text=fs.readFileSync(path.join(root,name),'utf8');
  assert.doesNotMatch(text,/createElement\s*\(\s*["\x27]style["\x27]/,name);
 }
});
test('the literature matrix emits one cell for each structured summary field',()=>{
 const text=fs.readFileSync(path.join(root,'src/rss-feed-board.ts'),'utf8');
 assert.doesNotMatch(text,/summaryCell\("总结内容"/);
 assert.match(text,/for \(const field of this\.literatureMatrixFields\(\)\) summaryCell\(field, row\.ai\[field\]/);
});
