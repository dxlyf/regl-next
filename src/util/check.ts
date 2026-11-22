/**
 * 参数校验与错误报告工具。
 *
 * regl 的一大特色是「错误信息尽可能友好」。这里保留了这个传统：
 * - 所有错误统一加 `(regl)` 前缀；
 * - 命令相关错误会尽量带上是哪个命令出错（通过 `commandRaise`）；
 * - 着色器编译失败时会把出错的源码行打印出来，方便定位。
 *
 * 与旧版 regl 的差异：
 * - 旧版通过 browserify transform 在压缩包里删除 check 调用；本实现使用
 *   一个编译期常量 `DEV` 决定是否执行昂贵的断言（见 `assert`），
 *   生产构建可以用 esbuild 的 define 把 `__REGL_DEV__` 设为 false。
 */

export const REGL_PREFIX = '(regl) '

/** 是否开启运行时断言。生产构建可通过 define 替换为 false。 */
declare const __REGL_DEV__: boolean | undefined
export const DEV: boolean =
  typeof __REGL_DEV__ === 'undefined' ? true : !!__REGL_DEV__

/** 直接抛出带 regl 前缀的错误。 */
export function raise(message: string): never {
  const error = new Error(REGL_PREFIX + message)
  // 保留 console.error，便于在浏览器控制台直接看到堆栈
  // eslint-disable-next-line no-console
  console.error(error)
  throw error
}

/** 断言：失败时抛出错误。 */
export function check(predicate: unknown, message: string): asserts predicate {
  if (!predicate) {
    raise(message)
  }
}

/** 只在开发模式下执行的断言（用于每帧都会执行的热路径）。 */
export function assert(predicate: unknown, message: string): void {
  if (DEV && !predicate) {
    raise(message)
  }
}

/** 断言 value 的 typeof 为 type。 */
export function checkType(
  value: unknown,
  type: string,
  message?: string
): void {
  if (typeof value !== type) {
    raise(
      `invalid parameter type${message ? ': ' + message : ''}. expected ${type}, got ${typeof value}`
    )
  }
}

/** 断言 value 是 possibilities 的键。 */
export function checkParameter(
  value: unknown,
  possibilities: Record<string, unknown>,
  message?: string
): void {
  // 允许 0 / 1 这类数字键（blend factor / stencil op 支持 '0' 与 '1'）
  const key =
    typeof value === 'number' ? String(value) : value
  if (
    (typeof key !== 'string' && typeof key !== 'number') ||
    !(key in possibilities)
  ) {
    raise(
      `unknown parameter (${String(value)})${message ? ': ' + message : ''}. possible values: ${Object.keys(
        possibilities
      ).join(', ')}`
    )
  }
}

/** 断言 value 在列表里。 */
export function checkOneOf(value: unknown, list: readonly unknown[], message?: string): void {
  if (list.indexOf(value) < 0) {
    raise(`invalid value${message ? ': ' + message : ''}. must be one of: ${list.join(', ')}`)
  }
}

/** 断言非负整数。 */
export function checkNonNegativeInt(value: number, message?: string): void {
  if (!((value >= 0) && ((value | 0) === value))) {
    raise(
      `invalid parameter type, (${value})${message ? ': ' + message : ''}. must be a nonnegative integer`
    )
  }
}

/** 带命令名字的错误。 */
export function commandRaise(message: string, command?: string): never {
  raise(`${message}${command ? ` in command ${command}` : ''}`)
}

/** 带命令名字的断言。 */
export function checkCommand(
  predicate: unknown,
  message: string,
  command?: string
): void {
  if (!predicate) {
    commandRaise(message, command)
  }
}

/** 带命令名字的类型断言。 */
export function checkCommandType(
  value: unknown,
  type: string,
  message: string,
  command?: string
): void {
  if (typeof value !== type) {
    commandRaise(
      `invalid parameter type: ${message}. expected ${type}, got ${typeof value}`,
      command
    )
  }
}

// ---------------------------------------------------------------------------
// 类型判断
// ---------------------------------------------------------------------------

const TYPED_ARRAY_TAGS = new Set([
  '[object Int8Array]',
  '[object Uint8Array]',
  '[object Uint8ClampedArray]',
  '[object Int16Array]',
  '[object Uint16Array]',
  '[object Int32Array]',
  '[object Uint32Array]',
  '[object Float32Array]',
  '[object Float64Array]'
])

