import { Storage, uuid, formatDate } from './storage.js';
import { AI, KNOWN_LIMITS, getTodayUsage, getExhaustedToday } from './ai.js';
import { VoiceRecorder } from './voice.js';
import { sm2Update, getDueCards } from './sm2.js';
import { MindMap } from './mindmap.js';
import { tgSync, tgDetectChatId, tgConfigured, initTgAutoSync } from './telegram.js';

// ── Mobile helpers ────────────────────────────────────────────────────
const isMobile = () => window.innerWidth <= 640;

function setMobileEditorOpen(open) {
  document.getElementById('main-content')?.classList.toggle('mobile-editor-open', open);
}

// ── Markdown renderer ──────────────────────────────────────────────────
function renderMd(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold / italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr>')
    // Newlines (preserve double as paragraph, single as <br>)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return `<p>${html}</p>`;
}

// ── Toast ──────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'info', dur = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, dur);
}

// ── Modal ──────────────────────────────────────────────────────────────
function showModal(html) {
  document.getElementById('modal').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') closeModal();
});

// ── Loading helper ─────────────────────────────────────────────────────
function loadingDots() {
  return `<span class="loading-dots"><span></span><span></span><span></span></span>`;
}

// ── App State ──────────────────────────────────────────────────────────
const state = {
  view: 'dashboard',
  editingNoteId: null,
  quizData: null,
  quizIdx: 0,
  quizScore: 0,
  quizAnswered: false,
  fcSession: [],
  fcIdx: 0,
  fcFlipped: false,
  mindmapInstance: null,
  batchSelect: false,
  selectedNotes: new Set(),
};

const voice = new VoiceRecorder();

// ── Navigation ─────────────────────────────────────────────────────────
function navigateTo(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  renderView();
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => navigateTo(el.dataset.view));
});

// ── Render dispatcher ──────────────────────────────────────────────────
function renderView() {
  // Cleanup mind map if leaving that view
  if (state.view !== 'mindmap' && state.mindmapInstance) {
    state.mindmapInstance.destroy();
    state.mindmapInstance = null;
  }
  // Reset mobile editor overlay when switching views
  setMobileEditorOpen(false);
  const main = document.getElementById('main-content');
  switch (state.view) {
    case 'dashboard':   main.innerHTML = renderDashboard(); break;
    case 'notes':       renderNotesView(main); break;
    case 'flashcards':  main.innerHTML = renderFlashcardsView(); initFlashcards(); break;
    case 'quiz':        main.innerHTML = renderQuizView(); break;
    case 'mindmap':     main.innerHTML = renderMindMapShell(); initMindMap(); break;
    case 'settings':    main.innerHTML = renderSettingsView(); bindSettings(); break;
  }
  updateSidebarStats();
}

// ── Sidebar stats ──────────────────────────────────────────────────────
function updateSidebarStats() {
  const notes = Storage.getNotes();
  const due = getDueCards(notes).length;
  const totalCards = notes.reduce((s, n) => s + (n.flashcards || []).length, 0);
  document.getElementById('sidebar-stats').innerHTML = `
    <div class="stat-line"><span>Notes</span><span class="stat-val">${notes.length}</span></div>
    <div class="stat-line"><span>Cards</span><span class="stat-val">${totalCards}</span></div>
    <div class="stat-line"><span>Due today</span><span class="stat-val">${due}</span></div>
  `;
}

// ────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ────────────────────────────────────────────────────────────────────────
function renderDashboard() {
  const notes = Storage.getNotes();
  const due = getDueCards(notes);
  const totalCards = notes.reduce((s, n) => s + (n.flashcards || []).length, 0);
  const totalQuizzes = notes.reduce((s, n) => s + (n.quizzes ? 1 : 0), 0);

  const recentHtml = notes.slice(0, 5).map(n => `
    <div class="recent-note-item" data-note="${n.id}">
      <div class="recent-note-dot"></div>
      <span class="recent-note-title">${esc(n.title || 'Untitled')}</span>
      <span class="recent-note-date">${formatDate(n.updatedAt)}</span>
    </div>
  `).join('') || '<div class="empty-state"><p>No notes yet</p></div>';

  const dueHtml = due.slice(0, 5).map(fc => `
    <div class="due-card-item">
      <div class="due-card-q">${esc(fc.question)}</div>
      <div class="due-card-src">from: ${esc(fc.noteTitle)}</div>
    </div>
  `).join('') || '<div style="color:var(--text-dim);font-size:13px;padding:8px">No cards due — great job!</div>';

  return `
    <div class="view">
      <div class="view-header">
        <div>
          <div class="view-title">Dashboard</div>
          <div class="view-subtitle">${greeting()} Ready to learn?</div>
        </div>
        <button class="btn btn-primary" onclick="createNote()">+ New Note</button>
      </div>

      ${!Storage.getSetting('apiKey') ? `
        <div class="api-key-banner">
          ⚠ No AI API key set —
          <a href="#" style="color:#fbbf24;margin-left:4px" onclick="navigateTo('settings');return false">add key in Settings</a>
          to unlock AI features.
        </div>` : ''}

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-num">${notes.length}</div>
          <div class="stat-label">Notes</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${totalCards}</div>
          <div class="stat-label">Flashcards</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:var(--warning)">${due.length}</div>
          <div class="stat-label">Due for review</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:var(--success)">${streak()}</div>
          <div class="stat-label">Day streak 🔥</div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <strong>Recent Notes</strong>
            <button class="btn btn-ghost btn-sm" onclick="navigateTo('notes')">View all</button>
          </div>
          <div class="recent-notes-list">${recentHtml}</div>
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <strong>Due for Review</strong>
            ${due.length ? `<button class="btn btn-primary btn-sm" onclick="navigateTo('flashcards')">Start review</button>` : ''}
          </div>
          <div class="due-cards-list">${dueHtml}</div>
        </div>
      </div>
    </div>
  `;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning!';
  if (h < 17) return 'Good afternoon!';
  return 'Good evening!';
}

function streak() {
  return Storage.getSetting('streak', 1);
}

// ────────────────────────────────────────────────────────────────────────
// NOTES VIEW
// ────────────────────────────────────────────────────────────────────────
function renderNotesView(main) {
  const notes = Storage.getNotes();
  main.innerHTML = `
    <div class="view" style="padding:20px 24px">
      <div class="notes-layout">
        <div class="notes-sidebar">
          <div class="notes-sidebar-header">
            <input class="search-input" id="note-search" placeholder="Search notes…" oninput="filterNotes(this.value)">
            <button class="btn btn-primary btn-sm" onclick="createNote()">+</button>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 10px 6px;border-bottom:1px solid var(--border)">
            <span style="font-size:11px;color:var(--text-dim)">${notes.length} note${notes.length !== 1 ? 's' : ''}</span>
            <div style="display:flex;gap:4px">
              <button class="btn btn-ghost btn-sm" id="batch-select-btn" onclick="toggleBatchSelect()" style="font-size:11px;padding:3px 8px;${state.batchSelect ? 'background:rgba(124,58,237,0.25);color:#a78bfa;' : ''}" title="Batch select">☑</button>
              <button class="btn btn-ghost btn-sm" id="collapse-all-btn" onclick="collapseAllNotes(this)" style="font-size:11px;padding:3px 8px" title="Collapse all">⊟</button>
              <button class="btn btn-ghost btn-sm" id="autocat-all-btn" onclick="aiAutoCategorizeAll()" style="font-size:11px;padding:3px 8px" ${!Storage.getSetting('apiKey') ? 'disabled title="Add API key in Settings"' : ''}>✦ Auto-categorize all</button>
            </div>
          </div>
          <div class="notes-list" id="notes-list">
            ${renderNotesList(notes)}
          </div>
          ${state.batchSelect ? `
          <div class="batch-action-bar">
            <span style="font-size:13px;color:var(--text-muted)">${state.selectedNotes.size} selected</span>
            <div style="display:flex;gap:8px">
              <button class="btn btn-ghost btn-sm" onclick="batchSelectAll()">Select all</button>
              <button class="btn btn-sm" style="background:var(--danger);color:#fff;border-color:var(--danger)" onclick="deleteBatchSelected()" ${state.selectedNotes.size === 0 ? 'disabled' : ''}>Delete</button>
              <button class="btn btn-ghost btn-sm" onclick="toggleBatchSelect()">Cancel</button>
            </div>
          </div>` : ''}
        </div>
        <div id="note-editor-pane">
          ${state.editingNoteId
            ? renderNoteEditor(Storage.getNote(state.editingNoteId))
            : renderNoNoteSelected()}
        </div>
      </div>
    </div>
  `;

  if (state.editingNoteId) {
    bindEditorEvents();
  }
}

function renderNoteItem(n, isAtom = false, hasAtoms = false, atomsId = '') {
  const connCount = (n.connections || []).length;
  const isSelected = state.selectedNotes.has(n.id);
  const batchClass = state.batchSelect ? 'batch-mode' : '';
  const selectedClass = isSelected ? 'batch-selected' : '';
  const clickHandler = state.batchSelect
    ? `toggleNoteSelect('${n.id}')`
    : `openNote('${n.id}')`;
  return `
    <div class="note-list-item ${isAtom ? 'atom-item' : ''} ${state.editingNoteId === n.id && !state.batchSelect ? 'active' : ''} ${batchClass} ${selectedClass}" onclick="${clickHandler}">
      ${state.batchSelect ? `<span class="batch-checkbox">${isSelected ? '☑' : '☐'}</span>` : (isAtom ? '<span class="atom-tree-line"></span>' : '')}
      <div style="flex:1;min-width:0">
        <div class="note-list-title" style="display:flex;align-items:center;gap:6px">
          ${isAtom && !state.batchSelect ? '<span class="atom-dot">⚛</span>' : ''}
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.title || 'Untitled')}</span>
          ${hasAtoms && !state.batchSelect ? `<button class="atom-toggle" onclick="event.stopPropagation();toggleAtoms('${atomsId}',this)" title="Collapse atoms">▾</button>` : ''}
        </div>
        <div class="note-list-preview">${esc((n.content || '').slice(0, 80))}</div>
        <div class="note-list-meta">
          ${(n.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
          ${connCount ? `<span style="font-size:11px;color:var(--accent-light);margin-left:auto">⇆ ${connCount}</span>` : ''}
          <span class="note-date">${formatDate(n.updatedAt)}</span>
        </div>
      </div>
    </div>`;
}

