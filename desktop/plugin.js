/**
 * Prompt Snippets — custom composer prompt snippets.
 *
 * Usage:
 *   - Composer "+" menu -> "我的片段" -> manager dialog:
 *     add / edit / delete / reorder / click-to-insert.
 *   - Data lives in ctx.storage (localStorage key
 *     hermes.plugin.prompt-snippets.snippets-v1). No backend, no build step.
 *
 * Mechanism:
 *   - composer.attachments data contribution = the "+" menu row (stable SDK contract).
 *   - composer.underside render contribution = dialog host (renders null when closed).
 *   - onDispose clears module state on disable/reload; no residue.
 *   - insertCtx is captured fresh on every menu-row click (run), so the dialog
 *     always inserts through a closure from the current composer render.
 */
import { COMPOSER_AREAS, KEYBINDS_AREA, PALETTE_AREA, Button, Codicon, Dialog, DialogContent, Switch, DialogDescription, DialogHeader, DialogTitle, Input, Textarea, atom, host, usePluginI18n, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useRef, useState } from 'react'

const STORAGE_KEY = 'snippets-v1'
// Two-pane manager gets a wider shell: max-w-3xl is a compiled dist class and
// wins the twMerge conflict against DialogContent's built-in max-w-lg.
const DIALOG_MAX_W = 'max-w-3xl'
const ID = 'prompt-snippets'

// ── i18n locale bundles（跟随 app 语言；解析链 当前 locale → en → 键名）──────
const LOCALES = {
  en: {
    menu: { label: 'My Snippets' },
    manage: {
      title: 'My Snippets',
      desc: 'Select a snippet on the left to preview and edit; insert with the button or double-click a row. Drag ⠿ to reorder (paused while filtering).',
      add: 'Add', empty: 'No snippets yet — click "Add" to create one',
      noMatch: 'No matching snippets',
      searchPh: 'Search by name or description…', searchClear: 'Clear',
      editTitle: 'Edit Snippet', addTitle: 'New Snippet',
      formDesc: 'Label and content are required.',
      fieldLabel: 'Label *', fieldLabelPh: 'e.g. Code review',
      fieldDesc: 'Description (optional)', fieldDescPh: 'One line about what it is for',
      fieldTags: 'Tags (optional, comma-separated)', fieldTagsPh: 'e.g. writing, review',
      fieldText: 'Content *', fieldTextPh: 'The full prompt inserted into the composer…',
      cancel: 'Cancel', save: 'Save',
      placeholder: 'Select a snippet on the left',
      metaName: 'name', metaDesc: 'description', metaTags: 'tags', metaStatus: 'status',
      insert: 'Insert', edit: 'Edit', del: 'Delete',
      on: 'Enabled', off: 'Disabled', toggleLabel: 'Enable or disable this snippet',
      confirmDel: 'Click again to delete',
      import: 'Import', export: 'Export',
      importTitle: 'Import snippets', importPh: 'Paste an exported JSON array…', importMerge: 'Merge'
    },
    quick: {
      filterPh: 'Type to filter, ↑↓ to move, ↵ to insert, Esc to close',
      empty: 'No matching snippets'
    },
    row: { dragHint: 'Drag to reorder' },
    notify: {
      insertFailed: 'Insert failed: composer unavailable', insertDisabled: 'Snippet is disabled — enable it first', corrupted: 'Snippet data corrupted — reset to empty',
      importBad: 'Import failed: not a valid snippets JSON array',
      importDone: 'Imported', importUnit: 'new snippets', importNone: 'Nothing new to import',
      exportDone: 'Copied to clipboard', exportEmpty: 'No snippets to export', exportFailed: 'Copy failed — try DevTools export'
    }
  },
  zh: {
    menu: { label: '我的片段' },
    manage: {
      title: '我的片段',
      desc: '左侧点选片段进行预览和编辑；点「插入」按钮或双击行插入。按住 ⠿ 拖动排序（搜索时暂停）。',
      add: '新增', empty: '还没有片段，点下方「新增」加一条',
      noMatch: '没有匹配的片段',
      searchPh: '按名称或描述搜索…', searchClear: '清除',
      editTitle: '编辑片段', addTitle: '新增片段',
      formDesc: '名称和内容必填。',
      fieldLabel: '名称 *', fieldLabelPh: '如：代码审查',
      fieldDesc: '描述（可选）', fieldDescPh: '一句话说明用途',
      fieldTags: '标签（可选，逗号分隔）', fieldTagsPh: '如：写作, 审查',
      fieldText: '内容 *', fieldTextPh: '点选后插入输入框的完整提示词…',
      cancel: '取消', save: '保存',
      placeholder: '在左侧选择一个片段',
      metaName: '名称', metaDesc: '描述', metaTags: '标签', metaStatus: '状态',
      insert: '插入', edit: '编辑', del: '删除',
      on: '已启用', off: '已停用', toggleLabel: '启用或停用该片段',
      confirmDel: '再点一次确认删除',
      import: '导入', export: '导出',
      importTitle: '导入片段', importPh: '粘贴导出的 JSON 数组…', importMerge: '合并导入'
    },
    quick: {
      filterPh: '输入过滤，↑↓ 选择，↵ 插入，Esc 关闭',
      empty: '没有匹配的片段'
    },
    row: { dragHint: '拖动排序' },
    notify: {
      insertFailed: '插入失败：输入框不可用', insertDisabled: '该片段已停用，请先启用', corrupted: '片段数据损坏，已重置为空',
      importBad: '导入失败：不是有效的片段 JSON 数组',
      importDone: '已导入', importUnit: '条新片段', importNone: '没有可导入的新片段',
      exportDone: '已复制到剪贴板', exportEmpty: '没有可导出的片段', exportFailed: '复制失败，请用 DevTools 导出'
    }
  },
  'zh-hant': {
    menu: { label: '我的片段' },
    manage: {
      title: '我的片段',
      desc: '左側點選片段進行預覽和編輯；點「插入」按鈕或雙擊行插入。按住 ⠿ 拖動排序（搜尋時暫停）。',
      add: '新增', empty: '還沒有片段，點下方「新增」加一條',
      noMatch: '沒有符合的片段',
      searchPh: '按名稱或描述搜尋…', searchClear: '清除',
      editTitle: '編輯片段', addTitle: '新增片段',
      formDesc: '名稱和內容必填。',
      fieldLabel: '名稱 *', fieldLabelPh: '如：代碼審查',
      fieldDesc: '描述（可選）', fieldDescPh: '一句話說明用途',
      fieldTags: '標籤（可選，逗號分隔）', fieldTagsPh: '如：寫作, 審查',
      fieldText: '內容 *', fieldTextPh: '點選後插入輸入框的完整提示詞…',
      cancel: '取消', save: '儲存',
      placeholder: '在左側選擇一個片段',
      metaName: '名稱', metaDesc: '描述', metaTags: '標籤', metaStatus: '狀態',
      insert: '插入', edit: '編輯', del: '刪除',
      on: '已啟用', off: '已停用', toggleLabel: '啟用或停用該片段',
      confirmDel: '再點一次確認刪除',
      import: '匯入', export: '匯出',
      importTitle: '匯入片段', importPh: '貼上匯出的 JSON 陣列…', importMerge: '合併匯入'
    },
    quick: {
      filterPh: '輸入過濾，↑↓ 選擇，↵ 插入，Esc 關閉',
      empty: '沒有符合的片段'
    },
    row: { dragHint: '拖曳排序' },
    notify: {
      insertFailed: '插入失敗：輸入框不可用', insertDisabled: '該片段已停用，請先啟用', corrupted: '片段資料損壞，已重設為空',
      importBad: '匯入失敗：不是有效的片段 JSON 陣列',
      importDone: '已匯入', importUnit: '條新片段', importNone: '沒有可匯入的新片段',
      exportDone: '已複製到剪貼簿', exportEmpty: '沒有可匯出的片段', exportFailed: '複製失敗，請用 DevTools 匯出'
    }
  }
}

// MessageSquareText lead icon — the official snippet dialog's row icon.
// Exact tabler IconMessage2 paths (lib/icons.ts:75 maps MessageSquareText to
// @tabler/icons-react IconMessage2), inlined as raw SVG so the plugin doesn't
// need the icons import surface.
const MESSAGE_SQUARE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9h8"/><path d="M8 13h6"/><path d="M9 18h-3a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-3l-3 3l-3 -3"/></svg>'

// ── Data layer (pure functions, return new arrays, never mutate) ──────────

// Tags are stored as a trimmed, de-duplicated string array. Accepts an array
// or a comma-separated string (both Chinese and ASCII commas) so import and
// the form field share one normalizer.
export function normalizeTags(input) {
  const arr = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,，]/)
      : []
  const seen = new Set()
  const out = []
  for (const raw of arr) {
    const tag = typeof raw === 'string' ? raw.trim() : ''
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase())
      out.push(tag)
    }
  }
  return out
}

export function addSnippet(list, { label, description, text, tags, enabled }) {
  const id = `s-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  return [...list, { id, label, description, text, tags: normalizeTags(tags), enabled: enabled !== false }]
}

export function updateSnippet(list, id, patch) {
  const next = { ...patch }
  if ('tags' in next) next.tags = normalizeTags(next.tags)
  return list.map(s => (s.id === id ? { ...s, ...next } : s))
}

// Import merge: keep existing ids (local wins), append genuinely new records,
// sanitising each. Returns { list, added }.
export function mergeSnippets(list, incoming) {
  const byId = new Map(list.map(s => [s.id, s]))
  let added = 0
  const out = [...list]
  for (const sn of incoming) {
    if (!sn || typeof sn.label !== 'string' || typeof sn.text !== 'string') continue
    if (byId.has(sn.id)) continue
    const rec = {
      id: typeof sn.id === 'string' && sn.id ? sn.id : `s-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      label: sn.label,
      description: typeof sn.description === 'string' ? sn.description : '',
      text: sn.text,
      tags: normalizeTags(sn.tags),
      enabled: sn.enabled !== false
    }
    byId.set(rec.id, rec)
    out.push(rec)
    added++
  }
  return { list: out, added }
}

