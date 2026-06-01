// icons.ts — Lucide-style inline SVG icon registry (ported from prototype components.jsx SCHOLARIUM_ICONS)
// Stored as inner-SVG markup strings; rendered into a stroked <svg> via iconSvg().

export const SCHOLARIUM_ICONS: Record<string, string> = {
    // file / system
    flask:        '<path d="M9 3h6"/><path d="M10 3v6.5L4.5 18A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.8-3L14 9.5V3"/><path d="M7 14h10"/>',
    notebook:     '<path d="M5 4h12a2 2 0 0 1 2 2v14a1 1 0 0 1-1.4.9L12 18l-5.6 2.9A1 1 0 0 1 5 20V4z"/><path d="M9 4v12"/>',
    workspace:    '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M9 18v2"/><path d="M15 18v2"/>',
    folder:       '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
    tool:         '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4 2.6-2.6z"/>',
    search:       '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus:         '<path d="M12 5v14"/><path d="M5 12h14"/>',
    more:         '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    close:        '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    chevronDown:  '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    chevronLeft:  '<path d="m15 6-6 6 6 6"/>',
    // workspace
    today:        '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 3v4"/><path d="M16 3v4"/><circle cx="12" cy="14" r="2"/>',
    inbox:        '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    project:      '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    thesis:       '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5a2.5 2.5 0 0 0 0 5H20"/><path d="M9 7h7"/><path d="M9 11h7"/>',
    submit:       '<path d="m22 2-11 11"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>',
    mentor:       '<circle cx="12" cy="7" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/><path d="m8 18 4 3 4-3"/>',
    habit:        '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    mind:         '<path d="M12 2v8"/><path d="M12 14v8"/><path d="M5 5l4 4"/><path d="M15 15l4 4"/><path d="M5 19l4-4"/><path d="M15 9l4-4"/><circle cx="12" cy="12" r="2"/>',
    review:       '<path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
    trophy:       '<path d="M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 4H4a2 2 0 0 0-2 2v1a4 4 0 0 0 4 4"/><path d="M17 4h3a2 2 0 0 1 2 2v1a4 4 0 0 1-4 4"/><path d="M9 17h6"/><path d="M12 13v4"/><path d="M8 21h8"/>',
    chart:        '<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-7"/>',
    settings:     '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    // micro
    play:         '<polygon points="6 4 20 12 6 20 6 4"/>',
    pause:        '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    stop:         '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    clock:        '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendar:     '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    check:        '<path d="M5 12l5 5L20 7"/>',
    bolt:         '<path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z"/>',
    sparkle:      '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M5.5 18.5l2.8-2.8M15.7 8.3l2.8-2.8"/>',
    filter:       '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    list:         '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    grid:         '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    timeline:     '<path d="M3 12h18"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/>',
    arrowRight:   '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    user:         '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    bookmark:     '<path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    pin:          '<path d="m12 17 .01 5"/><path d="m18 9-6-6-6 6 2 2v3l-3 3h14l-3-3v-3l2-2z"/>',
    flame:        '<path d="M12 22c4-1 7-4 7-8 0-3-2-5-4-7-2 2-2 5-4 5-2 0-2-3-3-4-2 2-3 4-3 7 0 4 3 7 7 7z"/>',
    link:         '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19"/>',
    star:         '<polygon points="12 2 15 9 22 10 17 15 18 22 12 18.5 6 22 7 15 2 10 9 9 12 2"/>',
    send:         '<path d="m22 2-7 20-4-9-9-4 20-7z"/>',
    upload:       '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    image:        '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    pdf:          '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    panel:        '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    scale:        '<path d="M3 6h18"/><path d="m16 6 3 8a4 4 0 1 1-8 0z"/><path d="m8 6-3 8a4 4 0 1 0 8 0z"/><path d="M12 3v18"/>',
    spark:        '<polyline points="3 17 9 11 13 15 21 7"/>',
    obsidian:     '<path d="M12 2 4 7v10l8 5 8-5V7l-8-5z"/>',
    gem:          '<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18"/>',
    dot:          '<circle cx="12" cy="12" r="4"/>',
    warn:         '<path d="M12 9v4"/><circle cx="12" cy="17" r=".5"/><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
    database:     '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    rss:          '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
    refresh:      '<path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3L3 16"/><path d="M3 21v-5h5"/>',
    trash:        '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    globe:        '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
    cloud:        '<path d="M17.5 19a4.5 4.5 0 1 0-1-8.9A6 6 0 0 0 4 13a5 5 0 0 0 5 6h8.5z"/>',
    brain:        '<path d="M9 4a3 3 0 0 0-3 3v.5"/><path d="M6 7.5a3 3 0 0 0-3 3"/><path d="M3 10.5a3 3 0 0 0 3 3"/><path d="M6 13.5a3 3 0 0 0 3 3"/><path d="M9 16.5a3 3 0 0 0 3 3 3 3 0 0 0 3-3"/><path d="M15 16.5a3 3 0 0 0 3-3"/><path d="M18 13.5a3 3 0 0 0 3-3"/><path d="M21 10.5a3 3 0 0 0-3-3"/><path d="M18 7.5a3 3 0 0 0-3-3 3 3 0 0 0-3 3"/><path d="M12 4.5v15"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface IconOptions {
    size?: number;
    stroke?: number;
}

/** Create a stroked <svg> element for the named icon (currentColor stroke). */
export function iconSvg(name: string, opts: IconOptions = {}): SVGSVGElement {
    const size = opts.size ?? 16;
    const stroke = opts.stroke ?? 1.75;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(stroke));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.flexShrink = '0';
    const inner = SCHOLARIUM_ICONS[name];
    if (inner) svg.innerHTML = inner;
    return svg;
}

/** Append a named icon into a parent element and return the svg. */
export function appendIcon(parent: HTMLElement, name: string, opts: IconOptions = {}): SVGSVGElement {
    const svg = iconSvg(name, opts);
    parent.appendChild(svg);
    return svg;
}
