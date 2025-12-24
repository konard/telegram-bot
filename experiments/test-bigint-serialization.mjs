#!/usr/bin/env bun
// test-bigint-serialization.mjs
//
// Test script to verify BigInt JSON serialization fix
// Run with: bun experiments/test-bigint-serialization.mjs

console.log('Testing BigInt JSON serialization fix...\n');

// Test data simulating Telegram user data with BigInt IDs
const testUsers = [
  {
    id: 123456789n, // Small BigInt
    username: 'testuser1',
    firstName: 'Test',
    lastName: 'User',
    bot: false,
    deleted: false,
  },
  {
    id: 9007199254740993n, // Exceeds Number.MAX_SAFE_INTEGER
    username: 'testuser2',
    firstName: 'Big',
    lastName: 'Number',
    bot: true,
    deleted: false,
  },
  {
    id: 2759711156, // Regular number (not BigInt)
    username: 'testuser3',
    firstName: 'Regular',
    lastName: 'User',
    bot: false,
    deleted: false,
  },
];

// The replacer function from our fix
const bigIntReplacer = (key, value) =>
  typeof value === 'bigint' ? value.toString() : value;

console.log('Test 1: Verify JSON.stringify with BigInt throws error without replacer');
try {
  JSON.stringify(testUsers);
  console.log('  FAIL: Expected TypeError but none was thrown\n');
} catch (err) {
  if (err instanceof TypeError && err.message.includes('BigInt')) {
    console.log('  PASS: TypeError thrown as expected\n');
  } else {
    console.log(`  FAIL: Unexpected error: ${err.message}\n`);
  }
}

console.log('Test 2: Verify JSON.stringify with replacer succeeds');
try {
  const json = JSON.stringify(testUsers, bigIntReplacer, 2);
  console.log('  PASS: JSON serialization successful\n');
  console.log('Serialized output:');
  console.log(json);
  console.log();
} catch (err) {
  console.log(`  FAIL: ${err.message}\n`);
  process.exit(1);
}

console.log('Test 3: Verify BigInt values are converted to strings');
const json = JSON.stringify(testUsers, bigIntReplacer, 2);
const parsed = JSON.parse(json);

const checks = [
  { name: 'User 1 ID is string', pass: typeof parsed[0].id === 'string' && parsed[0].id === '123456789' },
  { name: 'User 2 ID is string (large)', pass: typeof parsed[1].id === 'string' && parsed[1].id === '9007199254740993' },
  { name: 'User 3 ID is number (was not BigInt)', pass: typeof parsed[2].id === 'number' && parsed[2].id === 2759711156 },
  { name: 'Other fields preserved', pass: parsed[0].username === 'testuser1' && parsed[1].bot === true },
];

checks.forEach(check => {
  console.log(`  ${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
});

console.log('\nTest 4: Verify BigInt can be restored from string');
const restoredId = BigInt(parsed[0].id);
const originalId = 123456789n;
if (restoredId === originalId) {
  console.log('  PASS: BigInt successfully restored from string\n');
} else {
  console.log('  FAIL: BigInt restoration failed\n');
}

console.log('Test 5: Verify large BigInt precision is preserved');
const largeParsedId = parsed[1].id;
const largeRestoredBigInt = BigInt(largeParsedId);
const originalLargeBigInt = 9007199254740993n;
if (largeRestoredBigInt === originalLargeBigInt) {
  console.log('  PASS: Large BigInt precision preserved (exceeds Number.MAX_SAFE_INTEGER)\n');
} else {
  console.log(`  FAIL: Precision lost. Expected ${originalLargeBigInt}, got ${largeRestoredBigInt}\n`);
}

console.log('All tests completed!');
