// pay-success.ts
type LpStatus =
  | { ResponseCode: number | string; Description?: string }
  | { status?: string; fail_reason?: string; access_until?: string }
  | Record<string, unknown>;

function isEntitlementActive(x: any): boolean {
  // Works if your status endpoint returns access_until,
  // or you pass in /api/me response.
  const until = x?.access_until || x?.until || x?.until_ts;
  return !!until && new Date(until).getTime() > Date.now();
}

function isLowProfileSuccess(x: any): boolean {
  // Accept both ResponseCode-based and status-based shapes
  if (x && Object.prototype.hasOwnProperty.call(x, 'ResponseCode')) {
    return Number((x as any).ResponseCode) === 0;
  }
  const st = (x?.status || '').toString().toLowerCase();
  return st === 'paid' || st === 'subscribed' || isEntitlementActive(x);
}

/**
 * Poll LowProfile status endpoint until verified or timeout.
 * Also falls back to /api/me to confirm entitlement.
 */
export async function pollPaymentUntilVerified(
  lowProfileId: string,
  opts: {
    // base delay and growth help handle webhook latency
    initialDelayMs?: number;
    maxAttempts?: number;
    backoffFactor?: number;
    // if your API relies on cookies/session, include credentials
    credentials?: RequestCredentials;
    // optional abort controller to cancel when user leaves page
    signal?: AbortSignal;
  } = {}
): Promise<LpStatus> {
  const {
    initialDelayMs = 1500,
    maxAttempts = 40,          // ~1–2 minutes depending on backoff
    backoffFactor = 1.3,
    credentials = 'include',
    signal
  } = opts;

  let delay = initialDelayMs;
  let lastErr: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 1) Try the specific LowProfile status endpoint (if you implemented it)
      const r = await fetch(
        `/api/pay/status/${encodeURIComponent(lowProfileId)}`,
        { credentials, signal }
      );
      if (r.ok) {
        const data: LpStatus = await r.json();
        if (isLowProfileSuccess(data)) {
          return data; // confirmed by status endpoint
        }
      }

      // 2) Fallback: check entitlement (server source of truth)
      const me = await fetch(`/api/me`, { credentials, signal }).then(res => res.ok ? res.json() : null).catch(() => null);
      if (me && isEntitlementActive(me)) {
        return me; // confirmed by entitlement
      }
    } catch (e) {
      // network hiccup or aborted; keep trying unless aborted
      lastErr = e;
      if ((e as any)?.name === 'AbortError') throw e;
    }

    // wait with backoff
    await new Promise<void>((res, rej) => {
      const t = setTimeout(res, delay);
      if (signal) {
        const onAbort = () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); };
        if (signal.aborted) onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
    delay = Math.min(Math.round(delay * backoffFactor), 5000);
  }

  // One last read to return something meaningful
  try {
    const r = await fetch(`/api/pay/status/${encodeURIComponent(lowProfileId)}`, { credentials, signal });
    if (r.ok) return r.json();
  } catch {}
  throw new Error(lastErr?.message || 'Timeout waiting for Cardcom verification');
}
