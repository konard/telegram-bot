#!/usr/bin/env bun
// chat-users.mjs
//
// Usage:
// 1. Just run: bun chat-users.mjs
// 2. Run with verbose output: bun chat-users.mjs --verbose
// 3. Show help: bun chat-users.mjs --help
//
// This script will prompt for your API credentials and the chat name to search.
// It will find all unique users from a chat using multiple methods:
//   - Channel/supergroup participants (via getParticipants API)
//   - Message authors, joins/leaves, mentions, forwards
// It will save the users list as JSON in 'data/{chat_username}/users.json'.

import fs from 'fs';

// Suppress TimeoutNegativeWarning from gramJS library (upstream issue with negative sleep calculations)
// This is a known issue in Node.js v24+ where negative setTimeout values now emit warnings
// See: https://github.com/vercel/vercel/issues/14476
const originalWarningListeners = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'TimeoutNegativeWarning') {
    // Silently ignore - this is a gramJS library issue, functionally harmless
    return;
  }
  // Re-emit other warnings to original listeners
  originalWarningListeners.forEach(listener => listener(warning));
});

// Parse command-line arguments before any Telegram connection
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const showHelp = args.includes('--help') || args.includes('-h');

// Helper for verbose logging (disabled by default)
const log = {
  verbose: (...msgs) => { if (verbose) console.log('[VERBOSE]', ...msgs); },
  info: (...msgs) => console.log(...msgs),
  warn: (...msgs) => console.warn(...msgs),
  error: (...msgs) => console.error(...msgs),
};

// Show help and exit without connecting to Telegram
if (showHelp) {
  console.log(`
chat-users.mjs - Extract unique users from a Telegram chat

USAGE:
  bun chat-users.mjs [OPTIONS]

OPTIONS:
  -h, --help      Show this help message and exit
  -v, --verbose   Enable verbose output for debugging

ENVIRONMENT VARIABLES:
  TELEGRAM_API_ID        Your Telegram API ID
  TELEGRAM_API_HASH      Your Telegram API Hash
  TELEGRAM_PHONE         Your phone number (for authentication)
  TELEGRAM_CHAT_USERNAME Chat username or title to search for
  TELEGRAM_CHAT_ID       Alternative: Chat ID to use directly

DESCRIPTION:
  This script extracts all unique users from a Telegram chat by:
  1. For channels/supergroups: Using the getParticipants API
  2. For all chats: Scanning message authors, service messages,
     forwarded message sources, mentions, and shared contacts

  Results are saved to data/{chat_username}/users.json

EXAMPLES:
  # Interactive mode (prompts for credentials and chat name)
  bun chat-users.mjs

  # With verbose debugging output
  bun chat-users.mjs --verbose

  # Using environment variables
  TELEGRAM_CHAT_USERNAME=@mychat bun chat-users.mjs
`);
  process.exit(0);
}

// Only import Telegram-related modules after help check
const { usingTelegram, use } = await import('./utils.mjs');
const input = await use('readline-sync');

