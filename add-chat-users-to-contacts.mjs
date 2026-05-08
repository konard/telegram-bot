#!/usr/bin/env bun
// add-chat-users-to-contacts.mjs
//
// Usage:
//   bun add-chat-users-to-contacts.mjs --chat @group
//   bun add-chat-users-to-contacts.mjs --chat @group --apply --limit 20
//
// The script collects users visible in a Telegram chat and adds eligible users
// to the current account's Telegram contacts via contacts.addContact.

import fs from 'fs';
import path from 'path';

const DEFAULT_DELAY_MS = 10000;
const DEFAULT_PARTICIPANTS_LIMIT = 10000;
const DEFAULT_MESSAGES_LIMIT = 100000;

export function parseCliArgs(argv = process.argv.slice(2), env = process.env) {
  const config = {
    chat: env.TELEGRAM_CHAT_USERNAME || env.TELEGRAM_CHAT_ID || '',
    apply: false,
    dryRun: true,
    help: false,
    verbose: false,
    sharePhone: false,
    includeExisting: false,
    limit: 0,
    delayMs: DEFAULT_DELAY_MS,
    participantsLimit: DEFAULT_PARTICIPANTS_LIMIT,
    messagesLimit: DEFAULT_MESSAGES_LIMIT,
  };

  const isKnownOption = value => [
    '--chat',
    '--apply',
    '--dry-run',
    '--limit',
    '--delay-ms',
    '--participants-limit',
    '--messages-limit',
    '--share-phone',
    '--include-existing',
    '--verbose',
    '-v',
    '--help',
    '-h',
  ].includes(value);

  const readValue = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || isKnownOption(value)) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  const readNonNegativeInt = (value, flag) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`${flag} must be a non-negative integer`);
    }
    return parsed;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--chat':
        config.chat = readValue(i, arg);
        i++;
        break;
      case '--apply':
        config.apply = true;
        break;
      case '--dry-run':
        config.apply = false;
        break;
      case '--limit':
        config.limit = readNonNegativeInt(readValue(i, arg), arg);
        i++;
        break;
      case '--delay-ms':
        config.delayMs = readNonNegativeInt(readValue(i, arg), arg);
        i++;
        break;
      case '--participants-limit':
        config.participantsLimit = readNonNegativeInt(readValue(i, arg), arg);
        i++;
        break;
      case '--messages-limit':
        config.messagesLimit = readNonNegativeInt(readValue(i, arg), arg);
        i++;
        break;
      case '--share-phone':
        config.sharePhone = true;
        break;
      case '--include-existing':
        config.includeExisting = true;
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--help':
      case '-h':
        config.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  config.dryRun = !config.apply;
  return config;
}

export function formatHelp() {
  return `
add-chat-users-to-contacts.mjs - Add visible Telegram chat users to contacts

USAGE:
  bun add-chat-users-to-contacts.mjs [OPTIONS]

OPTIONS:
  --chat <username|id|link>       Chat username, numeric ID, or t.me/c link
  --apply                         Actually add contacts (default is dry-run)
  --dry-run                       Preview actions without changing contacts
  --limit <N>                     Max eligible users to process (0 = no limit)
  --delay-ms <N>                  Delay between addContact calls (default: 10000)
  --participants-limit <N>        Max participants to fetch (default: 10000)
  --messages-limit <N>            Max messages to scan for users (default: 100000)
  --include-existing              Include users already marked as contacts
  --share-phone                   Allow added users to see your phone number
  -v, --verbose                   Enable verbose logging
  -h, --help                      Show this help message and exit

ENVIRONMENT:
  TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE
  TELEGRAM_CHAT_USERNAME or TELEGRAM_CHAT_ID

EXAMPLES:
  bun add-chat-users-to-contacts.mjs --chat @mygroup
  bun add-chat-users-to-contacts.mjs --chat @mygroup --apply --limit 20
`;
}

export function sanitizeChatTarget(chat) {
  const value = String(chat || '').trim();
  const privateLinkMatch = value.match(/(?:https?:\/\/)?t\.me\/c\/(\d+)(?:\/\d+)?/i);
  if (privateLinkMatch) {
    return `-100${privateLinkMatch[1]}`;
  }

  const publicLinkMatch = value.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,})(?:\/\d+)?/i);
  if (publicLinkMatch) {
    return `@${publicLinkMatch[1]}`;
  }

  return value.replace(/[^\w@-]/g, '');
}

export function unwrapTelegramId(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') {
    if ('value' in value) return unwrapTelegramId(value.value);
    if ('userId' in value) return unwrapTelegramId(value.userId);
    if ('id' in value) return unwrapTelegramId(value.id);
  }
  return value;
}

export function getUserIdKey(value) {
  const id = unwrapTelegramId(value);
  if (id === null || id === undefined || id === '') return null;
  return String(id);
}

