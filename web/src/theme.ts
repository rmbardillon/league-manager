/**
 * Shared Mantine theme (Requirement 10.1).
 *
 * A single {@link createTheme} applied once at the root via `MantineProvider`
 * so every management and public view renders with the same primary color,
 * font, and default corner radius. Keeping this in one place is what satisfies
 * the "consistent styling across all views" requirement — components should not
 * re-theme locally.
 */
import { createTheme } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'blue',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  defaultRadius: 'md',
});
