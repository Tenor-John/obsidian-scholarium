"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { describe, it, assert } = require("./harness");

const root = path.join(__dirname, "..");
const bridge = fs.readFileSync(path.join(root, "agent-canvas-demo", "bridge", "server.js"), "utf8");
const skill = fs.readFileSync(path.join(root, "agent-canvas-demo", "skills", "sch-data-normalize", "SKILL.md"), "utf8");
const normalizer = path.join(root, "agent-canvas-demo", "skills", "sch-data-normalize", "scripts", "normalize_data.py");
const shellUi = fs.readFileSync(path.join(root, "agent-canvas-demo", "shell-ui.js"), "utf8");
const bundle = fs.readFileSync(path.join(root, "main.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const python = process.platform === "win32" ? "python.exe" : "python3";

function run(workspace, input) {
  return spawnSync(python, [normalizer, workspace, JSON.stringify(input)], { encoding: "utf8" });
}

function createMinimalWorkbook(target) {
  const script = String.raw`
import sys, zipfile
target = sys.argv[1]
files = {
  '[Content_Types].xml': '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>''',
  '_rels/.rels': '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>''',
  'xl/workbook.xml': '''<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="notes" sheetId="1" r:id="rId1"/><sheet name="kinetics" sheetId="2" r:id="rId2"/></sheets>
</workbook>''',
  'xl/_rels/workbook.xml.rels': '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>''',
  'xl/worksheets/sheet1.xml': '''<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
  <row r="1"><c r="A1" t="inlineStr"><is><t>read me</t></is></c></row>
</sheetData></worksheet>''',
  'xl/worksheets/sheet2.xml': '''<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
  <row r="1"><c r="A1" t="inlineStr"><is><t>instrument export</t></is></c></row>
  <row r="2"><c r="A2" t="inlineStr"><is><t>time</t></is></c><c r="B2" t="inlineStr"><is><t>signal</t></is></c><c r="C2" t="inlineStr"><is><t>calculated</t></is></c></row>
  <row r="3"><c r="A3"><v>1</v></c><c r="B3"><v>2</v></c><c r="C3"><f>A3+B3</f><v>3</v></c></row>
</sheetData></worksheet>''',
}
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, content in files.items():
        archive.writestr(name, content)
`;
  const made = spawnSync(python, ["-c", script, target], { encoding: "utf8" });
  if (made.status !== 0) throw new Error(made.stderr || made.stdout || "failed to create XLSX fixture");
}

describe("Material Library structural data normalization", () => {
  it("registers a bounded executable Skill without widening the generated UI bundle", () => {
    assert.match(bridge, /'sch-data-normalize':\s*\{\s*script:\s*'normalize_data\.py'/);
    assert.match(skill, /source file is byte-for-byte read-only/i);
    assert.match(skill, /_normalized/);
    assert.match(skill, /must not impute, aggregate, smooth/i);
    assert.match(skill, /never executed/i);
  });

  it("normalizes delimited text into an immutable, provenance-tracked UTF-8 CSV", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sch-data-normalize-text-"));
    try {
      const materials = path.join(workspace, "Materials");
      fs.mkdirSync(materials);
      const source = path.join(materials, "仪器导出.txt");
      const raw = Buffer.from("metadata only\ntime;signal;signal\n0;1;@note\n1;2;3\n", "utf8");
      fs.writeFileSync(source, raw);
      const first = run(workspace, { data_path: "Materials/仪器导出.txt", header_row: 2 });
      assert.eq(first.status, 0, first.stderr);
      const manifest = JSON.parse(first.stdout);
      assert.eq(manifest.skill, "sch-data-normalize");
      assert.eq(manifest.source.sha256.length, 64);
      assert.eq(manifest.selection.delimiter, ";");
      assert.eq(manifest.selection.header_row, 2);
      assert.deepEq(manifest.table.headers, ["time", "signal", "signal_2"]);
      assert.eq(manifest.table.rows, 2);
      assert.eq(manifest.table.csv_injection_escaped_cells, 1);
      assert.eq(manifest.ready_for.skill, "sch-data-plot");
      assert.match(manifest.ready_for.data_path, /^Materials\/_normalized\/.+\/normalized\.csv$/);
      assert.ok(manifest.writes.every((item) => item.startsWith("Materials/_normalized/")));
      assert.deepEq(fs.readFileSync(source), raw);
      const csvPath = path.join(workspace, ...manifest.ready_for.data_path.split("/"));
      const normalized = fs.readFileSync(csvPath);
      assert.ok(normalized.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), "normalized CSV should have a UTF-8 BOM");
      assert.match(normalized.toString("utf8"), /time,signal,signal_2\n0,1,'@note/);

      const second = run(workspace, { data_path: "Materials/仪器导出.txt", header_row: 2 });
      assert.eq(second.status, 0, second.stderr);
      const repeated = JSON.parse(second.stdout);
      assert.eq(repeated.result_status, "existing");
      assert.deepEq(repeated.outputs, manifest.outputs);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("inspects multi-sheet XLSX and requires an explicit sheet before exporting cached formula values", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sch-data-normalize-xlsx-"));
    try {
      const materials = path.join(workspace, "Materials");
      fs.mkdirSync(materials);
      const source = path.join(materials, "results.xlsx");
      createMinimalWorkbook(source);
      const raw = fs.readFileSync(source);

      const inspected = run(workspace, { mode: "inspect", data_path: "Materials/results.xlsx" });
      assert.eq(inspected.status, 0, inspected.stderr);
      const inspection = JSON.parse(inspected.stdout);
      assert.deepEq(inspection.workbook.sheets.map((sheet) => sheet.name), ["notes", "kinetics"]);
      assert.deepEq(inspection.writes, []);

      const ambiguous = run(workspace, { data_path: "Materials/results.xlsx", header_row: 2 });
      assert.ok(ambiguous.status !== 0, "multi-sheet workbooks must not silently select a sheet");
      assert.match(ambiguous.stderr, /sheet is required/);

      const selected = run(workspace, { data_path: "Materials/results.xlsx", sheet: "kinetics", header_row: 2, formula_mode: "cached" });
      assert.eq(selected.status, 0, selected.stderr);
      const manifest = JSON.parse(selected.stdout);
      assert.eq(manifest.selection.sheet, "kinetics");
      assert.eq(manifest.selection.sheet_index, 2);
      assert.eq(manifest.table.formula_cells, 1);
      assert.eq(manifest.table.missing_formula_cache, 0);
      assert.deepEq(manifest.table.headers, ["time", "signal", "calculated"]);
      const csvPath = path.join(workspace, ...manifest.ready_for.data_path.split("/"));
      assert.match(fs.readFileSync(csvPath, "utf8"), /time,signal,calculated\n1,2,3/);
      assert.deepEq(fs.readFileSync(source), raw);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("ships a visible, sheet-selecting normalization path instead of retrying an ambiguous XLSX blindly", () => {
    assert.match(shellUi, /function normalizeSheetChoices\(error\)/);
    assert.match(shellUi, /async function inspectNormalizeSheets\(/);
    assert.match(shellUi, /mode:\s*'inspect',\s*data_path:\s*request\.data_path/);
    assert.match(shellUi, /请选择工作表（必选）/);
    assert.match(shellUi, /先选择工作表/);
    assert.match(bundle, /function schMaterialNeedsNormalization\(item\)/);
    assert.match(bundle, /"sch-data-normalize"/);
    assert.match(bundle, /async function schOpenMaterialNormalization\(/);
    assert.match(bundle, /选择工作表并规范化/);
    assert.match(bundle, /打开 CSV 绘图/);
    assert.match(bundle, /schMaterialRegisterNormalizedDataset/);
    assert.match(bundle, /showImportDialog\(\)/);
    assert.match(bundle, /选择文件夹/);
    assert.match(bundle, /webkitdirectory/);
    assert.match(bundle, /importMaterialFolder/);
  });

  it("keeps non-previewable material identities visible and TIFF outside Chromium preview", () => {
    assert.match(bundle, /function schMaterialIsTiff\(item\)/);
    assert.match(bundle, /!schMaterialIsTiff\(e\)/);
    assert.match(bundle, /openWithDefaultApp/);
    assert.match(bundle, /用系统默认程序打开 TIFF/);
    assert.match(bundle, /cls:\s*"mat-card-file-name"/);
    assert.match(styles, /\.mat-card-file-name/);
  });
});
