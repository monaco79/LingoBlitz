# Voxtral TTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Voxtral as the default TTS source for supported languages, retain selectable browser voices and automatic fallback, and highlight the sentence currently being spoken across all LingoBlitz speech surfaces.

**Architecture:** Replace direct `speechSynthesis` calls with a provider-neutral queue controller backed by focused browser and Voxtral adapters. Vercel Edge endpoints proxy the Mistral Voices and Speech APIs, while shared segmentation and rendering code gives playback and the UI stable sentence IDs. Provider and voice preferences are persisted per learning language, and Voxtral failures switch the remainder of the current queue to browser speech.

**Tech Stack:** React 19, TypeScript, Vite 6, Tailwind CSS, Vercel Edge Functions, browser Web Speech and HTML Audio APIs, Mistral REST API, Node test runner, Vitest, jsdom, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-22-voxtral-tts-design.md`

## Global Constraints

- Node.js remains `24.x`; do not lower the runtime floor.
- Voxtral supports only English, French, German, Spanish, Dutch, Portuguese, and Italian from the current LingoBlitz language list.
- Japanese and Mandarin Chinese remain browser-only.
- Voxtral is the default for supported languages; browser speech is the default for unsupported languages.
- Voxtral uses preset voices only; do not add voice cloning or custom voice management.
- `MISTRAL_API_KEY` must remain server-side and TTS configuration must remain independent of `AI_PROVIDER` and `AI_MODEL`.
- `TTS_MODEL` defaults to `voxtral-mini-tts-2603`; `TTS_ENABLED=false` disables Voxtral immediately.
- Mistral TTS requests are limited to 2,000 characters and 250 words.
- The first version uses complete MP3 responses, not native PCM streaming.
- Sentence highlights follow actual sentence-unit playback events; do not estimate word timings.
- Generated audio is cached only in memory for the current browser session.
- Never log full spoken text, audio data, API keys, upstream headers, or raw upstream error bodies.
- Automated tests must mock Mistral and must not consume live API credits.
- Use test-driven development for every production-code task: observe the new test fail, make the minimum implementation pass, then run the relevant regression suite.

---

## Planned file structure

### New frontend modules

- `services/tts/types.ts` — provider-neutral playback, segment, voice, and adapter contracts.
- `services/tts/languageConfig.ts` — Voxtral support and Mistral/browser language mappings.
- `services/tts/settings.ts` — defaults, migration, and per-language preference helpers.
- `services/tts/textSegments.ts` — sentence segmentation, oversized-chunk splitting, and speech-only normalization.
- `services/tts/audioCache.ts` — bounded in-memory LRU cache with Blob URL cleanup.
- `services/tts/browserAdapter.ts` — browser voice discovery and sentence-unit playback.
- `services/tts/voxtralApi.ts` — typed calls to the two LingoBlitz TTS endpoints.
- `services/tts/voxtralAdapter.ts` — MP3 preparation and HTML Audio playback.
- `services/tts/playbackController.ts` — queue, prefetch, active segment, cancellation, fallback, and state transitions.
- `components/VoiceSettings.tsx` — shared provider/voice/preview/speed/auto-read UI.
- `components/SpeakableText.tsx` — renders stable sentence wrappers while preserving clickable words.
- `components/TTSFallbackNotice.tsx` — accessible, short-lived fallback notice.
- `test/setup.ts` — jsdom cleanup and browser API stubs used by component tests.

### New server modules

- `api/_lib/tts-config.ts` — environment resolution and kill-switch behavior.
- `api/_lib/mistral-tts.ts` — authenticated Mistral REST calls, timeout handling, response validation, and safe error categories.
- `api/tts/voices.ts` — filtered preset voice endpoint.
- `api/tts/speech.ts` — validated MP3 speech endpoint.

### Existing files modified

- `package.json`, `package-lock.json`, `vite.config.ts` — frontend test tooling and scripts.
- `types.ts` — persisted TTS settings and provider types.
- `constants.ts` — no duplicated provider mapping; retain samples and browser locales only.
- `services/ttsService.ts` — compatibility facade around the new controller and voice APIs.
- `components/SettingsModal.tsx`, `components/Onboarding.tsx` — adopt `VoiceSettings`.
- `components/Article.tsx`, `components/Quiz.tsx`, `components/VocabularyPractice.tsx` — queue playback and sentence highlighting.
- `App.tsx` — settings migration, word playback, fallback-notice state, and controller cleanup.
- `index.css` — accessible active-sentence style with reduced-motion behavior.
- `.env.example`, `README.md` — configuration, privacy, supported languages, costs, and operational guardrails.

---

### Task 1: Add frontend test tooling and persisted TTS settings migration

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Modify: `types.ts`
- Create: `test/setup.ts`
- Create: `services/tts/languageConfig.ts`
- Create: `services/tts/settings.ts`
- Test: `services/tts/settings.test.ts`

**Interfaces:**
- Produces: `type TTSProvider = 'voxtral' | 'browser'`.
- Produces: `interface LanguageTTSPreference { provider: TTSProvider; voxtralVoiceId: string; browserVoiceName: string }`.
- Produces temporarily: `interface TTSSettings { voice?: string; preferences?: Partial<Record<Language, LanguageTTSPreference>>; speed: number; autoRead: boolean }`. The deprecated `voice` field keeps existing call sites buildable until Task 8; Task 8 removes it and makes `preferences` required.
- Produces: `isVoxtralSupported(language: Language): boolean` and `toMistralLanguageCode(language: Language): string | null`.
- Produces: `createDefaultTTSSettings(language: Language, speed?: number): TTSSettings`, `migrateTTSSettings(raw: unknown, learningLanguage: Language): TTSSettings`, and `getTTSPreference(settings: TTSSettings, language: Language): LanguageTTSPreference`.

- [ ] **Step 1: Install the focused frontend test dependencies**

Run:

```bash
npm install --save-dev vitest jsdom @testing-library/react @testing-library/user-event
```

Expected: `package.json` and `package-lock.json` add the five packages without changing production dependencies.

- [ ] **Step 2: Add deterministic test scripts and jsdom setup**

Change the scripts to:

```json
{
  "test": "npm run test:api && npm run test:ui",
  "test:api": "node --test api/_lib/*.test.ts",
  "test:ui": "vitest run",
  "test:ui:watch": "vitest"
}
```

Add a `test` block to `vite.config.ts` with `environment: 'jsdom'`, `setupFiles: ['./test/setup.ts']`, `restoreMocks: true`, and `clearMocks: true`. Add the Vitest config type reference so TypeScript accepts the test block.

In `test/setup.ts`, call Testing Library cleanup after each test and restore `localStorage`, `speechSynthesis`, `Audio`, `URL.createObjectURL`, and `URL.revokeObjectURL` stubs to known values.

- [ ] **Step 3: Write failing language/default/migration tests**

Cover these exact cases in `services/tts/settings.test.ts`:

```ts
expect(isVoxtralSupported(Language.German)).toBe(true);
expect(isVoxtralSupported(Language.Japanese)).toBe(false);
expect(toMistralLanguageCode(Language.Portuguese)).toBe('pt');

