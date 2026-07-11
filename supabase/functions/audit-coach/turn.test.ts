import { describe, expect, it } from 'vitest';
import { initialTurn, reduceTurnEvent, type SessionEventLike } from './turn';

function run(events: SessionEventLike[]) {
  const state = initialTurn();
  const reactions = [];
  for (const e of events) {
    reactions.push(...reduceTurnEvent(state, e));
    if (state.done) break;
  }
  return { state, reactions };
}

const msg = (text: string): SessionEventLike => ({
  type: 'agent.message',
  content: [{ type: 'text', text }],
});
const idle = (stop = 'end_turn'): SessionEventLike => ({
  type: 'session.status_idle',
  stop_reason: { type: stop },
});

describe('reduceTurnEvent', () => {
  it('collects reply text and finishes on terminal idle', () => {
    const { state } = run([
      { type: 'session.status_running' },
      msg('Walk the energy-isolation points first.'),
      idle(),
    ]);
    expect(state.done).toBe(true);
    expect(state.error).toBeNull();
    expect(state.reply).toBe('Walk the energy-isolation points first.');
  });

  it('joins consecutive agent messages with a blank line', () => {
    const { state } = run([msg('First.'), msg('Second.'), idle()]);
    expect(state.reply).toBe('First.\n\nSecond.');
  });

  it('accumulates usage across model requests', () => {
    const { state } = run([
      { type: 'span.model_request_end', model_usage: { input_tokens: 100, output_tokens: 40 } },
      msg('a'),
      { type: 'span.model_request_end', model_usage: { input_tokens: 50, output_tokens: 10 } },
      idle(),
    ]);
    expect(state.inputTokens).toBe(150);
    expect(state.outputTokens).toBe(50);
  });

  it('denies always_ask tool use and keeps the turn alive through requires_action', () => {
    const { state, reactions } = run([
      { type: 'agent.tool_use', id: 'sevt_1', evaluated_permission: 'ask' },
      idle('requires_action'),
      msg('Done without the tool.'),
      idle(),
    ]);
    expect(reactions).toEqual([{ kind: 'deny_tool', toolUseId: 'sevt_1' }]);
    expect(state.done).toBe(true);
    expect(state.reply).toBe('Done without the tool.');
  });

  it('ignores tool_use that was auto-allowed', () => {
    const { reactions } = run([
      { type: 'agent.tool_use', id: 'sevt_2', evaluated_permission: 'allow' },
      idle(),
    ]);
    expect(reactions).toEqual([]);
  });

  it('fails custom tool calls instead of deadlocking', () => {
    const { reactions } = run([
      { type: 'agent.custom_tool_use', id: 'sevt_3' },
      idle('requires_action'),
      msg('ok'),
      idle(),
    ]);
    expect(reactions).toEqual([{ kind: 'fail_custom_tool', customToolUseId: 'sevt_3' }]);
  });

  it('surfaces session.error and stops', () => {
    const { state } = run([{ type: 'session.error', error: { message: 'boom' } }, msg('never')]);
    expect(state.done).toBe(true);
    expect(state.error).toBe('boom');
    expect(state.reply).toBe('');
  });

  it('treats termination without a reply as an error', () => {
    const { state } = run([{ type: 'session.status_terminated' }]);
    expect(state.done).toBe(true);
    expect(state.error).toMatch(/ended unexpectedly/);
  });

  it('keeps partial reply when retries are exhausted after text arrived', () => {
    const { state } = run([msg('Partial guidance.'), idle('retries_exhausted')]);
    expect(state.done).toBe(true);
    expect(state.error).toBeNull();
    expect(state.reply).toBe('Partial guidance.');
  });
});
