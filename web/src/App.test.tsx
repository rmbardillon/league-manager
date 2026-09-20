import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { App } from './App.js';

describe('App', () => {
  beforeEach(() => {
    // App mounts AuthProvider, which calls GET /auth/me on load. Stub fetch to
    // resolve as "anonymous" (401) so the tree renders without a real network.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { category: 'AuthenticationError', message: 'Not signed in.' },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the application heading', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: /basketball league management/i }),
    ).toBeInTheDocument();
  });

  it('shows public navigation and a sign-in link when anonymous', () => {
    render(<App />);
    const primaryNav = screen.getByRole('navigation', { name: /primary/i });
    expect(within(primaryNav).getByRole('link', { name: /schedule/i })).toBeInTheDocument();
    // The sign-in link lives in the auth controls (unique across the page).
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument();
  });
});
