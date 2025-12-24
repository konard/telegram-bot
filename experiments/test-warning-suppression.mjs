#!/usr/bin/env bun
// test-warning-suppression.mjs
//
// Test script to verify TimeoutNegativeWarning suppression
// Run with: bun experiments/test-warning-suppression.mjs

console.log('Testing TimeoutNegativeWarning suppression...\n');

// Setup warning suppression (same as in chat-users.mjs)
const originalWarningListeners = process.listeners('warning');
process.removeAllListeners('warning');

let suppressedWarnings = [];
let passedWarnings = [];

process.on('warning', (warning) => {
  if (warning.name === 'TimeoutNegativeWarning') {
    suppressedWarnings.push(warning);
    return;
  }
  passedWarnings.push(warning);
  originalWarningListeners.forEach(listener => listener(warning));
});

console.log('Test 1: Emit TimeoutNegativeWarning (should be suppressed)');
const negativeWarning = new Error('Test negative timeout warning');
negativeWarning.name = 'TimeoutNegativeWarning';
process.emitWarning(negativeWarning);

// Give event loop a chance to process
await new Promise(resolve => setTimeout(resolve, 10));

if (suppressedWarnings.length === 1 && suppressedWarnings[0].name === 'TimeoutNegativeWarning') {
  console.log('  PASS: TimeoutNegativeWarning was suppressed\n');
} else {
  console.log('  FAIL: TimeoutNegativeWarning was not suppressed\n');
}

console.log('Test 2: Emit other warning (should NOT be suppressed)');
const otherWarning = new Error('Test other warning');
otherWarning.name = 'DeprecationWarning';

// Temporarily capture console.error to check if warning appears
const originalError = console.error;
let errorOutput = '';
console.error = (...args) => {
  errorOutput += args.join(' ');
};

process.emitWarning(otherWarning);

// Give event loop a chance to process
await new Promise(resolve => setTimeout(resolve, 10));

console.error = originalError;

if (passedWarnings.length === 1 && passedWarnings[0].name === 'DeprecationWarning') {
  console.log('  PASS: Other warnings are passed through\n');
} else {
  console.log('  FAIL: Other warnings are incorrectly suppressed\n');
}

console.log('Test 3: Verify negative setTimeout behavior');
// In Node.js, negative setTimeout values are clamped to 1ms
const start = Date.now();
await new Promise(resolve => setTimeout(resolve, -100));
const elapsed = Date.now() - start;

// Should execute almost immediately (within a few ms, not 100ms)
if (elapsed < 50) {
  console.log(`  PASS: Negative timeout executed in ${elapsed}ms (clamped to minimum)\n`);
} else {
  console.log(`  FAIL: Negative timeout took ${elapsed}ms (expected < 50ms)\n`);
}

console.log(`Summary:
  - TimeoutNegativeWarning suppressed: ${suppressedWarnings.length}
  - Other warnings passed through: ${passedWarnings.length}
`);

console.log('All tests completed!');
