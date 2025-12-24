#!/usr/bin/env bun
// send-start.mjs
//
// Usage:
// 1. Just run: bun send-start.mjs
//
import { usingTelegram } from './utils.mjs';

if (import.meta.main) {
  await usingTelegram(async ({ client }) => {
    // Send /start command to the bot
    await client.sendMessage('@DeepGPTBot', { message: '/start' });
    console.log('Sent /start message to @DeepGPTBot');
  });
} 