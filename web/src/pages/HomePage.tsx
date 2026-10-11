/**
 * Landing page — an NBA.com-style hero band over quick links into the public
 * browsing views, plus a management call-to-action.
 */
import { Link } from 'react-router-dom';
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import classes from './HomePage.module.css';

interface Tile {
  to: string;
  label: string;
  blurb: string;
}

const TILES: Tile[] = [
  { to: '/schedule', label: 'Schedule', blurb: 'Upcoming games by date and venue.' },
  { to: '/results', label: 'Results', blurb: 'Final scores from completed games.' },
  { to: '/standings', label: 'Standings', blurb: 'Live and final team rankings.' },
  { to: '/awards', label: 'Awards', blurb: 'Published honors and all-league teams.' },
];

export function HomePage(): JSX.Element {
  return (
    <section aria-labelledby="home-heading">
      <Stack gap="xl">
        <Box className={classes.hero}>
          <Stack gap="md" className={classes.heroInner}>
            <Badge size="lg" radius="sm" variant="filled" color="nba-red">
              League Portal
            </Badge>
            <Title order={2} id="home-heading" className={classes.heroTitle}>
              Follow every game, team, and award.
            </Title>
            <Text size="lg" className={classes.heroText}>
              Browse the league without signing in, or sign in to manage teams
              and rosters.
            </Text>
            <Group gap="sm">
              <Button component={Link} to="/schedule" size="md">
                View schedule
              </Button>
              <Button component={Link} to="/standings" size="md" variant="white">
                See standings
              </Button>
            </Group>
          </Stack>
        </Box>

        <Stack gap="sm">
          <Text className={classes.sectionLabel}>Browse the league</Text>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
            {TILES.map((tile) => (
              <Card
                key={tile.to}
                component={Link}
                to={tile.to}
                withBorder
                padding="lg"
                radius="md"
                className={classes.tile}
              >
                <Stack gap={6}>
                  <Text className={classes.tileLabel}>{tile.label}</Text>
                  <Text size="sm" c="dimmed">
                    {tile.blurb}
                  </Text>
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        </Stack>
      </Stack>
    </section>
  );
}
