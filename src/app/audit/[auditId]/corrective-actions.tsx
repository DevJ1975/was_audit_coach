import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Chip, TextInput, Text } from 'react-native-paper';
import { Screen, Card, Button, Subtitle, Mono } from '@/components/ui';
import { SifBadge, PrivilegeBanner } from '@/components/badges';
import { useSession } from '@/db/RepoProvider';
import { useCorrectiveActions, type CaItemMeta } from '@/hooks/useCorrectiveActions';
import { isOverdue } from '@/domain/analytics';
import { nowIso } from '@/db/ids';
import type { CAStatus, CorrectiveAction } from '@/db/types';
import { ratingColors, surfaces, text as textTokens, layout, semantic } from '@/theme/tokens';

const STATUSES: CAStatus[] = ['open', 'in_progress', 'verified', 'closed'];
const STATUS_LABEL: Record<CAStatus, string> = {
  open: 'Open', in_progress: 'In progress', verified: 'Verified', closed: 'Closed',
};

function CARow({
  ca,
  meta,
  userId,
  onCommit,
  onOpenItem,
}: {
  ca: CorrectiveAction;
  meta: CaItemMeta | undefined;
  userId: string;
  onCommit: (ca: CorrectiveAction) => void;
  onOpenItem: () => void;
}): React.ReactElement {
  const [assigned, setAssigned] = useState(ca.assigned_to ?? '');
  const [due, setDue] = useState(ca.due_date ?? '');
  const overdue = isOverdue(ca, nowIso());

  function commitFields(): void {
    if ((ca.assigned_to ?? '') !== assigned || (ca.due_date ?? '') !== due) {
      onCommit({ ...ca, assigned_to: assigned || null, due_date: due || null });
    }
  }

  function setStatus(status: CAStatus): void {
    const patch: CorrectiveAction = { ...ca, status };
    patch.verified_by = status === 'verified' || status === 'closed' ? userId : null;
    patch.close_date = status === 'closed' ? (ca.close_date ?? nowIso().slice(0, 10)) : null;
    onCommit(patch);
  }

  return (
    <Card accent={ratingColors[ca.rating]} style={overdue ? styles.overdueCard : undefined}>
      <View style={styles.head}>
        <Mono style={styles.code}>{meta?.item_code ?? '—'}</Mono>
        {meta?.sif_potential ? <SifBadge small /> : null}
        <Text style={[styles.tag, { color: ratingColors[ca.rating] }]}>{ca.rating}</Text>
        {overdue ? <Text style={styles.overdue}>OVERDUE</Text> : null}
      </View>
      <Text numberOfLines={2} style={styles.req}>{meta?.requirement ?? ''}</Text>

      <View style={styles.fields}>
        <TextInput
          mode="outlined" dense label="Assigned to" style={styles.field}
          value={assigned} onChangeText={setAssigned} onBlur={commitFields}
        />
        <TextInput
          mode="outlined" dense label="Due (YYYY-MM-DD)" style={styles.field}
          value={due} onChangeText={setDue} onBlur={commitFields}
        />
      </View>

      <View style={styles.statusRow}>
        {STATUSES.map((s) => (
          <Chip
            key={s}
            selected={ca.status === s}
            showSelectedCheck={false}
            compact
            onPress={() => setStatus(s)}
            style={[styles.chip, ca.status === s && styles.chipOn]}
            textStyle={styles.chipText}
          >
            {STATUS_LABEL[s]}
          </Chip>
        ))}
      </View>
      {ca.status === 'closed' && ca.close_date ? (
        <View style={styles.closedRow}>
          <Text style={styles.meta}>
            Closed {ca.close_date}
            {ca.verified_by ? ` · verified by ${ca.verified_by}` : ''} · closure evidence lives on the item card
          </Text>
          <Button label="Open item card" variant="ghost" onPress={onOpenItem} />
        </View>
      ) : null}
    </Card>
  );
}

export default function CorrectiveActionsScreen(): React.ReactElement {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const router = useRouter();
  const session = useSession();
  const { audit, cas, itemMeta, update } = useCorrectiveActions(auditId);

  const openCount = cas.filter((c) => c.status === 'open' || c.status === 'in_progress').length;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Corrective Actions' }} />
      {audit?.privileged ? <PrivilegeBanner attorney={audit.attorney_of_record} /> : null}

      <Subtitle>
        {cas.length} corrective action{cas.length === 1 ? '' : 's'} · {openCount} open · Very High → Low
      </Subtitle>
      {cas.length === 0 ? (
        <Text style={styles.empty}>No findings yet — rate items Low or worse to populate the queue.</Text>
      ) : null}

      {cas.map((ca) => (
        <CARow
          key={ca.id}
          ca={ca}
          meta={itemMeta[ca.audit_item_id]}
          userId={session.user_id}
          onCommit={update}
          onOpenItem={() => router.push(`/audit/${auditId}/item/${ca.audit_item_id}`)}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  overdueCard: { borderColor: semantic.danger, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  code: { color: textTokens.primary, fontSize: 15, fontWeight: '800' },
  tag: { fontSize: 13, fontWeight: '800', marginLeft: 'auto' },
  overdue: { color: semantic.danger, fontSize: 11, fontWeight: '800' },
  fields: { flexDirection: 'row', gap: 8, marginTop: 6 },
  field: { flex: 1, backgroundColor: surfaces.raised },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { backgroundColor: surfaces.raised, minHeight: layout.minTapTarget, justifyContent: 'center' },
  chipOn: { backgroundColor: surfaces.line },
  chipText: { fontSize: 12 },
  req: { color: textTokens.primary, fontSize: 13, lineHeight: 18, marginTop: 4 },
  meta: { color: textTokens.faint, fontSize: 11 },
  closedRow: { gap: 2, marginTop: 6, alignItems: 'flex-start' },
  empty: { color: textTokens.dim },
});
