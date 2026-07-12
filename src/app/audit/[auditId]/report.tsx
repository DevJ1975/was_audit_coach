import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Text } from 'react-native-paper';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Screen, Card, Button, Title, Subtitle, Body, Mono } from '@/components/ui';
import { SifBadge, PrivilegeBanner } from '@/components/badges';
import { useAuditData } from '@/hooks/useAudit';
import { useRepo, useSession } from '@/db/RepoProvider';
import { buildReportModel, renderReportHtml, type ReportEvidence } from '@/domain/report';
import { readAsDataUri } from '@/attachments/capture';
import { libraryByCode, sectionNames } from '@/seed';
import { FINDING_RATINGS, type Rating } from '@soteria/scoring-engine';
import { ratingColors, type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';

export default function ReportScreen(): React.ReactElement {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const { audit, items, findings } = useAuditData(auditId);
  const repo = useRepo();
  const session = useSession();
  const styles = useThemedStyles(makeStyles);
  const [exporting, setExporting] = useState(false);

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
      const html = renderReportHtml(model, evidence); // carries the watermark when privileged
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

      <Subtitle style={styles.heading}>
        {findings.length} finding{findings.length === 1 ? '' : 's'} · Very High → Low
      </Subtitle>

      {findings.length === 0 ? (
        <Text style={styles.empty}>No findings yet — rate items Low or worse to populate this list.</Text>
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
    heading: { marginTop: 4 },
    empty: { color: t.text.dim },
    findingHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    code: { color: t.text.primary, fontSize: 15, fontWeight: '800' },
    ratingTag: { fontSize: 13, fontWeight: '800', marginLeft: 'auto' },
    citation: { color: t.text.dim, fontSize: 12 },
    block: { gap: 2, marginTop: 4 },
    blockLabel: { color: t.text.faint, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  });
