import { Storage } from './storage.js';

// ── Known free-tier limits (source: AI Studio rate-limit dashboard, June 2026) ──────────
export const KNOWN_LIMITS = {
  // Free quota — usable without billing
  'gemini-3.1-flash-lite':  { label: 'Gemini 3.1 Flash Lite',  rpm: 15, rpd: 500, tpm: 250000, tier: 'free', rec: '★ Best RPD' },
  'gemini-2.5-flash-lite':  { label: 'Gemini 2.5 Flash Lite',  rpm: 10, rpd: 20,  tpm: 250000, tier: 'free', rec: '' },
  'gemini-3.5-flash':       { label: 'Gemini 3.5 Flash',       rpm: 5,  rpd: 20,  tpm: 250000, tier: 'free', rec: 'Latest' },
  'gemini-2.5-flash':       { label: 'Gemini 2.5 Flash',       rpm: 5,  rpd: 20,  tpm: 250000, tier: 'free', rec: '' },
  'gemini-3-flash-preview': { label: 'Gemini 3 Flash Preview', rpm: 5,  rpd: 20,  tpm: 250000, tier: 'free', rec: '' },
  // No free quota — billing required
  'gemini-2.5-pro':         { label: 'Gemini 2.5 Pro',         rpm: 0,  rpd: 0,   tpm: 0,      tier: 'none', rec: '' },
  'gemini-2.0-flash':       { label: 'Gemini 2.0 Flash',       rpm: 0,  rpd: 0,   tpm: 0,      tier: 'none', rec: '' },
  'gemini-2.0-flash-lite':  { label: 'Gemini 2.0 Flash Lite',  rpm: 0,  rpd: 0,   tpm: 0,      tier: 'none', rec: '' },
  'gemini-3.1-pro-preview': { label: 'Gemini 3.1 Pro Preview', rpm: 0,  rpd: 0,   tpm: 0,      tier: 'none', rec: '' },
};

// Fallback order: highest RPD first, then highest RPM
const FALLBACK_CHAIN = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
];

// ── Usage tracking (localStorage, per day per model) ──────────────────
const USAGE_KEY      = 'noty_usage';
const EXHAUSTED_KEY  = 'noty_exhausted';

export function trackUsage(model) {
  const today = new Date().toISOString().slice(0, 10);
  const usage = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
  if (!usage[today]) usage[today] = {};
  usage[today][model] = (usage[today][model] || 0) + 1;
  localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
}

export function getTodayUsage() {
  const today = new Date().toISOString().slice(0, 10);
  return JSON.parse(localStorage.getItem(USAGE_KEY) || '{}')[today] || {};
}

export function markExhausted(model) {
  const today = new Date().toISOString().slice(0, 10);
  const ex = JSON.parse(localStorage.getItem(EXHAUSTED_KEY) || '{}');
  if (!ex[today]) ex[today] = [];
  if (!ex[today].includes(model)) ex[today].push(model);
  localStorage.setItem(EXHAUSTED_KEY, JSON.stringify(ex));
  window.dispatchEvent(new CustomEvent('noty:model-exhausted', { detail: { model } }));
}

export function getExhaustedToday() {
  const today = new Date().toISOString().slice(0, 10);
  return JSON.parse(localStorage.getItem(EXHAUSTED_KEY) || '{}')[today] || [];
}

function isRateLimitError(msg) {
  return /quota|429|RESOURCE_EXHAUSTED|rate.?limit/i.test(msg);
}

