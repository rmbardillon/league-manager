import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { SignInPage } from './SignInPage.js';
import { AuthProvider } from '../auth/AuthContext.js';
import type { AuthUser } from '../api/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Render the sign-in page inside auth + router, with a target for redirects. */
function renderSignIn(): void {
  render(
    <MantineProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={['/signin']}>
          <Routes>
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/manage" element={<h2>Management</h2>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </MantineProvider>,
  );
}

describe('SignInPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders labeled, required username and password fields', async () => {
    // The initial GET /auth/me during AuthProvider mount resolves as anonymous.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { category: 'AuthenticationError', message: 'nope' } }, 401),
      ),
    );
    renderSignIn();
    const username = await screen.findByLabelText(/username/i);
    const password = screen.getByLabelText(/password/i);
    expect(username).toBeRequired();
    expect(password).toBeRequired();
  });

  it('blocks submission and shows an error when fields are empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { category: 'AuthenticationError', message: 'nope' } }, 401),
      ),
    );
    renderSignIn();
    fireEvent.click(await screen.findByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/required/i);
  });

  it('signs in and redirects to management on valid credentials (Req 1.1)', async () => {
    const principal: AuthUser = {
      userId: 'u1',
      username: 'admin',
      role: 'Administrator',
      managedTeamIds: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) {
        return jsonResponse({ error: { category: 'AuthenticationError', message: 'x' } }, 401);
      }
      // POST /auth/signin
      return jsonResponse(principal, 200);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderSignIn();
    fireEvent.change(await screen.findByLabelText(/username/i), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /management/i })).toBeInTheDocument(),
    );
  });
});
