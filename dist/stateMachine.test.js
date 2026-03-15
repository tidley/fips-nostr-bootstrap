import { describe, expect, it } from 'vitest';
import { BootstrapSession } from './stateMachine.js';
let c = 1;
function ev(kind, overrides = {}) {
    return {
        kind,
        sessionId: 's1',
        fromNostrPubkey: 'npub_a',
        fromFippsIdentity: 'fipps_a',
        expiresAt: 9999999999,
        createdAt: c++,
        payload: {},
        sig: 'sig',
        ...overrides,
    };
}
describe('BootstrapSession', () => {
    it('follows happy path to ESTABLISHED', () => {
        const s = new BootstrapSession();
        expect(s.apply(ev('fipps.bootstrap.init')).state).toBe('INIT_SENT');
        expect(s.apply(ev('fipps.bootstrap.ack')).state).toBe('ACK_RECEIVED');
        expect(s.apply(ev('fipps.bootstrap.confirm')).state).toBe('SWITCHING');
        expect(s.apply(ev('fipps.bootstrap.confirm')).state).toBe('ESTABLISHED');
    });
    it('fails on replay', () => {
        const s = new BootstrapSession();
        const e = ev('fipps.bootstrap.init', { createdAt: 10 });
        expect(s.apply(e).state).toBe('INIT_SENT');
        expect(s.apply(e).state).toBe('FAILED');
    });
    it('fails on expired event', () => {
        const s = new BootstrapSession();
        const r = s.apply(ev('fipps.bootstrap.init', { expiresAt: 1 }), 10);
        expect(r.state).toBe('FAILED');
        expect(r.reason).toBe('expired-event');
    });
    it('fails on invalid transition', () => {
        const s = new BootstrapSession();
        const r = s.apply(ev('fipps.bootstrap.ack'));
        expect(r.state).toBe('FAILED');
        expect(r.reason).toBe('invalid-transition');
    });
    it('fails on wrong event while in INIT_SENT and ACK_RECEIVED', () => {
        const s1 = new BootstrapSession();
        s1.apply(ev('fipps.bootstrap.init'));
        const r1 = s1.apply(ev('fipps.bootstrap.confirm'));
        expect(r1.state).toBe('FAILED');
        const s2 = new BootstrapSession();
        s2.apply(ev('fipps.bootstrap.init'));
        s2.apply(ev('fipps.bootstrap.ack'));
        const r2 = s2.apply(ev('fipps.bootstrap.fail'));
        expect(r2.state).toBe('FAILED');
    });
    it('stays failed on subsequent unexpected events', () => {
        const s = new BootstrapSession();
        s.apply(ev('fipps.bootstrap.ack'));
        const r = s.apply(ev('fipps.bootstrap.fail'));
        expect(r.state).toBe('FAILED');
    });
    it('exposes current state getter', () => {
        const s = new BootstrapSession();
        expect(s.getState()).toBe('IDLE');
        s.apply(ev('fipps.bootstrap.init'));
        expect(s.getState()).toBe('INIT_SENT');
    });
});
