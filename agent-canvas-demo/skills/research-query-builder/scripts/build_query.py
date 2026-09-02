#!/usr/bin/env python3
"""Generate conservative, auditable first-pass Boolean search manifests."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def quoted(values: list[str]) -> str:
    return " OR ".join(f'"{item}"' if " " in item else item for item in values)


def load_question(argv: list[str]) -> str:
    if len(argv) == 1:
        candidate = Path(argv[0])
        if candidate.exists() and candidate.is_file():
            return candidate.read_text(encoding="utf-8").strip()
    return " ".join(argv).strip()


def main() -> int:
    question = load_question(sys.argv[1:])
    if not question:
        print(json.dumps({"error": "research question is required"}, ensure_ascii=False))
        return 2
    lower = question.lower()
    # A small transparent vocabulary bank is safer than pretending to have
    # exhaustively expanded an arbitrary scientific topic.
    blocks = []
    has_bivo4 = any(token in lower for token in ["bivo4", "bismuth vanadate"]) or "钒酸铋" in question
    has_hydrothermal = any(token in lower for token in ["hydrothermal", "solvothermal", "synthesis", "crystallization"]) or any(token in question for token in ["水热", "溶剂热", "合成", "晶化"])
    has_urea_control = any(token in lower for token in ["urea", "additive", "mineralizer", "structure-directing"]) or any(token in question for token in ["尿素", "添加剂", "矿化剂", "结构导向", "形貌调控", "晶面调控"])
    if has_bivo4:
        blocks.append(("material", ["BiVO4", "bismuth vanadate"], "Material block inferred from BiVO4/钒酸铋."))
    if has_hydrothermal:
        blocks.append(("synthesis route", ["hydrothermal", "solvothermal"], "For BiVO4 synthesis topics, keep the route block specific; generic synthesis/crystallization terms are too noisy for OpenAlex."))
    if has_urea_control:
        blocks.append(("additive/control", ["urea", "urea-assisted", "urea assisted", "additive", "mineralizer", "structure-directing agent"], "Additive/control block inferred from urea or morphology/facet regulation."))
    if any(token in lower for token in ["au", "gold", "plasmon", "lspr"]) or "金" in question or "等离激元" in question:
        blocks.append(("plasmonic metal", ["Au", "gold nanoparticle*", "gold nanostructure*", "plasmonic", "LSPR"], "Keep morphology as a separate optional block at discovery stage."))
    if any(token in lower for token in ["nanoparticle", "纳米", "sphere", "star", "cube", "rod", "形貌"]):
        blocks.append(("morphology", ["morpholog*", "shape-controlled", "nanorod*", "nanostar*", "nanocube*", "nanosphere*"], "Optional in v0 to avoid excluding studies with unreported shape."))
    if any(token in lower for token in ["semiconductor", "半导体", "tio2", "cds", "g-c3n4"]):
        blocks.append(("semiconductor", ["semiconductor*", "TiO2", "titania", "CdS", "g-C3N4", "graphitic carbon nitride"], "Inspect material-specific terms after the first record sample."))
    if any(token in lower for token in ["co2", "co₂", "carbon dioxide", "二氧化碳"]):
        blocks.append(("reaction", ["CO2 reduction", "carbon dioxide reduction", "CO2RR", "photoreduction of CO2"], "Exclude electroreduction only after inspecting noise."))
    if any(token in lower for token in ["visible", "可见光", "photocatal", "photoreduction", "photoexcitation", "light-driven", "illumination", "plasmon", "lspr"]) or any(token in question for token in ["光驱动", "光催化", "光激发", "等离激元"]):
        # Deliberately NOT optional: when the researcher's own question names a
        # light-driven/plasmonic mechanism, that is the criterion distinguishing
        # their topic from electrocatalytic literature sharing the same metal
        # and reaction vocabulary (e.g. "Au" + "CO2 reduction" alone is dominated
        # by electrochemical CO2RR). Treating this as optional-until-v1 let a
        # real run search Au+CO2-reduction with no light constraint at all and
        # pull back ~60 off-topic electrocatalysis papers out of 67 results.
        blocks.append(("illumination/process", ["photocatal*", "visible light", "photoreduction", "photoexcitation", "light-driven", "plasmon*", "LSPR", "illumination"], "Required in v0, not optional: this is the defining mechanism, not a shape/material refinement."))
    if not blocks:
        blocks.append(("topic", [question], "Unparsed topic; researcher must refine terms before database execution."))

    if has_bivo4 and has_hydrothermal and has_urea_control:
        blocks.append(("effect/readout", ["morphology", "facet", "crystal facet", "facet control", "morphology control", "crystal growth", "crystal structure", "010 facet", "110 facet"], "Strict refinement block used after sampling: separates the role/effect of urea from broad BiVO4 photocatalysis reviews."))

    required = [quoted(terms) for name, terms, _ in blocks if name not in ("morphology", "effect/readout")]
    optional = [quoted(terms) for name, terms, _ in blocks if name in ("morphology", "effect/readout")]
    v0 = " AND ".join(f"({part})" for part in required)
    v1_parts = required + optional
    v1 = " AND ".join(f"({part})" for part in v1_parts)
    query_variants = []
    if has_bivo4 and has_hydrothermal and has_urea_control:
        mat = quoted(["BiVO4", "bismuth vanadate"])
        route = quoted(["hydrothermal", "solvothermal"])
        urea_strict = quoted(["urea", "urea-assisted", "urea assisted"])
        urea_broad = quoted(["urea", "additive", "mineralizer", "structure-directing agent"])
        morphology = quoted(["morphology", "morphology control", "hierarchical", "nanostructure"])
        facet = quoted(["facet", "crystal facet", "facet control", "010 facet", "110 facet"])
        growth = quoted(["crystal growth", "crystal structure", "nucleation", "growth mechanism"])
        query_variants = [
            {
                "label": "strict-urea-core",
                "query": f"({mat}) AND ({route}) AND ({urea_strict})",
                "rationale": "Removes generic additive/mineralizer noise while preserving the user's urea-centered question."
            },
            {
                "label": "urea-morphology",
                "query": f"({mat}) AND ({urea_strict}) AND ({morphology})",
                "rationale": "Targets the role of urea in morphology regulation without forcing hydrothermal wording."
            },
            {
                "label": "urea-facet",
                "query": f"({mat}) AND ({urea_broad}) AND ({facet})",
                "rationale": "Targets facet/crystal-face regulation, using OpenAlex-friendly 010/110 facet wording instead of braces."
            },
            {
                "label": "urea-growth-mechanism",
                "query": f"({mat}) AND ({urea_broad}) AND ({growth})",
                "rationale": "Targets mechanistic discussions of nucleation/growth rather than broad photocatalysis reviews."
            }
        ]
    manifest = {
        "purpose": "broad discovery; recall prioritized until real records are inspected",
        "database_status": "database-neutral draft; not executed",
        "research_question": question,
        "concept_matrix": [{"block": name, "required_in_v0": name != "morphology", "terms": terms, "notes": note} for name, terms, note in blocks],
        "query_v0": v0,
        "query_v1_after_record_sampling": v1,
        "query_variants_after_record_sampling": query_variants,
        "refinement_plan": [
            "Run v0 in one named database and export the full search history and RIS/Bib/CSV records.",
            "Inspect included and excluded records; add one vocabulary change per version.",
            "Check that known seed papers are retrieved before using exclusions or a narrow morphology block."
        ],
        "search_log_template": ["version", "date", "database/collection/field", "query", "filters", "result_count", "sampled_records", "decision"],
        "assumptions": ["No hit count is claimed.", "Database field codes and proximity syntax must be verified on the chosen platform."]
    }
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
