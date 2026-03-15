import { describe, expect, it } from 'vitest';
import { BootstrapSession, validateBootstrapEvent } from './index.js';
describe('index exports', () => {
    it('exports runtime API', () => {
        const s = new BootstrapSession();
        expect(s.getState()).toBe('IDLE');
        expect(typeof validateBootstrapEvent).toBe('function');
    });
});
