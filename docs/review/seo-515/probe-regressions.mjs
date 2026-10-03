// Run: node probe-regressions.mjs /absolute/path/to/engine
// Read-only acceptance checks: no HTTP requests or database writes.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

if (!process.argv[2]) throw new Error('Pass the engine directory');
process.env.SEO_PROBE_SELFTEST = '1';
const { checkSeo } = await import(pathToFileURL(resolve(process.argv[2], 'deploy/lib/probe-seo.mjs')));
const base = {
  llms: { status: 200, text: '# Site\n- [Page](https://site.test/about)' },
  sitemap: { status: 200, text: '<urlset><url><loc>https://site.test/about</loc><lastmod>2026-09-20</lastmod></url></urlset>' },
  home: { status: 200, text: '<script type="application/ld+json">{"@type":"WebPage","dateModified":"2026-09-20"}</script>' },
  ownHost: 'site.test',
  probe: async () => 200,
};
test('healthy input passes', async () => {
  assert.deepEqual(await checkSeo(base), { bad: [], checked: 1 });
});
for (const [name, delta] of Object.entries({
  'invalid dateModified must be rejected': {
    home: { status: 200, text: '<script type="application/ld+json">{"dateModified":"not-a-date"}</script>' },
  },
  'invalid lastmod must be rejected': {
    sitemap: { status: 200, text: '<urlset><url><loc>https://site.test/about</loc><lastmod>garbage</lastmod></url></urlset>' },
  },
  'relative llms link must not silently pass unchecked': {
    llms: { status: 200, text: '# Site\n- [Page](/about)' },
  },
})) {
  test(name, async () => {
    const result = await checkSeo({ ...base, ...delta });
    assert.ok(result.bad.length > 0, `False success: ${JSON.stringify(result)}`);
  });
}
