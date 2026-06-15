import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const forbidden = [
    [/:root\b/, 'Global :root variables'],
    [/\.workspace-tab(?:s|-)/, 'Obsidian workspace tab selectors'],
    [/\.workspace-split\b/, 'Obsidian workspace split selectors'],
    [/\.mod-root\b/, 'Obsidian root workspace selectors'],
    [/^\s*body\.(?!scholarium-)/m, 'Non-Scholarium body selectors'],
];

const failures = forbidden
    .filter(([pattern]) => pattern.test(css))
    .map(([, description]) => description);

if (failures.length > 0) {
    console.error(`styles.css contains selectors that can leak into Obsidian or other plugins:\n- ${failures.join('\n- ')}`);
    process.exit(1);
}

console.log('Style scope check passed.');
