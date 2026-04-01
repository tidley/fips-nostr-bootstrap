import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const webConsoleSource = readFileSync(new URL('../apps/fips-web-console.mjs', import.meta.url), 'utf8');

describe('fips web console browser state handling', () => {
  it('tracks active session state in browser code instead of referencing the server-only active variable', () => {
    expect(webConsoleSource).toContain('let activeState = null;');
    expect(webConsoleSource).toContain("activeState = d.connected ? { sessionId: d.sessionId, remote: d.remote } : null;");
    expect(webConsoleSource).toContain("if (!activeState) statusEl.textContent = 'Status: event stream closed';");
    expect(webConsoleSource).toContain("if (!activeState) setTransportBusy(false, 'Status: idle');");
    expect(webConsoleSource).not.toContain('if (!active) statusEl.textContent = \'Status: event stream closed\';');
    expect(webConsoleSource).not.toContain("if (!active) setTransportBusy(false, 'Status: idle');");
  });
});
