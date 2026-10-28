// check-links.mjs: relative links and anchors in the Markdown, as GitHub resolves them.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { anchors, brokenLinks, links, slug } from './check-links.mjs';

test('a heading id is GitHub’s: lower case, punctuation dropped, spaces to dashes', () => {
  assert.equal(slug('Reviewing `.psig` changes in git'), 'reviewing-psig-changes-in-git');
  assert.equal(slug('`pxsig approve`'), 'pxsig-approve');
  assert.equal(slug('What the workflow does'), 'what-the-workflow-does');
  assert.equal(slug('Setup: Node 22.18+ & [Rust](https://x)'), 'setup-node-2218--rust');
  assert.equal(slug('Café_au lait'), 'café_au-lait');
});

test('anchors: headings outside code, repeats numbered, declared ids', () => {
  const a = anchors(
    '# Title\n\n## Usage\n\n```\n## Not a heading\n```\n\n## Usage\n\n<a id="custom"></a>\n'
  );
  assert.deepEqual([...a].sort(), ['custom', 'title', 'usage', 'usage-1']);
});

test('links: inline, images, reference definitions and href, not inside code', () => {
  const found = links(
    [
      'See [a](a.md#x "title") and ![i](img/i.png).',
      '`[not](a link)` and <a href="b.md">b</a>',
      '[ref]: ../c.md',
      '```',
      '[nor](this.md)',
      '```',
    ].join('\n')
  ).map((l) => `${l.line} ${l.target}`);
  assert.deepEqual(found, ['1 a.md#x', '1 img/i.png', '2 b.md', '3 ../c.md']);
});

test('a missing file or anchor is broken; external links and folders are not checked', () => {
  const md = new Map([
    [
      'docs/a.md',
      [
        '# A',
        '## `env`',
        '[ok](b.md#b-heading) [ok](#env) [ok](../README.md) [ok](../scripts) [ok](b.md)',
        '[ext](https://example.com/x.md#nope) [mail](mailto:x@y.z) [abs](/somewhere)',
        '[gone](missing.md) [bad anchor](b.md#nope) [here](#nope) [code](../scripts/x.mjs#L3)',
      ].join('\n'),
    ],
    ['docs/b.md', '# B heading\n'],
    ['README.md', '[up](../outside.md)\n'],
  ]);
  const tracked = new Set([...md.keys(), 'scripts/x.mjs']);
  assert.deepEqual(brokenLinks(md, tracked), [
    'docs/a.md:5: missing.md: no such file',
    'docs/a.md:5: b.md#nope: no heading or id "nope" in docs/b.md',
    'docs/a.md:5: #nope: no heading or id "nope" in docs/a.md',
    'README.md:1: ../outside.md: no such file',
  ]);
});
