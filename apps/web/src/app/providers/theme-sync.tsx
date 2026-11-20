import { useEffect } from 'react';
import { resolveTheme, useUiStore } from '@/store/ui-store';

/** Applies the theme preference to <html> and follows OS changes in "system" mode. */
export function ThemeSync() {
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(theme);
      document.documentElement.classList.toggle('dark', resolved === 'dark');
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    if (theme !== 'system' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  return null;
}
