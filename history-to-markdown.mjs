#!/usr/bin/env bun
// history-to-markdown.mjs
//
// Usage:
//   bun history-to-markdown.mjs [OPTIONS]
//
// Options:
//   --chat <username|id>         Chat username (with @) or numeric chat ID
//   --all                        Download entire history (default: current active dialog)
//   --gap-hours <N>              Hours of inactivity to define dialog boundary (default: 4)
//   --max-lines <N>              Max lines per history part before splitting (default: 1500)
//   --verbose                    Enable verbose logging
//   --help                       Show help
//
// By default, exports only the current active dialog (messages until a 4-hour gap).
// Use --all to download the entire history.
//
// Output structure:
//   ./data/history-{telegramUserId}-{timestamp}/history.md
//   ./data/history-{telegramUserId}-{timestamp}/history.json
//   ./data/history-{telegramUserId}-{timestamp}/files/   (media files)

import fs from 'fs';
import path from 'path';
import { usingTelegram, use } from './utils.mjs';

// Use lino-arguments for configuration
const { makeConfig, getenv } = await use('lino-arguments');

const config = makeConfig({
  yargs: ({ yargs, getenv }) => yargs
    .option('chat', {
      type: 'string',
      describe: 'Chat username (with @) or numeric chat ID',
      default: getenv('TELEGRAM_CHAT_USERNAME', '') || getenv('TELEGRAM_CHAT_ID', ''),
    })
    .option('all', {
      type: 'boolean',
      describe: 'Download entire history instead of current active dialog',
      default: false,
    })
    .option('gap-hours', {
      type: 'number',
      describe: 'Hours of inactivity to define dialog boundary',
      default: getenv('TELEGRAM_GAP_HOURS', 4),
    })
    .option('max-lines', {
      type: 'number',
      describe: 'Max lines per history part before splitting',
      default: getenv('TELEGRAM_MAX_LINES', 1500),
    })
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      describe: 'Enable verbose logging',
      default: false,
    })
    .help()
    .version(false),
});

const verbose = config.verbose;
const log = {
  verbose: (...msgs) => { if (verbose) console.log('[VERBOSE]', ...msgs); },
  info: (...msgs) => console.log(...msgs),
  warn: (...msgs) => console.warn(...msgs),
  error: (...msgs) => console.error(...msgs),
};

// Suppress TimeoutNegativeWarning from gramJS library
const originalWarningListeners = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'TimeoutNegativeWarning') return;
  originalWarningListeners.forEach(listener => listener(warning));
});

/**
 * Normalize a Telegram message date to a Date object.
 */
function normalizeDate(msgDate) {
  if (!msgDate) return null;
  if (msgDate instanceof Date) return msgDate;
  if (typeof msgDate.toISOString === 'function') return new Date(msgDate);
  if (typeof msgDate === 'number') return new Date(msgDate * 1000);
  if (typeof msgDate === 'string') {
    const d = new Date(msgDate);
    if (!isNaN(d)) return d;
    const n = Number(msgDate);
    if (!isNaN(n)) return new Date(n * 1000);
  }
  return null;
}

/**
 * Format a Date as "YYYY-MM-DD HH:mm:ss".
 */
