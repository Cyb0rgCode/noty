# Noty — AI-Powered Learning Notes

A smart note-taking app with AI features powered by Google Gemini. Works entirely in the browser — no backend, all data stored locally.

## Features

- **Notes** — rich text editor with tags, categories, and auto-rename via AI
- **Flashcards** — spaced-repetition review (SM-2 algorithm) with keyboard shortcuts
- **Quiz** — AI-generated multiple-choice quizzes, saved per note for replay
- **Mind Map** — force-directed graph linking notes by shared tags + AI-detected concepts
- **AI Summarize / Atomize** — summarize notes or break them into atomic concepts
- **Voice Input** — speech-to-text transcription
- **Auto-switch** — falls back to next Gemini model automatically on rate-limit
- **Telegram Sync** — free cloud backup via your own Telegram bot: notes auto-save to your private chat and restore on any device (Settings → Telegram Sync → Setup guide)

## Setup

1. Get a free API key at [aistudio.google.com](https://aistudio.google.com)
2. Open the app → Settings → paste your key
3. Start taking notes

## Tech

Vanilla JS (ES modules), no build tools, CSS custom properties, Google Gemini API.

## Live Demo

[https://Cyb0rgCode.github.io/noty](https://Cyb0rgCode.github.io/noty)