export function removeSnippet(list, id) {
  return list.filter(s => s.id !== id)
}

export function moveSnippet(list, id, dir) {
  const i = list.findIndex(s => s.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

// Drag-drop reorder: move `fromId` onto `toId`'s slot (splice semantics, not
// adjacent-swap — the drop target can be anywhere in the list). Pure.
export function reorderSnippet(list, fromId, toId) {
  const from = list.findIndex(s => s.id === fromId)
  const to = list.findIndex(s => s.id === toId)
  if (from < 0 || to < 0 || from === to) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

// ── Module-level state ─────────────────────────────────────────────────────

// ── host.composer draft API (hermes-agent #120907) ────────────────────────
// Hosts exposing host.composer get session-addressed writes through the app's
// own paint path (insertText acked; @-ref / `/` tokens hydrate as chips) —
// the supported door per the SDK docs. Every verb is fail-closed: a false
// return means "no live surface answers this address", so the caller drops to
// the legacy DOM chain below — never a silent loss. Older hosts (every
// released desktop build before the API shipped) take the legacy path
// unchanged.
function sdkComposer() {
  const c = host.composer
  return c && typeof c.insertText === 'function' && typeof c.getDraft === 'function' && typeof c.setDraft === 'function' ? c : null
}

function sdkSessionId() {
  try {
    const id = host.state?.focusedSessionId?.get?.()
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

// Migration-table insert (consumers table, #120907): append as a block; when
// insertText finds no surface, re-read the draft (mounted text, else the
// persisted stash) and replace it with draft + '\n' + text.
async function sdkAppendBlock(c, sid, text) {
  try {
    if (await c.insertText(sid, text, { mode: 'block' })) return true
    const draft = (await c.getDraft(sid)) ?? ''
    return await c.setDraft(sid, draft ? `${draft}\n${text}` : text)
  } catch {
    return false
  }
}

const $managerOpen = atom(false)
// 'manage' = CRUD list (from the "+" menu / ⌘K), 'quick' = Cmd-K-style picker
// (from the keybind). One dialog, two entry-intent views.
const $mode = atom('manage')
let store = null
let insertCtxRef = null
// Session id captured WHEN an open flow starts — the SDK-mode counterpart of
// openSurface below (same capture timing, same stale-focus defense: the
// picker's filter input steals DOM focus, so inserts address this snapshot,
// not focus-at-pick-time). Null when the flow began on a not-yet-created
// session; the insert path then lets the SDK address 'new' / null.
let openSid = null
// The chat surface (data-composer-target value) captured WHEN the dialog
// opens — at that moment focus still sits in the user's editor, so this is
// the session the user means. The dialog itself is a body-level portal, so
// activeElement probes AFTER opening point nowhere useful.
let openSurface = null
// Last-focused chat surface, kept fresh by a focusin listener: clicking a
// session's header/messages focuses the pane but NOT an input, so
// activeElement at keybind time can be <body> even though the user clearly
// "is" in the right-hand session. Tracking the last surface that received
// ANY focus event survives that.
let lastFocusedSurface = null
// Last surface the user interacted with by POINTER (mousedown anywhere inside
// its [data-composer-target] chain). Clicking a session's header/message area
// gives it no focusin event, so focus tracking alone loses the session the
// user just clicked into — but the pointerdown always fires.
let lastPointerSurface = null
let focusTrackerInstalled = false

function onFocusIn(event) {
  const el = event.target
  if (el && el.closest) {
    const surface = el.closest('[data-composer-target]')
    if (surface) lastFocusedSurface = surface.getAttribute('data-composer-target')
  }
}

function onPointerDown(event) {
  const el = event.target
  if (el && el.closest) {
    const surface = el.closest('[data-composer-target]')
    if (surface) lastPointerSurface = surface.getAttribute('data-composer-target')
  }
}

function ensureFocusTracker() {
  if (focusTrackerInstalled || typeof window === 'undefined') return
  focusTrackerInstalled = true
  window.addEventListener('focusin', onFocusIn, true)
  window.addEventListener('pointerdown', onPointerDown, true)
}

function captureSurface() {
  // 1. Real focus wins (the user typed in that editor most recently).
  const anchor = document.activeElement
  if (anchor && anchor.closest) {
    const surface = anchor.closest('[data-composer-target]')
    if (surface) return surface.getAttribute('data-composer-target')
  }
  // 2. The surface the user last clicked into (covers "clicked the tile's
  //    header/messages, then hit the keybind" — no focus event there).
  if (lastPointerSurface) return lastPointerSurface
  // 3. Last focusin target, if any.
  return lastFocusedSurface
}

function firstVisibleSurface() {
  const surfaces = Array.from(document.querySelectorAll('[data-composer-target]'))
  const visible = surfaces.find(el => el.closest('[data-pane-hidden]') === null)
  return visible ? visible.getAttribute('data-composer-target') : 'main'
}

// ── Keybind backup (2026-09-05) ────────────────────────────────────────────
// The official keybind store persists ONLY bindings whose action is currently
// registered (persistBindings iterates allKeybindActions). Contributed actions
// register late (plugin scan), and any $bindings write before that rewrites
// the store WITHOUT our override — the user's binding is wiped on every
// restart/update. Defense (catalog-compliant): mirror the combo into plugin
// storage and serve it as the contributed action's defaults on every register.
// bindingsFor falls back to defaults, so dispatch + the settings panel both
// resolve — the plugin never writes the app's own keybind store.
const KEYBIND_OFFICIAL_KEY = 'hermes.desktop.keybinds'
const KEYBIND_BACKUP_KEY = 'keybind-backup-v1'
const KEYBIND_ACTION_ID = 'prompt-snippets.openManager'
let keybindBackup = null
// Live-reorder drag state: the id of the row currently being dragged. Set on
// dragStart, consumed by every row's dragover, cleared on dragEnd.
const $dragFromId = atom(null)
// Hover-preview target during a drag (atom — rows re-render on change).
// Transform-based preview renders here; the real reorder commits on drop.
const $dragOverId = atom(null)

function readOfficialKeybindMap() {
  try {
    const raw = localStorage.getItem(KEYBIND_OFFICIAL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

// (v1.5.1, catalog review #116030) Read + mirror only: the user's combo in the
// official store is copied into plugin storage (read, no write); survival of a
// startup wipe comes from serving the backup as the KEYBINDS contribution's
// `defaults` below — bindingsFor falls back to defaults, so dispatch + the
// settings panel both resolve without ever writing the app's own store.
// (Writing `hermes.desktop.keybinds` from a plugin was ruled out-of-surface;
// the underlying "app drops a contributed keybind on reload" gap is filed
// upstream as an apps/desktop issue.)
function syncKeybindBackup() {
  if (!store) return
  const official = readOfficialKeybindMap()
  const officialCombo = official ? official[KEYBIND_ACTION_ID] : undefined

  if (Array.isArray(officialCombo) && officialCombo.length > 0) {
    keybindBackup = officialCombo
    store.set(KEYBIND_BACKUP_KEY, officialCombo)
    return
  }

  const backup = store.get(KEYBIND_BACKUP_KEY, null)
  if (Array.isArray(backup) && backup.length > 0) {
    keybindBackup = backup
  }
}

// Module-level i18n fallback: loadSnippets runs outside React (no hook
// access). ctx.i18n.t is captured at register time; before that, zh text.
let ti18nStatic = null
function notifyCorrupted() {
  host.notify({ kind: 'error', message: ti18nStatic ? ti18nStatic('notify.corrupted') : '片段数据损坏，已重置为空' })
}

function loadSnippets() {
  if (!store) return []
  const raw = store.get(STORAGE_KEY, [])
  if (!Array.isArray(raw)) {
    notifyCorrupted()
    store.set(STORAGE_KEY, [])
    return []
  }
  return raw
    .filter(s => s && typeof s.label === 'string' && typeof s.text === 'string')
    // Old records load with one canonical shape: tags: [], enabled: true.
    .map(s => ({
      ...s,
      tags: Array.isArray(s.tags) ? s.tags : [],
      enabled: s.enabled !== false
    }))
}

function saveSnippets(list) {
  if (store) store.set(STORAGE_KEY, list)
}

// ── UI (components MUST live at module top level — per-render function
//    identity remounts subtrees and breaks continuous gestures) ────────────
//
// Row visual = the official PromptSnippetsDialog row (context-menu.tsx):
// transparent button card, hover reveals stroke + control-hover fill,
// MessageSquareText lead icon, label + caption description. Layout values
// are inline style (uncompiled Tailwind classes are dead strings) except
// classes verified present in the dist CSS bundle.

// Official row geometry, inlined (verified-dead classes: px-2.5, gap-2.5,
// size-3.5, mt-0.5 are NOT in dist/assets/index-*.css).
// Official CapRow geometry (master-detail.tsx): NO border at all — fixed
// height (h-11 with subtitle / h-8 bare), pl-2 pr-1.5, rounded-md, and pure
// background fill: hover --ui-row-hover-background, active --ui-row-active-
// background (the same var the skills rail uses for the selected row).
const rowStyle = {
  display: 'flex',
  width: '100%',
  cursor: 'pointer',
  alignItems: 'center',
  gap: '8px', // gap-2
  borderRadius: 'calc(var(--radius-scalar) * 0.625rem)', // rounded-md
  padding: '0 6px 0 8px', // pr-1.5 pl-2
  textAlign: 'left',
  transition: 'color 100ms ease-out, background-color 100ms ease-out',
  background: 'transparent',
  font: 'inherit',
  color: 'var(--ui-text-secondary)'
}

const rowHoverStyle = {
  background: 'var(--ui-row-hover-background)',
  transition: 'none'
}

const rowBodyStyle = {
  display: 'grid',
  minWidth: 0,
  gap: '2px', // gap-0.5
  flex: 1
}

// CapRow title line: 0.78rem medium + shrink-0 chips (subtitle pattern).
const rowLabelLineStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px', // gap-1
  minWidth: 0
}

// CapRow title: enabled = font-medium text-foreground/85; disabled =
// font-normal text-muted-foreground/60 (muted-foreground = --ui-text-tertiary).
const rowLabelStyle = {
  fontSize: '0.78rem',
  fontWeight: 500,
  color: 'color-mix(in srgb, var(--foreground) 85%, transparent)',
  minWidth: 0,
  flexShrink: 1,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis'
}

const rowLabelOffStyle = {
  ...rowLabelStyle,
  fontWeight: 400,
  color: 'color-mix(in srgb, var(--ui-text-tertiary) 60%, transparent)'
}

// Tag = the official Badge (muted variant, skills-tab subtitle flavor):
// rounded-[3px] rect, px-1 py-px, 0.6rem medium leading-none, bg-muted =
// --ui-bg-tertiary, text-muted-foreground = --ui-text-tertiary. NOT a
// full-round pill — that was PanelPill (category) language, wrong for tags.
const badgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  flexShrink: 0,
  width: 'fit-content',
  borderRadius: '3px',
  padding: '1px 4px', // px-1 py-px
  fontSize: '0.6rem',
  fontWeight: 500,
  lineHeight: 1, // leading-none
  whiteSpace: 'nowrap',
  background: 'var(--ui-bg-tertiary)',
  color: 'var(--ui-text-tertiary)'
}

const tagChipStyle = {
  ...badgeStyle,
  maxWidth: '72px',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
}

// One line, always. Wrapping descriptions were the height blow-out.
const rowDescStyle = {
  fontSize: '0.62rem',
  color: 'color-mix(in srgb, var(--foreground) 50%, transparent)',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis'
}

// Selected = the skills rail's active row: pure background fill, no chrome.
const rowSelectedStyle = {
  background: 'var(--ui-row-active-background)',
  color: 'var(--foreground)',
  transition: 'none'
}

const labelBtnStyle = {
  display: 'block',
  flex: 1,
  minWidth: 0,
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: 'inherit',
  font: 'inherit'
}

const dragHandleStyle = {
  cursor: 'grab',
  color: 'var(--ui-text-tertiary)',
  fontSize: '14px',
  lineHeight: 1,
  padding: '2px 4px',
  flexShrink: 0,
  userSelect: 'none'
}

// Manage-list row (two-pane layout): one compact line — label + optional tag
// chips + ⠿ handle. Single-click selects (right pane previews), double-click
// inserts. Label/description each clamp to ONE line (the old wrap was the
// height blow-out). `index` = position in the CURRENTLY RENDERED list (filter
// may hide rows) — drag target math uses it; reorder commits by id so the
// splice semantics stay correct.
function SnippetRow({ snippet, list, index, dispatch, t, selected, canDrag }) {
  const [hover, setHover] = useState(false)
  const [pointerDragging, setPointerDragging] = useState(false)
  const rowRef = useRef(null)
  // Transform preview (dnd-kit pattern): while dragging, the dragged row
  // follows the pointer (transform set imperatively in onPointerMove) and the
  // rows between origin and the current slot slide by one row height. No list
  // mutation until release — zero flicker.
  const fromId = useValue($dragFromId)
  const overId = useValue($dragOverId)
  const isDragging = fromId === snippet.id
  const fromIdx = fromId ? list.findIndex(s => s.id === fromId) : -1
  const overIdx = overId ? list.findIndex(s => s.id === overId) : -1
  const myIdx = index
  let shift = 0
  if (fromIdx >= 0 && overIdx >= 0 && myIdx >= 0 && !isDragging) {
    if (fromIdx < overIdx && myIdx > fromIdx && myIdx <= overIdx) shift = -1
    else if (fromIdx > overIdx && myIdx >= overIdx && myIdx < fromIdx) shift = 1
  }
  const hasSub = !!(snippet.description || (snippet.tags || []).length > 0)
  const off = snippet.enabled === false
  return jsxs('div', {
    ref: rowRef,
    style: {
      ...rowStyle,
      height: hasSub ? '44px' : '32px', // h-11 / h-8
      ...(hover ? rowHoverStyle : null),
      ...(selected ? rowSelectedStyle : null),
      ...(isDragging && pointerDragging
        ? { opacity: 0.85, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 10, position: 'relative' }
        : null),
      transform: shift && !pointerDragging ? `translateY(${shift * 100}%)` : undefined,
      // On the commit frame the doc-flow already matches the preview the user
      // saw (they watched the rows slide while dragging) — transitioning
      // again would double-animate. Freeze exactly that frame.
      transition: document.body.dataset.snippetsCommitting ? 'none' : 'transform 150ms ease'
    },
    onMouseEnter: () => {
      // Hover locked during ANY drag (module atom): mousemove over other rows
      // while dragging would flip their hover state and re-render the whole
      // list every row boundary crossed — one of the flicker sources.
      if (!fromId) setHover(true)
    },
    onMouseLeave: () => {
      if (!fromId) setHover(false)
    },
    children: [
      jsx(
        'button',
        {
          type: 'button',
          onClick: () => dispatch({ type: 'select', id: snippet.id }),
          onDoubleClick: () => dispatch({ type: 'insert', id: snippet.id }),
          style: labelBtnStyle,
          children: jsxs('span', {
            style: rowBodyStyle,
            children: [
              jsx('span', {
                // Official CapRow off-row language: the TITLE recedes
                // (font-normal + muted-foreground/60), not the whole row.
                style: off ? rowLabelOffStyle : rowLabelStyle,
                children: snippet.label
              }, 'label'),
              hasSub
                ? jsxs('span', {
                    style: rowLabelLineStyle,
                    children: [
                      snippet.description
                        ? jsx('span', { style: rowDescStyle, children: snippet.description }, 'desc')
                        : null,
                      (snippet.tags || []).slice(0, 3).map(tag =>
                        jsx('span', { style: tagChipStyle, children: tag }, tag)
                      )
                    ]
                  }, 'sub')
                : null
            ]
          })
        },
        'body'
      ),
      jsx('span', {
        style: canDrag ? dragHandleStyle : { ...dragHandleStyle, opacity: 0.3, cursor: 'default' },
        title: t('row.dragHint'),
        onPointerDown: e => {
          // Reorder is identity-position based; while a filter hides rows the
          // visual order no longer matches storage order, so the handle is
          // inert (opacity below) instead of silently wrong.
          if (!canDrag) {
            e.preventDefault()
            return
          }
          // Pointer drag session, official drag-session.ts pattern: a
          // sub-threshold (4px) press is NOT a drag — capture/cursor/scroll
          // lock engage only after real movement. Engaging on pointerdown
          // made the whole window a drag surface (drag outside the dialog,
          // wheel scrolling mid-drag scrambling the rows).
          e.preventDefault()
          const row = rowRef.current
          if (!row) return
          const rowH = row.getBoundingClientRect().height
          const startY = e.clientY
          const sx = e.clientX
          let engaged = false
          let lastOver = snippet.id
          let restoreCursor = null
          let restoreSelect = null

          function engage() {
            engaged = true
            row.setPointerCapture(e.pointerId)
            setPointerDragging(true)
            $dragFromId.set(snippet.id)
            $dragOverId.set(snippet.id)
            // Official engage chrome: kill text selection + set grabbing.
            restoreCursor = document.body.style.cursor
            restoreSelect = document.body.style.userSelect
            document.body.style.cursor = 'grabbing'
            document.body.style.userSelect = 'none'
            // Freeze scrolling for the whole session: a wheel tick mid-drag
            // scrolls the dialog list and every row rect goes stale.
            document.addEventListener('wheel', blockWheel, { passive: false, capture: true })
          }

          function blockWheel(ev) {
            ev.preventDefault()
            ev.stopPropagation()
          }

          function onMove(ev) {
            if (!engaged) {
              if (Math.hypot(ev.clientX - sx, ev.clientY - startY) < 4) return
              engage()
            }
            const dy = ev.clientY - startY
            row.style.transform = `translateY(${dy}px)`
            row.style.zIndex = '10'
            const steps = Math.round(dy / rowH)
            const idx = myIdx
            const target = list[idx + steps]
            if (target && target.id !== lastOver) {
              lastOver = target.id
              $dragOverId.set(target.id)
            }
          }
          function onUp(ev) {
            window.removeEventListener('pointermove', onMove, true)
            window.removeEventListener('pointerup', onUp, true)
            window.removeEventListener('pointercancel', onCancel, true)
            window.removeEventListener('keydown', onEsc, true)
            document.removeEventListener('wheel', blockWheel, { capture: true })
            if (restoreCursor !== null) document.body.style.cursor = restoreCursor
            if (restoreSelect !== null) document.body.style.userSelect = restoreSelect
            if (!engaged) return // sub-threshold press: plain click, nothing engaged
            row.releasePointerCapture(e.pointerId)
            const from = $dragFromId.get()
            const over = $dragOverId.get()
            const moved = from && over && from !== over
            // FLIP landing: record where the row VISUALLY is (doc-flow slot +
            // inline drag offset) BEFORE the commit, then after React reflows
            // set a residual transform so the row is pixel-identical — no jump
            // — and glide the residual to zero. The old code cleared the big
            // inline offset AFTER the reflow, so the first frame painted the
            // row at its old position: that was the flicker.
            const rectBefore = row.getBoundingClientRect()
            if (moved) {
              document.body.dataset.snippetsCommitting = '1' // freeze sibling transitions on the commit frame
              dispatch({ type: 'reorder', fromId: from, toId: over })
            }
            $dragFromId.set(null)
            $dragOverId.set(null)
            setPointerDragging(false)
            // Same DOM node after reorder (row key = snippet.id).
            requestAnimationFrame(() => {
              const rectAfter = row.getBoundingClientRect()
              const dy = rectBefore.top - rectAfter.top
              if (Math.abs(dy) < 1) {
                row.style.transform = ''
                row.style.zIndex = ''
                row.style.transition = ''
                delete document.body.dataset.snippetsCommitting
                return
              }
              // Residual: pin the row where the user dropped it…
              row.style.transition = 'none'
              row.style.transform = `translateY(${dy}px)`
              delete document.body.dataset.snippetsCommitting
              requestAnimationFrame(() => {
                // …then glide it into its new slot.
                row.style.transition = 'transform 180ms ease'
                row.style.transform = ''
                const cleanup = () => {
                  row.style.transition = ''
                  row.style.zIndex = ''
                }
                row.addEventListener('transitionend', cleanup, { once: true })
                setTimeout(cleanup, 220) // safety net if transitionend is eaten
              })
            })
          }
          function onCancel() {
            // pointercancel (official: everything discarded, nothing commits).
            onUp({ clientX: sx, clientY: startY, pointerId: e.pointerId, cancel: true })
            row.style.transform = ''
            row.style.zIndex = ''
          }
          function onEsc(ev) {
            // Esc aborts the drag alone (official: top escape layer semantics).
            if (ev.key !== 'Escape') return
            ev.preventDefault()
            ev.stopPropagation()
            onCancel()
          }
          window.addEventListener('pointermove', onMove, true)
          window.addEventListener('pointerup', onUp, true)
          window.addEventListener('pointercancel', onCancel, true)
          window.addEventListener('keydown', onEsc, true)
        },
        children: '⠿'
      })
    ]
  })
}

function SnippetForm({ draft, onDraft, t }) {
  // Field = label line + control; static arrays need explicit keys (React 19).
  const field = (key, labelText, control) =>
    jsxs('div', { style: { display: 'grid', gap: '4px' }, children: [
      jsx('div', { style: { fontSize: '12px', opacity: 0.7 }, children: labelText }, 'l'),
      control
    ] }, key)
  return jsxs('div', {
    style: { display: 'grid', gap: '10px', paddingTop: '4px' },
    children: [
      field('label', t('manage.fieldLabel'), jsx(Input, {
        value: draft.label,
        onChange: e => onDraft({ ...draft, label: e.target.value }),
        placeholder: t('manage.fieldLabelPh')
      }, 'i')),
      field('desc', t('manage.fieldDesc'), jsx(Input, {
        value: draft.description,
        onChange: e => onDraft({ ...draft, description: e.target.value }),
        placeholder: t('manage.fieldDescPh')
      }, 'i')),
      field('tags', t('manage.fieldTags'), jsx(Input, {
        value: draft.tags,
        onChange: e => onDraft({ ...draft, tags: e.target.value }),
        placeholder: t('manage.fieldTagsPh')
      }, 'i')),
      field('text', t('manage.fieldText'), jsx(Textarea, {
        value: draft.text,
        rows: 6,
        onChange: e => onDraft({ ...draft, text: e.target.value }),
        placeholder: t('manage.fieldTextPh')
      }, 'i'))
    ]
  })
}

// ── Manage dialog: two-pane layout styles ─────────────────────────────────
// Dialog shell carries `max-w-3xl` (compiled class, beats the built-in
// max-w-lg through twMerge) and `max-h-[85vh]`; the body grid owns the scroll,
// so the panes clamp to the shell with min-h-0 and scroll internally.

const managerBodyStyle = {
  display: 'flex',
  gap: 0, // column seam = left pane padding + hairline (see pane styles)
  minHeight: 0,
  flex: 1,
  width: '100%'
}

// Region separation with the official page's language = a 1px hairline on
// the column seam (the MasterDetail sash line), not margins alone.
const paneLeftStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  width: '260px',
  flexShrink: 0,
  minHeight: 0,
  paddingRight: '13px',
  borderRight: '1px solid var(--ui-stroke-secondary)'
}

const paneRightStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  paddingLeft: '13px'
}

const listScrollStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  overscrollBehavior: 'contain',
  paddingRight: '2px'
}

const rightScrollStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain'
}

// Tag-chip row above the list: filter affordance (click = toggle filter).
const tagBarStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px',
  alignItems: 'center',
  flexShrink: 0
}

const tagFilterChipStyle = {
  cursor: 'pointer',
  font: 'inherit',
  borderRadius: 'calc(var(--radius-scalar) * 0.375rem)',
  border: '1px solid var(--ui-stroke-tertiary)',
  background: 'transparent',
  color: 'var(--ui-text-tertiary)',
  fontSize: '11px',
  lineHeight: '16px',
  padding: '0 6px',
  maxWidth: '96px',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis'
}

const tagFilterChipActiveStyle = {
  borderColor: 'var(--foreground)',
  color: 'var(--foreground)',
  background: 'var(--ui-control-hover-background)'
}

// ── Official detail-pane language (skill-detail.tsx, verbatim geometry) ──
// Meta card = `grid gap-1 rounded-lg border border-(--ui-stroke-tertiary)
// bg-(--ui-bg-quinary) p-3` with `flex gap-2 text-[0.68rem] leading-4` rows:
// key = `w-24 shrink-0 font-medium text-(--ui-text-tertiary)`,
// value = `min-w-0 whitespace-pre-wrap break-words text-(--ui-text-secondary)`.
const metaCardStyle = {
  display: 'grid',
  gap: '4px', // gap-1
  borderRadius: 'calc(var(--radius-scalar) * 0.75rem)', // rounded-lg (.75rem verified in dist)
  border: '1px solid var(--ui-stroke-tertiary)',
  background: 'var(--ui-bg-quinary)',
  padding: '12px', // p-3
  flexShrink: 0,
  minWidth: 0
}

const metaRowStyle = {
  display: 'flex',
  gap: '8px', // gap-2
  fontSize: '0.68rem',
  lineHeight: '16px' // leading-4
}

const metaKeyStyle = {
  width: '96px', // w-24
  flexShrink: 0,
  fontWeight: 500,
  color: 'var(--ui-text-tertiary)'
}

const metaValStyle = {
  minWidth: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word', // break-words
  color: 'var(--ui-text-secondary)'
}

// Content = the official <pre> card: same skin, mono, internal scroll.
const preCardStyle = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  borderRadius: 'calc(var(--radius-scalar) * 0.75rem)',
  border: '1px solid var(--ui-stroke-tertiary)',
  background: 'var(--ui-bg-quinary)',
  padding: '12px',
  fontFamily: 'var(--dt-font-mono)', // .font-mono compiles to this var
  fontSize: '0.68rem',
  lineHeight: 1.625 // leading-relaxed
}

