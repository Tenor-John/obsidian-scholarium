# Known limitations — 2.0.9 release candidate

This file records release-facing limitations that can make a structural test
look green while a real user workflow is still broken. A limitation is closed
only by an L2 test that uses a real input and verifies the resulting artifact.

## L-02 — Route and executor capabilities can drift

**Status:** closed for the 2.0.9 candidate on 2026-09-20 by the L2 gate.

The deployed Material Library classifies `.csv`, `.tsv`, `.txt`, and `.dat` as
directly plottable. At the time of this audit, the independently spawned
`sch-data-plot` executor still admitted only `.csv` and `.tsv`, while the
Weaver fenced-request parser also admitted only those two extensions. The
bundle even contained a comment claiming the executor had supported TXT/DAT
since `27ea568`; that implementation existed in history but was absent from
the release-candidate working tree.

This is the reference false-green: an L1 assertion can prove that the button
is routed, but only an L2 run can prove that the selected file reaches the
executor and produces a valid SVG, report, and manifest.

Release disposition is binary:

- pass an L2 test for real comment-prefixed TXT and DAT exports, including an
  auditable detected separator; or
- remove TXT/DAT from the route and state that they are disabled in this
  version.

The first L2 run failed exactly at the old executor rejection. The candidate
then restored fail-closed separator sniffing, taught the native header reader
and Weaver parser the same suffix contract, and passed real comment-prefixed
TXT, whitespace DAT, and ambiguous-input rejection through the live Bridge.
The release gate is `node tools/run-release-l2.js`; a later route/executor drift
will fail both the L1 equality check and the real-file L2 run.

The complete comparison is in
`docs/audits/release-route-executor-audit-2026-09-20.md`.

## L-06 — Four live legacy creation routes bypass the canonical writer

**Status:** closed for the 2.0.9 candidate on 2026-09-21 by the canonical
adapter and real-file L2 gate.

Four live entry routes still terminate in `createExperimentFromAgent` rather
than the schema-v1 store / Bridge transaction:

1. image-recognition creation;
2. vision-result normalization followed by creation;
3. the legacy Agent `create_experiment` action; and
4. the green legacy “new Experiment” action.

They accept legacy fields such as `date`, `status`, `reagents`, `steps`,
`results`, and image paths, then write date-title Markdown below the configured
legacy Experiments folder. They do **not** allocate canonical EXP identity,
validate the schema-v1 object, use the Bridge preview/commit transaction, or
write the shared schema action audit. A preview card in front of one of these
routes therefore does not turn its executor into the canonical writer.

The four live routes now converge before any write. Image recognition, vision
normalization, and the legacy Agent action map their historical fields through
`legacy-experiment-adapter.js`, resolve a real schema-v1 Project, prepare exact
canonical bytes with `experiment-store.prepareNew()`, and write those bytes
once through Obsidian's Vault API. Existing results and image references enter
with `data_origin: unknown`; an Agent is not allowed to label them measured or
imported, and the record says they cannot become formal Evidence until the
researcher classifies their provenance. The two green UI actions now open the
same schema-v1 creator instead of the legacy date-title writer.

`tests/l2-canonical-experiment-entrypoints.test.js` creates a real Project and
TIFF in a temporary Vault, runs the adapter/preparer/write boundary, parses the
resulting file as schema-v1, verifies Project linkage and unknown provenance,
checks the TIFF hash is unchanged, and proves the legacy `Experiments/` folder
was not created. L1 wiring assertions separately bind all four live entry
points to that executor.

## L-07 — Browser automation can look packaged while no browser can launch

**Status:** closed for the Windows 2.0.9 candidate on 2026-09-21 by the L2
runtime-launch gate.

The paper-downloader first loads the Playwright JavaScript module and then
launches a browser channel. Merely finding `browser_downloader.js`, or even
finding system Edge, is not sufficient: an `npm ci --omit=dev` core silently
omits Playwright because the historical package declares it as a
`devDependency`. That produces a green Bridge and a WebVPN button which fails
only after the researcher clicks it.

Core assembly now requires both `playwright` and `playwright-core`, including
their LICENSE, NOTICE, and ThirdPartyNotices files. The release L2 verifier
uses the packaged Node and packaged module to launch system Edge and then
Chrome, loads an in-memory page, and asserts its DOM. A machine on which that
probe fails is not counted as supporting browser/WebVPN features. Users do not
run npm or `npx playwright install`.
