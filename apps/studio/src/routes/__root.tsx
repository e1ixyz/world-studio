import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { useStudioEvents } from '../lib/events.ts';
import { useTheme } from '../lib/theme.ts';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
});

function Root() {
  useStudioEvents();
  useTheme();
  return <Outlet />;
}