// DetailHeader title (h3 text-[0.9375rem] font-semibold tracking-tight) +
// PanelPill tags (rounded-full px-1.5 py-0.5 text-[0.62rem] muted tone).
// Title-line tags = PanelPill (skill-detail header pills slot): full-round,
// px-1.5 py-0.5, 0.62rem medium, muted tone = bg-foreground/10 + tertiary text.
const pillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '9999px',
  padding: '2px 6px',
  fontSize: '0.62rem',
  fontWeight: 500,
  background: 'color-mix(in srgb, var(--foreground) 10%, transparent)',
  color: 'var(--ui-text-tertiary)'
}

const detailTitleLineStyle = {
  display: 'flex',
  minHeight: '24px',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px'
}

const detailTitleStyle = {
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  fontSize: '0.9375rem',
  fontWeight: 600,
  letterSpacing: '-0.01em'
}

const detailDescStyle = {
  marginTop: '4px',
  fontSize: 'var(--conversation-caption-font-size)',
  color: 'var(--ui-text-tertiary)'
}

const placeholderBoxStyle = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '160px',
  fontSize: '0.78rem',
  color: 'var(--ui-text-quaternary)'
}

// ── SearchField (components/ui/search-field.tsx, borderless until focus) ──
const searchRowStyle = {
  display: 'inline-flex',
  minWidth: 0,
  maxWidth: '100%',
  alignItems: 'center',
  gap: '6px', // gap-1.5
  borderBottom: '1px solid transparent',
  padding: '0 2px', // px-0.5
  transition: 'color 150ms, border-color 150ms, opacity 150ms'
}

