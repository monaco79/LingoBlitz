import { describe, expect, it, vi } from 'vitest';

import { Language } from '../../types';
import { createVoxtralApi } from './voxtralApi';
import { TTSAdapterError, type SpeechSegment } from './types';

const segment: SpeechSegment = {
  id: 'segment-1',
  displayText: '  Hallo   Welt. ',
  spokenText: 'Hallo Welt.',
  visibleSentenceId: 'sentence-1',
};

describe('Voxtral API client', () => {
  it('requests and validates Voxtral voice options for the requested language', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      voices: [{ id: 'voice-1', name: 'Anna', languages: ['de'], gender: 'female', description: 'Warm' }],
    }));
    const api = createVoxtralApi(fetchImpl);

    await expect(api.fetchVoxtralVoices(Language.German)).resolves.toEqual([
      { id: 'voice-1', name: 'Anna', displayName: 'Anna', provider: 'voxtral', languages: ['de'] },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/tts/voices?language=German', {
      method: 'GET',
      signal: undefined,
    });
  });

  it('rejects a malformed voices envelope', async () => {
    const api = createVoxtralApi(vi.fn(async () => Response.json({ data: [] })));

    await expect(api.fetchVoxtralVoices(Language.German)).rejects.toMatchObject({
      category: 'upstream',
      message: 'Voxtral returned an invalid voice list',
    } satisfies Partial<TTSAdapterError>);
  });

  it('posts the exact speech body and accepts an MP3 response', async () => {
    const audio = new Uint8Array([1, 2, 3]);
    const fetchImpl = vi.fn(async () => new Response(audio, {
      headers: { 'content-type': 'audio/mpeg' },
    }));
    const api = createVoxtralApi(fetchImpl);
    const signal = new AbortController().signal;

    const blob = await api.fetchVoxtralAudio(segment, Language.German, 'voice-1', signal);

    expect(fetchImpl).toHaveBeenCalledWith('/api/tts/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hallo Welt.', language: 'German', voiceId: 'voice-1' }),
      signal,
    });
    expect(blob.type).toBe('audio/mpeg');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(audio);
  });

  it('rejects non-MP3 and empty audio without exposing response data', async () => {
    for (const response of [
      new Response('private body', { headers: { 'content-type': 'text/plain' } }),
      new Response(new Uint8Array(), { headers: { 'content-type': 'audio/mpeg' } }),
    ]) {
      const api = createVoxtralApi(vi.fn(async () => response));

      await expect(api.fetchVoxtralAudio(segment, Language.German, 'voice-1')).rejects.toMatchObject({
        category: 'invalid_audio',
        message: 'Voxtral returned invalid audio',
      } satisfies Partial<TTSAdapterError>);
    }
  });

  it.each([
    [403, 'content_rejected', 'moderation'],
    [429, 'rate_limited', 'rate_limit'],
    [503, 'tts_unavailable', 'configuration'],
    [504, 'tts_timeout', 'timeout'],
    [502, 'secret_upstream_detail', 'upstream'],
  ] as const)('maps HTTP %i JSON errors safely', async (status, code, category) => {
    const api = createVoxtralApi(vi.fn(async () => Response.json({
      error: { code, message: 'private response detail' },
    }, { status })));

    const error = await api.fetchVoxtralAudio(segment, Language.German, 'voice-1').catch((caught) => caught);

    expect(error).toBeInstanceOf(TTSAdapterError);
    expect(error).toMatchObject({ category, message: 'Voxtral request failed' });
    expect(String(error)).not.toContain('private response detail');
    expect(String(error)).not.toContain(code);
  });

  it('maps cancellation while reading a non-2xx error body to cancelled', async () => {
    const controller = new AbortController();
    let markBodyStarted: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve; });
    const response = new Response('{}', { status: 429 });
    vi.spyOn(response, 'json').mockImplementation(async () => {
      markBodyStarted?.();
      await new Promise<void>((_resolve, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new DOMException('private error body detail', 'AbortError')),
          { once: true },
        );
      });
      return {};
    });
    const api = createVoxtralApi(vi.fn(async () => response));

    const audio = api.fetchVoxtralAudio(segment, Language.German, 'voice-1', controller.signal);
    await bodyStarted;
    controller.abort();

    await expect(audio).rejects.toMatchObject({
      category: 'cancelled',
      message: 'Voxtral request was cancelled',
    });
  });

  it('maps an aborted fetch to cancellation', async () => {
    const abortError = new DOMException('private abort detail', 'AbortError');
    const api = createVoxtralApi(vi.fn(async () => { throw abortError; }));

    await expect(api.fetchVoxtralAudio(segment, Language.German, 'voice-1')).rejects.toMatchObject({
      category: 'cancelled',
      message: 'Voxtral request was cancelled',
    } satisfies Partial<TTSAdapterError>);
  });

  it('does not accept a response that completes after cancellation', async () => {
    const controller = new AbortController();
    const api = createVoxtralApi(vi.fn(async () => {
      controller.abort();
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } });
    }));

    await expect(api.fetchVoxtralAudio(segment, Language.German, 'voice-1', controller.signal)).rejects.toMatchObject({
      category: 'cancelled',
      message: 'Voxtral request was cancelled',
    });
  });

  it('sanitizes failures while reading the audio response', async () => {
    const response = new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } });
    vi.spyOn(response, 'blob').mockRejectedValue(new Error('private response stream detail'));
    const api = createVoxtralApi(vi.fn(async () => response));

    const error = await api.fetchVoxtralAudio(segment, Language.German, 'voice-1').catch((caught) => caught);

    expect(error).toMatchObject({
      category: 'invalid_audio',
      message: 'Voxtral returned invalid audio',
    });
    expect(String(error)).not.toContain('private response stream detail');
  });
});
