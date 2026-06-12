// ── Telegram Bot Sync ────────────────────────────────────────────────────
// Free cloud backup using the user's own Telegram bot. The Bot API method
// endpoints allow CORS requests from browsers, so a static site can call
// them directly. The file-download endpoint does NOT send CORS headers,
// so backups are stored as TEXT messages instead of documents:
//
// Backup:  data JSON → base64 → ≤3800-char chunks → sendMessage each →
//          send an index message listing the chunk ids → pin the index.
// Restore: getChat → pinned index → forwardMessage each chunk to the same
//          chat (the response contains the text) → delete the forwarded
//          copies → reassemble → import.
//
// Every step is a Bot API method call, so the whole flow is CORS-safe.

import { Storage } from './storage.js';

const API = 'https://api.telegram.org';
const IDX_PREFIX = 'NOTY_INDEX::';
const CHUNK_PREFIX = 'NOTY_DATA::';
const CHUNK_SIZE = 3800; // Telegram message limit is 4096 chars

function cfg() {
  return {
    token: String(Storage.getSetting('tgToken', '')).trim(),
    chatId: String(Storage.getSetting('tgChatId', '')).trim(),
  };
}

export function tgConfigured() {
  const { token, chatId } = cfg();
  return !!(token && chatId);
}

async function tgCall(method, params) {
  const { token } = cfg();
  let res;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    });
  } catch {
    throw new Error('Network error — check your connection');
  }
  const data = await res.json().catch(() => ({ ok: false, description: 'Bad response' }));
  if (!data.ok) throw new Error(data.description || `${method} failed`);
  return data.result;
}

// Unicode-safe base64 — Telegram trims whitespace at message edges, so the
// payload must never start or end a chunk with trimmable characters.
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Verifies the token and returns bot info (also used as a connection test)
export function tgGetMe() {
  return tgCall('getMe');
}

// Finds the chat id from the most recent message sent to the bot.
// The user must message the bot (e.g. /start) before calling this.
export async function tgDetectChatId() {
  const updates = await tgCall('getUpdates', { limit: 100 });
  for (let i = updates.length - 1; i >= 0; i--) {
    const m = updates[i].message || updates[i].edited_message;
    if (m?.chat?.id) return m.chat.id;
  }
  throw new Error('No messages found — open your bot in Telegram and send /start first');
}

// Reads the currently pinned index (if any) and returns its chunk message
// ids plus the index message id itself, for cleanup after a new backup.
async function getOldBackupIds(chatId) {
  try {
    const chat = await tgCall('getChat', { chat_id: chatId });
    const pin = chat.pinned_message;
    if (!pin) return [];
    if (pin.text?.startsWith(IDX_PREFIX)) {
      const idx = JSON.parse(pin.text.slice(IDX_PREFIX.length));
      return [...(idx.ids || []), pin.message_id];
    }
    if (pin.document) return [pin.message_id]; // legacy document backup
    return [];
  } catch {
    return [];
  }
}

export async function tgBackup() {
  const { token, chatId } = cfg();
  if (!token || !chatId) throw new Error('Telegram sync not configured');

  const notes = Storage.getNotes();
  const payload = JSON.stringify({
    app: 'noty',
    version: 2,
    savedAt: new Date().toISOString(),
    notes,
    settings: Storage.getSettings(),
  });

  const encoded = b64encode(payload);
  const parts = [];
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
    parts.push(encoded.slice(i, i + CHUNK_SIZE));
  }

  const oldIds = await getOldBackupIds(chatId);

  const ids = [];
  for (let i = 0; i < parts.length; i++) {
    const m = await tgCall('sendMessage', {
      chat_id: chatId,
      text: `${CHUNK_PREFIX}${i + 1}/${parts.length}::${parts[i]}`,
      disable_notification: true,
    });
    ids.push(m.message_id);
  }

  const savedAt = new Date().toISOString();
  const idxMsg = await tgCall('sendMessage', {
    chat_id: chatId,
    text: IDX_PREFIX + JSON.stringify({ v: 2, ids, notes: notes.length, savedAt }),
    disable_notification: true,
  });
  await tgCall('pinChatMessage', {
    chat_id: chatId, message_id: idxMsg.message_id, disable_notification: true,
  });

  // Clean up the previous backup's messages
  for (const id of oldIds) {
    tgCall('deleteMessage', { chat_id: chatId, message_id: id }).catch(() => {});
  }

  Storage.setSetting('tgLastBackupAt', savedAt);
  return notes.length;
}

export async function tgRestore() {
  const { token, chatId } = cfg();
  if (!token || !chatId) throw new Error('Telegram sync not configured');

  const chat = await tgCall('getChat', { chat_id: chatId });
  const pin = chat.pinned_message;
  if (!pin) throw new Error('No backup found — run a backup first');
  if (pin.document) {
    throw new Error('Old backup format — click "Backup now" once on the device that has your notes, then retry');
  }
  if (!pin.text?.startsWith(IDX_PREFIX)) {
    throw new Error('No Noty backup found — run a backup first');
  }

  const idx = JSON.parse(pin.text.slice(IDX_PREFIX.length));
  let encoded = '';
  for (const id of idx.ids) {
    const fwd = await tgCall('forwardMessage', {
      chat_id: chatId, from_chat_id: chatId, message_id: id, disable_notification: true,
    });
    tgCall('deleteMessage', { chat_id: chatId, message_id: fwd.message_id }).catch(() => {});
    const t = fwd.text || '';
    if (!t.startsWith(CHUNK_PREFIX)) throw new Error('Backup chunk missing — run a fresh backup');
    const sep = t.indexOf('::', CHUNK_PREFIX.length);
    encoded += t.slice(sep + 2);
  }

  const data = JSON.parse(b64decode(encoded));
  if (data.app !== 'noty' || !Array.isArray(data.notes)) throw new Error('Invalid backup data');

  Storage.saveNotes(data.notes);
  if (data.settings) {
    // Keep this device's Telegram credentials — an old backup must not wipe them
    const cur = Storage.getSettings();
    Storage.saveSettings({
      ...data.settings,
      tgToken: cur.tgToken,
      tgChatId: cur.tgChatId,
    });
  }
  return { notes: data.notes.length, savedAt: data.savedAt };
}

// ── Auto-backup: debounced after note changes ───────────────────────────
let tgTimer = null;

export function scheduleTgBackup() {
  if (Storage.getSetting('tgAutoSync', 'false') !== 'true' || !tgConfigured()) return;
  clearTimeout(tgTimer);
  tgTimer = setTimeout(() => {
    tgBackup()
      .then(n => document.dispatchEvent(new CustomEvent('tg:backup-done', { detail: n })))
      .catch(err => document.dispatchEvent(new CustomEvent('tg:backup-fail', { detail: err.message })));
  }, 8000);
}

// Every note write goes through Storage.saveNotes, so one wrapper covers
// create, edit, delete, import, and batch operations. saveSettings is NOT
// wrapped — tgBackup itself writes settings and would loop.
export function initTgAutoSync() {
  const orig = Storage.saveNotes.bind(Storage);
  Storage.saveNotes = (notes) => { orig(notes); scheduleTgBackup(); };
}
