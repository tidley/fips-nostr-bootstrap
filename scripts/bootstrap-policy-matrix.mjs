#!/usr/bin/env node

// Tiny runtime shim so script works in repo without build step.
function decide(i) {
  const needsFreshnessHandshake = i.delaySinceAcceptMs > i.freshnessWindowMs;
  return {
    needsFreshnessHandshake,
    preferredOfferer: needsFreshnessHandshake ? 'initiator' : i.role,
    shouldAnswerPendingOfferFirst: i.hasPendingOffer && !needsFreshnessHandshake,
  };
}

function retry(successByStage, max = 3) {
  if (successByStage[0]) return { stage: 'none', attempts: 0 };
  if (successByStage[1]) return { stage: 'ice-restart', attempts: 1 };
  for (let i = 0; i < max; i++) if (successByStage[2 + i]) return { stage: 'full-reconnect', attempts: i + 1 };
  return { stage: 'failed', attempts: max };
}

const freshnessWindowMs = Number(process.argv[2] || 12000);
const delays = [0, 3000, 10000, 15000, 30000];

console.log(JSON.stringify({ freshnessWindowMs, delays, rows: delays.map((d) => ({
  delayMs: d,
  initiator: decide({ role: 'initiator', delaySinceAcceptMs: d, freshnessWindowMs, hasPendingOffer: false }),
  receiverWithPendingOffer: decide({ role: 'receiver', delaySinceAcceptMs: d, freshnessWindowMs, hasPendingOffer: true }),
})) }, null, 2));

console.log('\nretryExamples:');
console.log('initial success      ', retry([true]));
console.log('ice restart success  ', retry([false, true]));
console.log('full reconnect #2    ', retry([false, false, false, true]));
console.log('exhausted            ', retry([false, false, false, false, false]));
