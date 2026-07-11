import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { ActivityIndicator, TextInput, Text } from 'react-native-paper';
import { Screen, Card, Button, Subtitle, Body, Mono } from '@/components/ui';
import { RatingSelector } from '@/components/RatingSelector';
import { SifBadge, SavedFlash, type SaveStatus } from '@/components/badges';
import { useRepo, useSession } from '@/db/RepoProvider';
import { useAuditItem, useAuditData } from '@/hooks/useAudit';
import { libraryItem } from '@/seed';
import { compareByCode } from '@/domain/ordering';
import type { Rating } from '@soteria/scoring-engine';
import { surfaces, text as textTokens, brand, ratingColors, layout } from '@/theme/tokens';

type TextField = 'observations' | 'recommendations' | 'auditor_notes';
const TEXT_FIELDS: TextField[] = ['observations', 'recommendations', 'auditor_notes'];

export default function ItemCardScreen(): React.ReactElement {
  const { auditId, id } = useLocalSearchParams<{ auditId: string; id: string }>();
  const router = useRouter();
  const repo = useRepo();
  const session = useSession();

  const { item, reload } = useAuditItem(id);
  const { items } = useAuditData(auditId);
  const lib = item ? libraryItem(item.item_code) : undefined;

  // Prev/next within this section's applicable items (canonical order).
  const siblings = useMemo(
    () => items.filter((it) => it.section_code === item?.section_code && it.applicable).sort(compareByCode),
    [items, item?.section_code],
  );
  const position = siblings.findIndex((it) => it.id === id);

  const [obs, setObs] = useState('');
  const [rec, setRec] = useState('');
  const [notes, setNotes] = useState('');
  const [requirementOpen, setRequirementOpen] = useState(true);
  const [status, setStatus] = useState<Partial<Record<TextField, SaveStatus>>>({});

  const seededFor = useRef<string | null>(null);
  const mounted = useRef(true);
  // Pending writes are keyed by field AND carry the item id they belong to, so a
  // pending save for item A can never be misattributed to (or cancelled by) B.
  const pending = useRef<Partial<Record<TextField, { itemId: string; value: string }>>>({});
  const timers = useRef<Partial<Record<TextField, ReturnType<typeof setTimeout>>>>({});
  const flashTimers = useRef<Partial<Record<TextField, ReturnType<typeof setTimeout>>>>({});

  const flashStatus = useCallback((field: TextField, s: SaveStatus) => {
    if (!mounted.current) return;
    setStatus((prev) => ({ ...prev, [field]: s }));
    const ft = flashTimers.current[field];
    if (ft) clearTimeout(ft);
    if (s === 'saved') {
      flashTimers.current[field] = setTimeout(() => {
        if (mounted.current) setStatus((prev) => ({ ...prev, [field]: null }));
      }, 1400);
    }
  }, []);

  // Persist one field NOW to the item it belongs to. Safe to call from unmount
  // (the SQLite write still lands; only the status flash is skipped if gone).
  const commit = useCallback(
    async (field: TextField) => {
      const t = timers.current[field];
      if (t) {
        clearTimeout(t);
        delete timers.current[field];
      }
      const p = pending.current[field];
      if (!p) return;
      delete pending.current[field];
      try {
        await repo.setText(p.itemId, field, p.value, session.user_id);
        flashStatus(field, 'saved');
      } catch {
        // Re-queue so continued typing / a later flush can retry, and surface it.
        pending.current[field] = p;
        flashStatus(field, 'error');
      }
    },
    [repo, session.user_id, flashStatus],
  );

  const flushAll = useCallback(() => {
    for (const field of TEXT_FIELDS) {
      if (pending.current[field]) void commit(field);
    }
  }, [commit]);

  function scheduleSave(field: TextField, value: string): void {
    pending.current[field] = { itemId: id, value };
    const existing = timers.current[field];
    if (existing) clearTimeout(existing);
    timers.current[field] = setTimeout(() => void commit(field), 600);
  }

  // Seed local text once per item id; flush the previous item's pending writes
  // first so switching items (prev/next reuse) never drops an edit.
  useEffect(() => {
    if (item && seededFor.current !== item.id) {
      if (seededFor.current !== null) flushAll();
      seededFor.current = item.id;
      setObs(item.observations);
      setRec(item.recommendations);
      setNotes(item.auditor_notes);
      setStatus({});
    }
  }, [item, flushAll]);

  // On unmount (e.g. Back), FLUSH pending writes — do not cancel them.
  useEffect(() => {
    return () => {
      mounted.current = false;
      flushAll();
      Object.values(flashTimers.current).forEach((t) => t && clearTimeout(t));
    };
  }, [flushAll]);

  async function onRate(rating: Rating): Promise<void> {
    await repo.setRating(id, rating, session.user_id);
    await reload();
  }

  function go(delta: number): void {
    const target = siblings[position + delta];
    if (!target) return;
    flushAll(); // persist this item's edits before leaving it
    router.replace(`/audit/${auditId}/item/${target.id}`);
  }

  if (!item || !lib) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Item' }} />
        <ActivityIndicator animating color={brand.default} style={styles.loading} />
        <Body>Loading…</Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: item.item_code }} />

      {/* Header: code + SIF + position */}
      <View style={styles.headerRow}>
        <Mono style={styles.code}>{item.item_code}</Mono>
        {lib.sif_potential ? <SifBadge /> : null}
        <Text style={styles.position}>{position >= 0 ? `${position + 1} of ${siblings.length}` : ''}</Text>
      </View>

      {/* Requirement + citation (collapsible, ≥48pt toggle) */}
      <Card>
        <Pressable onPress={() => setRequirementOpen((v) => !v)} style={styles.collapseHead} accessibilityRole="button">
          <Subtitle>Requirement</Subtitle>
          <Text style={styles.caret}>{requirementOpen ? '▾' : '▸'}</Text>
        </Pressable>
        {requirementOpen ? (
          <>
            <Body>{lib.requirement}</Body>
            <Mono style={styles.citation}>{lib.citation}</Mono>
          </>
        ) : null}
      </Card>

      {/* Evidence protocol — OPEN BY DEFAULT, accent border (Non-Negotiable #8) */}
      <Card accent={brand.default}>
        <Subtitle style={{ color: brand.default }}>Evidence protocol</Subtitle>
        <Body>{lib.evidence_protocol}</Body>
      </Card>

      {/* Rating — auditor-only (Non-Negotiable #2) */}
      <Card accent={item.rating ? ratingColors[item.rating] : undefined}>
        <Subtitle>Rating</Subtitle>
        <RatingSelector value={item.rating} onChange={onRate} />
      </Card>

      {/* Text fields with debounced autosave + Saved/failed flash */}
      <Card>
        <View style={styles.fieldHead}>
          <Subtitle>Observations</Subtitle>
          <SavedFlash status={status.observations ?? null} />
        </View>
        <TextInput
          mode="outlined"
          style={styles.textArea}
          multiline
          placeholder="What did you observe? (voice dictation arrives in Phase 2)"
          value={obs}
          onChangeText={(t) => {
            setObs(t);
            scheduleSave('observations', t);
          }}
        />
      </Card>

      <Card>
        <View style={styles.fieldHead}>
          <Subtitle>Recommendations</Subtitle>
          <SavedFlash status={status.recommendations ?? null} />
        </View>
        <TextInput
          mode="outlined"
          style={styles.textArea}
          multiline
          placeholder="Corrective recommendation…"
          value={rec}
          onChangeText={(t) => {
            setRec(t);
            scheduleSave('recommendations', t);
          }}
        />
      </Card>

      <Card>
        <View style={styles.fieldHead}>
          <Subtitle>Auditor notes</Subtitle>
          <SavedFlash status={status.auditor_notes ?? null} />
        </View>
        <TextInput
          mode="outlined"
          style={styles.textArea}
          multiline
          placeholder="Private notes…"
          value={notes}
          onChangeText={(t) => {
            setNotes(t);
            scheduleSave('auditor_notes', t);
          }}
        />
      </Card>

      {/* Prev / next */}
      <View style={styles.nav}>
        <Button label="‹ Prev" variant="secondary" onPress={() => go(-1)} disabled={position <= 0} />
        <Button
          label="Next ›"
          variant="secondary"
          onPress={() => go(1)}
          disabled={position < 0 || position >= siblings.length - 1}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  code: { color: textTokens.primary, fontSize: 18, fontWeight: '800' },
  position: { color: textTokens.dim, fontSize: 13, marginLeft: 'auto' },
  collapseHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: layout.minTapTarget,
    paddingVertical: 6,
  },
  caret: { color: textTokens.dim, fontSize: 16 },
  citation: { color: textTokens.dim, fontSize: 12, marginTop: 4 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  textArea: {
    minHeight: 96,
    backgroundColor: surfaces.raised,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  loading: { paddingVertical: 12 },
  nav: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 4 },
});