function renderNotesGroup(groupNotes) {
  const atomsByParent = {};
  const sourceNotes = [];
  for (const n of groupNotes) {
    if (n.sourceNoteId) {
      if (!atomsByParent[n.sourceNoteId]) atomsByParent[n.sourceNoteId] = [];
      atomsByParent[n.sourceNoteId].push(n);
    } else {
      sourceNotes.push(n);
    }
  }
  const allParentIds = new Set(sourceNotes.map(n => n.id));
  const orphanAtoms = groupNotes.filter(n => n.sourceNoteId && !allParentIds.has(n.sourceNoteId));

  return [
    ...sourceNotes.flatMap(n => {
      const atoms = atomsByParent[n.id] || [];
      const hasAtoms = atoms.length > 0;
      const atomsId = `atoms-${n.id}`;
      return [
        renderNoteItem(n, false, hasAtoms, atomsId),
        hasAtoms ? `<div class="atom-children" id="${atomsId}">${atoms.map(a => renderNoteItem(a, true)).join('')}</div>` : '',
      ];
    }),
    ...orphanAtoms.map(a => renderNoteItem(a, true)),
  ].join('');
}

function renderNotesList(notes) {
  if (!notes.length) return `
    <div class="empty-state">
      <div class="empty-icon">📝</div>
      <h3>No notes yet</h3>
      <p>Click + to create your first note</p>
    </div>`;

  // Group by category
  const groups = {};
  for (const n of notes) {
    const cat = n.category?.trim() || '';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(n);
  }

  const sorted = Object.keys(groups).sort((a, b) => {
    if (!a) return 1; if (!b) return -1;
    return a.localeCompare(b);
  });

  if (sorted.length === 1 && sorted[0] === '') {
    return renderNotesGroup(notes);
  }

  return sorted.map(cat => {
    const id = 'cat-' + (cat || 'uncategorized').replace(/\s+/g, '-');
    return `
      <div class="category-group" id="${id}">
        <div class="category-header" onclick="toggleCategory('${id}')">
          <span class="category-chevron open">▶</span>
          <span>${cat ? esc(cat) : 'Uncategorized'}</span>
          <span style="margin-left:auto;font-size:10px;opacity:.6">${groups[cat].length}</span>
        </div>
        ${renderNotesGroup(groups[cat])}
      </div>`;
  }).join('');
}

function renderConnectionChips(note) {
  return (note.connections || []).map(cid => {
    const cn = Storage.getNote(cid);
    if (!cn) return '';
    return `<span class="connection-chip" onclick="openNote('${cid}')">
      ${esc(cn.title || 'Untitled')}
      <button class="chip-remove" onclick="event.stopPropagation();removeConnection('${note.id}','${cid}')">×</button>
    </span>`;
  }).join('');
}

function allCategories() {
  return [...new Set(Storage.getNotes().map(n => n.category || '').filter(Boolean))].sort();
}

function renderNoNoteSelected() {
  return `
    <div class="note-editor" style="align-items:center;justify-content:center">
      <div class="empty-state">
        <div class="empty-icon">✨</div>
        <h3>Select or create a note</h3>
        <p>Your learning journey starts here</p>
        <button class="btn btn-primary" onclick="createNote()">+ New Note</button>
      </div>
    </div>`;
}

