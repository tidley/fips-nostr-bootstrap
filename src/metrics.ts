export interface BootstrapMetrics {
  handshakes: number;
  directSuccess: number;
  fallbackSuccess: number;
  failed: number;
  replayRejects: number;
  invalidSignatureRejects: number;
  establishmentMs: number[];
  probesPerSuccess: number[];
}

export class MetricsStore {
  private readonly m: BootstrapMetrics = {
    handshakes: 0,
    directSuccess: 0,
    fallbackSuccess: 0,
    failed: 0,
    replayRejects: 0,
    invalidSignatureRejects: 0,
    establishmentMs: [],
    probesPerSuccess: [],
  };

  snapshot(): BootstrapMetrics {
    return {
      ...this.m,
      establishmentMs: [...this.m.establishmentMs],
      probesPerSuccess: [...this.m.probesPerSuccess],
    };
  }

  inc<K extends keyof BootstrapMetrics>(key: K, by = 1): void {
    const v = this.m[key];
    if (typeof v === 'number') (this.m[key] as number) = v + by;
  }

  pushEstablishment(ms: number): void {
    this.m.establishmentMs.push(ms);
  }

  pushProbesPerSuccess(count: number): void {
    this.m.probesPerSuccess.push(count);
  }
}
