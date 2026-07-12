/**
 * Scoping review — view and CORRECT the 15 process-inventory answers after
 * creation. Before this screen existed, a mis-scoped audit was a dead end: the
 * auditor who discovered a missed process on the floor had to recreate the
 * audit and lose every rating. Flipping an answer recomputes applicability
 * against the audit's frozen library; every flipped item logs an event.
 *
 * Three questions are inverted ("No" activates the group — FP-16/OH-1/OH-3,
 * confirmed 2026-07-11); the seed's applies_on field drives that, so this
 * screen only ever records the literal yes/no answer.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, Stack, useFocusEffect } from 'expo-router';
import { Text } from 'react-native-paper';
import { Screen, Card, Subtitle, Body } from '@/components/ui';
import { useRepo, useSession } from '@/db/RepoProvider';
import { seedLibrary, seedQuestions } from '@/seed';
import type { ScopingAnswer } from '@/db/types';
import { layout, type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';

export default function ScopingScreen(): React.ReactElement {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const repo = useRepo();
  const session = useSession();
  const styles = useThemedStyles(makeStyles);
  const [answers, setAnswers] = useState<Map<string, boolean>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const rows = await repo.getScopingAnswers(auditId);
    setAnswers(new Map(rows.map((a: ScopingAnswer) => [a.question_key, a.answer])));
  }, [repo, auditId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function toggle(question_key: string, next: boolean): Promise<void> {
    if (busy) return;
    setBusy(question_key);
    try {
      await repo.updateScopingAnswer(auditId, question_key, next, session.user_id, {
        library: seedLibrary,
        questions: seedQuestions,
      });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Scoping' }} />
      <Card>
        <Subtitle>Process inventory</Subtitle>
        <Body>
          Changing an answer activates or deactivates its item group. Items keep their ratings and
          evidence either way — nothing is deleted.
        </Body>
      </Card>

      {seedQuestions.map((q) => {
        const value = answers.get(q.key);
        return (
          <Card key={q.key}>
            <Text style={styles.question}>{q.question}</Text>
            <View style={styles.answerRow}>
              {[true, false].map((v) => {
                const selected = value === v;
                return (
                  <Text
                    key={String(v)}
                    onPress={() => (selected || busy ? undefined : void toggle(q.key, v))}
                    style={[styles.answer, selected && styles.answerOn, busy === q.key && styles.answerBusy]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    suppressHighlighting
                  >
                    {v ? 'Yes' : 'No'}
                  </Text>
                );
              })}
              {value === undefined ? <Text style={styles.unanswered}>Not answered at creation</Text> : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    question: { color: t.text.primary, fontSize: 14, lineHeight: 20 },
    answerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' },
    answer: {
      color: t.text.dim,
      backgroundColor: t.surfaces.raised,
      borderRadius: layout.radius,
      borderWidth: 1,
      borderColor: t.surfaces.line,
      paddingHorizontal: 22,
      paddingVertical: 13, // ≥48pt total height with the 14pt line (NN #10)
      fontSize: 15,
      fontWeight: '700',
      overflow: 'hidden',
      minHeight: layout.minTapTarget,
      textAlign: 'center',
      textAlignVertical: 'center',
    },
    answerOn: { color: t.brand.onAccent, backgroundColor: t.brand.accent, borderColor: t.brand.accent },
    answerBusy: { opacity: 0.5 },
    unanswered: { color: t.text.faint, fontSize: 12 },
  });
