"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..", "..");

async function compile(entryPoint, plugins) {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, entryPoint)],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    target: "node18",
    logLevel: "silent",
    plugins,
  });
  const module = { exports: {} };
  const evaluate = new Function("require", "module", "exports", "__filename", "__dirname", result.outputFiles[0].text);
  evaluate(require, module, module.exports, __filename, __dirname);
  return module.exports;
}

const runtimeStub = {
  name: "ketcher-runtime-test-double",
  setup(build) {
    build.onResolve({ filter: /^\.\/ketcher-runtime$/ }, () => ({ path: "ketcher-runtime", namespace: "sch-test" }));
    build.onLoad({ filter: /.*/, namespace: "sch-test" }, () => ({
      loader: "js",
      contents: `
        export function mountKetcherRuntime(container, initialSource) {
          return globalThis.__schTestMountKetcher(container, initialSource);
        }
      `,
    }));
  },
};

const obsidianStub = {
  name: "obsidian-yaml-test-double",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "sch-test-yaml" }));
    build.onLoad({ filter: /.*/, namespace: "sch-test-yaml" }, () => ({
      loader: "js",
      contents: "export function parseYaml(source) { return globalThis.__schTestParseYaml(source); }",
    }));
  },
};

let mountKetcher;
let serializeChemBlock;
let wrapChemBlock;
let parseChemBlock;
const modulesReady = (async () => {
  const host = await compile("src/chem/ketcher-host.ts", [runtimeStub]);
  const chem = await compile("src/chem/chem-block.ts", [obsidianStub]);
  mountKetcher = host.mountKetcher;
  serializeChemBlock = chem.serializeChemBlock;
  wrapChemBlock = chem.wrapChemBlock;
  parseChemBlock = chem.parseChemBlock;
})();

function testWithModules(name, fn) {
  return test(name, async () => {
    await modulesReady;
    return fn();
  });
}

