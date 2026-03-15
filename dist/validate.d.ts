import type { BootstrapEvent } from './types.js';
export interface ValidationResult {
    ok: boolean;
    reason?: string;
}
export declare function validateBootstrapEvent(event: BootstrapEvent, now?: number): ValidationResult;
