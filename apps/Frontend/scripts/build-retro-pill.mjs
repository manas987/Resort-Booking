// Compile only the copied component's utilities; the rest of the site stays plain CSS.
import { compile } from 'tailwindcss';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = resolve(root, 'src/components/retro-pill');
const theme = await readFile(fileURLToPath(import.meta.resolve('tailwindcss/theme.css')), 'utf8');
const animation = await readFile(resolve(root, 'node_modules/tw-animate-css/dist/tw-animate.css'), 'utf8');
const tokens = await readFile(resolve(folder, 'tokens.css'), 'utf8');
const candidates = new Set();
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.tsx?$/.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(/[^\s"'`{}]+/g)) candidates.add(match[0]);
    }
  }
}
await scan(folder);
const compiler = await compile(`@layer theme, base, components, utilities;\n${theme}\n${tokens}\n${animation}\n@tailwind utilities;`);
await writeFile(resolve(folder, 'styles.css'), compiler.build([...candidates]));
