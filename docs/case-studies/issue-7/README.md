# Case Study: Issue #7 - All errors and warnings in ./chat-users.mjs must be fixed

## Summary

This case study analyzes and fixes two runtime issues in the `chat-users.mjs` script after the improvements from Issue #5:

1. **TimeoutNegativeWarning** - A warning from the gramJS library about negative timeout values
2. **TypeError: JSON.stringify cannot serialize BigInt** - A fatal error when writing user data to JSON

**Issue Link**: https://github.com/konard/telegram-bot/issues/7

**Date of Issue**: 2025-12-24

**Affected Script**: `chat-users.mjs`

---

## Timeline of Events

### Background

After Issue #5 was resolved with PR #6, the script was enhanced with:
- `--help` flag working without Telegram connection
- `--verbose` mode for debugging
- `iterParticipants()` for fetching channel/supergroup members

### Error Report (2025-12-24T18:56:58)

Running `./chat-users.mjs --verbose` produced:
1. Successful connection to Telegram
2. Found chat "Agiens_hackathon_vibecode"
3. Fetched 6 participants from channel/supergroup
4. **TimeoutNegativeWarning** during message iteration
5. Processed 483 messages
6. **TypeError** on JSON serialization attempt

See [original-logs.txt](./original-logs.txt) for complete output.

---

## Identified Issues

### Issue 1: TimeoutNegativeWarning

**Symptom**:
```
TimeoutNegativeWarning: -1766582828.182 is a negative number.
Timeout duration was set to 1.
      at new Promise (1:11)
      at sleep (/Users/konard/.bun/install/global/node_modules/telegram-v-latest/Helpers.js:393:40)
      at <anonymous> (/Users/konard/.bun/install/global/node_modules/telegram-v-latest/requestIter.js:50:45)
```

**Root Cause Analysis**:

This warning originates from the gramJS library's `requestIter.ts`:

```typescript
// gramJS requestIter.ts (approximately line 50)
if (this.waitTime) {
  await sleep(
    this.waitTime - (new Date().getTime() / 1000 - this.lastLoad)
  );
}
```

The issue occurs when:
1. The iterator calculates sleep duration as `waitTime - elapsedTime`
2. If `elapsedTime > waitTime`, the result is negative
3. Node.js v24+ introduced the `TimeoutNegativeWarning` for negative `setTimeout()` values
4. Previously, Node.js silently clamped negative values to 1ms without warning

The value `-1766582828.182` (approximately 56 years) suggests a timestamp calculation anomaly, likely caused by:
- Clock synchronization issues
- Unix timestamp being treated as epoch-relative instead of relative seconds
- Race condition in time tracking

**Impact**: Warning only - the library falls back to 1ms sleep. Functionally harmless but noisy.

