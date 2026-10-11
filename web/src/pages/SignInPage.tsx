/**
 * Sign-in page (Req 1.1, 1.3, 1.4).
 *
 * A labeled, keyboard-operable credential form in a centered card. On success
 * it stores the principal (via the auth context) and redirects to the
 * originally requested management route (or the management home). Failures
 * render the backend's message inline as an assertive alert — the message
 * stays generic for bad credentials so which field was wrong is not disclosed
 * (Req 1.3), while a missing-field error names the field (Req 1.4). Client-side
 * required-field checks give immediate feedback before a request is sent.
 */
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Center,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { ApiError } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.js';

/** Shape of the router state we set when redirecting to sign-in. */
interface FromState {
  from?: string;
}

export function SignInPage(): JSX.Element {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as Location & { state: FromState | null };

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = location.state?.from ?? '/manage';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    // Client-side required-field guard mirrors Req 1.4's field-naming intent.
    if (username.trim() === '' || password === '') {
      setError('Both username and password are required.');
      return;
    }

    setSubmitting(true);
    try {
      await signIn(username.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Sign-in failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Center mih="60vh">
      <Card withBorder radius="md" padding="xl" w="100%" maw={420}>
        <section aria-labelledby="signin-heading">
          <form onSubmit={handleSubmit} noValidate>
            <Stack gap="md">
              <Title order={2} id="signin-heading">
                Sign in
              </Title>

              {error && (
                <Alert role="alert" color="nba-red" variant="light">
                  {error}
                </Alert>
              )}

              <TextInput
                id="signin-username"
                name="username"
                label="Username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.currentTarget.value)}
                required
              />

              <PasswordInput
                id="signin-password"
                name="password"
                label="Password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                required
              />

              <Button type="submit" loading={submitting} fullWidth>
                Sign in
              </Button>
            </Stack>
          </form>
        </section>
      </Card>
    </Center>
  );
}
