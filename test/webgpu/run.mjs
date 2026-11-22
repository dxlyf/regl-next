/**
 * WebGPU PoC 测试运行器。
 *
 * 使用本机 Chrome + SwiftShader Vulkan（--use-vulkan=swiftshader）。
 * 如果当前环境没有 WebGPU adapter，则跳过而不是让 WebGL 测试失败。
 */
import { chromium } from 'playwright-core'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--disable-dev-shm-usage'
  ]
})

const page = await browser.newPage()
const logs = []
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.stack || err.message}`))

await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href)
const available = await page.evaluate(async () => {
  if (!navigator.gpu) return false
  try {
    return !!(await navigator.gpu.requestAdapter())
  } catch {
    return false
  }
})
if (!available) {
  console.log('SKIP WebGPU tests: no adapter available in this Chrome')
  if (logs.length) console.log(logs.join('\n'))
  await browser.close()
  process.exit(0)
}

await page.addScriptTag({
  path: path.join(root, 'dist/regl-next.iife.js')
})
await page.addScriptTag({ path: path.join(__dirname, 'tests.js') })
const results = await page.evaluate(() => window.runWebGPUTests())
await browser.close()

let failed = 0
for (const result of results) {
  if (!result.ok) failed++
  console.log(
    `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}  (${result.ms.toFixed(1)}ms)`
  )
  if (!result.ok && result.error) {
    console.log(
      result.error
        .split('\n')
        .slice(0, 10)
        .map((line) => '      ' + line)
        .join('\n')
    )
  }
}
if (logs.length) {
  console.log('\n--- page console ---')
  console.log(logs.join('\n'))
}
console.log(`\n${results.length - failed}/${results.length} WebGPU tests passed`)
process.exit(failed ? 1 : 0)
