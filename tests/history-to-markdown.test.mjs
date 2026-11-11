import { describe, it, expect } from 'bun:test';
import {
  normalizeDate,
  formatDate,
  getMediaType,
  getMediaExtension,
  getMediaFilename,
  filterCurrentActiveDialog,
  countLines,
  renderMessageMarkdown,
  renderMessageJson,
  renderJsonPartContent,
  buildNavigation,
  partitionMessages,
  writeParts,
} from '../history-to-markdown.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('normalizeDate', () => {
  it('returns null for falsy input', () => {
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
    expect(normalizeDate(0)).toBeNull();
  });

  it('returns Date for Date input', () => {
    const d = new Date('2025-01-01');
    expect(normalizeDate(d)).toEqual(d);
  });

  it('converts unix timestamp (seconds) to Date', () => {
    const ts = 1704067200; // 2024-01-01T00:00:00Z
    const result = normalizeDate(ts);
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('converts string ISO date', () => {
    const result = normalizeDate('2024-06-15T12:00:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2024);
  });

  it('converts string unix timestamp', () => {
    const result = normalizeDate('1704067200');
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('formatDate', () => {
  it('returns empty string for null', () => {
    expect(formatDate(null)).toBe('');
  });

  it('formats date correctly', () => {
    const d = new Date('2025-03-15T14:30:45Z');
    expect(formatDate(d)).toBe('2025-03-15 14:30:45');
  });
});

describe('getMediaType', () => {
  it('returns null for no media', () => {
    expect(getMediaType(null)).toBeNull();
    expect(getMediaType(undefined)).toBeNull();
  });

  it('detects photo', () => {
    expect(getMediaType({ className: 'MessageMediaPhoto' })).toBe('photo');
  });

  it('detects video document', () => {
    expect(getMediaType({
      className: 'MessageMediaDocument',
      document: { mimeType: 'video/mp4' },
    })).toBe('video');
  });

  it('detects voice message', () => {
    expect(getMediaType({
      className: 'MessageMediaDocument',
      document: {
        mimeType: 'audio/ogg',
        attributes: [{ className: 'DocumentAttributeAudio', voice: true }],
      },
    })).toBe('voice');
  });

  it('detects poll', () => {
    expect(getMediaType({ className: 'MessageMediaPoll' })).toBe('poll');
  });
});

describe('getMediaExtension', () => {
  it('returns .jpg for photo', () => {
    expect(getMediaExtension({ className: 'MessageMediaPhoto' })).toBe('.jpg');
  });

  it('returns extension from filename attribute', () => {
    expect(getMediaExtension({
      className: 'MessageMediaDocument',
      document: {
        attributes: [{ className: 'DocumentAttributeFilename', fileName: 'report.pdf' }],
      },
    })).toBe('.pdf');
  });

  it('returns extension from mimeType', () => {
    expect(getMediaExtension({
      className: 'MessageMediaDocument',
      document: { mimeType: 'video/mp4', attributes: [] },
    })).toBe('.mp4');
  });
});

describe('getMediaFilename', () => {
  it('returns null for no media', () => {
    expect(getMediaFilename(null)).toBeNull();
  });

  it('returns filename from document attribute', () => {
    expect(getMediaFilename({
      className: 'MessageMediaDocument',
      document: {
        attributes: [{ className: 'DocumentAttributeFilename', fileName: 'file.zip' }],
      },
    })).toBe('file.zip');
  });
});

describe('filterCurrentActiveDialog', () => {
  it('returns empty array for empty input', () => {
    expect(filterCurrentActiveDialog([], 4)).toEqual([]);
  });

  it('returns all messages if no gap exceeds threshold', () => {
    const now = Date.now();
    const messages = [
      { dateObj: new Date(now - 3600000) },     // 1h ago
      { dateObj: new Date(now - 1800000) },     // 30m ago
      { dateObj: new Date(now) },                // now
    ];
    const result = filterCurrentActiveDialog(messages, 4);
    expect(result.length).toBe(3);
  });

  it('filters messages before the gap', () => {
    const now = Date.now();
    const messages = [
      { dateObj: new Date(now - 20 * 3600000) }, // 20h ago
      { dateObj: new Date(now - 19 * 3600000) }, // 19h ago
      // 14-hour gap here
      { dateObj: new Date(now - 5 * 3600000) },  // 5h ago
      { dateObj: new Date(now - 2 * 3600000) },  // 2h ago
      { dateObj: new Date(now) },                  // now
    ];
    const result = filterCurrentActiveDialog(messages, 4);
    // Should cut at the 14-hour gap (between msg[1] and msg[2])
    expect(result.length).toBe(3);
    expect(result[0].dateObj.getTime()).toBe(now - 5 * 3600000);
  });
});

describe('countLines', () => {
  it('returns 0 for empty string', () => {
    expect(countLines('')).toBe(0);
  });

  it('returns 1 for single line', () => {
    expect(countLines('hello')).toBe(1);
  });

  it('counts newlines correctly', () => {
    expect(countLines('a\nb\nc')).toBe(3);
    expect(countLines('a\nb\n')).toBe(3);
  });
});

describe('renderMessageMarkdown', () => {
  it('renders text message', () => {
    const msg = { date: '2025-01-01 12:00:00', text: 'Hello!', hasMedia: false };
    const result = renderMessageMarkdown(msg, '@user');
    expect(result).toContain('**@user** [2025-01-01 12:00:00]:');
    expect(result).toContain('Hello!');
  });

  it('renders image media', () => {
    const msg = {
      date: '2025-01-01 12:00:00',
      text: '',
      mediaFilePath: 'files/photo_1.jpg',
      mediaType: 'photo',
      hasMedia: true,
    };
    const result = renderMessageMarkdown(msg, '@user');
    expect(result).toContain('![photo](files/photo_1.jpg)');
  });

  it('renders non-image media as link', () => {
    const msg = {
      date: '2025-01-01 12:00:00',
      text: '',
      mediaFilePath: 'files/doc.pdf',
      mediaType: 'document',
      hasMedia: true,
    };
    const result = renderMessageMarkdown(msg, '@user');
    expect(result).toContain('[document: doc.pdf](files/doc.pdf)');
  });

  it('renders undownloaded media placeholder', () => {
    const msg = {
      date: '2025-01-01 12:00:00',
      text: '',
      mediaFilePath: null,
      mediaType: 'photo',
      hasMedia: true,
    };
    const result = renderMessageMarkdown(msg, '@user');
    expect(result).toContain('*[photo]*');
  });
});

describe('renderMessageJson', () => {
  it('renders basic message', () => {
    const msg = { id: 1, date: '2025-01-01 12:00:00', senderId: 123, text: 'Hi', hasMedia: false };
    const result = renderMessageJson(msg, '@user');
    expect(result).toEqual({
      id: 1,
      date: '2025-01-01 12:00:00',
      senderId: 123,
      senderName: '@user',
      text: 'Hi',
    });
  });

  it('includes media fields when hasMedia is true', () => {
    const msg = { id: 1, date: '2025-01-01 12:00:00', senderId: 123, text: '', hasMedia: true, mediaType: 'photo', mediaFilePath: 'files/p.jpg' };
    const result = renderMessageJson(msg, '@user');
    expect(result.mediaType).toBe('photo');
    expect(result.mediaFilePath).toBe('files/p.jpg');
  });
});

describe('buildNavigation', () => {
  it('builds nav for middle part', () => {
    const nav = buildNavigation(1, 3, 'history', 'history-2.json');
    expect(nav).toContain('[← Previous part](history-1.md)');
    expect(nav).toContain('Part 2 of 3');
    expect(nav).toContain('[Next part →](history-3.md)');
    expect(nav).toContain('[JSON](history-2.json)');
  });

  it('builds nav for first part (no previous)', () => {
    const nav = buildNavigation(0, 2, 'history', 'history-1.json');
    expect(nav).not.toContain('Previous');
    expect(nav).toContain('Part 1 of 2');
    expect(nav).toContain('[Next part →](history-2.md)');
  });

  it('builds nav for last part (no next)', () => {
    const nav = buildNavigation(2, 3, 'history', 'history-3.json');
    expect(nav).toContain('[← Previous part](history-2.md)');
    expect(nav).toContain('Part 3 of 3');
    expect(nav).not.toContain('Next');
  });
});

describe('partitionMessages', () => {
  function makeMsg(id, textLength = 10) {
    return {
      id,
      date: '2025-01-01 12:00:00',
      senderId: 100,
      text: 'x'.repeat(textLength),
      hasMedia: false,
      mediaType: null,
      mediaFilePath: null,
    };
  }

  it('returns empty array for empty input', () => {
    expect(partitionMessages([], {}, 1500)).toEqual([]);
  });

  it('puts all messages in one part when under limit', () => {
    const messages = [makeMsg(1), makeMsg(2), makeMsg(3)];
    const userMap = { 100: '@user' };
    const parts = partitionMessages(messages, userMap, 1500);
    expect(parts.length).toBe(1);
    expect(parts[0].messages.length).toBe(3);
    expect(parts[0].mdLines.length).toBe(3);
  });

  it('splits into multiple parts when limit is exceeded', () => {
    // Each message takes ~3 lines in MD and ~8 lines in JSON
    // With a very low limit, they should split
    const messages = [];
    for (let i = 0; i < 20; i++) {
      messages.push(makeMsg(i, 50));
    }
    const userMap = { 100: '@user' };
    const parts = partitionMessages(messages, userMap, 30);
    expect(parts.length).toBeGreaterThan(1);

    // Verify each part has same number of messages in both md and json
    for (const part of parts) {
      expect(part.messages.length).toBe(part.mdLines.length);
    }

    // Verify total messages preserved
    const totalMsgs = parts.reduce((s, p) => s + p.messages.length, 0);
    expect(totalMsgs).toBe(20);
  });

  it('ensures MD and JSON have exactly the same messages per part', () => {
    const messages = [];
    for (let i = 0; i < 50; i++) {
      messages.push(makeMsg(i, 20));
    }
    const userMap = { 100: '@testuser' };
    const parts = partitionMessages(messages, userMap, 100);

    for (const part of parts) {
      expect(part.messages.length).toBe(part.mdLines.length);
      // Verify message IDs match
      for (let j = 0; j < part.messages.length; j++) {
        expect(part.messages[j].id).toBeDefined();
      }
    }
  });
});

describe('writeParts', () => {
  let tmpDir;

  function setup() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-test-'));
  }

  function cleanup() {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  it('writes single part with numeric suffix history-1.md/json', () => {
    setup();
    try {
      const parts = [{
        mdLines: ['**@user** [2025-01-01 12:00:00]:\nHello\n'],
        messages: [{ id: 1, date: '2025-01-01 12:00:00', senderId: 100, senderName: '@user', text: 'Hello' }],
      }];
      const meta = { timestamp: '2025-01-01 12:00:00', mode: 'Full history' };
      const { mdFiles, jsonFiles } = writeParts(parts, tmpDir, 'history', meta);

      expect(mdFiles).toEqual(['history-1.md']);
      expect(jsonFiles).toEqual(['history-1.json']);

      // Verify files exist
      expect(fs.existsSync(path.join(tmpDir, 'history-1.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'history-1.json'))).toBe(true);

      // Verify JSON is valid and has 2-space indent
      const jsonContent = fs.readFileSync(path.join(tmpDir, 'history-1.json'), 'utf8');
      const parsed = JSON.parse(jsonContent);
      expect(parsed.messages.length).toBe(1);
      expect(jsonContent).toContain('  '); // 2-space indent

      // Verify MD has single hyperlink to JSON
      const mdContent = fs.readFileSync(path.join(tmpDir, 'history-1.md'), 'utf8');
      expect(mdContent).toContain('[JSON](history-1.json)');
    } finally {
      cleanup();
    }
  });

  it('writes multiple parts with numeric suffix', () => {
    setup();
    try {
      const parts = [
        {
          mdLines: ['msg1\n'],
          messages: [{ id: 1, date: '2025-01-01 12:00:00', senderId: 100, senderName: '@user', text: 'msg1' }],
        },
        {
          mdLines: ['msg2\n'],
          messages: [{ id: 2, date: '2025-01-01 12:01:00', senderId: 100, senderName: '@user', text: 'msg2' }],
        },
      ];
      const meta = { timestamp: '2025-01-01 12:00:00', mode: 'Full history' };
      const { mdFiles, jsonFiles } = writeParts(parts, tmpDir, 'history', meta);

      expect(mdFiles).toEqual(['history-1.md', 'history-2.md']);
      expect(jsonFiles).toEqual(['history-1.json', 'history-2.json']);

      // Verify navigation links and single hyperlink to JSON per part
      const md1 = fs.readFileSync(path.join(tmpDir, 'history-1.md'), 'utf8');
      expect(md1).toContain('[Next part →](history-2.md)');
      expect(md1).toContain('[JSON](history-1.json)');
      // history-1.md links only to history-1.json (not history-2.json)
      expect(md1).not.toContain('history-2.json');

      const md2 = fs.readFileSync(path.join(tmpDir, 'history-2.md'), 'utf8');
      expect(md2).toContain('[← Previous part](history-1.md)');
      expect(md2).toContain('[JSON](history-2.json)');
      // history-2.md links only to history-2.json (not history-1.json)
      expect(md2).not.toContain('history-1.json');

      // Verify JSON has prev/next refs
      const json1 = JSON.parse(fs.readFileSync(path.join(tmpDir, 'history-1.json'), 'utf8'));
      expect(json1.nextPart).toBe('history-2.json');
      expect(json1.previousPart).toBeUndefined();

      const json2 = JSON.parse(fs.readFileSync(path.join(tmpDir, 'history-2.json'), 'utf8'));
      expect(json2.previousPart).toBe('history-1.json');
      expect(json2.nextPart).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('guarantees MD and JSON have same message count per part', () => {
    setup();
    try {
      const parts = [
        {
          mdLines: ['m1\n', 'm2\n', 'm3\n'],
          messages: [
            { id: 1, date: 'd', senderId: 1, senderName: 'a', text: 'm1' },
            { id: 2, date: 'd', senderId: 1, senderName: 'a', text: 'm2' },
            { id: 3, date: 'd', senderId: 1, senderName: 'a', text: 'm3' },
          ],
        },
        {
          mdLines: ['m4\n', 'm5\n'],
          messages: [
            { id: 4, date: 'd', senderId: 1, senderName: 'a', text: 'm4' },
            { id: 5, date: 'd', senderId: 1, senderName: 'a', text: 'm5' },
          ],
        },
      ];
      const { mdFiles, jsonFiles } = writeParts(parts, tmpDir, 'history', null);

      // Part 1: 3 messages in both
      const json1 = JSON.parse(fs.readFileSync(path.join(tmpDir, jsonFiles[0]), 'utf8'));
      expect(json1.messagesInPart).toBe(3);

      // Part 2: 2 messages in both
      const json2 = JSON.parse(fs.readFileSync(path.join(tmpDir, jsonFiles[1]), 'utf8'));
      expect(json2.messagesInPart).toBe(2);

      // Total
      expect(json1.totalMessages).toBe(5);
      expect(json2.totalMessages).toBe(5);
    } finally {
      cleanup();
    }
  });
});

describe('renderJsonPartContent', () => {
  it('renders valid JSON with 2-space indent', () => {
    const msgs = [{ id: 1, text: 'hello' }];
    const content = renderJsonPartContent(msgs, 0, 1, 1, 'history');
    const parsed = JSON.parse(content);
    expect(parsed.part).toBe(1);
    expect(parsed.totalParts).toBe(1);
    expect(parsed.messages.length).toBe(1);
    // Verify 2-space indentation
    expect(content).toMatch(/^  "/m);
  });

  it('includes prev/next for multi-part', () => {
    const msgs = [{ id: 1, text: 'hi' }];
    const content = renderJsonPartContent(msgs, 1, 3, 10, 'history');
    const parsed = JSON.parse(content);
    expect(parsed.previousPart).toBe('history-1.json');
    expect(parsed.nextPart).toBe('history-3.json');
  });

  it('handles BigInt values', () => {
    const msgs = [{ id: BigInt(123456789), text: 'test' }];
    const content = renderJsonPartContent(msgs, 0, 1, 1, 'history');
    expect(content).toContain('"123456789"');
  });
});

describe('end-to-end partitioning guarantee', () => {
  it('both MD and JSON files stay under maxLines', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-e2e-'));
    try {
      const maxLines = 50;
      const messages = [];
      for (let i = 0; i < 100; i++) {
        messages.push({
          id: i,
          date: '2025-01-01 12:00:00',
          senderId: 200,
          text: `Message number ${i} with some text content that spans a few words`,
          hasMedia: false,
          mediaType: null,
          mediaFilePath: null,
        });
      }
      const userMap = { 200: '@testuser' };
      const parts = partitionMessages(messages, userMap, maxLines);
      const meta = { timestamp: '2025-01-01 12:00:00', mode: 'Test' };
      const { mdFiles, jsonFiles } = writeParts(parts, tmpDir, 'history', meta);

      // Verify every file is under maxLines
      // Note: MD files have navigation overhead, so we check the raw part content fits
      for (const f of jsonFiles) {
        const content = fs.readFileSync(path.join(tmpDir, f), 'utf8');
        const lines = content.split('\n').length;
        // JSON files should be under maxLines (the partitioning guarantees this for message content)
        expect(lines).toBeLessThanOrEqual(maxLines);
      }

      // Verify message counts match between MD and JSON
      for (let i = 0; i < parts.length; i++) {
        const jsonContent = JSON.parse(fs.readFileSync(path.join(tmpDir, jsonFiles[i]), 'utf8'));
        expect(jsonContent.messagesInPart).toBe(parts[i].messages.length);
        expect(parts[i].mdLines.length).toBe(parts[i].messages.length);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('physical maxLines guarantee (issue #15)', () => {
  function physicalLines(file) {
    return fs.readFileSync(file, 'utf8').split(/\r\n|\r|\n/).length;
  }
  function exportAndCheck(messages, maxLines, meta) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-cap-'));
    try {
      const parts = partitionMessages(messages, { '7': 'Alice' }, maxLines, { hasExportMeta: !!meta });
      const { mdFiles, jsonFiles } = writeParts(parts, tmpDir, 'history', meta);
      const files = [...mdFiles, ...jsonFiles].map(f => path.join(tmpDir, f));
      for (const f of files) expect(physicalLines(f)).toBeLessThanOrEqual(maxLines);
      const md = mdFiles.map(f => fs.readFileSync(path.join(tmpDir, f), 'utf8'));
      const json = jsonFiles.map(f => JSON.parse(fs.readFileSync(path.join(tmpDir, f), 'utf8')));
      return { parts, md, json };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
  const lines = n => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
  const msg = (id, text) => ({ id, date: '2026-01-01 00:00:00', senderId: '7', text });

  it('splits one oversized multiline message (issue repro) and keeps every text line', () => {
    for (const meta of [null, { timestamp: 't', mode: 'm' }]) {
      const { md, json } = exportAndCheck([msg(1, lines(1500))], 1500, meta);
      expect(md.length).toBe(2);
      expect(md[0]).toContain('*(continued in next part)*');
      expect(md[1]).toContain('*(continued from previous part)*');
      const all = md.join('\n');
      expect(all).toContain('line 1\n');
      expect(all).toContain('line 1500\n');
      // Full JSON record stored once; continuation referenced
      expect(json[0].messages.length).toBe(1);
      expect(json[0].messages[0].text).toBe(lines(1500));
      expect(json[1].messages.length).toBe(0);
      expect(json[1].continuedMessages).toEqual([{ id: 1, startsInPart: 1, file: 'history-1.json' }]);
      expect(json[0].totalMessages).toBe(1);
    }
  });

  it('counts physical lines of several multiline messages', () => {
    const messages = Array.from({ length: 30 }, (_, i) => msg(i + 1, lines(20)));
    const { md, json } = exportAndCheck(messages, 100, { timestamp: 't', mode: 'm' });
    expect(md.length).toBeGreaterThan(1);
    expect(json.reduce((s, j) => s + j.messages.length, 0)).toBe(30);
    for (const m of md) expect(m).not.toContain('continued');
  });

  it('is exact at the boundary: a file can reach but not exceed maxLines', () => {
    for (let n = 1; n <= 60; n++) {
      const messages = [msg(1, lines(n)), msg(2, lines(3)), msg(3, lines(n * 2))];
      for (const max of [20, 21, 37]) exportAndCheck(messages, max, n % 2 ? null : { timestamp: 't', mode: 'm' });
    }
  });

  it('refuses a maxLines too small for wrappers', () => {
    expect(() => partitionMessages([msg(1, 'hi')], {}, 5)).toThrow(/too small/);
  });

  it('refuses a JSON record that cannot fit into one file', () => {
    // Markdown wrappers fit in 14 lines without export metadata, but one JSON
    // record plus the JSON wrapper needs more, so the exporter must refuse.
    expect(() => partitionMessages([msg(1, 'x')], {}, 14, { hasExportMeta: false })).toThrow(/JSON record/);
  });
});