function userScore(user) {
  if (!user || typeof user !== 'object') return 0;
  let score = 1;
  if (user.accessHash || user.access_hash) score += 5;
  if (user.username) score += 3;
  if (user.firstName || user.lastName) score += 2;
  if (user.phone) score += 1;
  return score;
}

function rememberUser(usersById, user, source) {
  if (!user || typeof user !== 'object') return false;
  if (user.className === 'Channel' || user.className === 'Chat') return false;
  const key = getUserIdKey(user);
  if (!key) return false;

  const existing = usersById.get(key);
  if (existing) {
    existing.sources.add(source);
    if (userScore(user) > userScore(existing.user)) {
      existing.user = user;
    }
    return false;
  }

  usersById.set(key, {
    key,
    user,
    sources: new Set([source]),
  });
  return true;
}

function rememberUserId(idsByKey, value, source) {
  const key = getUserIdKey(value);
  if (!key) return;
  if (!idsByKey.has(key)) {
    idsByKey.set(key, { id: unwrapTelegramId(value), sources: new Set() });
  }
  idsByKey.get(key).sources.add(source);
}

export function shouldAddContactCandidate(user, { meId, includeExisting = false } = {}) {
  if (!user || typeof user !== 'object') return { ok: false, reason: 'no-user' };
  if (user.className === 'Channel' || user.className === 'Chat') {
    return { ok: false, reason: 'non-user' };
  }

  const userKey = getUserIdKey(user);
  if (!userKey) return { ok: false, reason: 'no-id' };
  if (meId !== undefined && meId !== null && userKey === getUserIdKey(meId)) {
    return { ok: false, reason: 'self' };
  }

  if (user.bot === true) return { ok: false, reason: 'bot' };
  if (user.deleted === true) return { ok: false, reason: 'deleted' };
  if (user.fake === true) return { ok: false, reason: 'fake' };
  if (user.scam === true) return { ok: false, reason: 'scam' };
  if (user.support === true) return { ok: false, reason: 'support' };
  if (user.contact === true && !includeExisting) return { ok: false, reason: 'already-contact' };

  return { ok: true, reason: 'eligible' };
}

function cleanName(value) {
  return String(value || '').trim();
}

export function buildAddContactRequestArgs(user, { sharePhone = false } = {}) {
  let firstName = cleanName(user.firstName);
  let lastName = cleanName(user.lastName);

  if (!firstName && lastName) {
    firstName = lastName;
    lastName = '';
  }

  if (!firstName && user.username) {
    firstName = cleanName(user.username).replace(/^@/, '');
  }

  if (!firstName) {
    firstName = `User ${getUserIdKey(user) || 'unknown'}`;
  }

  return {
    id: user,
    firstName,
    lastName,
    phone: cleanName(user.phone),
    addPhonePrivacyException: Boolean(sharePhone),
  };
}

export function createJsonReplacer() {
  return (key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Set) return Array.from(value);
    return value;
  };
}

export function parseFloodWaitSeconds(err) {
  if (!err) return null;
  for (const field of ['seconds', 'value']) {
    if (Number.isFinite(err[field]) && err[field] > 0) return err[field];
  }

  const texts = [
    err.message,
    err.errorMessage,
    err.originalError?.message,
    typeof err.toString === 'function' ? err.toString() : '',
  ].filter(Boolean);

  for (const text of texts) {
    const floodMatch = String(text).match(/FLOOD_(?:PREMIUM_)?WAIT_(\d+)/i);
    if (floodMatch) return Number.parseInt(floodMatch[1], 10);

    const waitMatch = String(text).match(/wait of (\d+) seconds/i);
    if (waitMatch) return Number.parseInt(waitMatch[1], 10);
  }

  return null;
}

export function extractUserIdsFromMessage(message) {
  const ids = [];
  const add = (value) => {
    if (getUserIdKey(value)) ids.push(value);
  };

  add(message.senderId);

  const action = message.action;
  if (action) {
    if (action.className === 'MessageActionChatJoinedByLink' ||
        action.className === 'MessageActionChatJoinedByRequest') {
      add(message.senderId);
    }

    if (action.className === 'MessageActionChatAddUser' && action.users) {
      action.users.forEach(add);
    }

    if (action.className === 'MessageActionChatDeleteUser') {
      add(action.userId);
    }

    if (action.className === 'MessageActionChatCreate' && action.users) {
      action.users.forEach(add);
    }
  }

  const fromId = message.fwdFrom?.fromId;
  if (fromId?.userId) add(fromId.userId);

  if (message.entities) {
    for (const entity of message.entities) {
      if (entity.className === 'MessageEntityMentionName') add(entity.userId);
      if (entity.className === 'InputMessageEntityMentionName') add(entity.userId);
    }
  }

  if (message.media?.className === 'MessageMediaContact') {
    add(message.media.userId);
  }

  return ids;
}

