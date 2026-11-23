/** Host half: a token-guarded local file server plus annotation delivery. */
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

export const name = 'dsh-browser-annotate'

const ROUTE = '/dsh-browser-annotate'
const OPEN_ROUTE = '/dsh-browser-annotate/open'
const MAX_BODY = 512 * 1024

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm', '.map': 'application/json',
}

function elementLines(el, indent) {
  const pad = indent || ''
  const lines = []
  lines.push(pad + '- 元素标签：' + String(el.tag || ''))
  lines.push(pad + '- id：' + String(el.id || '（无）'))
  lines.push(pad + '- class：' + String(el.className || '（无）'))
  if (el.path) lines.push(pad + '- 元素路径：' + String(el.path))
  if (el.rect) lines.push(pad + '- 页面坐标：x=' + el.rect.x + ' y=' + el.rect.y + ' 宽=' + el.rect.width + ' 高=' + el.rect.height + '（相对页面文档，含滚动）')
  if (el.viewport) lines.push(pad + '- 视口坐标：x=' + el.viewport.x + ' y=' + el.viewport.y + ' 宽=' + el.viewport.width + ' 高=' + el.viewport.height)
  if (el.text) lines.push(pad + '- 元素文本：' + String(el.text))
  return lines
}

function compose(payload) {
  const els = Array.isArray(payload.elements)
    ? payload.elements.filter((item) => item !== null && typeof item === 'object')
    : (payload.element !== null && typeof payload.element === 'object' ? [payload.element] : [])
  const url = typeof payload.url === 'string' ? payload.url : ''
  const lines = ['【浏览器圈选标注】']
  if (url !== '') lines.push('页面：' + url)
  lines.push(els.length > 1
    ? '用户框选了右侧浏览器页面中的 ' + els.length + ' 个元素/区域，请把这些区域作为一个整体按修改意见调整：'
    : '用户圈选了右侧浏览器页面中的一个元素，请依据以下定位信息找到对应代码并修改：')
  els.slice(0, 30).forEach((el, index) => {
    const prefix = els.length > 1 ? '- 元素 ' + (index + 1) + '：' : '- '
    const head = prefix + String(el.tag || '')
      + (el.id ? '#' + String(el.id) : '')
      + (el.className ? '.' + String(el.className).trim().split(/\s+/).slice(0, 3).join('.') : '')
    lines.push(head)
    if (el.path) lines.push('  路径：' + String(el.path))
    if (el.rect) lines.push('  页面坐标：x=' + el.rect.x + ' y=' + el.rect.y + ' 宽=' + el.rect.width + ' 高=' + el.rect.height + '（相对页面文档，含滚动）')
    if (el.viewport) lines.push('  视口坐标：x=' + el.viewport.x + ' y=' + el.viewport.y + ' 宽=' + el.viewport.width + ' 高=' + el.viewport.height)
    if (el.text) lines.push('  元素文本：' + String(el.text).slice(0, 160))
  })
  if (payload.request && String(payload.request).trim() !== '') {
    lines.push('- 用户的修改意见：' + String(payload.request).trim())
  }
  lines.push('请在该页面（' + (url || '当前浏览器页面') + '）对应的源码中找到这些元素，并按修改意见调整；多个元素属于同一区域时保持整体一致。')
  return lines.join('\n')
}

function respond(res, code, body, type = 'application/json; charset=utf-8') {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Token-guarded loopback file server, so the Browser webview can load a local HTML file. */
function createFileServer() {
  const token = randomBytes(18).toString('hex')
  const prefix = '/' + token + '/'
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 405, { ok: false })
    const pathname = (req.url || '/').split('?')[0]
    if (!pathname.startsWith(prefix)) return respond(res, 404, 'not found', 'text/plain; charset=utf-8')
    let target
    try {
      target = path.resolve(decodeURIComponent(pathname.slice(prefix.length - 1)))
    } catch (reason) {
      return respond(res, 400, 'bad path', 'text/plain; charset=utf-8')
    }
    try {
      let info = await stat(target)
      if (info.isDirectory()) {
        target = path.join(target, 'index.html')
        info = await stat(target)
      }
      if (!info.isFile()) return respond(res, 404, 'not found', 'text/plain; charset=utf-8')
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
      })
      if (req.method === 'HEAD') return res.end()
      createReadStream(target).pipe(res)
    } catch (reason) {
      return respond(res, 404, 'not found', 'text/plain; charset=utf-8')
    }
  })
  return { server, token }
}

export function apply(ctx) {
  const { server, token } = createFileServer()
  let port = 0
  server.on('error', () => { /* the /open route reports unavailability */ })
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (address !== null && typeof address === 'object') port = address.port
  })
  ctx.effect(() => () => { server.close() })

  ctx.inject(['webServer', 'agents'], (ctx) => {
    const webServer = ctx.get('webServer')
    const agents = ctx.get('agents')
    if (webServer === undefined || agents === undefined) return

    const sendHandler = async (req, res) => {
      if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'POST only' })
      let payload
      try {
        payload = JSON.parse(await readBody(req))
      } catch (reason) {
        return respond(res, 400, { ok: false, error: String(reason && reason.message ? reason.message : reason) })
      }
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
      if (sessionId === '') return respond(res, 400, { ok: false, error: 'missing sessionId' })
      const agent = agents.get(sessionId)
      if (agent === undefined || typeof agent.send !== 'function') {
        return respond(res, 404, { ok: false, error: 'no agent for session' })
      }
      const message = {
        id: 'msg-annot-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
        role: 'user',
        content: [{ type: 'text', text: compose(payload) }],
        source: { kind: 'user' },
      }
      try {
        agent.send(message, 'next-turn', true)
      } catch (reason) {
        return respond(res, 500, { ok: false, error: String(reason && reason.message ? reason.message : reason) })
      }
      return respond(res, 200, { ok: true, sent: true })
    }

    const openHandler = async (req, res) => {
      if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'POST only' })
      let payload
      try {
        payload = JSON.parse(await readBody(req))
      } catch (reason) {
        return respond(res, 400, { ok: false, error: String(reason && reason.message ? reason.message : reason) })
      }
      const file = typeof payload.path === 'string' ? payload.path : ''
      if (file === '' || !path.isAbsolute(file)) return respond(res, 400, { ok: false, error: 'absolute path required' })
      try {
        const info = await stat(file)
        if (!info.isFile()) return respond(res, 400, { ok: false, error: 'not a file' })
      } catch (reason) {
        return respond(res, 404, { ok: false, error: 'file not found' })
      }
      if (port === 0) return respond(res, 503, { ok: false, error: 'file server not ready' })
      const url = 'http://127.0.0.1:' + port + '/' + token + '/' + file.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')
      return respond(res, 200, { ok: true, url })
    }

    ctx.effect(() => webServer.register({ kind: 'prefix', path: OPEN_ROUTE, handler: openHandler }))
    ctx.effect(() => webServer.register({ kind: 'prefix', path: ROUTE, handler: sendHandler }))
  })
}
