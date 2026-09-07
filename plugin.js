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
import { COMPOSER_AREAS, KEYBINDS_AREA, PALETTE_AREA, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Textarea, atom, host, usePluginI18n, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'snippets-v1'
const DIALOG_MAX_W = 'max-w-md'
const ID = 'prompt-snippets'

// ── i18n locale bundles（跟随 app 语言；解析链 当前 locale → en → 键名）──────
const LOCALES = {
  en: {
    menu: { label: 'My Snippets' },
    manage: {
      title: 'My Snippets',
      desc: 'Click a snippet to insert it. Drag the ⠿ handle on the right to reorder; buttons on the right: edit / delete.',
      add: 'Add', done: 'Done', empty: 'No snippets yet — click "Add" below to create one',
      editTitle: 'Edit Snippet', addTitle: 'New Snippet',
      formDesc: 'Label and content are required.',
      fieldLabel: 'Label *', fieldLabelPh: 'e.g. Code review',
      fieldDesc: 'Description (optional)', fieldDescPh: 'One line about what it is for',
      fieldText: 'Content *', fieldTextPh: 'The full prompt inserted into the composer…',
      cancel: 'Cancel', save: 'Save'
    },
    quick: {
      filterPh: 'Type to filter, ↑↓ to move, ↵ to insert, Esc to close',
      empty: 'No matching snippets'
    },
    row: { edit: 'Edit', del: 'Delete', dragHint: 'Drag to reorder' },
    notify: { insertFailed: 'Insert failed: composer unavailable', corrupted: 'Snippet data corrupted — reset to empty' }
  },
  zh: {
    menu: { label: '我的片段' },
    manage: {
      title: '我的片段',
      desc: '点选片段插入输入框；拖动右侧 ⠿ 排序，右侧按钮是编辑 / 删除。',
      add: '新增', done: '完成', empty: '还没有片段，点下方「新增」加一条',
      editTitle: '编辑片段', addTitle: '新增片段',
      formDesc: '名称和内容必填。',
      fieldLabel: '名称 *', fieldLabelPh: '如：代码审查',
      fieldDesc: '描述（可选）', fieldDescPh: '一句话说明用途',
      fieldText: '内容 *', fieldTextPh: '点选后插入输入框的完整提示词…',
      cancel: '取消', save: '保存'
    },
    quick: {
      filterPh: '输入过滤，↑↓ 选择，↵ 插入，Esc 关闭',
      empty: '没有匹配的片段'
    },
    row: { edit: '编辑', del: '删除', dragHint: '拖动排序' },
    notify: { insertFailed: '插入失败：输入框不可用', corrupted: '片段数据损坏，已重置为空' }
  },
  'zh-hant': {
    menu: { label: '我的片段' },
    manage: {
      title: '我的片段',
      desc: '點選片段插入輸入框；拖動右側 ⠿ 排序，右側按鈕是編輯 / 刪除。',
      add: '新增', done: '完成', empty: '還沒有片段，點下方「新增」加一條',
      editTitle: '編輯片段', addTitle: '新增片段',
      formDesc: '名稱和內容必填。',
      fieldLabel: '名稱 *', fieldLabelPh: '如：代碼審查',
      fieldDesc: '描述（可選）', fieldDescPh: '一句話說明用途',
      fieldText: '內容 *', fieldTextPh: '點選後插入輸入框的完整提示詞…',
      cancel: '取消', save: '儲存'
    },
    quick: {
      filterPh: '輸入過濾，↑↓ 選擇，↵ 插入，Esc 關閉',
      empty: '沒有符合的片段'
    },
    row: { edit: '編輯', del: '刪除', dragHint: '拖曳排序' },
    notify: { insertFailed: '插入失敗：輸入框不可用', corrupted: '片段資料損壞，已重設為空' }
  }
}

// MessageSquareText lead icon — the official snippet dialog's row icon.
// Exact tabler IconMessage2 paths (lib/icons.ts:75 maps MessageSquareText to
// @tabler/icons-react IconMessage2), inlined as raw SVG so the plugin doesn't
// need the icons import surface.
const MESSAGE_SQUARE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9h8"/><path d="M8 13h6"/><path d="M9 18h-3a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-3l-3 3l-3 -3"/></svg>'

// ── Data layer (pure functions, return new arrays, never mutate) ──────────

export function addSnippet(list, { label, description, text }) {
  const id = `s-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  return [...list, { id, label, description, text }]
}

export function updateSnippet(list, id, patch) {
  return list.map(s => (s.id === id ? { ...s, ...patch } : s))
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

const $managerOpen = atom(false)
// 'manage' = CRUD list (from the "+" menu / ⌘K), 'quick' = Cmd-K-style picker
// (from the keybind). One dialog, two entry-intent views.
const $mode = atom('manage')
let store = null
let insertCtxRef = null
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
// restart/update. Defense: mirror the combo into plugin storage, restore it
// into BOTH the official store (localStorage) and the contributed
// contribution's defaults on every register. bindingsFor falls back to
// defaults, so dispatch + the settings panel both resolve.
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

// Backup: official store still has the user's combo → mirror it. Restore: the
// official store lost it but we hold a backup → write it back so the next
// full reload of the app's store picks it up.
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
    try {
      const map = readOfficialKeybindMap() || {}
      map[KEYBIND_ACTION_ID] = backup
      localStorage.setItem(KEYBIND_OFFICIAL_KEY, JSON.stringify(map))
    } catch {}
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
  return raw.filter(s => s && typeof s.label === 'string' && typeof s.text === 'string')
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
const rowStyle = {
  display: 'flex',
  width: '100%',
  cursor: 'pointer',
  alignItems: 'flex-start',
  gap: '10px', // gap-2.5
  borderRadius: '6px', // rounded-md
  border: '1px solid transparent',
  padding: '8px 10px', // px-2.5 py-2
  textAlign: 'left',
  transition: 'color 150ms, background-color 150ms, border-color 150ms',
  background: 'transparent',
  font: 'inherit',
  color: 'inherit'
}

const rowHoverStyle = {
  borderColor: 'var(--ui-stroke-tertiary)',
  background: 'var(--ui-control-hover-background)'
}

const leadIconStyle = {
  marginTop: '2px', // mt-0.5
  width: '14px', // size-3.5
  height: '14px',
  flexShrink: 0,
  color: 'var(--ui-text-tertiary)'
}

const rowBodyStyle = {
  display: 'grid',
  minWidth: 0,
  gap: '2px', // gap-0.5
  flex: 1
}

const rowLabelStyle = {
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--foreground)'
}

const rowDescStyle = {
  fontSize: 'var(--conversation-caption-font-size)',
  color: 'var(--ui-text-tertiary)'
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

const actionBtnStyle = {
  height: '24px',
  width: '24px',
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '13px',
  lineHeight: 1,
  flexShrink: 0
}

// Longer actions row: fades in on row hover so the resting card reads exactly
// like the official snippet rows (icon + label + description, no chrome).
const actionsWrapStyle = {
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  opacity: 0.45,
  transition: 'opacity 120ms'
}

const actionsWrapHoverStyle = { opacity: 1 }

const dragHandleStyle = {
  cursor: 'grab',
  color: 'var(--ui-text-tertiary)',
  fontSize: '14px',
  lineHeight: 1,
  padding: '2px 4px',
  flexShrink: 0,
  userSelect: 'none'
}

function SnippetRow({ snippet, list, dispatch, t }) {
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
  const myIdx = list.findIndex(s => s.id === snippet.id)
  let shift = 0
  if (fromIdx >= 0 && overIdx >= 0 && myIdx >= 0 && !isDragging) {
    if (fromIdx < overIdx && myIdx > fromIdx && myIdx <= overIdx) shift = -1
    else if (fromIdx > overIdx && myIdx >= overIdx && myIdx < fromIdx) shift = 1
  }
  return jsxs('div', {
    ref: rowRef,
    style: {
      ...rowStyle,
      ...(hover ? rowHoverStyle : null),
      ...(isDragging && pointerDragging
        ? { opacity: 0.85, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 10, position: 'relative' }
        : null),
      transform: shift && !pointerDragging ? `translateY(${shift * 100}%)` : undefined,
      transition: 'transform 150ms ease'
    },
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    children: [
      jsx('span', { style: leadIconStyle, 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: MESSAGE_SQUARE_SVG } }),
      jsx(
        'button',
        {
          type: 'button',
          onClick: () => dispatch({ type: 'insert', id: snippet.id }),
          style: labelBtnStyle,
          children: jsxs('span', {
            style: rowBodyStyle,
            children: [
              jsx('span', { style: rowLabelStyle, children: snippet.label }),
              snippet.description
                ? jsx('span', { style: rowDescStyle, children: snippet.description })
                : null
            ]
          })
        }
      ),
      jsx('span', {
        style: { ...actionsWrapStyle, ...(hover ? actionsWrapHoverStyle : null) },
        children: [
          jsx(Button, { variant: 'ghost', size: 'sm', style: actionBtnStyle, title: t('row.edit'), onClick: () => dispatch({ type: 'edit', id: snippet.id }), children: '✎' }),
          jsx(Button, { variant: 'ghost', size: 'sm', style: actionBtnStyle, title: t('row.del'), onClick: () => dispatch({ type: 'delete', id: snippet.id }), children: '✕' })
        ]
      }),
      jsx('span', {
        style: dragHandleStyle,
        title: t('row.dragHint'),
        onPointerDown: e => {
          // Pointer-capture drag (dnd-kit's underlying mechanism): the whole
          // row visually follows the pointer via transform; rows between
          // origin and pointer slide via the same preview transform; commit
          // on release. No HTML5 drag — no ghost, no flicker.
          e.preventDefault()
          const row = rowRef.current
          if (!row) return
          const rowH = row.getBoundingClientRect().height
          const startY = e.clientY
          row.setPointerCapture(e.pointerId)
          setPointerDragging(true)
          $dragFromId.set(snippet.id)
          $dragOverId.set(snippet.id)

          let lastOver = snippet.id
          function onMove(ev) {
            const dy = ev.clientY - startY
            row.style.transform = `translateY(${dy}px)`
            row.style.zIndex = '10'
            const steps = Math.round(dy / rowH)
            const idx = list.findIndex(s => s.id === snippet.id)
            const target = list[idx + steps]
            if (target && target.id !== lastOver) {
              lastOver = target.id
              $dragOverId.set(target.id)
            }
          }
          function onUp(ev) {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            row.releasePointerCapture(e.pointerId)
            // Smooth landing: commit the reorder first (DOM reflows to the new
            // order while the dragged row still carries its drag offset), then
            // transition the inline transform back to identity so the row
            // glides into its new slot instead of snapping.
            const from = $dragFromId.get()
            const over = $dragOverId.get()
            if (from && over && from !== over) {
              dispatch({ type: 'reorder', fromId: from, toId: over })
            }
            // Clear drag atoms immediately: after the reorder, every row is
            // already at its final document position (shift collapses to 0),
            // so clearing here causes no visual jump.
            $dragFromId.set(null)
            $dragOverId.set(null)
            row.style.transition = 'transform 180ms ease'
            requestAnimationFrame(() => {
              row.style.transform = ''
              setTimeout(() => {
                row.style.transition = ''
                row.style.zIndex = ''
                setPointerDragging(false)
              }, 200)
            })
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
        },
        children: '⠿'
      })
    ]
  })
}

function SnippetForm({ draft, onDraft, t }) {
  return jsxs('div', {
    style: { display: 'grid', gap: '10px', paddingTop: '4px' },
    children: [
      jsx('div', {
        style: { display: 'grid', gap: '4px' },
        children: [
          jsx('div', { style: { fontSize: '12px', opacity: 0.7 }, children: t('manage.fieldLabel') }),
          jsx(Input, {
            value: draft.label,
            onChange: e => onDraft({ ...draft, label: e.target.value }),
            placeholder: t('manage.fieldLabelPh')
          })
        ]
      }),
      jsx('div', {
        style: { display: 'grid', gap: '4px' },
        children: [
          jsx('div', { style: { fontSize: '12px', opacity: 0.7 }, children: t('manage.fieldDesc') }),
          jsx(Input, {
            value: draft.description,
            onChange: e => onDraft({ ...draft, description: e.target.value }),
            placeholder: t('manage.fieldDescPh')
          })
        ]
      }),
      jsx('div', {
        style: { display: 'grid', gap: '4px' },
        children: [
          jsx('div', { style: { fontSize: '12px', opacity: 0.7 }, children: t('manage.fieldText') }),
          jsx(Textarea, {
            value: draft.text,
            rows: 6,
            onChange: e => onDraft({ ...draft, text: e.target.value }),
            placeholder: t('manage.fieldTextPh')
          })
        ]
      })
    ]
  })
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
  overscrollBehavior: 'contain',
  padding: '4px', // p-1
  // composerPanelCard skin, verbatim:
  borderRadius: 'var(--radius-2xl)', // rounded-2xl (theme-variable driven)
  border: '1px solid color-mix(in srgb, var(--border) 65%, transparent)', // border-border/65
  boxShadow: 'var(--shadow-nous)',
  background: 'color-mix(in srgb, var(--dt-card) 72%, transparent)',
  backdropFilter: 'blur(0.75rem) saturate(1.12)',
  WebkitBackdropFilter: 'blur(0.75rem) saturate(1.12)',
  transition: 'background-color 150ms ease-out',
  fontSize: 'var(--conversation-tool-font-size)',
  color: 'var(--popover-foreground)'
}

const quickListStyle = {
  display: 'grid',
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
  borderRadius: '6px',
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
  borderBottom: '1px solid color-mix(in srgb, var(--border) 65%, transparent)'
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
const quickNameStyle = {
  minWidth: 0,
  flexShrink: 0,
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
  const host = document.querySelector(`[data-composer-target="${surface}"]`)
  return host ? host.closest('[data-slot="composer-root"]') : null
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

// Standalone insert (no React scope): bus first, then the captured "+"-menu
// ctx, then a direct splice into THIS surface's editor.
function insertTextIntoSurface(surface, text) {
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
  const snippets = loadSnippets()
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
    const node = listEl.children[active]
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' })
  }

  function close({ refocus = true } = {}) {
    quickLayerClose = null
    document.removeEventListener('keydown', onDocKey, true)
    document.removeEventListener('pointerdown', onDocPointer, true)
    shell.remove()
    // The filter input stole focus from the composer; hand it back so the
    // user keeps typing where the insert is about to land.
    if (refocus) {
      const ed = surfaceEditorEl(surface)
      if (ed) ed.focus()
    }
  }

  function pick(sn) {
    close({ refocus: false })
    if (!insertTextIntoSurface(surface, sn.text)) {
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
    setList(loadSnippets())
    setEditing(null)
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

  function insertIntoComposer(text) {
    // Insert into THIS instance's own surface — the dialog physically lives
    // in that session's composer dock, same as the official snippet dialog.
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

  function dispatch(action) {
    if (action.type === 'insert') {
      const sn = list.find(s => s.id === action.id)
      if (sn && insertIntoComposer(sn.text)) {
        return
      }
      host.notify({ kind: 'error', message: t('notify.insertFailed') })
      return
    }
    if (action.type === 'edit') {
      const sn = list.find(s => s.id === action.id)
      if (!sn) return
      setEditing({ id: sn.id, label: sn.label, description: sn.description || '', text: sn.text })
      return
    }
    if (action.type === 'delete') {
      commit(removeSnippet(list, action.id))
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
      text: editing.text
    }
    if (editing.id) {
      commit(updateSnippet(list, editing.id, clean))
    } else {
      commit(addSnippet(list, clean))
    }
    setEditing(null)
  }

  const draftValid = editing && editing.label.trim() !== '' && editing.text.trim() !== ''

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
      children:
        editing === null
          ? jsxs('div', {
              children: [
                jsxs(DialogHeader, {
                  children: [
                    jsx(DialogTitle, { children: t('manage.title') }),
                    jsx(DialogDescription, { children: t('manage.desc') })
                  ]
                }),
                jsx('div', {
                  style: { display: 'grid', gap: '4px', marginTop: '2px' },
                  children:
                    list.length === 0
                      ? jsx('div', {
                          style: { padding: '12px 0', textAlign: 'center', fontSize: '13px', opacity: 0.6 },
                          children: t('manage.empty')
                        })
                      : list.map(sn => jsx(SnippetRow, { snippet: sn, list, dispatch, t }, sn.id))
                }),
                jsxs(DialogFooter, {
                  style: { marginTop: '8px' },
                  children: [
                    jsx(Button, {
                      variant: 'outline',
                      size: 'sm',
                      onClick: () => setEditing({ id: null, label: '', description: '', text: '' }),
                      children: t('manage.add')
                    }),
                    jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => $managerOpen.set(false), children: t('manage.done') })
                  ]
                })
              ]
            })
          : jsxs('div', {
              children: [
                jsxs(DialogHeader, {
                  children: [
                    jsx(DialogTitle, { children: editing.id ? t('manage.editTitle') : t('manage.addTitle') }),
                    jsx(DialogDescription, { children: t('manage.formDesc') })
                  ]
                }),
                jsx(SnippetForm, { draft: editing, onDraft: setEditing, t }),
                jsxs(DialogFooter, {
                  children: [
                    jsx(Button, { variant: 'outline', size: 'sm', onClick: () => setEditing(null), children: t('manage.cancel') }),
                    jsx(Button, { size: 'sm', onClick: saveDraft, disabled: !draftValid, children: t('manage.save') })
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



