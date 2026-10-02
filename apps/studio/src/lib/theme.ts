// Keeps <html data-theme> in step with the studio setting, live: a change in another tab or the
// desktop app arrives as a settings event and refetches.
import { applyTheme, rememberedTheme } from '@ws/theme';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { settingsQuery } from './api.ts';

export function useTheme() {
  const { data } = useQuery(settingsQuery);
  const theme = data?.theme ?? rememberedTheme();
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return theme;
}
