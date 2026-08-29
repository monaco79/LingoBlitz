# LingoBlitz 2.0 🚀

**Fast, Interactive Language Learning with AI**

LingoBlitz generates short, level-appropriate reading articles in your target language, helping you learn through engaging content matched to your interests and proficiency level.

> **Version 2.0**

## © Copyright

Copyright (c) 2025, Jurek Vengels.
Licensed under CC BY-NC 4.0.

---

## ✨ Features

- ⚡ **Lightning-fast article generation** - Articles generated using Mistral Large 3 or OpenAI GPT-4o
- 🔊 **Text-to-Speech (TTS)** - Choose server-side Mistral Voxtral voices or local browser voices
  - Voxtral supports English, French, German, Spanish, Dutch, Portuguese, and Italian
  - Japanese and Chinese (Mandarin) use browser speech; browser speech is also the automatic fallback when Voxtral is unavailable
  - Voxtral uses Mistral preset voices only; custom voice training or uploads are not supported
  - Auto-play articles after generation
  - Adjustable playback speed (0.6x - 1.4x)
  - Pause/resume/stop controls
  - Speed auto-adjusts by proficiency level
- 📚 **Adaptive content** - Content tailored to 6 proficiency levels (Absolute Beginner to C1)
- 🎯 **Personalized topics** - AI suggests topics based on your interests
- 💬 **Interactive vocabulary** - Click any word for instant translations
- ✅ **Comprehension quizzes** - Test your understanding with AI-generated questions
- 🎓 **Vocabulary practice** - Review and practice words from your articles with flashcards
- 🌙 **Dark mode** - Comfortable reading in any lighting condition
- 🎨 **Beautiful design** - Modern gradient UI with Poppins & Aleo typography

---

## 📖 How to Use

### First Time Setup (Onboarding)

1. **Select your languages** - Choose your native language and the language you want to learn
2. **Set your level** - Choose from Absolute Beginner to C1
3. **Pick your interests** - Select topics you're interested in (e.g., Food, Travel, True Crime)
4. **Configure voice settings** - Select your preferred TTS voice, speed, and auto-play preferences

### Learning Flow

1. **Choose a Blitz** - Select from AI-generated topic suggestions matched to your interests or choose any topic you want
2. **Read & Listen** - Read a short article while optionally listening to voice playback
3. **Click words** - Get instant translations for any word you don't know
4. **Take a Quiz** - Test your comprehension with an AI-generated question
5. **Practice Vocabulary** - Review words you clicked using flashcards
6. **Repeat** - Get new topic suggestions and continue learning!

---

## 📱 Add to Home Screen

For the best experience on mobile, you can add LingoBlitz to your home screen to use it like a native app:

**iOS (Safari):**
1. Tap the **Share** button (square with arrow up).
2. Scroll down and tap **"Add to Home Screen"**.
3. Tap **Add**.

**Android (Chrome):**
1. Tap the **Menu** button (three dots).
2. Tap **"Add to Home screen"** or **"Install app"**.
3. Follow the prompts to install.

---

## 🛠 Tech Stack

- **Frontend:** React 19 with TypeScript
- **Styling:** Tailwind CSS
- **Fonts:** Poppins (UI), Aleo (Article content)
- **Build Tool:** Vite
- **AI/ML:** Configurable Mistral or OpenAI Chat Completions API
- **TTS:** Mistral Voxtral Mini TTS through server-side Vercel API routes, with Web Speech API browser fallback

### AI provider configuration

The AI provider and model are selected through environment variables, without code changes:

| Variable | Mistral | OpenAI |
| --- | --- | --- |
| `AI_PROVIDER` | `mistral` | `openai` |
| `AI_MODEL` | `mistral-large-2512` | `gpt-4o` |
| API key | `MISTRAL_API_KEY` | `OPENAI_API_KEY` |

`AI_MODEL` is optional. When it is empty, the application uses the selected provider's default model (`mistral-large-2512` or `gpt-4o`). OpenAI remains the default provider when `AI_PROVIDER` is not set.

For a safe Vercel switch, first add `MISTRAL_API_KEY` to every affected project and the required Production/Preview environments. Then set `AI_PROVIDER=mistral`, leave `AI_MODEL` empty unless you want an explicit override, and redeploy. To return to OpenAI, set `AI_PROVIDER=openai`, ensure `OPENAI_API_KEY` is available, and clear `AI_MODEL` (or set it to an OpenAI model such as `gpt-4o`) before redeploying. Copy `.env.example` for local development.

