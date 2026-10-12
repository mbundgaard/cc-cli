import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';
test('scaffold stays private with no sibling dependency, test/runtime/private files or publish workflow', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.private, true); assert.equal(pkg.name, '@muneris/cc-cli'); assert.equal(pkg.bin.cc, 'bin/cc.js');
  assert.ok(!pkg.files.some(file => /tests|src|references|CcCli\.json|\.local/.test(file)));
  assert.doesNotMatch(JSON.stringify(pkg.dependencies), /file:|BiCli|StsCli/);
  await assert.rejects(access('.github/workflows/publish.yml'));
});
test('local documentation links resolve', async () => {
  const files = ['README.md', ...((await readdir('docs')).filter(file => file.endsWith('.md')).map(file => 'docs/' + file))];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(match[1])) continue;
      await assert.doesNotReject(access(path.resolve(path.dirname(file), match[1].split('#')[0])), `${file}: ${match[1]}`);
    }
  }
});
