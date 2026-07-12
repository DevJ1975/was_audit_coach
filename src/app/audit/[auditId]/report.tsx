import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Text } from 'react-native-paper';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Screen, Card, Button, Title, Subtitle, Body, Mono } from '@/components/ui';
import { SifBadge, PrivilegeBanner } from '@/components/badges';
import { EmptyState } from '@/components/EmptyState';
import { BriefReviewSheet, type BriefFindingLabel } from '@/components/BriefReviewSheet';
import { useAuditData } from '@/hooks/useAudit';
import { useRepo, useSession } from '@/db/RepoProvider';
import {
  buildReportModel,
  renderReportHtml,
  type ReportEvidence,
  type ReportBriefRender,
} from '@/domain/report';
import { readAsDataUri } from '@/attachments/capture';
import { libraryByCode, sectionNames } from '@/seed';
import { FINDING_RATINGS, type Rating } from '@soteria/scoring-engine';
import { ratingColors, type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';
import { useAiReady, aiHintText } from '@/hooks/useAiReady';
import { generateReportBrief, type BriefFindingInput, type BriefProgress } from '@/ai/reportBrief';
import type { BriefAuditContext } from '@/ai/prompts';
import type { ReportBrief, ReportBriefContent } from '@/db/types';

export default function ReportScreen(): React.ReactElement {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const { audit, items, findings } = useAuditData(auditId);
  const repo = useRepo();
  const session = useSession();
  const styles = useThemedStyles(makeStyles);
  const [exporting, setExporting] = useState(false);

  // Legal brief (two-agent AI narrative) state. AI drafts; a human accepts — the
  // accepted brief is what the export interleaves. Generation is online-only; an
  // already-accepted brief renders and exports offline.
  const aiGate = useAiReady();
  const aiOn = aiGate.ready;
  const canAuthor = session.role === 'admin' || session.role === 'lead_auditor';
  const [brief, setBrief] = useState<ReportBrief | null>(null);
  // The generated draft lives only in memory until a human accepts it — so a
  // regenerate-then-discard never destroys a previously accepted brief.
  const [draft, setDraft] = useState<{ content: ReportBriefContent; model: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [generating, setGenerating] = useState<BriefProgress | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [accepting, setAccepting] = useState(false);
  const briefBusy = generating != null;

  // Load any existing brief for this audit (an accepted one is usable in export).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const b = await repo.getReportBrief(auditId);
      if (alive) setBrief(b);
    })();
    return () => {
      alive = false;
    };
  }, [auditId, repo]);

  const findingLabels: BriefFindingLabel[] = useMemo(
    () => findings.map((f) => ({ audit_item_id: f.audit_item_id, item_code: f.item_code, rating: f.rating })),
    [findings],
  );

  // Run the two-agent generation, persist an unaccepted draft, open review.
  async function generateBrief(): Promise<void> {
    if (!audit || !aiOn || !canAuthor || generating) return;
    setGenError(null);
    setGenerating({ done: 0, total: 1, label: 'Starting…' });
    try {
      const model = buildReportModel(audit, items, libraryByCode, sectionNames, new Date().toLocaleString());
      const briefFindings: BriefFindingInput[] = model.findings.map((f) => ({
        audit_item_id: f.audit_item_id,
        section_code: f.section_code,
        grounding: {
          item_code: f.item_code,
          requirement: f.requirement,
          evidence_protocol: libraryByCode.get(f.item_code)?.evidence_protocol ?? '',
          citation: f.citation,
        },
        rating: f.rating,
        observation: f.observations,
        recommendation: f.recommendations,
        sif_potential: f.sif_potential,
      }));
      const context: BriefAuditContext = {
        title: audit.title,
        statePlan: audit.state_plan,
        overall: model.overall,
        findingCount: model.findings.length,
        sifCount: model.sifCount,
        highPlusCount: model.highPlusCount,
      };
      const result = await generateReportBrief(
        {
          context,
          findings: briefFindings,
          scoreSnapshot: {
            overall: model.overall,
            findingCount: model.findings.length,
            sifCount: model.sifCount,
            highPlusCount: model.highPlusCount,
          },
        },
        setGenerating,
      );
      if (!result.ok) {
        setGenError(result.error);
        return;
      }
      // Record that a draft was generated (privilege trail); the draft itself is
      // held in memory and only persisted when the human accepts it.
      await repo.logDisclosure({ org_id: audit.org_id, audit_id: audit.id, actor_id: session.user_id, action: 'brief_generated' });
      setDraft({ content: result.content, model: result.model });
      setWarnings(result.warnings);
      setReviewOpen(true);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(null);
    }
  }

  // Human accepts the (edited) brief — the ONLY path that makes it durable/syncable.
  async function acceptBrief(content: ReportBriefContent): Promise<void> {
    if (!audit || !draft || accepting) return;
    setAccepting(true);
    try {
      const accepted = await repo.saveReportBrief(
        { audit_id: audit.id, org_id: audit.org_id, content, model: draft.model, library_version_id: audit.library_version_id },
        session.user_id,
      );
      setBrief(accepted);
      setReviewOpen(false);
      setDraft(null);
    } finally {
      setAccepting(false);
    }
  }

  // Export the privilege-stamped PDF and log a disclosure (Part 1.5).
  async function exportPdf(): Promise<void> {
    if (!audit || exporting) return;
    setExporting(true);
    try {
      const model = buildReportModel(audit, items, libraryByCode, sectionNames, new Date().toLocaleString());
      // Embed per-finding evidence: up to 3 local photos each (data URIs) plus
      // voice transcriptions; cloud-only or unreadable items are counted, not
      // silently dropped. Failures never block the export.
      const MAX_PHOTOS = 3;
      const evidence: ReportEvidence = {};
      for (const f of model.findings) {
        const atts = await repo.listAttachments(f.audit_item_id);
        if (atts.length === 0) continue;
        const photos: string[] = [];
        const transcriptions: string[] = [];
        let unembedded = 0;
        for (const a of atts) {
          if (a.kind === 'photo' && photos.length < MAX_PHOTOS && a.uri) {
            const dataUri = await readAsDataUri(a.uri);
            if (dataUri) photos.push(dataUri);
            else unembedded++;
          } else if (a.kind === 'voice' && a.transcription) {
            transcriptions.push(a.transcription);
          } else {
            unembedded++;
          }
        }
        evidence[f.audit_item_id] = { photos, transcriptions, unembedded };
      }
      // Only an ACCEPTED brief is rendered — a lingering unaccepted draft never
      // ships in an export. When present it produces the comprehensive report;
      // otherwise the lean deterministic report renders exactly as before.
      const briefRender: ReportBriefRender | undefined =
        brief && brief.accepted_at
          ? { content: brief.content, acceptedBy: brief.accepted_by, acceptedAt: brief.accepted_at, model: brief.model }
          : undefined;
      const html = renderReportHtml(model, evidence, briefRender); // carries the watermark when privileged
      await repo.logDisclosure({ org_id: audit.org_id, audit_id: audit.id, actor_id: session.user_id, action: 'export' });
      if (Platform.OS === 'web') {
        await Print.printAsync({ html }); // browser print → Save as PDF
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
        }
      }
    } finally {
      setExporting(false);
    }
  }

  // Privileged audits log every view for the disclosure trail (Part 1.5). Once.
  const logged = useRef(false);
  useEffect(() => {
    if (audit?.privileged && !logged.current) {
      logged.current = true;
      void repo.logDisclosure({
        org_id: audit.org_id,
        audit_id: audit.id,
        actor_id: session.user_id,
        action: 'view',
      });
    }
  }, [audit, repo, session.user_id]);

  const counts = FINDING_RATINGS.map((r) => ({
    rating: r as Rating,
    count: findings.filter((f) => f.rating === r).length,
  }));
  const sifCount = findings.filter((f) => f.sif_potential).length;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Findings' }} />
      {audit?.privileged ? <PrivilegeBanner attorney={audit.attorney_of_record} /> : null}

      <Card>
        <View style={styles.summaryHead}>
          <Title>Executive summary</Title>
          <Button label={exporting ? 'Exporting…' : 'Export PDF'} onPress={exportPdf} disabled={exporting} />
        </View>
        <View style={styles.counts}>
          {counts.map(({ rating, count }) => (
            <View key={rating} style={styles.countPill}>
              <View style={[styles.countDot, { backgroundColor: ratingColors[rating] }]} />
              <Text style={styles.countText}>
                {rating}: <Text style={styles.countNum}>{count}</Text>
              </Text>
            </View>
          ))}
        </View>
        {sifCount > 0 ? (
          <View style={styles.sifLine}>
            <SifBadge small />
            <Text style={styles.sifText}>{sifCount} finding{sifCount === 1 ? '' : 's'} flagged SIF-potential</Text>
          </View>
        ) : null}
      </Card>

      <Card>
        <View style={styles.summaryHead}>
          <Title>Legal brief</Title>
          <Button
            label={briefBusy ? 'Generating…' : brief ? 'Regenerate (AI draft)' : 'Generate (AI draft)'}
            icon="scale-balance"
            onPress={generateBrief}
            disabled={!aiOn || !canAuthor || briefBusy}
          />
        </View>
        <Body>
          A Certified Safety Professional and a legal-readiness reviewer draft a defensible
          narrative wrapping these findings — for your client&apos;s attorney to review. You edit
          and accept every section; ratings and scores stay yours, never AI-set.
        </Body>
        {briefBusy ? (
          <Text style={styles.progress}>
            {generating?.label} ({generating?.done}/{generating?.total})
          </Text>
        ) : null}
        {brief?.accepted_at ? (
          <Text style={styles.briefReady}>
            Accepted {new Date(brief.accepted_at).toLocaleString()} · included in the exported PDF.
          </Text>
        ) : null}
        {genError ? <Text style={styles.error}>{genError}</Text> : null}
        {!aiOn ? <Text style={styles.hint}>{aiHintText(aiGate)}</Text> : null}
        {aiOn && !canAuthor ? (
          <Text style={styles.hint}>Only a lead auditor or admin can generate the brief.</Text>
        ) : null}
      </Card>

      <Subtitle style={styles.heading}>
        {findings.length} finding{findings.length === 1 ? '' : 's'} · Very High → Low
      </Subtitle>

      {findings.length === 0 ? (
        <EmptyState
          icon="check-circle-outline"
          title="No findings yet"
          message="All clear so far — rate items Low or worse and they'll gather here for the report."
        />
      ) : null}

      {findings.map((f) => (
        <Card key={f.audit_item_id} accent={ratingColors[f.rating]}>
          <View style={styles.findingHead}>
            <Mono style={styles.code}>{f.item_code}</Mono>
            {f.sif_potential ? <SifBadge small /> : null}
            <Text style={[styles.ratingTag, { color: ratingColors[f.rating] }]}>{f.rating}</Text>
          </View>
          <Body>{f.requirement}</Body>
          <Mono style={styles.citation}>{f.citation}</Mono>
          {f.observations ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>Observations</Text>
              <Body>{f.observations}</Body>
            </View>
          ) : null}
          {f.recommendations ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>Recommendations</Text>
              <Body>{f.recommendations}</Body>
            </View>
          ) : null}
        </Card>
      ))}

      {draft ? (
        <BriefReviewSheet
          visible={reviewOpen}
          initial={draft.content}
          findingLabels={findingLabels}
          warnings={warnings}
          busy={accepting}
          onAccept={acceptBrief}
          onDiscard={() => {
            setReviewOpen(false);
            setDraft(null);
          }}
        />
      ) : null}
    </Screen>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
    counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    countPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surfaces.raised, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    countDot: { width: 8, height: 8, borderRadius: 4 },
    countText: { color: t.text.dim, fontSize: 12 },
    countNum: { color: t.text.primary, fontWeight: '800' },
    sifLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    sifText: { color: t.text.dim, fontSize: 12 },
    progress: { color: t.text.dim, fontSize: 12, marginTop: 6 },
    briefReady: { color: t.text.primary, fontSize: 12, marginTop: 6, fontWeight: '700' },
    error: { color: ratingColors['Very High'], fontSize: 12, marginTop: 6 },
    hint: { color: t.text.faint, fontSize: 12, marginTop: 6 },
    heading: { marginTop: 4 },
    empty: { color: t.text.dim },
    findingHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    code: { color: t.text.primary, fontSize: 15, fontWeight: '800' },
    ratingTag: { fontSize: 13, fontWeight: '800', marginLeft: 'auto' },
    citation: { color: t.text.dim, fontSize: 12 },
    block: { gap: 2, marginTop: 4 },
    blockLabel: { color: t.text.faint, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  });
