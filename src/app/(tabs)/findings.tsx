/**
 * Findings — a CROSS-AUDIT queue (the manager's actual job: "what's open across
 * all my sites?"). Loads every audit's items from local SQLite and derives
 * findings; sorted Very High → Low. Fully offline. Rating/tier colors constant.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native-paper';
import { Screen, SectionTitle } from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';
import { FindingCard } from '@/components/FindingCard';
import { useRepo, useSession } from '@/db/RepoProvider';
import { libraryByCode } from '@/seed';
import { deriveFindings } from '@/domain/audit';
import { FINDING_RATINGS } from '@soteria/scoring-engine';
import type { Rating } from '@soteria/scoring-engine';
import { type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';

interface CrossFinding {
  audit_item_id: string;
  item_code: string;
  rating: Rating;
  requirement: string;
  sif_potential?: boolean;
  auditId: string;
  auditTitle: string;
}

const severity = (r: Rating): number => {
  const i = (FINDING_RATINGS as readonly Rating[]).indexOf(r);
  return i === -1 ? 99 : i;
};

export default function FindingsScreen(): React.ReactElement {
  const repo = useRepo();
  const session = useSession();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { palette } = useTheme();
  const [findings, setFindings] = useState<CrossFinding[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const audits = await repo.listAudits(session.org_id);
    const all: CrossFinding[] = [];
    for (const a of audits) {
      const items = await repo.getAuditItems(a.id);
      for (const f of deriveFindings(items, libraryByCode)) {
        all.push({
          audit_item_id: f.audit_item_id,
          item_code: f.item_code,
          rating: f.rating,
          requirement: f.requirement,
          sif_potential: f.sif_potential,
          auditId: a.id,
          auditTitle: a.title,
        });
      }
    }
    all.sort((x, y) => severity(x.rating) - severity(y.rating));
    setFindings(all);
    setLoading(false);
  }, [repo, session.org_id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen>
      {loading ? <ActivityIndicator animating color={palette.brand.accent} style={styles.loading} /> : null}

      {!loading && findings.length === 0 ? (
        <EmptyState
          icon="check-circle-outline"
          title="All caught up"
          message="No open findings across your audits. Nice work keeping things tight."
        />
      ) : null}

      {!loading && findings.length > 0 ? (
        <SectionTitle>
          {findings.length} finding{findings.length === 1 ? '' : 's'} across your audits
        </SectionTitle>
      ) : null}

      {findings.map((f) => (
        <FindingCard
          key={`${f.auditId}:${f.audit_item_id}`}
          finding={f}
          auditTitle={f.auditTitle}
          onPress={() => router.push(`/audit/${f.auditId}/item/${f.audit_item_id}`)}
        />
      ))}
    </Screen>
  );
}

const makeStyles = (_t: Palette) =>
  StyleSheet.create({
    loading: { paddingVertical: 32 },
  });
