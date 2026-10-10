#!/usr/bin/env python3
"""Small JSON-line chemistry gate used by the Research Weaver bridge.

This is deliberately a validator, not a reaction predictor: it never invents
products, coefficients, conditions, or missing by-products.
"""
import json
import sys
from collections import Counter


def formula_and_charge(smiles):
    from rdkit import Chem

    mol = Chem.MolFromSmiles(smiles, sanitize=True)
    if mol is None:
        raise ValueError("invalid_smiles")
    counts = Counter()
    for atom in mol.GetAtoms():
        counts[atom.GetSymbol()] += 1
        total_h = atom.GetTotalNumHs()
        if total_h:
            counts["H"] += int(total_h)
    charge = sum(atom.GetFormalCharge() for atom in mol.GetAtoms())
    return dict(sorted(counts.items())), int(charge)


def validate(payload):
    kind = payload.get("kind", "reaction")
    value = str(payload.get("reaction_smiles") or payload.get("smiles") or "").strip()
    if not value:
        return {"valid": False, "status": "invalid", "errors": ["chem_structure_required"]}

    try:
        if kind == "molecule" or ">" not in value:
            formula, charge = formula_and_charge(value)
            return {
                "valid": True,
                "balanced": None,
                "status": "valid_structure",
                "formula": formula,
                "charge": charge,
            }

        parts = value.split(">")
        if len(parts) == 2:
            reactant_text, product_text = parts
        elif len(parts) == 3:
            reactant_text, _, product_text = parts
        else:
            return {"valid": False, "status": "invalid", "errors": ["reaction_arrow_invalid"]}
        reactants = [item for item in reactant_text.split(".") if item]
        products = [item for item in product_text.split(".") if item]
        if not reactants or not products:
            return {"valid": False, "status": "invalid", "errors": ["reaction_side_empty"]}

        left = Counter()
        right = Counter()
        left_charge = 0
        right_charge = 0
        formulas = {"reactants": [], "products": []}
        for item in reactants:
            formula, charge = formula_and_charge(item)
            left.update(formula)
            left_charge += charge
            formulas["reactants"].append({"smiles": item, "formula": formula, "charge": charge})
        for item in products:
            formula, charge = formula_and_charge(item)
            right.update(formula)
            right_charge += charge
            formulas["products"].append({"smiles": item, "formula": formula, "charge": charge})

        delta = {element: left[element] - right[element]
                 for element in sorted(set(left) | set(right))
                 if left[element] != right[element]}
        charge_delta = left_charge - right_charge
        balanced = not delta and charge_delta == 0
        return {
            "valid": True,
            "balanced": balanced,
            "status": "balanced" if balanced else "unbalanced",
            "reactants": formulas["reactants"],
            "products": formulas["products"],
            "element_delta": delta,
            "charge_delta": charge_delta,
        }
    except ImportError:
        return {"valid": False, "status": "unavailable", "errors": ["rdkit_unavailable"]}
    except Exception as exc:  # noqa: BLE001 - return a stable bridge result
        return {"valid": False, "status": "invalid", "errors": [str(exc)[:240]]}


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        print(json.dumps(validate(payload), ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"valid": False, "status": "invalid", "errors": [str(exc)[:240]]}, ensure_ascii=False))
        raise SystemExit(0)


if __name__ == "__main__":
    main()