function renderNoteEditor(note) {
  if (!note) return renderNoNoteSelected();
  const hasApiKey = !!Storage.getSetting('apiKey');

  return `
    <div class="note-editor" id="active-editor">
      <div class="editor-toolbar">
        <button class="mobile-back-btn" onclick="mobileBack()">← Notes</button>
        <input class="title-input" id="note-title" value="${esc(note.title || '')}" placeholder="Note title…">
        <div class="toolbar-divider"></div>
        <button class="btn btn-ghost btn-sm" onclick="saveNote()" id="save-btn">Save</button>
        <button class="btn btn-ghost btn-sm" onclick="aiRename('${note.id}')" id="rename-btn" ${!Storage.getSetting('apiKey') ? 'disabled title="Add API key in Settings"' : ''} title="Auto-rename with AI">✦ Rename</button>
        <button class="btn btn-danger btn-sm" onclick="deleteNote('${note.id}')">Delete</button>
      </div>

      <div class="editor-tabs">
        <div class="editor-tab active" id="tab-edit" onclick="switchTab('edit')">Edit</div>
        <div class="editor-tab" id="tab-preview" onclick="switchTab('preview')">Preview</div>
        <div class="editor-tab" id="tab-summary" onclick="switchTab('summary')">
          ✦ Summary${note.summary ? ' <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-left:4px;vertical-align:middle"></span>' : ''}
        </div>
      </div>

      <div class="editor-body" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
        <textarea class="note-textarea" id="note-content" placeholder="Start typing… (supports Markdown)">${esc(note.content || '')}</textarea>
        <div class="note-preview" id="note-preview-panel">${renderMd(note.content || '')}</div>
        <div id="note-summary-panel" style="display:none;flex:1;overflow-y:auto;padding:20px 24px">
          ${note.summary
            ? `<div class="summary-text" style="line-height:1.8;white-space:pre-wrap">${esc(note.summary)}</div>`
            : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--text-muted)">
                <div style="font-size:32px">✦</div>
                <div>No summary yet</div>
                <button class="btn btn-primary btn-sm" onclick="aiSummarize('${note.id}')" ${!hasApiKey ? 'disabled' : ''}>Generate summary</button>
               </div>`
          }
        </div>
      </div>

      <div class="editor-footer">
        <input class="tags-input" id="note-tags"
          value="${(note.tags || []).join(', ')}"
          placeholder="Tags (comma-separated)">
        <div style="flex-basis:100%;height:0"></div>
        <div class="editor-meta-label">Category</div>
        <input class="category-input" id="note-category"
          value="${esc(note.category || '')}"
          placeholder="Uncategorized"
          list="cat-datalist">
        <datalist id="cat-datalist">${allCategories().map(c => `<option value="${esc(c)}">`).join('')}</datalist>

        <button class="btn-voice" id="voice-btn"
          onclick="toggleVoice()"
          ${!voice.supported ? 'disabled title="Browser doesn\'t support speech recognition"' : ''}>
          🎙 Record
        </button>

        <div class="ai-actions">
          <button class="btn btn-ghost btn-sm" onclick="aiSummarize('${note.id}')" ${!hasApiKey ? 'disabled title="Add API key in Settings"' : ''}>
            ✦ Summarize
          </button>
          <button class="btn btn-ghost btn-sm" onclick="aiAtomize('${note.id}')" ${!hasApiKey ? 'disabled title="Add API key in Settings"' : ''} title="Break into atomic notes">
            ⚛ Atomize
          </button>
          <button class="btn btn-ghost btn-sm" onclick="aiFlashcards('${note.id}')" ${!hasApiKey ? 'disabled title="Add API key in Settings"' : ''}>
            ⚡ Flashcards
          </button>
          <button class="btn btn-ghost btn-sm" onclick="aiQuiz('${note.id}')" ${!hasApiKey ? 'disabled title="Add API key in Settings"' : ''}>
            ? Quiz
          </button>
        </div>
      </div>

      <div class="editor-meta-row">
        <span class="editor-meta-label">Connections</span>
        <div class="connection-chips" id="connection-chips">${renderConnectionChips(note)}</div>
        <button class="btn btn-ghost btn-sm" onclick="showConnectionPicker('${note.id}')">+ Link</button>
      </div>
    </div>
  `;
}

function bindEditorEvents() {
  const textarea = document.getElementById('note-content');
  if (!textarea) return;

  // Auto-save on change
  let saveTimer;
  textarea.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNote(true), 1500);
    // Update preview if open
    const preview = document.getElementById('note-preview-panel');
    if (preview && preview.classList.contains('active')) {
      preview.innerHTML = renderMd(textarea.value);
    }
  });

  // Tab key inserts indent
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = textarea.selectionStart;
      const e2 = textarea.selectionEnd;
      textarea.value = textarea.value.slice(0, s) + '  ' + textarea.value.slice(e2);
      textarea.selectionStart = textarea.selectionEnd = s + 2;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveNote();
    }
  });
}

function switchTab(tab) {
  const textarea = document.getElementById('note-content');
  const preview  = document.getElementById('note-preview-panel');
  const summary  = document.getElementById('note-summary-panel');
  const tabEdit  = document.getElementById('tab-edit');
  const tabPrev  = document.getElementById('tab-preview');
  const tabSum   = document.getElementById('tab-summary');

  // Hide all panels, deactivate all tabs
  if (textarea) textarea.style.display = 'none';
  if (preview)  { preview.classList.remove('active'); preview.style.display = 'none'; }
  if (summary)  summary.style.display = 'none';
  tabEdit?.classList.remove('active');
  tabPrev?.classList.remove('active');
  tabSum?.classList.remove('active');

  if (tab === 'preview') {
    if (preview) { preview.innerHTML = renderMd(textarea?.value || ''); preview.style.display = ''; preview.classList.add('active'); }
    tabPrev?.classList.add('active');
  } else if (tab === 'summary') {
    if (summary) summary.style.display = '';
    tabSum?.classList.add('active');
  } else {
    if (textarea) textarea.style.display = '';
    tabEdit?.classList.add('active');
  }
}

// ── Note CRUD ──────────────────────────────────────────────────────────
window.createNote = function() {
  const note = {
    id: uuid(),
    title: '',
    content: '',
    tags: [],
    flashcards: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  Storage.upsertNote(note);
  state.editingNoteId = note.id;
  navigateTo('notes');
};

window.openNote = function(id) {
  state.editingNoteId = id;
  if (isMobile() && state.view === 'notes') {
    // Re-render just the editor pane without full reload
    const pane = document.getElementById('note-editor-pane');
    if (pane) {
      pane.innerHTML = renderNoteEditor(Storage.getNote(id));
      bindEditorEvents();
      setMobileEditorOpen(true);
      // Update active note in list
      document.querySelectorAll('.note-list-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('onclick')?.includes(id));
      });
      return;
    }
  }
  navigateTo('notes');
};

window.mobileBack = function() {
  state.editingNoteId = null;
  setMobileEditorOpen(false);
  const pane = document.getElementById('note-editor-pane');
  if (pane) pane.innerHTML = renderNoNoteSelected();
  document.querySelectorAll('.note-list-item').forEach(el => el.classList.remove('active'));
};

window.saveNote = function(silent = false) {
  const note = Storage.getNote(state.editingNoteId);
  if (!note) return;

  const title = document.getElementById('note-title')?.value?.trim() || '';
  const content = document.getElementById('note-content')?.value || '';
  const tagsRaw = document.getElementById('note-tags')?.value || '';
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  const category = document.getElementById('note-category')?.value?.trim() || '';

  const updated = { ...note, title, content, tags, category, updatedAt: new Date().toISOString() };
  Storage.upsertNote(updated);
  // Propagate category change to atoms of this note
  if (category !== note.category) {
    Storage.getNotes()
      .filter(n => n.sourceNoteId === note.id)
      .forEach(atom => Storage.upsertNote({ ...atom, category }));
  }

  // Auto-rename only on explicit save (not silent auto-save) to prevent re-entry loop
  if (!silent && !title && content.trim() && Storage.getSetting('apiKey') && Storage.getSetting('autoRename', 'true') === 'true') {
    aiRename(note.id);
    return;
  }

  if (!silent) toast('Note saved', 'success');

  // Refresh notes list
  const listEl = document.getElementById('notes-list');
  if (listEl) listEl.innerHTML = renderNotesList(Storage.getNotes());
  updateSidebarStats();
};

window.deleteNote = function(id) {
  showModal(`
    <h3>Delete note?</h3>
    <p style="color:var(--text-muted);margin-bottom:20px">This will also delete its flashcards and quizzes. Cannot be undone.</p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmDelete('${id}')">Delete</button>
    </div>
  `);
};

window.confirmDelete = function(id) {
  Storage.deleteNote(id);
  if (state.editingNoteId === id) state.editingNoteId = null;
  closeModal();
  toast('Note deleted', 'info');
  navigateTo('notes');
};

window.toggleBatchSelect = function() {
  state.batchSelect = !state.batchSelect;
  state.selectedNotes = new Set();
  renderNotesView(document.getElementById('main-content'));
};

window.toggleNoteSelect = function(id) {
  if (state.selectedNotes.has(id)) state.selectedNotes.delete(id);
  else state.selectedNotes.add(id);
  // Re-render only the list + action bar efficiently
  const list = document.getElementById('notes-list');
  if (list) list.innerHTML = renderNotesList(Storage.getNotes());
  // Update action bar count + button state
  const bar = document.querySelector('.batch-action-bar');
  if (bar) {
    bar.querySelector('span').textContent = `${state.selectedNotes.size} selected`;
    const del = bar.querySelector('button[onclick="deleteBatchSelected()"]');
    if (del) del.disabled = state.selectedNotes.size === 0;
  }
  const btn = document.getElementById('batch-select-btn');
  if (btn) btn.style.background = state.batchSelect ? 'rgba(124,58,237,0.25)' : '';
};

window.batchSelectAll = function() {
  const notes = Storage.getNotes();
  notes.forEach(n => state.selectedNotes.add(n.id));
  const list = document.getElementById('notes-list');
  if (list) list.innerHTML = renderNotesList(notes);
  const bar = document.querySelector('.batch-action-bar');
  if (bar) {
    bar.querySelector('span').textContent = `${state.selectedNotes.size} selected`;
    const del = bar.querySelector('button[onclick="deleteBatchSelected()"]');
    if (del) del.disabled = false;
  }
};

window.deleteBatchSelected = function() {
  if (state.selectedNotes.size === 0) return;
  const count = state.selectedNotes.size;
  showModal(`
    <h3>Delete ${count} note${count > 1 ? 's' : ''}?</h3>
    <p style="color:var(--text-muted);margin-bottom:20px">This cannot be undone.</p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmBatchDelete()">Delete</button>
    </div>`);
};

window.confirmBatchDelete = function() {
  const count = state.selectedNotes.size;
  state.selectedNotes.forEach(id => Storage.deleteNote(id));
  if (state.selectedNotes.has(state.editingNoteId)) state.editingNoteId = null;
  state.batchSelect = false;
  state.selectedNotes = new Set();
  closeModal();
  renderNotesView(document.getElementById('main-content'));
  toast(`Deleted ${count} note${count > 1 ? 's' : ''}`, 'info');
};

window.filterNotes = function(q) {
  const all = Storage.getNotes();
  const filtered = q
    ? all.filter(n =>
        (n.title || '').toLowerCase().includes(q.toLowerCase()) ||
        (n.content || '').toLowerCase().includes(q.toLowerCase()) ||
        (n.tags || []).some(t => t.toLowerCase().includes(q.toLowerCase()))
      )
    : all;
  const listEl = document.getElementById('notes-list');
  if (listEl) listEl.innerHTML = renderNotesList(filtered);
};

// ── Voice ──────────────────────────────────────────────────────────────
window.toggleVoice = function() {
  const btn = document.getElementById('voice-btn');
  if (!voice.supported) {
    toast('Speech recognition not supported — use Chrome or Edge', 'error', 5000);
    return;
  }

  if (voice.isRecording) {
    voice.stop();
    _voiceStopUI();
    return;
  }

  const textarea = document.getElementById('note-content');
  if (!textarea) return;

  // Show interim text in a live preview below the textarea
  let interimEl = document.getElementById('voice-interim');
  if (!interimEl) {
    interimEl = document.createElement('div');
    interimEl.id = 'voice-interim';
    interimEl.style.cssText = 'padding:6px 20px;font-size:13px;color:#94a3b8;font-style:italic;min-height:24px;background:rgba(124,58,237,0.05)';
    textarea.parentElement.appendChild(interimEl);
  }

  voice.onInterim = (text) => {
    interimEl.textContent = '🎙 ' + text;
  };

  voice.onFinal = (text) => {
    textarea.value += (textarea.value.trim() ? ' ' : '') + text.trim();
    textarea.dispatchEvent(new Event('input'));
    interimEl.textContent = '';
  };

  voice.onError = (msg) => {
    toast(msg, 'error', 6000);
    _voiceStopUI();
    if (interimEl) interimEl.textContent = '';
  };

  voice.onStop = () => {
    _voiceStopUI();
    if (interimEl) interimEl.textContent = '';
  };

  voice.start(Storage.getSetting('voiceLang', 'en-US'));

  if (btn) { btn.innerHTML = '⏹ Stop recording'; btn.classList.add('recording'); }
  toast('🎙 Listening — speak now', 'info', 2500);
};

function _voiceStopUI() {
  const btn = document.getElementById('voice-btn');
  if (btn) { btn.innerHTML = '🎙 Record'; btn.classList.remove('recording'); }
}

// ── AI Actions ─────────────────────────────────────────────────────────
window.aiRename = async function(id) {
  saveNote(true);
  const note = Storage.getNote(id);
  if (!note?.content?.trim()) { toast('Add some content first', 'error'); return; }

  const btn = document.getElementById('rename-btn');
  if (btn) { btn.disabled = true; btn.textContent = '✦ …'; }

  try {
    const title = await AI.renameNote(note.content);
    Storage.upsertNote({ ...note, title, updatedAt: new Date().toISOString() });

    const titleInput = document.getElementById('note-title');
    if (titleInput) {
      titleInput.value = title;
      titleInput.animate([{ background: 'rgba(124,58,237,0.3)' }, { background: 'transparent' }], { duration: 800 });
    }
    // Refresh notes list
    const listEl = document.getElementById('notes-list');
    if (listEl) listEl.innerHTML = renderNotesList(Storage.getNotes());
    toast(`Renamed: "${title}"`, 'success');
  } catch (e) {
    toast(e.message === 'NO_API_KEY' ? 'Add API key in Settings' : `AI error: ${e.message}`, 'error', 5000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✦ Rename'; }
  }
};

window.aiSummarize = async function(id) {
  saveNote(true);
  const note = Storage.getNote(id);
  if (!note?.content?.trim()) { toast('Note is empty', 'error'); return; }

  switchTab('summary');
  const panel = document.getElementById('note-summary-panel');
  if (panel) panel.innerHTML = `<div style="padding:20px;color:var(--text-muted)">${loadingDots()}</div>`;

  try {
    const summary = await AI.summarize(note.content);
    Storage.upsertNote({ ...note, summary, updatedAt: new Date().toISOString() });
    if (panel) panel.innerHTML = `<div class="summary-text" style="line-height:1.8;white-space:pre-wrap">${esc(summary)}</div>`;
    // Show dot indicator on tab
    const tabSum = document.getElementById('tab-summary');
    if (tabSum) tabSum.innerHTML = '✦ Summary <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-left:4px;vertical-align:middle"></span>';
    toast('Summary generated', 'success');
  } catch (e) {
    if (panel) panel.innerHTML = `<div style="padding:20px;color:var(--danger)">Error: ${esc(e.message)}</div>`;
    toast(e.message === 'NO_API_KEY' ? 'Add your API key in Settings' : `AI error: ${e.message}`, 'error', 5000);
  }
};

window.aiAtomize = async function(id) {
  saveNote(true);
  const note = Storage.getNote(id);
  if (!note?.content?.trim()) { toast('Note is empty', 'error'); return; }

  showModal(`<h3>⚛ Atomizing note… ${loadingDots()}</h3><p style="color:var(--text-muted)">Breaking into focused atomic concepts…</p>`);

  try {
    const atoms = await AI.atomize(note.content);

    const created = atoms.map(a => ({
      id: uuid(),
      title: a.title,
      content: a.content,
      tags: [...(note.tags || [])],
      category: note.category || '',
      sourceNoteId: note.id,
      flashcards: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    created.forEach(n => Storage.upsertNote(n));
    updateSidebarStats();

    showModal(`
      <h3>⚛ ${created.length} atomic notes created</h3>
      <p style="color:var(--text-muted);margin-bottom:12px">From: <em>${esc(note.title || 'Untitled')}</em></p>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto;margin-bottom:16px">
        ${created.map(n => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--surface-2);border-radius:6px;cursor:pointer"
               onclick="closeModal();openNote('${n.id}')">
            <div style="flex:1">
              <div style="font-weight:600;font-size:13px;color:var(--text)">${esc(n.title)}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${esc(n.content.slice(0, 80))}…</div>
            </div>
            <span style="font-size:11px;color:var(--accent)">Open →</span>
          </div>
        `).join('')}
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
        <button class="btn btn-primary" onclick="closeModal();navigateTo('notes')">View notes →</button>
      </div>
    `);
  } catch (e) {
    closeModal();
    toast(e.message === 'NO_API_KEY' ? 'Add your API key in Settings' : `AI error: ${e.message}`, 'error', 5000);
  }
};