const migrated = migrateTTSSettings(
  { voice: 'Google Deutsch', speed: 0.8, autoRead: true },
  Language.German,
);
expect(getTTSPreference(migrated, Language.German)).toEqual({
  provider: 'voxtral',
  voxtralVoiceId: '',
  browserVoiceName: 'Google Deutsch',
});
expect(migrated.speed).toBe(0.8);
expect(migrated.autoRead).toBe(true);

expect(getTTSPreference(createDefaultTTSSettings(Language.Chinese), Language.Chinese).provider)
  .toBe('browser');
```

Also verify that a new-format object is normalized without losing other languages and that malformed speed/provider values fall back safely.

- [ ] **Step 4: Run the focused tests and confirm the red state**

Run: `npm run test:ui -- services/tts/settings.test.ts`

Expected: FAIL because the language and settings modules do not exist.

- [ ] **Step 5: Implement the types, mappings, defaults, and migration**

Use an explicit support map:

```ts
const MISTRAL_LANGUAGE_CODES: Partial<Record<Language, string>> = {
  [Language.English]: 'en',
  [Language.French]: 'fr',
  [Language.German]: 'de',
  [Language.Spanish]: 'es',
  [Language.Dutch]: 'nl',
  [Language.Portuguese]: 'pt',
  [Language.Italian]: 'it',
};
```

`getTTSPreference` must synthesize a default entry when the requested language has not yet been saved. `migrateTTSSettings` must recognize the legacy `{ voice, speed, autoRead }` object, preserve `voice` as `browserVoiceName`, select Voxtral for supported languages, and never throw on malformed local storage.

- [ ] **Step 6: Run unit tests, API regressions, and the build**

Run:

```bash
npm run test:ui -- services/tts/settings.test.ts
npm run test:api
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit the test foundation and settings model**

```bash
git add package.json package-lock.json vite.config.ts types.ts test/setup.ts services/tts/languageConfig.ts services/tts/settings.ts services/tts/settings.test.ts
git commit -m "Add TTS settings migration and test setup"
```

---

### Task 2: Add safe Voxtral configuration and Mistral REST client

**Files:**
- Create: `api/_lib/tts-config.ts`
- Create: `api/_lib/tts-config.test.ts`
- Create: `api/_lib/mistral-tts.ts`
- Create: `api/_lib/mistral-tts.test.ts`

**Interfaces:**
- Produces: `interface TTSConfig { enabled: boolean; model: string; apiKey: string | null; baseURL: string }`.
- Produces: `resolveTTSConfig(env: NodeJS.ProcessEnv): TTSConfig`.
- Produces: `interface MistralVoice { id: string; name: string; languages: string[]; gender?: string; description?: string }`.
- Produces: `class TTSError extends Error { category: TTSErrorCategory; status: number }` with categories `disabled`, `configuration`, `timeout`, `rate_limit`, `moderation`, `upstream`, and `invalid_response`.
- Produces: `listPresetVoices(config: TTSConfig, fetchImpl?: typeof fetch): Promise<MistralVoice[]>`.
- Produces: `generateSpeech(config: TTSConfig, input: { text: string; voiceId: string }, fetchImpl?: typeof fetch): Promise<Uint8Array>`.

- [ ] **Step 1: Write failing configuration tests**

Test these outcomes:

```ts
assert.deepEqual(resolveTTSConfig({ MISTRAL_API_KEY: 'key' }), {
  enabled: true,
  model: 'voxtral-mini-tts-2603',
  apiKey: 'key',
  baseURL: 'https://api.mistral.ai/v1',
});
assert.equal(resolveTTSConfig({ TTS_ENABLED: 'false' }).enabled, false);
assert.equal(resolveTTSConfig({}).enabled, false);
assert.equal(resolveTTSConfig({ MISTRAL_API_KEY: 'key', TTS_MODEL: 'next-model' }).model, 'next-model');
```

