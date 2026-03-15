import { HandshakeMachine } from './handshake.js';

/**
 * Backward-compat shim.
 * Prefer HandshakeMachine from ./handshake.
 */
export const BootstrapSession = HandshakeMachine;
