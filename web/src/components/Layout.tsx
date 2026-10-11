/**
 * Application shell: skip link, sticky NBA.com-style header with the league
 * wordmark + horizontal nav + color-scheme toggle, and the main content region.
 *
 * Accessibility notes:
 *   - A "skip to main content" link is the first focusable element so keyboard
 *     users can bypass the navigation.
 *   - Primary navigation is a labeled `<nav>` of `NavLink`s; the active link is
 *     marked with `aria-current="page"` by react-router and highlighted.
 *   - The routed content renders inside a `<main id="main-content">` landmark.
 *   - The auth controls show a sign-in link when anonymous and the username
 *     plus a sign-out button when signed in.
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ActionIcon,
  Box,
  Button,
  Container,
  Group,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useAuth } from '../auth/AuthContext.js';
import classes from './Layout.module.css';

/** NavLink className callback: mark the active route for styling + a11y. */
function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? `${classes.navLink} ${classes.navLinkActive}` : classes.navLink;
}

/** The primary public + management navigation targets. */
interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const PUBLIC_LINKS: NavItem[] = [
  { to: '/', label: 'Home', end: true },
  { to: '/schedule', label: 'Schedule' },
  { to: '/results', label: 'Results' },
  { to: '/standings', label: 'Standings' },
  { to: '/awards', label: 'Awards' },
];

const ADMIN_LINKS: NavItem[] = [
  { to: '/manage/seasons', label: 'Seasons' },
  { to: '/manage/teams', label: 'Teams' },
  { to: '/manage/players', label: 'Players' },
  { to: '/manage/roster', label: 'Roster' },
  { to: '/manage/games', label: 'Games' },
  { to: '/manage/schedule', label: 'Schedule' },
  { to: '/manage/statistics', label: 'Statistics' },
  { to: '/manage/awards', label: 'Awards' },
  { to: '/manage/tournaments', label: 'Tournaments' },
  { to: '/manage/playoffs', label: 'Playoffs' },
  { to: '/manage/batch-upload', label: 'Batch Upload' },
];

/** A single sun/moon toggle for the light/dark color scheme. */
function ColorSchemeToggle(): JSX.Element {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('dark', { getInitialValueInEffect: true });
  const next = computed === 'dark' ? 'light' : 'dark';

  return (
    <Tooltip label={`Switch to ${next} mode`}>
      <ActionIcon
        variant="default"
        size="lg"
        aria-label={`Switch to ${next} mode`}
        onClick={() => setColorScheme(next)}
      >
        <span aria-hidden="true">{computed === 'dark' ? '☀' : '☾'}</span>
      </ActionIcon>
    </Tooltip>
  );
}

export function Layout(): JSX.Element {
  const { isAuthenticated, isAdmin, user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async (): Promise<void> => {
    try {
      await signOut();
    } finally {
      navigate('/', { replace: true });
    }
  };

  const links: NavItem[] = [
    ...PUBLIC_LINKS,
    ...(isAuthenticated ? [{ to: '/manage', label: 'Manage' }] : []),
    ...(isAuthenticated && isAdmin ? ADMIN_LINKS : []),
  ];

  return (
    <>
      <a className={classes.skipLink} href="#main-content">
        Skip to main content
      </a>

      <Box component="header" className={classes.header}>
        <Container size="xl" className={classes.headerInner}>
          <Group gap="sm" wrap="nowrap" className={classes.brand}>
            <Box className={classes.brandMark} aria-hidden="true">
              LM
            </Box>
            {/* h1 kept for the document outline + the app heading test. */}
            <Text component="h1" className={classes.wordmark}>
              Basketball League Management
            </Text>
          </Group>

          <nav aria-label="Primary" className={classes.nav}>
            {links.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <Group gap="sm" wrap="nowrap" className={classes.authControls}>
            <ColorSchemeToggle />
            {isAuthenticated ? (
              <>
                <Text size="sm" c="dimmed" visibleFrom="sm">
                  {user?.username}
                </Text>
                <Button
                  variant="light"
                  color="nba-red"
                  size="sm"
                  onClick={() => void handleSignOut()}
                >
                  Sign out
                </Button>
              </>
            ) : (
              <Button component={NavLink} to="/signin" size="sm">
                Sign in
              </Button>
            )}
          </Group>
        </Container>
      </Box>

      <Box component="main" id="main-content" className={classes.main}>
        <Container size="xl">
          <Outlet />
        </Container>
      </Box>
    </>
  );
}
