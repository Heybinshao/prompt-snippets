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
import { COMPOSER_AREAS, KEYBINDS_AREA, PALETTE_AREA, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Textarea, atom, host, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useRef, useState } from 'react'

const STORAGE_KEY = 'snippets-v1'
const DIALOG_MAX_W = 'max-w-md'

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

function loadSnippets() {
  if (!store) return []
  const raw = store.get(STORAGE_KEY, [])
  if (!Array.isArray(raw)) {
    host.notify({ kind: 'error', message: '片段数据损坏，已重置为空' })
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

function SnippetRow({ snippet, idx, total, dispatch }) {
  const [hover, setHover] = useState(false)
  return jsxs('div', {
    style: { ...rowStyle, ...(hover ? rowHoverStyle : null) },
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
          jsx(Button, { variant: 'ghost', size: 'sm', style: actionBtnStyle, title: '编辑', onClick: () => dispatch({ type: 'edit', id: snippet.id }), children: '✎' }),
          jsx(Button, { variant: 'ghost', size: 'sm', style: actionBtnStyle, title: '上移', onClick: () => dispatch({ type: 'move', id: snippet.id, dir: -1 }), disabled: idx === 0, children: '↑' }),
          jsx(Button, { variant: 'ghost', size: 'sm', style: actionBtnStyle, title: '下移', onClick: () => dispatch({ type: 'move', id: snippet.id, dir: 1 }), disabled: idx === total - 1, children: '↓' }),
          jsx(Button, { variant: 'ghost', size: 'sm', style: actionBtnStyle, title: '删除', onClick: () => dispatch({ type: 'delete', id: snippet.id }), children: '✕' })
        ]
      })
    ]
  })
}

function SnippetForm({ draft, onDraft }) {
  return jsxs('div', {
    style: { display: 'grid', gap: '10px', paddingTop: '4px' },
    children: [
      jsx('div', {
        style: { display: 'grid', gap: '4px' },
        children: [
          jsx('div', { style: { fontSize: '12px', opacity: 0.7 }, children: '名称 *' }),
          jsx(Input, {
            value: draft.label,
            onChange: e => onDraft({ ...draft, label: e.target.value }),
            placeholder: '如：代码审查'
          })
        ]
      }),
      jsx('div', {
        style: { display: 'grid', gap: '4px' },
        children: [
          jsx('div', { style: { fontSize: '12px', opacity: 0.7 }, children: '描述（可选）' }),
          jsx(Input, {
            value: draft.description,
            onChange: e => onDraft({ ...draft, description: e.target.value }),
            placeholder: '一句话说明用途'
          })
        ]
      }),
      jsx('div', {
        style: { display: 'grid', gap: '4px' },
        children: [
          jsx('div', { style: { fontSize: '12px', opacity: 0.7 }, children: '内容 *' }),
          jsx(Textarea, {
            value: draft.text,
            rows: 6,
            onChange: e => onDraft({ ...draft, text: e.target.value }),
            placeholder: '点选后插入输入框的完整提示词…'
          })
        ]
      })
    ]
  })
}

// ── Quick picker (Cmd-K style: filter + ↑↓ + ↵) ───────────────────────────

const QUICK_MAX_W = 'max-w-lg'

const quickListStyle = {
  display: 'grid',
  gap: '2px',
  maxHeight: '300px',
  overflowY: 'auto',
  marginTop: '6px'
}

const quickRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '7px 10px',
  borderRadius: '6px',
  border: '1px solid transparent',
  cursor: 'pointer',
  background: 'transparent',
  width: '100%',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit'
}

const quickRowActiveStyle = {
  background: 'var(--ui-control-hover-background)',
  borderColor: 'var(--ui-stroke-tertiary)'
}

const quickInputRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  borderBottom: '1px solid var(--border, rgba(127, 127, 127, 0.25))',
  paddingBottom: '8px'
}

function filterSnippets(list, query) {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    s => s.label.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)
  )
}

function QuickPicker({ snippets, onPick }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const filtered = filterSnippets(snippets, query)

  // Clamp active row when the filtered list shrinks.
  if (active >= filtered.length && filtered.length > 0) {
    setActive(0)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const sn = filtered[active]
      if (sn) onPick(sn)
    }
  }

  return jsxs('div', {
    onKeyDown,
    children: [
      jsxs('div', {
        style: quickInputRowStyle,
        children: [
          jsx('span', { style: leadIconStyle, 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: MESSAGE_SQUARE_SVG } }),
          jsx(Input, {
            value: query,
            onChange: e => {
              setQuery(e.target.value)
              setActive(0)
            },
            placeholder: filtered.length === 0 ? '没有匹配的片段' : '输入过滤，↑↓ 选择，↵ 插入，Esc 关闭',
            style: { boxShadow: 'none', border: 'none', padding: '0', background: 'transparent' },
            autoFocus: true
          })
        ]
      }),
      jsx('div', {
        style: quickListStyle,
        children:
          filtered.length === 0
            ? jsx('div', {
                style: { padding: '14px 0', textAlign: 'center', fontSize: '13px', opacity: 0.55 },
                children: '没有匹配的片段'
              })
            : filtered.map((sn, i) =>
                jsx(
                  'button',
                  {
                    type: 'button',
                    key: sn.id,
                    onClick: () => onPick(sn),
                    onMouseEnter: () => setActive(i),
                    style: { ...quickRowStyle, ...(i === active ? quickRowActiveStyle : null) },
                    children: jsxs('span', {
                      style: rowBodyStyle,
                      children: [
                        jsx('span', { style: rowLabelStyle, children: sn.label }),
                        sn.description
                          ? jsx('span', { style: rowDescStyle, children: sn.description })
                          : null
                      ]
                    })
                  },
                )
              )
      })
    ]
  })
}

