import { expect, gotoReady, test } from './fixtures'

// The fixture blocks localhost:11434, so this is what a visitor without Ollama sees.
test.describe('sample mode (Ollama down)', () => {
  test('Play-Caller shows the sample banner and a sample call, with no spinner', async ({ page, consoleErrors }) => {
    await gotoReady(page, 'play-caller', /play-caller/i)

    const banner = page.getByTestId('sample-banner').first()
    await expect(banner).toBeVisible()
    await expect(banner).toContainText("Live AI runs on the owner's machine")
    // The probe has settled: no "checking" text, no live-request spinner.
    await expect(page.getByText('Checking for a local model…')).toHaveCount(0)
    await expect(page.locator('.animate-spin')).toHaveCount(0)
    await expect(page.getByText(/waiting for the model|writing the call/)).toHaveCount(0)

    await expect(page.getByRole('button', { name: 'Live AI is off' })).toBeDisabled()
    await expect(page.getByRole('group', { name: 'Sample calls' })).toBeVisible()
    expect(consoleErrors).toEqual([])
  })

  test('chat is disabled with an explanation', async ({ page, consoleErrors }) => {
    await gotoReady(page, 'play-caller', /play-caller/i)
    await page.getByRole('button', { name: 'Open coordinator chat' }).click()

    const drawer = page.locator('#chat-drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByTestId('sample-banner')).toContainText('chat is read-only here')
    const box = drawer.getByRole('textbox', { name: 'Message' })
    await expect(box).toBeDisabled()
    await expect(box).toHaveAttribute('placeholder', /off in sample mode/i)
    await expect(drawer.getByRole('button', { name: 'Send message' })).toBeDisabled()
    for (const example of await drawer.getByRole('button', { name: /^Example question \(chat is off\)/ }).all()) {
      await expect(example).toBeDisabled()
    }
    expect(consoleErrors).toEqual([])
  })
})
