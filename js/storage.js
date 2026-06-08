const KEYS = {
  notes: 'noty_notes',
  settings: 'noty_settings',
};

export const Storage = {
  getNotes() {
    return JSON.parse(localStorage.getItem(KEYS.notes) || '[]');
  },
  saveNotes(notes) {
    localStorage.setItem(KEYS.notes, JSON.stringify(notes));
  },
  getNote(id) {
    return this.getNotes().find(n => n.id === id) || null;
  },
  upsertNote(note) {
    const notes = this.getNotes();
    const idx = notes.findIndex(n => n.id === note.id);
    if (idx >= 0) notes[idx] = note;
    else notes.unshift(note);
    this.saveNotes(notes);
  },
  deleteNote(id) {
    this.saveNotes(this.getNotes().filter(n => n.id !== id));
  },
  getSettings() {
    return JSON.parse(localStorage.getItem(KEYS.settings) || '{}');
  },
  saveSettings(s) {
    localStorage.setItem(KEYS.settings, JSON.stringify(s));
  },
  getSetting(key, fallback = '') {
    return this.getSettings()[key] ?? fallback;
  },
  setSetting(key, val) {
    const s = this.getSettings();
    s[key] = val;
    this.saveSettings(s);
  },
};

export function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return d.toLocaleDateString();
}
