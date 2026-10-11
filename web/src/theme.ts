/**
 * Shared Mantine theme (Requirement 10.1) — NBA.com-inspired.
 *
 * A single {@link createTheme} applied once at the root via `MantineProvider`
 * so every management and public view renders with the same visual language:
 * a bold blue primary, a red for destructive actions, tight uppercase section
 * labels, and slightly rounded corners. The app defaults to the dark color
 * scheme (the signature "league site" look); a header toggle lets a visitor
 * switch to light. Components should not re-theme locally.
 */
import { createTheme, rem } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'nba-blue',
  primaryShade: { light: 6, dark: 5 },
  defaultRadius: 'md',
  fontFamily:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  headings: {
    fontFamily:
      '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontWeight: '800',
    sizes: {
      h1: { fontSize: rem(40), lineHeight: '1.1' },
      h2: { fontSize: rem(28), lineHeight: '1.15' },
      h3: { fontSize: rem(20), lineHeight: '1.2' },
    },
  },
  colors: {
    // NBA-style vivid blue ramp (primary).
    'nba-blue': [
      '#e5f0ff',
      '#cddeff',
      '#9bbaff',
      '#6693ff',
      '#3a73fe',
      '#1d5ffe',
      '#0a55ff',
      '#0045e4',
      '#003ccc',
      '#0033b4',
    ],
    // NBA-style red ramp (destructive / accents).
    'nba-red': [
      '#ffe8ec',
      '#ffd0d6',
      '#ff9fab',
      '#ff6a7d',
      '#fb3f56',
      '#f8243d',
      '#f81231',
      '#dd0526',
      '#c60020',
      '#ad0019',
    ],
  },
  components: {
    Table: {
      defaultProps: {
        striped: true,
        highlightOnHover: true,
        verticalSpacing: 'sm',
        horizontalSpacing: 'md',
      },
    },
    Button: {
      defaultProps: {
        radius: 'md',
      },
    },
  },
});
