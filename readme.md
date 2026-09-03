# VideoMaker — Client-Side Narration Video Generator

A MoneyPrinterTurbo-style video maker that runs 100% in your browser. Enter a topic or paste a script, and it renders a narration-driven video with animated canvas scenes, word-level subtitles, background music and a WebM upload — no server required.

Live demo: https://antono4.github.io/videomaker

## Features

- Topic / script input — one sentence per scene; a built-in template generator drafts a placeholder script for any topic (pure client-side, no LLM).
- Canvas scenes — per-scene Ken Burns zoom, drifting particles, gradient palettes and a topic header card.
- Text-to-speech narration — meSpeak (eSpeak compiled to JS) synthesizes speech locally; voice data is vendored so nothing is fetched at runtime.
- Word-level subtitles — each scene's subtitle is highlighted word-by-word in sync with the narration.
- Background music — a procedurally generated ambient pad (seamless 16 s loop, synthesized in-browser with the Web Audio API) or your own uploaded audio file.
- Export — captures the canvas and the mixed Web Audio graph with MediaRecorder and produces a real-time-rendered .webm video you can download.

## Files

| File                | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| index.html          | App shell, control tabs and preview layout       |
| styles.css          | Dark studio theme                                |
| app.js              | App logic: script, TTS, audio graph, rendering, export |
| vendor/mespeak/     | Vendored meSpeak engine, worker core and voice data |

## Run it

Open index.html in a modern browser (Chrome, Edge, Firefox or Safari), or serve the folder:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

All processing happens locally — audio synthesis, scene rendering and video encoding never leave your machine.

## Usage notes

- The Generate script button produces a template script for the topic you typed. For real content, paste your own script (one sentence per scene) and press Apply script.
- Narration is synthesized with eSpeak once the speech engine finishes loading.
- Render WebM records the preview in real time; a 1-minute video takes about 1 minute to export.

## License

The application code is MIT. The vendored meSpeak engine and eSpeak data are GNU GPL (see the vendor directory headers).
