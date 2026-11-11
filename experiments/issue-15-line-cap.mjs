// Reproduction from issue #15 (extended): every exported file must respect maxLines.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { partitionMessages, writeParts } from '../history-to-markdown.mjs';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-line-cap-'));
try {
  const message = { id: 1, date: '2026-01-01 00:00:00', senderId: '7', text: Array(1500).fill('a').join('\n') };
  for (const meta of [null, { timestamp: 't', mode: 'm' }]) {
    const parts = partitionMessages([message], { '7': 'Alice' }, 1500, { hasExportMeta: !!meta });
    writeParts(parts, directory, 'history', meta);
    for (const f of fs.readdirSync(directory)) {
      const lines = fs.readFileSync(path.join(directory, f), 'utf8').split(/\r\n|\r|\n/).length;
      console.log({ f, lines, maxLines: 1500 });
      assert.ok(lines <= 1500, `${f} contains ${lines} physical lines`);
    }
    for (const f of fs.readdirSync(directory)) fs.rmSync(path.join(directory, f));
  }
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
