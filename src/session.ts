import type { SessionBinding } from './types.js';

export class SessionStore {
  private current?: SessionBinding;

  establish(binding: SessionBinding): void {
    this.current = binding;
  }

  rekey(sessionKeys: string): void {
    if (!this.current) return;
    this.current = { ...this.current, sessionKeys };
  }

  get(): SessionBinding | undefined {
    return this.current;
  }

  clear(): void {
    this.current = undefined;
  }
}