function formatDate(d) {
  if (!d) return '';
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Determine media type description for a Telegram media object.
 */
function getMediaType(media) {
  if (!media) return null;
  const cls = media.className || '';
  if (cls === 'MessageMediaPhoto') return 'photo';
  if (cls === 'MessageMediaDocument') {
    const doc = media.document;
    if (doc && doc.mimeType) {
      if (doc.mimeType.startsWith('video/')) return 'video';
      if (doc.mimeType.startsWith('audio/')) return 'audio';
      if (doc.mimeType.startsWith('image/')) return 'image';
    }
    // Check for voice/round video attributes
    if (doc && doc.attributes) {
      for (const attr of doc.attributes) {
        if (attr.className === 'DocumentAttributeAudio' && attr.voice) return 'voice';
        if (attr.className === 'DocumentAttributeVideo' && attr.roundMessage) return 'round_video';
      }
    }
    return 'document';
  }
  if (cls === 'MessageMediaGeo') return 'geo';
  if (cls === 'MessageMediaContact') return 'contact';
  if (cls === 'MessageMediaPoll') return 'poll';
  if (cls === 'MessageMediaWebPage') return 'webpage';
  if (cls === 'MessageMediaVenue') return 'venue';
  if (cls === 'MessageMediaDice') return 'dice';
  if (cls === 'MessageMediaGame') return 'game';
  if (cls === 'MessageMediaInvoice') return 'invoice';
  if (cls === 'MessageMediaGeoLive') return 'live_location';
  return 'unknown_media';
}

/**
 * Get a reasonable file extension for a media download.
 */
function getMediaExtension(media) {
  const cls = media.className || '';
  if (cls === 'MessageMediaPhoto') return '.jpg';
  if (cls === 'MessageMediaDocument') {
    const doc = media.document;
    if (doc) {
      // Check for filename attribute
      if (doc.attributes) {
        for (const attr of doc.attributes) {
          if (attr.className === 'DocumentAttributeFilename' && attr.fileName) {
            return path.extname(attr.fileName) || '.bin';
          }
        }
      }
      if (doc.mimeType) {
        const mimeMap = {
          'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
          'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav',
          'audio/mp4': '.m4a', 'audio/aac': '.aac',
          'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
          'image/webp': '.webp',
          'application/pdf': '.pdf',
          'application/zip': '.zip',
        };
        return mimeMap[doc.mimeType] || '.bin';
      }
    }
  }
  return '.bin';
}

/**
 * Get original filename from media if available.
 */
function getMediaFilename(media) {
  if (!media) return null;
  const cls = media.className || '';
  if (cls === 'MessageMediaDocument' && media.document && media.document.attributes) {
    for (const attr of media.document.attributes) {
      if (attr.className === 'DocumentAttributeFilename' && attr.fileName) {
        return attr.fileName;
      }
    }
  }
  return null;
}

/**
 * Download media from a message and save to the files directory.
 * Returns the relative path to the downloaded file, or null on failure.
 */
async function downloadMedia(client, message, filesDir, msgIndex) {
  try {
    const media = message.media;
    if (!media) return null;
    const mediaType = getMediaType(media);
    if (!mediaType || mediaType === 'webpage' || mediaType === 'geo' || mediaType === 'live_location'
        || mediaType === 'contact' || mediaType === 'poll' || mediaType === 'dice'
        || mediaType === 'game' || mediaType === 'invoice' || mediaType === 'venue') {
      // These types have no downloadable file
      return null;
    }

    const originalFilename = getMediaFilename(media);
    const ext = getMediaExtension(media);
    const filename = originalFilename || `${mediaType}_${msgIndex}${ext}`;
    const filePath = path.join(filesDir, filename);

    const buffer = await client.downloadMedia(message, {});
    if (buffer) {
      fs.writeFileSync(filePath, buffer);
      log.verbose(`Downloaded: ${filename}`);
      return `files/${filename}`;
    }
    return null;
  } catch (err) {
    log.verbose(`Failed to download media for message ${msgIndex}: ${err.message}`);
    return null;
  }
}

/**
 * Filter messages to current active dialog: keep messages from now backwards
 * until a gap of `gapHours` hours is found between consecutive messages.
 * Messages should be in chronological order (oldest first).
 */
function filterCurrentActiveDialog(messages, gapHours) {
  if (messages.length === 0) return messages;

  const gapMs = gapHours * 60 * 60 * 1000;
  const now = new Date();

  // Work backwards from the most recent message
  let cutoffIndex = 0;
  for (let i = messages.length - 1; i > 0; i--) {
    const currentDate = messages[i].dateObj;
    const prevDate = messages[i - 1].dateObj;
    if (!currentDate || !prevDate) continue;
    const gap = currentDate.getTime() - prevDate.getTime();
    if (gap >= gapMs) {
      cutoffIndex = i;
      break;
    }
  }

  return messages.slice(cutoffIndex);
}

/**
 * Split lines into parts of maxLines each, returning an array of string arrays.
 */
function splitIntoParts(lines, maxLines) {
  if (lines.length <= maxLines) return [lines];
  const parts = [];
  for (let i = 0; i < lines.length; i += maxLines) {
    parts.push(lines.slice(i, i + maxLines));
  }
  return parts;
}

/**
 * Write markdown parts with prev/next navigation links.
 */
function writeMarkdownParts(parts, outDir, baseName) {
  const filePaths = [];
  for (let i = 0; i < parts.length; i++) {
    const suffix = parts.length === 1 ? '' : `_part${i + 1}`;
    const filename = `${baseName}${suffix}.md`;
    const filePath = path.join(outDir, filename);

    let content = '';

    // Navigation header
    if (parts.length > 1) {
      const nav = [];
      if (i > 0) {
        const prevSuffix = i === 1 ? (parts.length === 1 ? '' : '_part1') : `_part${i}`;
        nav.push(`[← Previous part](${baseName}${prevSuffix}.md)`);
      }
      nav.push(`Part ${i + 1} of ${parts.length}`);
      if (i < parts.length - 1) {
        nav.push(`[Next part →](${baseName}_part${i + 2}.md)`);
      }
      content += nav.join(' | ') + '\n\n---\n\n';
    }

    content += parts[i].join('\n');

    // Navigation footer
    if (parts.length > 1) {
      const nav = [];
      content += '\n\n---\n\n';
      if (i > 0) {
        const prevSuffix = i === 1 ? (parts.length === 1 ? '' : '_part1') : `_part${i}`;
        nav.push(`[← Previous part](${baseName}${prevSuffix}.md)`);
      }
      nav.push(`Part ${i + 1} of ${parts.length}`);
      if (i < parts.length - 1) {
        nav.push(`[Next part →](${baseName}_part${i + 2}.md)`);
      }
      content += nav.join(' | ');
    }

    fs.writeFileSync(filePath, content);
    filePaths.push(filename);
  }
  return filePaths;
}

/**
 * Write JSON parts with metadata and prev/next references.
 */
function writeJsonParts(messages, outDir, baseName, maxLines) {
  // Serialize messages for JSON (line count approximation: ~1 line per message entry)
  const jsonLines = messages.map(msg => {
    const entry = { ...msg };
    delete entry.dateObj; // Remove internal Date object
    return entry;
  });

  // Approximate line count: each message takes ~8 lines in pretty JSON
  const approxLinesPerMsg = 8;
  const msgsPerPart = Math.max(1, Math.floor(maxLines / approxLinesPerMsg));
  const parts = [];
  for (let i = 0; i < jsonLines.length; i += msgsPerPart) {
    parts.push(jsonLines.slice(i, i + msgsPerPart));
  }

  const filePaths = [];
  const bigIntReplacer = (key, value) =>
    typeof value === 'bigint' ? value.toString() : value;

  for (let i = 0; i < parts.length; i++) {
    const suffix = parts.length === 1 ? '' : `_part${i + 1}`;
    const filename = `${baseName}${suffix}.json`;
    const filePath = path.join(outDir, filename);

    const wrapper = {
      part: i + 1,
      totalParts: parts.length,
      totalMessages: messages.length,
      messagesInPart: parts[i].length,
    };

    if (parts.length > 1) {
      if (i > 0) {
        const prevSuffix = i === 1 ? (parts.length === 1 ? '' : '_part1') : `_part${i}`;
        wrapper.previousPart = `${baseName}${prevSuffix}.json`;
      }
      if (i < parts.length - 1) {
        wrapper.nextPart = `${baseName}_part${i + 2}.json`;
      }
    }

    wrapper.messages = parts[i];

    const content = JSON.stringify(wrapper, bigIntReplacer, 2);
    fs.writeFileSync(filePath, content);
    filePaths.push(filename);
  }
  return filePaths;
}

// ============================================================================
// Main execution
// ============================================================================

try {
  await usingTelegram(async ({ client, Api }) => {
    log.info('Connected.');

    // Determine chat target
    let chat = config.chat;
    if (!chat) {
      const input = await use('readline-sync');
      chat = input.question('Enter chat username (with @) or chat ID: ');
    }
    chat = chat.replace(/[^\w@-]/g, '');
    log.verbose(`Chat target: ${chat}`);

    const entity = await client.getEntity(chat);
    log.verbose(`Entity resolved: ${entity.className}, ID: ${entity.id}`);

    // Get current user info for output directory naming
    const me = await client.getMe();
    const myId = typeof me.id === 'object' && 'value' in me.id ? me.id.value : me.id;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const outDir = `data/history-${myId}-${timestamp}`;
    const filesDir = path.join(outDir, 'files');
    fs.mkdirSync(filesDir, { recursive: true });

    log.info(`Output directory: ${outDir}`);
    log.info('Fetching messages...');

    // Collect all messages (newest first from API, we'll reverse later)
    const rawMessages = [];
    let fetchCount = 0;
    for await (const message of client.iterMessages(entity, { limit: config.all ? 100000 : 10000 })) {
      fetchCount++;
      if (fetchCount % 1000 === 0) {
        log.info(`Fetched ${fetchCount} messages...`);
      }

      const dateObj = normalizeDate(message.date);
      const mediaType = getMediaType(message.media);

      rawMessages.push({
        id: message.id,
        date: formatDate(dateObj),
        dateObj,
        senderId: message.senderId,
        text: message.message || '',
        mediaType,
        mediaFilePath: null, // Will be filled during download
        hasMedia: !!message.media && !!mediaType,
        _telegramMessage: message, // Keep reference for media download
      });
    }

    log.info(`Fetched ${rawMessages.length} messages total.`);

    // Reverse to chronological order (oldest first)
    rawMessages.reverse();

    // Apply active dialog filter unless --all is specified
    let messages;
    if (config.all) {
      messages = rawMessages;
      log.info(`Exporting entire history: ${messages.length} messages.`);
    } else {
      messages = filterCurrentActiveDialog(rawMessages, config.gapHours);
      log.info(`Current active dialog: ${messages.length} messages (gap threshold: ${config.gapHours}h).`);
    }

    if (messages.length === 0) {
      log.info('No messages to export.');
      return;
    }

    // Resolve sender IDs to usernames
    log.info('Resolving user info...');
    const userMap = {};
    for (const msg of messages) {
      if (msg.senderId && !userMap[msg.senderId]) {
        try {
          const sender = await client.getEntity(msg.senderId);
          userMap[msg.senderId] = sender.username
            ? `@${sender.username}`
            : (sender.firstName || sender.lastName || String(msg.senderId));
        } catch {
          userMap[msg.senderId] = String(msg.senderId);
        }
      }
    }

    // Download media files
    const downloadableMessages = messages.filter(m => m.hasMedia);
    if (downloadableMessages.length > 0) {
      log.info(`Downloading ${downloadableMessages.length} media files...`);
      let downloaded = 0;
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.hasMedia && msg._telegramMessage) {
          const relPath = await downloadMedia(client, msg._telegramMessage, filesDir, msg.id);
          if (relPath) {
            msg.mediaFilePath = relPath;
            downloaded++;
          }
          if (downloaded % 50 === 0 && downloaded > 0) {
            log.info(`Downloaded ${downloaded} media files...`);
          }
        }
      }
      log.info(`Downloaded ${downloaded} media files.`);
    }

    // Clean up internal references before output
    for (const msg of messages) {
      delete msg._telegramMessage;
    }

    // Build markdown lines
    const mdLines = [];
    for (const msg of messages) {
      const sender = userMap[msg.senderId] || String(msg.senderId || 'unknown');
      let line = `**${sender}** [${msg.date}]:`;
      if (msg.text) {
        line += `\n${msg.text}`;
      }
      if (msg.mediaFilePath) {
        const ext = path.extname(msg.mediaFilePath).toLowerCase();
        const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        if (isImage) {
          line += `\n\n![${msg.mediaType}](${msg.mediaFilePath})`;
        } else {
          line += `\n\n[${msg.mediaType}: ${path.basename(msg.mediaFilePath)}](${msg.mediaFilePath})`;
        }
      } else if (msg.hasMedia && msg.mediaType) {
        line += `\n\n*[${msg.mediaType}]*`;
      }
      // Add link to JSON source
      line += `\n`;
      mdLines.push(line);
    }

    // Write markdown with partitioning
    const mdParts = splitIntoParts(mdLines, config.maxLines);
    const mdFiles = writeMarkdownParts(mdParts, outDir, 'history');
    log.info(`Wrote ${mdFiles.length} markdown file(s): ${mdFiles.join(', ')}`);

    // Prepare JSON data (without internal fields)
    const jsonMessages = messages.map(msg => {
      const entry = {
        id: msg.id,
        date: msg.date,
        senderId: msg.senderId,
        senderName: userMap[msg.senderId] || String(msg.senderId || 'unknown'),
        text: msg.text,
      };
      if (msg.hasMedia) {
        entry.mediaType = msg.mediaType;
        entry.mediaFilePath = msg.mediaFilePath || null;
      }
      return entry;
    });

    // Write JSON with partitioning
    const jsonFiles = writeJsonParts(jsonMessages, outDir, 'history', config.maxLines);
    log.info(`Wrote ${jsonFiles.length} JSON file(s): ${jsonFiles.join(', ')}`);

    // Add cross-references from markdown to JSON parts
    // Update the first markdown file to include links to JSON and file listing
    const firstMdPath = path.join(outDir, mdFiles[0]);
    let firstMdContent = fs.readFileSync(firstMdPath, 'utf8');
    let indexSection = '# Chat History Export\n\n';
    indexSection += `**Exported:** ${timestamp.replace(/-/g, ':').replace('T', ' ')}\n`;
    indexSection += `**Messages:** ${messages.length}\n`;
    indexSection += `**Mode:** ${config.all ? 'Full history' : `Current active dialog (${config.gapHours}h gap threshold)`}\n\n`;

    if (mdFiles.length > 1) {
      indexSection += '## Markdown Parts\n\n';
      for (const f of mdFiles) {
        indexSection += `- [${f}](${f})\n`;
      }
      indexSection += '\n';
    }

    indexSection += '## JSON Data\n\n';
    for (const f of jsonFiles) {
      indexSection += `- [${f}](${f})\n`;
    }
    indexSection += '\n---\n\n';

    firstMdContent = indexSection + firstMdContent;
    fs.writeFileSync(firstMdPath, firstMdContent);

    // Check if files directory is empty and clean up if so
    const filesInDir = fs.readdirSync(filesDir);
    if (filesInDir.length === 0) {
      fs.rmdirSync(filesDir);
      log.verbose('No media files downloaded, removed empty files/ directory.');
    }

    log.info(`\nExport complete: ${outDir}`);
    log.info(`  Markdown: ${mdFiles.join(', ')}`);
    log.info(`  JSON: ${jsonFiles.join(', ')}`);
    if (filesInDir.length > 0) {
      log.info(`  Media files: ${filesInDir.length} files in files/`);
    }
  });
  process.exit(0);
} catch (err) {
  if (err && err.message && err.message.includes('TIMEOUT')) {
    log.warn('Warning: Telegram client timeout after disconnect. This can be safely ignored.');
    process.exit(0);
  } else {
    log.error('Error:', err);
    process.exit(1);
  }
}