### Voxtral TTS configuration

Voxtral is configured only on the server. Set these variables in local development and in the appropriate Vercel Preview and Production environments:

| Variable | Required | Purpose |
| --- | --- | --- |
| `MISTRAL_API_KEY` | Yes for Voxtral | Server-side Mistral API credential. Never expose it as `VITE_MISTRAL_API_KEY` or any other `VITE_*` variable. |
| `TTS_ENABLED` | No | Set `false` to disable Voxtral immediately and use browser speech only. It defaults to enabled when a Mistral key is present. |
| `TTS_MODEL` | No | Optional Voxtral model override; blank defaults to `voxtral-mini-tts-2603`. |

Voxtral voice choices are limited to the preset voices returned by Mistral. It currently supports English, French, German, Spanish, Dutch, Portuguese, and Italian. Japanese and Chinese (Mandarin) stay on the browser provider. If a Voxtral request, voice lookup, or playback fails, LingoBlitz continues with the selected browser voice when available.

**Cost:** As documented by Mistral on 2026-08-23, Voxtral Mini TTS is priced at **$0.016 per 1,000 characters**. Confirm the current rate before rollout: [Mistral Voxtral Mini TTS model documentation](https://docs.mistral.ai/models/voxtral-mini-tts-2603/).

### Production rollout checklist

- Add `MISTRAL_API_KEY`, `TTS_ENABLED=true`, and any intended `TTS_MODEL` override to Vercel Preview first; never create a client-exposed `VITE_MISTRAL_API_KEY`.
- Verify supported-language voices and browser fallback in Preview, including Japanese and Chinese (Mandarin).
- Before enabling Voxtral in Production, configure a Vercel-compatible rate limit for `POST /api/tts/speech`: initially **60 requests per minute per source IP**. Monitor rejected requests and Mistral usage, then adjust deliberately.
- Roll out to Production only after the rate limit is active; set `TTS_ENABLED=false` for an immediate browser-only rollback.

---

## ⚠️ Known Issues & Limitations

### Mobile Text-to-Speech (TTS)
Browser speech uses the browser's built-in Web Speech API and depends on voices installed by the operating system. It remains available as the selected provider, for Japanese and Chinese (Mandarin), and whenever Voxtral cannot be used. Its mobile limitations include:

- **iOS (Safari/Chrome):** Voice selection is limited by Apple. You may need to download high-quality voices in your iOS System Settings (Accessibility > Spoken Content > Voices) to hear them in the browser.
- **Edge Mobile (Android):** Voice loading can be inconsistent. If no voices are detected, the app will still function, but audio features may be disabled.
- **Background Playback:** Audio stops if you lock the screen or switch tabs (browser limitation).

---

## Data Privacy

LingoBlitz stores your theme and learning settings in your browser's local storage. It does not use a LingoBlitz database for those settings or for generated audio.

- **Browser speech:** When Browser is selected, speech is generated by the local browser/operating-system speech service; LingoBlitz does not send the spoken text to its TTS API.
- **Mistral processing:** To generate articles, quizzes, and translations, the app sends the request data needed for that operation to the configured AI provider (Mistral AI or OpenAI). When Voxtral is selected, the text being spoken and the selected preset voice are sent to Mistral through the server-side TTS route to generate audio. Review the applicable provider privacy terms for how API data is handled.
- **Audio caching:** Returned Voxtral audio is held only in an in-memory browser-session cache to make repeat playback faster. It is not persisted to local storage, and the TTS response is marked `private, no-store` by the server.

---

## 📄 License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)**.

**In summary, this means:**

1.  **Allowed:** You are free to copy, modify, distribute, and use the code.
2.  **Required:** You must give appropriate credit to the original creator (Name or organization).
3.  **Restricted:** Use is **strictly for non-commercial purposes only**.

---

## 🙏 Acknowledgments

- **AI Assistance:** This project (v2.0) was built with the help of **Google Gemini** (2.5 Pro & 3 Pro) and **Claude** (Sonnet 4.5).
- **AI providers:** [Mistral AI](https://mistral.ai/) and [OpenAI](https://openai.com/)
- **Fonts:** [Google Fonts](https://fonts.google.com/)
- **Icons:** Heroicons

---

## 📝 Contact

For questions or feedback, please contact Jurek at jurek.vengels@lingoblitz.com.
