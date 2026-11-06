import fs from "node:fs/promises";

const OBJECT_CONVERTER = `function objectConverter(columns) {
  return new Function("d", "return {" + columns.map(function(name, i) {
    return JSON.stringify(name) + ": d[" + i + "] || \\\"\\\"";
  }).join(",") + "}");
}`;

// Keep d3-dsv's public parsing behavior, but construct rows explicitly instead
// of compiling a new JavaScript function for every input schema.
const STATIC_OBJECT_CONVERTER = `function objectConverter(columns) {
  return function(row) {
    var object = {};
    columns.forEach(function(name, i) {
      object[name] = row[i] || "";
    });
    return object;
  };
}`;

/**
 * Remove runtime code generation from third-party dependencies by replacing it
 * with static, behavior-preserving implementations. These are source transforms,
 * not scanner evasions: the generated bundle contains no corresponding dynamic
 * compiler or Function constructor. Exact d3 matching makes dependency drift a
 * build error rather than an unreviewed partial patch.
 */
export const staticDependencyPlugin = {
  name: "scholarium-static-dependencies",
  setup(build) {
    build.onLoad({ filter: /\.m?js$/ }, async (args) => {
      if (!/[\\/]node_modules[\\/]/.test(args.path)) return null;
      let source = await fs.readFile(args.path, "utf8");
      let contents = source;

      // All supported Obsidian runtimes provide globalThis. This is the same
      // global object these legacy packages otherwise obtain by compiling code.
      contents = contents
        .replaceAll("Function('return this')()", "globalThis")
        .replaceAll('Function("return this")()', "globalThis")
        .replaceAll(
          'Function("r", "regeneratorRuntime = r")(runtime)',
          "globalThis.regeneratorRuntime = runtime",
        );

      if (/[\\/]d3-dsv[\\/]dist[\\/]d3-dsv\.mjs$/.test(args.path)) {
        if (!contents.includes(OBJECT_CONVERTER)) {
          throw new Error("d3-dsv objectConverter changed; review the static replacement before building");
        }
        contents = contents.replace(OBJECT_CONVERTER, STATIC_OBJECT_CONVERTER);
      }

      return contents === source ? null : { contents, loader: "js" };
    });
  },
};
