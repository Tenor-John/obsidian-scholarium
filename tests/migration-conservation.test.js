"use strict";

const { describe, it, assert } = require("./harness");
const { validatePreflight, ALLOWED_DATA_EXTRACTION } = require("../tools/migration-conservation");

const hash = (char) => char.repeat(64);
function validManifest() {
  return {
    schema_version: 1,
    kind: "scholarium-migration-preflight",
    declared_counts: { scanned: 4, migrate: 1, candidate: 1, exclude: 1, retained_settings: 1 },
    sources: [
      {
        source_path: "Experiments/WebClips/a/a.md",
        source_sha256: hash("a"),
        disposition: "migrate",
        target: { type: "paper", target_path: "Research/Papers/PAPER-001.md", source_sha256: hash("a") },
      },
      { source_path: "Experiments/legacy.md", source_sha256: hash("b"), disposition: "candidate", classification: "requires_review" },
      { source_path: ".WebClips-backup/a.md", source_sha256: hash("c"), disposition: "exclude", reason: "backup_directory" },
      {
        source_path: ".obsidian/plugins/obsidian-scholarium/data.json",
        source_sha256: hash("d"),
        disposition: "retained_settings",
        reason: "local_settings",
        allowed_extractions: [ALLOWED_DATA_EXTRACTION],
      },
    ],
  };
}

describe("migration conservation preflight", () => {
  it("accepts a fully accounted, credential-safe migration plan", () => {
    const report = validatePreflight(validManifest());
    assert.ok(report.valid, report.errors.join("; "));
    assert.eq(report.counts.scanned, 4);
    assert.eq(report.counts.migrate, 1);
  });

  it("rejects unaccounted or duplicate source records", () => {
    const plan = validManifest();
    plan.sources.push({ source_path: "Experiments/legacy.md", source_sha256: hash("e"), disposition: "unknown" });
    const report = validatePreflight(plan);
    assert.notOk(report.valid);
    assert.match(report.errors.join("\n"), /同一来源不可重复记账/);
    assert.match(report.errors.join("\n"), /disposition/);
    assert.match(report.errors.join("\n"), /守恒/);
  });

  it("rejects hash drift between a source and its migration target", () => {
    const plan = validManifest();
    plan.sources[0].target.source_sha256 = hash("f");
    const report = validatePreflight(plan);
    assert.notOk(report.valid);
    assert.match(report.errors.join("\n"), /正文哈希一致/);
  });

  it("forbids whole-file data.json migration and credential fields", () => {
    const plan = validManifest();
    plan.sources[3].disposition = "migrate";
    plan.sources[3].target = { type: "paper", target_path: "Research/Papers/PAPER-002.md", source_sha256: hash("d") };
    plan.rssAiApiKey = "must never enter a manifest";
    const report = validatePreflight(plan);
    assert.notOk(report.valid);
    assert.match(report.errors.join("\n"), /凭据字段/);
    assert.match(report.errors.join("\n"), /data\.json 只能作为 retained_settings/);
  });

  it("accepts attachments that stay inside their own paper package", () => {
    const plan = validManifest();
    plan.sources[0].target.target_path = "Research/Papers/a/a.md";
    plan.sources[0].target.attachments = [
      { from: "Experiments/WebClips/a/assets/img-01.png", to: "Research/Papers/a/assets/img-01.png", sha256: hash("e") },
    ];
    const report = validatePreflight(plan);
    assert.ok(report.valid, report.errors.join("; "));
  });

  it("rejects two papers writing to the same attachment path", () => {
    // img-01.png is what the clipper names every first image.
    const plan = validManifest();
    plan.sources[0].target.target_path = "Research/Papers/a/a.md";
    plan.sources[0].target.attachments = [
      { from: "Experiments/WebClips/a/assets/img-01.png", to: "Research/Papers/shared/img-01.png", sha256: hash("e") },
    ];
    plan.sources.push({
      source_path: "Experiments/WebClips/b/b.md", source_sha256: hash("f"), disposition: "migrate",
      target: {
        type: "paper", target_path: "Research/Papers/shared/b.md", source_sha256: hash("f"),
        attachments: [{ from: "Experiments/WebClips/b/assets/img-01.png", to: "Research/Papers/shared/img-01.png", sha256: hash("g") }],
      },
    });
    plan.declared_counts.scanned = 5; plan.declared_counts.migrate = 2;
    const report = validatePreflight(plan);
    assert.notOk(report.valid);
    assert.match(report.errors.join("\n"), /不能迁移到同一目标/);
  });

  it("rejects an attachment that escapes its paper package", () => {
    const plan = validManifest();
    plan.sources[0].target.target_path = "Research/Papers/a/a.md";
    plan.sources[0].target.attachments = [
      { from: "Experiments/WebClips/a/assets/img-01.png", to: "Research/Papers/img-01.png", sha256: hash("e") },
    ];
    const report = validatePreflight(plan);
    assert.notOk(report.valid);
    assert.match(report.errors.join("\n"), /必须位于论文包/);
  });

  it("rejects an attachment declaring an object type", () => {
    // schema-v1 §5 leaves Asset's fields unfrozen; nothing here may claim one.
    const plan = validManifest();
    plan.sources[0].target.target_path = "Research/Papers/a/a.md";
    plan.sources[0].target.attachments = [
      { type: "asset", from: "Experiments/WebClips/a/assets/i.png", to: "Research/Papers/a/assets/i.png", sha256: hash("e") },
    ];
    const report = validatePreflight(plan);
    assert.notOk(report.valid);
    assert.match(report.errors.join("\n"), /Asset 字段尚未冻结/);
  });

  it("requires a hash on every attachment", () => {
    const plan = validManifest();
    plan.sources[0].target.target_path = "Research/Papers/a/a.md";
    plan.sources[0].target.attachments = [
      { from: "Experiments/WebClips/a/assets/i.png", to: "Research/Papers/a/assets/i.png" },
    ];
    const report = validatePreflight(plan);
    assert.notOk(report.valid);
    assert.match(report.errors.join("\n"), /sha256/);
  });

  it("requires legacy and ambiguous notes to remain explicit candidates", () => {
    const plan = validManifest();
    delete plan.sources[1].classification;
    const report = validatePreflight(plan);
    assert.notOk(report.valid);
    assert.match(report.errors.join("\n"), /classification/);
  });
});
