/**
 * Audit Coach — the audit-TECHNIQUE mentor, embedded in the audit execution
 * flow (reachable from the checklist, section, and item screens). Powered by a
 * pre-built Anthropic managed agent behind the `audit-coach` Edge Function; a
 * SEPARATE surface from Soteria chat (/chat — the compliance agent that quotes
 * regulations with verified citations) and from the per-item ARIA box.
 *
 * The thread is per-audit and survives hopping between items (in-memory only).
 * Online-only like all AI: offline it degrades to the same disabled state and
 * never blocks the audit loop (Non-Negotiable #3). The coach answers questions
 * about method; it NEVER rates items (Non-Negotiable #2).
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import {
  askAuditCoach,
  getCoachThread,
  resetCoachThread,
  type CoachTurn,
} from '@/ai/coach';
import { useAiReady } from '@/hooks/useAiReady';
import { useAuditData } from '@/hooks/useAudit';
import { libraryItem, sectionNames } from '@/seed';
import type { Audit } from '@/db/types';
import { layout, type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';

const SUGGESTIONS = [
  'What should I look for when auditing a lockout/tagout program?',
  'How many training records should I sample to be defensible?',
  'Good interview questions for machine operators?',
  'How do I verify a program is implemented, not just documented?',
];

/** Where the auditor is right now — sent with each turn so coaching is situated. */
function buildContext(audit: Audit | null, section?: string, item?: string): string {
  const parts: string[] = [];
  if (audit?.title) parts.push(`Audit: ${audit.title}`);
  if (audit?.state_plan) parts.push(`State plan: ${audit.state_plan}`);
  if (section) parts.push(`Section ${section} — ${sectionNames[section] ?? ''}`.trim());
  if (item) {
    const lib = libraryItem(item);
    parts.push(`Item ${item}${lib ? `: ${lib.requirement.slice(0, 160)}` : ''}`);
  }
  return parts.join('. ');
}