**References**:
- [Vercel Issue #14476 - TimeoutNegativeWarning since Node.js v24](https://github.com/vercel/vercel/issues/14476)
- [KafkaJS Issue #1751 - TimeoutNegativeWarning](https://github.com/tulios/kafkajs/issues/1751)
- [Postgres PR #1103 - Fix negative timeout warnings](https://github.com/porsager/postgres/pull/1103)
- [Node.js Timers Documentation](https://nodejs.org/api/timers.html)

---

### Issue 2: TypeError - BigInt Serialization

**Symptom**:
```
Error: 419 |     fs.writeFileSync(outPath, JSON.stringify(usersArray, null, 2));
                                         ^
TypeError: JSON.stringify cannot serialize BigInt.
      at <anonymous> (/Users/konard/Code/Archive/konard/telegram-bot/chat-users.mjs:419:36)
```

**Root Cause Analysis**:

Telegram user IDs can be BigInt values (especially for newer accounts with IDs exceeding JavaScript's `Number.MAX_SAFE_INTEGER` of 2^53 - 1). The gramJS library returns these as native JavaScript BigInt.

The code at line 419:
```javascript
fs.writeFileSync(outPath, JSON.stringify(usersArray, null, 2));
```

Fails because:
1. `JSON.stringify()` cannot natively serialize BigInt values
2. BigInt was added to JavaScript in ES2020 but JSON specification predates this
3. The ECMAScript specification explicitly states: "BigInt values cannot be serialized in JSON"

**Code Path**:

```javascript
// chat-users.mjs lines 370-379 - sort function attempts to convert BigInt to Number
.sort((a, b) => {
  const idA = typeof a.id === 'bigint' ? Number(a.id) : (a.id || 0);
  const idB = typeof b.id === 'bigint' ? Number(b.id) : (b.id || 0);
  return idA - idB;
});
```

Note: The sort function converts BigInt to Number for comparison, but the original BigInt `id` field remains in the object and causes serialization failure.

**References**:
- [MDN - BigInt value can't be serialized in JSON](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/BigInt_not_serializable)
- [MDN - JSON.stringify()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
- [DEV.to - BigInt and JSON.stringify/JSON.parse](https://dev.to/benlesh/bigint-and-json-stringify-json-parse-2m8p)
- [TC39 Proposal - BigInt JSON serialization](https://github.com/tc39/proposal-bigint/issues/162)

---

## Proposed Solutions

### Solution 1: Suppress TimeoutNegativeWarning

Since this is a library issue and functionally harmless, we can suppress the warning:

```javascript
// At the top of the script, before any Telegram operations
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'TimeoutNegativeWarning') {
    console.warn(warning);
  }
});
```

**Alternative**: Wait for gramJS to fix the issue upstream. The proper fix would be:
```typescript
// In gramJS requestIter.ts
await sleep(Math.max(0, this.waitTime - elapsedTime));
```

### Solution 2: Fix BigInt Serialization

Convert BigInt to String or Number before JSON serialization:

**Option A**: Use a replacer function:
```javascript
const replacer = (key, value) =>
  typeof value === 'bigint' ? value.toString() : value;

fs.writeFileSync(outPath, JSON.stringify(usersArray, replacer, 2));
```

**Option B**: Pre-process the array:
```javascript
const usersArray = Array.from(uniqueUsers.values())
  .map(u => {
    const { _source, ...userWithoutSource } = u;
    return {
      ...userWithoutSource,
      id: typeof userWithoutSource.id === 'bigint'
        ? userWithoutSource.id.toString()
        : userWithoutSource.id,
    };
  });
```

**Recommended**: Option A (replacer function) is cleaner and handles any BigInt fields automatically, not just `id`.

---

## Implementation Notes

### Why Convert to String Instead of Number?

1. **Precision Loss**: JavaScript `Number` can only safely represent integers up to 2^53 - 1 (9,007,199,254,740,991)
2. **Telegram User IDs**: Newer accounts can have IDs exceeding this limit
3. **String Preservation**: Converting to string preserves the exact value
4. **Reversibility**: Can be parsed back to BigInt with `BigInt(string)` if needed

### Warning Suppression Considerations

- The warning is harmless but may indicate library version issues
- Suppressing warnings should be done carefully
- Consider logging a single notification about the suppression
- Monitor gramJS releases for an upstream fix

---

## Testing Recommendations

1. **BigInt Serialization Test**:
   - Create test data with BigInt user IDs
   - Verify JSON output contains string representations
   - Verify JSON can be parsed back correctly

2. **Warning Suppression Test**:
   - Verify TimeoutNegativeWarning is suppressed
   - Verify other warnings still appear
   - Test with verbose mode enabled

3. **End-to-End Test**:
   - Run against a real Telegram channel
   - Verify users.json is created successfully
   - Verify all user data is preserved

---

## Related Issues

- Issue #5: Initial chat-users.mjs fixes (--help, --verbose, iterParticipants)
- PR #6: Merged solution for Issue #5

---

## References

### BigInt and JSON
- [MDN - TypeError: BigInt value can't be serialized in JSON](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/BigInt_not_serializable)
- [MDN - JSON.stringify()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify)
- [GitHub - json-bigint library](https://github.com/sidorares/json-bigint)

### TimeoutNegativeWarning
- [Vercel Issue #14476](https://github.com/vercel/vercel/issues/14476)
- [KafkaJS Issue #1751](https://github.com/tulios/kafkajs/issues/1751)
- [Node.js Timers Documentation](https://nodejs.org/api/timers.html)

### GramJS
- [GramJS GitHub Repository](https://github.com/gram-js/gramjs)
- [GramJS Documentation](https://painor.gitbook.io/gramjs/)
- [Telegram MTProto API](https://core.telegram.org/mtproto)