const searchRowActiveStyle = {
  borderBottomColor: 'var(--ui-stroke-tertiary)'
}

const searchInputStyle = {
  height: '28px', // h-7
  minWidth: 0,
  maxWidth: '100%',
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: '12px', // text-xs
  color: 'var(--foreground)'
}

const toolbarRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flexShrink: 0
}

// ── Quick picker (Cmd-K style: filter + ↑↓ + ↵) ───────────────────────────

// Official `/` drawer skin (composerPanelCard, composer-dock.ts:31-35) inlined:
// rounded-2xl, hairline border-border/65, shadow-nous (4-layer stack verified
// in dist CSS), --dt-card 72% translucent fill + backdrop blur, tool font size.
// Width = full composer width (left/right 0) like the official drawer.
// Official `/` drawer geometry + skin, verbatim from COMPLETION_DRAWER_CLASS
// (completion-drawer.tsx) and composerPanelCard (composer-dock.ts). The layer
// is MOVED into this instance's [data-slot="composer-root"] after mount — the
// same parent the official drawer renders in (relative anchor) — so plain CSS
// positions it and zero JS measurement is involved. No `position: fixed`: a
// glassy backdrop-filter ancestor hijacks the fixed coordinate system, which
// is exactly what mis-positioned earlier attempts.
const inlineShellStyle = {
  position: 'absolute',
  bottom: '100%', // bottom-full
  left: '8px', // left-2
  marginBottom: '4px', // mb-1
  zIndex: 50,
  width: '20rem', // w-80
  maxWidth: 'calc(100% - 1rem)', // max-w-[calc(100%-1rem)]
  maxHeight: 'min(22rem, calc(100vh - 8rem))',
  overflowY: 'auto',
  // Belt-and-braces: an auto overflow-y computes overflow-x to auto too, so
  // any stray horizontal overflow would open a scroll channel that
  // scroll-positioning could shift (eating the shell's left padding).
  overflowX: 'hidden',
  overscrollBehavior: 'contain',
  padding: '4px', // p-1
  // composerPanelCard skin, verbatim:
  // rounded-2xl compiles to calc(var(--radius-scalar) * 1.5rem) — the
  // --radius-2xl var itself lives in Tailwind's @theme inline block which is
  // NOT emitted as a runtime CSS variable, so referencing it resolves to
  // nothing (same trap as var(--border) before). --radius-scalar is a real
  // :root var (styles.css:464, runtime value 0.2).
  borderRadius: 'calc(var(--radius-scalar) * 1.5rem)',
  // border-border/65 compiles to --dt-border in oklab (dist CSS verified):
  // var(--border) does NOT exist in the theme, which made the border invisible.
  border: '1px solid color-mix(in oklab, var(--dt-border) 65%, transparent)',
  boxShadow: 'var(--shadow-nous)',
  background: 'color-mix(in srgb, var(--dt-card) 72%, transparent)',
  backdropFilter: 'blur(0.75rem) saturate(1.12)',
  WebkitBackdropFilter: 'blur(0.75rem) saturate(1.12)',
  transition: 'background-color 150ms ease-out',
  fontSize: 'var(--conversation-tool-font-size)',
  color: 'var(--popover-foreground)'
}

