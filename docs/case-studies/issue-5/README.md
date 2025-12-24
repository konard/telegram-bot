# Case Study: Issue #5 - ./chat-users.mjs Issues

## Summary

This case study analyzes multiple issues with the `chat-users.mjs` script that extracts unique users from Telegram chats.

**Issue Link**: https://github.com/konard/telegram-bot/issues/5

**Date of Issue**: 2025-12-24

**Affected Script**: `chat-users.mjs`

---

## Timeline of Events

### Original Error Report

```
konard@MacBook-Pro-Konstantin telegram-bot % ./chat-users.mjs --help
[dotenv@17.2.3] injecting env (0) from .env -- tip: ...
[2025-12-24T18:36:51.350] [INFO] - [Running gramJS version 2.26.21]
[2025-12-24T18:36:51.351] [INFO] - [Connecting to 149.154.167.51:80/TCPFull...]
[2025-12-24T18:36:51.513] [INFO] - [Connection to 149.154.167.51:80/TCPFull complete!]
[2025-12-24T18:36:51.514] [INFO] - [Using LAYER 198 for initial connect]
Connected.
Connected.
Found chat: Agiens_hackathon_vibecode
Collecting unique users from chat messages...
TimeoutNegativeWarning: -1766581619.921 is a negative number.
Timeout duration was set to 1.
      at new Promise (1:11)
      at sleep (/Users/konard/.bun/install/global/node_modules/telegram-v-latest/Helpers.js:393:40)
      at <anonymous> (/Users/konard/.bun/install/global/node_modules/telegram-v-latest/requestIter.js:50:45)

Processed 483 messages total.
Resolving user details...

Found 0 unique users.
  - With username: 0
  - Bots: 0
  - Deleted accounts: 0

Users list saved to data/agiens_hackathon/users.json
```

---

## Identified Issues

### Issue 1: --help Requires Telegram Connection

**Symptom**: Running `./chat-users.mjs --help` connects to Telegram instead of showing help.

**Root Cause**: The script immediately calls `usingTelegram()` without parsing command-line arguments first.

**Code Reference** (`chat-users.mjs:15-16`):
```javascript
try {
  await usingTelegram(async ({ client, Api }) => {
    // ... no argument parsing before this
```

**Expected Behavior**: `--help` should display usage information without requiring a network connection.

---

### Issue 2: Zero Users Found Despite 483 Messages

**Symptom**: The script processed 483 messages but found 0 unique users.

**Root Cause Analysis**:

1. **Channel vs Group Behavior**: The chat "Agiens_hackathon_vibecode" appears to be a Telegram **channel**. In channels:
   - Messages posted by admins appear anonymously (as the channel itself)
   - The `message.senderId` is `null` or `undefined` for anonymous admin posts
   - This is by design in Telegram's API

2. **Algorithm Limitations**: The current algorithm relies heavily on `message.senderId`:
   ```javascript
   if (message.senderId) {
     addUser(message.senderId);
   }
   ```
   For channels with anonymous posts, this will never find users.

3. **Alternative Approaches Not Used**: GramJS provides `getParticipants()` and `iterParticipants()` methods to retrieve channel/supergroup members directly, which the script doesn't use.

**Reference**: [GramJS Documentation - Getting Participants](https://painor.gitbook.io/gramjs/getting-started/available-methods/getting-participants-of-a-group-channel)

---

### Issue 3: TimeoutNegativeWarning

**Symptom**:
```
TimeoutNegativeWarning: -1766581619.921 is a negative number.
Timeout duration was set to 1.
```

**Root Cause**: This is a bug in the gramJS library's `requestIter.js`:

```typescript
// File: gramjs/requestIter.ts (around line 50)
if (this.waitTime) {
  await sleep(
    this.waitTime -
    (new Date().getTime() / 1000 - this.lastLoad)
  );
}
```

When the elapsed time since `lastLoad` exceeds `this.waitTime`, the calculated sleep duration becomes negative. The value `-1766581619.921` seconds is approximately 56 years in the past, suggesting a timestamp calculation error.

**Impact**: While the warning itself is harmless (it falls back to 1ms sleep), it indicates a potential issue with time tracking in the iterator.

**Reference**:
- [GramJS Issues](https://github.com/gram-js/gramjs/issues)
- [Vercel TimeoutNegativeWarning Issue](https://github.com/vercel/vercel/issues/14476) - Similar issue in Node.js v24

---

### Issue 4: Missing --verbose Mode

**Symptom**: No way to debug why zero users are found.

**Root Cause**: The script lacks verbose/debug logging to show:
- What data is being extracted from each message
- Which messages have null senderIds
- The entity type of the target chat (channel vs group)

---

## Package Resolution Note

The error logs show `telegram-v-latest` as the package name. This is how the `use-m` dynamic package loader creates aliases:

```javascript
const alias = `${packageName.replace('@', '').replace('/', '-')}-v-${version}`;
// "telegram" + "-v-" + "latest" = "telegram-v-latest"
```

The actual package is `telegram` (GramJS) version 2.26.21.

---

## Proposed Solutions

### Solution 1: Add Command-Line Argument Parsing

Parse `--help`, `--verbose`, and other arguments **before** connecting to Telegram.

### Solution 2: Enhance User Extraction Algorithm

1. **Detect Chat Type**: Check if the entity is a channel, group, or supergroup
2. **Use getParticipants()**: For channels/supergroups, use the dedicated participant API
3. **Handle Anonymous Senders**: Log when senderIds are null for debugging

### Solution 3: Add Verbose Mode

Implement `--verbose` flag to log:
- Entity type (channel/group/supergroup)
- Message metadata (senderId, action type, etc.)
- Why certain messages don't yield users

### Solution 4: Gracefully Handle Timeout Warning

Wrap iterator calls or adjust waitTime to prevent negative calculations.

---

## References

- [GramJS GitHub Repository](https://github.com/gram-js/gramjs)
- [GramJS TelegramClient Documentation](https://gram.js.org/beta/classes/TelegramClient.html)
- [GramJS Message Class](https://gram.js.org/beta/classes/Api.Message.html)
- [Telegram API - channels.getParticipants](https://core.telegram.org/method/channels.getParticipants)
- [GramJS - Getting Participants](https://painor.gitbook.io/gramjs/getting-started/available-methods/getting-participants-of-a-group-channel)
- [GramJS iterMessages Issue #181](https://github.com/gram-js/gramjs/issues/181)
- [Node.js v24 TimeoutNegativeWarning](https://github.com/vercel/vercel/issues/14476)