- [ ] **Step 2: Run the config test and confirm it fails**

Run: `node --test api/_lib/tts-config.test.ts`

Expected: FAIL because `resolveTTSConfig` is missing.

- [ ] **Step 3: Implement strict but non-disruptive TTS configuration**

Treat `TTS_ENABLED=false` as disabled regardless of the key. When not explicitly disabled, enable Voxtral only if `MISTRAL_API_KEY` is non-empty. Do not read or change `AI_PROVIDER` or `AI_MODEL`.

- [ ] **Step 4: Write failing Mistral client tests**

Use injected `fetchImpl` functions and assert:

- voice listing calls `GET https://api.mistral.ai/v1/audio/voices?type=preset&limit=1000` with Bearer authentication;
- speech generation posts `{ model, input, voice_id, response_format: 'mp3', stream: false }`;
- valid `{ audio_data: 'aGk=' }` becomes bytes for `hi`;
- 403 maps to `moderation`, 429 maps to `rate_limit`, abort maps to `timeout`, and invalid JSON/base64 maps to `invalid_response`;
- thrown errors do not contain the API key or raw upstream body.

- [ ] **Step 5: Run the client tests and confirm they fail**

Run: `node --test api/_lib/mistral-tts.test.ts`

Expected: FAIL because the client module is missing.

- [ ] **Step 6: Implement the REST client with a 20-second timeout**

Use `fetch`, an internal `AbortController`, and a timer cleared in `finally`. Decode Base64 with an Edge-compatible `atob`/`Uint8Array` helper rather than Node `Buffer`. Validate that voice records contain non-empty `id`, `name`, and a string array of `languages` before returning them.

Log no response bodies. `TTSError.message` must be a stable internal description such as `Mistral TTS rate limit` rather than provider-supplied content.

- [ ] **Step 7: Run all API tests**

Run: `npm run test:api`

Expected: existing AI configuration tests and the new TTS tests pass.

- [ ] **Step 8: Commit the server client layer**

```bash
git add api/_lib/tts-config.ts api/_lib/tts-config.test.ts api/_lib/mistral-tts.ts api/_lib/mistral-tts.test.ts
git commit -m "Add safe Voxtral API client"
```

---

### Task 3: Add voices and speech Edge endpoints

**Files:**
- Create: `api/tts/voices.ts`
- Create: `api/tts/voices.test.ts`
- Create: `api/tts/speech.ts`
- Create: `api/tts/speech.test.ts`
- Modify: `api/_lib/mistral-tts.ts`
- Modify: `api/_lib/mistral-tts.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `resolveTTSConfig`, `listPresetVoices`, `generateSpeech`, `TTSError`, `toMistralLanguageCode`.
- Produces: `GET /api/tts/voices?language=<Language>` returning `{ voices: Array<{ id: string; name: string; languages: string[]; gender?: string; description?: string }> }`.
- Produces: `POST /api/tts/speech` accepting `{ text: string; language: Language; voiceId: string }` and returning `audio/mpeg` bytes.
- Produces: stable JSON errors `{ error: { code: string; message: string } }`.

- [ ] **Step 1: Write failing voices endpoint tests**

Export an injectable `createVoicesHandler(deps)` in addition to the default handler. Test with `new Request(...)` that:

```ts
const response = await handler(new Request(
  'https://example.test/api/tts/voices?language=German',
));
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), {
  voices: [{ id: 'de-1', name: 'Anna', languages: ['de'], gender: 'female' }],
});
```

The fixture must include incompatible and custom-looking records to prove only the preset list returned by the client and the requested language are exposed. Also test 400 for a missing/unsupported language and 503 when TTS is disabled.

- [ ] **Step 2: Run the voices endpoint test and confirm it fails**

Run: `node --test api/tts/voices.test.ts`

Expected: FAIL because the handler does not exist.

- [ ] **Step 3: Implement the voices endpoint**

Use `export const config = { runtime: 'edge' }`. Add `getCachedPresetVoices` and a test-only cache reset to `mistral-tts.ts`; cache the complete preset list for 15 minutes inside each warm Edge-function instance. Test one upstream call across two reads and a new call after advancing beyond the expiry. Make cache use optional in the injected endpoint handlers. Filter case-insensitive language codes and return only `id`, `name`, `languages`, `gender`, and `description`.

- [ ] **Step 4: Expand the API test script for the new endpoint directory**

Change `test:api` to:

```json
"test:api": "node --test api/_lib/*.test.ts api/tts/*.test.ts"
```

- [ ] **Step 5: Write failing speech endpoint tests**

Export `createSpeechHandler(deps)` and cover:

- 405 for non-POST;
- 400 for empty text, more than 2,000 characters, more than 250 whitespace-delimited words, unsupported language, or empty voice ID;
- 400 when `voiceId` is absent from the cached preset list or its languages do not match;
- 200 with exact bytes and headers `Content-Type: audio/mpeg`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`;
- safe 403/429/503/504 mappings for moderation, rate limit, configuration/disabled, and timeout;
- no spoken text or secret in error JSON or captured log arguments.

- [ ] **Step 6: Run the speech endpoint test and confirm it fails**

Run: `node --test api/tts/speech.test.ts`

Expected: FAIL because the handler does not exist.

- [ ] **Step 7: Implement the speech endpoint and shared voice validation**

Parse JSON inside the guarded block. Resolve the requested language through `toMistralLanguageCode`, verify the preset voice against the voice list, and pass only normalized request fields to `generateSpeech`. Return the `Uint8Array` as the response body.

