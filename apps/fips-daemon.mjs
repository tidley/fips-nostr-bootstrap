#!/usr/bin/env node
import 'dotenv/config';
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createFipsNostrRendezvousNode } from '../packages/fips-nostr-rendezvous/src/index.js';
import { parseRuntimeRole, startupPlanForRole } from '../dist/runtime_roles.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
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

function chooseGoBinary(configured) {
  if (configured) return configured;
  // Prefer explicit modern Go if installed.
  if (existsSync('/usr/local/go/bin/go')) return '/usr/local/go/bin/go';
  return 'go';
}

function portFailureGuidance(port, roleLabel) {
  return {
    role: roleLabel,
    port,
    checks: [
      `ss -lunp | grep :${port} || true`,
      `sudo lsof -nP -iUDP:${port}`,
      'sudo ufw status verbose',
      'sudo nft list ruleset | sed -n "1,160p"',
    ],
    notes: [
      'If another process owns the port, stop it or choose a different port.',
      'If local bind succeeds but remote probes fail, open UDP in firewall/security group and test from another host.',
    ],
  };
}

async function checkUdpPortAvailable(port, roleLabel) {
  if (!port || port === 0) return { ok: true };

  const socket = dgram.createSocket('udp4');
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {}
      resolve(result);
    };

    socket.once('error', (error) => {
      finish({
        ok: false,
        reason: error?.code || 'BIND_ERROR',
        message: String(error?.message || error),
        guidance: portFailureGuidance(port, roleLabel),
      });
    });

    socket.bind(port, '0.0.0.0', () => finish({ ok: true }));
  });
}

const role = parseRuntimeRole(arg('--role', process.env.FIPS_RUNTIME_ROLE || 'all'));
const relayUrls = splitList(arg('--relays', process.env.NOSTR_RELAYS || ''));
const trustedNpubs = splitList(arg('--trusted-npubs', process.env.FIPS_TRUSTED_NPUBS || ''));
const checkPorts = !hasFlag('--no-check-ports');

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

if (checkPorts) {
  const checks = [];

  // Rendezvous node binds UDP whenever fips OR relay roles are enabled.
  if (relayNodeRequired) {
    const rendezvousPort = plan.fips ? config.fipsUdpPort : (config.fipsUdpPort || 0);
    checks.push(checkUdpPortAvailable(rendezvousPort, plan.fips ? 'fips' : 'relay'));
  }

  if (plan.stun) {
    checks.push(checkUdpPortAvailable(config.stunPort, 'stun'));
  }

  // Static conflict guard before runtime startup.
  if (plan.fips && plan.stun && config.fipsUdpPort && config.stunPort && config.fipsUdpPort === config.stunPort) {
    const guidance = portFailureGuidance(config.fipsUdpPort, 'fips+stun');
    console.error('[fips-daemon] port conflict: fips and stun configured to same UDP port');
    console.error(JSON.stringify({
      app: 'fips-daemon',
      type: 'port_check_failed',
      reason: 'PORT_CONFLICT',
      details: {
        fipsUdpPort: config.fipsUdpPort,
        stunPort: config.stunPort,
      },
      guidance,
    }, null, 2));
    process.exit(1);
  }

  const results = await Promise.all(checks);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error('[fips-daemon] required UDP port checks failed');
    console.error(
      JSON.stringify(
        {
          app: 'fips-daemon',
          type: 'port_check_failed',
          failed,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

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
    stunPort: config.stunPort,
    stunUri: process.env.FIPS_STUN_URI,
  });

  const started = await rendezvousNode.start();
  console.log(
    JSON.stringify(
      {
        app: 'fips-daemon',
        role,
        checks: {
          ports: checkPorts ? 'passed' : 'skipped',
        },
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
  const stunCmd = chooseGoBinary(arg('--stun-cmd', process.env.STUN_CMD || ''));
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