// ── Core call ──────────────────────────────────────────────────────────
async function callModel(model, prompt) {
  const key = Storage.getSetting('apiKey');
  if (!key) throw new Error('NO_API_KEY');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  trackUsage(model);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function call(prompt) {
  const primary = Storage.getSetting('aiModel', 'gemini-3.1-flash-lite');
  const autoSwitch = Storage.getSetting('autoSwitch', 'true') === 'true';

  try {
    return await callModel(primary, prompt);
  } catch (e) {
    if (!isRateLimitError(e.message)) throw e;
    markExhausted(primary);
    if (!autoSwitch) throw e;

    // Try fallbacks in order
    for (const model of FALLBACK_CHAIN) {
      if (model === primary) continue;
      try {
        const result = await callModel(model, prompt);
        Storage.setSetting('aiModel', model);
        window.dispatchEvent(new CustomEvent('noty:model-switched', { detail: { from: primary, to: model } }));
        return result;
      } catch (e2) {
        if (!isRateLimitError(e2.message)) throw e2;
        markExhausted(model);
      }
    }
    throw e;
  }
}

function extractJSON(text) {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                text.match(/```\s*([\s\S]*?)\s*```/) ||
                text.match(/(\[[\s\S]*\])/);
  if (match) {
    try { return JSON.parse(match[1]); } catch {}
  }
  try { return JSON.parse(text); } catch {}
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────
export const AI = {
  async summarize(content) {
    return call(`Summarize the following notes in 3-5 concise bullet points. Focus on key concepts and insights. Return plain text bullet points starting with •.\n\n${content}`);
  },

  async generateFlashcards(content) {
    const raw = await call(`Generate 6-10 flashcards from the following notes. Return ONLY a JSON array:\n[\n  {"question": "...", "answer": "..."},\n  ...\n]\nNo other text.\n\n${content}`);
    const cards = extractJSON(raw);
    if (!Array.isArray(cards)) throw new Error('Could not parse flashcards from AI response');
    return cards.filter(c => c.question && c.answer);
  },

  async generateQuiz(content) {
    const raw = await call(`Generate 5 multiple-choice quiz questions from the following notes. Return ONLY a JSON array:\n[\n  {\n    "question": "...",\n    "options": ["A", "B", "C", "D"],\n    "correct": 0,\n    "explanation": "..."\n  },\n  ...\n]\nThe "correct" field is the 0-based index of the correct option. No other text.\n\n${content}`);
    const questions = extractJSON(raw);
    if (!Array.isArray(questions)) throw new Error('Could not parse quiz from AI response');
    return questions.filter(q => q.question && Array.isArray(q.options) && typeof q.correct === 'number');
  },

  async renameNote(content) {
    const raw = await call(`Generate a short, descriptive title (5-8 words max) for this note. Return ONLY the title text, no quotes, no punctuation at end.\n\n${content.slice(0, 1000)}`);
    return raw.trim().replace(/^["']|["']$/g, '').replace(/\.$/, '');
  },

  async categorize(content, existingCategories = []) {
    const hint = existingCategories.length
      ? `Existing categories: ${existingCategories.join(', ')}. Reuse one if it fits.`
      : '';
    const raw = await call(`Assign a broad, general category to this note (e.g. Technology, Science, Health, Business, Personal, Learning, History, Philosophy, Finance, Productivity). ${hint}\nUse 1-2 words max. Prefer reusing an existing category over creating a new one. Return ONLY the category name, no punctuation, no quotes.\n\n${content.slice(0, 800)}`);
    return raw.trim().replace(/^["'`]|["'`]$/g, '').replace(/\.$/, '');
  },

  async atomize(content, existingNotes = []) {
    const vaultList = existingNotes
      .slice(0, 60)
      .map((n, i) => `${i}: ${n.title || 'Untitled'}`)
      .join('\n');
    const raw = await call(`Break the following note into atomic notes using the Zettelkasten method.
Rules:
- Each atom = ONE focused idea (2-4 sentences), fully self-contained and understandable without the original note
- Title is a specific claim or concept (e.g. "Spaced repetition exploits the forgetting curve"), not a vague topic
- "links": indices of OTHER atoms in your array that this atom directly relates to or builds on
${vaultList ? `- "existing": indices of vault notes (listed below) this atom clearly relates to; [] if none

Vault notes:
${vaultList}` : ''}

Return ONLY a JSON array:
[
  {"title": "...", "content": "...", "links": [1], "existing": []},
  ...
]
Aim for 3-8 atoms. No other text.

NOTE TO ATOMIZE:
${content}`);
    const atoms = extractJSON(raw);
    if (!Array.isArray(atoms)) throw new Error('Could not parse atoms from AI response');
    return atoms.filter(a => a.title && a.content);
  },

  async linkConcepts(notes) {
    if (notes.length < 2) return [];
    const titles = notes.map((n, i) => `${i}: ${n.title}`).join('\n');
    const raw = await call(`Given these notes:\n${titles}\n\nReturn a JSON array of conceptual links between notes. Only link if clearly related:\n[{"source": 0, "target": 1, "label": "related concept"}, ...]\nReturn [] if no strong connections. No other text.`);
    return extractJSON(raw) || [];
  },

  async listModels() {
    const key = Storage.getSetting('apiKey');
    if (!key) throw new Error('NO_API_KEY');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => ({
        id: m.name.replace('models/', ''),
        label: m.displayName,
        inputLimit: m.inputTokenLimit,
        outputLimit: m.outputTokenLimit,
      }));
  },
};
