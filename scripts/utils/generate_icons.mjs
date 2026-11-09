/**
 * Rasterise frontend/src/assets/logo.svg into the platform icon set.
 *
 * The SVG stays the single source of truth — these PNGs are build artefacts
 * that happen to be committed, because browsers and Android need raster.
 * Regenerate after any change to the mark:
 *
 *     node scripts/utils/generate_icons.mjs
 *
 * Chromium does the rasterising (it is already present via Playwright), which
 * avoids adding an image-processing dependency for a job run a few times a year.
 */
import { chromium } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const svg = readFileSync(resolve(root, 'frontend/src/assets/logo.svg'), 'utf8')
const outDir = resolve(root, 'frontend/public')

/** Brand ground for icons that cannot be transparent (iOS, Android maskable). */
const GROUND = '#FAF7F1'

const TARGETS = [
  // Browser tab. Transparent so it sits on any tab-bar colour.
  { file: 'favicon-32.png', size: 32, pad: 0, bg: null },
  { file: 'favicon-16.png', size: 16, pad: 0, bg: null },
  // iOS home screen. Rendered on an opaque tile; iOS ignores alpha anyway.
  { file: 'apple-touch-icon.png', size: 180, pad: 0.12, bg: GROUND },
  // Android / PWA. `pad` keeps the mark inside the maskable safe zone, so a
  // circular or squircle mask never clips it.
  { file: 'icon-192.png', size: 192, pad: 0.2, bg: GROUND },
  { file: 'icon-512.png', size: 512, pad: 0.2, bg: GROUND },
]

mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
for (const { file, size, pad, bg } of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 2, // supersample, then let the encoder downscale cleanly
  })
  const inset = Math.round(size * pad)
  await page.setContent(`<!doctype html><style>
      html,body{margin:0;width:${size}px;height:${size}px}
      body{background:${bg ?? 'transparent'};display:flex;align-items:center;justify-content:center}
      svg{width:${size - inset * 2}px;height:${size - inset * 2}px;display:block}
    </style>${svg}`)
  await page.waitForTimeout(120)
  await page.screenshot({ path: resolve(outDir, file), omitBackground: bg === null })
  await page.close()
  console.log(`  ${file.padEnd(22)} ${size}x${size}${bg ? '' : ' (transparent)'}`)
}
await browser.close()
console.log('icons written to frontend/public/')
