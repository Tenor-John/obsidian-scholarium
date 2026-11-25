const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');
const test = require('node:test');
class TFile { constructor(path) { this.path = path; this.name = path.split('/').pop(); this.stat = {mtime: 1}; } }
class TFolder { constructor(path, children=[]) { this.path = path; this.children = children; this.name = path.split('/').pop(); } }
const obsidian = {TFile,TFolder,Modal: class {}, SuggestModal: class {}};
const folders = {schMaterialsRoot: () => 'Materials', schMaterialFolderFromPath: p => p.slice('Materials/'.length).split('/').slice(0,-1).join('/'), schMaterialSafeFolder: v=>v};
const plotting = {installMaterialPlotting() {}};
const source = fs.readFileSync('src/material-library.ts','utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const mod = {exports:{}};
vm.runInNewContext(code, {module:mod,exports:mod.exports,require(name) { if(name==='obsidian') return obsidian; if(name==='./folders') return folders; if(name==='./material-plotting') return plotting; throw Error(name); },console,Date,Set,Map});
test('only selected folder files are discovered and missing records are hidden', () => {
 const f=new TFile('Materials/HPLC/a.png'); const nested=new TFolder('Materials/HPLC/子目录'); const root=new TFolder('Materials/HPLC',[f,nested]);
 const lookup=new Map([[f.path,f],[root.path,root]]); const app={vault:{getAbstractFileByPath:p=>lookup.get(p)}};
 const lib=new mod.exports.MaterialLibrary(app,{}); lib.data={items:[{path:'Materials/missing.csv'},{path:f.path,id:'saved'}],categories:[],folders:[]};
 assert.deepStrictEqual(Array.from(lib.allItems(),x=>x.path),[f.path]);
 assert.deepStrictEqual(Array.from(lib.folderItems('HPLC'),x=>x.id),['saved']);
 lib.data.items=[]; assert.equal(lib.folderItems('HPLC')[0].discovered,true);
 assert.equal(lib.folderItems('missing').length,0);
});
