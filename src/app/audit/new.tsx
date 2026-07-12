import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Chip, Divider, Switch, TextInput, Text } from 'react-native-paper';
import { Screen, Card, Button, Title, Subtitle, Body } from '@/components/ui';
import { SegmentedControl, type SegOption } from '@/components/SegmentedControl';
import { useRepo, useSession } from '@/db/RepoProvider';
import { seedLibrary, seedQuestions, statePlans, LIBRARY_VERSION_ID } from '@/seed';
import { layout, type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';

const STEPS = ['Facility', 'Process inventory', 'Plan & privilege'] as const;
const YESNO: readonly SegOption<'No' | 'Yes'>[] = [
  { label: 'No', value: 'No' },
  { label: 'Yes', value: 'Yes' },
];

export default function NewAuditScreen(): React.ReactElement {
  const router = useRouter();
  const repo = useRepo();
  const session = useSession();
  const styles = useThemedStyles(makeStyles);
  const { palette } = useTheme();

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [statePlan, setStatePlan] = useState('');
  const [privileged, setPrivileged] = useState(true);
  const [attorney, setAttorney] = useState('Conn Maciel Carey LLP');
  const [saving, setSaving] = useState(false);

  const canNext = step > 0 || title.trim().length > 0;

  async function submit(): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      const audit = await repo.createAudit(
        {
          org_id: session.org_id,
          created_by: session.user_id,
          title: title.trim() || 'Untitled Audit',
          privileged,
          attorney_of_record: privileged ? attorney.trim() || null : null,
          state_plan: statePlan.trim() || null,
          library_version_id: LIBRARY_VERSION_ID,
          answers,
        },
        { library: seedLibrary, questions: seedQuestions },
      );
      router.replace(`/audit/${audit.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View style={styles.steps}>
        {STEPS.map((label, i) => (
          <View key={label} style={styles.stepPill}>
            <View style={[styles.stepDot, i === step && styles.stepDotActive, i < step && styles.stepDotDone]} />
            <Text style={[styles.stepLabel, i === step && styles.stepLabelActive]}>{label}</Text>
          </View>
        ))}
      </View>

      {step === 0 ? (
        <Card>
          <Title>Facility</Title>
          <Subtitle>Name this audit (facility + date)</Subtitle>
          <TextInput
            mode="outlined"
            label="Audit name"
            placeholder="e.g. Acme Plant — Q3 2026"
            value={title}
            onChangeText={setTitle}
            autoFocus
            style={styles.input}
          />
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <Title>Process inventory</Title>
          <Subtitle>
            Answer to activate the relevant item groups. {seedQuestions.length} questions.
          </Subtitle>
          {seedQuestions.map((q, i) => {
            const value = answers[q.key] ?? false;
            return (
              <View key={q.key}>
                {i > 0 ? <Divider style={styles.divider} /> : null}
                <View style={styles.qRow}>
                  <Body style={styles.qText}>{q.question}</Body>
                  <SegmentedControl
                    options={YESNO}
                    value={value ? 'Yes' : 'No'}
                    onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v === 'Yes' }))}
                  />
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <Title>State plan &amp; privilege</Title>
          <Subtitle>State plan (adds supplemental items; Federal only = OSHA GI)</Subtitle>
          <View style={styles.plans}>
            <Chip
              mode="outlined"
              selected={statePlan === ''}
              showSelectedCheck={false}
              onPress={() => setStatePlan('')}
              style={styles.planChip}
            >
              Federal only
            </Chip>
            {statePlans.map((plan) => (
              <Chip
                key={plan}
                mode="outlined"
                selected={statePlan === plan}
                showSelectedCheck={false}
                onPress={() => setStatePlan(plan)}
                style={styles.planChip}
              >
                {plan}
              </Chip>
            ))}
          </View>
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <Body>Conduct under attorney-client privilege</Body>
              <Text style={styles.hint}>Restricts access, watermarks exports, logs disclosures.</Text>
            </View>
            <Switch value={privileged} onValueChange={setPrivileged} color={palette.brand.accent} />
          </View>
          {privileged ? (
            <>
              <Subtitle>Attorney of record</Subtitle>
              <TextInput
                mode="outlined"
                label="Law firm / attorney"
                value={attorney}
                onChangeText={setAttorney}
                style={styles.input}
              />
            </>
          ) : null}
          <Text style={styles.hint}>
            Applicability is computed from your answers; N/A and unrated items are handled by the
            scoring engine. {statePlan ? `Includes ${statePlan} supplemental items.` : 'Federal OSHA General Industry only.'}
          </Text>
        </Card>
      ) : null}

      <View style={styles.nav}>
        {step > 0 ? <Button label="Back" variant="secondary" onPress={() => setStep((s) => s - 1)} /> : <View />}
        {step < STEPS.length - 1 ? (
          <Button label="Next" onPress={() => setStep((s) => s + 1)} disabled={!canNext} />
        ) : (
          <Button label={saving ? 'Creating…' : 'Create audit'} onPress={submit} disabled={saving} />
        )}
      </View>
    </Screen>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    steps: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    stepPill: { flex: 1, alignItems: 'center', gap: 4 },
    stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.surfaces.line },
    stepDotActive: { backgroundColor: t.brand.accent },
    stepDotDone: { backgroundColor: t.semantic.success },
    stepLabel: { color: t.text.faint, fontSize: 11, textAlign: 'center' },
    stepLabelActive: { color: t.text.primary, fontWeight: '700' },
    input: { backgroundColor: 'transparent' },
    divider: { backgroundColor: t.surfaces.line },
    qRow: { gap: 8, paddingVertical: 10 },
    qText: { flexShrink: 1 },
    plans: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    planChip: { minHeight: layout.minTapTarget, justifyContent: 'center' },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
    switchLabel: { flex: 1, gap: 2 },
    hint: { color: t.text.faint, fontSize: 12, lineHeight: 17 },
    nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  });
