import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('reviewer controls remain gated and checkout keeps its no-charge notice', () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  expect(source('../src/lib/reviewerTools.ts')).toContain("import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true'");
  const console = source('../src/console/Console.tsx');
  expect(console).toContain('reviewerToolsEnabled && manager(actor)');
  expect(console).not.toContain('DEMO WORKSPACE');
  const checkout = source('../src/components/Checkout.tsx');
  expect(checkout).toContain('reviewerToolsEnabled && principal?.emailVerified');
  expect(checkout).toContain('value="succeed_late"');
  expect(checkout).toContain('No charge will be made.');
});
