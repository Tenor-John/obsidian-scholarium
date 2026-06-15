let svgInstanceId = 0;

export function namespaceSvgIds(svg: SVGSVGElement): void {
    const prefix = `sch-chem-${++svgInstanceId}-`;
    const ids = new Map<string, string>();

    svg.querySelectorAll<SVGMarkerElement>('marker[id]').forEach((element) => {
        const oldId = element.id;
        if (!oldId) return;
        const newId = `${prefix}${oldId}`;
        ids.set(oldId, newId);
        element.id = newId;
    });

    if (ids.size === 0) return;

    svg.querySelectorAll<SVGElement>('*').forEach((element) => {
        for (const attr of Array.from(element.attributes)) {
            const next = rewriteSvgIdReferences(attr.value, ids);
            if (next !== attr.value) element.setAttribute(attr.name, next);
        }
    });
}

function rewriteSvgIdReferences(value: string, ids: Map<string, string>): string {
    let next = value;
    for (const [oldId, newId] of ids) {
        next = next.split(`url(#${oldId})`).join(`url(#${newId})`);
        if (next === `#${oldId}`) next = `#${newId}`;
    }
    return next;
}
