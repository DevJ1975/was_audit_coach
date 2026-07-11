/**
 * Turn reducer for audit-coach. Pure module — no Deno APIs, no SDK types —
 * shared by the Edge Function and the vitest suite.
 *
 * One coach "turn" = send one user.message to the Managed Agent session, then
 * consume the session's event stream until it settles. This reducer decides,
 * per event, what happens: accumulate the reply, add token usage, react to a
 * tool interaction, finish, or fail. The Edge Function is request/response —
 * there is no human on the wire to approve tools — so anything that would
 * block the session waiting on us (an `always_ask` tool, a custom client
 * tool) is declined immediately instead of deadlocking the session.
 */

export interface TurnState {
  reply: string;
  inputTokens: number;
  outputTokens: number;
  done: boolean;
  /** Set when the turn failed; `reply` may still hold partial text. */
  error: string | null;
  /** Tool uses seen but not (yet) denied — fallback denial targets, because
   *  `evaluated_permission` is not in the documented event schema and may be
   *  absent at runtime. */
  pendingToolIds: string[];
  /** A reaction was queued since the last idle check (session will resume). */
  reacted: boolean;
}

export function initialTurn(): TurnState {
  return {
    reply: '',
    inputTokens: 0,
    outputTokens: 0,
    done: false,
    error: null,
    pendingToolIds: [],
    reacted: false,
  };
}

/** Follow-up events the caller must send back to the session, in order. */
export type TurnReaction =
  | { kind: 'deny_tool'; toolUseId: string }
  | { kind: 'fail_custom_tool'; customToolUseId: string };

/** The subset of session-event shape this reducer reads (structural). */
export interface SessionEventLike {
  type: string;
  id?: string;
  content?: { type: string; text?: string }[];
  evaluated_permission?: string;
  model_usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: { type?: string };
  error?: { message?: string };
}

const DEAD_SESSION = 'The coach session ended unexpectedly — send that again to start fresh.';

/**
 * Fold one stream event into the turn. Mutates `state`; returns any events the
 * caller must send back to the session before continuing to read the stream.
 */
export function reduceTurnEvent(state: TurnState, event: SessionEventLike): TurnReaction[] {
  switch (event.type) {
    case 'agent.message': {
      const text = (event.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('');
      if (text) state.reply = state.reply ? `${state.reply}\n\n${text}` : text;
      return [];
    }

    case 'span.model_request_end':
      state.inputTokens += event.model_usage?.input_tokens ?? 0;
      state.outputTokens += event.model_usage?.output_tokens ?? 0;
      return [];

    // Built-in / MCP tool configured `always_ask`: decline — nobody is here to
    // approve, and an unanswered ask idles the session forever. When the
    // permission field is absent (it is undocumented), remember the id so a
    // later `requires_action` idle can still deny it instead of timing out.
    case 'agent.tool_use':
      if (!event.id) return [];
      if (event.evaluated_permission === 'ask') {
        state.reacted = true;
        return [{ kind: 'deny_tool', toolUseId: event.id }];
      }
      state.pendingToolIds.push(event.id);
      return [];

    // Custom client-side tool: this integration implements none, so answer
    // with an error result and let the agent continue without it.
    case 'agent.custom_tool_use':
      if (!event.id) return [];
      state.reacted = true;
      return [{ kind: 'fail_custom_tool', customToolUseId: event.id }];

    case 'session.error':
      state.error = event.error?.message ?? 'The coach hit an error.';
      state.done = true;
      return [];

    case 'session.status_terminated':
      if (!state.reply) state.error = DEAD_SESSION;
      state.done = true;
      return [];

    case 'session.status_idle': {
      const stop = event.stop_reason?.type;
      if (stop === 'requires_action') {
        // Waiting on the reactions we already queued — the agent resumes.
        if (state.reacted) {
          state.reacted = false;
          return [];
        }
        // Nothing queued: deny every tool use we saw but never answered (the
        // undocumented-permission fallback), then keep reading.
        if (state.pendingToolIds.length > 0) {
          const reactions: TurnReaction[] = state.pendingToolIds.map((id) => ({
            kind: 'deny_tool',
            toolUseId: id,
          }));
          state.pendingToolIds = [];
          return reactions;
        }
        // Waiting on something we cannot provide — fail fast, keep any text.
        if (!state.reply) {
          state.error = "The coach is waiting on an approval this surface can't provide — try again.";
        }
        state.done = true;
        return [];
      }
      if (stop === 'retries_exhausted' && !state.reply) {
        state.error = 'The coach could not complete that — try again in a moment.';
      }
      state.done = true;
      return [];
    }

    default:
      return [];
  }
}
