import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Divider, Text } from 'react-native-paper';
import { Screen, Card, Row, Button, Title, Subtitle, Mono } from '@/components/ui';
import { ScoreReadout } from '@/components/ScoreReadout';
import { PrivilegeBanner } from '@/components/badges';
import { useAuditData } from '@/hooks/useAudit';
import { useSync } from '@/hooks/useSync';
import { useConflicts } from '@/hooks/useConflicts';
import { useDeleteAudit } from '@/hooks/useDeleteAudit';
import { useRepo, useSession } from '@/db/RepoProvider';
import { sectionNames, sectionOrder } from '@/seed';
import { ratingColors, type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import type { Rating } from '@soteria/scoring-engine';

/** A rating name in its semantic color (or "Unrated"). */
function RatingText({ rating }: { rating: Rating | null }): React.ReactElement {
  const styles = useThemedStyles(makeStyles);
  const { palette } = useTheme();
  return (
    <Text style={[styles.candidate, { color: rating ? ratingColors[rating] : palette.text.dim }]}>
      {rating ?? 'Unrated'}
    </Text>
  );
}

export default function SectionListScreen(): React.ReactElement {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const router = useRouter();
  const repo = useRepo();
  const session = useSession();
  const styles = useThemedStyles(makeStyles);
  const { palette } = useTheme();
  const { audit, items, score, findings, reload } = useAuditData(auditId);
  const { sync, syncing, result, error, available, signInNeeded } = useSync(auditId);
  const conflictQ = useConflicts(auditId);
  const del = useDeleteAudit();
  // Two-tap destructive confirm (no Alert — react-native-web doesn't support
  // multi-button alerts, and a second deliberate tap suits gloved hands).
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  async function onDeletePress(): Promise<void> {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      confirmTimer.current = setTimeout(() => setConfirmingDelete(false), 6000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmingDelete(false);
    if (await del.deleteAudit(auditId)) router.replace('/');
  }

  // Derived from the items this screen already loads — no second table scan.
  const conflicts = items.filter((it) => it.sync_state === 'needs_resolution');
  const activeSections = sectionOrder.filter((code) => score.sections[code]);

  async function setStatus(status: 'in_progress' | 'complete' | 'archived'): Promise<void> {
    await repo.setAuditStatus(auditId, status, session.user_id);
    reload();
  }

  async function syncAndRefresh(): Promise<void> {
    await sync();
    reload(); // divergent ratings may have just been flagged
  }

  const itemSummary = result?.items;

  return (
    <Screen>
      <Stack.Screen options={{ title: audit?.title ?? 'Audit' }} />

      {audit?.privileged ? <PrivilegeBanner attorney={audit.attorney_of_record} /> : null}

      <Card>
        <View style={styles.overallHead}>
          <Subtitle>Overall</Subtitle>
          {audit ? <Mono style={styles.status}>{audit.status.replace('_', ' ')}</Mono> : null}
        </View>
        <ScoreReadout
          rawScore={score.rawScore}
          effectiveMax={score.effectiveMax}
          percent={score.percent}
          tier={score.tier}
          ratedCount={score.ratedCount}
          itemCount={score.itemCount}
          size="lg"
        />
        <View style={styles.actions}>
          <Button label="Dashboard" variant="secondary" onPress={() => router.push(`/audit/${auditId}/dashboard`)} />
          <Button
            label={`Findings (${findings.length})`}
            variant="secondary"
            onPress={() => router.push(`/audit/${auditId}/report`)}
          />
          <Button label="CA tracker" variant="secondary" onPress={() => router.push(`/audit/${auditId}/corrective-actions`)} />
          <Button label="Scoping" variant="secondary" onPress={() => router.push(`/audit/${auditId}/scoping`)} />
          {/* Audit Coach — technique mentor (managed agent), distinct from Soteria chat. */}
          <Button label="Coach" variant="secondary" onPress={() => router.push(`/audit/${auditId}/coach`)} />
          {available ? (
            <Button label={syncing ? 'Syncing…' : 'Sync'} variant="ghost" onPress={syncAndRefresh} disabled={syncing} />
          ) : null}
          {signInNeeded ? (
            <Button label="Sign in to sync" variant="ghost" onPress={() => router.push('/login')} />
          ) : null}
        </View>

        {/* Lifecycle — an audit can actually be closed out (and reopened). */}
        {audit ? (
          <View style={styles.actions}>
            {audit.status === 'in_progress' || audit.status === 'draft' ? (
              <Button label="Mark complete" variant="ghost" onPress={() => void setStatus('complete')} />
            ) : null}
            {audit.status === 'complete' ? (
              <>
                <Button label="Reopen" variant="ghost" onPress={() => void setStatus('in_progress')} />
                <Button label="Archive" variant="ghost" onPress={() => void setStatus('archived')} />
              </>
            ) : null}
            {audit.status === 'archived' ? (
              <Button label="Unarchive" variant="ghost" onPress={() => void setStatus('complete')} />
            ) : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={
              del.deleting
                ? 'Deleting…'
                : confirmingDelete
                  ? (del.cloudDelete ? 'Tap again: delete from device AND cloud' : 'Tap again: delete from this device')
                  : 'Delete audit'
            }
            variant="ghost"
            onPress={() => void onDeletePress()}
            disabled={del.deleting}
          />
        </View>
        {del.error ? <Text style={styles.syncError}>Delete failed: {del.error}</Text> : null}

        {itemSummary && !itemSummary.skipped ? (
          <Text style={styles.syncNote}>
            Synced · {itemSummary.pushed} pushed · {itemSummary.appliedLocal} applied
            {result?.eventsPushed ? ` · ${result.eventsPushed} events` : ''}
            {itemSummary.conflicts.length ? ` · ${itemSummary.conflicts.length} need resolution` : ''}
            {result?.evidence?.uploaded ? ` · ${result.evidence.uploaded} evidence up` : ''}
            {result?.evidence?.pulled ? ` · ${result.evidence.pulled} evidence found` : ''}
            {result?.evidence?.failed ? ` · ${result.evidence.failed} evidence pending` : ''}
          </Text>
        ) : null}
        {result?.skipped ? (
          <Text style={styles.syncError}>Sync unavailable — check your connection and sign-in, then try again.</Text>
        ) : null}
        {error ? <Text style={styles.syncError}>Sync problem: {error}</Text> : null}
      </Card>

      {/* Rating conflicts — the lead auditor sees both candidates and picks.
          Divergent ratings are never auto-resolved (conflict policy). */}
      {conflicts.length > 0 ? (
        <Card accent={palette.semantic.warn}>
          <Subtitle style={{ color: palette.semantic.warn }}>
            Rating conflicts ({conflicts.length})
          </Subtitle>
          <Text style={styles.conflictIntro}>
            This item was rated differently on another device. Pick the rating that stands — the
            choice is logged.
          </Text>
          {conflicts.map((it) => (
            <View key={it.id} style={styles.conflictRow}>
              <View style={styles.conflictInfo}>
                <Mono style={styles.code}>{it.item_code}</Mono>
                <View style={styles.candidates}>
                  <Text style={styles.candidateLabel}>Mine:</Text>
                  <RatingText rating={it.rating} />
                  <Text style={styles.candidateLabel}> Theirs:</Text>
                  <RatingText rating={it.conflict_rating} />
                </View>
              </View>
              <View style={styles.conflictActions}>
                <Button
                  label="Keep mine"
                  variant="secondary"
                  disabled={conflictQ.resolving !== null}
                  onPress={() => void conflictQ.resolve(it, 'mine').then(reload)}
                />
                <Button
                  label="Use theirs"
                  variant="secondary"
                  disabled={conflictQ.resolving !== null}
                  onPress={() => void conflictQ.resolve(it, 'theirs').then(reload)}
                />
              </View>
            </View>
          ))}
          {conflictQ.error ? <Text style={styles.syncError}>{conflictQ.error}</Text> : null}
        </Card>
      ) : null}

      <Title style={styles.sectionsHeading}>Sections</Title>
      <Divider style={styles.divider} />
      {activeSections.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>No active sections.</Text>
          <Button
            label="Review scoping answers"
            variant="secondary"
            onPress={() => router.push(`/audit/${auditId}/scoping`)}
          />
        </View>
      ) : null}

      {activeSections.map((code) => {
        const s = score.sections[code]!;
        return (
          <Row key={code} testID="section-row" onPress={() => router.push(`/audit/${auditId}/section/${code}`)}>
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Mono style={styles.code}>{code}</Mono>
                <Text style={styles.sectionName} numberOfLines={1}>
                  {sectionNames[code] ?? code}
                </Text>
              </View>
              <ScoreReadout
                rawScore={s.rawScore}
                effectiveMax={s.effectiveMax}
                percent={s.percent}
                tier={s.tier}
                ratedCount={s.ratedCount}
                itemCount={s.itemCount}
                size="sm"
              />
            </View>
            <Text style={styles.chevron}>›</Text>
          </Row>
        );
      })}
    </Screen>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    overallHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    status: { color: t.text.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    syncNote: { color: t.text.faint, fontSize: 12, marginTop: 6 },
    syncError: { color: t.semantic.warn, fontSize: 12, marginTop: 6 },
    conflictIntro: { color: t.text.dim, fontSize: 13 },
    conflictRow: { gap: 6, marginTop: 8, borderTopWidth: 1, borderTopColor: t.surfaces.line, paddingTop: 8 },
    conflictInfo: { gap: 4 },
    candidates: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    candidateLabel: { color: t.text.dim, fontSize: 13 },
    candidate: { fontSize: 13, fontWeight: '800' },
    conflictActions: { flexDirection: 'row', gap: 8 },
    sectionsHeading: { fontSize: 16, marginTop: 4 },
    divider: { backgroundColor: t.surfaces.line },
    empty: { color: t.text.dim },
    emptyWrap: { gap: 10, alignItems: 'flex-start' },
    rowBody: { flex: 1, gap: 6 },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    code: { color: t.text.dim, fontSize: 13, fontWeight: '700' },
    sectionName: { color: t.text.primary, fontSize: 15, fontWeight: '600', flexShrink: 1 },
    chevron: { color: t.text.faint, fontSize: 24, fontWeight: '300' },
  });
