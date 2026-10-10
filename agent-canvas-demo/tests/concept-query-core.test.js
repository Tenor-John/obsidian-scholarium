"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../concept-query-core.js");

test("alternative research branches are ORed while common concepts remain ANDed", () => {
  const plan = Core.buildBooleanPlan([
    { block: "catalyst", role: "material", mode: "required", terms: ["Au"] },
    { block: "support", role: "material", mode: "required", terms: ["TiO2"] },
    { block: "oxidation route", role: "reaction_branch", mode: "alternative", alternative_group: "reaction", terms: ["benzyl alcohol oxidation"] },
    { block: "reduction route", role: "reaction_branch", mode: "alternative", alternative_group: "reaction", terms: ["nitrobenzene reduction"] },
  ]);
  assert.equal(plan.v0, '(Au) AND (TiO2) AND (("benzyl alcohol oxidation") OR ("nitrobenzene reduction"))');
});
test("placeholders and refinements are never forced into every query", () => {
  const plan = Core.buildBooleanPlan([
    { block: "Gold", role: "material", terms: ["Au", "gold"] },
    { block: "Third component X", role: "material", required_in_v0: true, terms: ["X", "cocatalyst"] },
    { block: "interface charge", role: "refinement", required_in_v0: true, terms: ["interfacial charge"] },
    { block: "topology", role: "refinement", terms: ["core-shell", "overlayer"] },
  ]);
  assert.equal(plan.required.length, 1);
  assert.equal(plan.optional.length, 3);
  assert.match(plan.v1, /\(X OR cocatalyst\) OR \("interfacial charge"\) OR \(core-shell OR overlayer\)/);
  assert.doesNotMatch(plan.v1, /\(X OR cocatalyst\) AND \("interfacial charge"\)/);
  assert.equal(plan.variants.length, 3);
});

test("hard gate accepts any complete alternative branch, not every branch", () => {
  const blocks = [
    { block: "material", role: "material", mode: "required", terms: ["Au"] },
    { block: "route-a", role: "reaction_branch", mode: "alternative", alternative_group: "reaction", terms: ["oxidation"] },
    { block: "route-b", role: "reaction_branch", mode: "alternative", alternative_group: "reaction", terms: ["reduction"] },
  ];
  const present = new Set(["material", "route-b"]);
  assert.equal(Core.passesHardRequirements(blocks, (block) => present.has(block.block)), true);
  assert.equal(Core.passesHardRequirements(blocks, (block) => block.block === "material"), false);
});
