import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('SchedulePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prompts for a Season ID when none is selected', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(
      <MemoryRouter initialEntries={['/schedule']}>
        <SchedulePage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/enter a season id/i)).toBeInTheDocument();
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(payload, 200)),
    );

    render(
      <MemoryRouter initialEntries={['/schedule?season=s1']}>
        <SchedulePage />
      </MemoryRouter>,
    );

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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(payload, 200)),
    );

    render(
      <MemoryRouter initialEntries={['/schedule?season=s1']}>
        <SchedulePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/no games are scheduled/i)).toBeInTheDocument();
  });
});
