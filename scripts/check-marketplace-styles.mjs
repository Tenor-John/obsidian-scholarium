import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rule = 'obsidianmd/no-static-styles-assignment';
const linter = new Linter();
const config = [{
  files: ['**/*.ts'],
  languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
  plugins: { obsidianmd },
  rules: { [rule]: 'error' },
}];
const check = (code, filename) => linter.verify(code, config, { filename }).filter(message => message.ruleId === rule || message.fatal);
// Prove the actual marketplace rule catches a deliberately invalid assignment.
if (!check('const progress = document.createElement("progress"); progress.style.width = "100%";', 'control.ts').some(message => message.ruleId === rule)) {
  throw new Error('Marketplace style rule did not detect its negative control');
}
if (check('const progress = document.createElement("progress"); progress.classList.add("sch-matrix-progress");', 'control.ts').length) {
  throw new Error('Class-based styling must pass the marketplace rule');
}
function files(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(folder, entry.name);
    return entry.isDirectory() ? files(target) : entry.name.endsWith('.ts') ? [target] : [];
  });
}
const sources = files(path.join(root, 'src'));
const failures = sources.flatMap(file => check(fs.readFileSync(file, 'utf8'), path.relative(root, file).replaceAll('\\', '/')).map(message => `${path.relative(root, file)}:${message.line}:${message.column} ${message.message}`));
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Marketplace style rule passed for ${sources.length} source files; negative control verified.`);
