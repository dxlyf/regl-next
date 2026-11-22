/**
 * 上下文 / 画布创建。
 *
 * 与 regl 的初始化参数保持兼容，并新增 `version` 选项用于显式选择 WebGL1/2：
 *
 *   createREGL({ canvas, version: 2 })
 *   createREGL({ version: 'auto' })   // 默认：优先 WebGL2，失败回退 WebGL1
 *
 * 也支持直接传入已有的 WebGL1/WebGL2 上下文。
 */

import { check, checkType } from '../util/check'
import type { GLContext } from '../core/capabilities'

export type WebGLVersion = 1 | 2 | 'webgl1' | 'webgl2' | 'auto'

export interface ParsedConfig {
  gl: GLContext
  canvas: HTMLCanvasElement | null
  container: HTMLElement | null
  extensions: string[]
  optionalExtensions: string[]
  pixelRatio: number
  profile: boolean
  version: WebGLVersion
  onDone: (err: string | null, regl?: unknown) => void
  onDestroy: () => void
}

const CONTEXT_NAMES = ['webgl', 'experimental-webgl', 'webgl-experimental']

function isHTMLElement(obj: unknown): obj is HTMLElement {
  return (
    !!obj &&
    typeof (obj as HTMLElement).nodeName === 'string' &&
    typeof (obj as HTMLElement).appendChild === 'function' &&
    typeof (obj as HTMLElement).getBoundingClientRect === 'function'
  )
}

function isCanvasElement(obj: unknown): obj is HTMLCanvasElement {
  return (
    !!obj &&
    typeof (obj as HTMLCanvasElement).getContext === 'function' &&
    (obj as HTMLElement).nodeName === 'CANVAS'
  )
}

/** 判断一个对象是否是 WebGL 上下文（兼容 iframe / headless 环境）。 */
export function isWebGLContext(obj: unknown): obj is GLContext {
  return (
    !!obj &&
    (typeof (obj as GLContext).drawArrays === 'function' ||
      typeof (obj as GLContext).drawElements === 'function') &&
    typeof (obj as GLContext).getParameter === 'function'
  )
}

function isWebGL2Context(gl: GLContext): boolean {
  return (
    typeof (gl as WebGL2RenderingContext).createVertexArray === 'function' &&
    typeof (gl as WebGL2RenderingContext).texStorage2D === 'function'
  )
}

function parseExtensions(input: string | string[]): string[] {
  if (typeof input === 'string') {
    return input.split(/\s+/).filter(Boolean)
  }
  check(Array.isArray(input), 'invalid extension array')
  return input
}

function getElement(desc: unknown): HTMLElement | null {
  if (typeof desc === 'string') {
    check(typeof document !== 'undefined', 'not supported outside of DOM')
    return document.querySelector(desc)
  }
  return (desc as HTMLElement) || null
}

function createCanvas(
  container: HTMLElement,
  pixelRatio: number
): { canvas: HTMLCanvasElement; onDestroy: () => void } {
  const canvas = document.createElement('canvas')
  Object.assign(canvas.style, {
    border: '0',
    margin: '0',
    padding: '0',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%'
  })
  container.appendChild(canvas)

  if (container === document.body) {
    canvas.style.position = 'absolute'
    Object.assign(container.style, { margin: '0', padding: '0' })
  }

  function resize(): void {
    let w = window.innerWidth
    let h = window.innerHeight
    if (container !== document.body) {
      const bounds = canvas.getBoundingClientRect()
      w = bounds.right - bounds.left
      h = bounds.bottom - bounds.top
    }
    canvas.width = Math.max(1, Math.floor(pixelRatio * w))
    canvas.height = Math.max(1, Math.floor(pixelRatio * h))
  }

  let resizeObserver: ResizeObserver | null = null
  if (container !== document.body && typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => {
      // 延迟一拍避免闪烁
      setTimeout(resize)
    })
    resizeObserver.observe(container)
  } else {
    window.addEventListener('resize', resize, false)
  }

  function onDestroy(): void {
    if (resizeObserver) {
      resizeObserver.disconnect()
    } else {
      window.removeEventListener('resize', resize)
    }
    if (canvas.parentNode === container) {
      container.removeChild(canvas)
    }
  }

  resize()
  return { canvas, onDestroy }
}

function tryContext(
  canvas: HTMLCanvasElement,
  name: string,
  attributes: WebGLContextAttributes
): GLContext | null {
  try {
    return canvas.getContext(name as 'webgl', attributes) as GLContext | null
  } catch (err) {
    return null
  }
}

function createContext(
  canvas: HTMLCanvasElement,
  attributes: WebGLContextAttributes,
  version: WebGLVersion
): GLContext | null {
  const prefer2 = version === 2 || version === 'webgl2' || version === 'auto'
  const allow1 = version !== 2 && version !== 'webgl2'

  if (prefer2) {
    const gl2 = tryContext(canvas, 'webgl2', attributes)
    if (gl2 && isWebGL2Context(gl2)) {
      return gl2
    }
    // 如果用户明确要求 WebGL2，失败后不再回退
    if (version === 2 || version === 'webgl2') {
      return null
    }
  }

  if (allow1) {
    for (const name of CONTEXT_NAMES) {
      const gl = tryContext(canvas, name, attributes)
      if (gl) return gl
    }
  }

  return null
}

