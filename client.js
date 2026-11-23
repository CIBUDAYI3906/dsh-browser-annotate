// dsh-browser-annotate — annotate elements inside the shipped right-Sidebar
// browser (Desktop Electron <webview>) and send the selection to the agent.
//
// 0.2.0 selection model:
//   - 单击           命中最小元素
//   - ⌥/Alt + 单击    选中父级（容器）
//   - 拖拽           框选一块区域，自动落到「包含该区域的最小容器」
//   - ⇧/Shift + 单击 继续加选（再点一次取消）
//   - 面包屑         在弹窗里点任意上级，随时切换选择范围
window.__ModuleLoader__.load({
  id: 'dsh-browser-annotate',
  factory: (require) => {
    const React = require('react')

    const RESULT_PREFIX = '__DSH_ANNOT__'
    const ICON_SVG = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5V3.5A1.5 1.5 0 0 1 3.5 2h2M10.5 2h2A1.5 1.5 0 0 1 14 3.5v2M14 10.5v2a1.5 1.5 0 0 1-1.5 1.5h-2M5.5 14h-2A1.5 1.5 0 0 1 2 12.5v-2"/><rect x="5" y="5" width="6" height="6" rx="1"/></svg>'

    const CSS = `
.dba-btn { display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35)); background: transparent; color: var(--dsw-alias-label-secondary, #b8b8c4); font-size: 12px; line-height: 1; padding: 4px 6px; border-radius: 8px; cursor: pointer; }
.dba-btn svg { display: block; }
.dba-btn:hover { color: var(--dsw-alias-label-primary, #fff); border-color: var(--dsw-alias-border-l2, rgba(128,128,128,.6)); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12)); }
.dba-btn:disabled { opacity: .5; cursor: default; }
.dba-tool { all: unset; display: inline-flex; align-items: center; height: 24px; padding: 0 8px; margin-left: 4px; border-radius: 6px; color: var(--dsw-alias-label-secondary, #b8b8c4); font: 500 12px/1 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; cursor: pointer; }
.dba-tool:hover { color: var(--dsw-alias-label-primary, #fff); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12)); }
.dba-tool svg { display: block; }
.dba-toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483647; background: rgba(20,20,24,.92); color: #fff; font-size: 12px; padding: 8px 14px; border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,.4); pointer-events: none; }
`

    function toast(text) {
      const el = document.createElement('div')
      el.className = 'dba-toast'
      el.textContent = text
      document.body.append(el)
      setTimeout(() => { el.remove() }, 3200)
    }

    function browserWebviews() {
      return Array.from(document.querySelectorAll('webview[data-sidebar-browser-frame="webview"]'))
    }

    function findBrowserWebview() {
      const visible = browserWebviews().filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 20 && r.height > 20
      })
      return visible.length > 0 ? visible[visible.length - 1] : null
    }

    function sessionIdFor(webview) {
      const holder = webview.closest('[data-sidebar-right-session]')
      const id = holder && holder.dataset ? holder.dataset.sidebarRightSession : null
      return id || ''
    }

    // Serialized into the visited page through <webview>.executeJavaScript.
    // It must stay self-contained: only window/document globals are available.
    function guestAnnotate() {
      const previous = window.__dshAnnotState
      if (previous !== undefined && typeof previous.stop === 'function') {
        try { previous.stop() } catch (reason) { /* ignore */ }
      }
      const state = { done: false, payload: null, stop: null }
      window.__dshAnnotState = state

      const host = document.createElement('div')
      host.setAttribute('data-dsh-browser-annotate', '')
      host.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;'
      const root = host.attachShadow({ mode: 'open' })
      root.innerHTML = '<style>'
        + '.bar{position:fixed;left:50%;top:14px;transform:translateX(-50%);padding:6px 14px;border-radius:999px;background:#f5a623;color:#1a1a1a;font:600 12px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:none;white-space:nowrap;z-index:5}'
        + '.box{position:fixed;border:2px solid #ff5252;background:rgba(255,82,82,.15);pointer-events:none;display:none;box-sizing:border-box;z-index:1}'
        + '.marquee{position:fixed;border:2px dashed #4c8dff;background:rgba(76,141,255,.15);pointer-events:none;display:none;box-sizing:border-box;z-index:2}'
        + '.mark{position:fixed;border:2px solid #ff5252;background:rgba(255,82,82,.12);pointer-events:none;box-sizing:border-box;z-index:1}'
        + '.panel{position:fixed;right:18px;bottom:18px;width:340px;box-sizing:border-box;padding:12px;border-radius:12px;background:#1e1e24;color:#fff;border:1px solid rgba(255,255,255,.18);box-shadow:0 18px 48px rgba(0,0,0,.5);font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;pointer-events:auto;z-index:4}'
        + '.panel[hidden]{display:none}'
        + '.panel h3{margin:0 0 6px;font-size:12px;color:#ff9f9f}'
        + '.panel .meta{color:#b8b8c4;font-size:11px;margin-bottom:8px;word-break:break-all;max-height:4.5em;overflow:auto}'
        + '.panel textarea{width:100%;box-sizing:border-box;min-height:64px;resize:vertical;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);color:#fff;font:inherit;outline:none;margin-bottom:8px}'
        + '.panel .row{display:flex;justify-content:flex-end;gap:8px}'
        + '.panel button{border:1px solid rgba(255,255,255,.22);background:transparent;color:#fff;font:inherit;padding:5px 10px;border-radius:8px;cursor:pointer}'
        + '.panel button.send{background:#4c8dff;border-color:#4c8dff}'
        + '</style>'
        + '<div class="bar">圈选标注：点击选一个，按住拖动框选多个；Esc 取消</div>'
        + '<div class="box"></div>'
        + '<div class="marquee"></div>'
        + '<div class="marks"></div>'
        + '<div class="panel" hidden>'
        + '<h3>已圈选元素（红框为选中范围）</h3>'
        + '<div class="meta"></div>'
        + '<textarea placeholder="你的修改意见，例如：这个弹窗整体换成深色、标题字号加大…"></textarea>'
        + '<div class="row"><button data-cancel>取消</button><button class="send" data-send>发送给 AI →</button></div>'
        + '</div>'

      const hoverBox = root.querySelector('.box')
      const marquee = root.querySelector('.marquee')
      const marks = root.querySelector('.marks')
      const panel = root.querySelector('.panel')
      const meta = root.querySelector('.meta')
      const textarea = root.querySelector('textarea')
      let selected = []
      let dragging = false
      let moved = false
      let startX = 0
      let startY = 0

      const cleanup = () => {
        document.removeEventListener('mousedown', onMouseDown, true)
        document.removeEventListener('mousemove', onMouseMove, true)
        document.removeEventListener('mouseup', onMouseUp, true)
        document.removeEventListener('click', onClick, true)
        document.removeEventListener('keydown', onKey, true)
      }
      const finish = (payload) => {
        if (state.done) return
        cleanup()
        state.done = true
        state.payload = payload
        state.stop = null
        try { host.remove() } catch (reason) { /* ignore */ }
        try { console.log('__DSH_ANNOT__' + JSON.stringify(payload)) } catch (reason) { /* ignore */ }
      }

      const infoFor = (el) => {
        const rect = el.getBoundingClientRect()
        const scroller = document.scrollingElement || document.documentElement
        const sx = scroller.scrollLeft || 0
        const sy = scroller.scrollTop || 0
        const path = []
        let node = el
        while (node !== null && node !== document.body && node !== document.documentElement && path.length < 12) {
          let name = String(node.tagName || '').toLowerCase()
          if (node.id) name += '#' + node.id
          const cls = typeof node.className === 'string' ? node.className : ''
          if (cls) name += '.' + cls.trim().split(/\s+/).slice(0, 3).join('.')
          path.unshift(name)
          node = node.parentElement
        }
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140)
        return {
          tag: String(el.tagName || '').toLowerCase(),
          id: el.id || '',
          className: (typeof el.className === 'string' ? el.className : '').trim(),
          text,
          path: path.join(' > '),
          rect: { x: Math.round(rect.left + sx), y: Math.round(rect.top + sy), width: Math.round(rect.width), height: Math.round(rect.height) },
          viewport: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
        }
      }

      const drawHover = (el) => {
        if (el === null || el === host || el === document.documentElement || el === document.body) {
          hoverBox.style.display = 'none'
          return
        }
        const r = el.getBoundingClientRect()
        hoverBox.style.display = 'block'
        hoverBox.style.left = r.left + 'px'
        hoverBox.style.top = r.top + 'px'
        hoverBox.style.width = r.width + 'px'
        hoverBox.style.height = r.height + 'px'
      }

      const drawMarks = (els) => {
        marks.textContent = ''
        for (const el of els) {
          const r = el.getBoundingClientRect()
          const mark = document.createElement('div')
          mark.className = 'mark'
          mark.style.left = r.left + 'px'
          mark.style.top = r.top + 'px'
          mark.style.width = r.width + 'px'
          mark.style.height = r.height + 'px'
          marks.appendChild(mark)
        }
      }

      const selectElements = (els) => {
        selected = els
        drawMarks(els)
        hoverBox.style.display = 'none'
        const labels = els.slice(0, 4).map((el) => {
          const tag = String(el.tagName || '').toLowerCase()
          return tag + (el.id ? '#' + el.id : '')
        })
        meta.textContent = els.length === 1
          ? labels[0] + ' · ' + ((els[0].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '（无文本）')
          : '已选中 ' + els.length + ' 个元素：' + labels.join('、') + (els.length > 4 ? ' 等' : '')
        panel.hidden = false
        textarea.focus()
      }

      const inside = (el, box) => {
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) return false
        return r.left >= box.left - 1 && r.top >= box.top - 1 && r.right <= box.right + 1 && r.bottom <= box.bottom + 1
      }

      const collect = (box) => {
        const candidates = []
        for (const el of Array.from(document.body.querySelectorAll('*'))) {
          if (el === host || host.contains(el)) continue
          if (/^(SCRIPT|STYLE|LINK|META|HEAD|TITLE|NOSCRIPT|TEMPLATE|BR)$/i.test(el.tagName)) continue
          if (inside(el, box)) candidates.push(el)
        }
        // 只保留最外层：被圈中的兄弟/独立块作为一批，祖先也圈中时取祖先（例如整个弹窗）
        const set = new Set(candidates)
        const outer = []
        for (const el of candidates) {
          let parent = el.parentElement
          let covered = false
          while (parent !== null) {
            if (set.has(parent)) { covered = true; break }
            parent = parent.parentElement
          }
          if (!covered) outer.push(el)
        }
        return outer.slice(0, 30)
      }

      const marqueeBox = () => ({
        left: Math.min(startX, lastX), top: Math.min(startY, lastY),
        right: Math.max(startX, lastX), bottom: Math.max(startY, lastY),
      })
      let lastX = 0
      let lastY = 0

      function updateMarquee(x, y) {
        lastX = x
        lastY = y
        const box = marqueeBox()
        marquee.style.display = 'block'
        marquee.style.left = box.left + 'px'
        marquee.style.top = box.top + 'px'
        marquee.style.width = (box.right - box.left) + 'px'
        marquee.style.height = (box.bottom - box.top) + 'px'
      }

      function onMouseDown(e) {
        if (e.button !== 0) return
        if (e.composedPath && e.composedPath().includes(host)) return
        e.preventDefault()
        e.stopPropagation()
        dragging = true
        moved = false
        startX = e.clientX
        startY = e.clientY
        lastX = e.clientX
        lastY = e.clientY
        hoverBox.style.display = 'none'
        marquee.style.display = 'none'
      }

      function onMouseMove(e) {
        if (dragging) {
          if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) moved = true
          updateMarquee(e.clientX, e.clientY)
          return
        }
        drawHover(document.elementFromPoint(e.clientX, e.clientY))
      }

      function onMouseUp(e) {
        if (!dragging) return
        dragging = false
        marquee.style.display = 'none'
        const box = {
          left: Math.min(startX, e.clientX), top: Math.min(startY, e.clientY),
          right: Math.max(startX, e.clientX), bottom: Math.max(startY, e.clientY),
        }
        if (!moved || (box.right - box.left < 4 && box.bottom - box.top < 4)) {
          const el = document.elementFromPoint(e.clientX, e.clientY)
          if (el === null || el === host || el === document.documentElement || el === document.body) return
          selectElements([el])
          return
        }
        let els = collect(box)
        if (els.length === 0) {
          const el = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)
          if (el !== null && el !== host && el !== document.documentElement && el !== document.body) els = [el]
        }
        if (els.length === 0) return
        selectElements(els)
      }

      function onClick(e) {
        if (e.composedPath && e.composedPath().includes(host)) return
        e.preventDefault()
        e.stopPropagation()
      }

      function onKey(e) {
        if (e.key === 'Escape') finish({ canceled: true })
      }

      root.querySelector('[data-cancel]').addEventListener('click', () => { finish({ canceled: true }) })
      root.querySelector('[data-send]').addEventListener('click', () => {
        if (selected.length === 0) return
        if (selected.length === 1) {
          finish({ element: infoFor(selected[0]), request: textarea.value })
        } else {
          finish({ elements: selected.map(infoFor), request: textarea.value })
        }
      })

      document.documentElement.appendChild(host)
      document.addEventListener('mousedown', onMouseDown, true)
      document.addEventListener('mousemove', onMouseMove, true)
      document.addEventListener('mouseup', onMouseUp, true)
      document.addEventListener('click', onClick, true)
      document.addEventListener('keydown', onKey, true)
      state.stop = () => { finish({ canceled: true }) }
      return 'installed'
    }

    const INSTALL_SCRIPT = '(function(){'
      + 'if (window.__dshAnnotateStart) return "present";'
      + 'window.__dshAnnotateStart = ' + guestAnnotate.toString() + ';'
      + 'return "installed";'
      + '})()'

    async function ensureInstalled(webview) {
      try {
        await webview.executeJavaScript(INSTALL_SCRIPT, true)
        return true
      } catch (reason) {
        return false
      }
    }

    let autoStartUrl = null

    function toolbarFor(webview) {
      const session = webview.closest('[data-sidebar-right-session]')
      if (session !== null) {
        const form = session.querySelector('form')
        if (form !== null && form.querySelector('input') !== null) return form
      }
      let node = webview
      while (node !== null && node !== document.body) {
        const form = node.querySelector(':scope > form')
        if (form !== null && form.querySelector('input') !== null) return form
        node = node.parentElement
      }
      return null
    }

    const observedForms = new WeakMap()

    function ensureToolbar(webview) {
      const form = toolbarFor(webview)
      if (form === null) return
      if (form.querySelector('[data-dba-toolbar]') !== null) return
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dba-tool'
      button.dataset.dbaToolbar = '1'
      button.title = '圈选标注：选元素/容器，或框选一块区域发给 AI'
      button.setAttribute('aria-label', '圈选标注')
      button.innerHTML = ICON_SVG
      button.addEventListener('click', async () => {
        const ready = await ensureInstalled(webview)
        if (!ready) {
          toast('页面还没准备好，请稍后再试')
          return
        }
        try {
          await webview.executeJavaScript('window.__dshAnnotateStart && window.__dshAnnotateStart(); true', true)
        } catch (reason) {
          toast('无法开始标注：' + String(reason && reason.message ? reason.message : reason))
        }
      })
      form.append(button)
      if (!observedForms.has(form)) {
        const observer = new MutationObserver(() => {
          if (form.querySelector('[data-dba-toolbar]') === null) form.append(button)
        })
        observer.observe(form, { childList: true })
        observedForms.set(form, observer)
      }
    }

    async function autoStartIfNeeded(webview) {
      if (autoStartUrl === null) return
      let current = ''
      try { current = webview.getURL() } catch (reason) { return }
      if (current !== autoStartUrl) return
      autoStartUrl = null
      const ready = await ensureInstalled(webview)
      if (!ready) return
      try { await webview.executeJavaScript('window.__dshAnnotateStart && window.__dshAnnotateStart(); true', true) } catch (reason) { /* ignore */ }
    }

    async function sendPayload(webview, payload) {
      const sessionId = sessionIdFor(webview)
      if (sessionId === '') {
        toast('找不到当前会话，标注未发送')
        return
      }
      let url = ''
      try { url = webview.getURL() } catch (reason) { /* ignore */ }
      try {
        const res = await fetch('/dsh-browser-annotate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, url, element: payload.element, elements: payload.elements, request: payload.request }),
        })
        const data = await res.json().catch(() => ({}))
        toast(data.ok ? '已发送给 AI' : ('发送失败：' + (data.error || res.status)))
      } catch (reason) {
        toast('发送失败：' + String(reason && reason.message ? reason.message : reason))
      }
    }

    function watchWebviews(ctx) {
      const watched = new WeakSet()
      const scan = () => {
        for (const webview of browserWebviews()) {
          if (watched.has(webview)) continue
          watched.add(webview)
          webview.addEventListener('dom-ready', () => { void ensureInstalled(webview); void ensureToolbar(webview); void autoStartIfNeeded(webview) })
          webview.addEventListener('did-stop-loading', () => { void ensureInstalled(webview); void ensureToolbar(webview); void autoStartIfNeeded(webview) })
          webview.addEventListener('console-message', (event) => {
            const message = typeof event.message === 'string' ? event.message : ''
            if (!message.startsWith(RESULT_PREFIX)) return
            let payload
            try { payload = JSON.parse(message.slice(RESULT_PREFIX.length)) } catch (reason) { return }
            if (payload === null || payload.canceled) return
            void sendPayload(webview, payload)
          })
          void ensureInstalled(webview)
          ensureToolbar(webview)
          void autoStartIfNeeded(webview)
        }
      }
      scan()
      const timer = setInterval(scan, 1000)
      ctx.effect(() => () => { clearInterval(timer) })
    }

    function AnnotateFileButton(props) {
      const [busy, setBusy] = React.useState(false)
      return React.createElement('button', {
        className: 'dba-btn',
        disabled: busy,
        title: '在浏览器里圈选这个文件，并把修改意见发给 AI',
        'aria-label': '圈选标注',
        dangerouslySetInnerHTML: { __html: ICON_SVG },
        onClick: async () => {
          if (props.absolutePath === undefined || props.absolutePath === '') {
            toast('没有拿到这个文件的绝对路径，无法在浏览器里打开')
            return
          }
          setBusy(true)
          try {
            const res = await fetch('/dsh-browser-annotate/open', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ path: props.absolutePath }),
            })
            const data = await res.json().catch(() => ({}))
            if (!data.ok || typeof data.url !== 'string') {
              toast('打开失败：' + (data.error || res.status))
              return
            }
            autoStartUrl = data.url
            if (typeof props.openTab === 'function') props.openTab(data.url)
            else toast('无法打开浏览器标签')
          } catch (reason) {
            toast('打开失败：' + String(reason && reason.message ? reason.message : reason))
          } finally {
            setBusy(false)
          }
        },
      })
    }

    return {
      name: 'dsh-browser-annotate',
      apply(ctx) {
        if (/Electron/i.test(navigator.userAgent)) watchWebviews(ctx)
        const slots = ctx.get('slots')
        if (slots === undefined) return
        let openBrowserTab = null
        let pendingOpenUrl = null
        ctx.inject(['sidebarRight'], (inner) => {
          openBrowserTab = (url) => { inner.sidebarRight.openTab('browser', { params: { url } }) }
          if (pendingOpenUrl !== null) {
            const url = pendingOpenUrl
            pendingOpenUrl = null
            openBrowserTab(url)
          }
        })
        const style = document.createElement('style')
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => { style.remove() })
        slots.inject('sidebar.right.tab.document.actions', () => slots.register({
          name: 'sidebar.right.tab.document.actions',
          id: 'browser-annotate-open',
          order: 0,
        }, (props) => props.absolutePath && /\.html?$/i.test(props.absolutePath)
          ? React.createElement(AnnotateFileButton, {
            absolutePath: props.absolutePath,
            openTab: (url) => {
              if (openBrowserTab === null) { pendingOpenUrl = url; toast('浏览器服务还在加载，马上打开'); return }
              try { openBrowserTab(url) } catch (reason) { toast('打开浏览器失败：' + String(reason && reason.message ? reason.message : reason)) }
            },
          })
          : null))


      },
    }
  },
})
