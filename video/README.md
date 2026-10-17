# PrioriHealth overview video

A ~60 second animated explainer, built in code with [Remotion](https://www.remotion.dev) (free for individuals and teams of up to 3). The voiceover uses [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), a free open-source neural voice that runs locally (voice `af_heart`). Everything is free and offline.

```bash
cd video
npm install
npm run voice      # regenerate narration from voice/script.json (Kokoro, needs uv)
npm run voice:mac  # fallback: macOS built-in voice
npm run studio   # live preview in the browser, scrub the timeline
npm run render   # writes out/priorihealth-overview.mp4
```

- **Change the words:** edit `voice/script.json`, then `npm run voice`. Scene lengths follow the new audio automatically.
- **Change the voice:** set `kokoro.voice` in the same file (e.g. `af_heart`, `af_bella`, `am_michael`, `bf_emma`) and `kokoro.speed`. A scene's optional `say` field overrides pronunciation.
- **Kokoro model files** (one-time, ~350 MB, gitignored) go in `video/.models/`:
  `kokoro-v1.0.onnx` and `voices-v1.0.bin` from https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
- **Scenes:** `src/scenes/*.tsx`; outline figures in `src/figures.tsx`; colors in `src/theme.ts`.
