/**
 * 示例页面冒烟测试。
 *
 * 逐个加载 examples/*.html，等待 window.__exampleReady，
 * 检查 canvas 是否创建、是否有页面错误。
 *
 * 用法：node test/examples/run.mjs
 */
import { chromium } from 'playwright-core'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'

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
    '--enable-unsafe-swiftshader',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--disable-dev-shm-usage'
  ]
})

const examples = [
  'triangle.html',
  'points.html',
  'elements.html',
  'vao.html',
  'batch.html',
  'scope.html',
  'texture-sampler.html',
  'texture-array.html',
  'cube-map.html',
  'framebuffer.html',
  'material.html',
  'blend.html',
  'depth.html',
  'stencil.html',
  'scissor.html',
  'transparent.html',
  'mrt.html',
  'msaa.html',
  'ubo.html',
  'instancing.html',
  'webgpu.html',
  'webgpu-depth-msaa.html',
  'webgpu-command.html',
  'fps-webgl2.html',
  'fps-webgpu.html'
]

let failed = 0
for (const file of examples) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`)
  })

  try {
    await page.goto(pathToFileURL(path.join(root, 'examples', file)).href)
    await page.waitForFunction(() => window.__exampleReady === true, null, {
      timeout: 8000
    })
    const canvas = await page.evaluate(() => {
      const el = document.querySelector('canvas')
      return el ? { width: el.width, height: el.height } : null
    })
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('canvas was not created')
    }
    if (file.startsWith('fps-')) {
      await page.click('#fps-start')
      await page.waitForTimeout(250)
      const started = await page.evaluate(() => {
        const overlay = document.getElementById('fps-start')
        return !!overlay && overlay.classList.contains('hidden')
      })
      if (!started) {
        throw new Error('FPS start overlay did not close')
      }
    }
    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
    console.log(`PASS  ${file}`)
  } catch (error) {
    failed++
    console.log(`FAIL  ${file}`)
    console.log(String(error.stack || error))
    if (errors.length > 0) {
      console.log('--- page errors ---')
      console.log(errors.join('\n'))
    }
  } finally {
    await page.close()
  }
}

await browser.close()
console.log(`\n${examples.length - failed}/${examples.length} examples passed`)
process.exit(failed ? 1 : 0)