// Must NOT be `display: grid` (the original bug): a grid auto column sizes to
// the items' max-content, so one long row pushed every row past the 20rem
// shell — the right-hand padding + row gutter fell outside the clip and the
// description hit the card edge with no ellipsis. The official drawer keeps
// rows in normal flow so `w-full` is hard-bound to the container width; a
// flex column gets the same constraint (cross-axis stretch) while keeping
// the 2px row rhythm.
const quickListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  // The shell itself scrolls (official drawer: overflow-y-auto on the shell).
  overflowY: 'visible',
  marginTop: '2px'
}

// Official trigger-popover ROW_CLASS: flex items-center gap-2 rounded-md
// px-2 py-1; hover bg-(--ui-bg-tertiary); highlighted same.
const quickRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '4px 8px',
  borderRadius: 'calc(var(--radius-scalar) * 0.625rem)', // rounded-md
  cursor: 'default',
  userSelect: 'none',
  background: 'transparent',
  width: '100%',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit'
}

const quickRowActiveStyle = {
  background: 'var(--ui-bg-tertiary)'
}

const quickInputRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '4px 8px 6px',
  // Same --dt-border/oklab fix as the shell border.
  borderBottom: '1px solid color-mix(in oklab, var(--dt-border) 65%, transparent)'
}

// Official row icon column: grid size-4 place-items-center (16px). Reused by
// the filter row lead icon and each row's icon.
const quickIconStyle = {
  display: 'grid',
  placeItems: 'center',
  width: '16px',
  height: '16px',
  flexShrink: 0,
  color: 'var(--ui-text-tertiary)'
}

// Name: official `min-w-0 shrink truncate font-medium leading-5 text-foreground`.
// flexShrink must be 1 (official `shrink`) — with 0, a long label refuses to
// compress, pushes the row past the w-80 shell and turns the layer into a
// horizontally scrollable box (the "no width limit / margin lost on ↑↓" bug).
const quickNameStyle = {
  minWidth: 0,
  flexShrink: 1,
  fontWeight: 500,
  lineHeight: '1.25rem',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  color: 'var(--foreground)'
}

// Description: official `min-w-0 flex-1 truncate leading-5
// text-(--ui-text-tertiary)`.
const quickDescStyle = {
  flex: 1,
  minWidth: 0,
  lineHeight: '1.25rem',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  color: 'var(--ui-text-tertiary)'
}

// ── Quick picker: native DOM layer hosted INSIDE composer-root ────────────
// The official `/` drawer is an absolute child of ComposerPrimitive.Root and
// anchors with plain CSS (bottom-full left-2 mb-1 w-80). Contrib slots render
// OUTSIDE that root, and a React-owned node re-parented there breaks keyboard
// handling + unmount — so this layer is built and torn down in plain DOM:
// same geometry, same skin, events bound to the nodes that receive them.

function surfaceComposerEl(surface) {
  // `data-composer-target` hangs on the ChatView ROOT div — an ANCESTOR of
  // composer-root (chat/index.tsx:654). Descend, don't climb.
  const host = document.querySelector(`[data-composer-target="${surface}"]`)
  return host ? host.querySelector('[data-slot="composer-root"]') : null
}

function surfaceEditorEl(surface) {
  const host = document.querySelector(`[data-composer-target="${surface}"]`)
  if (!host) return null
  return (
    host.querySelector('[data-slot="composer-input"]') ||
    host.querySelector('.ProseMirror[contenteditable="true"]') ||
    host.querySelector('[contenteditable="true"]')
  )
}

// Standalone insert (no React scope): host.composer (SDK hosts, session-
// addressed), then the bus event, then the captured "+"-menu ctx, then a
// direct splice into THIS surface's editor. The legacy chain below is kept
// for every desktop build released before host.composer shipped.
async function insertTextIntoSurface(surface, text, sid) {
  const c = sdkComposer()
  if (c) {
    const ok = await sdkAppendBlock(c, sid ?? null, text)
    if (ok) {
      if (typeof c.focus === 'function') c.focus(sid ?? null)
      return true
    }
    // Fail-closed (no live surface for the address) — fall through to DOM.
  }
  try {
    window.dispatchEvent(
      new CustomEvent('hermes:composer-insert', {
        detail: { mode: 'block', target: surface, text }
      })
    )
    return true
  } catch {
    // Fall through to legacy paths.
  }
  if (insertCtxRef && typeof insertCtxRef.insertText === 'function') {
    try {
      insertCtxRef.insertText(text)
      return true
    } catch {
      // Stale closure after a reload — fall through.
    }
  }
  const editor = surfaceEditorEl(surface)
  if (editor) {
    const current = editor.innerText || ''
    const sep = current && !current.endsWith('\n') ? '\n' : ''
    editor.textContent = `${current}${sep}${text}`
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
    editor.focus()
    return true
  }
  return false
}

let quickLayerClose = null // set while a quick layer is open; onDispose uses it

function openQuickLayer({ composerEl, surface, filterPh, emptyLabel, insertFailedLabel }) {
  if (quickLayerClose) quickLayerClose()
  if (!composerEl) return false
  // The picker is the "daily driver" surface: disabled snippets are hidden
  // here but stay fully visible/manageable in the manager dialog.
  const snippets = loadSnippets().filter(sn => sn.enabled !== false)
  if (snippets.length === 0) {
    // Nothing to pick — fall to the manage view so the user can create.
    $mode.set('manage')
    $managerOpen.set(true)
    return true
  }

  let query = ''
  let active = 0
  const view = () =>
    snippets.filter(
      s =>
        s.label.toLowerCase().includes(query) ||
        (s.description || '').toLowerCase().includes(query)
    )

  const el = (tag, style) => {
    const n = document.createElement(tag)
    if (style) Object.assign(n.style, style)
    return n
  }
  const iconSpan = () => {
    const s = el('span', quickIconStyle)
    s.setAttribute('aria-hidden', 'true')
    s.innerHTML = MESSAGE_SQUARE_SVG
    return s
  }

  const shell = el('div', inlineShellStyle)
  shell.setAttribute('data-prompt-snippets-layer', '')

  const filterRow = el('div', quickInputRowStyle)
  filterRow.appendChild(iconSpan())
  const input = el('input', {
    flex: '1 1 0%',
    minWidth: '0px',
    font: 'inherit',
    color: 'inherit',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    padding: '0px'
  })
  input.placeholder = filterPh
  input.spellcheck = false
  filterRow.appendChild(input)
  shell.appendChild(filterRow)

  const listEl = el('div', quickListStyle)
  shell.appendChild(listEl)

  function renderRows() {
    listEl.textContent = ''
    const items = view()
    if (items.length === 0) {
      const d = el('div', { padding: '14px 0px', textAlign: 'center', fontSize: '13px', opacity: '0.55' })
      d.textContent = emptyLabel
      listEl.appendChild(d)
      return
    }
    if (active >= items.length) active = 0
    items.forEach((sn, i) => {
      const btn = el('button', { ...quickRowStyle, ...(i === active ? quickRowActiveStyle : null) })
      btn.type = 'button'
      btn.appendChild(iconSpan())
      const name = el('span', quickNameStyle)
      name.textContent = sn.label
      btn.appendChild(name)
      if (sn.description) {
        const desc = el('span', quickDescStyle)
        desc.textContent = sn.description
        btn.appendChild(desc)
      }
      btn.addEventListener('click', () => pick(sn))
      btn.addEventListener('mousemove', () => {
        if (active !== i) {
          active = i
          renderRows()
        }
      })
      listEl.appendChild(btn)
    })
  }

  function scrollActive() {
    // Official pattern (trigger-popover.tsx): scroll the drawer itself, never
    // scrollIntoView — it acts on every scrollable ancestor and can shift the
    // layer horizontally / steal focus of the layout. `nearest` semantics:
    // move only when the row overflows exactly one edge, shortest delta wins.
    const node = listEl.children[active]
    if (!node) return
    const shellRect = shell.getBoundingClientRect()
    const rowRect = node.getBoundingClientRect()
    const visibleTop = shellRect.top + shell.clientTop
    const visibleBottom = visibleTop + shell.clientHeight
    const topDelta = rowRect.top - visibleTop
    const bottomDelta = rowRect.bottom - visibleBottom
    if ((topDelta < 0) === (bottomDelta > 0)) return // fully visible, or spans both edges
    shell.scrollTop += Math.abs(topDelta) < Math.abs(bottomDelta) ? topDelta : bottomDelta
  }

  function close({ refocus = true } = {}) {
    quickLayerClose = null
    document.removeEventListener('keydown', onDocKey, true)
    document.removeEventListener('pointerdown', onDocPointer, true)
    shell.remove()
    // The filter input stole focus from the composer; hand it back so the
    // user keeps typing where the insert is about to land. SDK hosts get the
    // supported verb (session-addressed); the editor.focus() path is legacy.
    if (refocus) {
      const c = sdkComposer()
      if (c && typeof c.focus === 'function') {
        c.focus(openSid)
      } else {
        const ed = surfaceEditorEl(surface)
        if (ed) ed.focus()
      }
    }
  }

  async function pick(sn) {
    close({ refocus: false })
    if (!(await insertTextIntoSurface(surface, sn.text, openSid))) {
      host.notify({ kind: 'error', message: insertFailedLabel })
    }
  }

  function onDocKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }
  function onDocPointer(e) {
    if (!shell.contains(e.target)) close()
  }

  input.addEventListener('keydown', e => {
    if (e.isComposing) return // IME confirm (Chinese input) is not a pick
    const items = view()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (items.length) {
        active = Math.min(active + 1, items.length - 1)
        renderRows()
        scrollActive()
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (items.length) {
        active = Math.max(active - 1, 0)
        renderRows()
        scrollActive()
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const sn = view()[active]
      if (sn) pick(sn)
    }
  })
  input.addEventListener('input', () => {
    query = input.value.trim().toLowerCase()
    active = 0
    renderRows()
  })

  // Capture-phase doc listeners: Escape closes from anywhere, a click outside
  // the layer closes (Radix Dialog parity).
  document.addEventListener('keydown', onDocKey, true)
  document.addEventListener('pointerdown', onDocPointer, true)
  quickLayerClose = close

  composerEl.appendChild(shell)
  renderRows()
  requestAnimationFrame(() => input.focus())
  return true
}

