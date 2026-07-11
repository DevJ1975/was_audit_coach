import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Banner, HelperText, TextInput, Text } from 'react-native-paper';
import { Screen, Card, Button, Title, Subtitle } from '@/components/ui';
import { BrandLogo } from '@/components/branding';
import { useAuth } from '@/auth/AuthProvider';
import { text as textTokens, semantic } from '@/theme/tokens';

export default function LoginScreen(): React.ReactElement {
  const router = useRouter();
  const { signIn, signOut, backendConfigured, mode, session, identity, claimsOk } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) setError(error);
    else router.back();
  }

  async function doSignOut(): Promise<void> {
    setBusy(true);
    await signOut();
    setBusy(false);
  }

  // Signed in — show who, surface a provisioning problem, offer sign-out
  // (shared field tablets need a way to hand the device over).
  if (session) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Account' }} />
        <View style={styles.logoWrap}>
          <BrandLogo height={48} />
        </View>
        <Card>
          <Title>Signed in</Title>
          <Text style={styles.who}>{session.user.email}</Text>
          <Text style={styles.meta}>
            Org: {identity.org_id} · Role: {identity.role.replace('_', ' ')}
          </Text>
          {!claimsOk ? (
            <Text style={styles.claimWarn}>
              This account has no org assigned (missing org_id claim), so nothing can sync to the
              server. Ask your admin to provision the account, then sign out and back in.
            </Text>
          ) : null}
          <Button
            label={busy ? 'Signing out…' : 'Sign out'}
            variant="secondary"
            onPress={() => void doSignOut()}
            disabled={busy}
          />
        </Card>
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Sign in' }} />
      <View style={styles.logoWrap}>
        <BrandLogo height={48} />
      </View>

      <Card>
        <Title>Sign in</Title>
        <Subtitle>Syncs your audits across devices. Signing in is optional — you can keep working offline.</Subtitle>

        {!backendConfigured ? (
          <Banner visible elevation={1} style={styles.notice}>
            Backend not configured on this build. The app runs in local field mode.
          </Banner>
        ) : null}

        <TextInput
          mode="outlined"
          label="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
        />
        <TextInput
          mode="outlined"
          label="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          style={styles.input}
        />
        {error ? (
          <HelperText type="error" visible>
            {error}
          </HelperText>
        ) : null}
        <Button
          label={busy ? 'Signing in…' : 'Sign in'}
          onPress={submit}
          disabled={busy || !backendConfigured || !email || !password}
        />
      </Card>

      <Button label="Continue offline (field mode)" variant="ghost" onPress={() => router.back()} />
      <Text style={styles.mode}>Current mode: {mode}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logoWrap: { alignItems: 'center', paddingVertical: 8 },
  notice: { borderRadius: 8 },
  input: { backgroundColor: 'transparent' },
  mode: { color: textTokens.faint, fontSize: 12, textAlign: 'center' },
  who: { color: textTokens.primary, fontSize: 16, fontWeight: '600' },
  meta: { color: textTokens.dim, fontSize: 13 },
  claimWarn: { color: semantic.warn, fontSize: 13, lineHeight: 18 },
});
