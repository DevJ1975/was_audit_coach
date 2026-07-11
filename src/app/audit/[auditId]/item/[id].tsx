import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { ActivityIndicator, TextInput, Text } from 'react-native-paper';
import { Screen, Card, Button, Subtitle, Body, Mono } from '@/components/ui';
import { RatingSelector } from '@/components/RatingSelector';
import { AttachmentStrip } from '@/components/AttachmentStrip';
import { SifBadge, SavedFlash, type SaveStatus } from '@/components/badges';
import { useRepo, useSession } from '@/db/RepoProvider';
import { useAuditItem, useAuditData } from '@/hooks/useAudit';
import { libraryItem } from '@/seed';
import { compareByCode } from '@/domain/ordering';
import { requestDraft, isAiConfigured } from '@/ai/client';
import { buildObservationPolish, buildRecommendationDraft, buildAriaCoach, type GroundingItem } from '@/ai/prompts';
import type { Rating } from '@soteria/scoring-engine';
import { surfaces, text as textTokens, brand, ratingColors, layout } from '@/theme/tokens';

type TextField = 'observations' | 'recommendations' | 'auditor_notes';
const TEXT_FIELDS: TextField[] = ['observations', 'recommendations', 'auditor_notes'];

/** Editable AI draft — the auditor edits then Accepts; nothing is auto-applied. */
function AiDraftBox({
  text,
  onAccept,
  onDiscard,
}: {
  text: string;
  onAccept: (t: string) => void;
  onDiscard: () => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  return (
    <View style={styles.aiBox}>
      <Text style={styles.aiLabel}>AI draft — review &amp; edit, then Accept</Text>
      <TextInput mode="outlined" multiline value={draft} onChangeText={setDraft} style={styles.textArea} />
      <View style={styles.aiActions}>
        <Button label="Discard" variant="ghost" onPress={onDiscard} />
        <Button label="Accept" variant="primary" onPress={() => onAccept(draft)} />
      </View>
    </View>
  );
}

export default function ItemCardScreen(): React.ReactElement {
  const { auditId, id } = useLocalSearchParams<{ auditId: string; id: string }>();
  const router = useRouter();
  const repo = useRepo();
  const session = useSession();

  const { item, reload } = useAuditItem(id);
  const { audit, items } = useAuditData(auditId);
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

  // AI drafting state (Phase 3). A draft is ALWAYS an editable suggestion the
  // auditor must accept; it never sets a rating (Non-Negotiable #2).
  const aiOn = isAiConfigured();
  const [aiBusy, setAiBusy] = useState<'observations' | 'recommendations' | 'aria' | null>(null);
  const [aiDraft, setAiDraft] = useState<{ field: 'observations' | 'recommendations'; text: string } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [ariaQuestion, setAriaQuestion] = useState('');
  const [ariaAnswer, setAriaAnswer] = useState<string | null>(null);

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

  function grounding(): GroundingItem | null {
    if (!item || !lib) return null;
    return {
      item_code: item.item_code,
      requirement: lib.requirement,
      evidence_protocol: lib.evidence_protocol,
      citation: lib.citation,
    };
  }

  async function polish(): Promise<void> {
    const g = grounding();
    if (!g || !obs.trim()) return;
    setAiBusy('observations');
    setAiError(null);
    const r = await requestDraft(buildObservationPolish(g, obs));
    setAiBusy(null);
    if (r.ok) setAiDraft({ field: 'observations', text: r.text });
    else setAiError(r.error);
  }

  async function draftRecommendation(): Promise<void> {
    const g = grounding();
    if (!g) return;
    setAiBusy('recommendations');
    setAiError(null);
    const r = await requestDraft(buildRecommendationDraft(g, item?.rating ?? 'unrated', obs));
    setAiBusy(null);
    if (r.ok) setAiDraft({ field: 'recommendations', text: r.text });
    else setAiError(r.error);
  }

  // Accept an AI draft: apply the (possibly edited) text and log ai_draft_accepted
  // via setText with ai_generated:true. This is the ONLY AI→state path, and it
  // touches text fields only — never the rating.
  async function acceptDraft(edited: string): Promise<void> {
    const draft = aiDraft;
    if (!draft) return;
    if (draft.field === 'observations') setObs(edited);
    else setRec(edited);
    setAiDraft(null);
    await repo.setText(id, draft.field, edited, session.user_id, { ai_generated: true });
    flashStatus(draft.field, 'saved');
  }

  async function askAria(): Promise<void> {
    const g = grounding();
    if (!g || !ariaQuestion.trim()) return;
    setAiBusy('aria');
    setAiError(null);
    setAriaAnswer(null);
    const r = await requestDraft(buildAriaCoach(g, ariaQuestion));
    setAiBusy(null);
    if (r.ok) setAriaAnswer(r.text);
    else setAiError(r.error);
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
            {/* Corpus-wide Q&A (Phase C4) — the online superset of ARIA below. */}
            <Button
              label="Ask Soteria about this standard"
              variant="ghost"
              onPress={() =>
                router.push({
                  pathname: '/chat',
                  params: {
                    seed: `What does ${lib.citation} require?`,
                    ...(audit?.state_plan ? { jurisdiction: audit.state_plan } : {}),
                  },
                })
              }
            />
          </>
        ) : null}
      </Card>

      {/* Evidence protocol — OPEN BY DEFAULT, accent border (Non-Negotiable #8) */}
      <Card accent={brand.default}>
        <Subtitle style={{ color: brand.default }}>Evidence protocol</Subtitle>
        <Body>{lib.evidence_protocol}</Body>
        {/* Audit Coach (managed agent) — HOW to audit this; distinct from Soteria
            (regulation text) and ARIA (this item's text only). */}
        <Button
          label="Coach: how do I audit this?"
          variant="ghost"
          onPress={() =>
            router.push({
              pathname: `/audit/${auditId}/coach`,
              params: { section: item.section_code, item: item.item_code },
            })
          }
        />
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
          placeholder="What did you observe? Add a photo or voice note below."
          value={obs}
          onChangeText={(t) => {
            setObs(t);
            scheduleSave('observations', t);
          }}
        />
        <View style={styles.aiRow}>
          <Button
            label={aiBusy === 'observations' ? 'Polishing…' : '✨ AI polish'}
            variant="secondary"
            onPress={polish}
            disabled={!aiOn || aiBusy !== null || !obs.trim()}
          />
          {!aiOn ? <Text style={styles.aiHint}>Connects when online</Text> : null}
        </View>
        {aiDraft?.field === 'observations' ? (
          <AiDraftBox text={aiDraft.text} onAccept={acceptDraft} onDiscard={() => setAiDraft(null)} />
        ) : null}
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
        <View style={styles.aiRow}>
          <Button
            label={aiBusy === 'recommendations' ? 'Drafting…' : '✨ AI draft'}
            variant="secondary"
            onPress={draftRecommendation}
            disabled={!aiOn || aiBusy !== null}
          />
          {!aiOn ? <Text style={styles.aiHint}>Connects when online</Text> : null}
        </View>
        {aiDraft?.field === 'recommendations' ? (
          <AiDraftBox text={aiDraft.text} onAccept={acceptDraft} onDiscard={() => setAiDraft(null)} />
        ) : null}
      </Card>

      {aiError ? (
        <Card>
          <Text style={styles.aiError}>{aiError}</Text>
        </Card>
      ) : null}

      {/* ARIA coach — grounded Q&A, answers only from this item (Non-Negotiable #8 corpus) */}
      <Card>
        <Subtitle>ARIA — ask about this item</Subtitle>
        <TextInput
          mode="outlined"
          style={styles.textArea}
          multiline
          placeholder="e.g. What sampling minimum does this require?"
          value={ariaQuestion}
          onChangeText={setAriaQuestion}
        />
        <View style={styles.aiRow}>
          <Button
            label={aiBusy === 'aria' ? 'Thinking…' : 'Ask ARIA'}
            variant="secondary"
            onPress={askAria}
            disabled={!aiOn || aiBusy !== null || !ariaQuestion.trim()}
          />
          {!aiOn ? <Text style={styles.aiHint}>Connects when online</Text> : null}
        </View>
        {ariaAnswer ? (
          <View style={styles.aiBox}>
            <Body>{ariaAnswer}</Body>
          </View>
        ) : null}
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

      {/* Evidence capture — photo + voice (Phase 2). A finding can carry proof. */}
      <AttachmentStrip auditItemId={id} />

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
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  aiHint: { color: textTokens.faint, fontSize: 12 },
  aiError: { color: '#E7C33B', fontSize: 13 },
  aiBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: brand.default,
    borderRadius: layout.radius,
    padding: 10,
    gap: 8,
    backgroundColor: surfaces.raised,
  },
  aiLabel: { color: brand.default, fontSize: 12, fontWeight: '700' },
  aiActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
