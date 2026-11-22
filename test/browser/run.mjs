/**
 * 浏览器集成测试运行器。
 *
 * 使用本机 Chrome（SwiftShader 软件渲染）加载 dist/regl-next.dev.js，
 * 执行 test/browser/tests.js 中的测试。
 *
 * 用法：node test/browser/run.mjs [chromePath]
 */
import { chromium } from 'playwright-core'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')

const candidates = [
  process.argv[2],
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean)

const chrome = candidates.find((p) => existsSync(p))
if (!chrome) {
  console.error('No Chrome/Edge executable found. Pass a path as the first argument.')
  process.exit(2)
}

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: [
    '--headless=new',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--disable-dev-shm-usage'
  ]
})

const page = await browser.newPage()
const logs = []
page.on('console', (msg) => {
  logs.push(`[${msg.type()}] ${msg.text()}`)
})
page.on('pageerror', (err) => {
  logs.push(`[pageerror] ${err.stack || err.message}`)
})

await page.addScriptTag({
  path: path.join(
    root,
    process.argv.includes('--prod')
      ? 'dist/regl-next.min.js'
      : 'dist/regl-next.dev.js'
  )
})
await page.addScriptTag({ path: path.join(__dirname, 'tests.js') })
await page.addScriptTag({ path: path.join(__dirname, 'ubo-tests.js') })
await page.addScriptTag({ path: path.join(__dirname, 'sampler-tests.js') })
await page.addScriptTag({ path: path.join(__dirname, 'texture-3d-tests.js') })
await page.addScriptTag({ path: path.join(__dirname, 'msaa-tests.js') })
await page.addScriptTag({ path: path.join(__dirname, 'integer-attribute-tests.js') })
await page.addScriptTag({ path: path.join(__dirname, 'mrt-read-tests.js') })
await page.addScriptTag({ path: path.join(__dirname, 'pbo-tests.js') })

const results = await page.evaluate(() => window.runReglTests())
await browser.close()

let failed = 0
for (const result of results) {
  const status = result.ok ? 'PASS' : 'FAIL'
  if (!result.ok) failed++
  console.log(
    `${status}  ${result.name}  (${result.ms.toFixed(1)}ms)` +
      (result.note ? `  ${result.note}` : '')
  )
  if (!result.ok && result.error) {
    console.log(
      result.error
        .split('\n')
        .slice(0, 12)
        .map((line) => '      ' + line)
        .join('\n')
    )
  }
}

if (logs.length) {
  console.log('\n--- page console ---')
  for (const line of logs.slice(-80)) console.log(line)
}

console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