const CONSTRUCTOR_KEYS = [
  'gl',
  'canvas',
  'container',
  'attributes',
  'pixelRatio',
  'extensions',
  'optionalExtensions',
  'profile',
  'onDone',
  'version'
]

function checkConstructor(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (CONSTRUCTOR_KEYS.indexOf(key) < 0) {
      throw new Error(
        `(regl) invalid regl constructor argument "${key}". must be one of ${CONSTRUCTOR_KEYS.join(', ')}`
      )
    }
  }
}

/** 解析初始化参数。失败时返回 null 并已调用 onDone。 */
export function parseArgs(args_?: unknown): ParsedConfig | null {
  const args = args_ || {}
  let element: HTMLElement | null = null
  let container: HTMLElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let gl: GLContext | null = null

  const contextAttributes: WebGLContextAttributes = {}
  let extensions: string[] = []
  let optionalExtensions: string[] = []
  let pixelRatio =
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  let profile = false
  let version: WebGLVersion = 'auto'
  let onDone: (err: string | null) => void = (err) => {
    if (err) check(false, err)
  }
  let onDestroy: () => void = () => {}

  if (typeof args === 'string') {
    check(
      typeof document !== 'undefined',
      'selector queries only supported in DOM environments'
    )
    element = getElement(args)
    check(!!element, 'invalid query string for element')
  } else if (typeof args === 'object' && args) {
    if (isHTMLElement(args)) {
      element = args
    } else if (isWebGLContext(args)) {
      gl = args
      canvas = (args.canvas as HTMLCanvasElement) || null
    } else {
      const options = args as Record<string, unknown>
      checkConstructor(options)
      if ('gl' in options) {
        gl = options.gl as GLContext
      } else if ('canvas' in options) {
        canvas = getElement(options.canvas) as HTMLCanvasElement | null
      } else if ('container' in options) {
        container = getElement(options.container)
      }
      if ('attributes' in options) {
        checkType(options.attributes, 'object', 'invalid context attributes')
        Object.assign(contextAttributes, options.attributes)
      }
      if ('extensions' in options) {
        extensions = parseExtensions(options.extensions as string | string[])
      }
      if ('optionalExtensions' in options) {
        optionalExtensions = parseExtensions(
          options.optionalExtensions as string | string[]
        )
      }
      if ('onDone' in options) {
        checkType(options.onDone, 'function', 'invalid or missing onDone callback')
        onDone = options.onDone as (err: string | null) => void
      }
      if ('profile' in options) {
        profile = !!options.profile
      }
      if ('pixelRatio' in options) {
        pixelRatio = +(options.pixelRatio as number)
        check(pixelRatio > 0, 'invalid pixel ratio')
      }
      if ('version' in options) {
        version = options.version as WebGLVersion
        check(
          version === 1 ||
            version === 2 ||
            version === 'webgl1' ||
            version === 'webgl2' ||
            version === 'auto',
          'invalid WebGL version, must be 1, 2, "webgl1", "webgl2" or "auto"'
        )
      }
    }
  } else {
    throw new Error('(regl) invalid arguments to regl')
  }

  // 元素归一化
  if (element) {
    if (isCanvasElement(element)) {
      canvas = element
    } else {
      container = element
    }
  }
  if (canvas && !isCanvasElement(canvas)) {
    throw new Error('(regl) invalid canvas element')
  }

  if (!gl) {
    if (!canvas) {
      check(
        typeof document !== 'undefined',
        'must manually specify webgl context outside of DOM environments'
      )
      const result = createCanvas(container || document.body, pixelRatio)
      canvas = result.canvas
      onDestroy = result.onDestroy
    }

    // Chromium 上 premultipliedAlpha 的默认值因平台而异，显式指定为 true
    if (contextAttributes.premultipliedAlpha === undefined) {
      contextAttributes.premultipliedAlpha = true
    }
    gl = createContext(canvas, contextAttributes, version)
  } else if (!canvas) {
    // 直接传入上下文时，从上下文取回画布，用于监听上下文丢失/恢复事件
    canvas = (gl.canvas as HTMLCanvasElement) || null
  }

  if (!gl) {
    onDestroy()
    const message =
      'webgl not supported, try upgrading your browser or graphics drivers http://get.webgl.org'
    onDone(message)
    return null
  }

  if (!isWebGLContext(gl)) {
    onDestroy()
    onDone('invalid WebGL context')
    return null
  }

  return {
    gl,
    canvas,
    container,
    extensions,
    optionalExtensions,
    pixelRatio,
    profile,
    version,
    onDone: onDone as ParsedConfig['onDone'],
    onDestroy
  }
}
