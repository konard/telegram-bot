#!/usr/bin/env bun
// history-to-markdown.mjs
//
// Usage:
//   bun history-to-markdown.mjs [OPTIONS]
//
// Options:
//   --chat <username|id|link>     Chat username (with @), numeric chat ID, or t.me/c/ link
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
//   ./data/history-{telegramUserId}-{timestamp}/history-1.md, history-2.md, ...
//   ./data/history-{telegramUserId}-{timestamp}/history-1.json, history-2.json, ...
//   ./data/history-{telegramUserId}-{timestamp}/files/   (media files)
//
// Can also be imported as a library:
//   import { normalizeDate, formatDate, filterCurrentActiveDialog, ... } from './history-to-markdown.mjs';

import fs from 'fs';
import path from 'path';

// ============================================================================
// Exported pure functions (usable as library)
// ============================================================================

/**
 * Parse a Telegram service action into structured data.
 *
 * Returns an array of { subjectId, text } objects.
 * - subjectId: the user ID who is the subject of the action (may differ from senderId).
 *   If null, use senderId as the subject.
 * - text: the action description.
 *
 * For ChatAddUser, returns one entry per added user.
 */
export function parseServiceAction(action, senderId) {
  if (!action) return [{ subjectId: null, text: '' }];
  const cls = action.className || '';
  switch (cls) {
    case 'MessageActionChatAddUser': {
      const users = action.users || [];
      if (users.length === 0) return [{ subjectId: null, text: 'joined the group' }];
      return users.map(uid => {
        const id = typeof uid === 'bigint' ? uid : (typeof uid === 'object' && 'value' in uid ? uid.value : uid);
        const isSelf = String(id) === String(senderId);
        return { subjectId: id, text: isSelf ? 'joined the group' : 'was added to the group' };
      });
    }
    case 'MessageActionChatJoinedByLink':
      return [{ subjectId: null, text: 'joined the group via invite link' }];
    case 'MessageActionChatJoinedByRequest':
      return [{ subjectId: null, text: 'joined the group via request' }];
    case 'MessageActionChatDeleteUser': {
      const uid = action.userId;
      const id = typeof uid === 'bigint' ? uid : (typeof uid === 'object' && 'value' in uid ? uid.value : uid);
      const isSelf = String(id) === String(senderId);
      return [{ subjectId: id, text: isSelf ? 'left the group' : 'was removed from the group' }];
    }
    case 'MessageActionChatCreate':
      return [{ subjectId: null, text: `created the group "${action.title || ''}"` }];
    case 'MessageActionChatEditTitle':
      return [{ subjectId: null, text: `changed the group title to "${action.title || ''}"` }];
    case 'MessageActionChatEditPhoto':
      return [{ subjectId: null, text: 'changed the group photo' }];
    case 'MessageActionChatDeletePhoto':
      return [{ subjectId: null, text: 'removed the group photo' }];
    case 'MessageActionPinMessage':
      return [{ subjectId: null, text: 'pinned a message' }];
    case 'MessageActionChannelCreate':
      return [{ subjectId: null, text: `created the channel "${action.title || ''}"` }];
    case 'MessageActionChatMigrateTo':
      return [{ subjectId: null, text: null }]; // skip, covered by ChannelMigrateFrom
    case 'MessageActionChannelMigrateFrom':
      return [{ subjectId: null, text: `"${action.title || ''}" group upgraded to a supergroup` }];
    case 'MessageActionGameScore':
      return [{ subjectId: null, text: 'scored in a game' }];
    case 'MessageActionPhoneCall':
      return [{ subjectId: null, text: 'made a phone call' }];
    case 'MessageActionScreenshotTaken':
      return [{ subjectId: null, text: 'took a screenshot' }];
    case 'MessageActionContactSignUp':
      return [{ subjectId: null, text: 'joined Telegram' }];
    case 'MessageActionGroupCall':
      return [{ subjectId: null, text: action.duration ? 'ended a group call' : 'started a group call' }];
    case 'MessageActionInviteToGroupCall':
      return [{ subjectId: null, text: 'invited users to a group call' }];
    case 'MessageActionTopicCreate':
      return [{ subjectId: null, text: `created topic "${action.title || ''}"` }];
    case 'MessageActionTopicEdit':
      return [{ subjectId: null, text: action.title ? `edited topic to "${action.title}"` : 'edited a topic' }];
    default:
      return [{ subjectId: null, text: `[service: ${cls}]` }];
  }
}

/**
 * Normalize a Telegram message date to a Date object.
 */
