interface DomainRateLimitState {
  currentDelayMs: number;
  nextAvailableAt: number;
  retryCount: number;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export class RateLimiter {
  private readonly stateByDomain = new Map<string, DomainRateLimitState>();

  constructor(
    private readonly defaultDelayMs: number,
    private readonly maxRetries: number,
  ) {}

  async wait(domain: string): Promise<void> {
    const state = this.getState(domain);
    const now = Date.now();
    const waitTimeMs = Math.max(0, state.nextAvailableAt - now);

    if (waitTimeMs > 0) {
      await sleep(waitTimeMs);
    }

    state.nextAvailableAt = Date.now() + state.currentDelayMs;
  }

  backoff(domain: string): void {
    const state = this.getState(domain);
    state.retryCount = Math.min(state.retryCount + 1, this.maxRetries);
    state.currentDelayMs = this.defaultDelayMs * (2 ** state.retryCount);
  }

  reset(domain: string): void {
    this.stateByDomain.set(domain, {
      currentDelayMs: this.defaultDelayMs,
      nextAvailableAt: 0,
      retryCount: 0,
    });
  }

  private getState(domain: string): DomainRateLimitState {
    const existingState = this.stateByDomain.get(domain);

    if (existingState) {
      return existingState;
    }

    const initialState: DomainRateLimitState = {
      currentDelayMs: this.defaultDelayMs,
      nextAvailableAt: 0,
      retryCount: 0,
    };

    this.stateByDomain.set(domain, initialState);
    return initialState;
  }
}