Structured server logs may contain category, status, model, language, duration, character count, and a generated request ID. They must not contain `text`, audio bytes, authorization headers, or upstream response bodies.

- [ ] **Step 8: Run endpoint tests, all API tests, and the build**

Run:

```bash
node --test api/tts/voices.test.ts api/tts/speech.test.ts
npm run test:api
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit the Edge endpoints**

```bash
git add api/tts/voices.ts api/tts/voices.test.ts api/tts/speech.ts api/tts/speech.test.ts api/_lib/mistral-tts.ts api/_lib/mistral-tts.test.ts package.json
git commit -m "Add Voxtral voices and speech endpoints"
```

---

### Task 4: Add sentence segmentation, speech normalization, and shared rendering

**Files:**
- Create: `services/tts/types.ts`
- Create: `services/tts/textSegments.ts`
- Create: `services/tts/textSegments.test.ts`
- Create: `components/SpeakableText.tsx`
- Create: `components/SpeakableText.test.tsx`
- Modify: `utils/textProcessing.ts`

**Interfaces:**
- Produces: `interface SpeechSegment { id: string; displayText: string; spokenText: string; visibleSentenceId: string }`.
- Produces: `createSpeechSegments(text: string, language: Language, idPrefix: string): SpeechSegment[]`.
- Produces: `normalizeSpeechText(text: string): string`.
- Produces: `SpeakableText` props `{ segments, language, activeSegmentId, onWordClick?, className? }`.

- [ ] **Step 1: Write failing segmentation and normalization tests**

Cover:

```ts
expect(createSpeechSegments('Dr. Weber kommt. Er lernt.', Language.German, 'article'))
  .toMatchObject([
    { id: 'article-0-0', displayText: 'Dr. Weber kommt.', visibleSentenceId: 'article-0' },
    { id: 'article-1-0', displayText: ' Er lernt.', visibleSentenceId: 'article-1' },
  ]);
expect(normalizeSpeechText('**Hallo** 👋  Welt')).toBe('Hallo Welt');
```

Add quotation, exclamation/question punctuation, newline, empty-text, and `Intl.Segmenter`-unavailable cases. Create a 251-word sentence and assert it becomes multiple audio chunks sharing one `visibleSentenceId`, with every chunk at or below 250 words and 2,000 characters.

- [ ] **Step 2: Run the text tests and confirm they fail**

Run: `npm run test:ui -- services/tts/textSegments.test.ts`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement stable visible sentences and internal chunks**

Prefer `Intl.Segmenter(locale, { granularity: 'sentence' })`. Preserve exact display substrings, but generate normalized `spokenText`. The fallback must protect common honorific abbreviations (`Mr.`, `Mrs.`, `Ms.`, `Dr.`, `Prof.` and common German/French/Spanish equivalents used in tests) before splitting terminal punctuation.

When a visible sentence exceeds a limit, split spoken text on clause punctuation and then whitespace. IDs follow `<prefix>-<visible-index>-<chunk-index>` and remain deterministic for identical input.

- [ ] **Step 4: Write failing shared-renderer tests**

Render two segments and assert:

- the active visible sentence has `data-active-sentence="true"` and an accessible `aria-current="true"` marker;
- inactive sentences do not;
- clicking a word calls `onWordClick` with the cleaned word;
- multiple internal chunks with the same `visibleSentenceId` render the visible sentence only once.

- [ ] **Step 5: Run the renderer tests and confirm they fail**

Run: `npm run test:ui -- components/SpeakableText.test.tsx`

Expected: FAIL because `SpeakableText` is missing.

- [ ] **Step 6: Implement `SpeakableText` without duplicating word segmentation**

Extract or reuse the current `segmentText`/`cleanWord` behavior from `utils/textProcessing.ts`. Render one wrapper per `visibleSentenceId`, then word spans inside it. Apply a semantic data attribute; leave presentation to `index.css` so Article and Quiz do not duplicate highlight classes.

- [ ] **Step 7: Run text/render tests and the build**

Run:

```bash
npm run test:ui -- services/tts/textSegments.test.ts components/SpeakableText.test.tsx
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit segmentation and rendering**

```bash
git add services/tts/types.ts services/tts/textSegments.ts services/tts/textSegments.test.ts components/SpeakableText.tsx components/SpeakableText.test.tsx utils/textProcessing.ts
git commit -m "Add sentence segmentation and highlighting renderer"
```

---

### Task 5: Add browser and Voxtral adapters with bounded audio caching

**Files:**
- Create: `services/tts/audioCache.ts`
- Create: `services/tts/audioCache.test.ts`
- Create: `services/tts/browserAdapter.ts`
- Create: `services/tts/browserAdapter.test.ts`
- Create: `services/tts/voxtralApi.ts`
- Create: `services/tts/voxtralApi.test.ts`
- Create: `services/tts/voxtralAdapter.ts`
- Create: `services/tts/voxtralAdapter.test.ts`

**Interfaces:**
- Consumes: `SpeechSegment`, `Language`, `LanguageTTSPreference`.
- Produces in `types.ts`: `SpeechAdapter`, `PlaybackUnit`, `TTSVoiceOption`, `AdapterContext`, and `TTSAdapterError`.
- Produces: `AudioCache` with `get(key)`, `set(key, blob)`, `delete(key)`, and `clear()`.
- Produces: `BrowserSpeechAdapter` and `VoxtralSpeechAdapter`, each implementing `SpeechAdapter`.
- Produces: `fetchVoxtralVoices(language, signal?)` and `fetchVoxtralAudio(segment, language, voiceId, signal?)`.

