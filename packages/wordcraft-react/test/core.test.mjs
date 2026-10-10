import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mimeTypeFor, exportName, toBytes, createWordcraft } from '../dist/core.js';

test('export names', () => {
  assert.equal(exportName('docx'), 'document.docx');
  assert.equal(exportName('report.pdf'), 'report.pdf');
});

test('mime types', () => {
  assert.equal(mimeTypeFor('docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(mimeTypeFor('a.PDF'), 'application/pdf');
  assert.equal(mimeTypeFor('weird'), 'application/octet-stream');
});

test('toBytes accepts ArrayBuffer, Uint8Array and Blob', async () => {
  assert.deepEqual(await toBytes(new Uint8Array([1, 2]).buffer), new Uint8Array([1, 2]));
  assert.deepEqual(await toBytes(new Blob([new Uint8Array([3])])), new Uint8Array([3]));
});

test('module is safe to import on the server and refuses to mount there', async () => {
  await assert.rejects(() => createWordcraft({}), /needs a browser/);
});
