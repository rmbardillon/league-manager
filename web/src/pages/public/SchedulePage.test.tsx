import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { SchedulePage } from './SchedulePage.js';
import type { SchedulePayload } from '../../api/index.js';

/** JSON Response helper. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Route fetch by URL so the PublicSeasonSelect's `/public/seasons` load and the
 * page's `/public/seasons/:id/schedule` load can be stubbed independently.
 */
function stubFetch(schedule: SchedulePayload): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/schedule')) {
        return jsonResponse(schedule, 200);
      }
      // Public Season Selector list.
      return jsonResponse({ seasons: [{ id: 's1', name: 'Season One', closed: false }] }, 200);
    }),
  );
}

function renderPage(path: string): void {
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[path]}>
        <SchedulePage />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('SchedulePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prompts to select a Season when none is selected', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ seasons: [{ id: 's1', name: 'Season One', closed: false }] }, 200),
      ),
    );
    renderPage('/schedule');
    expect(screen.getByText(/select a season/i)).toBeInTheDocument();
  });

  it('renders scheduled Games from the API in a table', async () => {
    const payload: SchedulePayload = {
      seasonId: 's1',
      games: [
        {
          gameId: 'g1',
          date: '2025-01-10',
          startTime: '18:30',
          venue: 'Main Arena',
          homeTeamId: 'h',
          homeTeamName: 'Hawks',
          awayTeamId: 'a',
          awayTeamName: 'Bulls',
        },
      ],
    };
    stubFetch(payload);

    renderPage('/schedule?season=s1');

    expect(await screen.findByText('Hawks')).toBeInTheDocument();
    expect(screen.getByText('Bulls')).toBeInTheDocument();
    expect(screen.getByText('Main Arena')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('shows an informational message when the schedule is empty', async () => {
    const payload: SchedulePayload = {
      seasonId: 's1',
      games: [],
      message: 'No Games are scheduled for this Season.',
    };
    stubFetch(payload);

    renderPage('/schedule?season=s1');

    expect(await screen.findByText(/no games are scheduled/i)).toBeInTheDocument();
  });
});