- [ ] **Step 1: Define the adapter contract and write failing cache tests**

The contract must expose:

```ts
interface PlaybackUnit {
  play(): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  stop(): void;
  dispose(): void;
}

interface SpeechAdapter {
  prepare(segment: SpeechSegment, context: AdapterContext, signal: AbortSignal): Promise<PlaybackUnit>;
}

interface AdapterContext {
  language: Language;
  voiceId: string;
  speed: number;
  modelMarker: string;
}

interface TTSVoiceOption {
  id: string;
  name: string;
  displayName: string;
  provider: TTSProvider;
  languages: string[];
}

type TTSAdapterErrorCategory =
  | 'cancelled'
  | 'configuration'
  | 'timeout'
  | 'rate_limit'
  | 'moderation'
  | 'upstream'
  | 'invalid_audio';

class TTSAdapterError extends Error {
  constructor(
    readonly category: TTSAdapterErrorCategory,
    message: string,
  ) {
    super(message);
  }
}
```

Test LRU access ordering, entry and byte limits, replacement, and exactly-once `URL.revokeObjectURL` on eviction and `clear()`.

- [ ] **Step 2: Run the cache test and confirm it fails**

Run: `npm run test:ui -- services/tts/audioCache.test.ts`

Expected: FAIL because `AudioCache` does not exist.

- [ ] **Step 3: Implement the bounded cache**

Use defaults of 40 entries and 25 MiB. Cache keys contain language, model marker returned by the app, voice ID, and normalized spoken text, but not playback speed. Reject blobs larger than the total byte limit rather than evicting the whole cache for one item.

- [ ] **Step 4: Write failing browser adapter tests**

Stub `speechSynthesis` and `SpeechSynthesisUtterance`. Assert selected voice and locale, playback rate, resolve-on-end, reject-on-real-error, silent stop on cancellation, and direct pause/resume calls. Also verify the existing Microsoft/Google/Natural voice ordering and language filtering move into the adapter unchanged.

- [ ] **Step 5: Implement the browser adapter**

Keep `SpeechSynthesisUtterance` private to the returned unit. Do not use `onboundary`; sentence completion is the lifecycle boundary. Cancellation must settle the pending playback promise so the controller cannot hang.

- [ ] **Step 6: Write failing Voxtral API and adapter tests**

Assert the client:

- requests `/api/tts/voices?language=German` and validates `{ voices: [...] }`;
- posts the exact speech body and accepts only `audio/mpeg`;
- maps non-2xx JSON errors to safe `TTSAdapterError` categories.

Assert the adapter:

- reuses a cached Blob instead of fetching twice;
- creates an `Audio` object, assigns the Blob URL, sets `playbackRate`, and resolves on `ended`;
- supports pause/resume/stop;
- disposes listeners and only revokes uncached URLs;
- forwards abort and decode/playback errors without exposing response bodies.

- [ ] **Step 7: Run the adapter tests and confirm the red state**

Run:

```bash
npm run test:ui -- services/tts/browserAdapter.test.ts services/tts/voxtralApi.test.ts services/tts/voxtralAdapter.test.ts
```

Expected: FAIL because the modules are missing.

- [ ] **Step 8: Implement the Voxtral client and adapter**

Use injected factories for `fetch`, `Audio`, and object URLs to keep tests deterministic. Treat an aborted request as cancellation, not a provider failure. Leave retry policy to the controller; the adapter performs one request per preparation.

- [ ] **Step 9: Run all focused tests and the build**

Run:

