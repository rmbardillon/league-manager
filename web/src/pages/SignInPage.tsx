/**
 * Sign-in page (Req 1.1, 1.3, 1.4).
 *
 * A labeled, keyboard-operable credential form. On success it stores the
 * principal (via the auth context) and redirects to the originally requested
 * management route (or the management home). Failures render the backend's
 * message inline as an assertive alert — the message stays generic for bad
 * credentials so which field was wrong is not disclosed (Req 1.3), while a
 * missing-field error names the field (Req 1.4). Client-side required-field
 * checks give immediate feedback before a request is sent.
 */
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { ApiError } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.js';
import { ErrorMessage } from '../components/Feedback.js';

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
    <section aria-labelledby="signin-heading">
      <h2 id="signin-heading">Sign in</h2>
      <form onSubmit={handleSubmit} noValidate>
        {error && <ErrorMessage>{error}</ErrorMessage>}

        <div className="field">
          <label htmlFor="signin-username">Username</label>
          <input
            id="signin-username"
            name="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            aria-required="true"
          />
        </div>

        <div className="field">
          <label htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            aria-required="true"
          />
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  );
}
