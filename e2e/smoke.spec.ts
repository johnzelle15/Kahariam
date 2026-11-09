import { test, expect } from '@playwright/test'

/**
 * Smoke tests against a running instance.
 *
 * Point them at a server with E2E_BASE_URL (defaults to http://localhost:5000):
 *
 *     npx playwright test
 *     E2E_BASE_URL=http://localhost:5055 npx playwright test
 *
 * Deliberately non-destructive: nothing here signs in successfully, writes
 * inventory, or starts the counter. The failed-login case uses a username that
 * does not exist, which is rejected before any login_history row is written.
 */

test.describe('sign-in screen', () => {
  test('renders the brand, both fields, and the submit control', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Kahariam/i)
    await expect(page.getByText('Kahariam Farms')).toBeVisible()
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
    await expect(page.locator('input').first()).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('shows an error for bad credentials instead of failing silently', async ({ page }) => {
    // The 401 interceptor calls logout(), which clears `error`. The login
    // handler sets it afterwards, so the message survives — this test is what
    // catches it if that ordering ever changes.
    await page.goto('/')
    await page.locator('input').first().fill('no-such-user-e2e')
    await page.locator('input[type="password"]').fill('wrong-password')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByText(/invalid credentials/i)).toBeVisible({ timeout: 10_000 })
    // And it must not advance to the OTP step.
    await expect(page.getByRole('heading', { name: /enter otp/i })).toHaveCount(0)
  })
})

test.describe('installable assets', () => {
  const assets = [
    ['/manifest.webmanifest', /manifest\+json/],
    ['/favicon-32.png', /image\/png/],
    ['/apple-touch-icon.png', /image\/png/],
    ['/icon-192.png', /image\/png/],
    ['/icon-512.png', /image\/png/],
    ['/logo.svg', /image\/svg/],
  ] as const

  for (const [path, type] of assets) {
    test(`serves ${path}`, async ({ request }) => {
      const res = await request.get(path)
      expect(res.status()).toBe(200)
      expect(res.headers()['content-type']).toMatch(type)
    })
  }

  test('manifest names the app and points at real icons', async ({ request }) => {
    const m = await (await request.get('/manifest.webmanifest')).json()
    expect(m.name).toMatch(/Kahariam/i)
    expect(m.display).toBe('standalone')
    for (const icon of m.icons) {
      expect((await request.get(icon.src)).status()).toBe(200)
    }
  })
})

/**
 * Regression cover for the device and lock endpoints, which shipped
 * unauthenticated: their admin check was skipped entirely whenever
 * ADMIN_API_KEY was unset, so anyone reachable on the network could register a
 * device, receive its ingest token, and post fabricated counts.
 */
test.describe('API requires authentication', () => {
  const guarded = [
    ['get', '/api/v1/devices'],
    ['post', '/api/v1/devices/register'],
    ['post', '/api/v1/devices/e2e/revoke'],
    ['post', '/api/v1/devices/e2e/activate'],
    ['get', '/api/v1/devices/e2e/lock_status'],
    ['post', '/api/v1/devices/e2e/lock'],
    ['post', '/api/v1/devices/e2e/unlock'],
    ['get', '/get_statistics'],
    ['get', '/get_inventory'],
    ['get', '/api/sessions'],
    ['get', '/api/low-stock'],
  ] as const

  for (const [method, path] of guarded) {
    test(`${method.toUpperCase()} ${path} rejects anonymous callers`, async ({ request }) => {
      const res = method === 'get'
        ? await request.get(path)
        : await request.post(path, { data: { name: 'e2e' } })
      expect(res.status(), `${path} must not be open`).toBe(401)
    })
  }

  test('ingest refuses a made-up device token', async ({ request }) => {
    const res = await request.post('/api/v1/ingest', {
      headers: { Authorization: 'Bearer not-a-real-device-token' },
      data: { device_id: 'e2e', count: 999999 },
    })
    expect(res.status()).toBe(401)
  })
})

test('the removed legacy devices page is gone, not erroring', async ({ request }) => {
  // It rendered a template that does not exist, so it answered 500.
  expect((await request.get('/devices')).status()).toBe(404)
})