```bash
npm run test:ui -- services/tts/audioCache.test.ts services/tts/browserAdapter.test.ts services/tts/voxtralApi.test.ts services/tts/voxtralAdapter.test.ts
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 10: Commit the provider adapters**

```bash
git add services/tts/types.ts services/tts/audioCache.ts services/tts/audioCache.test.ts services/tts/browserAdapter.ts services/tts/browserAdapter.test.ts services/tts/voxtralApi.ts services/tts/voxtralApi.test.ts services/tts/voxtralAdapter.ts services/tts/voxtralAdapter.test.ts
git commit -m "Add browser and Voxtral speech adapters"
```

---

### Task 6: Add the playback controller, prefetch queue, and fallback facade

**Files:**
- Create: `services/tts/playbackController.ts`
- Create: `services/tts/playbackController.test.ts`
- Modify: `services/ttsService.ts`
- Test: `services/ttsService.test.ts`

**Interfaces:**
- Consumes: both `SpeechAdapter` implementations and `getTTSPreference`.
- Produces: `interface PlaybackSnapshot { status: 'idle' | 'loading' | 'playing' | 'paused'; activeSegmentId: string | null; source: TTSProvider | null }`.
- Produces: `interface PlaybackRequest { segments: SpeechSegment[]; language: Language; settings: TTSSettings; onFallback?: () => void }`.
- Produces: `PlaybackController.play(request): Promise<void>`, `.pause()`, `.resume()`, `.stop()`, `.subscribe(listener)`.
- Produces facade exports: `speakSegments`, `speakText`, `pauseSpeech`, `resumeSpeech`, `stopSpeech`, `subscribeToPlayback`, `getPlaybackSnapshot`, `getVoicesForLanguage`.

- [ ] **Step 1: Write failing controller state and queue tests**

Use fake adapters whose `prepare` and `play` calls are externally resolvable. Assert:

1. `loading` precedes `playing` and the active sentence ID changes exactly when its first chunk begins.
2. Internal chunks sharing a `visibleSentenceId` do not flicker the highlight.
3. At most three preparations run concurrently and only a small look-ahead window is queued.
4. The next sentence begins in order even when later preparations resolve first.
5. Pause retains the active sentence; resume continues the same unit.
6. A second `play` stops the first operation, aborts in-flight preparation, and prevents stale callbacks.
7. `stop` clears the active sentence and settles the operation.

- [ ] **Step 2: Run controller tests and confirm they fail**

Run: `npm run test:ui -- services/tts/playbackController.test.ts`

Expected: FAIL because the controller is missing.

- [ ] **Step 3: Implement the minimal ordered controller**

Give each playback operation a monotonically increasing token. Ignore completion from stale tokens. Maintain a bounded map of prepared units keyed by queue index, start preparation for the next three units, and dispose each unit after playback unless its Blob remains owned by the cache.

- [ ] **Step 4: Add failing fallback tests**

Cover these exact behaviors:

- Voxtral prepare failure at sentence 2 switches sentence 2 and every remaining sentence to the browser adapter;
- sentence 1 is not replayed;
- `onFallback` fires once per playback operation even when later browser preparation also fails;
- unsupported language selects browser without invoking `onFallback`;
- saved preference remains unchanged;
- an abort caused by replacement or stop does not trigger fallback.

- [ ] **Step 5: Implement provider selection and fallback**

Resolve the source once at operation start. On a real Voxtral error, cancel unused Voxtral preparations, switch the remaining queue to browser, and call `onFallback` once. If browser playback then fails, end in `idle` and reject with the browser error.

- [ ] **Step 6: Write failing facade compatibility tests**

Verify `speakText` calls `createSpeechSegments` and the singleton controller, voice discovery returns provider-neutral `TTSVoiceOption[]`, and stop/pause/resume/subscription delegate correctly. Separately verify that the explicitly deprecated positional wrapper retains its existing character-boundary behavior until Task 8 removes it; the new controller API must not expose character boundaries.

- [ ] **Step 7: Replace the monolithic service with the tested facade**

Instantiate the cache, adapters, and controller once. Keep test-only factory functions exported separately so tests do not share singleton state. `speakText` accepts `{ text, idPrefix, language, settings, onFallback }` rather than positional voice arguments. Retain a deprecated positional `speak` wrapper and the legacy browser-voice lookup exports only to keep untouched components buildable through Task 7; Task 8 removes them after all call sites migrate.

- [ ] **Step 8: Run controller/facade tests and the build**

Run:

```bash
npm run test:ui -- services/tts/playbackController.test.ts services/ttsService.test.ts
npm run build
```

Expected: tests and build pass because the explicitly deprecated compatibility exports remain until Task 8. Do not weaken TypeScript to hide errors.

- [ ] **Step 9: Commit the controller and facade**

```bash
git add services/tts/playbackController.ts services/tts/playbackController.test.ts services/ttsService.ts services/ttsService.test.ts
git commit -m "Add provider-neutral TTS playback controller"
```

---

### Task 7: Add the shared provider and voice settings UI

**Files:**
- Create: `components/VoiceSettings.tsx`
- Create: `components/VoiceSettings.test.tsx`
- Modify: `components/SettingsModal.tsx`
- Modify: `components/Onboarding.tsx`
- Test: `components/SettingsModal.test.tsx`
- Test: `components/Onboarding.test.tsx`

**Interfaces:**
- Consumes: `TTSSettings`, language preference helpers, `fetchVoxtralVoices`, browser voice discovery, and `speakText`.
- Produces: `VoiceSettings` props `{ language, level, value, onChange }`.

- [ ] **Step 1: Write failing `VoiceSettings` tests**

Mock provider-neutral voice loading and preview playback. Assert:

- Spanish initially selects Voxtral and loads only Voxtral presets tagged `es`;
- Japanese disables Voxtral with the text `Voxtral is not available for this language.` and selects Browser;
- switching sources restores the previously selected voice for each source;
- the first returned compatible Voxtral preset is persisted when none is saved;
- a voice-list failure keeps Browser usable;
- preview uses the current language, provider, selected voice, and speed;
- the disclosure mentions that spoken text is sent to Mistral;
- speed and auto-read updates preserve all per-language voice preferences.

- [ ] **Step 2: Run the shared component test and confirm it fails**

Run: `npm run test:ui -- components/VoiceSettings.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `VoiceSettings`**

Use two accessible radio buttons or a segmented `radiogroup`, a provider-specific `<select>`, the existing sample sentences, the existing 0.6–1.4 speed slider, and the auto-read checkbox. Load only the active source. Cancel stale Voxtral voice requests when language or source changes.

Do not assign `window.speechSynthesis.onvoiceschanged` directly from React components. The browser adapter owns voice loading and exposes a subscription/refresh helper so Settings and Onboarding cannot overwrite one another.

- [ ] **Step 4: Write failing SettingsModal and Onboarding integration tests**

Assert each parent renders `VoiceSettings`, saves the revised `TTSSettings`, allows progression when a compatible provider has a selected voice, and changes learning language without discarding other languages' saved preferences. Verify level changes update speed using `LEVEL_TTS_SPEEDS` in both flows.

- [ ] **Step 5: Run the parent tests and confirm they fail**

Run:

```bash
npm run test:ui -- components/SettingsModal.test.tsx components/Onboarding.test.tsx
```

Expected: FAIL because the parents still use the legacy voice field.

- [ ] **Step 6: Replace duplicated voice UI in both parents**

Remove their direct `speechSynthesis.onvoiceschanged` assignments, duplicated loading state, and positional legacy `speak` calls. Use `createDefaultTTSSettings` for Onboarding and `VoiceSettings` for both screens.

- [ ] **Step 7: Run component tests and the build**

Run:

```bash
npm run test:ui -- components/VoiceSettings.test.tsx components/SettingsModal.test.tsx components/Onboarding.test.tsx
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit the shared voice settings UI**

```bash
git add components/VoiceSettings.tsx components/VoiceSettings.test.tsx components/SettingsModal.tsx components/SettingsModal.test.tsx components/Onboarding.tsx components/Onboarding.test.tsx
git commit -m "Add Voxtral and browser voice settings"
```

---

### Task 8: Wire sentence playback and highlighting through every speech surface

**Files:**
- Create: `components/TTSFallbackNotice.tsx`
- Create: `components/TTSFallbackNotice.test.tsx`
- Modify: `components/Article.tsx`
- Test: `components/Article.test.tsx`
- Modify: `components/Quiz.tsx`
- Test: `components/Quiz.test.tsx`
- Modify: `components/VocabularyPractice.tsx`
- Test: `components/VocabularyPractice.test.tsx`
- Modify: `App.tsx`
- Test: `App.test.tsx`
- Modify: `index.css`
- Modify: `services/ttsService.ts`

**Interfaces:**
- Consumes: `createSpeechSegments`, `SpeakableText`, controller facade, and revised `TTSSettings`.
- Produces: one app-level fallback notice callback passed to all playback requests.

- [ ] **Step 1: Write failing Article playback/highlight tests**

Mock the facade subscription and assert:

- Play submits title and body segments in rendered order.
- `activeSegmentId='article-1'` marks only that visible sentence active.
- Pause calls `pauseSpeech`, resume calls `resumeSpeech`, and stop clears state through the controller.
- Auto-read starts once for a completed article.
- Clicking a word stops the current operation before invoking `onWordClick`.
- Unmount and content replacement stop playback.

- [ ] **Step 2: Run the Article test and confirm it fails**

Run: `npm run test:ui -- components/Article.test.tsx`

Expected: FAIL because Article still tracks character indices and renders only word segments.

- [ ] **Step 3: Migrate Article to sentence units**

Delete character-index and offset refs. Build stable title/body `SpeechSegment[]` with distinct prefixes, render them through `SpeakableText`, and derive button state from the controller snapshot. Keep paragraphs visually separate by segmenting each paragraph with a stable paragraph prefix.

- [ ] **Step 4: Write failing Quiz and VocabularyPractice tests**

For Quiz, cover question/feedback auto-read, sentence highlight, pause/resume/stop, word-click interruption, submit interruption, and cleanup. For VocabularyPractice, cover auto-reading every current word through the selected provider, active-card marking, replacement when the card changes, and cleanup.

- [ ] **Step 5: Run Quiz/Vocabulary tests and confirm they fail**

Run:

```bash
npm run test:ui -- components/Quiz.test.tsx components/VocabularyPractice.test.tsx
```

Expected: FAIL because both components call the legacy positional API.

- [ ] **Step 6: Migrate Quiz and VocabularyPractice**

Use the controller snapshot rather than component-owned character offsets. Quiz question and feedback each receive stable prefixes. A vocabulary word is one visible sentence unit and the front card receives the active attribute while it is spoken.

- [ ] **Step 7: Write failing App and fallback-notice tests**

Assert:

- legacy local storage is passed through `migrateTTSSettings` before rendering;
- a clicked word calls `speakText` with the current language and complete revised settings;
- `onFallback` shows `Voxtral ist gerade nicht verfügbar – Browser-Stimme wird verwendet.` once;
- the notice disappears after 5 seconds and uses `role="status"`;
- navigating to a new learning state stops current playback;
- no notice appears merely because Japanese or Mandarin uses Browser by design.

- [ ] **Step 8: Run App/notice tests and confirm they fail**

Run:

```bash
npm run test:ui -- components/TTSFallbackNotice.test.tsx App.test.tsx
```

Expected: FAIL because migration and notice wiring are not present.

- [ ] **Step 9: Implement App migration, word playback, and the notice**

Wrap JSON parsing in a safe function; malformed saved settings must fall back to Onboarding instead of crashing. Keep one notice timer in `TTSFallbackNotice`, reset it for a new real fallback, and do not expose technical error text.

- [ ] **Step 10: Add accessible sentence-highlight styles**

Style `[data-active-sentence="true"]` with a subtle background plus an inset underline/border so color is not the only signal. Add dark-mode values and disable transitions inside `@media (prefers-reduced-motion: reduce)`. Do not move focus or alter clickable-word hit targets.

- [ ] **Step 11: Finalize the persisted type and remove the legacy positional TTS API**

Remove `TTSSettings.voice`, make `TTSSettings.preferences` required, and remove the deprecated facade wrappers after every call site uses the controller API. Then verify:

Run:

```bash
rg -n "ttsService\.speak\(|onBoundary|playbackIndexRef|playbackOffsetRef|tts\.voice" App.tsx components services types.ts
```

Expected: no legacy positional calls, boundary tracking, character-offset refs, or `tts.voice` accesses remain.

- [ ] **Step 12: Run all UI tests and the build**

Run:

```bash
npm run test:ui
npm run build
```

Expected: all tests pass and Vite builds successfully.

- [ ] **Step 13: Commit complete UI integration**

```bash
git add App.tsx App.test.tsx components/Article.tsx components/Article.test.tsx components/Quiz.tsx components/Quiz.test.tsx components/VocabularyPractice.tsx components/VocabularyPractice.test.tsx components/TTSFallbackNotice.tsx components/TTSFallbackNotice.test.tsx services/ttsService.ts index.css
git commit -m "Integrate sentence-aware TTS playback"
```

---

### Task 9: Document configuration, privacy, and production safeguards

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Test: `api/_lib/tts-config.test.ts`

**Interfaces:**
- Consumes: the final environment names and behavior from Tasks 2–8.
- Produces: operator instructions for Preview and Production rollout.

- [ ] **Step 1: Write a failing environment-contract test**

Extend `tts-config.test.ts` to read `.env.example` and assert it contains exactly these TTS variable names:

```ts
assert.match(example, /^TTS_ENABLED=/m);
assert.match(example, /^TTS_MODEL=/m);
assert.match(example, /^MISTRAL_API_KEY=/m);
```

Also assert no client-prefixed Mistral secret such as `VITE_MISTRAL_API_KEY` is present.

- [ ] **Step 2: Run the environment test and confirm it fails**

Run: `node --test api/_lib/tts-config.test.ts`

Expected: FAIL because `.env.example` does not yet contain `TTS_ENABLED` or `TTS_MODEL`.

- [ ] **Step 3: Update `.env.example` and README**

Add:

```dotenv
# Server-side Voxtral TTS. Set false for an immediate browser-only fallback.
TTS_ENABLED=true
# Optional override; defaults to voxtral-mini-tts-2603.
TTS_MODEL=
```

Update README features, stack, setup, known limitations, and privacy sections. State the seven supported LingoBlitz languages, Japanese/Mandarin fallback, preset-only scope, current documented price of `$0.016 per 1,000 characters` with a link and date qualifier, session-only audio caching, and that spoken text is sent to Mistral when Voxtral is selected.

Add a production checklist requiring a Vercel rate limit for `/api/tts/speech`, initially 60 requests per minute per source IP, before enabling Production.

- [ ] **Step 4: Run documentation contract tests and search for stale claims**

Run:

```bash
node --test api/_lib/tts-config.test.ts
rg -n "Web Speech API|does not store any data|third-party services|TTS:" README.md
```

Expected: the test passes; every search result is either updated to describe both providers or intentionally scoped to browser fallback.

- [ ] **Step 5: Run the complete verification suite**

Run:

```bash
npm test
npm run build
git diff --check
git status --short
```

Expected: tests and build exit 0, `git diff --check` reports nothing, and status lists only the intended documentation changes before commit.

- [ ] **Step 6: Commit documentation and configuration**

```bash
git add .env.example README.md api/_lib/tts-config.test.ts
git commit -m "Document Voxtral TTS configuration"
```

---

### Task 10: Perform final regression review and prepare the deployment handoff

**Files:**
- Review: all files changed by Tasks 1–9
- No production file is changed unless verification exposes a defect; any fix must receive its own failing regression test and commit.

**Interfaces:**
- Consumes: the complete feature.
- Produces: verified commit range and a concrete Vercel rollout checklist.

- [ ] **Step 1: Review the implementation against every spec section**

Use this checklist and record any gap before proceeding:

```text
supported languages and defaults
per-language/per-provider persistence and legacy migration
shared settings/onboarding UI and disclosure
all speech surfaces
sentence highlighting and oversized sentence chunks
pause/resume/stop/replacement
bounded prefetch, cancellation, and session cache cleanup
fallback from the failed sentence with one notice
safe endpoints, validation, timeouts, logging, and kill switch
accessibility, reduced motion, documentation, and tests
```

- [ ] **Step 2: Run fresh full verification**

Run:

```bash
npm test
npm run build
git diff --check
git status --short
```

Expected: all commands exit 0 and the working tree is clean. Do not report completion from earlier task outputs.

- [ ] **Step 3: Perform the local browser smoke test**

Run `npm run dev` and verify in the browser with mocked or Preview-backed endpoints:

1. German shows Voxtral by default and loads matching preset voices.
2. Japanese shows Browser and disables Voxtral.
3. A multi-sentence article starts after the first sentence audio is ready, preloads following sentences, and highlights exactly one current sentence.
4. Pause retains the highlight; resume continues; stop clears it.
5. A word click interrupts article playback and speaks only that word.
6. A forced Voxtral failure continues at the affected sentence with Browser and one notice.
7. Settings persist independently by language and source after reload.

- [ ] **Step 4: Prepare the Vercel handoff without exposing secrets**

Tell the operator to set or confirm these variables in Preview first, then Production:

```text
MISTRAL_API_KEY=<existing server-side secret>
TTS_ENABLED=true
TTS_MODEL=voxtral-mini-tts-2603  # optional because this is the default
```

Require the `/api/tts/speech` rate-limit rule before Production. Do not print or retrieve the secret value. Redeploy after environment changes, run the six-step production smoke test from the design spec, and inspect only safe structured logs.

- [ ] **Step 5: Request code review before merge or push**

Invoke `superpowers:requesting-code-review` on the full Voxtral implementation commit range. Resolve findings with focused tests, rerun Step 2, and then use `superpowers:finishing-a-development-branch` to present merge/push options to the user.