export function normalizeDate(msgDate) {
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
export function formatDate(d) {
  if (!d) return '';
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Determine media type description for a Telegram media object.
 */
export function getMediaType(media) {
  if (!media) return null;
  const cls = media.className || '';
  if (cls === 'MessageMediaPhoto') return 'photo';
  if (cls === 'MessageMediaDocument') {
    const doc = media.document;
    // Check attributes first (voice/round_video are more specific than mimeType)
    if (doc && doc.attributes) {
      for (const attr of doc.attributes) {
        if (attr.className === 'DocumentAttributeAudio' && attr.voice) return 'voice';
        if (attr.className === 'DocumentAttributeVideo' && attr.roundMessage) return 'round_video';
      }
    }
    if (doc && doc.mimeType) {
      if (doc.mimeType.startsWith('video/')) return 'video';
      if (doc.mimeType.startsWith('audio/')) return 'audio';
      if (doc.mimeType.startsWith('image/')) return 'image';
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
export function getMediaExtension(media) {
  const cls = media.className || '';
  if (cls === 'MessageMediaPhoto') return '.jpg';
  if (cls === 'MessageMediaDocument') {
    const doc = media.document;
    if (doc) {
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
export function getMediaFilename(media) {
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
export async function downloadMedia(client, message, filesDir, msgIndex, log) {
  try {
    const media = message.media;
    if (!media) return null;
    const mediaType = getMediaType(media);
    if (!mediaType || mediaType === 'webpage' || mediaType === 'geo' || mediaType === 'live_location'
        || mediaType === 'contact' || mediaType === 'poll' || mediaType === 'dice'
        || mediaType === 'game' || mediaType === 'invoice' || mediaType === 'venue') {
      return null;
    }

    const originalFilename = getMediaFilename(media);
    const ext = getMediaExtension(media);
    const filename = originalFilename || `${mediaType}_${msgIndex}${ext}`;
    const filePath = path.join(filesDir, filename);

    const buffer = await client.downloadMedia(message, {});
    if (buffer) {
      fs.writeFileSync(filePath, buffer);
      if (log) log.verbose(`Downloaded: ${filename}`);
      return `files/${filename}`;
    }
    return null;
  } catch (err) {
    if (log) log.verbose(`Failed to download media for message ${msgIndex}: ${err.message}`);
    return null;
  }
}

/**
 * Filter messages to current active dialog: keep messages from now backwards
 * until a gap of `gapHours` hours is found between consecutive messages.
 * Messages should be in chronological order (oldest first).
 */
export function filterCurrentActiveDialog(messages, gapHours) {
  if (messages.length === 0) return messages;

  const gapMs = gapHours * 60 * 60 * 1000;

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
 * Count lines in a string.
 */
export function countLines(str) {
  if (!str) return 0;
  let count = 1;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\n') count++;
  }
  return count;
}

/**
 * Render a single message as markdown text.
 */
export function renderMessageMarkdown(msg, senderName) {
  if (msg.isService) {
    if (!msg.senderId) {
      return `*${msg.text}* [${msg.date}]\n`;
    }
    return `*${senderName} ${msg.text}* [${msg.date}]\n`;
  }
  let line = `**${senderName}** [${msg.date}]:`;
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
  line += '\n';
  return line;
}

/**
 * Render a single message as a JSON-serializable object.
 */
export function renderMessageJson(msg, senderName) {
  const entry = {
    id: msg.id,
    date: msg.date,
    senderId: msg.senderId,
    senderName,
    text: msg.text,
  };
  if (msg.isService) {
    entry.isService = true;
    if (msg.rawAction) {
      entry.rawAction = msg.rawAction;
    }
  }
  if (msg.hasMedia) {
    entry.mediaType = msg.mediaType;
    entry.mediaFilePath = msg.mediaFilePath || null;
  }
  return entry;
}

const bigIntReplacer = (key, value) =>
  typeof value === 'bigint' ? value.toString() : value;

/**
 * Render a JSON part file content from an array of message objects and metadata.
 * Returns the formatted JSON string.
 */
export function renderJsonPartContent(jsonMessages, partIndex, totalParts, totalMessages, baseName) {
  const wrapper = {
    part: partIndex + 1,
    totalParts,
    totalMessages,
    messagesInPart: jsonMessages.length,
  };

  if (totalParts > 1) {
    if (partIndex > 0) {
      wrapper.previousPart = `${baseName}-${partIndex}.json`;
    }
    if (partIndex < totalParts - 1) {
      wrapper.nextPart = `${baseName}-${partIndex + 2}.json`;
    }
  }

  wrapper.messages = jsonMessages;

  return JSON.stringify(wrapper, bigIntReplacer, 2);
}

/**
 * Build navigation header/footer for a markdown part.
 */
export function buildNavigation(partIndex, totalParts, baseName, jsonFilename) {
  const nav = [];
  if (partIndex > 0) {
    const prevName = `${baseName}-${partIndex}.md`;
    nav.push(`[← Previous part](${prevName})`);
  }
  nav.push(`Part ${partIndex + 1} of ${totalParts}`);
  if (partIndex < totalParts - 1) {
    const nextName = `${baseName}-${partIndex + 2}.md`;
    nav.push(`[Next part →](${nextName})`);
  }
  nav.push(`[JSON](${jsonFilename})`);
  return nav.join(' | ');
}

/**
 * Partition messages into synchronized MD and JSON parts, ensuring both stay under maxLines.
 *
 * Returns an array of parts, each: { messages: [...jsonMsgs], mdLines: [...strings] }
 */
export function partitionMessages(messages, userMap, maxLines) {
  if (messages.length === 0) return [];

  const parts = [];
  let currentMdLines = [];
  let currentJsonMsgs = [];

  for (const msg of messages) {
    const senderName = userMap[msg.senderId] || String(msg.senderId || 'unknown');
    const mdText = renderMessageMarkdown(msg, senderName);
    const jsonMsg = renderMessageJson(msg, senderName);

    // Calculate how many lines the MD would have after adding this message
    const mdLinesAfter = currentMdLines.length + countLines(mdText);

    // Calculate how many lines the JSON would have after adding this message
    // We need to estimate: the full JSON with wrapper has overhead + per-message lines
    const testJsonMsgs = [...currentJsonMsgs, jsonMsg];
    const testJsonContent = JSON.stringify({ messages: testJsonMsgs }, bigIntReplacer, 2);
    // Add ~6 lines for wrapper metadata (part, totalParts, totalMessages, etc.)
    const jsonLinesAfter = countLines(testJsonContent) + 6;

    // If adding this message would make either file exceed maxLines, and we already have messages, start a new part
    if (currentMdLines.length > 0 && (mdLinesAfter > maxLines || jsonLinesAfter > maxLines)) {
      parts.push({ mdLines: currentMdLines, messages: currentJsonMsgs });
      currentMdLines = [];
      currentJsonMsgs = [];
    }

    currentMdLines.push(mdText);
    currentJsonMsgs.push(jsonMsg);
  }

  // Push remaining
  if (currentMdLines.length > 0) {
    parts.push({ mdLines: currentMdLines, messages: currentJsonMsgs });
  }

  return parts;
}

/**
 * Write synchronized MD and JSON parts to disk.
 * Always uses history-{N}.md and history-{N}.json naming (even for a single part).
 * Returns { mdFiles: string[], jsonFiles: string[] }
 */
export function writeParts(parts, outDir, baseName, exportMeta) {
  const totalParts = parts.length;
  const totalMessages = parts.reduce((sum, p) => sum + p.messages.length, 0);
  const mdFiles = [];
  const jsonFiles = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Always use numeric suffix: history-1.md, history-2.md, ...
    const mdFilename = `${baseName}-${i + 1}.md`;
    const jsonFilename = `${baseName}-${i + 1}.json`;

    // Build markdown content
    let mdContent = '';

    // Header with export info (only on first part)
    if (i === 0) {
      mdContent += '# Chat History Export\n\n';
      if (exportMeta) {
        mdContent += `**Exported:** ${exportMeta.timestamp}\n`;
        mdContent += `**Messages:** ${totalMessages}\n`;
        mdContent += `**Mode:** ${exportMeta.mode}\n\n`;
      }
    }

    // Navigation and JSON link (single hyperlink to the corresponding JSON part)
    const navLine = buildNavigation(i, totalParts, baseName, jsonFilename);
    mdContent += navLine + '\n\n---\n\n';

    // Messages
    mdContent += part.mdLines.join('\n');

    // Navigation footer
    mdContent += '\n\n---\n\n' + navLine;

    fs.writeFileSync(path.join(outDir, mdFilename), mdContent);
    mdFiles.push(mdFilename);

    // Build JSON content
    const jsonContent = renderJsonPartContent(part.messages, i, totalParts, totalMessages, baseName);
    fs.writeFileSync(path.join(outDir, jsonFilename), jsonContent);
    jsonFiles.push(jsonFilename);
  }

  return { mdFiles, jsonFiles };
}

// ============================================================================
// CLI execution (auto-detected)
// ============================================================================

/**
 * Detect if this module is being run directly (CLI) vs imported as a library.
 */
function isMainModule() {
  // Bun: Bun.main points to the script being executed
  if (typeof Bun !== 'undefined' && Bun.main) {
    const scriptPath = path.resolve(Bun.main);
    const thisPath = path.resolve(new URL(import.meta.url).pathname);
    return scriptPath === thisPath;
  }
  // Node.js: compare import.meta.url with process.argv[1]
  if (process.argv[1]) {
    const scriptPath = path.resolve(process.argv[1]);
    const thisPath = path.resolve(new URL(import.meta.url).pathname);
    return scriptPath === thisPath;
  }
  return false;
}

if (isMainModule()) {
  const { usingTelegram, use } = await import('./utils.mjs');

  // Use lino-arguments for configuration
  const { makeConfig, getenv } = await use('lino-arguments');

  const config = makeConfig({
    yargs: ({ yargs, getenv }) => yargs
      .option('chat', {
        type: 'string',
        describe: 'Chat username (with @), numeric chat ID, or t.me/c/ link',
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

  try {
    await usingTelegram(async ({ client, Api }) => {
      log.info('Connected.');

      // Determine chat target
      let chat = config.chat;
      if (!chat) {
        const input = await use('readline-sync');
        chat = input.question('Enter chat username (with @) or chat ID: ');
      }
      // Support t.me/c/<id>/<msgId> links — extract chat ID with -100 prefix
      const tmeChatMatch = chat.match(/t\.me\/c\/(\d+)(?:\/\d+)?/);
      if (tmeChatMatch) {
        chat = `-100${tmeChatMatch[1]}`;
      } else {
        chat = chat.replace(/[^\w@-]/g, '');
      }
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

      // Helper to collect messages from a given entity
      async function collectMessages(targetEntity, limit) {
        const collected = [];
        let count = 0;
        for await (const message of client.iterMessages(targetEntity, { limit })) {
          count++;
          if (count % 1000 === 0) {
            log.info(`Fetched ${count} messages...`);
          }

          const dateObj = normalizeDate(message.date);

          if (message.className === 'MessageService') {
            const entries = parseServiceAction(message.action, message.senderId);
            const action = message.action;
            const rawAction = action ? { className: action.className, ...action } : null;
            for (const entry of entries) {
              if (entry.text === null) continue; // skip redundant service messages
              collected.push({
                id: message.id,
                date: formatDate(dateObj),
                dateObj,
                senderId: entry.subjectId != null ? entry.subjectId : message.senderId,
                text: entry.text,
                mediaType: null,
                mediaFilePath: null,
                hasMedia: false,
                isService: true,
                rawAction,
                _telegramMessage: message,
              });
            }
            continue;
          }

          const mediaType = getMediaType(message.media);

          collected.push({
            id: message.id,
            date: formatDate(dateObj),
            dateObj,
            senderId: message.senderId,
            text: message.message || '',
            mediaType,
            mediaFilePath: null,
            hasMedia: !!message.media && !!mediaType,
            _telegramMessage: message,
          });
        }
        return collected;
      }

      // Collect messages from the supergroup/channel
      const rawMessages = await collectMessages(entity, config.all ? 100000 : 10000);
      log.info(`Fetched ${rawMessages.length} messages from main chat.`);

      // Check if this is a migrated supergroup — fetch old basic group history too
      const migrateMsg = rawMessages.find(m => m.rawAction && m.rawAction.className === 'MessageActionChannelMigrateFrom');
      if (migrateMsg) {
        const oldChatId = migrateMsg.rawAction.chatId;
        log.info(`Detected migration from basic group ${oldChatId}, fetching old history...`);
        try {
          const oldEntity = await client.getEntity(BigInt(oldChatId));
          const oldMessages = await collectMessages(oldEntity, config.all ? 100000 : 10000);
          log.info(`Fetched ${oldMessages.length} messages from old basic group.`);
          // Prepend old messages (they are newer-first from API, same as rawMessages)
          rawMessages.push(...oldMessages);
        } catch (err) {
          log.warn(`Could not fetch old basic group history: ${err.message}`);
        }
      }

      log.info(`Fetched ${rawMessages.length} messages total.`);

      // Sort into chronological order (oldest first), stable by message ID for same timestamp
      rawMessages.sort((a, b) => {
        const timeDiff = (a.dateObj?.getTime() || 0) - (b.dateObj?.getTime() || 0);
        if (timeDiff !== 0) return timeDiff;
        return (a.id || 0) - (b.id || 0);
      });

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
            const relPath = await downloadMedia(client, msg._telegramMessage, filesDir, msg.id, log);
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

      // Partition messages into synchronized MD + JSON parts
      const parts = partitionMessages(messages, userMap, config.maxLines);

      const exportMeta = {
        timestamp: timestamp.replace(/-/g, ':').replace('T', ' ').substring(0, 19),
        mode: config.all ? 'Full history' : `Current active dialog (${config.gapHours}h gap threshold)`,
      };

      const { mdFiles, jsonFiles } = writeParts(parts, outDir, 'history', exportMeta);
      log.info(`Wrote ${mdFiles.length} markdown file(s): ${mdFiles.join(', ')}`);
      log.info(`Wrote ${jsonFiles.length} JSON file(s): ${jsonFiles.join(', ')}`);

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
}
