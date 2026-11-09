// 3A exit criteria: prove wouter's static-location (ssrPath) path renders without throwing,
// before 3G's prerender script is built four sub-phases later. Not the real prerender —
// just the smoke test. Run with: bun scripts/ssr-smoke.tsx
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import { Router } from 'wouter';
import App from '../src/App.tsx';

const html = renderToString(
  <Router ssrPath="/" ssrSearch="">
    <App />
  </Router>,
);

assert.ok(html.includes('THE QUIET ESTATE'), 'home route did not render server-side');
assert.ok(html.includes('A slower kind of stay.'), 'hero copy missing from SSR output');
console.log(`SSR smoke OK — ${html.length} chars rendered for "/"`);
