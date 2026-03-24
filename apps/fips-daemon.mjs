#!/usr/bin/env node
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createFipsNostrRendezvousNode } from '../packages/fips-nostr-rendezvous/src/index.js';
import { parseRuntimeRole, startupPlanForRole } from '../dist/runtime_roles.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function asPort(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : undefined;
}

const role = parseRuntimeRole(arg('--role', process.env.FIPS_RUNTIME_ROLE || 'all'));
const relayUrls = splitList(arg('--relays', process.env.NOSTR_RELAYS || ''));
const trustedNpubs = splitList(arg('--trusted-npubs', process.env.FIPS_TRUSTED_NPUBS || ''));
const config = {
  role,
  fipsUdpPort: asPort(arg('--fips-udp-port', process.env.FIPS_UDP_PORT || '')),
  relayUrls,
  stunPort: asPort(arg('--stun-port', process.env.STUN_PORT || '3478')),
};

let plan;
try {
  plan = startupPlanForRole(config);
} catch (error) {
  console.error('[fips-daemon] invalid runtime configuration');
  console.error(String(error?.message || error));
  process.exit(1);
}

const relayNodeRequired = plan.fips || plan.relay;
let rendezvousNode = null;
let stunProc = null;

if (relayNodeRequired) {
  // Current rendezvous package contains both signaling + UDP punch endpoint.
  // For relay-only mode, we bind an ephemeral UDP port unless explicitly configured.
  const udpPort = plan.fips ? config.fipsUdpPort : (config.fipsUdpPort || 0);

  rendezvousNode = createFipsNostrRendezvousNode({
    udpPort,
    relays: relayUrls,
    trustedNpubs,
    nsec: process.env.NOSTR_NSEC,
    publicHost: process.env.FIPS_UDP_PUBLIC_HOST,
  });

  const started = await rendezvousNode.start();
  console.log(
    JSON.stringify(
      {
        app: 'fips-daemon',
        role,
        services: {
          fips: plan.fips,
          relay: plan.relay,
          stun: plan.stun,
        },
        rendezvous: {
          enabled: true,
          npub: started.npub,
          udpPort: started.udpPort,
          relayCount: relayUrls.length,
          trustedCount: trustedNpubs.length,
        },
      },
      null,
      2,
    ),
  );
}

if (plan.stun) {
  // Keep STUN service as go binary; daemon supervises process lifecycle.
  const stunCmd = arg('--stun-cmd', process.env.STUN_CMD || 'go');
  const stunArgsRaw = arg('--stun-args', process.env.STUN_ARGS || 'run main.go');
  const stunArgs = stunArgsRaw.split(' ').filter(Boolean);
  const stunCwd = arg('--stun-cwd', process.env.STUN_CWD || new URL('../tools/stun-lite', import.meta.url).pathname);

  stunProc = spawn(stunCmd, stunArgs, {
    cwd: stunCwd,
    env: { ...process.env, PORT: String(config.stunPort) },
    stdio: 'inherit',
  });

  stunProc.on('exit', (code, signal) => {
    console.error(`[fips-daemon] stun process exited code=${code} signal=${signal}`);
    if (!process.exitCode) process.exitCode = code ?? 1;
  });
}

if (!relayNodeRequired && !plan.stun) {
  console.error('[fips-daemon] startup plan resolved to no services');
  process.exit(1);
}

async function shutdown(signal) {
  console.log(`[fips-daemon] received ${signal}, shutting down`);
  try {
    rendezvousNode?.close();
  } catch {}

  if (stunProc && !stunProc.killed) {
    try {
      stunProc.kill('SIGTERM');
    } catch {}
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
