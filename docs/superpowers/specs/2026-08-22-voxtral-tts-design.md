# Voxtral TTS Integration Design

Date: 2026-08-22

## Summary

LingoBlitz will add Mistral Voxtral TTS as the default speech source for every supported learning language while retaining the browser Web Speech API as a selectable alternative and automatic fallback. A provider-neutral playback controller will give articles, quizzes, vocabulary practice, word clicks, settings previews, and onboarding one consistent interface.

Longer visible text will be divided into sentences. Each sentence will be generated and played as a separate audio unit, with the currently spoken sentence highlighted exactly for the duration of that unit. The next units will be prefetched to minimize gaps. Browser speech will use the same sentence units so the visual behavior remains consistent across providers.

## Goals

- Use Voxtral TTS for all speech surfaces when the learning language is supported.
- Make Voxtral the default for supported languages and browser speech the default for unsupported languages.
- Let users explicitly choose Voxtral preset voices or locally installed browser voices.
- Fall back automatically to browser speech when Voxtral is unavailable, without replaying completed sentences.
- Display a short, non-blocking fallback notice.
- Highlight the sentence that is currently being spoken.
- Keep the Mistral API key server-side.
- Keep TTS independent of the configured text-generation provider so switching between Mistral and OpenAI remains straightforward.
- Keep the implementation open to future TTS adapters without exposing provider details to UI components.

## Non-goals

- Custom voice creation or voice cloning.
- Word-level highlighting for Voxtral.
- Persistent storage of generated audio between browser sessions.
- Offline Voxtral playback.
- Native PCM streaming in the first version.
- Adding Hindi or Arabic as LingoBlitz learning languages.

## Supported languages

Voxtral TTS supports English, French, German, Spanish, Dutch, Portuguese, Italian, Hindi, and Arabic. The intersection with the current LingoBlitz language list is:

- English
- French
- German
- Spanish
- Dutch
- Portuguese
- Italian

Japanese and Mandarin Chinese remain browser-only. Hindi and Arabic are not exposed because they are not currently LingoBlitz learning languages.

Language mapping will be centralized rather than duplicated across settings and playback code. It will map the `Language` enum to the language codes returned by the Mistral Voices API and to the locales used by browser speech.

## User experience

### Defaults and migration

- Voxtral is selected by default for every supported learning language.
- Browser speech is selected automatically for Japanese and Mandarin Chinese.
- Existing saved browser voice names are preserved during settings migration.
- After migration, supported languages select Voxtral, while the previous browser voice remains available if the user switches back.
- Provider and voice preferences are stored per learning language.
- Voxtral and browser voice choices are stored independently so switching sources does not discard either selection.
- Speed and automatic-reading preferences remain shared across sources.

The revised settings shape will represent:

- the selected provider for each learning language;
- the selected Voxtral voice ID for each learning language;
- the selected browser voice name for each learning language;
- the shared playback speed;
- the shared automatic-reading preference.

Migration must accept the current `{ voice, speed, autoRead }` shape and must not discard a previously selected browser voice.

### Settings and onboarding

The voice section first presents a source selector:

- **Voxtral**
- **Browser**

The voice list below it displays only voices from the selected source that match the active learning language. Voxtral preset voices are loaded dynamically through the LingoBlitz backend. Custom voices are not returned. Browser voices continue to come from `window.speechSynthesis`.

For Japanese and Mandarin Chinese, Voxtral is shown as unavailable and cannot be selected. Browser speech is active automatically.

When no Voxtral voice has been saved for a supported language, the first compatible preset returned by the API is selected and persisted for that language. If voices cannot be loaded, the UI remains usable with browser speech.

Both sources retain the existing preview button, speed control, and automatic-reading option. Voxtral playback speed is applied through the browser audio player's `playbackRate`, because the Voxtral speech request does not expose a speed parameter.

A short disclosure near the Voxtral selector explains that text being read aloud is sent to Mistral to generate audio.

Settings and onboarding will share the same voice-source and voice-list component to avoid behavioral drift.

### Playback and highlighting

Every visible text surface uses the same playback controller:

- article title and body;
- quiz question and choices where speech is currently offered;
- vocabulary practice content;
- clicked words;
- voice previews in settings and onboarding.

Text containing multiple sentences is segmented before playback. `Intl.Segmenter` with sentence granularity is preferred, with a tested fallback for browsers that do not support it. Sentence segmentation must handle common abbreviations, quotations, and terminal punctuation. A grammatical sentence longer than 250 words may be divided into smaller audio chunks at safe clause or whitespace boundaries, while the same visible sentence remains highlighted across those internal chunks.

The playback controller emits the active visible segment identifier. Components render addressable spans or containers and apply a soft highlight to the active sentence. For a single word or another indivisible short label, the whole visible element is the active segment.

