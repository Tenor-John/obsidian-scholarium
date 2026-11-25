"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const script = path.join(__dirname, "..", "..", "agent-canvas-demo", "skills", "literature-review-workflow", "scripts", "inspect_review_pool.py");
const python = process.platform === "win32" ? "python" : "python3";
const available = spawnSync(python, ["--version"], { encoding: "utf8" }).status === 0;
const run = (root, payload) => spawnSync(python, [script, root, JSON.stringify(payload)], { encoding: "utf8" });

test("review pool inspection is registered as an explicit skill runner", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "..", "agent-canvas-demo", "bridge", "server.js"), "utf8");
  assert.match(server, /'literature-review-workflow':\s*\{\s*script:\s*'inspect_review_pool\.py'/);
  assert.ok(fs.existsSync(path.join(path.dirname(path.dirname(script)), "SKILL.md")));
});

test("literature pool inspection reports coverage, source rows and paging without writing", { skip: !available }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sch-review-pool-"));
  try {
    const content = "标题,作者,DOI,原始摘要,阅读优先级\n论文甲,作者甲,10.1/a,摘要甲,P0\n\n论文乙,作者乙,10.1/b,,P1\n";
    const file = path.join(dir, "pool.csv");
    fs.writeFileSync(file, content, "utf8");
    const before = fs.readFileSync(file);
    const result = run(dir, { data_path: "pool.csv", offset: 1, limit: 1 });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.record_count, 2);
    assert.equal(data.coverage.abstract.present, 1);
    assert.equal(data.records[0].row, 4);
    assert.equal(data.records[0].values["标题"], "论文乙");
    assert.deepEqual(data.writes, []);
    assert.deepEqual(fs.readFileSync(file), before);
    const denied = run(dir, { data_path: path.join(dir, "..", "outside.csv") });
    assert.notEqual(denied.status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("inspects the Main_Classification sheet of an XLSX without executing content", { skip: !available }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sch-review-xlsx-"));
  try {
    const make = [
      "import sys,zipfile",
      "z=zipfile.ZipFile(sys.argv[1],'w')",
      "z.writestr('xl/workbook.xml', '<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Main_Classification\" sheetId=\"1\" r:id=\"r1\"/><sheet name=\"Dashboard\" sheetId=\"2\" r:id=\"r2\"/></sheets></workbook>')",
      "z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"r1\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"r2\" Target=\"worksheets/sheet2.xml\"/></Relationships>')",
      "z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Title</t></is></c><c r=\"B1\" t=\"inlineStr\"><is><t>DOI</t></is></c></row><row r=\"3\"><c r=\"A3\" t=\"inlineStr\"><is><t>Study A</t></is></c><c r=\"B3\" t=\"inlineStr\"><is><t>10.1/a</t></is></c></row></sheetData></worksheet>')",
      "z.writestr('xl/worksheets/sheet2.xml','<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData/></worksheet>')",
      "z.close()",
    ].join("\n");
    const created = spawnSync(python, ["-c", make, path.join(dir, "pool.xlsx")], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    const result = run(dir, { data_path: "pool.xlsx" });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.sheet, "Main_Classification");
    assert.equal(data.sheets.length, 2);
    assert.equal(data.records[0].row, 3);
    assert.equal(data.records[0].values.DOI, "10.1/a");
    assert.ok(data.missing_columns.includes("abstract"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
