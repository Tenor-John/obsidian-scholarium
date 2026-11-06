"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..", "..");
const obsidianStub = {
  name: "cloud-sync-obsidian-test-double",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "sch-cloud-test" }));
    build.onLoad({ filter: /.*/, namespace: "sch-cloud-test" }, () => ({
      loader: "js",
      contents: `
        export class App {}
        export class Notice {}
        export class TFile { constructor(path) { this.path = path; this.name = path.split('/').pop(); } }
        export class TFolder { constructor(path, children = []) { this.path = path; this.children = children; } }
        export function requestUrl() { throw new Error('unexpected network request'); }
        globalThis.__schCloudObsidian = { TFile, TFolder };
      `,
    }));
  },
};

const moduleReady = (async () => {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, "src", "cloud-sync.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    target: "node18",
    logLevel: "silent",
    plugins: [obsidianStub],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
})();

function config(type) {
  return {
    type,
    webdavUrl: "https://dav.example.test/",
    webdavUser: "user",
    webdavPass: "pass",
    webdavPath: "ChemELN/",
    s3Endpoint: "https://s3.example.test/",
    s3Bucket: "bucket",
    s3Region: "us-east-1",
    s3AccessKey: "key",
    s3SecretKey: "secret",
    s3Prefix: "/ChemELN/",
    autoSync: false,
    syncInterval: 0,
  };
}

function providerDouble() {
  return {
    uploads: [],
    deletes: [],
    directories: [],
    upload: async function(path, data, contentType) { this.uploads.push({ path, data, contentType }); },
    delete: async function(path) { this.deletes.push(path); },
    ensureDir: async function(path) { this.directories.push(path); },
  };
}

async function fixture(type, root = "Research Assets") {
  const { CloudSyncManager } = await moduleReady;
  const { TFile, TFolder } = globalThis.__schCloudObsidian;
  const nested = new TFile(`${root}/_analysis/run/plot.svg`);
  const loose = new TFile(`${root}/readme.md`);
  const tree = new TFolder(root, [loose, new TFolder(`${root}/_analysis`, [nested])]);
  const files = new Map([[tree.path, tree], [nested.path, nested], [loose.path, loose]]);
  const app = {
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || null,
      readBinary: async (file) => new TextEncoder().encode(file.path).buffer,
    },
  };
  const plugin = {
    settings: { materialsFolder: root },
    loadData: async () => ({ materialLibrary: { items: [] } }),
  };
  const manager = new CloudSyncManager(app, plugin, config(type));
  const provider = providerDouble();
  manager.getProvider = () => provider;
  return { manager, provider, files, TFile, nested, loose };
}

test("fullSync recursively uploads the configured material root without duplicating the WebDAV prefix", async () => {
  const { manager, provider } = await fixture("webdav");
  const result = await manager.fullSync();
  assert.equal(result.success, true);
  assert.equal(result.uploaded, 2);
  assert.deepEqual(provider.directories, ["", "Research Assets/", "Research Assets/", "Research Assets/_analysis/", "Research Assets/_analysis/run/"]);
  assert.deepEqual(provider.uploads.map((item) => item.path), [
    "Research Assets/readme.md",
    "Research Assets/_analysis/run/plot.svg",
    "metadata.json",
  ]);
  assert.ok(provider.uploads.every((item) => !item.path.startsWith("ChemELN/")));
});

test("S3 folder creation, move, and metadata use one normalized prefix", async () => {
  const { manager, provider, files, TFile } = await fixture("s3");
  const target = "Research Assets/_analysis/run/moved.svg";
  files.set(target, new TFile(target));
  await manager.moveFile("Research Assets/_analysis/run/old.svg", target);
  assert.deepEqual(provider.uploads.map((item) => item.path), [
    "ChemELN/Research Assets/_analysis/run/",
    `ChemELN/${target}`,
    "ChemELN/metadata.json",
  ]);
  assert.deepEqual(provider.deletes, ["ChemELN/Research Assets/_analysis/run/old.svg"]);
  assert.equal(provider.uploads[0].data.byteLength, 0);
  assert.equal(provider.uploads[0].contentType, "application/x-directory");
});

test("deletePaths deduplicates analysis outputs and ignores only missing remote files", async () => {
  const { manager, provider } = await fixture("s3");
  await manager.deletePaths([
    "Research Assets/_analysis/run/plot.svg",
    "Research Assets/_analysis/run/plot.svg",
    "Research Assets/_analysis/run/plot-report.md",
  ]);
  assert.deepEqual(provider.deletes, [
    "ChemELN/Research Assets/_analysis/run/plot.svg",
    "ChemELN/Research Assets/_analysis/run/plot-report.md",
  ]);
  provider.delete = async () => { throw new Error("WebDAV delete failed: 404"); };
  await manager.deletePaths(["Research Assets/_analysis/run/missing.svg"]);
});

test("cloud mutations reject traversal, empty segments, and paths outside their allowed roots", async () => {
  const { manager } = await fixture("webdav");
  for (const path of [
    "Research Assets/_analysis/../secret",
    "Research Assets/_analysis//plot.svg",
    "Research Assets/_analysis/./plot.svg",
    "Research Assets/other/plot.svg",
  ]) {
    await assert.rejects(manager.deletePaths([path]));
  }
  for (const path of ["Research Assets//bad", "Research Assets/../bad", "Other/bad"]) {
    await assert.rejects(manager.ensureFolder(path));
  }
  await assert.rejects(manager.moveFile("Other/old.svg", "Research Assets/_analysis/run/new.svg"));
});