Highlight transitions are tied to actual audio-unit events, not estimated word timings:

- highlight when the audio unit begins playback;
- retain the highlight while paused;
- clear or advance it when the unit ends;
- clear it when playback is stopped or replaced.

Browser speech also runs one visible sentence at a time and reports the same lifecycle events. This gives both providers identical highlight behavior.

## Architecture

### Provider-neutral controller

UI components call one TTS controller instead of calling `speechSynthesis` or Voxtral directly. The controller owns:

- language support and provider selection;
- sentence segmentation and the playback queue;
- play, pause, resume, stop, and replacement behavior;
- active-sentence events;
- prefetching and cancellation;
- session audio caching;
- automatic fallback and user notification.

The controller delegates provider-specific work to adapters with a common contract. An adapter can prepare an audio unit, start it, pause it, resume it, stop it, and report lifecycle events. Provider-specific objects such as `SpeechSynthesisUtterance` and `HTMLAudioElement` do not escape their adapters.

### Browser adapter

The browser adapter incorporates the existing voice discovery, language matching, and `speechSynthesis` behavior. It speaks one sentence unit at a time. Existing platform-specific voice sorting and default selection remain available.

### Voxtral adapter

The Voxtral adapter requests MP3 audio through the LingoBlitz API, creates a browser audio object, and applies the configured playback rate. It preloads a small bounded number of upcoming sentences and uses `AbortController` to cancel requests that are no longer needed.

The first implementation uses complete MP3 responses rather than native PCM streaming. Sentence-level progressive generation still allows playback to begin after the first sentence is ready and keeps the implementation reliable across browsers and Vercel. The adapter boundary permits a future streaming implementation without changing UI components.

### Session cache

Generated audio is cached only in memory for the current browser session. The key includes normalized spoken text, Voxtral voice ID, model, and language. Playback speed is not part of the key because it is applied client-side.

The cache has bounded entry and byte limits and evicts least-recently-used items. Blob object URLs are revoked on eviction and shutdown. Failed and aborted responses are never cached.

### Provider independence

TTS configuration is separate from `AI_PROVIDER` and `AI_MODEL`. Voxtral TTS can remain enabled while article generation uses OpenAI. Conversely, missing TTS configuration must not affect article generation.

## Server API

### `GET /api/tts/voices`

Query parameter:

- `language`: a supported LingoBlitz language identifier.

Behavior:

1. Validate and normalize the language.
2. Request preset voices from Mistral using `GET /v1/audio/voices` with `type=preset`.
3. Filter the result to voices whose language metadata matches the requested language.
4. Return only the fields needed by the UI, such as ID, name, language metadata, gender, and description when present.
5. Cache the upstream preset list briefly in the serverless process and cache the filtered result in the browser session. The design must not assume serverless process caches are durable.

The endpoint never returns custom voices or sample audio.

### `POST /api/tts/speech`

Request body:

- `text`: one normalized audio chunk;
- `language`: the selected supported language;
- `voiceId`: a compatible preset voice ID.

Behavior:

1. Validate method, body shape, language, text length, and voice compatibility.
2. Call Mistral `POST /v1/audio/speech` with the configured model, `response_format=mp3`, the text, and the preset voice ID.
3. Decode Mistral's Base64 audio response on the server.
4. Return binary `audio/mpeg` with conservative cache and content-type headers.

The server rejects empty text, unsupported languages, unknown or incompatible voices, and oversized chunks. A single request is capped at 2,000 characters and 250 words. The normal segmenter targets smaller sentence-sized requests.

## Configuration

- `MISTRAL_API_KEY`: used server-side for Voxtral as well as Mistral text generation when applicable.
- `TTS_MODEL`: optional model override; defaults to `voxtral-mini-tts-2603`.
- `TTS_ENABLED`: optional kill switch. Voxtral is available when this is not explicitly `false` and `MISTRAL_API_KEY` is present.

If Voxtral is disabled or the key is absent, the backend returns a stable availability error and the client uses browser speech. This state does not change the user's saved preference, so Voxtral resumes automatically after configuration is restored.

## Fallback and error handling

The current playback operation switches to browser speech for the failed sentence and all remaining sentences when any Voxtral preparation or playback error occurs. Completed sentences are not repeated. The saved provider preference remains Voxtral for the next independent playback attempt.

Fallback applies to:

- unsupported languages;
- missing or invalid configuration;
- request timeouts and network failures;
- rate limits and exhausted quota;
- moderation rejection;
- invalid upstream responses;
- audio decoding or playback failures.

The controller shows one non-blocking message per playback operation:

> Voxtral ist gerade nicht verfügbar – Browser-Stimme wird verwendet.

The message is not shown for languages that are known to be browser-only, because browser speech is the expected provider there.

