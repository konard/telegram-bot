#!/usr/bin/env bun
// history-to-markdown.mjs
//
// Usage:
// 1. Just run: bun history-to-markdown.mjs
//
// This script will prompt for your API credentials and the chat username or ID.
// It will save the chat history as Markdown in 'chat-history.md'.

import fs from 'fs';
import { usingTelegram, use } from './utils.mjs';
const input = await use('readline-sync');

// Environment and prompts handled in utils

// Remove main function and use top-level await
try {
  await usingTelegram(async ({ client, Api }) => {
    console.log('Connected.');

    let chat = process.env.TELEGRAM_CHAT_USERNAME || process.env.TELEGRAM_CHAT_ID;
    if (!chat) {
      chat = input.question('Enter chat username (with @) or chat ID: ');
    }
    chat = chat.replace(/[^\w@-]/g, ''); // Remove special characters except @, -, _
    const entity = await client.getEntity(chat);

    let allMessages = [];
    for await (const message of client.iterMessages(entity, { limit: 10000 })) {
      if (message.message) {
        let msgDate = message.date;
        if (msgDate && typeof msgDate.toISOString === 'function') {
          msgDate = msgDate.toISOString();
        } else if (msgDate && typeof msgDate === 'string') {
          // Already a string, use as-is
        } else if (msgDate) {
          msgDate = String(msgDate);
        } else {
          msgDate = '';
        }
        allMessages.push({
          date: msgDate,
          sender: message.senderId,
          text: message.message,
        });
      }
    }

    // Fetch all user info for mapping senderId to username
    const userMap = {};
    for (const msg of allMessages) {
      if (msg.sender && !userMap[msg.sender]) {
        try {
          const sender = await client.getEntity(msg.sender);
          userMap[msg.sender] = sender.username ? `@${sender.username}` : (sender.firstName || sender.lastName || msg.sender);
        } catch {
          userMap[msg.sender] = msg.sender;
        }
      }
    }

    // Format as Markdown with usernames and ISO date
    const md = allMessages
      .reverse()
      .map(
        (msg) => {
          let date = msg.date;
          // Try to format as ISO 2025-05-18 23:14:34
          if (date && !date.includes('-')) {
            const d = new Date(Number(date) * 1000);
            if (!isNaN(d)) {
              date = d.toISOString().replace('T', ' ').substring(0, 19);
            }
          } else if (date && date.length >= 19 && date[10] === 'T') {
            date = date.replace('T', ' ').substring(0, 19);
          }
          const sender = userMap[msg.sender] || msg.sender;
          return `**${sender}** [${date}]:\n${msg.text}\n`;
        }
      )
      .join('\n');

    // Determine chat username for path
    let chatUsername = process.env.TELEGRAM_CHAT_USERNAME || '';
    if (!chatUsername && chat.startsWith('@')) {
      chatUsername = chat;
    } else if (!chatUsername) {
      chatUsername = 'unknown_chat';
    }
    chatUsername = chatUsername.replace(/^@/, ''); // Remove leading @
    const outDir = `data/${chatUsername}`;
    const outPath = `${outDir}/history.md`;
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, md);
    console.log(`Chat history saved to ${outPath}`);
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