function ManagerDialog() {
  const open = useValue($managerOpen)
  const mode = useValue($mode)
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

  // Quick mode with zero snippets: nothing to pick — fall through to the
  // manager view so the user can create their first one. ONLY after the open
  // reload has landed (loadedRef): on the very first render after opening,
  // the local `list` is still the stale pre-open value ([]) while setList
  // above has already queued the real data — converting here would flip
  // mode to 'manage' and the FIRST keybind invocation would show the manager
  // instead of the picker (second invocation worked because the previous
  // open had populated `list`).
  const loadedRef = useRef(false)
  if (open && !loadedRef.current && wasOpen) {
    loadedRef.current = true
  }
  if (!open) {
    loadedRef.current = false
  }
  if (open && mode === 'quick' && loadedRef.current && list.length === 0) {
    $mode.set('manage')
  }

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
      host.notify({ kind: 'error', message: '插入失败：输入框不可用' })
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
  return jsx('div', {
    ref: setHostEl,
    style: { display: 'contents' },
    children: shouldShow
      ? jsx(Dialog, {
    open: true,
    onOpenChange: o => {
      if (!o) $managerOpen.set(false)
    },
    children: jsx(DialogContent, {
      className: mode === 'quick' ? QUICK_MAX_W : DIALOG_MAX_W,
      children:
        mode === 'quick'
          ? jsx(QuickPicker, {
              snippets: list,
              onPick: sn => {
                if (!insertIntoComposer(sn.text)) {
                  host.notify({ kind: 'error', message: '插入失败：输入框不可用' })
                }
              }
            })
        : editing === null
          ? jsxs('div', {
              children: [
                jsxs(DialogHeader, {
                  children: [
                    jsx(DialogTitle, { children: '我的片段' }),
                    jsx(DialogDescription, { children: '点选片段插入输入框；右侧按钮依次是编辑 / 上移 / 下移 / 删除。' })
                  ]
                }),
                jsx('div', {
                  style: { display: 'grid', gap: '4px', marginTop: '2px' },
                  children:
                    list.length === 0
                      ? jsx('div', {
                          style: { padding: '12px 0', textAlign: 'center', fontSize: '13px', opacity: 0.6 },
                          children: '还没有片段，点下方「新增」加一条'
                        })
                      : list.map((sn, i) => jsx(SnippetRow, { snippet: sn, idx: i, total: list.length, dispatch }, sn.id))
                }),
                jsxs(DialogFooter, {
                  style: { marginTop: '8px' },
                  children: [
                    jsx(Button, {
                      variant: 'outline',
                      size: 'sm',
                      onClick: () => setEditing({ id: null, label: '', description: '', text: '' }),
                      children: '新增'
                    }),
                    jsx(Button, { variant: 'ghost', size: 'sm', onClick: () => $managerOpen.set(false), children: '完成' })
                  ]
                })
              ]
            })
          : jsxs('div', {
              children: [
                jsxs(DialogHeader, {
                  children: [
                    jsx(DialogTitle, { children: editing.id ? '编辑片段' : '新增片段' }),
                    jsx(DialogDescription, { children: '名称和内容必填。' })
                  ]
                }),
                jsx(SnippetForm, { draft: editing, onDraft: setEditing }),
                jsxs(DialogFooter, {
                  children: [
                    jsx(Button, { variant: 'outline', size: 'sm', onClick: () => setEditing(null), children: '取消' }),
                    jsx(Button, { size: 'sm', onClick: saveDraft, disabled: !draftValid, children: '保存' })
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

    // The "+" menu row — data contribution through the stable attachments seam.
    ctx.register({
      id: 'my-snippets-menu-row',
      area: COMPOSER_AREAS.attachments,
      data: {
        label: '我的片段',
        icon: 'wand',
        run: insertCtx => {
          insertCtxRef = insertCtx
          openSurface = captureSurface() || firstVisibleSurface()
          $mode.set('manage')
          $managerOpen.set(true)
        }
      }
    })

    // Dialog host — underside renders nothing visible when closed (null).
    ctx.register({
      id: 'snippets-manager-host',
      area: COMPOSER_AREAS.underside,
      render: () => jsx(ManagerDialog, {})
    })

    // ⌘K palette row — quick open without the + menu hop.
    ctx.register({
      id: 'open-my-snippets',
      area: PALETTE_AREA,
      data: {
        id: 'prompt-snippets.openManager',
        label: '打开我的片段',
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
    ctx.register({
      id: 'my-snippets-keybind',
      area: KEYBINDS_AREA,
      data: {
        id: 'prompt-snippets.openManager',
        category: 'composer',
        defaults: [],
        label: '打开我的片段',
        run: () => {
          openSurface = captureSurface() || firstVisibleSurface()
          $mode.set('quick')
          $managerOpen.set(true)
        }
      }
    })

    if (typeof ctx.onDispose === 'function') {
      ctx.onDispose(() => {
        store = null
        insertCtxRef = null
        openSurface = null
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