export default function AuditCoachScreen(): React.ReactElement {
  const { auditId, section, item, seed } = useLocalSearchParams<{
    auditId: string;
    section?: string;
    item?: string;
    seed?: string;
  }>();
  const { audit } = useAuditData(auditId);
  const aiGate = useAiReady();
  const aiOn = aiGate.ready;
  const styles = useThemedStyles(makeStyles);
  const { palette } = useTheme();

  const stored = getCoachThread(auditId);
  const [messages, setMessages] = useState<CoachTurn[]>(stored.messages);
  const [input, setInput] = useState(seed ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(stored.sessionId);
  const scrollRef = useRef<ScrollView>(null);

  const context = useMemo(() => buildContext(audit, section, item), [audit, section, item]);

  function persist(msgs: CoachTurn[]): void {
    const t = getCoachThread(auditId);
    t.messages = msgs;
    t.sessionId = sessionRef.current;
  }

  async function send(question: string): Promise<void> {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    setError(null);
    setBusy(true);
    const withUser: CoachTurn[] = [...messages, { role: 'user', text: q }];
    setMessages(withUser);
    persist(withUser);

    const r = await askAuditCoach(q, { sessionId: sessionRef.current, context, auditId });
    setBusy(false);
    if (r.ok) {
      sessionRef.current = r.sessionId;
      const next: CoachTurn[] = [...withUser, { role: 'assistant', text: r.text }];
      setMessages(next);
      persist(next);
    } else {
      // Even failed turns can mint/return a session — keep it so the thread
      // continues instead of silently starting a fresh coach with no memory.
      if (r.sessionId) sessionRef.current = r.sessionId;
      setError(r.error);
    }
  }

  function newConversation(): void {
    resetCoachThread(auditId);
    sessionRef.current = null;
    setMessages([]);
    setError(null);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Audit Coach' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Your audit-technique mentor</Text>
              <Text style={styles.emptyBody}>
                Ask how to approach an area — what to look for, how to sample, who to
                interview, how to verify. For regulation text with citations, use Ask
                Soteria instead. The coach never rates: ratings are yours.
              </Text>
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  style={styles.suggestion}
                  onPress={() => void send(s)}
                  disabled={!aiOn || busy}
                  accessibilityRole="button"
                >
                  <Text style={styles.suggestionText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.threadHead}>
              <Text style={styles.threadHint} numberOfLines={1}>
                {context || 'Coaching thread for this audit'}
              </Text>
              <Button label="New chat" variant="ghost" onPress={newConversation} />
            </View>
          )}

          {messages.map((m, i) => (
            <View
              key={i}
              style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.coachBubble]}
            >
              <Text style={styles.bubbleText}>{m.text}</Text>
            </View>
          ))}

          {busy ? (
            <View style={[styles.bubble, styles.coachBubble, styles.busyRow]}>
              <ActivityIndicator animating size="small" color={palette.brand.accent} />
              <Text style={styles.busyText}>Coaching…</Text>
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        {!aiOn ? (
          <Text style={styles.offline}>
            {aiGate.reason === 'signin'
              ? 'Sign in (top right of the home screen) to use the coach. Your audit keeps working offline as always.'
              : 'The coach connects when the app is online and signed in. Your audit keeps working offline as always.'}
          </Text>
        ) : null}

        <View style={styles.inputRow}>
          <TextInput
            mode="outlined"
            style={styles.input}
            multiline
            placeholder="Ask about technique… (use the mic key to dictate)"
            value={input}
            onChangeText={setInput}
            disabled={!aiOn}
          />
          <Button
            label={busy ? '…' : 'Ask'}
            onPress={() => void send(input)}
            disabled={!aiOn || busy || !input.trim()}
          />
        </View>
        <Text style={styles.disclaimer}>
          Coaching guidance — not legal advice. Ratings are always your judgment.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.surfaces.bg },
    flex: { flex: 1 },
    thread: { padding: layout.gap, gap: layout.gap },
    empty: { gap: 10, paddingVertical: 12 },
    emptyTitle: { color: t.text.primary, fontSize: 18, fontWeight: '700' },
    emptyBody: { color: t.text.dim, fontSize: 14, lineHeight: 20 },
    suggestion: {
      minHeight: layout.minTapTarget,
      justifyContent: 'center',
      backgroundColor: t.surfaces.surface,
      borderRadius: layout.radius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.surfaces.line,
      paddingHorizontal: layout.gap,
      paddingVertical: 10,
    },
    suggestionText: { color: t.brand.accent, fontSize: 14, fontWeight: '600' },
    threadHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    threadHint: { flex: 1, color: t.text.faint, fontSize: 12 },
    bubble: {
      borderRadius: layout.radius,
      padding: layout.gap,
      gap: 8,
      maxWidth: '92%',
    },
    userBubble: {
      alignSelf: 'flex-end',
      backgroundColor: t.surfaces.raised,
      borderWidth: 1,
      borderColor: t.brand.accent,
    },
    coachBubble: {
      alignSelf: 'flex-start',
      backgroundColor: t.surfaces.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.surfaces.line,
    },
    bubbleText: { color: t.text.primary, fontSize: 15, lineHeight: 22 },
    busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    busyText: { color: t.text.dim, fontSize: 13 },
    error: { color: t.semantic.warn, fontSize: 13, paddingHorizontal: 4 },
    offline: {
      color: t.text.dim,
      fontSize: 12,
      paddingHorizontal: layout.gap,
      paddingTop: 6,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: layout.gap,
      paddingTop: 6,
    },
    input: { flex: 1, maxHeight: 120, backgroundColor: t.surfaces.raised, fontSize: 15 },
    disclaimer: {
      color: t.text.faint,
      fontSize: 11,
      textAlign: 'center',
      paddingVertical: 6,
      paddingHorizontal: layout.gap,
    },
  });
