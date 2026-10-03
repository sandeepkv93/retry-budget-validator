import type { Backoff, Jitter } from './types.js';

export function getJitterBounds(nominal: bigint, jitter: Jitter): { min: bigint; max: bigint } {
  switch (jitter) {
    case 'none':
      return { min: nominal, max: nominal };
    case 'full':
      return { min: 0n, max: nominal };
    case 'equal': {
      // ceil(nominal / 2)
      // Since nominal is >= 0, ceil(x / 2) is (x + 1) / 2 using integer division
      const min = (nominal + 1n) / 2n;
      return { min, max: nominal };
    }
  }
}

export function computeBackoffBounds(maxAttempts: number, backoff: Backoff): { min: bigint; max: bigint } {
  let minSum = 0n;
  let maxSum = 0n;
  
  if (backoff.kind === 'none') {
    return { min: 0n, max: 0n };
  }

  const delays = maxAttempts - 1;
  if (delays <= 0) {
    return { min: 0n, max: 0n };
  }

  for (let k = 1; k <= delays; k++) {
    let nominal = 0n;
    if (backoff.kind === 'constant') {
      nominal = BigInt(backoff.delayMs);
    } else if (backoff.kind === 'exponential') {
      const initial = BigInt(backoff.initialDelayMs);
      const mult = BigInt(backoff.multiplier);
      const cap = BigInt(backoff.capDelayMs);
      
      // multiplier^(k-1)
      let current = initial;
      for (let i = 1; i < k; i++) {
        current = current * mult;
        if (current >= cap) {
          current = cap;
          break; // Stop growing
        }
      }
      nominal = current > cap ? cap : current;
    } else if (backoff.kind === 'explicit') {
      nominal = BigInt(backoff.delaysMs[k - 1]!);
    }
    
    const bounds = getJitterBounds(nominal, backoff.jitter);
    minSum += bounds.min;
    maxSum += bounds.max;
  }
  
  return { min: minSum, max: maxSum };
}
