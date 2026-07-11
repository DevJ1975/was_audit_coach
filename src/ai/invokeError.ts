/**
 * Edge-function error unwrapping. supabase-js turns EVERY non-2xx function
 * response into a FunctionsHttpError whose .message is the fixed string
 * "Edge Function returned a non-2xx status code" — the server's crafted,
 * user-facing error ("Sign in to use AI drafting.", "Conversation too long —
 * start a new chat.") rides in the response body, reachable only via
 * error.context (the Fetch Response). Without this helper none of those
 * messages ever reached a user.
 */

interface FunctionsErrorLike {
  message?: string;
  /** FunctionsHttpError carries the raw Response here. */
  context?: { json?: () => Promise<unknown> };
}

export interface UnwrappedFunctionError {
  message: string;
  /** The parsed error body, when the function returned JSON. */
  body: Record<string, unknown> | null;
}

export async function unwrapFunctionError(error: unknown, fallback: string): Promise<UnwrappedFunctionError> {
  const e = (error ?? {}) as FunctionsErrorLike;
  if (e.context?.json) {
    try {
      const body = (await e.context.json()) as Record<string, unknown> | null;
      const msg = body && typeof body.error === 'string' && body.error ? body.error : null;
      if (msg) return { message: msg, body };
      return { message: e.message || fallback, body: body ?? null };
    } catch {
      // Non-JSON body (e.g. a gateway HTML page) — fall through.
    }
  }
  return { message: e.message || fallback, body: null };
}
