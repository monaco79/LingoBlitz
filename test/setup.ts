import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

const speechSynthesisStub = {
  cancel: vi.fn(),
  getVoices: vi.fn(() => []),
  pause: vi.fn(),
  resume: vi.fn(),
  speak: vi.fn(),
  paused: false,
  speaking: false,
  onvoiceschanged: null,
};

class AudioStub {
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  play = vi.fn(() => Promise.resolve());
  src = '';
}

const resetBrowserStubs = () => {
  localStorage.clear();
  vi.stubGlobal('speechSynthesis', speechSynthesisStub);
  vi.stubGlobal('Audio', AudioStub);
  vi.stubGlobal('URL', URL);
  URL.createObjectURL = vi.fn(() => 'blob:test-audio');
  URL.revokeObjectURL = vi.fn();
};

resetBrowserStubs();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetBrowserStubs();
});
