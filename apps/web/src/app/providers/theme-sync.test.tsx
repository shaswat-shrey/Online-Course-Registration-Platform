import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useUiStore } from '@/store/ui-store';
import { ThemeSync } from './theme-sync';

describe('ThemeSync', () => {
  it('applies the dark class for the dark preference and removes it for light', () => {
    render(<ThemeSync />);
    act(() => useUiStore.getState().setTheme('dark'));
    expect(document.documentElement).toHaveClass('dark');
    act(() => useUiStore.getState().setTheme('light'));
    expect(document.documentElement).not.toHaveClass('dark');
  });
});
