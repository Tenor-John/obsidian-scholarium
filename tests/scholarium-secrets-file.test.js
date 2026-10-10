"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { source, describe, it, assert } = require("./harness");

function loadSecretsApi() {
  const src = source();
  const start = src.indexOf("/* SCHOLARIUM_SECRETS_FILE_BEGIN */");
  const end = src.indexOf("/* SCHOLARIUM_SECRETS_FILE_END */", start);
  assert.ok(start >= 0 && end > start, "central secrets block is missing");
  const context = { require, console, process };
  vm.runInNewContext(`${src.slice(start, end)}\nthis.schSecretsFile = schSecretsFile;`, context);
  return context.schSecretsFile;
}

describe("central secrets file", () => {
  it("keeps credentials out of data.json and round-trips settings", async () => {
    const api = loadSecretsApi();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-secrets-"));
    const secretFile = path.join(temp, "Scholarium", "scholarium-secrets.json");
    const vault = path.join(temp, "vault");
    fs.mkdirSync(path.join(vault, "Scholarium", "secrets"), { recursive: true });
    fs.writeFileSync(path.join(vault, "Scholarium", "secrets", "openalex-api-key.txt"), "legacy-openalex\n", "utf8");
    const previous = process.env.SCHOLARIUM_SECRETS_FILE;
    process.env.SCHOLARIUM_SECRETS_FILE = secretFile;
    const saved = [];
    const cleanups = [];
    const plugin = {
      app: { vault: { adapter: { getBasePath: () => vault } } },
      loadData: async () => ({ aiApiKey: "legacy-ai", cloudS3SecretKey: "legacy-s3" }),
      saveData: async (data) => { saved.push(data); },
      register: (fn) => cleanups.push(fn),
      addCommand: () => {},
    };
    try {
      api.install(plugin);
      const loaded = await plugin.loadData();
      const file = JSON.parse(fs.readFileSync(secretFile, "utf8"));
      assert.eq(file.assistant.apiKey, "legacy-ai");
      assert.eq(file.cloudSync.s3SecretKey, "legacy-s3");
      assert.eq(file.openalex.apiKey, "legacy-openalex");
      assert.eq(saved[0].aiApiKey, "");
      assert.eq(loaded.aiApiKey, "legacy-ai");

      await plugin.saveData({ aiApiKey: "new-ai", openalexApiKey: "new-openalex", safeSetting: true });
      const next = JSON.parse(fs.readFileSync(secretFile, "utf8"));
      assert.eq(next.assistant.apiKey, "new-ai");
      assert.eq(next.openalex.apiKey, "new-openalex");
      assert.eq(saved.at(-1).aiApiKey, "");
      assert.eq(saved.at(-1).safeSetting, true);
    } finally {
      cleanups.forEach((fn) => fn());
      if (previous === undefined) delete process.env.SCHOLARIUM_SECRETS_FILE;
      else process.env.SCHOLARIUM_SECRETS_FILE = previous;
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("exposes the file path and settings entry points in the published bundle", () => {
    const src = source();
    assert.match(src, /id: "open-secrets-file"/);
    assert.match(src, /schSecretsFile\.renderSettingsBox\(e, this\.plugin\)/);
    assert.match(src, /schSecretsFile\.install\(this\)/);
    assert.match(src, /选择保存位置/);
    assert.match(src, /scholarium-secrets\.json/);
    assert.match(src, /openalex-api-key\.txt/);
  });

  it("moves the active file when a user selects another folder", async () => {
    const api = loadSecretsApi();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-location-"));
    const defaultFile = path.join(temp, "default", "scholarium-secrets.json");
    const selectedFolder = path.join(temp, "selected");
    fs.mkdirSync(path.dirname(defaultFile), { recursive: true });
    fs.writeFileSync(defaultFile, JSON.stringify({ assistant: { apiKey: "keep-me" } }), "utf8");
    const previous = process.env.SCHOLARIUM_SECRETS_FILE;
    process.env.SCHOLARIUM_SECRETS_FILE = defaultFile;
    const plugin = { settings: { secretsFilePath: "" }, saveSettings: async () => {} };
    try {
      const selected = await api.setLocation(plugin, selectedFolder);
      assert.eq(selected, path.join(selectedFolder, "scholarium-secrets.json"));
      assert.ok(fs.existsSync(selected));
      assert.eq(JSON.parse(fs.readFileSync(selected, "utf8")).assistant.apiKey, "keep-me");
      assert.eq(plugin.settings.secretsFilePath, selected);
      await api.resetLocation(plugin);
      assert.eq(plugin.settings.secretsFilePath, "");
      assert.eq(api.filePath(), defaultFile);
    } finally {
      if (previous === undefined) delete process.env.SCHOLARIUM_SECRETS_FILE;
      else process.env.SCHOLARIUM_SECRETS_FILE = previous;
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
