#!/usr/bin/env bun
import { usingTelegram, use } from './utils.mjs';
import fs from 'fs';
import path from 'path';
import { sendGreetingSticker } from './send-greeting-sticker.mjs';

// message-members.mjs
//
// Usage:
// 1. Run: bun message-members.mjs [maxGreetings]
//
// This script will prompt for your API credentials, chat username or ID, and sticker set name.
// It will fetch all members of the chat and send each a random sticker from the set via private message.

const input = await use('readline-sync');

try {
  await usingTelegram(async ({ client, Api }) => {
    // Connected.
    // Load greet cache
    const cacheDir = path.resolve('./data');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, 'greetCache.json');
    let greetedCache = {};
    if (fs.existsSync(cacheFile)) {
      try {
        greetedCache = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8'));
        console.log(`Loaded greet cache (${Object.keys(greetedCache).length} entries)`);
      } catch (e) {
        console.error('Error reading greet cache, starting fresh:', e);
        greetedCache = {};
      }
    }

    let chat = process.env.TELEGRAM_CHAT_USERNAME || process.env.TELEGRAM_CHAT_ID;
    if (!chat) {
      chat = input.question('Enter chat username (with @) or chat ID: ');
    }
    chat = chat.replace(/[^\w@-]/g, '');
    const channel = await client.getEntity(chat);
    // Pre-flight check: ensure the entity is a channel, not a user
    try {
      await client.invoke(new Api.channels.GetParticipants({ channel, filter: new Api.ChannelParticipantsRecent(), offset: 0, limit: 1, hash: 0 }));
    } catch (err) {
      if (err.message.includes('InputPeerUser')) {
        throw new Error(`Failed to fetch members: the identifier "${chat}" refers to a user, not a channel. Please provide a group or supergroup chat username or ID.`);
      }
      throw err;
    }

    // Fetch all participants
    const participants = [];
    let offset = 0;
    const limit = 1000;
    while (true) {
      const res = await client.invoke(new Api.channels.GetParticipants({
        channel: channel,
        filter: new Api.ChannelParticipantsRecent(),
        offset: offset,
        limit: limit,
        hash: 0,
      }));
      if (!res.users || res.users.length === 0) break;
      participants.push(...res.users);
      offset += res.users.length;
    }
    console.log(`Fetched ${participants.length} participants.`);
    // Exclude the bot itself and filter for regular users only
    const me = await client.getMe();
    const myId = typeof me.id === 'object' && 'value' in me.id ? me.id.value : me.id;
    const recipients = participants.filter(user => {
      const uid = typeof user.id === 'object' && 'value' in user.id ? user.id.value : user.id;
      
      // Skip if it's the bot itself
      if (uid === myId) return false;
      
      // Skip bots (user.bot === true)
      if (user.bot === true) return false;
      
      // Skip deleted accounts (user.deleted === true)
      if (user.deleted === true) return false;
      
      // Skip fake accounts (user.fake === true)
      if (user.fake === true) return false;
      
      // Skip scam accounts (user.scam === true)
      if (user.scam === true) return false;
      
      // Skip verified accounts (usually businesses/official accounts)
      if (user.verified === true) return false;
      
      // Skip premium accounts (optional - remove if you want to include them)
      // if (user.premium === true) return false;
      
      // Skip users with no username (optional - remove if you want to include them)
      // if (!user.username) return false;
      
      // Only include regular users (not bots, not deleted, not fake, not scam)
      return true;
    });
    
    console.log(`Filtered to ${recipients.length} regular users (excluded bots, deleted, fake, scam accounts).`);
    if (!recipients.length) {
      console.log('No other participants to message.');
      return;
    }


    // Determine max greetings: command-line arg overrides env and prompt (0 for no limit)
    const maxGreetingsArg = process.argv[2];
    const maxGreetingsInput = maxGreetingsArg !== undefined
      ? maxGreetingsArg
      : (process.env.TELEGRAM_MAX_GREETINGS || input.question('Enter max greetings to send (0 for no limit): '));
    let maxGreetings = parseInt(maxGreetingsInput, 10);
    if (isNaN(maxGreetings) || maxGreetings < 0) {
      maxGreetings = 0;
    }
    let sentCount = 0;

    // Send a random hi/hello sticker using shared function
    const totalRecipients = recipients.length;
    for (let idx = 0; idx < totalRecipients; idx++) {
      const user = recipients[idx];
      try {
        // Check greet cache to avoid duplicate greetings within 24h
        const uid = typeof user.id === 'object' && 'value' in user.id ? user.id.value : user.id;
        if (greetedCache[uid] && (Date.now() - greetedCache[uid] < 24 * 60 * 60 * 1000)) {
          console.log(`Skipping ${user.username || uid} – greeted within last 24h`);
          continue;
        }
        const chatTarget = user.username ? `@${user.username}` : uid;
        const { stickerInfo } = await sendGreetingSticker({ client, Api, chatUsername: chatTarget });
        const displayName = user.username ? `@${user.username}` : uid;
        const stickerIdentifier = `${stickerInfo.id} (${stickerInfo.alt || 'no alt'})`;
        console.log(`[${idx+1}/${totalRecipients}] Sticker "${stickerIdentifier}" sent to ${displayName}`);
        // Update and persist greet cache
        greetedCache[uid] = Date.now();
        await fs.promises.writeFile(cacheFile, JSON.stringify(greetedCache, null, 2), 'utf8');

        // Pause for 30 seconds to avoid flooding
        console.log('Sleeping for 30 seconds before next greeting...');
        await new Promise(res => setTimeout(res, 30000));
        sentCount++;
        // Stop if max greetings reached
        if (maxGreetings > 0 && sentCount >= maxGreetings) {
          console.log('Reached max greetings limit.');
          break;
        }
      } catch (err) {
        console.error(`Failed to send to ${user.id}:`, err);
        throw err;
      }
    }

  });
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
} 