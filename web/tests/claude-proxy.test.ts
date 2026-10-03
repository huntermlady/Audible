import { validateClaudeBody } from '../vite-plugins/claude-proxy'

describe('/__claude proxy body validation', () => {
  it('accepts claude-* models within the token cap', () => {
    expect(validateClaudeBody({ model: 'claude-sonnet-5', max_tokens: 1024, messages: [] })).toBeNull()
  })
  it.each([
    [{ model: 'gpt-4', max_tokens: 10 }],
    [{ max_tokens: 10 }],
    [{ model: 'claude-sonnet-5', max_tokens: 8193 }],
    [null],
    ['text'],
  ])('rejects %j', (body) => {
    expect(validateClaudeBody(body)).toBeTypeOf('string')
  })
})
