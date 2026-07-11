import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Banner, Text } from 'react-native-paper';
import { Screen, Row, Button, Title, Subtitle, Mono } from '@/components/ui';
import { SifBadge } from '@/components/badges';
import { useAudits } from '@/hooks/useAudit';
import { IS_PLACEHOLDER } from '@/seed';
import { text as textTokens, brand } from '@/theme/tokens';

export default function AuditListScreen(): React.ReactElement {
  const router = useRouter();
  const { audits, loading } = useAudits();

  return (
    <Screen>
      <View style={styles.header}>
        <Title>Audits</Title>
        <Button label="+ New Audit" onPress={() => router.push('/audit/new')} />
      </View>

      {IS_PLACEHOLDER ? (
        <Banner visible elevation={1} style={styles.notice} contentStyle={styles.noticeContent}>
          <Text style={styles.noticeText}>
            Placeholder library in use — run <Text style={styles.mono}>npm run etl</Text> with the
            workbook to load the real 374-item library.
          </Text>
        </Banner>
      ) : null}

      {loading ? (
        <ActivityIndicator animating color={brand.default} style={styles.loading} />
      ) : null}

      {!loading && audits.length === 0 ? (
        <View style={styles.empty}>
          <Subtitle>No audits yet</Subtitle>
          <Text style={styles.emptyBody}>
            Start a new audit — it works fully offline. Everything is saved on this device.
          </Text>
        </View>
      ) : null}

      {audits.map((a) => (
        <Row key={a.id} onPress={() => router.push(`/audit/${a.id}`)}>
          <View style={styles.rowBody}>
            <View style={styles.rowTop}>
              <Text style={styles.auditTitle} numberOfLines={1}>
                {a.title}
              </Text>
              {a.privileged ? <SifBadge small /> : null}
            </View>
            <View style={styles.rowMeta}>
              <Mono style={styles.meta}>{a.status}</Mono>
              {a.state_plan ? <Mono style={styles.meta}>· {a.state_plan}</Mono> : null}
              <Mono style={styles.meta}>· {new Date(a.created_at).toLocaleDateString()}</Mono>
            </View>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Row>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  notice: { backgroundColor: '#2A2416', borderColor: '#E7C33B', borderWidth: 1, borderRadius: 8 },
  noticeContent: { paddingVertical: 4 },
  noticeText: { color: '#E7C33B', fontSize: 12 },
  mono: { fontFamily: 'monospace' },
  loading: { paddingVertical: 24 },
  empty: { padding: 24, alignItems: 'center', gap: 8 },
  emptyBody: { color: textTokens.dim, textAlign: 'center', fontSize: 14 },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  auditTitle: { color: textTokens.primary, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  rowMeta: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  meta: { color: textTokens.dim, fontSize: 12 },
  chevron: { color: textTokens.faint, fontSize: 24, fontWeight: '300' },
});