function ManagerDialog() {
  const open = useValue($managerOpen)
  const mode = useValue($mode)
  const t = usePluginI18n(ID)
  const [list, setList] = useState([])
  const [editing, setEditing] = useState(null)
  // Right-pane view state: 'preview' (read-only detail of `selectedId`),
  // 'edit' (draft in `editing`), 'import' (paste-JSON box). The list in the
  // left pane never disappears — the old full-page swap was the other half of
  // the "out of control" complaint.
  const [view, setView] = useState('preview')
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [tagFilter, setTagFilter] = useState(null)
  // Two-click delete: first click arms, second (or timeout) commits.
  const [pendingDel, setPendingDel] = useState(null)
  const [importText, setImportText] = useState('')
  const [wasOpen, setWasOpen] = useState(false)
  // Which chat surface THIS dialog instance lives in. The underside slot
  // renders inside each session's composer dock, so the DOM ancestor chain
  // names our own surface — this is the same scoping the official snippet
  // dialog gets for free from React context, and it's what makes inserts
  // land in the session whose dock is showing the dialog.
  const [myTarget, setMyTarget] = useState(null)
  const [myTargetResolved, setMyTargetResolved] = useState(false)

  // Resolve this instance's surface via a real DOM node. The probe div below
  // is rendered UNCONDITIONALLY (even when closed) so the resolution happens
  // once at app start, not lazily on open — gating before resolving meant
  // unopened instances never resolved and every gate passed through the
  // null-loophole.
  const [hostEl, setHostEl] = useState(null)
  if (hostEl && !myTargetResolved) {
    const inDoc = hostEl.isConnected
    const surface = inDoc ? hostEl.closest('[data-composer-target]') : null
    setMyTarget(surface ? surface.getAttribute('data-composer-target') : 'main')
    setMyTargetResolved(true)
  }

  // Reload data on each open (render-phase state adjustment pattern).
  if (open && !wasOpen) {
    setWasOpen(true)
    const loaded = loadSnippets()
    setList(loaded)
    setEditing(null)
    setView('preview')
    // Land with the first snippet selected — the manager never opens into an
    // empty right pane.
    setSelectedId(loaded.length > 0 ? loaded[0].id : null)
    setSearch('')
    setTagFilter(null)
    setPendingDel(null)
    setImportText('')
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  // (Quick mode with zero snippets is handled inside openQuickLayer — the
  // keybind flips to manage before any Dialog mounts. The React subtree only
  // ever renders manage.)

  // Only the instance whose surface matches the one captured at open time
  // shows a dialog. Fallback chain keeps the dialog VISIBLE even when the
  // snapshot is missing or the per-instance identity failed to resolve — a
  // mismatched gate must never swallow the dialog entirely (that regression
  // made the whole picker vanish in single-surface windows).
  const shouldShow =
    open &&
    (openSurface === null || myTarget === null || myTarget === openSurface || !myTargetResolved)

  if (!open || !shouldShow) return null

  async function insertIntoComposer(text) {
    // SDK hosts: address the session captured when the dialog opened (the
    // dialog steals DOM focus, so probing focus here is useless — same
    // reason the legacy chain snapshots openSurface at open time).
    const c = sdkComposer()
    if (c && (await sdkAppendBlock(c, openSid, text))) {
      $managerOpen.set(false)
      return true
    }
    // Legacy chain (every desktop build released before host.composer
    // shipped): insert into THIS instance's own surface — the dialog
    // physically lives in that session's composer dock, same as the official
    // snippet dialog.
    let resolved = myTarget || openSurface || captureSurface() || firstVisibleSurface()
    try {
      window.dispatchEvent(
        new CustomEvent('hermes:composer-insert', {
          detail: { mode: 'block', target: resolved, text }
        })
      )
      $managerOpen.set(false)
      return true
    } catch {
      // Fall through to the legacy paths below.
    }
    // Legacy path 1: captured insert ctx from a "+" menu-row click.
    if (insertCtxRef && typeof insertCtxRef.insertText === 'function') {
      try {
        insertCtxRef.insertText(text)
        $managerOpen.set(false)
        return true
      } catch {
        // Stale closure after a reload — fall through.
      }
    }
    // Legacy path 2 (last resort): splice into the first visible editable.
    const editors = Array.from(document.querySelectorAll('[data-slot="composer-input"], [contenteditable="true"].ProseMirror, div[role="textbox"][contenteditable="true"]'))
    const editor = editors.find(el => el.offsetParent !== null) || editors[0]
    if (editor) {
      const current = editor.innerText || ''
      const sep = current && !current.endsWith('\n') ? '\n' : ''
      const next = `${current}${sep}${text}`
      editor.textContent = next
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
      editor.focus()
      $managerOpen.set(false)
      return true
    }
    return false
  }

  function commit(next) {
    setList(next)
    saveSnippets(next)
  }

  function openEdit(sn) {
    setEditing({
      id: sn.id,
      label: sn.label,
      description: sn.description || '',
      text: sn.text,
      tags: (sn.tags || []).join(', ')
    })
    setView('edit')
    setPendingDel(null)
  }

  async function insertSnippet(sn) {
    // Defensive gate: the quick picker hides disabled rows, but manager
    // double-click / insert on a disabled row should explain, not silently
    // insert something the user meant to retire.
    if (sn.enabled === false) {
      host.notify({ kind: 'info', message: t('notify.insertDisabled') })
      return
    }
    if (await insertIntoComposer(sn.text)) return
    host.notify({ kind: 'error', message: t('notify.insertFailed') })
  }

  function exportAll() {
    if (list.length === 0) {
      host.notify({ kind: 'info', message: t('notify.exportEmpty') })
      return
    }
    const json = JSON.stringify(list, null, 2)
    const fallback = () => {
      try {
        const ta = document.createElement('textarea')
        ta.value = json
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        if (ok) host.notify({ kind: 'success', message: t('notify.exportDone') })
        else host.notify({ kind: 'warning', message: t('notify.exportFailed') })
      } catch {
        host.notify({ kind: 'warning', message: t('notify.exportFailed') })
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(
        () => host.notify({ kind: 'success', message: t('notify.exportDone') }),
        fallback
      )
    } else {
      fallback()
    }
  }

  function importFrom(text) {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (!Array.isArray(parsed)) {
      host.notify({ kind: 'error', message: t('notify.importBad') })
      return
    }
    const { list: merged, added } = mergeSnippets(list, parsed)
    if (added === 0) {
      host.notify({ kind: 'info', message: t('notify.importNone') })
    } else {
      commit(merged)
      host.notify({ kind: 'success', message: `${t('notify.importDone')} ${added} ${t('notify.importUnit')}` })
    }
    setView('preview')
  }

  function dispatch(action) {
    if (action.type === 'insert') {
      const sn = list.find(s => s.id === action.id)
      if (sn) void insertSnippet(sn)
      return
    }
    if (action.type === 'select') {
      setSelectedId(action.id)
      setView('preview')
      setPendingDel(null)
      return
    }
    if (action.type === 'edit') {
      const sn = list.find(s => s.id === action.id)
      if (!sn) return
      setSelectedId(sn.id)
      openEdit(sn)
      return
    }
    if (action.type === 'delete') {
      const next = removeSnippet(list, action.id)
      commit(next)
      if (selectedId === action.id) {
        setSelectedId(null)
        setView('preview')
      }
      setPendingDel(null)
      return
    }
    if (action.type === 'arm-delete') {
      setPendingDel(pendingDel === action.id ? null : action.id)
      return
    }
    if (action.type === 'toggle') {
      const sn = list.find(x => x.id === action.id)
      if (!sn) return
      commit(updateSnippet(list, sn.id, { enabled: sn.enabled === false }))
      return
    }
    if (action.type === 'move') {
      commit(moveSnippet(list, action.id, action.dir))
      return
    }
    if (action.type === 'reorder') {
      commit(reorderSnippet(list, action.fromId, action.toId))
    }
  }

  function saveDraft() {
    const clean = {
      label: editing.label.trim(),
      description: editing.description.trim(),
      text: editing.text,
      tags: editing.tags
    }
    let savedId = editing.id
    if (editing.id) {
      commit(updateSnippet(list, editing.id, clean))
    } else {
      const next = addSnippet(list, clean)
      savedId = next[next.length - 1].id
      commit(next)
    }
    setSelectedId(savedId)
    setEditing(null)
    setView('preview')
  }

  const draftValid = editing && editing.label.trim() !== '' && editing.text.trim() !== ''

  // Derived view state. Search + tag filter both apply; drag is only sound on
  // the unfiltered list (visual order must equal storage order), so the ⠿
  // handle goes inert while a filter is active.
  const q = search.trim().toLowerCase()
  const filtered = list.filter(sn => {
    if (tagFilter && !(sn.tags || []).includes(tagFilter)) return false
    if (!q) return true
    return (
      sn.label.toLowerCase().includes(q) ||
      (sn.description || '').toLowerCase().includes(q) ||
      (sn.tags || []).some(tag => tag.toLowerCase().includes(q))
    )
  })
  const dragEnabled = q === '' && tagFilter === null
  const allTags = (() => {
    const seen = new Set()
    const out = []
    for (const sn of list) {
      for (const tag of sn.tags || []) {
        if (!seen.has(tag)) {
          seen.add(tag)
          out.push(tag)
        }
      }
    }
    return out
  })()
  const selected = list.find(s => s.id === selectedId) || null

  // Probe div ALWAYS renders (it is what resolves myTarget); the Dialog only
  // mounts in the instance whose surface matches the open-time snapshot.
  // Zero-size so the underside strip's `empty:hidden` visual isn't affected —
  // the strip collapses only when its slot renders nothing, and a bare div
  // with no box (display:contents contributes no layout) keeps it collapsed.
  //
  // quick mode does NOT render React: the keybind run() builds a native DOM
  // layer inside the surface's composer-root directly (openQuickLayer). A
  // React-owned node re-parented there broke keyboard handling + unmount.
  // The React subtree only renders the manage Dialog.
  return jsx('div', {
    ref: setHostEl,
    style: { position: 'absolute', inset: '0px', pointerEvents: 'none' },
    children:
      shouldShow
      ? jsx(Dialog, {
    open: true,
    onOpenChange: o => {
      if (!o) $managerOpen.set(false)
    },
    children: jsx(DialogContent, {
      className: DIALOG_MAX_W,
      // Radix auto-focuses the first focusable element = the search input,
      // so the manager opened with a blinking caret in search. Suppress it;
      // the first snippet is selected instead (see the open-time state reset).
      onOpenAutoFocus: e => e.preventDefault(),
      children: jsxs('div', {
        // Vertical rhythm = the official body grid's gap-3 plus one more
        // step of air before the two panes; without this the title block
        // sat flush on the list (the wrapper ate the body gap). The 1fr
        // grid track gives us full remaining height; pin it so the two
        // panes get a definite box to scroll inside.
        style: { display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0, height: 'min(58vh, 540px)' },
        children: [
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flexShrink: 0 },
            children: [
              jsxs(DialogHeader, {
                style: { flex: 1, minWidth: 0, textAlign: 'left' },
                children: [
                  jsx(DialogTitle, { children: t('manage.title') }, 'title'),
                  jsx(DialogDescription, { children: t('manage.desc') }, 'desc')
                ]
              }, 'head'),
              // SearchField clone (search-field.tsx): borderless, recedes to
              // 30% until touched, underline on focus — pinned header-right
              // like PageSearchShell's header row.
              jsx('div', {
                style: {
                  ...searchRowStyle,
                  maxWidth: '260px',
                  opacity: search || searchFocused ? 1 : 0.3,
                  ...(searchFocused ? { opacity: 1 } : null)
                },
                onFocus: () => setSearchFocused(true),
                onBlur: () => setSearchFocused(false),
                children: [
                  jsx(Codicon, { name: 'search', size: '0.875rem', style: { flexShrink: 0, color: 'var(--ui-text-tertiary)' } }, 'i'),
                  jsx('input', {
                    style: searchInputStyle,
                    value: search,
                    placeholder: t('manage.searchPh'),
                    onChange: e => setSearch(e.target.value)
                  }, 'in'),
                  search
                    ? jsx('button', {
                        type: 'button',
                        title: t('manage.searchClear'),
                        onClick: () => setSearch(''),
                        style: { background: 'transparent', border: 'none', padding: '2px', cursor: 'pointer', color: 'var(--ui-text-tertiary)', display: 'inline-flex', flexShrink: 0 },
                        children: jsx(Codicon, { name: 'close', size: '0.875rem' })
                      }, 'clear')
                    : null
                ]
              }, 'search')
            ]
          }),
          jsx('div', {
            style: managerBodyStyle,
            children: [
              // ── Left pane: search + tag filter + compact list + tools ──
              jsxs('div', {
                style: paneLeftStyle,
                children: [
                  allTags.length > 0
                    ? jsx('div', {
                        style: tagBarStyle,
                        children: allTags.map(tag =>
                          jsx('button', {
                            type: 'button',
                            style: {
                              ...tagFilterChipStyle,
                              ...(tagFilter === tag ? tagFilterChipActiveStyle : null)
                            },
                            onClick: () => setTagFilter(tagFilter === tag ? null : tag),
                            children: tag
                          }, tag)
                        )
                      }, 'tags')
                    : null,
                  jsx('div', {
                    style: listScrollStyle,
                    children:
                      list.length === 0
                        ? jsx('div', {
                            style: { padding: '12px 0', textAlign: 'center', fontSize: '13px', opacity: 0.6 },
                            children: t('manage.empty')
                          })
                        : filtered.length === 0
                          ? jsx('div', {
                              style: { padding: '12px 0', textAlign: 'center', fontSize: '13px', opacity: 0.6 },
                              children: t('manage.noMatch')
                            })
                          : filtered.map((sn, i) =>
                              jsx(SnippetRow, {
                                snippet: sn,
                                list: filtered,
                                index: i,
                                dispatch,
                                t,
                                selected: sn.id === selectedId,
                                canDrag: dragEnabled
                              }, sn.id)
                            )
                  }, 'list'),
                  jsxs('div', {
                    style: toolbarRowStyle,
                    children: [
                      jsx(Button, {
                        variant: 'outline',
                        size: 'sm',
                        onClick: () => {
                          setEditing({ id: null, label: '', description: '', text: '', tags: '' })
                          setView('edit')
                          setSelectedId(null)
                        },
                        children: t('manage.add')
                      }, 'add'),
                      jsx(Button, {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: () => {
                          setImportText('')
                          setView('import')
                        },
                        children: t('manage.import')
                      }, 'import'),
                      jsx(Button, {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: exportAll,
                        children: t('manage.export')
                      }, 'export')
                    ]
                  })
                ]
              }, 'left'),
              // ── Right pane: preview / edit / import ──
              view === 'edit'
                ? jsxs('div', {
                    style: paneRightStyle,
                    children: [
                      jsx(DialogTitle, { children: editing.id ? t('manage.editTitle') : t('manage.addTitle') }, 'h'),
                      jsx(DialogDescription, { children: t('manage.formDesc') }, 'd'),
                      jsx('div', {
                        style: rightScrollStyle,
                        children: jsx(SnippetForm, { draft: editing, onDraft: setEditing, t })
                      }, 'form'),
                      jsxs('div', {
                        style: { ...toolbarRowStyle, justifyContent: 'flex-end' },
                        children: [
                          jsx(Button, {
                            variant: 'outline',
                            size: 'sm',
                            onClick: () => {
                              setEditing(null)
                              setView('preview')
                            },
                            children: t('manage.cancel')
                          }, 'cancel'),
                          jsx(Button, { size: 'sm', onClick: saveDraft, disabled: !draftValid, children: t('manage.save') }, 'save')
                        ]
                      })
                    ]
                  }, 'edit')
                : view === 'import'
                  ? jsxs('div', {
                      style: paneRightStyle,
                      children: [
                        jsx(DialogDescription, { children: t('manage.importTitle') }, 'h'),
                        jsx(Textarea, {
                          value: importText,
                          onChange: e => setImportText(e.target.value),
                          placeholder: t('manage.importPh'),
                          style: { ...preCardStyle, resize: 'none', fontFamily: 'inherit', color: 'var(--foreground)' }
                        }, 'box'),
                        jsxs('div', {
                          style: { ...toolbarRowStyle, justifyContent: 'flex-end' },
                          children: [
                            jsx(Button, {
                              variant: 'outline',
                              size: 'sm',
                              onClick: () => setView('preview'),
                              children: t('manage.cancel')
                            }, 'cancel'),
                            jsx(Button, {
                              size: 'sm',
                              disabled: importText.trim() === '',
                              onClick: () => importFrom(importText),
                              children: t('manage.importMerge')
                            }, 'merge')
                          ]
                        })
                      ]
                    }, 'import')
                  : selected
                    ? jsxs('div', {
                        style: paneRightStyle,
                        children: [
                          // DetailHeader (primitives.tsx): title 0.9375rem
                          // semibold + PanelPill tags + caption description.
                          jsxs('header', {
                            style: { minWidth: 0, flexShrink: 0 },
                            children: [
                              jsxs('div', {
                                style: detailTitleLineStyle,
                                children: [
                                  jsx('h3', {
                                    style: selected.enabled === false
                                      ? { ...detailTitleStyle, fontWeight: 400, color: 'color-mix(in srgb, var(--ui-text-tertiary) 60%, transparent)' }
                                      : detailTitleStyle,
                                    children: selected.label
                                  }, 'h'),
                                  (selected.tags || []).map(tag =>
                                    jsx('span', { style: pillStyle, children: tag }, tag)
                                  )
                                ]
                              }),
                              selected.description
                                ? jsx('p', { style: detailDescStyle, children: selected.description }, 'p')
                                : null
                            ]
                          }, 'head'),
                          // Meta card — the exact skill-detail frontmatter grid
                          // (name / description / tags rows).
                          jsx('div', {
                            style: metaCardStyle,
                            children: [
                              jsxs('div', {
                                style: metaRowStyle,
                                children: [
                                  jsx('span', { style: metaKeyStyle, children: t('manage.metaName') }, 'k'),
                                  jsx('span', { style: metaValStyle, children: selected.label }, 'v')
                                ]
                              }, 'name'),
                              selected.description
                                ? jsxs('div', {
                                    style: metaRowStyle,
                                    children: [
                                      jsx('span', { style: metaKeyStyle, children: t('manage.metaDesc') }, 'k'),
                                      jsx('span', { style: metaValStyle, children: selected.description }, 'v')
                                    ]
                                  }, 'desc')
                                : null,
                              (selected.tags || []).length > 0
                                ? jsxs('div', {
                                    style: metaRowStyle,
                                    children: [
                                      jsx('span', { style: metaKeyStyle, children: t('manage.metaTags') }, 'k'),
                                      jsx('span', { style: metaValStyle, children: (selected.tags || []).join(', ') }, 'v')
                                    ]
                                  }, 'tags')
                                : null,
                              selected.enabled === false
                                ? jsxs('div', {
                                    style: metaRowStyle,
                                    children: [
                                      jsx('span', { style: metaKeyStyle, children: t('manage.metaStatus') }, 'k'),
                                      jsx('span', {
                                        style: { ...metaValStyle, display: 'inline-flex', alignItems: 'center', gap: '6px' },
                                        children: [
                                          jsx(Codicon, { name: 'circle-slash', size: '0.8rem', style: { color: 'var(--ui-text-tertiary)' } }, 'i'),
                                          jsx('span', { children: t('manage.off') }, 'txt')
                                        ]
                                      }, 'v')
                                    ]
                                  }, 'status')
                                : null
                            ]
                          }, 'meta'),
                          // Content = official <pre> card (same skin + mono).
                          jsx('div', { style: preCardStyle, children: selected.text }, 'pre'),
                          // actionBar (DetailColumn footer pattern): pinned row
                          // under the scroll — primary insert + text buttons.
                          jsxs('div', {
                            style: { ...toolbarRowStyle, flexShrink: 0 },
                            children: [
                              // Enable/disable: binary toggle as segmented-
                              // equivalent Switch (hub panel discipline),
                              // pinned left with its state word — retired
                              // snippets vanish from the quick-pick overlay
                              // but stay in the library.
                              jsxs('label', {
                                style: { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flexShrink: 0 },
                                title: t('manage.toggleLabel'),
                                children: [
                                  jsx(Switch, {
                                    size: 'xs',
                                    checked: selected.enabled !== false,
                                    onCheckedChange: () => dispatch({ type: 'toggle', id: selected.id })
                                  }, 'sw'),
                                  jsx('span', {
                                    style: { fontSize: '0.68rem', color: 'var(--ui-text-tertiary)' },
                                    children: selected.enabled === false ? t('manage.off') : t('manage.on')
                                  }, 'txt')
                                ]
                              }, 'enable'),
                              jsx(Button, {
                                variant: 'outline',
                                size: 'sm',
                                onClick: () => void insertSnippet(selected),
                                children: t('manage.insert')
                              }, 'insert'),
                              jsx(Button, {
                                variant: 'text',
                                size: 'sm',
                                onClick: () => openEdit(selected),
                                children: t('manage.edit')
                              }, 'edit'),
                              jsx(Button, {
                                variant: 'text',
                                size: 'sm',
                                style:
                                  pendingDel === selected.id
                                    ? { color: 'var(--destructive)', marginLeft: 'auto' }
                                    : { color: 'var(--ui-text-tertiary)', marginLeft: 'auto' },
                                onClick: () =>
                                  dispatch({ type: pendingDel === selected.id ? 'delete' : 'arm-delete', id: selected.id }),
                                children: pendingDel === selected.id ? t('manage.confirmDel') : t('manage.del')
                              }, 'del')
                            ]
                          }, 'bar')
                        ]
                      }, 'detail')
                    : jsx('div', { style: placeholderBoxStyle, children: t('manage.placeholder') }, 'empty')
            ]
          })
        ]
      })
      })
    }) : null
  })
}