function initialBlock(overrides = {}) {
  return {
    id: "chem-test",
    type: "molecule",
    title: "Test structure",
    locked: false,
    format: "ket",
    ket: "old ket",
    rxn: "old rxn",
    molfile: "old molfile",
    smiles: "old smiles",
    reactionSmiles: "old reaction smiles",
    previewSvg: "old svg",
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function mountWith(ketcher, initial) {
  const mounted = { source: null, destroyed: 0 };
  globalThis.__schTestMountKetcher = async (container, source) => {
    mounted.container = container;
    mounted.source = source;
    return { ketcher, destroy: () => { mounted.destroyed += 1; } };
  };
  const container = { id: "editor-host" };
  const host = await mountKetcher(null, container, initial);
  return { host, mounted, container };
}

function svgBlob(text) {
  return { text: async () => text };
}

// The production serializer uses JSON string quoting. This small parser only
// reads that deterministic subset, allowing an exact round-trip without an
// Obsidian process or a second YAML implementation.
globalThis.__schTestParseYaml = (source) => {
  const result = {};
  for (const line of source.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon);
    const value = line.slice(colon + 1).trim();
    if (value.startsWith('"')) result[key] = JSON.parse(value);
    else if (value === "true" || value === "false") result[key] = value === "true";
    else result[key] = value;
  }
  return result;
};

testWithModules("molecule save exports KET, SMILES, v3000 Molfile and SVG, then serializes losslessly", async () => {
  const calls = { molfile: [], rxn: [], images: [] };
  const ket = '{"root":{"nodes":[{"type":"text","data":"ethanol"}]}}';
  const molfile = " ethanol\n  Ketcher\n\n  0  0  0  0  0  0            999 V3000\nM  END";
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>CCO</text></svg>';
  const ketcher = {
    getSmiles: async () => "CCO",
    getKet: async () => ket,
    containsReaction: () => false,
    getMolfile: async (format) => { calls.molfile.push(format); return molfile; },
    getRxn: async (format) => { calls.rxn.push(format); return "unexpected"; },
    generateImage: async (data, options) => { calls.images.push({ data, options }); return svgBlob(svg); },
  };
  const initial = initialBlock({ smiles: "CCO", reactionSmiles: "", rxn: "" });
  const { host, mounted, container } = await mountWith(ketcher, initial);
  assert.equal(mounted.container, container);
  assert.equal(mounted.source, "CCO", "the existing molecule is loaded into the graphical editor");

  const saved = await host.getBlock();
  assert.equal(saved.ket, ket);
  assert.equal(saved.smiles, "CCO");
  assert.equal(saved.reactionSmiles, "");
  assert.equal(saved.format, "ket");
  assert.equal(saved.molfile, molfile);
  assert.equal(saved.rxn, "");
  assert.equal(saved.previewSvg, svg);
  assert.deepEqual(calls.molfile, ["v3000"]);
  assert.deepEqual(calls.rxn, [], "a molecule must not export an RXN");
  assert.equal(calls.images[0].data, ket, "SVG generation uses the saved KET structure");
  assert.equal(calls.images[0].options.outputFormat, "svg");
  assert.equal(calls.images[0].options.backgroundColor, "255, 255, 255");
  assert.equal(initial.ket, "old ket", "saving does not mutate the editor's initial block");

  const serialized = serializeChemBlock(saved);
  const roundTrip = parseChemBlock(serialized);
  for (const field of ["ket", "smiles", "reactionSmiles", "molfile", "rxn", "previewSvg", "format"]) {
    assert.equal(roundTrip[field], saved[field], field + " survives Markdown serialization");
  }
  assert.match(wrapChemBlock(saved), /^```scholarium-chem\n/);
  host.destroy();
  assert.equal(mounted.destroyed, 1);
});

testWithModules("reaction save exports reaction SMILES and v3000 RXN while clearing ordinary SMILES", async () => {
  const calls = { molfile: [], rxn: [], images: [] };
  const ket = '{"root":{"nodes":[{"type":"reaction"}]}}';
  const reactionSmiles = "CCO>>CC=O";
  const rxn = "$RXN V3000\n\n  Scholarium\n\nM  V30 COUNTS 1 1\nM  END";
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>CCO&gt;&gt;CC=O</text></svg>';
  const ketcher = {
    getSmiles: async () => reactionSmiles,
    getKet: async () => ket,
    // Exercise the legacy reaction-type fallback as well as reaction SMILES.
    containsReaction: () => false,
    getMolfile: async (format) => { calls.molfile.push(format); return "reaction molfile"; },
    getRxn: async (format) => { calls.rxn.push(format); return rxn; },
    generateImage: async (data, options) => { calls.images.push({ data, options }); return svgBlob(svg); },
  };
  const initial = initialBlock({
    type: "reaction",
    format: "rxn",
    smiles: "",
    reactionSmiles,
    rxn: "old rxn",
  });
  const { host, mounted } = await mountWith(ketcher, initial);
  assert.equal(mounted.source, reactionSmiles, "the existing reaction is editable");

  const saved = await host.getBlock();
  assert.equal(saved.format, "rxn");
  assert.equal(saved.smiles, "");
  assert.equal(saved.reactionSmiles, reactionSmiles);
  assert.equal(saved.ket, ket);
  assert.equal(saved.rxn, rxn);
  assert.equal(saved.previewSvg, svg);
  assert.deepEqual(calls.molfile, ["v3000"]);
  assert.deepEqual(calls.rxn, ["v3000"]);

  const roundTrip = parseChemBlock(serializeChemBlock(saved));
  for (const field of ["ket", "smiles", "reactionSmiles", "molfile", "rxn", "previewSvg", "format"]) {
    assert.equal(roundTrip[field], saved[field], field + " survives Markdown serialization");
  }
});

testWithModules("containsReaction marks a structure as a reaction even without a legacy reaction type", async () => {
  const ketcher = {
    getSmiles: async () => "CCO",
    getKet: async () => "reaction ket",
    containsReaction: () => true,
    getMolfile: async () => "molfile",
    getRxn: async () => "rxn",
    generateImage: async () => svgBlob("reaction svg"),
  };
  const { host } = await mountWith(ketcher, initialBlock({ type: "molecule" }));
  const saved = await host.getBlock();
  assert.equal(saved.format, "rxn");
  assert.equal(saved.smiles, "");
  assert.equal(saved.reactionSmiles, "CCO");
  assert.equal(saved.rxn, "rxn");
});

testWithModules("empty canvas clears stale SMILES and SVG without requesting image generation", async () => {
  let imageCalls = 0;
  const emptyKet = '{"root":{"nodes":[]}}';
  const ketcher = {
    getSmiles: async () => "  ",
    getKet: async () => emptyKet,
    containsReaction: () => false,
    getMolfile: async () => "empty v3000 molfile",
    getRxn: async () => { throw new Error("RXN must not be requested for an empty molecule"); },
    generateImage: async () => { imageCalls += 1; return svgBlob("unexpected"); },
  };
  const initial = initialBlock({
    type: "reaction",
    format: "rxn",
    smiles: "CCO",
    reactionSmiles: "CCO>>CC=O",
    rxn: "stale rxn",
    previewSvg: "stale svg",
  });
  const { host } = await mountWith(ketcher, initial);
  const saved = await host.getBlock();
  assert.equal(saved.ket, emptyKet);
  assert.equal(saved.format, "ket");
  assert.equal(saved.smiles, "");
  assert.equal(saved.reactionSmiles, "");
  assert.equal(saved.previewSvg, "");
  assert.equal(saved.molfile, "empty v3000 molfile");
  assert.equal(saved.rxn, "");
  assert.equal(imageCalls, 0);

  const roundTrip = parseChemBlock(serializeChemBlock(saved));
  assert.equal(roundTrip.ket, emptyKet);
  assert.equal(roundTrip.previewSvg, "");
  assert.equal(roundTrip.reactionSmiles, "");
});
