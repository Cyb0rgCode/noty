// ── Telegram Multi-Device Merge Sync ────────────────────────────────────
// Free N-device sync using the user's own Telegram bot. Bot API method
// endpoints allow browser CORS; file downloads do NOT — all data travels
// as text message bodies, never as file downloads.
//
// Backup:  local notes + tombstones → base64 chunks → sendMessage each →
//          pinned index message.
// Sync:    pull remote → merge with local (newest updatedAt wins per note,
//          tombstones applied) → save merged locally → push merged back →
//          all devices always converge to the same state.
//
// Tombstones prevent deleted notes from re-appearing on other devices.
// A tombstone is only applied if deletedAt > note.updatedAt — an edit
// after a deletion on another device saves the note.

import { Storage } from './storage.js';

const API          = 'https://api.telegram.org';
const IDX_PREFIX   = 'NOTY_INDEX::';
const CHUNK_PREFIX = 'NOTY_DATA::';
const CHUNK_SIZE   = 3800;

function cfg() {
  return {
    token:  String(Storage.getSetting('tgToken',  '')).trim(),
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

// Unicode-safe base64 (Telegram may trim whitespace at message edges)
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function tgGetMe() { return tgCall('getMe'); }

export async function tgDetectChatId() {
  const updates = await tgCall('getUpdates', { limit: 100 });
  for (let i = updates.length - 1; i >= 0; i--) {
    const m = updates[i].message || updates[i].edited_message;
    if (m?.chat?.id) return m.chat.id;
  }
  throw new Error('No messages found — open your bot in Telegram and send /start first');
}

// ── Merge logic ────────────────────────────────────────────────────────
// Returns merged notes and merged tombstones.
function mergeData(localNotes, localTombstones, remoteNotes, remoteTombstones) {
  // Union tombstones: keep all, prefer newest deletedAt per id
  const tombMap = new Map();
  for (const t of [...localTombstones, ...remoteTombstones]) {
    const existing = tombMap.get(t.id);
    if (!existing || t.deletedAt > existing.deletedAt) tombMap.set(t.id, t);
  }
  // Prune tombstones older than 60 days to keep payload small
  const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString();
  const tombstones = [...tombMap.values()].filter(t => t.deletedAt > cutoff);

  // Union notes: per id keep newest updatedAt
  const noteMap = new Map();
  for (const n of [...localNotes, ...remoteNotes]) {
    const existing = noteMap.get(n.id);
    if (!existing || (n.updatedAt || '') > (existing.updatedAt || '')) noteMap.set(n.id, n);
  }

  // Apply tombstones: delete note only if deletedAt is newer than updatedAt
  const tombByIdMap = new Map(tombstones.map(t => [t.id, t]));
  const notes = [...noteMap.values()].filter(n => {
    const t = tombByIdMap.get(n.id);
    return !t || (n.updatedAt || '') > t.deletedAt;
  });

  // Sort newest first (matches original list order)
  notes.sort((a, b) => (b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1);

  return { notes, tombstones };
}

// ── Read remote backup ─────────────────────────────────────────────────
async function readRemote() {
  const { chatId } = cfg();
  const chat = await tgCall('getChat', { chat_id: chatId });
  const pin  = chat.pinned_message;

  if (!pin) return null;
  if (pin.document) throw new Error(
    'Old backup format — on a device that has your notes, click "Sync now" once, then retry here'
  );
  if (!pin.text?.startsWith(IDX_PREFIX)) return null;

  const idx = JSON.parse(pin.text.slice(IDX_PREFIX.length));
  let encoded = '';
  for (const id of idx.ids) {
    const fwd = await tgCall('forwardMessage', {
      chat_id: chatId, from_chat_id: chatId, message_id: id, disable_notification: true,
    });
    // Delete the forwarded copy immediately — it's just a transport vehicle
    tgCall('deleteMessage', { chat_id: chatId, message_id: fwd.message_id }).catch(() => {});
    const t = fwd.text || '';
    if (!t.startsWith(CHUNK_PREFIX)) throw new Error('Backup chunk missing — run Sync on the source device first');
    const sep = t.indexOf('::', CHUNK_PREFIX.length);
    encoded += t.slice(sep + 2);
  }

  return JSON.parse(b64decode(encoded));
}

// ── Write merged data to Telegram ─────────────────────────────────────
async function writeRemote(notes, tombstones) {
  const { chatId } = cfg();

  // Get old message IDs before sending new ones
  const oldIds = await (async () => {
    try {
      const chat = await tgCall('getChat', { chat_id: chatId });
      const pin  = chat.pinned_message;
      if (!pin) return [];
      if (pin.text?.startsWith(IDX_PREFIX)) {
        const idx = JSON.parse(pin.text.slice(IDX_PREFIX.length));
        return [...(idx.ids || []), pin.message_id];
      }
      return [pin.message_id];
    } catch { return []; }
  })();

  const payload  = JSON.stringify({ app: 'noty', version: 3, savedAt: new Date().toISOString(), notes, tombstones });
  const encoded  = b64encode(payload);
  const parts    = [];
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) parts.push(encoded.slice(i, i + CHUNK_SIZE));

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
  const idxMsg  = await tgCall('sendMessage', {
    chat_id: chatId,
    text: IDX_PREFIX + JSON.stringify({ v: 3, ids, notes: notes.length, savedAt }),
    disable_notification: true,
  });
  await tgCall('pinChatMessage', { chat_id: chatId, message_id: idxMsg.message_id, disable_notification: true });

  for (const id of oldIds) tgCall('deleteMessage', { chat_id: chatId, message_id: id }).catch(() => {});

  Storage.setSetting('tgLastSyncAt', savedAt);
  return savedAt;
}

// ── Public: full merge sync ────────────────────────────────────────────
// Pull remote → merge with local → save locally → push merged back.
// Safe to call from multiple devices; all converge to the same state.
export async function tgSync() {
  const { token, chatId } = cfg();
  if (!token || !chatId) throw new Error('Telegram sync not configured');

  const localNotes      = Storage.getNotes();
  const localTombstones = Storage.getTombstones();

  const remote = await readRemote();

  const remoteNotes      = remote?.notes      || [];
  const remoteTombstones = remote?.tombstones || [];

  const { notes, tombstones } = mergeData(localNotes, localTombstones, remoteNotes, remoteTombstones);

  // Save merged state locally (bypasses the auto-sync wrapper to avoid loop)
  Storage._saveNotes(notes);
  Storage.saveTombstones(tombstones);

  await writeRemote(notes, tombstones);

  return { notes: notes.length, isFirst: !remote };
}

// Kept for compatibility — now just calls tgSync
export const tgBackup  = () => tgSync().then(r => r.notes);
export const tgRestore = () => tgSync().then(r => ({ notes: r.notes, savedAt: Storage.getSetting('tgLastSyncAt') }));

// ── Auto-sync: debounced after note changes ────────────────────────────
let tgTimer = null;

export function scheduleTgBackup() {
  if (Storage.getSetting('tgAutoSync', 'false') !== 'true' || !tgConfigured()) return;
  clearTimeout(tgTimer);
  tgTimer = setTimeout(() => {
    tgSync()
      .then(r  => document.dispatchEvent(new CustomEvent('tg:sync-done',  { detail: r })))
      .catch(e => document.dispatchEvent(new CustomEvent('tg:sync-fail',  { detail: e.message })));
  }, 8000);
}

// Wraps Storage.saveNotes once so every note write triggers a debounced sync.
// Also exposes Storage._saveNotes so tgSync can write locally without looping.
export function initTgAutoSync() {
  const orig = Storage.saveNotes.bind(Storage);
  Storage._saveNotes = orig;
  Storage.saveNotes  = (notes) => { orig(notes); scheduleTgBackup(); };
}