/** 是否是 TypedArray（不含 DataView）。 */
export function isTypedArray(value: unknown): value is ArrayBufferView {
  return typeof value === 'object' && value !== null && TYPED_ARRAY_TAGS.has(Object.prototype.toString.call(value))
}

/** 是否是数组或 TypedArray。 */
export function isArrayLike(value: unknown): value is ArrayLike<number> {
  return Array.isArray(value) || isTypedArray(value)
}

/** 是否是 ndarray（duck typing，与 regl 保持一致）。 */
export interface NDArrayLike {
  shape: number[]
  stride: number[]
  offset?: number
  data: ArrayLike<number> | ArrayBufferView
  order?: number[]
}

export function isNDArrayLike(value: unknown): value is NDArrayLike {
  if (!value || typeof value !== 'object') {
    return false
  }
  const v = value as NDArrayLike
  return (
    Array.isArray(v.shape) &&
    Array.isArray(v.stride) &&
    (typeof v.data === 'object' || Array.isArray(v.data))
  )
}

// ---------------------------------------------------------------------------
// 着色器错误格式化
// ---------------------------------------------------------------------------

/** 从 WebGL 的 infoLog 中解析出错误条目。 */
interface ShaderError {
  file: number | string
  line: number
  message: string
}

function parseShaderErrorLog(log: string): ShaderError[] {
  const errors: ShaderError[] = []
  for (const raw of log.split('\n')) {
    const line = raw.trim()
    if (line.length < 5) continue
    const m = /^ERROR:\s*(\d+):(\d+):\s*(.*)$/.exec(line)
    if (m) {
      errors.push({
        file: parseInt(m[1], 10),
        line: parseInt(m[2], 10),
        message: m[3].trim()
      })
    } else {
      errors.push({ file: 'unknown', line: 0, message: line })
    }
  }
  return errors
}

/**
 * 在控制台打印带行号、带 `^^^` 指示的着色器源码，然后抛出异常。
 * 这是 regl 体验中非常重要的一环，保留并做了简化。
 */
export function reportShaderError(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  shader: WebGLShader,
  source: string,
  type: number,
  command?: string
): void {
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return
  }
  const isFragment = type === gl.FRAGMENT_SHADER
  const typeName = isFragment ? 'fragment' : 'vertex'
  const log = gl.getShaderInfoLog(shader) || '(no info log)'
  const errors = parseShaderErrorLog(log)
  const lines = source.split('\n')

  // 建立 行号 -> 错误列表 的索引
  const byLine = new Map<number, string[]>()
  for (const err of errors) {
    if (typeof err.file === 'number' && err.line > 0) {
      const list = byLine.get(err.line) || []
      list.push(err.message)
      byLine.set(err.line, list)
    }
  }

  const out: string[] = []
  out.push(
    `%cError compiling ${typeName} shader${command ? ` in command ${command}` : ''}`
  )
  lines.forEach((line, index) => {
    const number = index + 1
    const messages = byLine.get(number)
    if (messages) {
      out.push(`${String(number).padStart(4)}|  ${line}`)
      for (const message of messages) {
        out.push(`      ^^^ ${message}`)
      }
    } else if (byLine.size > 0) {
      out.push(`${String(number).padStart(4)}|  ${line}`)
    }
  })
  if (byLine.size === 0) {
    out.push(log)
  }

  // eslint-disable-next-line no-console
  console.error(out.join('\n'))
  raise(
    `Error compiling ${typeName} shader${command ? ` in command ${command}` : ''}${errors[0] ? `: ${errors[0].message}` : ''}`
  )
}

/** 链接失败时抛出异常。 */
export function reportLinkError(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  program: WebGLProgram,
  fragSource: string,
  vertSource: string,
  command?: string
): void {
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return
  }
  const log = gl.getProgramInfoLog(program) || '(no info log)'
  // eslint-disable-next-line no-console
  console.error(
    `${REGL_PREFIX}Error linking program${command ? ` in command ${command}` : ''}\n` +
      `--- vertex ---\n${vertSource}\n--- fragment ---\n${fragSource}\n--- log ---\n${log}`
  )
  raise(`Error linking program${command ? ` in command ${command}` : ''}`)
}