function makeLogger(verbose) {
  return {
    verbose: (...msgs) => { if (verbose) console.log('[VERBOSE]', ...msgs); },
    info: (...msgs) => console.log(...msgs),
    warn: (...msgs) => console.warn(...msgs),
    error: (...msgs) => console.error(...msgs),
  };
}

function getDisplayName(user) {
  if (!user || typeof user !== 'object') return 'unknown';
  if (user.username) return `@${user.username}`;
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return name || `ID:${getUserIdKey(user) || 'unknown'}`;
}

function summarizeRecord(record, status, reason = null) {
  const user = record.user;
  return {
    id: getUserIdKey(user),
    username: user.username || null,
    firstName: user.firstName || null,
    lastName: user.lastName || null,
    displayName: getDisplayName(user),
    contact: user.contact === true,
    bot: user.bot === true,
    deleted: user.deleted === true,
    fake: user.fake === true,
    scam: user.scam === true,
    sources: Array.from(record.sources).sort(),
    status,
    reason,
  };
}

async function collectVisibleUsers(client, entity, config, log) {
  const usersById = new Map();
  const idsByKey = new Map();

  log.info('Fetching visible chat participants...');
  try {
    let count = 0;
    const params = config.participantsLimit > 0 ? { limit: config.participantsLimit } : {};
    for await (const participant of client.iterParticipants(entity, params)) {
      rememberUser(usersById, participant, 'participants');
      count++;
      if (count % 500 === 0) {
        log.info(`Fetched ${count} participants, ${usersById.size} unique users so far...`);
      }
    }
    log.info(`Fetched ${count} participants.`);
  } catch (err) {
    log.warn(`Could not fetch participants: ${err.message}`);
    log.verbose(err.stack || err);
  }

  if (config.messagesLimit > 0) {
    log.info('Scanning messages for additional visible users...');
    try {
      let count = 0;
      for await (const message of client.iterMessages(entity, { limit: config.messagesLimit })) {
        count++;
        if (message.sender && message.sender.className !== 'Channel' && message.sender.className !== 'Chat') {
          rememberUser(usersById, message.sender, 'message.sender');
        }

        for (const userId of extractUserIdsFromMessage(message)) {
          rememberUserId(idsByKey, userId, 'message');
        }

        if (count % 1000 === 0) {
          log.info(`Scanned ${count} messages, ${usersById.size} unique resolved users so far...`);
        }
      }
      log.info(`Scanned ${count} messages.`);
    } catch (err) {
      log.warn(`Could not scan messages: ${err.message}`);
      log.verbose(err.stack || err);
    }
  }

  const unresolved = Array.from(idsByKey.values())
    .filter(({ id }) => !usersById.has(getUserIdKey(id)));

  if (unresolved.length > 0) {
    log.info(`Resolving ${unresolved.length} user IDs from messages...`);
    let resolved = 0;
    let failed = 0;
    for (const item of unresolved) {
      try {
        const user = await client.getEntity(item.id);
        const added = rememberUser(usersById, user, Array.from(item.sources).join(', '));
        if (added) resolved++;
      } catch (err) {
        failed++;
        log.verbose(`Could not resolve user ${String(item.id)}: ${err.message}`);
      }

      if ((resolved + failed) % 50 === 0) {
        log.info(`Resolved ${resolved}/${unresolved.length} user IDs (${failed} failed)...`);
      }

      if (unresolved.length > 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    log.info(`User ID resolution complete: ${resolved} resolved, ${failed} failed.`);
  }

  return Array.from(usersById.values());
}

function normalizeError(err) {
  return {
    name: err?.name || null,
    message: err?.message || String(err),
    code: err?.code || err?.errorCode || null,
    seconds: parseFloodWaitSeconds(err),
  };
}

async function invokeAddContactWithFloodWait(client, Api, args, log) {
  try {
    return await client.invoke(new Api.contacts.AddContact(args));
  } catch (err) {
    const waitSeconds = parseFloodWaitSeconds(err);
    if (!waitSeconds) throw err;

    log.warn(`Telegram requested FLOOD_WAIT_${waitSeconds}; waiting before retrying this contact.`);
    await new Promise(resolve => setTimeout(resolve, (waitSeconds + 1) * 1000));
    return await client.invoke(new Api.contacts.AddContact(args));
  }
}

function getChatFolderName(entity, fallback) {
  const raw = entity?.username || entity?.title || fallback || entity?.id || 'unknown_chat';
  return String(raw).replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() || 'unknown_chat';
}

function writeReport(entity, chatTarget, report) {
  const folder = getChatFolderName(entity, chatTarget);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const outDir = path.join('data', folder);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `contact-add-report-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, createJsonReplacer(), 2));
  return outPath;
}

async function runCli(config) {
  const log = makeLogger(config.verbose);
  const { usingTelegram, use } = await import('./utils.mjs');

  let chatTarget = config.chat;
  if (!chatTarget) {
    const input = await use('readline-sync');
    chatTarget = input.question('Enter chat username (with @), chat ID, or t.me/c link: ');
  }
  chatTarget = sanitizeChatTarget(chatTarget);
  if (!chatTarget) {
    throw new Error('Chat target is required. Use --chat or TELEGRAM_CHAT_USERNAME/TELEGRAM_CHAT_ID.');
  }

  const originalWarningListeners = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (warning) => {
    if (warning.name === 'TimeoutNegativeWarning') return;
    originalWarningListeners.forEach(listener => listener(warning));
  });

  await usingTelegram(async ({ client, Api }) => {
    log.info('Connected.');
    log.info(`Chat target: ${chatTarget}`);

    const entity = await client.getEntity(chatTarget);
    const me = await client.getMe();
    const meId = unwrapTelegramId(me.id);
    log.verbose(`Resolved chat entity: ${entity.className || 'Unknown'} ${entity.id || ''}`);

    const records = await collectVisibleUsers(client, entity, config, log);
    const skipped = [];
    let eligible = [];

    for (const record of records) {
      const decision = shouldAddContactCandidate(record.user, {
        meId,
        includeExisting: config.includeExisting,
      });

      if (decision.ok) {
        eligible.push(record);
      } else {
        skipped.push(summarizeRecord(record, 'skipped', decision.reason));
      }
    }

    const eligibleBeforeLimit = eligible.length;
    if (config.limit > 0) {
      eligible = eligible.slice(0, config.limit);
    }

    log.info(`Found ${records.length} visible unique users.`);
    log.info(`Eligible to add: ${eligible.length}${config.limit > 0 ? ` of ${eligibleBeforeLimit} before --limit` : ''}.`);
    log.info(`Skipped: ${skipped.length}.`);

    const results = [];
    if (config.dryRun) {
      log.info('Dry-run mode: no contacts will be changed. Use --apply to add contacts.');
      for (const record of eligible) {
        results.push(summarizeRecord(record, 'dry-run', 'eligible'));
      }
    } else {
      log.info('Apply mode: adding eligible users to contacts.');
      for (let index = 0; index < eligible.length; index++) {
        const record = eligible[index];
        const user = record.user;
        const args = buildAddContactRequestArgs(user, { sharePhone: config.sharePhone });
        const summary = summarizeRecord(record, 'pending');
        summary.contactFirstName = args.firstName;
        summary.contactLastName = args.lastName;

        try {
          await invokeAddContactWithFloodWait(client, Api, args, log);
          summary.status = 'added';
          summary.reason = null;
          log.info(`[${index + 1}/${eligible.length}] Added ${getDisplayName(user)}`);
        } catch (err) {
          summary.status = 'failed';
          summary.reason = normalizeError(err);
          log.warn(`[${index + 1}/${eligible.length}] Failed ${getDisplayName(user)}: ${err.message}`);
        }

        results.push(summary);

        if (config.delayMs > 0 && index < eligible.length - 1) {
          await new Promise(resolve => setTimeout(resolve, config.delayMs));
        }
      }
    }

    const counts = {
      visibleUsers: records.length,
      eligibleBeforeLimit,
      processed: eligible.length,
      skipped: skipped.length,
      dryRun: results.filter(item => item.status === 'dry-run').length,
      added: results.filter(item => item.status === 'added').length,
      failed: results.filter(item => item.status === 'failed').length,
    };

    const report = {
      generatedAt: new Date().toISOString(),
      mode: config.dryRun ? 'dry-run' : 'apply',
      chat: {
        target: chatTarget,
        id: getUserIdKey(entity),
        title: entity.title || null,
        username: entity.username || null,
        className: entity.className || null,
      },
      options: {
        limit: config.limit,
        delayMs: config.delayMs,
        participantsLimit: config.participantsLimit,
        messagesLimit: config.messagesLimit,
        includeExisting: config.includeExisting,
        sharePhone: config.sharePhone,
      },
      counts,
      results,
      skipped,
    };

    const reportPath = writeReport(entity, chatTarget, report);
    log.info(`Report saved to ${reportPath}`);
  });
}

function isMainModule() {
  if (typeof Bun !== 'undefined' && Bun.main) {
    return path.resolve(Bun.main) === path.resolve(new URL(import.meta.url).pathname);
  }
  if (process.argv[1]) {
    return path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
  }
  return false;
}

if (isMainModule()) {
  try {
    const config = parseCliArgs();
    if (config.help) {
      console.log(formatHelp());
      process.exit(0);
    }

    await runCli(config);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}