try {
  await usingTelegram(async ({ client, Api }) => {
    log.info('Connected.');

    // Get chat search query from environment or prompt
    let searchQuery = process.env.TELEGRAM_CHAT_USERNAME || process.env.TELEGRAM_CHAT_ID;
    if (!searchQuery) {
      searchQuery = input.question('Enter chat name to search: ');
    }
    searchQuery = searchQuery.trim();

    // Search for matching chats/dialogs
    const dialogs = await client.getDialogs({});
    log.verbose(`Found ${dialogs.length} total dialogs`);

    const matchingChats = dialogs.filter(dialog => {
      const entity = dialog.entity;
      if (!entity) return false;

      // Check if search query matches title, username, firstName, or lastName (case-insensitive)
      const title = entity.title || '';
      const username = entity.username || '';
      const firstName = entity.firstName || '';
      const lastName = entity.lastName || '';
      const searchLower = searchQuery.toLowerCase().replace(/^@/, '');

      return (
        title.toLowerCase().includes(searchLower) ||
        username.toLowerCase().includes(searchLower) ||
        firstName.toLowerCase().includes(searchLower) ||
        lastName.toLowerCase().includes(searchLower)
      );
    });

    if (matchingChats.length === 0) {
      log.info(`No chats found matching "${searchQuery}". Please try a different search query.`);
      return;
    }

    let selectedChat;
    if (matchingChats.length === 1) {
      selectedChat = matchingChats[0];
      const entity = selectedChat.entity;
      const displayName = entity.title || entity.username || `${entity.firstName || ''} ${entity.lastName || ''}`.trim();
      log.info(`Found chat: ${displayName}`);
    } else {
      // Multiple matches - display them and ask for stricter search
      log.info(`\nFound ${matchingChats.length} chats matching "${searchQuery}":\n`);
      matchingChats.forEach((dialog, idx) => {
        const entity = dialog.entity;
        const displayName = entity.title || entity.username || `${entity.firstName || ''} ${entity.lastName || ''}`.trim();
        const username = entity.username ? `@${entity.username}` : '';
        const chatType = entity.className || 'Unknown';
        log.info(`  ${idx + 1}. ${displayName} ${username} (${chatType})`);
      });
      log.info('\nPlease use a more specific search query to narrow down to a single chat.');
      return;
    }

    const entity = selectedChat.entity;
    const entityType = entity.className || 'Unknown';
    const isChannel = entityType === 'Channel';
    const isMegagroup = entity.megagroup === true;
    const isGroup = entityType === 'Chat';

    log.verbose(`Entity type: ${entityType}`);
    log.verbose(`Is channel: ${isChannel}`);
    log.verbose(`Is megagroup (supergroup): ${isMegagroup}`);
    log.verbose(`Is regular group: ${isGroup}`);
    log.verbose(`Entity ID: ${entity.id}`);
    if (entity.username) log.verbose(`Entity username: @${entity.username}`);

    // Map to store unique users: key = normalized ID, value = user info
    const uniqueUsers = new Map();

    // Helper to add user to the map
    const addUser = (user, source = 'unknown') => {
      if (!user) return false;

      // Normalize user ID
      let id;
      if (typeof user === 'object') {
        id = typeof user.id === 'object' && 'value' in user.id ? user.id.value : user.id;
      } else {
        id = user;
      }

      if (!id) return false;

      const idStr = String(id);

      // If user is just an ID, create basic entry
      if (typeof user !== 'object') {
        if (!uniqueUsers.has(idStr)) {
          uniqueUsers.set(idStr, { id: id, _source: source });
          log.verbose(`Added user ID ${id} from ${source}`);
          return true;
        }
        return false;
      }

      // Skip if this is a channel/chat, not a user
      if (user.className === 'Channel' || user.className === 'Chat') {
        log.verbose(`Skipping non-user entity: ${user.className} (ID: ${id})`);
        return false;
      }

      // Store full user info if available, or update existing with more info
      const existing = uniqueUsers.get(idStr);
      const isNew = !existing;
      const newInfo = {
        id: id,
        username: user.username || existing?.username || null,
        firstName: user.firstName || existing?.firstName || null,
        lastName: user.lastName || existing?.lastName || null,
        phone: user.phone || existing?.phone || null,
        bot: user.bot || existing?.bot || false,
        deleted: user.deleted || existing?.deleted || false,
        _source: existing?._source ? `${existing._source}, ${source}` : source,
      };
      uniqueUsers.set(idStr, newInfo);
      if (isNew) {
        log.verbose(`Added user ${user.username ? '@' + user.username : 'ID:' + id} from ${source}`);
      }
      return isNew;
    };

    // Helper to resolve user ID to full user info
    const resolveUser = async (userId) => {
      if (!userId) return;
      try {
        const userEntity = await client.getEntity(userId);
        addUser(userEntity, 'resolved');
      } catch (err) {
        // User might be deleted or inaccessible, just store the ID
        log.verbose(`Could not resolve user ${userId}: ${err.message}`);
        addUser(userId, 'unresolved');
      }
    };

    // For channels and supergroups, first try to get participants directly
    if (isChannel || isMegagroup) {
      log.info('Fetching channel/supergroup participants...');
      try {
        let participantCount = 0;
        for await (const participant of client.iterParticipants(entity, { limit: 10000 })) {
          addUser(participant, 'participants');
          participantCount++;
          if (participantCount % 100 === 0) {
            log.verbose(`Fetched ${participantCount} participants, ${uniqueUsers.size} unique users so far...`);
          }
        }
        log.info(`Fetched ${participantCount} participants from channel/supergroup.`);
      } catch (err) {
        log.warn(`Could not fetch participants (this is normal if you're not an admin): ${err.message}`);
        log.verbose(`Full error: ${err.stack}`);
      }
    }

    // Now iterate through all messages to find additional users
    log.info('Collecting users from chat messages...');

    let messageCount = 0;
    let messagesWithSender = 0;
    let messagesWithoutSender = 0;

    for await (const message of client.iterMessages(entity, { limit: 100000 })) {
      messageCount++;
      if (messageCount % 1000 === 0) {
        log.info(`Processed ${messageCount} messages, found ${uniqueUsers.size} unique users so far...`);
      }

      // 1. Message author (senderId)
      if (message.senderId) {
        messagesWithSender++;
        addUser(message.senderId, 'message.senderId');
      } else {
        messagesWithoutSender++;
        if (verbose && messageCount <= 10) {
          log.verbose(`Message ${messageCount} has no senderId (likely anonymous channel post)`);
        }
      }

      // 2. Service messages (user joined, left, added, removed, etc.)
      if (message.action) {
        const action = message.action;
        log.verbose(`Message ${messageCount} has action: ${action.className}`);

        // User joined by invite link or themselves
        if (action.className === 'MessageActionChatJoinedByLink' ||
            action.className === 'MessageActionChatJoinedByRequest') {
          if (message.senderId) {
            addUser(message.senderId, `action.${action.className}`);
          }
        }

        // Users added to chat
        if (action.className === 'MessageActionChatAddUser' && action.users) {
          for (const userId of action.users) {
            addUser(userId, 'action.ChatAddUser');
          }
        }

        // User left or was removed
        if (action.className === 'MessageActionChatDeleteUser' && action.userId) {
          addUser(action.userId, 'action.ChatDeleteUser');
        }

        // Chat created with users
        if (action.className === 'MessageActionChatCreate' && action.users) {
          for (const userId of action.users) {
            addUser(userId, 'action.ChatCreate');
          }
        }

        // Invite to channel/group
        if (action.className === 'MessageActionChannelMigrateFrom' && action.chatId) {
          // Note: chatId here is the old chat, not a user
          log.verbose(`Channel migrated from chat ${action.chatId}`);
        }
      }

      // 3. Forwarded messages - get original sender
      if (message.fwdFrom) {
        if (message.fwdFrom.fromId) {
          const fromId = message.fwdFrom.fromId;
          // fromId can be PeerUser, PeerChannel, etc.
          if (fromId.userId) {
            addUser(fromId.userId, 'fwdFrom.userId');
          } else if (fromId.className === 'PeerUser' && fromId.userId) {
            addUser(fromId.userId, 'fwdFrom.PeerUser');
          }
        }
        // Original poster (in channels)
        if (message.fwdFrom.postAuthor) {
          log.verbose(`Forward has postAuthor (string name, not ID): "${message.fwdFrom.postAuthor}"`);
        }
      }

      // 4. Mentioned entities in message text
      if (message.entities) {
        for (const ent of message.entities) {
          // MessageEntityMention is @username
          // MessageEntityMentionName contains userId
          if (ent.className === 'MessageEntityMentionName' && ent.userId) {
            addUser(ent.userId, 'entity.MentionName');
          }
          // InputMessageEntityMentionName also contains userId
          if (ent.className === 'InputMessageEntityMentionName' && ent.userId) {
            addUser(ent.userId.userId || ent.userId, 'entity.InputMentionName');
          }
        }
      }

      // 5. Reply to message - get original message sender
      if (message.replyTo && message.replyTo.replyToMsgId) {
        // We could fetch the original message, but that would be very slow
        // The sender of replied messages should already be captured via iterMessages
      }

      // 6. Media from user (e.g., sticker, contact shared)
      if (message.media) {
        // Contact shared
        if (message.media.className === 'MessageMediaContact' && message.media.userId) {
          addUser(message.media.userId, 'media.contact');
        }
      }
    }

    log.info(`\nProcessed ${messageCount} messages total.`);
    log.verbose(`Messages with senderId: ${messagesWithSender}`);
    log.verbose(`Messages without senderId: ${messagesWithoutSender} (anonymous posts)`);

    // Resolve unknown users (those that are just IDs)
    log.info('Resolving user details...');
    const usersToResolve = [];
    for (const [idStr, userInfo] of uniqueUsers) {
      // Only resolve if we don't have username or name info
      if (!userInfo.username && !userInfo.firstName && !userInfo.lastName && userInfo.id) {
        usersToResolve.push(userInfo.id);
      }
    }

    if (usersToResolve.length > 0) {
      log.info(`Resolving ${usersToResolve.length} user IDs...`);
      let resolved = 0;
      for (const userId of usersToResolve) {
        await resolveUser(userId);
        resolved++;
        if (resolved % 50 === 0) {
          log.info(`Resolved ${resolved}/${usersToResolve.length} users...`);
        }
      }
    }

    // Convert to array and sort by ID (remove internal _source field for output)
    const usersArray = Array.from(uniqueUsers.values())
      .map(u => {
        const { _source, ...userWithoutSource } = u;
        return userWithoutSource;
      })
      .sort((a, b) => {
        const idA = typeof a.id === 'bigint' ? Number(a.id) : (a.id || 0);
        const idB = typeof b.id === 'bigint' ? Number(b.id) : (b.id || 0);
        return idA - idB;
      });

    log.info(`\nFound ${usersArray.length} unique users.`);

    // Print summary
    const withUsername = usersArray.filter(u => u.username).length;
    const bots = usersArray.filter(u => u.bot).length;
    const deleted = usersArray.filter(u => u.deleted).length;
    log.info(`  - With username: ${withUsername}`);
    log.info(`  - Bots: ${bots}`);
    log.info(`  - Deleted accounts: ${deleted}`);

    // Verbose: show source statistics
    if (verbose) {
      const sourceStats = {};
      for (const [, userInfo] of uniqueUsers) {
        const sources = userInfo._source?.split(', ') || ['unknown'];
        for (const src of sources) {
          sourceStats[src] = (sourceStats[src] || 0) + 1;
        }
      }
      log.verbose('User sources:');
      for (const [source, count] of Object.entries(sourceStats).sort((a, b) => b[1] - a[1])) {
        log.verbose(`  - ${source}: ${count}`);
      }
    }

    // Determine output path
    let chatUsername = entity.username || '';
    if (!chatUsername && entity.title) {
      // Use sanitized title as folder name
      chatUsername = entity.title.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    }
    if (!chatUsername) {
      chatUsername = String(entity.id || 'unknown_chat');
    }

    const outDir = `data/${chatUsername}`;
    const outPath = `${outDir}/users.json`;
    fs.mkdirSync(outDir, { recursive: true });
    // Use a replacer to handle BigInt serialization (Telegram IDs can exceed Number.MAX_SAFE_INTEGER)
    const bigIntReplacer = (key, value) =>
      typeof value === 'bigint' ? value.toString() : value;
    fs.writeFileSync(outPath, JSON.stringify(usersArray, bigIntReplacer, 2));
    log.info(`\nUsers list saved to ${outPath}`);

    // Also print first few users as sample
    log.info('\nSample users:');
    usersArray.slice(0, 10).forEach(user => {
      const display = user.username
        ? `@${user.username}`
        : (user.firstName || user.lastName
          ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
          : `ID:${user.id}`);
      const tags = [];
      if (user.bot) tags.push('bot');
      if (user.deleted) tags.push('deleted');
      const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
      log.info(`  - ${display}${tagStr}`);
    });
    if (usersArray.length > 10) {
      log.info(`  ... and ${usersArray.length - 10} more`);
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
