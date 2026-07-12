/**
 * Change password — for a signed-in account. Supabase updates the password on
 * the active session (no email round-trip), so it works the moment you're in.
 * Field mode has no account, so this screen only acts when a session exists.
 */
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { HelperText, TextInput, Text } from 'react-native-paper';
import { Screen, Card, Button, Title, Subtitle, Body } from '@/components/ui';
import { useAuth } from '@/auth/AuthProvider';
import { type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';

const MIN_LEN = 6;

export default function ChangePasswordScreen(): React.ReactElement {
  const router = useRouter();
  const { session, changePassword, backendConfigured } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // Not signed in — there is no account password to change (field mode).
  if (!session) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Change password' }} />
        <Card>
          <Subtitle>Change password</Subtitle>
          <Body>Sign in first — a password belongs to your account.</Body>
          <Button label="Back" variant="ghost" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  const tooShort = next.length > 0 && next.length < MIN_LEN;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = !busy && backendConfigured && next.length >= MIN_LEN && confirm === next;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const { error } = await changePassword(next);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    setNext('');
    setConfirm('');
    setDone(true);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Change password' }} />
      <Card>
        <Title>Change password</Title>
        <Subtitle>Signed in as {session.user.email}</Subtitle>

        {done ? (
          <>
            <Text style={styles.success}>
              Password updated. Use your new password the next time you sign in.
            </Text>
            <Button label="Done" onPress={() => router.back()} />
          </>
        ) : (
          <>
            <TextInput
              mode="outlined"
              label="New password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              value={next}
              onChangeText={(t) => {
                setNext(t);
                setError(null);
              }}
              style={styles.input}
            />
            <TextInput
              mode="outlined"
              label="Confirm new password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              value={confirm}
              onChangeText={setConfirm}
              style={styles.input}
            />
            {tooShort ? (
              <HelperText type="error" visible>
                Use at least {MIN_LEN} characters.
              </HelperText>
            ) : null}
            {mismatch ? (
              <HelperText type="error" visible>
                The two passwords don&apos;t match.
              </HelperText>
            ) : null}
            {!backendConfigured ? (
              <HelperText type="info" visible>
                Backend not configured on this build — password changes are unavailable in local
                field mode.
              </HelperText>
            ) : null}
            {error ? (
              <HelperText type="error" visible>
                {error}
              </HelperText>
            ) : null}
            <Button
              label={busy ? 'Updating…' : 'Update password'}
              onPress={() => void submit()}
              disabled={!canSubmit}
            />
            <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
          </>
        )}
      </Card>
    </Screen>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    input: { backgroundColor: 'transparent' },
    success: { color: t.semantic.success, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  });
