import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { DateInput, Select } from '../src/components/FormControls';
import { LoadingSkeleton } from '../src/components/LoadingSkeleton';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('styled dropdown preserves selected value, options, required and disabled form semantics', () => {
  const html = renderToStaticMarkup(<Select aria-label="Status" name="status" value="in_progress" required disabled onChange={() => {}}>
    <option value="new">New</option><option value="in_progress">In progress</option>
  </Select>);
  expect(html).toContain('role="combobox"');
  expect(html).toContain('aria-label="Status"');
  expect(html).toContain('name="status"');
  expect(html).toContain('value="in_progress" selected');
  expect(html).toContain('required=""');
  expect(html).toContain('disabled=""');
  expect(html).toContain('form-native');
});

test('date field preserves historical value, bounds and required form validation', () => {
  const html = renderToStaticMarkup(<DateInput name="from" value="2025-01-04" min="2024-01-01" max="2026-12-31" required onChange={() => {}} />);
  expect(html).toContain('4 Jan 2025');
  expect(html).toContain('value="2025-01-04"');
  expect(html).toContain('min="2024-01-01"');
  expect(html).toContain('max="2026-12-31"');
  expect(html).toContain('required=""');
  expect(source('../src/components/FormControls.tsx')).toContain("from './retro-pill/components/ui/calendar'");
  expect(renderToStaticMarkup(<DateInput value="2026-99-99" onChange={() => {}} />)).toContain('Choose date');
});

test('console pages use shared controls instead of browser-native visible menus or date popups', () => {
  for (const file of readdirSync(new URL('../src/console', import.meta.url)).filter((name) => name.endsWith('.tsx'))) {
    const text = source(`../src/console/${file}`);
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        expect(node.tagName.getText(ast), file).not.toBe('select');
        if (node.tagName.getText(ast) === 'input') {
          expect(node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'type'
            && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === 'date'), file).toBe(false);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
});

test('skeletons announce loading once and hide decorative blocks from assistive technology', () => {
  const html = renderToStaticMarkup(<LoadingSkeleton label="Loading enquiries" variant="table" rows={5} />);
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('aria-hidden="true"');
  expect(html.match(/class="loading-skeleton-block"/g)).toHaveLength(5);
  expect(source('../src/components/loading-skeleton.css')).toContain('prefers-reduced-motion:reduce');
});

test('rates table does not reuse the legacy seven-column calendar container', () => {
  const rates = source('../src/console/RatesLive.tsx');
  expect(rates).toContain('className="c-rate-dates-section"');
  expect(rates).not.toContain('className="c-rate-calendar"');
  expect(source('../src/console/console.css')).toContain('.console .c-rate-dates-section{display:block;width:100%;min-width:0}');
});
