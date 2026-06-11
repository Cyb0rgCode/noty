// ── Telegram Bot Sync ────────────────────────────────────────────────────
// Free cloud backup using the user's own Telegram bot. The Bot API allows
// CORS requests from browsers, so a static site can call it directly.
//
// Backup:  data JSON → sendDocument to the user's private chat → pin it.
// Restore: getChat → pinned_message.document → getFile → download → import.
// The pinned message is the source of truth, so a brand-new device only
// needs the bot token + chat id to pull the latest backup.

import { Storage } from './storage.js';

const API = 'https://api.telegram.org';

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
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const data = await res.json().catch(() => ({ ok: false, description: 'Bad response' }));
  if (!data.ok) throw new Error(data.description || `${method} failed`);
  return data.result;
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

export async function tgBackup() {
  const { token, chatId } = cfg();
  if (!token || !chatId) throw new Error('Telegram sync not configured');

  const payload = {
    app: 'noty',
    version: 1,
    savedAt: new Date().toISOString(),
    notes: Storage.getNotes(),
    settings: Storage.getSettings(),
  };

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('document',
    new Blob([JSON.stringify(payload)], { type: 'application/json' }),
    'noty-backup.json');
  form.append('disable_notification', 'true');
  form.append('caption', `Noty backup · ${payload.notes.length} notes · ${new Date().toLocaleString()}`);

  const res = await fetch(`${API}/bot${token}/sendDocument`, { method: 'POST', body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Upload failed');
  const msg = data.result;

  // Pin the new backup so restore can always find the latest via getChat,
  // then delete the previous backup message to keep the chat clean.
  try {
    await tgCall('pinChatMessage', {
      chat_id: chatId, message_id: msg.message_id, disable_notification: true,
    });
    const prevId = Storage.getSetting('tgLastMsgId', '');
    if (prevId && Number(prevId) !== msg.message_id) {
      tgCall('deleteMessage', { chat_id: chatId, message_id: Number(prevId) }).catch(() => {});
    }
  } catch { /* pinning is best-effort */ }

  Storage.setSetting('tgLastMsgId', String(msg.message_id));
  Storage.setSetting('tgLastBackupAt', payload.savedAt);
  return payload.notes.length;
}

export async function tgRestore() {
  const { token, chatId } = cfg();
  if (!token || !chatId) throw new Error('Telegram sync not configured');

  const chat = await tgCall('getChat', { chat_id: chatId });
  const doc = chat.pinned_message?.document;
  if (!doc) throw new Error('No pinned backup found — run a backup first');

  const file = await tgCall('getFile', { file_id: doc.file_id });
  const res = await fetch(`${API}/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new Error('Backup download failed');
  const data = await res.json();
  if (data.app !== 'noty' || !Array.isArray(data.notes)) throw new Error('Invalid backup file');

  Storage.saveNotes(data.notes);
  if (data.settings) {
    // Keep this device's Telegram credentials — an old backup must not wipe them
    const cur = Storage.getSettings();
    Storage.saveSettings({
      ...data.settings,
      tgToken: cur.tgToken,
      tgChatId: cur.tgChatId,
      tgLastMsgId: cur.tgLastMsgId,
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
