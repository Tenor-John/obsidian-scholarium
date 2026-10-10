"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const S = require("../tools/schema-objects.js");
const experiments = require("../tools/experiment-store.js");
const legacy = require("../tools/legacy-experiment-adapter.js");

const NOW = "2026-09-21T00:00:00.000Z";

function writeRelative(root, relative, content) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

test("[L2] legacy image and Agent input creates one canonical schema-v1 Experiment", async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "sch-l2-canonical-experiment-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));

  const project = S.createObject("project", {
    title: "Au/CeO2 光催化", status: "active", stage: "验证期",
  }, { now: NOW, display_id: "PRJ-001" });
  writeRelative(vault, "Research/Projects/PRJ-001 Au-CeO2.md", S.serializeObject(project, ""));

  const tiffBytes = Buffer.from("49492a0008000000", "hex");
  const source = writeRelative(vault, "Materials/TEM/sample-01.tif", tiffBytes);
  const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");

  const selected = legacy.resolveProject(S.readVaultObjects(vault), "PRJ-001");
  const fields = legacy.adaptLegacyExperiment({
    title: "TEM 图像转录",
    objective: "记录颗粒形貌并保留来源",
    steps: ["打开原始 TIFF", "记录可见团聚"],
    results: "颗粒约 8 nm。",
    observations: "可见局部团聚。",
    source_image: "Materials/TEM/sample-01.tif",
  }, { project: selected });
  const prepared = experiments.prepareNew(vault, fields, { now: NOW });

  // This is the same write boundary used by main.js: the prepared canonical
  // bytes are passed once to Obsidian's Vault API rather than to a legacy fs
  // writer. The test adapter writes a real file so the artifact can be parsed.
  const obsidianVault = {
    async create(relative, content) {
      return writeRelative(vault, relative, content);
    },
  };
  await obsidianVault.create(prepared.path, prepared.content);

  const artifact = path.join(vault, ...prepared.path.split("/"));
  assert.equal(fs.existsSync(artifact), true);
  const parsed = S.parseObject(fs.readFileSync(artifact, "utf8"));
  assert.deepEqual(S.validateObject(parsed.object), []);
  assert.equal(parsed.object.type, "experiment");
  assert.equal(parsed.object.project_uid, project.uid);
  assert.equal(parsed.object.data_origin, "unknown");
  assert.deepEqual(parsed.object.raw_data_refs, ["Materials/TEM/sample-01.tif"]);
  assert.match(parsed.body, /## 实验方案与过程[\s\S]*1\. 打开原始 TIFF/);
  assert.match(parsed.body, /## 结果[\s\S]*颗粒约 8 nm/);
  assert.match(parsed.object.data_provenance_note, /不得作为正式 Evidence/);

  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"),
    sourceHash,
    "the source image must remain byte-for-byte read-only",
  );
  assert.equal(fs.existsSync(path.join(vault, "Experiments")), false);
});