window.aiFlashcards = async function(id) {
  saveNote(true);
  const note = Storage.getNote(id);
  if (!note?.content?.trim()) { toast('Note is empty', 'error'); return; }

  showModal(`<h3>Generating flashcards… ${loadingDots()}</h3><p style="color:var(--text-muted)">Asking Gemini to extract key concepts…</p>`);

  try {
    const raw = await AI.generateFlashcards(note.content);
    const cards = raw.map(c => ({
      id: uuid(),
      question: c.question,
      answer: c.answer,
      easeFactor: 2.5,
      interval: 1,
      repetitions: 0,
      nextReview: new Date().toISOString(),
    }));

    const existing = note.flashcards || [];
    const updated = { ...note, flashcards: [...existing, ...cards], updatedAt: new Date().toISOString() };
    Storage.upsertNote(updated);
    updateSidebarStats();

    showModal(`
      <h3>✦ ${cards.length} flashcards created!</h3>
      <div style="margin-bottom:16px;color:var(--text-muted);font-size:14px">
        ${cards.slice(0, 3).map(c => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><strong>Q:</strong> ${esc(c.question)}</div>`).join('')}
        ${cards.length > 3 ? `<div style="color:var(--text-dim);font-size:12px;margin-top:8px">…and ${cards.length - 3} more</div>` : ''}
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
        <button class="btn btn-primary" onclick="closeModal();navigateTo('flashcards')">Review now →</button>
      </div>
    `);
  } catch (e) {
    closeModal();
    toast(e.message === 'NO_API_KEY' ? 'Add your API key in Settings' : `AI error: ${e.message}`, 'error', 5000);
  }
};

window.aiQuiz = async function(id) {
  saveNote(true);
  const note = Storage.getNote(id);
  if (!note?.content?.trim()) { toast('Note is empty', 'error'); return; }

  showModal(`<h3>Generating quiz… ${loadingDots()}</h3><p style="color:var(--text-muted)">Building multiple-choice questions…</p>`);

  try {
    const questions = await AI.generateQuiz(note.content);
    closeModal();

    // Persist quiz to note storage
    Storage.upsertNote({ ...note, quiz: { questions, createdAt: new Date().toISOString() } });

    // Store quiz in state and navigate
    state.quizData = { questions, noteId: id, noteTitle: note.title };
    state.quizIdx = 0;
    state.quizScore = 0;
    state.quizAnswered = false;
    navigateTo('quiz');
  } catch (e) {
    closeModal();
    toast(e.message === 'NO_API_KEY' ? 'Add your API key in Settings' : `AI error: ${e.message}`, 'error', 5000);
  }
};

// ────────────────────────────────────────────────────────────────────────
// FLASHCARDS VIEW
// ────────────────────────────────────────────────────────────────────────
function renderFlashcardsView() {
  const notes = Storage.getNotes().filter(n => (n.flashcards || []).length > 0);
  const optionsHtml = notes.map(n =>
    `<option value="${n.id}">${esc(n.title || 'Untitled')} (${n.flashcards.length})</option>`
  ).join('');

  return `
    <div class="view">
      <div class="view-header">
        <div>
          <div class="view-title">Flashcards</div>
          <div class="view-subtitle">Spaced repetition powered by SM-2</div>
        </div>
      </div>
      <div class="flashcard-controls">
        <select class="fc-source-select" id="fc-source" onchange="initFlashcards()">
          <option value="due">Due today (all notes)</option>
          <option value="all">All cards</option>
          ${optionsHtml}
        </select>
        <span id="fc-count" style="font-size:13px;color:var(--text-muted)"></span>
      </div>
      <div id="fc-arena" class="flashcard-arena"></div>
    </div>
  `;
}

function initFlashcards() {
  const source = document.getElementById('fc-source')?.value || 'due';
  const notes = Storage.getNotes();

  let cards;
  if (source === 'due') {
    cards = getDueCards(notes);
  } else if (source === 'all') {
    cards = notes.flatMap(n => (n.flashcards || []).map(fc => ({ ...fc, noteTitle: n.title, noteId: n.id })));
  } else {
    const note = notes.find(n => n.id === source);
    cards = (note?.flashcards || []).map(fc => ({ ...fc, noteTitle: note.title, noteId: note.id }));
  }

  // Shuffle
  cards = cards.sort(() => Math.random() - 0.5);

  state.fcSession = cards;
  state.fcIdx = 0;
  state.fcFlipped = false;

  const countEl = document.getElementById('fc-count');
  if (countEl) countEl.textContent = `${cards.length} card${cards.length !== 1 ? 's' : ''}`;

  renderFlashcard();
}

function renderFlashcard() {
  const arena = document.getElementById('fc-arena');
  if (!arena) return;

  const { fcSession, fcIdx } = state;

  if (!fcSession.length) {
    arena.innerHTML = `
      <div class="session-complete">
        <div class="big-emoji">🎉</div>
        <h2>No cards to review!</h2>
        <p>Generate flashcards from your notes first, or check back when cards are due.</p>
        <button class="btn btn-primary" onclick="navigateTo('notes')">Go to Notes</button>
      </div>`;
    return;
  }

  if (fcIdx >= fcSession.length) {
    arena.innerHTML = `
      <div class="session-complete">
        <div class="big-emoji">🏆</div>
        <h2>Session complete!</h2>
        <p>Reviewed ${fcSession.length} card${fcSession.length !== 1 ? 's' : ''}. Great work!</p>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:16px">
          <button class="btn btn-ghost" onclick="navigateTo('dashboard')">Dashboard</button>
          <button class="btn btn-primary" onclick="initFlashcards()">Review again</button>
        </div>
      </div>`;
    return;
  }

  const card = fcSession[fcIdx];
  const pct = Math.round((fcIdx / fcSession.length) * 100);
  state.fcFlipped = false;

  arena.innerHTML = `
    <div class="flashcard-progress">
      <span>${fcIdx + 1} / ${fcSession.length}</span>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <span style="font-size:12px;color:var(--text-dim)">${esc(card.noteTitle || '')}</span>
    </div>

    <div class="flashcard-scene" onclick="flipCard()">
      <div class="flashcard-inner" id="fc-inner">
        <div class="flashcard-face front">
          <div class="card-label">Question</div>
          <div class="card-content">${esc(card.question)}</div>
        </div>
        <div class="flashcard-face back">
          <div class="card-label">Answer</div>
          <div class="card-content">${esc(card.answer)}</div>
        </div>
      </div>
    </div>

    <div class="flashcard-hint" id="fc-hint">Click card to reveal answer</div>

    <div class="rating-buttons" id="rating-btns" style="display:none">
      <button class="rating-btn r0" onclick="rateCard(0)"><span class="rating-num">0</span><span class="rating-label">Blackout</span></button>
      <button class="rating-btn r1" onclick="rateCard(1)"><span class="rating-num">1</span><span class="rating-label">Wrong</span></button>
      <button class="rating-btn r2" onclick="rateCard(2)"><span class="rating-num">2</span><span class="rating-label">Hard</span></button>
      <button class="rating-btn r3" onclick="rateCard(3)"><span class="rating-num">3</span><span class="rating-label">Good</span></button>
      <button class="rating-btn r4" onclick="rateCard(4)"><span class="rating-num">4</span><span class="rating-label">Easy</span></button>
      <button class="rating-btn r5" onclick="rateCard(5)"><span class="rating-num">5</span><span class="rating-label">Perfect</span></button>
    </div>
  `;
}

window.flipCard = function() {
  const inner = document.getElementById('fc-inner');
  const hint = document.getElementById('fc-hint');
  const btns = document.getElementById('rating-btns');
  if (!inner) return;
  state.fcFlipped = !state.fcFlipped;
  inner.classList.toggle('flipped', state.fcFlipped);
  if (state.fcFlipped) {
    if (hint) hint.textContent = 'Rate your recall:';
    if (btns) btns.style.display = 'flex';
  } else {
    if (hint) hint.textContent = 'Click card to reveal answer';
    if (btns) btns.style.display = 'none';
  }
};

window.rateCard = function(quality) {
  const card = state.fcSession[state.fcIdx];
  if (!card) return;

  // Apply SM-2
  const updates = sm2Update(card, quality);

  // Persist to note's flashcard
  const note = Storage.getNote(card.noteId);
  if (note) {
    const fcs = (note.flashcards || []).map(fc =>
      fc.id === card.id ? { ...fc, ...updates } : fc
    );
    Storage.upsertNote({ ...note, flashcards: fcs });
  }

  state.fcIdx++;
  renderFlashcard();
};

// ────────────────────────────────────────────────────────────────────────
// QUIZ VIEW
// ────────────────────────────────────────────────────────────────────────
function renderQuizView() {
  const notes = Storage.getNotes().filter(n => n.content?.trim());

  if (!state.quizData) {
    const firstNote = notes[0];
    const firstHasSaved = !!(firstNote?.quiz?.questions?.length);
    const opts = notes.map(n =>
      `<option value="${n.id}">${esc(n.title || 'Untitled')}${n.quiz ? ' ✓' : ''}</option>`
    ).join('');
    const hasKey = !!Storage.getSetting('apiKey');

    return `
      <div class="view">
        <div class="view-header">
          <div>
            <div class="view-title">Quiz</div>
            <div class="view-subtitle">Test your knowledge with AI-generated questions</div>
          </div>
        </div>
        <div class="quiz-source-bar">
          <select class="fc-source-select" id="quiz-note-sel" onchange="refreshQuizButtons()">
            ${opts || '<option value="">No notes available</option>'}
          </select>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap" id="quiz-btn-group">
            <button id="quiz-replay-btn" class="btn btn-ghost" onclick="replayQuiz()" style="${firstHasSaved ? '' : 'display:none'}">
              ▶ Replay
            </button>
            <button class="btn btn-primary" onclick="startQuizFromSelect()" ${!notes.length || !hasKey ? 'disabled' : ''}>
              ✦ Generate New
            </button>
          </div>
          ${!hasKey ? '<span style="font-size:13px;color:var(--warning)">⚠ Add API key in Settings</span>' : ''}
        </div>
        <div class="card" style="color:var(--text-muted);font-size:14px;line-height:1.7">
          <strong style="color:var(--text)">How it works:</strong><br>
          1. Select a note (✓ = saved quiz available)<br>
          2. Replay a saved quiz or generate a new one<br>
          3. Answer each question and get instant feedback<br>
          4. See your score at the end
        </div>
      </div>
    `;
  }

  const { questions, noteTitle } = state.quizData;
  const { quizIdx, quizScore } = state;

  if (quizIdx >= questions.length) {
    const pct = Math.round((quizScore / questions.length) * 100);
    return `
      <div class="view">
        <div class="quiz-results">
          <div class="score-circle" style="--pct:${pct * 3.6}deg">
            <span class="score-text">${pct}%</span>
          </div>
          <h2>Quiz complete!</h2>
          <p style="color:var(--text-muted)">${quizScore} / ${questions.length} correct from "${esc(noteTitle)}"</p>
          <p style="color:var(--text-muted);margin-bottom:24px">${scoreMessage(pct)}</p>
          <div style="display:flex;gap:10px;justify-content:center">
            <button class="btn btn-ghost" onclick="resetQuizView()">New Quiz</button>
            <button class="btn btn-primary" onclick="restartQuiz()">Retry</button>
            <button class="btn btn-ghost" onclick="aiFlashcards('${state.quizData.noteId}')">Make Flashcards</button>
          </div>
        </div>
      </div>
    `;
  }

  const q = questions[quizIdx];
  const letters = ['A', 'B', 'C', 'D'];

  return `
    <div class="view">
      <div class="view-header">
        <div>
          <div class="view-title">Quiz</div>
          <div class="view-subtitle">${esc(noteTitle || '')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="flashcard-progress" style="gap:10px">
            <span style="font-size:13px">${quizIdx + 1} / ${questions.length}</span>
            <div class="progress-bar"><div class="progress-fill" style="width:${Math.round((quizIdx / questions.length) * 100)}%"></div></div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="resetQuizView()">Exit</button>
        </div>
      </div>
      <div class="quiz-container">
        <div class="quiz-question-num">Question ${quizIdx + 1}</div>
        <div class="quiz-question-text">${esc(q.question)}</div>
        <div class="quiz-options" id="quiz-options">
          ${q.options.map((opt, i) => `
            <button class="quiz-option" onclick="answerQuiz(${i})" data-idx="${i}">
              <span class="option-letter">${letters[i]}</span>
              ${esc(opt)}
            </button>
          `).join('')}
        </div>
        <div class="quiz-feedback" id="quiz-feedback"></div>
        <div id="quiz-next-btn" style="display:none">
          <button class="btn btn-primary" onclick="nextQuestion()">
            ${quizIdx + 1 >= questions.length ? 'See Results →' : 'Next Question →'}
          </button>
        </div>
      </div>
    </div>
  `;
}

window.startQuizFromSelect = async function() {
  const sel = document.getElementById('quiz-note-sel');
  if (!sel?.value) return;
  await aiQuiz(sel.value);
};

window.replayQuiz = function() {
  const sel = document.getElementById('quiz-note-sel');
  const note = sel?.value ? Storage.getNote(sel.value) : null;
  if (!note?.quiz?.questions?.length) { toast('No saved quiz for this note', 'error'); return; }
  state.quizData = { questions: note.quiz.questions, noteId: note.id, noteTitle: note.title };
  state.quizIdx = 0;
  state.quizScore = 0;
  state.quizAnswered = false;
  navigateTo('quiz');
};

window.refreshQuizButtons = function() {
  const sel = document.getElementById('quiz-note-sel');
  const note = sel?.value ? Storage.getNote(sel.value) : null;
  const replayBtn = document.getElementById('quiz-replay-btn');
  if (replayBtn) replayBtn.style.display = note?.quiz?.questions?.length ? '' : 'none';
};

window.answerQuiz = function(idx) {
  const q = state.quizData.questions[state.quizIdx];
  const opts = document.querySelectorAll('.quiz-option');
  const feedback = document.getElementById('quiz-feedback');
  const nextBtn = document.getElementById('quiz-next-btn');

  opts.forEach(o => o.classList.add('disabled'));
  opts[idx].classList.add(idx === q.correct ? 'correct' : 'wrong');
  if (idx !== q.correct) opts[q.correct].classList.add('correct');

  const correct = idx === q.correct;
  if (correct) state.quizScore++;

  if (feedback) {
    feedback.className = `quiz-feedback visible ${correct ? 'correct' : 'wrong'}`;
    feedback.innerHTML = correct
      ? `✓ Correct! ${q.explanation ? esc(q.explanation) : ''}`
      : `✗ Wrong. The correct answer is: <strong>${esc(q.options[q.correct])}</strong>. ${q.explanation ? esc(q.explanation) : ''}`;
  }

  if (nextBtn) nextBtn.style.display = '';
};

window.nextQuestion = function() {
  state.quizIdx++;
  state.quizAnswered = false;
  const main = document.getElementById('main-content');
  main.innerHTML = renderQuizView();
};

window.restartQuiz = function() {
  state.quizIdx = 0;
  state.quizScore = 0;
  state.quizAnswered = false;
  const main = document.getElementById('main-content');
  main.innerHTML = renderQuizView();
};

function scoreMessage(pct) {
  if (pct >= 90) return 'Outstanding! You have mastered this material.';
  if (pct >= 70) return 'Great work! A few more reviews and you\'ll nail it.';
  if (pct >= 50) return 'Good effort. Consider reviewing the note again.';
  return 'Keep studying! Generate flashcards to reinforce the concepts.';
}

// ────────────────────────────────────────────────────────────────────────
// MIND MAP VIEW
// ────────────────────────────────────────────────────────────────────────
function renderMindMapShell() {
  return `
    <div class="view" style="padding:20px 24px">
      <div class="view-header">
        <div>
          <div class="view-title">Mind Map</div>
          <div class="view-subtitle">Visual graph of your notes and connections</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-ghost btn-sm" id="ai-links-btn" onclick="enhanceWithAI()" ${!Storage.getSetting('apiKey') ? 'disabled title="Add API key"' : ''}>
            ✦ AI Connections
          </button>
          <button class="btn btn-ghost btn-sm" onclick="initMindMap()">Reset</button>
          <button class="btn btn-ghost btn-sm" onclick="zoomMindMap(0)" title="Reset zoom">1:1</button>
        </div>
      </div>
      <div class="mindmap-container">
        <svg id="mindmap-svg"></svg>
        <div class="mindmap-legend">
          <div>● node size = content length</div>
          <div>● edges = shared tags or AI connections</div>
          <div>● click node to open note</div>
          <div>● drag nodes to rearrange</div>
        </div>
      </div>
    </div>
  `;
}

function initMindMap(aiLinks = []) {
  const svgEl = document.getElementById('mindmap-svg');
  if (!svgEl) return;

  if (state.mindmapInstance) state.mindmapInstance.destroy();

  const notes = Storage.getNotes();
  state.mindmapInstance = new MindMap(svgEl, (id) => {
    state.editingNoteId = id;
    navigateTo('notes');
  });

  if (!notes.length) {
    svgEl.innerHTML = `
      <foreignObject x="50%" y="50%" width="300" height="100" transform="translate(-150,-50)">
        <div xmlns="http://www.w3.org/1999/xhtml" style="text-align:center;color:#64748b">
          <div style="font-size:32px;margin-bottom:8px">🗺</div>
          <div>No notes yet. Create some notes first!</div>
        </div>
      </foreignObject>`;
    return;
  }

  // Merge manual connections into aiLinks
  const manualLinks = [];
  const idxById = Object.fromEntries(notes.map((n, i) => [n.id, i]));
  for (const n of notes) {
    for (const cid of (n.connections || [])) {
      if (idxById[cid] !== undefined) {
        manualLinks.push({ source: idxById[n.id], target: idxById[cid], label: '' });
      }
    }
  }
  state.mindmapInstance.setData(notes, [...aiLinks, ...manualLinks]);
}

window.zoomMindMap = function(delta) {
  if (!state.mindmapInstance) return;
  if (delta === 0) state.mindmapInstance.resetZoom();
  else state.mindmapInstance.zoom(delta);
};

window.enhanceWithAI = async function() {
  const btn = document.getElementById('ai-links-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = `✦ ${loadingDots()}`; }

  try {
    const notes = Storage.getNotes();
    const links = await AI.linkConcepts(notes);

    // Persist AI links as bidirectional note connections
    for (const link of links) {
      const src = notes[link.source];
      const tgt = notes[link.target];
      if (!src || !tgt) continue;
      Storage.upsertNote({ ...Storage.getNote(src.id), connections: [...new Set([...(Storage.getNote(src.id).connections || []), tgt.id])] });
      Storage.upsertNote({ ...Storage.getNote(tgt.id), connections: [...new Set([...(Storage.getNote(tgt.id).connections || []), src.id])] });
    }

    initMindMap(links);

    // Refresh connections chips if editor is open
    const chips = document.getElementById('connection-chips');
    if (chips && state.editingNoteId) chips.innerHTML = renderConnectionChips(Storage.getNote(state.editingNoteId));

    toast(`Found ${links.length} AI connection${links.length !== 1 ? 's' : ''} — saved to notes`, 'success');
  } catch (e) {
    toast(e.message === 'NO_API_KEY' ? 'Add API key in Settings' : `AI error: ${e.message}`, 'error', 4000);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '✦ AI Connections'; }
  }
};

// ────────────────────────────────────────────────────────────────────────
// SETTINGS VIEW
// ────────────────────────────────────────────────────────────────────────
function renderModelTableRows() {
  const usage     = getTodayUsage();
  const exhausted = new Set(getExhaustedToday());
  const current   = Storage.getSetting('aiModel', 'gemini-3.1-flash-lite');

  return Object.entries(KNOWN_LIMITS).map(([id, info]) => {
    const used       = usage[id] || 0;
    const isActive   = id === current;
    const isNone     = info.tier === 'none';
    const isExhausted = exhausted.has(id);

    let leftCell;
    if (isNone) {
      leftCell = `<span style="color:var(--text-dim)">N/A</span>`;
    } else if (isExhausted) {
      leftCell = `<span style="color:var(--danger);font-weight:700">⛔ Limit hit</span>`;
    } else {
      const left = info.rpd - used;
      const color = left <= 3 ? 'var(--danger)' : left <= 10 ? 'var(--warning)' : 'var(--success)';
      leftCell = `<span style="color:${color};font-weight:600">${left}</span>`;
    }

    return `
      <tr style="border-bottom:1px solid var(--border);${isActive ? 'background:rgba(124,58,237,0.08)' : ''}${isNone || isExhausted ? 'opacity:0.55' : ''}">
        <td style="padding:7px 8px">
          <span style="font-weight:${isActive ? '600' : '400'};color:${isActive ? 'var(--accent)' : 'var(--text)'}">
            ${isActive ? '▶ ' : ''}${esc(info.label)}
          </span>
          ${info.rec ? `<span style="margin-left:6px;font-size:10px;color:var(--warning)">${esc(info.rec)}</span>` : ''}
        </td>
        <td style="padding:7px 8px;text-align:center;color:var(--text-muted)">${info.rpm || '—'}</td>
        <td style="padding:7px 8px;text-align:center;color:var(--text-muted)">${info.rpd || '—'}</td>
        <td style="padding:7px 8px;text-align:center;color:var(--text-muted)">${isNone ? '—' : used}</td>
        <td style="padding:7px 8px;text-align:center">${leftCell}</td>
        <td style="padding:7px 8px;text-align:right">
          ${!isNone && !isActive && !isExhausted ? `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 8px" onclick="saveAiModel('${id}');navigateTo('settings')">Use</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

window.fetchMyModels = async function() {
  const btn = document.getElementById('fetch-models-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = `↻ ${loadingDots()}`; }

  try {
    const models = await AI.listModels();
    const panel = document.getElementById('fetched-models-panel');
    const list = document.getElementById('fetched-models-list');
    if (!panel || !list) return;

    list.innerHTML = models.map(m => {
      const known = KNOWN_LIMITS[m.id];
      return `
        <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="saveAiModel('${esc(m.id)}');navigateTo('settings')" title="${esc(m.id)}">
          ${esc(m.label || m.id)}
          ${known ? `<span style="color:var(--warning);margin-left:3px">★</span>` : ''}
        </button>
      `;
    }).join('');

    panel.style.display = '';
    toast(`Found ${models.length} models`, 'success');
  } catch (e) {
    toast(e.message === 'NO_API_KEY' ? 'Add API key in Settings first' : `Error: ${e.message}`, 'error', 5000);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '↻ Fetch my models'; }
  }
};

function renderSettingsView() {
  const apiKey = Storage.getSetting('apiKey');
  const lang = Storage.getSetting('voiceLang', 'en-US');

  return `
    <div class="view" style="max-width:680px">
      <div class="view-header">
        <div class="view-title">Settings</div>
      </div>

      <div class="settings-section">
        <h3>AI Integration</h3>
        <div class="setting-row">
          <div>
            <div class="setting-label">Google AI Studio API Key</div>
            <div class="setting-desc">Get a free key at <a href="#" style="color:var(--accent)" onclick="return false">aistudio.google.com</a> — paste it here to enable AI features</div>
          </div>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <input class="setting-input" id="api-key-input" type="password"
            value="${esc(apiKey)}" placeholder="AIza…" style="flex:1">
          <button class="btn btn-primary" onclick="saveApiKey()">Save Key</button>
          ${apiKey ? '<button class="btn btn-danger" onclick="clearApiKey()">Clear</button>' : ''}
        </div>
        ${apiKey ? '<div style="color:var(--success);font-size:13px;margin-top:8px">✓ API key is set</div>' : ''}
      </div>

      <div class="settings-section">
        <h3>AI Behavior</h3>
        <div class="setting-row">
          <div>
            <div class="setting-label">Auto-rename untitled notes</div>
            <div class="setting-desc">When saving a note with no title, AI generates one automatically</div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="auto-rename-toggle"
              ${Storage.getSetting('autoRename','true') === 'true' ? 'checked' : ''}
              onchange="Storage.setSetting('autoRename', this.checked ? 'true' : 'false'); toast(this.checked ? 'Auto-rename on' : 'Auto-rename off', 'info')">
            <span style="font-size:13px;color:var(--text-muted)">Enabled</span>
          </label>
        </div>
      </div>

      <div class="settings-section">
        <h3>AI Model</h3>

        <div class="setting-row">
          <div>
            <div class="setting-label">Active model</div>
            <div class="setting-desc">Used for all AI features</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <input class="setting-input" id="ai-model-input"
              value="${esc(Storage.getSetting('aiModel','gemini-3.1-flash-lite'))}"
              placeholder="gemini-3.1-flash-lite"
              style="width:220px">
            <button class="btn btn-primary btn-sm" onclick="saveAiModel(document.getElementById('ai-model-input').value)">Save</button>
          </div>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Auto-switch on rate limit</div>
            <div class="setting-desc">Falls back to next model automatically when quota hit</div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="auto-switch-toggle"
              ${Storage.getSetting('autoSwitch','true') === 'true' ? 'checked' : ''}
              onchange="Storage.setSetting('autoSwitch', this.checked ? 'true' : 'false'); toast(this.checked ? 'Auto-switch on' : 'Auto-switch off', 'info')">
            <span style="font-size:13px;color:var(--text-muted)">Enabled</span>
          </label>
        </div>

        <div style="margin-top:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:13px;font-weight:600;color:var(--text-muted)">Free-tier limits &amp; today's usage</span>
            <button class="btn btn-ghost btn-sm" id="fetch-models-btn" onclick="fetchMyModels()">↻ Fetch my models</button>
            <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="text-decoration:none">↗ AI Studio usage</a>
          </div>
          <div style="overflow-x:auto">
            <table id="model-table" style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="color:var(--text-dim);text-align:left;border-bottom:1px solid var(--border)">
                  <th style="padding:6px 8px">Model</th>
                  <th style="padding:6px 8px;text-align:center">RPM</th>
                  <th style="padding:6px 8px;text-align:center">RPD</th>
                  <th style="padding:6px 8px;text-align:center">Used today</th>
                  <th style="padding:6px 8px;text-align:center">RPD left</th>
                  <th style="padding:6px 8px"></th>
                </tr>
              </thead>
              <tbody>${renderModelTableRows()}</tbody>
            </table>
          </div>
          <div id="fetched-models-panel" style="display:none;margin-top:12px">
            <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px">All models your key supports:</div>
            <div id="fetched-models-list" style="display:flex;flex-wrap:wrap;gap:6px"></div>
          </div>
          <div style="margin-top:8px;font-size:11px;color:var(--text-dim)">
            ⚠ "limit: 0" errors → enable billing at aistudio.google.com (stays free under limits)
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3>Voice Recognition</h3>
        <div class="setting-row">
          <div>
            <div class="setting-label">Recognition Language</div>
            <div class="setting-desc">Language used for voice-to-text transcription</div>
          </div>
          <select class="fc-source-select" id="voice-lang" onchange="saveLang(this.value)">
            <option value="en-US" ${lang === 'en-US' ? 'selected' : ''}>English (US)</option>
            <option value="en-GB" ${lang === 'en-GB' ? 'selected' : ''}>English (UK)</option>
            <option value="fr-FR" ${lang === 'fr-FR' ? 'selected' : ''}>French</option>
            <option value="de-DE" ${lang === 'de-DE' ? 'selected' : ''}>German</option>
            <option value="es-ES" ${lang === 'es-ES' ? 'selected' : ''}>Spanish</option>
            <option value="ar-SA" ${lang === 'ar-SA' ? 'selected' : ''}>Arabic</option>
            <option value="zh-CN" ${lang === 'zh-CN' ? 'selected' : ''}>Chinese (Simplified)</option>
            <option value="ja-JP" ${lang === 'ja-JP' ? 'selected' : ''}>Japanese</option>
          </select>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Voice support status</div>
          </div>
          <span style="font-size:13px;color:${voice.supported ? 'var(--success)' : 'var(--danger)'}">
            ${voice.supported ? '✓ Supported in this browser' : '✗ Not supported — use Chrome'}
          </span>
        </div>
      </div>

      <div class="settings-section">
        <h3>Telegram Sync</h3>
        <div style="font-size:13px;color:var(--text-muted);line-height:1.7;margin-bottom:14px">
          Free N-device sync via your own Telegram bot. Sync merges notes from all devices —
          no data loss, even with concurrent edits.
          <a href="#" style="color:var(--accent)" onclick="tgShowHelp();return false">Setup guide</a>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Bot token</div>
            <div class="setting-desc">From @BotFather — stored only in this browser</div>
          </div>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <input class="setting-input" id="tg-token-input" type="password"
            value="${esc(Storage.getSetting('tgToken'))}" placeholder="123456789:AA…" style="flex:1">
        </div>

        <div class="setting-row" style="border-bottom:none">
          <div>
            <div class="setting-label">Chat ID</div>
            <div class="setting-desc">Send /start to your bot, then click Detect</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <input class="setting-input" id="tg-chat-input"
            value="${esc(Storage.getSetting('tgChatId'))}" placeholder="123456789" style="flex:1">
          <button class="btn btn-ghost" onclick="tgDetect()">Detect</button>
          <button class="btn btn-primary" onclick="saveTgConfig()">Save</button>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Auto-sync</div>
            <div class="setting-desc">Merges with remote ~8s after any note change</div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="tg-auto-toggle"
              ${Storage.getSetting('tgAutoSync','false') === 'true' ? 'checked' : ''}
              onchange="toggleTgAuto(this.checked)">
            <span style="font-size:13px;color:var(--text-muted)">Enabled</span>
          </label>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Sync on open</div>
            <div class="setting-desc">Merges with remote each time the app loads</div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="tg-open-toggle"
              ${Storage.getSetting('tgSyncOnOpen','false') === 'true' ? 'checked' : ''}
              onchange="toggleTgSyncOnOpen(this.checked)">
            <span style="font-size:13px;color:var(--text-muted)">Enabled</span>
          </label>
        </div>

        <div class="setting-row" style="border-bottom:none">
          <div>
            <div class="setting-label">Manual sync</div>
            <div class="setting-desc" id="tg-status">${
              Storage.getSetting('tgLastSyncAt')
                ? '✓ Last sync: ' + new Date(Storage.getSetting('tgLastSyncAt')).toLocaleString()
                : tgConfigured() ? 'Never synced' : 'Not configured'
            }</div>
          </div>
          <button class="btn btn-success btn-sm" onclick="tgSyncNow()">⇅ Sync now</button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Data</h3>
        <div class="setting-row">
          <div>
            <div class="setting-label">Export all notes</div>
            <div class="setting-desc">Download as JSON backup</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="exportData()">Export JSON</button>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Import notes</div>
            <div class="setting-desc">Restore from JSON backup</div>
          </div>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            Import JSON
            <input type="file" accept=".json" style="display:none" onchange="importData(this)">
          </label>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-label">Clear all data</div>
            <div class="setting-desc">Delete all notes, flashcards, and quizzes</div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="clearAllData()">Clear All</button>
        </div>
      </div>

      <div class="settings-section">
        <h3>About</h3>
        <div style="font-size:13px;color:var(--text-muted);line-height:1.7">
          <strong style="color:var(--text)">Noty</strong> — AI-powered learning notes<br>
          Features: Voice STT · AI summaries · Spaced repetition (SM-2) · Quiz generation · Mind maps<br>
          Powered by Google Gemini · All data stored locally in your browser
        </div>
      </div>
    </div>
  `;
}

function bindSettings() {}

window.saveApiKey = function() {
  const val = document.getElementById('api-key-input')?.value?.trim();
  if (!val) { toast('Enter an API key first', 'error'); return; }
  Storage.setSetting('apiKey', val);
  toast('API key saved', 'success');
  renderView();
};

window.clearApiKey = function() {
  Storage.setSetting('apiKey', '');
  toast('API key cleared', 'info');
  renderView();
};

window.saveAiModel = function(model) {
  Storage.setSetting('aiModel', model);
  toast(`Model set to ${model}`, 'success');
};

window.saveLang = function(lang) {
  Storage.setSetting('voiceLang', lang);
  if (voice.rec) voice.rec.lang = lang;
  toast('Language saved', 'success');
};

// ── Telegram sync ──────────────────────────────────────────────────────
window.tgShowHelp = function() {
  showModal(`
    <h3>Telegram Sync setup</h3>
    <ol style="color:var(--text-muted);font-size:14px;line-height:1.9;padding-left:20px;margin-bottom:16px">
      <li>Open Telegram, search <strong style="color:var(--text)">@BotFather</strong></li>
      <li>Send <code>/newbot</code> and follow the steps — copy the <strong style="color:var(--text)">bot token</strong></li>
      <li>Paste the token in Settings and open your new bot → send <code>/start</code></li>
      <li>Click <strong style="color:var(--text)">Detect</strong> to fill the chat ID, then <strong style="color:var(--text)">Save</strong></li>
      <li>Click <strong style="color:var(--text)">Sync now</strong> — done. Enable Auto-sync for continuous merging.</li>
      <li>On other devices: same token + chat ID → Sync now. Notes merge automatically.</li>
    </ol>
    <p style="color:var(--text-dim);font-size:12px;line-height:1.6;margin-bottom:16px">
      Sync merges notes from all devices — newest edit wins per note, deletions tracked with
      timestamps so they don't reappear. Data stored as pinned messages in your private bot chat.
      Keep the token private.
    </p>
    <div style="display:flex;justify-content:flex-end">
      <button class="btn btn-primary" onclick="closeModal()">Got it</button>
    </div>
  `);
};

window.saveTgConfig = function() {
  const token  = document.getElementById('tg-token-input')?.value?.trim() || '';
  const chatId = document.getElementById('tg-chat-input')?.value?.trim() || '';
  Storage.setSetting('tgToken',  token);
  Storage.setSetting('tgChatId', chatId);
  toast(token && chatId ? 'Telegram sync configured' : 'Telegram settings saved', 'success');
  renderView();
};

window.tgDetect = async function() {
  const token = document.getElementById('tg-token-input')?.value?.trim();
  if (!token) { toast('Paste your bot token first', 'error'); return; }
  Storage.setSetting('tgToken', token);
  toast('Detecting chat ID…', 'info');
  try {
    const id = await tgDetectChatId();
    document.getElementById('tg-chat-input').value = id;
    Storage.setSetting('tgChatId', String(id));
    toast('Chat ID detected — click Save', 'success');
  } catch (err) {
    toast(err.message, 'error', 5000);
  }
};

window.toggleTgAuto = function(on) {
  if (on && !tgConfigured()) { toast('Set bot token + chat ID first', 'error'); return; }
  Storage.setSetting('tgAutoSync', on ? 'true' : 'false');
  toast(on ? 'Auto-sync on' : 'Auto-sync off', 'info');
};

window.toggleTgSyncOnOpen = function(on) {
  if (on && !tgConfigured()) { toast('Set bot token + chat ID first', 'error'); return; }
  Storage.setSetting('tgSyncOnOpen', on ? 'true' : 'false');
  toast(on ? 'Sync on open enabled' : 'Sync on open disabled', 'info');
};

window.tgSyncNow = async function() {
  if (!tgConfigured()) { toast('Set bot token + chat ID first', 'error'); return; }
  toast('Syncing with Telegram…', 'info');
  try {
    const { notes, isFirst } = await tgSync();
    toast(isFirst ? `✓ Uploaded ${notes} notes (first sync)` : `✓ Synced — ${notes} notes`, 'success');
    renderView();
    navigateTo(state.view); // refresh current view to show merged notes
  } catch (err) {
    toast('Sync failed: ' + err.message, 'error', 5000);
  }
};

document.addEventListener('tg:sync-done', (e) => {
  const { notes } = e.detail;
  toast(`✓ Auto-synced — ${notes} notes`, 'success');
  const status = document.getElementById('tg-status');
  if (status) status.textContent = '✓ Last sync: ' + new Date().toLocaleString();
  // Refresh the notes list silently if it's open
  if (state.view === 'notes') renderNotesView(document.getElementById('main-content'));
});

document.addEventListener('tg:sync-fail', (e) => {
  toast('Telegram auto-sync failed: ' + e.detail, 'error', 5000);
});

window.exportData = function() {
  const data = { notes: Storage.getNotes(), exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `noty-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  toast('Exported successfully', 'success');
};

window.importData = function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const notes = data.notes || data;
      if (!Array.isArray(notes)) throw new Error('Invalid format');
      Storage.saveNotes(notes);
      toast(`Imported ${notes.length} notes`, 'success');
      navigateTo('dashboard');
    } catch {
      toast('Invalid backup file', 'error');
    }
  };
  reader.readAsText(file);
};

