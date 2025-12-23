// chat-users.mjs
//
// Usage:
// 1. Just run: bun chat-users.mjs
//
// This script will prompt for your API credentials and the chat name to search.
// It will find all unique users mentioned in a chat (message authors, joins/leaves, mentions, forwards).
// It will save the users list as JSON in 'data/{chat_username}/users.json'.

import fs from 'fs';
import { usingTelegram, use } from './utils.mjs';
const input = await use('readline-sync');

try {
  await usingTelegram(async ({ client, Api }) => {
    console.log('Connected.');

    // Get chat search query from environment or prompt
    let searchQuery = process.env.TELEGRAM_CHAT_USERNAME || process.env.TELEGRAM_CHAT_ID;
    if (!searchQuery) {
      searchQuery = input.question('Enter chat name to search: ');
    }
    searchQuery = searchQuery.trim();

    // Search for matching chats/dialogs
    const dialogs = await client.getDialogs({});
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
      console.log(`No chats found matching "${searchQuery}". Please try a different search query.`);
      return;
    }

    let selectedChat;
    if (matchingChats.length === 1) {
      selectedChat = matchingChats[0];
      const entity = selectedChat.entity;
      const displayName = entity.title || entity.username || `${entity.firstName || ''} ${entity.lastName || ''}`.trim();
      console.log(`Found chat: ${displayName}`);
    } else {
      // Multiple matches - display them and ask for stricter search
      console.log(`\nFound ${matchingChats.length} chats matching "${searchQuery}":\n`);
      matchingChats.forEach((dialog, idx) => {
        const entity = dialog.entity;
        const displayName = entity.title || entity.username || `${entity.firstName || ''} ${entity.lastName || ''}`.trim();
        const username = entity.username ? `@${entity.username}` : '';
        const chatType = entity.className || 'Unknown';
        console.log(`  ${idx + 1}. ${displayName} ${username} (${chatType})`);
      });
      console.log('\nPlease use a more specific search query to narrow down to a single chat.');
      return;
    }

    const entity = selectedChat.entity;
    console.log('Collecting unique users from chat messages...');

    // Map to store unique users: key = normalized ID, value = user info
    const uniqueUsers = new Map();

    // Helper to add user to the map
    const addUser = (user) => {
      if (!user) return;

      // Normalize user ID
      let id;
      if (typeof user === 'object') {
        id = typeof user.id === 'object' && 'value' in user.id ? user.id.value : user.id;
      } else {
        id = user;
      }

      if (!id) return;

      const idStr = String(id);

      // If user is just an ID, create basic entry
      if (typeof user !== 'object') {
        if (!uniqueUsers.has(idStr)) {
          uniqueUsers.set(idStr, { id: id });
        }
        return;
      }

      // Store full user info if available, or update existing with more info
      const existing = uniqueUsers.get(idStr);
      const newInfo = {
        id: id,
        username: user.username || existing?.username || null,
        firstName: user.firstName || existing?.firstName || null,
        lastName: user.lastName || existing?.lastName || null,
        phone: user.phone || existing?.phone || null,
        bot: user.bot || existing?.bot || false,
        deleted: user.deleted || existing?.deleted || false,
      };
      uniqueUsers.set(idStr, newInfo);
    };

    // Helper to resolve user ID to full user info
    const resolveUser = async (userId) => {
      if (!userId) return;
      try {
        const userEntity = await client.getEntity(userId);
        addUser(userEntity);
      } catch {
        // User might be deleted or inaccessible, just store the ID
        addUser(userId);
      }
    };

    // Iterate through all messages
    let messageCount = 0;
    for await (const message of client.iterMessages(entity, { limit: 100000 })) {
      messageCount++;
      if (messageCount % 1000 === 0) {
        console.log(`Processed ${messageCount} messages, found ${uniqueUsers.size} unique users so far...`);
      }

      // 1. Message author (senderId)
      if (message.senderId) {
        addUser(message.senderId);
      }

      // 2. Service messages (user joined, left, added, removed, etc.)
      if (message.action) {
        const action = message.action;

        // User joined by invite link or themselves
        if (action.className === 'MessageActionChatJoinedByLink' ||
            action.className === 'MessageActionChatJoinedByRequest') {
          if (message.senderId) {
            addUser(message.senderId);
          }
        }

        // Users added to chat
        if (action.className === 'MessageActionChatAddUser' && action.users) {
          for (const userId of action.users) {
            addUser(userId);
          }
        }

        // User left or was removed
        if (action.className === 'MessageActionChatDeleteUser' && action.userId) {
          addUser(action.userId);
        }

        // Chat created with users
        if (action.className === 'MessageActionChatCreate' && action.users) {
          for (const userId of action.users) {
            addUser(userId);
          }
        }

        // Invite to channel/group
        if (action.className === 'MessageActionChannelMigrateFrom' && action.chatId) {
          addUser(action.chatId);
        }
      }

      // 3. Forwarded messages - get original sender
      if (message.fwdFrom) {
        if (message.fwdFrom.fromId) {
          const fromId = message.fwdFrom.fromId;
          // fromId can be PeerUser, PeerChannel, etc.
          if (fromId.userId) {
            addUser(fromId.userId);
          } else if (fromId.className === 'PeerUser') {
            addUser(fromId.userId);
          }
        }
        // Original poster (in channels)
        if (message.fwdFrom.postAuthor) {
          // postAuthor is just a string name, not a user ID
        }
      }

      // 4. Mentioned entities in message text
      if (message.entities) {
        for (const ent of message.entities) {
          // MessageEntityMention is @username
          // MessageEntityMentionName contains userId
          if (ent.className === 'MessageEntityMentionName' && ent.userId) {
            addUser(ent.userId);
          }
          // InputMessageEntityMentionName also contains userId
          if (ent.className === 'InputMessageEntityMentionName' && ent.userId) {
            addUser(ent.userId.userId || ent.userId);
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
          addUser(message.media.userId);
        }
      }
    }

    console.log(`\nProcessed ${messageCount} messages total.`);

    // Resolve unknown users (those that are just IDs)
    console.log('Resolving user details...');
    const usersToResolve = [];
    for (const [idStr, userInfo] of uniqueUsers) {
      // Only resolve if we don't have username or name info
      if (!userInfo.username && !userInfo.firstName && !userInfo.lastName && userInfo.id) {
        usersToResolve.push(userInfo.id);
      }
    }

    if (usersToResolve.length > 0) {
      console.log(`Resolving ${usersToResolve.length} user IDs...`);
      let resolved = 0;
      for (const userId of usersToResolve) {
        await resolveUser(userId);
        resolved++;
        if (resolved % 50 === 0) {
          console.log(`Resolved ${resolved}/${usersToResolve.length} users...`);
        }
      }
    }

    // Convert to array and sort by ID
    const usersArray = Array.from(uniqueUsers.values())
      .sort((a, b) => {
        const idA = typeof a.id === 'bigint' ? Number(a.id) : (a.id || 0);
        const idB = typeof b.id === 'bigint' ? Number(b.id) : (b.id || 0);
        return idA - idB;
      });

    console.log(`\nFound ${usersArray.length} unique users.`);

    // Print summary
    const withUsername = usersArray.filter(u => u.username).length;
    const bots = usersArray.filter(u => u.bot).length;
    const deleted = usersArray.filter(u => u.deleted).length;
    console.log(`  - With username: ${withUsername}`);
    console.log(`  - Bots: ${bots}`);
    console.log(`  - Deleted accounts: ${deleted}`);

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
    fs.writeFileSync(outPath, JSON.stringify(usersArray, null, 2));
    console.log(`\nUsers list saved to ${outPath}`);

    // Also print first few users as sample
    console.log('\nSample users:');
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
      console.log(`  - ${display}${tagStr}`);
    });
    if (usersArray.length > 10) {
      console.log(`  ... and ${usersArray.length - 10} more`);
    }
  });
  process.exit(0);
} catch (err) {
  if (err && err.message && err.message.includes('TIMEOUT')) {
    console.warn('Warning: Telegram client timeout after disconnect. This can be safely ignored.');
    process.exit(0);
  } else {
    console.error('Error:', err);
    process.exit(1);
  }
}
