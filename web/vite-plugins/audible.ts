import fs from 'node:fs'
import path from 'node:path'
import type { Connect, Plugin } from 'vite'

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.parquet': 'application/vnd.apache.parquet',
  '.md': 'text/markdown; charset=utf-8',
}

/**
 * Serves `<repoRoot>/<dir>/**` at `<base><dir>/**`. Missing files are a real 404
 * (never the SPA fallback), so `reports/index.json` absent → 404 → [] in the client.
 */
function staticDirMiddleware(repoRoot: string, base: string, dirs: string[]): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = (req.url ?? '').split('?')[0]
    for (const dir of dirs) {
      const prefix = `${base}${dir}/`
      if (!url.startsWith(prefix)) continue
      const root = path.join(repoRoot, dir)
      const file = path.normalize(path.join(root, decodeURIComponent(url.slice(prefix.length))))
      if (!file.startsWith(root + path.sep)) {
        res.statusCode = 403
        res.end()
        return
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'text/plain')
        res.end(`Not found: ${dir}/${url.slice(prefix.length)}`)
        return
      }
      const stat = fs.statSync(file)
      res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream')
      res.setHeader('Content-Length', String(stat.size))
      res.setHeader('Cache-Control', 'no-cache')
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      fs.createReadStream(file).pipe(res)
      return
    }
    next()
  }
}

/** `/Audible` (no trailing slash, e.g. a reload after a router link to "/") → 301 `/Audible/` (query kept). */
export function baseRedirectMiddleware(base: string): Connect.NextHandleFunction {
  const bare = base.replace(/\/$/, '')
  return (req, res, next) => {
    const [pathname, query] = (req.url ?? '').split(/\?(.*)/s, 2)
    if (bare && pathname === bare && (req.method === 'GET' || req.method === 'HEAD')) {
      res.statusCode = 301
      res.setHeader('Location', `${base}${query ? `?${query}` : ''}`)
      res.end()
      return
    }
    next()
  }
}

/** Dev + preview: serve repo-root data/ and reports/ under the base path, and redirect the bare base. */
export function serveRepoData(repoRoot: string, base: string): Plugin {
  return {
    name: 'audible:serve-repo-data',
    configureServer(server) {
      server.middlewares.use(baseRedirectMiddleware(base))
      server.middlewares.use(staticDirMiddleware(repoRoot, base, ['data', 'reports']))
    },
    configurePreviewServer(server) {
      server.middlewares.use(baseRedirectMiddleware(base))
      // dist/ already holds copies; this only guarantees missing files 404 instead of SPA fallback.
      server.middlewares.use(staticDirMiddleware(path.resolve(server.config.root, server.config.build.outDir), base, ['data', 'reports']))
    },
  }
}

/** Build: copy data/ and reports/ into dist/ and write dist/404.html = index.html (GitHub Pages deep links). */
export function copyRepoData(repoRoot: string): Plugin {
  let outDir = 'dist'
  return {
    name: 'audible:copy-repo-data',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      for (const dir of ['data', 'reports']) {
        const src = path.join(repoRoot, dir)
        if (fs.existsSync(src)) fs.cpSync(src, path.join(outDir, dir), { recursive: true })
      }
      const index = path.join(outDir, 'index.html')
      if (fs.existsSync(index)) fs.copyFileSync(index, path.join(outDir, '404.html'))
    },
  }
}

/** Reads KEY=value pairs from a .env file without exposing them to the client bundle. */
export function readDotEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {}
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}
