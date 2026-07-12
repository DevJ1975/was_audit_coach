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
import { StyleSheet } from 'react-native';
import { useLocalSearchParams, Stack, useFocusEffect } from 'expo-router';
import { Text } from 'react-native-paper';
import { Screen, Card, Subtitle, Body } from '@/components/ui';
import { SegmentedControl, type SegOption } from '@/components/SegmentedControl';
import { useRepo, useSession } from '@/db/RepoProvider';
import { seedLibrary, seedQuestions } from '@/seed';
import type { ScopingAnswer } from '@/db/types';
import { type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';

const YESNO: readonly SegOption<'No' | 'Yes'>[] = [
  { label: 'No', value: 'No' },
  { label: 'Yes', value: 'Yes' },
];

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
            <SegmentedControl
              options={YESNO}
              value={value === undefined ? null : value ? 'Yes' : 'No'}
              onChange={(v) => void toggle(q.key, v === 'Yes')}
              disabled={busy !== null}
            />
            {value === undefined ? <Text style={styles.unanswered}>Not answered at creation</Text> : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    question: { color: t.text.primary, fontSize: 14, lineHeight: 20 },
    unanswered: { color: t.text.faint, fontSize: 12 },
  });
