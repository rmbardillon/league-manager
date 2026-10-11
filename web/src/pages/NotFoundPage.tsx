/**
 * Fallback page for unmatched routes.
 */
import { Link } from 'react-router-dom';
import { Button, Stack, Text, Title } from '@mantine/core';

export function NotFoundPage(): JSX.Element {
  return (
    <section aria-labelledby="notfound-heading">
      <Stack gap="md" align="flex-start">
        <Title order={2} id="notfound-heading">
          Page not found
        </Title>
        <Text c="dimmed">The page you requested does not exist.</Text>
        <Button component={Link} to="/">
          Return home
        </Button>
      </Stack>
    </section>
  );
}