Client responses contain stable error categories and safe messages, not upstream headers, stack traces, credentials, or raw provider responses. Server logs contain request IDs, status categories, language, provider, model, duration, and character counts, but never complete text or API keys.

## Concurrency, cancellation, and cost controls

- Starting a new playback stops the active provider, clears highlighting, and cancels queued or in-flight prefetches.
- Voxtral prefetch concurrency is capped at three requests per browser.
- The controller preloads only a small look-ahead window rather than the entire article.
- Request size limits are enforced on both client and server.
- `/api/tts/*` receives a Vercel rate-limit rule before production rollout. The initial target is 60 speech-generation requests per minute per source IP, reviewed after observing normal usage. Voice-list requests may use a less restrictive cached route policy.
- `TTS_ENABLED=false` provides an immediate operational shutdown without a code deployment.

## Text normalization

Normalization removes Markdown syntax, unsupported control characters, and emojis that Mistral documents as harmful to output quality. It preserves the wording and sentence relationship required for highlighting. Numbers and abbreviations are not rewritten generically because their spoken form is language- and context-dependent; existing article-generation prompts should continue producing learner-friendly text. Targeted normalization rules may be added later with language-specific tests.

The displayed text remains unchanged. Only the copy sent to a speech adapter is normalized.

## Accessibility

- Sentence highlighting must preserve sufficient light- and dark-mode contrast without relying on color alone.
- Playback controls retain accessible names and keyboard operation.
- Loading, pause, and fallback states are exposed through existing status patterns without repeatedly interrupting screen readers.
- Highlighting is visual context only and does not move keyboard focus.
- Reduced-motion preferences disable animated highlight transitions.

## Testing strategy

### Unit tests

- supported-language mapping and provider defaults;
- migration from the current TTS settings shape;
- per-language and per-provider voice persistence;
- sentence segmentation, including abbreviations, quotations, punctuation, and oversized sentences;
- text normalization;
- queue order, bounded prefetch, cancellation, cache eviction, and Blob URL cleanup;
- provider selection and one-time fallback notification;
- resumption from the failed sentence without repeating completed text.

### Adapter and API tests

- browser voice filtering and sentence lifecycle callbacks;
- Voxtral MP3 preparation, playback rate, pause, resume, stop, and audio errors;
- voices endpoint filtering preset voices by language;
- speech endpoint validation, upstream request mapping, Base64 decoding, and audio headers;
- safe handling of missing keys, timeouts, 403, 429, malformed data, and provider 5xx errors;
- verification that logs and client errors do not expose text or secrets.

All provider responses are mocked in automated tests. Tests must not consume live Mistral credits.

### Component and integration tests

- provider and voice selection in settings and onboarding;
- Voxtral unavailable states for Japanese and Mandarin Chinese;
- preview playback for both providers;
- active-sentence highlighting through play, pause, resume, sentence transition, replacement, and stop;
- browser fallback beginning at the failed sentence;
- loading and fallback notice behavior.

### Manual production smoke test

After deployment:

1. Verify voice loading and playback in one supported language.
2. Verify sentence highlighting and preloading on a multi-sentence article.
3. Verify pause, resume, speed, replacement, and stop.
4. Temporarily provoke a safe Voxtral failure and confirm browser fallback plus the one-time notice.
5. Verify Japanese or Mandarin Chinese remains browser-only.
6. Check Vercel logs for safe structured metadata and confirm the rate-limit rule is active.

## Rollout

1. Deploy configuration and backend endpoints with Voxtral gated by `TTS_ENABLED`.
2. Deploy the provider-neutral controller, adapters, settings migration, and UI changes.
3. Enable Voxtral in Preview and complete the manual smoke test.
4. Configure the production rate-limit rule.
5. Enable Voxtral in Production.
6. Monitor provider errors, fallback frequency, request latency, and character volume without logging spoken text.

## Documentation updates

Implementation includes updates to `.env.example` and `README.md` covering:

- Voxtral and browser voice behavior;
- supported languages;
- environment variables and fallback behavior;
- the transmission of spoken text to Mistral;
- API cost and operational controls;
- browser-only limitations that still apply to unsupported languages.

## Official references

- [Speaking of Voxtral](https://mistral.ai/news/voxtral-tts/)
- [Mistral Text to Speech](https://docs.mistral.ai/studio/audio/text_to_speech)
- [Speech Generation](https://docs.mistral.ai/studio/audio/text_to_speech/speech)
- [Audio Speech API](https://docs.mistral.ai/api/endpoint/audio/speech)
- [Audio Voices API](https://docs.mistral.ai/api/endpoint/audio/voices)
- [Voxtral TTS model card](https://docs.mistral.ai/models/voxtral-tts-26-03)
