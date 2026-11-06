const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../dashboard-view.ts'),'utf8');
const part=source.slice(source.indexOf('    async getExperiments(): Promise<ExperimentNote[]> {'),source.indexOf('    // ───── 时钟',source.indexOf('    async getExperiments(): Promise<ExperimentNote[]> {')));
const js=ts.transpileModule('class TestView { '+part+' }; globalThis.TestView=TestView;', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const vm=require('node:vm');
test('experiment directory finds untyped notes without mutating them or absorbing explicit other types',async()=>{
 const files=[{path:'Research/Experiments/2026-10-27 entry.md',basename:'2026-10-27 entry',stat:{ctime:1000,mtime:2000},text:'# Actual title\n\nbody'}, {path:'Research/Experiments/assets/ignored.md',basename:'ignored',stat:{ctime:1000,mtime:2000},text:'# asset'}, {path:'Research/Experiments/paper.md',basename:'paper',stat:{ctime:1000,mtime:2000},fm:{type:'paper',title:'paper'},text:'# paper'}, {path:'Research/Experiments/valid.md',basename:'valid',stat:{ctime:1000,mtime:2000},fm:{type:'experiment',title:'Valid'},text:'# Valid'}];
 const context={getFrontMatterInfo:()=>({exists:false}),parseYaml:()=>({}),console};vm.createContext(context);vm.runInContext(js,context);
 const v=new context.TestView();v.app={vault:{getMarkdownFiles:()=>files,cachedRead:async f=>f.text},metadataCache:{getFileCache:f=>({frontmatter:f.fm})}};
 const rows=await v.getExperiments(); assert.equal(rows.length,2);const row=rows.find(r=>r.file===files[0]);assert.equal(row.title,'Actual title');assert.equal(row.status,'待整理');assert.equal(row.date,'2026-10-27');assert.equal(files[0].text,'# Actual title\n\nbody');
});