export default {
  id: 'prompt-snippets',
  name: 'Prompt Snippets',
  description: 'Prompt snippet library: quick-pick overlay above the composer (own shortcut) + management view with drag reordering, tags, and import/export.',
  register(ctx) {
    store = ctx.storage
    ensureFocusTracker()

    // Plugin i18n: register locale bundles (follows the app language); removed
    // with the disposer on unload. ti18n = non-reactive translator for
    // register-time strings (menu rows / palette / keybind labels evaluate
    // once here).
    const disposeI18n = ctx.i18n.register(LOCALES)
    const ti18n = ctx.i18n.t
    ti18nStatic = ti18n

    // Register-time-string contributions as a factory: called fresh on every
    // (re)registration so labels re-evaluate against the CURRENT locale.
    // Mirrors hub's statusbarData() pattern.
    const registerStaticContributions = () => {
      // Refresh the keybind backup on every pass — the official store can
      // change (user rebinds) or get wiped (startup writes before our
      // registration) between calls.
      syncKeybindBackup()
      // The "+" menu row — data contribution through the stable attachments seam.
      ctx.register({
        id: 'my-snippets-menu-row',
        area: COMPOSER_AREAS.attachments,
        data: {
          label: ti18n('menu.label'),
          icon: 'wand',
          run: insertCtx => {
            insertCtxRef = insertCtx
            openSid = sdkSessionId()
            openSurface = captureSurface() || firstVisibleSurface()
            $mode.set('manage')
            $managerOpen.set(true)
          }
        }
      })

      // ⌘K palette row — quick open without the + menu hop.
      ctx.register({
        id: 'open-my-snippets',
        area: PALETTE_AREA,
        data: {
          id: 'prompt-snippets.openManager',
          label: ti18n('menu.label'),
          keywords: ['snippet', '片段', '提示词', 'prompt'],
          run: () => {
            openSid = sdkSessionId()
            openSurface = captureSurface() || firstVisibleSurface()
            $mode.set('manage')
            $managerOpen.set(true)
          }
        }
      })

      // Global keybind (Settings → 键盘快捷键 can rebind it). Default unbound —
      // binding is one panel click, and a default combo risks colliding with
      // core composer keys. The palette row surfaces the live combo as its hint.
      // Opens the Cmd-K-style quick picker: filter + ↑↓ + ↵ insert.
      // defaults: served from the plugin-storage backup (see syncKeybindBackup)
      // so bindingsFor still resolves the user's combo even after the official
      // keybind store wipes contributed overrides on startup.
      ctx.register({
        id: 'my-snippets-keybind',
        area: KEYBINDS_AREA,
        data: {
          id: 'prompt-snippets.openManager',
          category: 'composer',
          defaults: [...(keybindBackup || [])],
          label: ti18n('menu.label'),
          run: () => {
            // Native quick layer, built directly into the focused surface's
            // composer-root (no React state hop — a React-owned node moved
            // there lost keyboard handling and crashed unmount).
            openSid = sdkSessionId()
            const surface = captureSurface() || firstVisibleSurface()
            openSurface = surface
            if (surface && surfaceComposerEl(surface)) {
              const ti = ti18nStatic
              openQuickLayer({
                composerEl: surfaceComposerEl(surface),
                surface,
                filterPh: ti('quick.filterPh'),
                emptyLabel: ti('quick.empty'),
                insertFailedLabel: ti('notify.insertFailed')
              })
            } else {
              $mode.set('quick')
              $managerOpen.set(true)
            }
          }
        }
      })
    }
    registerStaticContributions()

    // Dialog host — top strip is INSIDE ComposerPrimitive.Root (same anchor as
    // the official `/` drawer): the inline picker's absolute bottom-full then
    // floats right above the composer without shifting it. underside (below
    // the composer) anchored the layer against the whole dock instead, which
    // pushed the composer up — that was the "input moves" bug.
    ctx.register({
      id: 'snippets-manager-host',
      area: COMPOSER_AREAS.top,
      render: () => jsx(ManagerDialog, {})
    })

    // Locale live-switch: register-time strings (menu row / palette / keybind
    // labels) evaluate ONCE, so a language change would leave them stale.
    // Official I18nProvider writes document.documentElement.lang on every
    // setLocale — watch it and re-register via the factory (registry replaces
    // same-id entries atomically). Also fires on the cold-start window when
    // the configured locale lands after plugin registration.
    let lastLang = document.documentElement.lang
    const langObserver = new MutationObserver(() => {
      const lang = document.documentElement.lang
      if (!lang || lang === lastLang) return
      lastLang = lang
      registerStaticContributions()
    })
    langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })

    if (typeof ctx.onDispose === 'function') {
      ctx.onDispose(() => {
        langObserver.disconnect()
        store = null
        insertCtxRef = null
        if (typeof disposeI18n === 'function') disposeI18n()
        openSurface = null
        openSid = null
        if (quickLayerClose) quickLayerClose({ refocus: false }) // native quick layer teardown
        $managerOpen.set(false)
        $mode.set('manage')
        if (typeof window !== 'undefined') {
          window.removeEventListener('focusin', onFocusIn, true)
          window.removeEventListener('pointerdown', onPointerDown, true)
          focusTrackerInstalled = false
        }
      })
    }
  }
}



