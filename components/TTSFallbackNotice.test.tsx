import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TTSFallbackNotice from './TTSFallbackNotice';

const message = 'Voxtral ist gerade nicht verfügbar – Browser-Stimme wird verwendet.';

describe('TTSFallbackNotice', () => {
  afterEach(() => vi.useRealTimers());

  it('shows one accessible notice for five seconds after a fallback', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TTSFallbackNotice trigger={0} />);
    expect(screen.queryByRole('status')).toBeNull();

    rerender(<TTSFallbackNotice trigger={1} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe(message);

    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.queryByRole('status')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('restarts its single timer when another real fallback occurs', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TTSFallbackNotice trigger={1} />);

    act(() => vi.advanceTimersByTime(3_000));
    rerender(<TTSFallbackNotice trigger={2} />);
    act(() => vi.advanceTimersByTime(2_500));
    expect(screen.getAllByRole('status')).toHaveLength(1);

    act(() => vi.advanceTimersByTime(2_500));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