window.clearAllData = function() {
  showModal(`
    <h3 style="color:var(--danger)">Clear all data?</h3>
    <p style="color:var(--text-muted);margin-bottom:20px">This deletes ALL notes, flashcards, and quiz data permanently. Cannot be undone.</p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmClearAll()">Yes, delete everything</button>
    </div>
  `);
};

window.confirmClearAll = function() {
  Storage.saveNotes([]);
  closeModal();
  state.editingNoteId = null;
  toast('All data cleared', 'info');
  navigateTo('dashboard');
};

window.aiAutoCategorizeAll = async function() {
  const notes = Storage.getNotes().filter(n => n.content?.trim());
  if (!notes.length) { toast('No notes with content', 'error'); return; }

  const btn = document.getElementById('autocat-all-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = `✦ Categorizing… ${loadingDots()}`; }

  let done = 0;
  const knownCats = allCategories();
  // Only categorize source notes — atoms inherit parent's category
  const sourceNotes = notes.filter(n => !n.sourceNoteId);

  for (const note of sourceNotes) {
    try {
      const category = await AI.categorize(note.content, knownCats);
      Storage.upsertNote({ ...note, category, updatedAt: new Date().toISOString() });
      if (!knownCats.includes(category)) knownCats.push(category);
      done++;
      if (btn) btn.innerHTML = `✦ Categorizing… ${done}/${sourceNotes.length}`;
      // Propagate to atoms of this note
      Storage.getNotes()
        .filter(n => n.sourceNoteId === note.id)
        .forEach(atom => Storage.upsertNote({ ...atom, category }));
    } catch (e) {
      if (e.message === 'NO_API_KEY') break;
    }
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '✦ Auto-categorize all'; }
  const listEl = document.getElementById('notes-list');
  if (listEl) listEl.innerHTML = renderNotesList(Storage.getNotes());
  // Refresh category datalist in editor if open
  const dl = document.getElementById('cat-datalist');
  if (dl) dl.innerHTML = allCategories().map(c => `<option value="${esc(c)}">`).join('');
  toast(`Categorized ${done} note${done !== 1 ? 's' : ''} into ${knownCats.length} categor${knownCats.length !== 1 ? 'ies' : 'y'}`, 'success', 4000);
};

// ── Category & Connections ─────────────────────────────────────────────
window.collapseAllNotes = function(btn) {
  const allCollapsed = [...document.querySelectorAll('.category-group')].every(g => g.classList.contains('collapsed'))
    && [...document.querySelectorAll('.atom-children')].every(g => g.classList.contains('collapsed'));

  if (allCollapsed) {
    document.querySelectorAll('.category-group').forEach(g => {
      g.classList.remove('collapsed');
      const ch = g.querySelector('.category-chevron'); if (ch) ch.classList.add('open');
    });
    document.querySelectorAll('.atom-children').forEach(g => {
      g.classList.remove('collapsed');
      const tb = g.previousElementSibling?.querySelector('.atom-toggle'); if (tb) tb.textContent = '▾';
    });
    if (btn) btn.textContent = '⊟';
  } else {
    document.querySelectorAll('.category-group').forEach(g => {
      g.classList.add('collapsed');
      const ch = g.querySelector('.category-chevron'); if (ch) ch.classList.remove('open');
    });
    document.querySelectorAll('.atom-children').forEach(g => {
      g.classList.add('collapsed');
      const tb = g.previousElementSibling?.querySelector('.atom-toggle'); if (tb) tb.textContent = '▸';
    });
    if (btn) btn.textContent = '⊞';
  }
};

window.toggleAtoms = function(atomsId, btn) {
  const el = document.getElementById(atomsId);
  if (!el) return;
  const collapsed = el.classList.toggle('collapsed');
  if (btn) btn.textContent = collapsed ? '▸' : '▾';
};

window.toggleCategory = function(id) {
  const group = document.getElementById(id);
  if (!group) return;
  const collapsed = group.classList.toggle('collapsed');
  const chevron = group.querySelector('.category-chevron');
  if (chevron) chevron.classList.toggle('open', !collapsed);
};

window.showConnectionPicker = function(noteId) {
  const note = Storage.getNote(noteId);
  if (!note) return;
  const existing = new Set(note.connections || []);
  const others = Storage.getNotes().filter(n => n.id !== noteId);

  showModal(`
    <h3>Link note</h3>
    <input class="search-input" id="conn-search" placeholder="Search notes…"
      oninput="filterConnPicker(this.value,'${noteId}')" style="width:100%;margin-bottom:4px">
    <div class="conn-picker-list" id="conn-picker-list">
      ${others.map(n => `
        <div class="conn-picker-item ${existing.has(n.id) ? 'already' : ''}"
             onclick="addConnection('${noteId}','${n.id}')">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${esc(n.title || 'Untitled')}</div>
            ${n.category ? `<div style="font-size:11px;color:var(--text-dim)">${esc(n.category)}</div>` : ''}
          </div>
          ${existing.has(n.id) ? '<span style="font-size:11px;color:var(--accent)">linked</span>' : ''}
        </div>`).join('')}
    </div>
    <div style="text-align:right;margin-top:12px">
      <button class="btn btn-ghost" onclick="closeModal()">Done</button>
    </div>
  `);
};

window.filterConnPicker = function(q, noteId) {
  const note = Storage.getNote(noteId);
  const existing = new Set(note?.connections || []);
  const all = Storage.getNotes().filter(n => n.id !== noteId);
  const filtered = q
    ? all.filter(n => (n.title || '').toLowerCase().includes(q.toLowerCase()) ||
                      (n.category || '').toLowerCase().includes(q.toLowerCase()))
    : all;
  const list = document.getElementById('conn-picker-list');
  if (!list) return;
  list.innerHTML = filtered.map(n => `
    <div class="conn-picker-item ${existing.has(n.id) ? 'already' : ''}"
         onclick="addConnection('${noteId}','${n.id}')">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${esc(n.title || 'Untitled')}</div>
        ${n.category ? `<div style="font-size:11px;color:var(--text-dim)">${esc(n.category)}</div>` : ''}
      </div>
      ${existing.has(n.id) ? '<span style="font-size:11px;color:var(--accent)">linked</span>' : ''}
    </div>`).join('');
};

window.addConnection = function(noteId, targetId) {
  const note = Storage.getNote(noteId);
  if (!note) return;
  const connections = [...new Set([...(note.connections || []), targetId])];
  Storage.upsertNote({ ...note, connections });
  // Reciprocal link
  const target = Storage.getNote(targetId);
  if (target) {
    const tConns = [...new Set([...(target.connections || []), noteId])];
    Storage.upsertNote({ ...target, connections: tConns });
  }
  // Refresh chips
  const chips = document.getElementById('connection-chips');
  if (chips) chips.innerHTML = renderConnectionChips(Storage.getNote(noteId));
  // Refresh picker (re-render to show "linked" state)
  showConnectionPicker(noteId);
};

window.removeConnection = function(noteId, targetId) {
  const note = Storage.getNote(noteId);
  if (!note) return;
  Storage.upsertNote({ ...note, connections: (note.connections || []).filter(id => id !== targetId) });
  // Remove reciprocal
  const target = Storage.getNote(targetId);
  if (target) {
    Storage.upsertNote({ ...target, connections: (target.connections || []).filter(id => id !== noteId) });
  }
  const chips = document.getElementById('connection-chips');
  if (chips) chips.innerHTML = renderConnectionChips(Storage.getNote(noteId));
  const listEl = document.getElementById('notes-list');
  if (listEl) listEl.innerHTML = renderNotesList(Storage.getNotes());
};

// ── Helpers ────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Expose globals needed by inline onclick handlers
window.Storage = Storage;
window.navigateTo = navigateTo;
window.closeModal = closeModal;
window.switchTab = switchTab;
window.flipCard = flipCard;
window.initFlashcards = initFlashcards;
window.initMindMap = initMindMap;
window.resetQuizView = function() { state.quizData = null; navigateTo('quiz'); };

// ── Boot ───────────────────────────────────────────────────────────────
window.addEventListener('noty:model-exhausted', (e) => {
  const tbody = document.querySelector('#model-table tbody');
  if (tbody) tbody.innerHTML = renderModelTableRows();
});

window.addEventListener('noty:model-switched', (e) => {
  const { from, to } = e.detail;
  const toLabel = KNOWN_LIMITS[to]?.label || to;
  toast(`Rate limit hit — switched to ${toLabel}`, 'warning', 5000);
  // Refresh settings model input if open
  const input = document.getElementById('ai-model-input');
  if (input) input.value = to;
  const tbody = document.querySelector('#model-table tbody');
  if (tbody) tbody.innerHTML = renderModelTableRows();
});

// ── Flashcard keyboard shortcuts ───────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (state.view !== 'flashcards') return;
  if (window.matchMedia('(max-width: 640px)').matches) return;
  if (e.code === 'Space') {
    e.preventDefault();
    flipCard();
  } else if (/^Numpad[0-5]$/.test(e.code)) {
    const btns = document.getElementById('rating-btns');
    if (btns && btns.style.display !== 'none') {
      rateCard(parseInt(e.code.slice(-1)));
    }
  }
});

initTgAutoSync();
navigateTo('dashboard');

// Sync on open — runs after first render so the UI is visible during sync
if (Storage.getSetting('tgSyncOnOpen', 'false') === 'true' && tgConfigured()) {
  tgSync()
    .then(r  => {
      document.dispatchEvent(new CustomEvent('tg:sync-done', { detail: r }));
    })
    .catch(e => document.dispatchEvent(new CustomEvent('tg:sync-fail', { detail: e.message })));
}
