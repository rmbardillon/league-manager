/**
 * Management dashboard.
 *
 * Greets the signed-in principal and surfaces the management tasks available to
 * their role as a grid of cards. Team/Season/Tournament/Playoff administration
 * is Administrator-only (Req 2.4, 3.1, 8.1, 9.1); roster management is open to
 * Administrators and Team_Managers (Req 4.1, 4.4).
 */
import { Link } from 'react-router-dom';
import { Badge, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useAuth } from '../../auth/AuthContext.js';
import classes from './ManageHome.module.css';

interface Task {
  to: string;
  label: string;
  blurb: string;
  adminOnly: boolean;
}

const TASKS: Task[] = [
  { to: '/manage/seasons', label: 'Seasons', blurb: 'Create seasons and close them with final standings.', adminOnly: true },
  { to: '/manage/teams', label: 'Teams', blurb: 'Create, rename, and remove teams in a season.', adminOnly: true },
  { to: '/manage/players', label: 'Players', blurb: 'The master player registry: register, rename, and remove players.', adminOnly: true },
  { to: '/manage/roster', label: 'Roster', blurb: 'Assign players to a team and manage jersey numbers.', adminOnly: false },
  { to: '/manage/games', label: 'Games', blurb: 'Schedule games, record scores, reschedule, and cancel.', adminOnly: true },
  { to: '/manage/schedule', label: 'Schedule', blurb: 'Auto-generate a round-robin draft, assign venues, and submit.', adminOnly: true },
  { to: '/manage/statistics', label: 'Statistics', blurb: 'Record player statistics and view season totals.', adminOnly: true },
  { to: '/manage/awards', label: 'Awards', blurb: 'Compute, review, and publish season awards.', adminOnly: true },
  { to: '/manage/tournaments', label: 'Tournaments', blurb: 'Define tournament formats for a season.', adminOnly: true },
  { to: '/manage/playoffs', label: 'Playoffs', blurb: 'Build rounds, series, and playoff games.', adminOnly: true },
  { to: '/manage/batch-upload', label: 'Batch Upload', blurb: 'Import teams and players for a season from a CSV or Excel file.', adminOnly: true },
];

export function ManageHome(): JSX.Element {
  const { user, isAdmin } = useAuth();
  const tasks = TASKS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <section aria-labelledby="manage-heading">
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={2} id="manage-heading" className={classes.title}>
            Management
          </Title>
          <Group gap="xs">
            <Text c="dimmed">Signed in as</Text>
            <Text fw={700}>{user?.username}</Text>
            <Badge variant="light" color={user?.role ? 'nba-blue' : 'gray'} radius="sm">
              {user?.role ?? 'No role assigned'}
            </Badge>
          </Group>
        </Stack>

        <nav aria-label="Management tasks">
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
            {tasks.map((task) => (
              <Card
                key={task.to}
                component={Link}
                to={task.to}
                withBorder
                radius="md"
                padding="lg"
                className={classes.card}
              >
                <Stack gap={6}>
                  <Text className={classes.cardLabel}>{task.label}</Text>
                  <Text size="sm" c="dimmed">
                    {task.blurb}
                  </Text>
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        </nav>
      </Stack>
    </section>
  );
}
