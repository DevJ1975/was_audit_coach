/**
 * Organization admin (tenant management). Reached from the account screen by
 * admins and lead auditors. Everything here is authorized SERVER-side: RLS on
 * org_invites/orgs/profiles and definer checks in set_member_role — the role
 * gates in this UI are convenience, not security (NN #5).
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { Text, TextInput } from 'react-native-paper';
import { Screen, Card, Button, Subtitle, Body, Mono } from '@/components/ui';
import { useAuth } from '@/auth/AuthProvider';
import { useOrgAdmin } from '@/hooks/useOrgAdmin';
import type { Role } from '@/db/types';
import { layout, type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';

const INVITE_ROLES: Role[] = ['auditor', 'lead_auditor', 'site_manager', 'counsel_viewer', 'admin'];
const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  lead_auditor: 'Lead auditor',
  auditor: 'Auditor',
  site_manager: 'Site manager',
  counsel_viewer: 'Counsel viewer',
};

function RoleChips({
  value,
  onChange,
  disabled,
}: {
  value: Role;
  onChange: (r: Role) => void;
  disabled?: boolean;
}): React.ReactElement {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.chips}>
      {INVITE_ROLES.map((r) => (
        <Text
          key={r}
          onPress={disabled || r === value ? undefined : () => onChange(r)}
          style={[styles.chip, r === value && styles.chipOn, disabled && styles.chipDisabled]}
          accessibilityRole="button"
          accessibilityState={{ selected: r === value, disabled: !!disabled }}
          suppressHighlighting
        >
          {ROLE_LABEL[r]}
        </Text>
      ))}
    </View>
  );
}

export default function AdminScreen(): React.ReactElement {
  const { identity, session } = useAuth();
  const admin = useOrgAdmin();
  const styles = useThemedStyles(makeStyles);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('auditor');
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [roleEditing, setRoleEditing] = useState<string | null>(null);

  if (!session || !admin.canInvite) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Organization' }} />
        <Card>
          <Subtitle>Organization</Subtitle>
          <Body>
            {session
              ? 'Organization settings are available to admins and lead auditors.'
              : 'Sign in to manage your organization.'}
          </Body>
        </Card>
      </Screen>
    );
  }

  async function sendInvite(): Promise<void> {
    if (await admin.invite(inviteEmail, inviteRole)) {
      setInviteEmail('');
      setInviteRole('auditor');
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Organization' }} />

      <Card>
        <Subtitle>Organization</Subtitle>
        {admin.isAdmin ? (
          <>
            <TextInput
              mode="outlined"
              label="Organization name"
              value={nameDraft ?? admin.orgName}
              onChangeText={setNameDraft}
              style={styles.input}
            />
            {nameDraft !== null && nameDraft.trim() && nameDraft !== admin.orgName ? (
              <Button
                label={admin.busy ? 'Saving…' : 'Save name'}
                onPress={() => void admin.renameOrg(nameDraft).then(() => setNameDraft(null))}
                disabled={admin.busy}
              />
            ) : null}
          </>
        ) : (
          <Body>{admin.orgName}</Body>
        )}
        <Mono style={styles.orgId}>Tenant id: {identity.org_id}</Mono>
      </Card>

      <Card>
        <Subtitle>Invite a teammate</Subtitle>
        <Body>
          They sign up with this email at the same address you use, and land in your
          organization with the role you pick — no manual setup.
        </Body>
        <TextInput
          mode="outlined"
          label="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={inviteEmail}
          onChangeText={setInviteEmail}
          style={styles.input}
        />
        <RoleChips value={inviteRole} onChange={setInviteRole} disabled={admin.busy} />
        <Button
          label={admin.busy ? 'Working…' : 'Send invite'}
          onPress={() => void sendInvite()}
          disabled={admin.busy || !inviteEmail.trim().includes('@')}
        />
      </Card>

      {admin.invites.length > 0 ? (
        <Card>
          <Subtitle>Pending invites ({admin.invites.length})</Subtitle>
          {admin.invites.map((inv) => (
            <View key={inv.id} style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.email}>{inv.email}</Text>
                <Text style={styles.meta}>{ROLE_LABEL[inv.role]}</Text>
              </View>
              <Button label="Revoke" variant="ghost" onPress={() => void admin.revokeInvite(inv.id)} disabled={admin.busy} />
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <Subtitle>Members ({admin.members.length})</Subtitle>
        {admin.members.map((m) => {
          const isSelf = m.id === session.user.id;
          return (
            <View key={m.id} style={styles.memberRow}>
              <View style={styles.row}>
                <View style={styles.rowBody}>
                  <Text style={styles.email}>
                    {m.email ?? m.id.slice(0, 8)}
                    {isSelf ? '  (you)' : ''}
                  </Text>
                  <Text style={styles.meta}>{ROLE_LABEL[m.role]}</Text>
                </View>
                {admin.isAdmin && !isSelf ? (
                  <Button
                    label={roleEditing === m.id ? 'Close' : 'Change role'}
                    variant="ghost"
                    onPress={() => setRoleEditing(roleEditing === m.id ? null : m.id)}
                    disabled={admin.busy}
                  />
                ) : null}
              </View>
              {roleEditing === m.id ? (
                <RoleChips
                  value={m.role}
                  onChange={(r) => {
                    setRoleEditing(null);
                    void admin.setRole(m.id, r);
                  }}
                  disabled={admin.busy}
                />
              ) : null}
            </View>
          );
        })}
        <Text style={styles.note}>
          Role changes apply the next time that person's session refreshes (within an hour, or at
          their next sign-in).
        </Text>
      </Card>

      {admin.error ? <Text style={styles.error}>{admin.error}</Text> : null}
    </Screen>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    input: { backgroundColor: 'transparent' },
    orgId: { color: t.text.faint, fontSize: 11, marginTop: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
    chip: {
      color: t.text.dim,
      backgroundColor: t.surfaces.raised,
      borderRadius: layout.radius,
      borderWidth: 1,
      borderColor: t.surfaces.line,
      paddingHorizontal: 14,
      paddingVertical: 14, // ≥48pt with the label line (NN #10)
      fontSize: 13,
      fontWeight: '700',
      overflow: 'hidden',
    },
    chipOn: { color: t.brand.onAccent, backgroundColor: t.brand.accent, borderColor: t.brand.accent },
    chipDisabled: { opacity: 0.5 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowBody: { flex: 1, gap: 2, paddingVertical: 6 },
    memberRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.surfaces.line, paddingTop: 4, marginTop: 4 },
    email: { color: t.text.primary, fontSize: 14, fontWeight: '600' },
    meta: { color: t.text.dim, fontSize: 12 },
    note: { color: t.text.faint, fontSize: 11, marginTop: 8 },
    error: { color: t.semantic.warn, fontSize: 13 },
  });
