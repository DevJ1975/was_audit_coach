/**
 * Section screen — the audit loop's working surface. Every applicable item is an
 * inline ChecklistItem whose RatingSelector is right there (NN #2): the auditor
 * rates straight down the list, no drilling in. A completion ProgressBar +
 * "Section X of Y" overline give a sense of place; a single contextual CoachTip
 * nudges (never scolds). Observations/evidence are one tap away per item.
 * Fully offline — every rating hits local SQLite instantly, then the score
 * recomputes on reload.
 */
import React from 'react';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Screen, Card, Button, Overline, SectionTitle } from '@/components/ui';
import { ScoreReadout } from '@/components/ScoreReadout';
import { ProgressBar } from '@/components/ProgressBar';
import { CoachTip } from '@/components/CoachTip';
import { ChecklistItem } from '@/components/ChecklistItem';
import { useAuditData } from '@/hooks/useAudit';
import { useRepo, useSession } from '@/db/RepoProvider';
import { compareByCode } from '@/domain/ordering';
import { sectionNames, sectionOrder, libraryItem } from '@/seed';
import type { Rating } from '@soteria/scoring-engine';

export default function ItemListScreen(): React.ReactElement {
  const { auditId, code } = useLocalSearchParams<{ auditId: string; code: string }>();
  const router = useRouter();
  const repo = useRepo();
  const session = useSession();
  const { items, score, reload } = useAuditData(auditId);

  const sectionItems = items
    .filter((it) => it.section_code === code && it.applicable)
    .sort(compareByCode);
  const s = score.sections[code];

  // "Section X of Y" among the audit's active sections (scoping-driven order).
  const activeSections = sectionOrder.filter((c) => score.sections[c]);
  const posIdx = activeSections.indexOf(code);

  const completion = s && s.itemCount > 0 ? (s.ratedCount / s.itemCount) * 100 : 0;
  const done = !!s && s.itemCount > 0 && s.ratedCount === s.itemCount;
  const highCount = sectionItems.filter((it) => it.rating === 'High' || it.rating === 'Very High').length;

  async function onRate(itemId: string, rating: Rating): Promise<void> {
    await repo.setRating(itemId, rating, session.user_id);
    reload();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: `${code} · ${sectionNames[code] ?? ''}`.trim() }} />

      {s ? (
        <Card>
          {posIdx >= 0 ? <Overline>{`Section ${posIdx + 1} of ${activeSections.length}`}</Overline> : null}
          <SectionTitle>{sectionNames[code] ?? code}</SectionTitle>
          <ScoreReadout
            rawScore={s.rawScore}
            effectiveMax={s.effectiveMax}
            percent={s.percent}
            tier={s.tier}
            ratedCount={s.ratedCount}
            itemCount={s.itemCount}
          />
          <ProgressBar percent={completion} />
          {/* Audit Coach — technique mentor for working this checklist section. */}
          <Button
            label="Coach: how to audit this section"
            variant="ghost"
            onPress={() => router.push({ pathname: `/audit/${auditId}/coach`, params: { section: code } })}
          />
        </Card>
      ) : null}

      {done ? (
        <CoachTip title="Section complete">
          Every item here is rated — nice work. Review your findings or move on to the next section.
        </CoachTip>
      ) : highCount > 0 ? (
        <CoachTip title="Back up your findings">
          You&rsquo;ve flagged {highCount} higher-risk item{highCount === 1 ? '' : 's'} here. A quick photo on
          each makes the finding stick when it counts.
        </CoachTip>
      ) : null}

      {sectionItems.map((it, i) => {
        const lib = libraryItem(it.item_code);
        return (
          <ChecklistItem
            key={it.id}
            index={i + 1}
            code={it.item_code}
            requirement={lib?.requirement ?? '—'}
            sif={lib?.sif_potential}
            rating={it.rating}
            hasObservations={!!it.observations?.trim()}
            needsResolution={it.sync_state === 'needs_resolution'}
            onRate={(r) => void onRate(it.id, r)}
            onOpen={() => router.push(`/audit/${auditId}/item/${it.id}`)}
          />
        );
      })}
    </Screen>
  );
}
