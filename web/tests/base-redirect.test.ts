import { baseRedirectMiddleware } from '../vite-plugins/audible'

function run(url: string, method = 'GET') {
  const res = { statusCode: 200, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v }, end: vi.fn() }
  const next = vi.fn()
  baseRedirectMiddleware('/Audible/')({ url, method } as never, res as never, next)
  return { res, next }
}

describe('base redirect', () => {
  it('redirects /Audible → /Audible/ keeping the query', () => {
    expect(run('/Audible').res).toMatchObject({ statusCode: 301, headers: { Location: '/Audible/' } })
    expect(run('/Audible?x=1').res.headers.Location).toBe('/Audible/?x=1')
  })
  it('passes everything else through', () => {
    for (const u of ['/Audible/', '/Audible/team/KC', '/AudibleX', '/']) expect(run(u).next).toHaveBeenCalled()
    expect(run('/Audible', 'POST').next).toHaveBeenCalled()
  })
})
