/**
 * Soteria chat (Phase C4) — corpus-grounded Federal/State OSHA reference.
 * Every assistant answer renders its verified citation cards (tap → ecfr.gov).
 * Inherently online: offline it degrades to the same "connects when online"
 * state as AI drafting and never blocks anything (Non-Negotiable #3).
 * Soteria answers questions; it NEVER rates items (Non-Negotiable #2).
 */
import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Mono } from '@/components/ui';
import { askSoteria, isAiConfigured, type ChatTurn, type SoteriaCitation } from '@/ai/chat';
import { brand, layout, surfaces, text as textTokens } from '@/theme/tokens';

interface Message extends ChatTurn {
  citations?: SoteriaCitation[];
}

const SUGGESTIONS = [
  'When is a written lockout/tagout program required?',
  'Which employers are exempt from OSHA injury recordkeeping?',
  'What does 1910.134 require before an employee wears a respirator?',
];

function CitationCard({ c }: { c: SoteriaCitation }): React.ReactElement {
  return (
    <Pressable
      onPress={() => void Linking.openURL(c.source_url)}
      style={styles.citation}
      accessibilityRole="link"
      accessibilityLabel={`Open ${c.citation} on ecfr.gov`}
    >
      <Mono style={styles.citationRef}>[{c.ref}]</Mono>
      <View style={styles.citationBody}>
        <Mono style={styles.citationCode}>{c.citation}</Mono>
        <Text style={styles.citationPath} numberOfLines={2}>
          {c.heading_path}
        </Text>
        <Text style={styles.citationMeta}>
          {c.jurisdiction}
          {c.last_amended ? ` · amended ${c.last_amended}` : ''} · ecfr.gov ↗
        </Text>
      </View>
    </Pressable>
  );
}

export default function ChatScreen(): React.ReactElement {
  const { seed, jurisdiction } = useLocalSearchParams<{ seed?: string; jurisdiction?: string }>();
  const aiOn = isAiConfigured();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(seed ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  async function send(question: string): Promise<void> {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    setError(null);
    setBusy(true);
    const turn: Message = { role: 'user', text: q };
    setMessages((prev) => [...prev, turn]);

    // History is text-only (citations are per-answer, not context).
    const history: ChatTurn[] = messages.map(({ role, text }) => ({ role, text }));
    const r = await askSoteria(q, history, jurisdiction);
    setBusy(false);
    if (r.ok) {
      setMessages((prev) => [...prev, { role: 'assistant', text: r.text, citations: r.citations }]);
    } else {
      setError(r.error);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Soteria — OSHA reference' }} />
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
              <Text style={styles.emptyTitle}>Ask about Federal OSHA</Text>
              <Text style={styles.emptyBody}>
                Grounded in 29 CFR 1903, 1904, 1910, 1915, 1917, 1918 and 1926 — every answer
                cites the regulation it came from. State plans arrive in later waves.
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
          ) : null}

          {messages.map((m, i) => (
            <View
              key={i}
              style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.assistantBubble]}
            >
              <Text style={styles.bubbleText}>{m.text}</Text>
              {m.citations?.length ? (
                <View style={styles.citations}>
                  {m.citations.map((c) => (
                    <CitationCard key={c.ref} c={c} />
                  ))}
                </View>
              ) : null}
            </View>
          ))}

          {busy ? (
            <View style={[styles.bubble, styles.assistantBubble, styles.busyRow]}>
              <ActivityIndicator animating size="small" color={brand.default} />
              <Text style={styles.busyText}>Searching the regulations…</Text>
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        {!aiOn ? (
          <Text style={styles.offline}>
            Soteria connects when the app is online and signed in. Your audit keeps working
            offline as always.
          </Text>
        ) : null}

        <View style={styles.inputRow}>
          <TextInput
            mode="outlined"
            style={styles.input}
            multiline
            placeholder="Ask about a standard… (use the mic key to dictate)"
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
          Informational reference — not legal advice. Ratings are always yours.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: surfaces.bg },
  flex: { flex: 1 },
  thread: { padding: layout.gap, gap: layout.gap },
  empty: { gap: 10, paddingVertical: 12 },
  emptyTitle: { color: textTokens.primary, fontSize: 18, fontWeight: '700' },
  emptyBody: { color: textTokens.dim, fontSize: 14, lineHeight: 20 },
  suggestion: {
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
    backgroundColor: surfaces.surface,
    borderRadius: layout.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaces.line,
    paddingHorizontal: layout.gap,
    paddingVertical: 10,
  },
  suggestionText: { color: brand.default, fontSize: 14, fontWeight: '600' },
  bubble: {
    borderRadius: layout.radius,
    padding: layout.gap,
    gap: 8,
    maxWidth: '92%',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: surfaces.raised,
    borderWidth: 1,
    borderColor: brand.default,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: surfaces.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaces.line,
  },
  bubbleText: { color: textTokens.primary, fontSize: 15, lineHeight: 22 },
  citations: { gap: 6 },
  citation: {
    flexDirection: 'row',
    gap: 8,
    minHeight: layout.minTapTarget,
    alignItems: 'center',
    backgroundColor: surfaces.raised,
    borderRadius: layout.radius,
    borderLeftWidth: 3,
    borderLeftColor: brand.default,
    padding: 8,
  },
  citationRef: { color: brand.default, fontSize: 13, fontWeight: '700' },
  citationBody: { flex: 1, gap: 2 },
  citationCode: { color: textTokens.primary, fontSize: 13, fontWeight: '700' },
  citationPath: { color: textTokens.dim, fontSize: 11 },
  citationMeta: { color: textTokens.faint, fontSize: 11 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  busyText: { color: textTokens.dim, fontSize: 13 },
  error: { color: '#E7C33B', fontSize: 13, paddingHorizontal: 4 },
  offline: {
    color: textTokens.dim,
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
  input: { flex: 1, maxHeight: 120, backgroundColor: surfaces.raised, fontSize: 15 },
  disclaimer: {
    color: textTokens.faint,
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 6,
    paddingHorizontal: layout.gap,
  },
});
