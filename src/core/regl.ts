/**
 * regl 实例的组装与生命周期管理。
 *
 * 这里是各子系统（能力探测、状态缓存、资源仓库、命令编译器）的粘合层，
 * 同时实现 frame / on / clear / read / destroy / 上下文丢失恢复等公共 API。
 */

import {
  check,
  isTypedArray,
  raise
} from '../util/check'
import { GL } from '../util/constants'
import { Capabilities } from './capabilities'
import { buildLimits } from './limits'
import { newStats } from './stats'
import { GLStateCache } from './state'
import { StringStore, ShaderStore } from './shader'
import { createTimer } from './timer'
import {
  CommandRuntime,
  CommandBody,
  compileCommand,
  ScopeState
} from './command'
import { parseArgs } from './webgl'
import { BufferStore } from '../resources/buffer'
import { getBuffer } from '../resources/buffer'
import { ElementsStore } from '../resources/elements'
import { TextureStore } from '../resources/texture'
import { RenderbufferStore } from '../resources/renderbuffer'
import {
  FramebufferStore,
  FramebufferInternal,
  isFramebufferCube
} from '../resources/framebuffer'
import { VertexArrayStore } from '../resources/vao'
import { createUniformBuffer } from '../resources/uniformbuffer'
import { SamplerStore } from '../resources/sampler'
import { defineProp, defineContext, defineThis } from './dynamic'
import type {
  Regl,
  InitializationArgs,
  ClearOptions,
  ReadOptions,
  BlitOptions,
  ReadPixelsToBufferOptions,
  GetBufferSubDataOptions,
  Buffer,
  DrawConfig,
  FramebufferCube,
  DefaultContext
} from '../types'

const CONTEXT_LOST_EVENT = 'webglcontextlost'
const CONTEXT_RESTORED_EVENT = 'webglcontextrestored'

function clock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

// requestAnimationFrame 的极简封装（包含非 DOM 环境回退）
const raf = {
  next(callback: (time: number) => void): number {
    if (typeof requestAnimationFrame === 'function') {
      return requestAnimationFrame(callback)
    }
    return setTimeout(() => callback(clock()), 16) as unknown as number
  },
  cancel(handle: number): void {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(handle)
    } else {
      clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
    }
  }
}

/**
 * 创建 regl 实例。
 *
 * 用法与 regl 完全一致：
 *   const regl = createREGL({ extensions: ['oes_texture_float'] })
 */
export function createREGL(args?: InitializationArgs): Regl {
  const config = parseArgs(args)
  if (!config) {
    // parseArgs 已经调用 onDone 报错；这里保持函数返回值语义
    return null as unknown as Regl
  }

  const gl = config.gl
  const glAttributes = gl.getContextAttributes() || {}
  let caps: Capabilities
  try {
    caps = new Capabilities(gl, {
      extensions: config.extensions,
      optionalExtensions: config.optionalExtensions
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    config.onDestroy()
    config.onDone(message)
    return null as unknown as Regl
  }
  const limits = buildLimits(gl, caps)
  const strings = new StringStore()
  const stats = newStats()
  const timer = createTimer(gl, caps)

  const START_TIME = clock()
  const WIDTH = gl.drawingBufferWidth
  const HEIGHT = gl.drawingBufferHeight

  const contextState: Record<string, unknown> & DefaultContext = {
    tick: 0,
    time: 0,
    viewportWidth: WIDTH,
    viewportHeight: HEIGHT,
    framebufferWidth: WIDTH,
    framebufferHeight: HEIGHT,
    drawingBufferWidth: WIDTH,
    drawingBufferHeight: HEIGHT,
    pixelRatio: config.pixelRatio
  }

  const state = new GLStateCache(gl, caps, limits.maxAttributes)

  // 先声明后赋值：BufferStore 的销毁回调需要访问 VAO 仓库
  let vaos: VertexArrayStore
  const buffers = new BufferStore({
    gl,
    maxAttributes: limits.maxAttributes,
    stats,
    onDestroy: (buffer) => {
      if (vaos) vaos.onBufferDestroy(buffer)
      // 关闭并遗忘可能仍然指向该 buffer 的 attribute 绑定
      state.forgetBuffer(buffer.handle)
      state.invalidateVertexArrays()
    }
  })
  const elements = new ElementsStore({
    gl,
    caps,
    buffers,
    stats
  })
  const shaders = new ShaderStore({
    gl,
    strings,
    stats,
    profile: config.profile
  })
  const textures = new TextureStore({
    gl,
    caps,
    limits,
    // copy 纹理只需要同步当前 framebuffer 的尺寸，不应推进 tick/time
    poll: () => pollTextureSize(),
    contextState,
    stats,
    profile: config.profile
  })
  const renderbuffers = new RenderbufferStore({
    gl,
    caps,
    limits,
    stats
  })
  const samplers = new SamplerStore({
    gl,
    caps,
    limits,
    stats,
    onDestroy: (handle) => state.forgetSampler(handle)
  })
  const framebuffers = new FramebufferStore({
    gl,
    caps,
    limits,
    textures,
    renderbuffers,
    stats
  })
  vaos = new VertexArrayStore({
    caps,
    buffers,
    elements,
    state,
    stats
  })

  const scope = new ScopeState()
  let batchCounter = 0

  let contextLost = gl.isContextLost()
  let destroyed = false

  const runtime: CommandRuntime = {
    gl,
    caps,
    limits,
    state,
    shaders,
    buffers,
    elements,
    textures,
    samplers,
    framebuffers,
    vaos,
    scope,
    context: contextState,
    profile: config.profile,
    timer,
    stats,
    contextLost,
    batchId: 0,
    currentFramebuffer: null,
    ensureUsable(): void {
      if (destroyed) raise('regl has been destroyed')
      if (contextLost) raise('context lost')
    },
    bindFramebuffer(fb: FramebufferInternal | null): void {
      state.bindFramebuffer(
        fb ? fb.handle : null,
        fb ? fb.colorAttachments.length : 0
      )
      runtime.currentFramebuffer = fb
      framebuffers.cur = fb
      framebuffers.next = fb
    }
  }

  // -------------------------------------------------------------------------
  // RAF / 时间
  // -------------------------------------------------------------------------
  const rafCallbacks: ((context: DefaultContext, props: null, batchId: number) => void)[] =
    []
  let activeRAF: number | null = null

  function now(): number {
    return (clock() - START_TIME) / 1000
  }

  function pollViewport(): void {
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    contextState.viewportWidth = width
    contextState.viewportHeight = height
    contextState.framebufferWidth = width
    contextState.framebufferHeight = height
    contextState.drawingBufferWidth = width
    contextState.drawingBufferHeight = height
  }

  /** 供 `texture({ copy: true })` 使用：只更新尺寸，不推进时间。 */
  function pollTextureSize(): void {
    const fb = runtime.currentFramebuffer
    const width = fb ? fb.width : gl.drawingBufferWidth
    const height = fb ? fb.height : gl.drawingBufferHeight
    contextState.viewportWidth = width
    contextState.viewportHeight = height
  }

  function poll(): void {
    contextState.tick += 1
    contextState.time = now()
    pollViewport()
    if (runtime.currentFramebuffer === null) {
      state.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    }
  }

  function refresh(): void {
    textures.refresh()
    state.unbindAllSamplers()
    state.invalidate()
    pollViewport()
    state.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    if (timer) timer.update()
  }

  function handleRAF(): void {
    if (rafCallbacks.length === 0) {
      if (timer) timer.update()
      activeRAF = null
      return
    }

    activeRAF = raf.next(handleRAF)
    poll()

    for (let i = rafCallbacks.length - 1; i >= 0; --i) {
      const callback = rafCallbacks[i]
      if (callback) {
        callback(contextState as DefaultContext, null, 0)
      }
    }

    gl.flush()
    if (timer) timer.update()
  }

  function startRAF(): void {
    if (activeRAF === null && rafCallbacks.length > 0) {
      activeRAF = raf.next(handleRAF)
    }
  }

  function stopRAF(): void {
    if (activeRAF !== null) {
      raf.cancel(activeRAF)
      activeRAF = null
    }
  }

  function frame(
    callback: (context: DefaultContext) => void
  ): { cancel(): void } {
    check(typeof callback === 'function', 'frame callback must be a function')
    rafCallbacks.push(callback as never)
    startRAF()

    let cancelled = false
    return {
      cancel(): void {
        check(!cancelled, 'cannot cancel a frame twice')
        cancelled = true
        const index = rafCallbacks.indexOf(callback as never)
        if (index >= 0) {
          rafCallbacks.splice(index, 1)
        }
        if (rafCallbacks.length === 0) {
          stopRAF()
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 事件
  // -------------------------------------------------------------------------
  const lossCallbacks: (() => void)[] = []
  const restoreCallbacks: (() => void)[] = []
  const destroyCallbacks: (() => void)[] = [config.onDestroy]

  function on(
    event: string,
    callback: () => void
  ): { cancel(): void } {
    check(typeof callback === 'function', 'listener callback must be a function')
    let callbacks: (() => void)[] = destroyCallbacks
    switch (event) {
      case 'frame':
        return frame(callback as unknown as (context: DefaultContext) => void)
      case 'lost':
        callbacks = lossCallbacks
        break
      case 'restore':
        callbacks = restoreCallbacks
        break
      case 'destroy':
        callbacks = destroyCallbacks
        break
      default:
        raise('invalid event, must be one of frame,lost,restore,destroy')
    }
    callbacks.push(callback)
    return {
      cancel(): void {
        const index = callbacks.indexOf(callback)
        if (index >= 0) callbacks.splice(index, 1)
      }
    }
  }

  function handleContextLoss(event: Event): void {
    event.preventDefault()
    contextLost = true
    runtime.contextLost = true
    samplers.lose()
    stopRAF()
    for (const callback of lossCallbacks) callback()
  }

  function handleContextRestored(): void {
    gl.getError()
    contextLost = false
    runtime.contextLost = false

    caps.restore()
    state.invalidate()
    runtime.currentFramebuffer = null
    framebuffers.cur = null
    framebuffers.next = null
    shaders.restore()
    buffers.restore()
    textures.restore()
    samplers.restore()
    renderbuffers.restore()
    framebuffers.restore()
    state.invalidate()
    vaos.restore()
    state.invalidate()

    if (timer) timer.restore()
    refresh()
    startRAF()

    for (const callback of restoreCallbacks) callback()
  }

  const canvas = config.canvas
  if (canvas && typeof canvas.addEventListener === 'function') {
    canvas.addEventListener(CONTEXT_LOST_EVENT, handleContextLoss, false)
    canvas.addEventListener(CONTEXT_RESTORED_EVENT, handleContextRestored, false)
  }

  // -------------------------------------------------------------------------
  // Framebuffer 作用域
  // -------------------------------------------------------------------------
  function bindFBO(value: unknown): FramebufferInternal | null {
    if (!value) return null
    if (isFramebufferCube(value)) {
      raise('can not bind a cube framebuffer directly, use one of its faces')
    }
    const fb = framebuffers.get(value)
    check(!!fb, 'invalid framebuffer object')
    return fb
  }

  function setFBO(
    options: { framebuffer: unknown },
    body: () => void
  ): void {
    const previous = runtime.currentFramebuffer
    const next = bindFBO(options.framebuffer)
    runtime.bindFramebuffer(next)
    const [w, h] = next
      ? [next.width, next.height]
      : [gl.drawingBufferWidth, gl.drawingBufferHeight]
    contextState.framebufferWidth = w
    contextState.framebufferHeight = h
    try {
      body()
    } finally {
      runtime.bindFramebuffer(previous)
      const [pw, ph] = previous
        ? [previous.width, previous.height]
        : [gl.drawingBufferWidth, gl.drawingBufferHeight]
      contextState.framebufferWidth = pw
      contextState.framebufferHeight = ph
    }
  }
  framebuffers.setFBO = setFBO as never

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------
  function clearImpl(options: ClearOptions): void {
    const color = options.color
    const hasColorAttachment = 'colorAttachment' in options

    if (hasColorAttachment) {
      check(caps.isWebGL2, 'colorAttachment clear requires WebGL2')
      const fb = runtime.currentFramebuffer
      check(!!fb, 'colorAttachment clear requires a framebuffer')
      const gl2 = gl as WebGL2RenderingContext
      const attachments = Array.isArray(options.colorAttachment)
        ? options.colorAttachment
        : [options.colorAttachment!]
      check(attachments.length > 0, 'empty colorAttachment list')
      for (const attachment of attachments) {
        check(
          attachment >= 0 && attachment < fb!.colorAttachments.length,
          'invalid color attachment index'
        )
        if (color) {
          gl2.clearBufferfv(GL.COLOR, attachment, [
            +color[0] || 0,
            +color[1] || 0,
            +color[2] || 0,
            +color[3] || 0
          ])
        }
      }

      if ('depth' in options || 'stencil' in options) {
        if ('depth' in options && 'stencil' in options) {
          gl2.clearBufferfi(
            GL.DEPTH_STENCIL,
            0,
            +options.depth!,
            options.stencil! | 0
          )
        } else if ('depth' in options) {
          gl2.clearBufferfv(GL.DEPTH, 0, [+options.depth!])
        } else {
          gl2.clearBufferiv(GL.STENCIL, 0, [options.stencil! | 0])
        }
      }
      check(
        !!color || 'depth' in options || 'stencil' in options,
        'called regl.clear with no buffer specified'
      )
      return
    }

    let flags = 0
    if (color) {
      gl.clearColor(+color[0] || 0, +color[1] || 0, +color[2] || 0, +color[3] || 0)
      flags |= GL.COLOR_BUFFER_BIT
    }
    if ('depth' in options) {
      gl.clearDepth(+options.depth!)
      flags |= GL.DEPTH_BUFFER_BIT
    }
    if ('stencil' in options) {
      gl.clearStencil(options.stencil! | 0)
      flags |= GL.STENCIL_BUFFER_BIT
    }

    check(!!flags, 'called regl.clear with no buffer specified')
    gl.clear(flags)
  }

  function clear(options: ClearOptions): void {
    check(
      typeof options === 'object' && !!options,
      'regl.clear() takes an object as input'
    )
    if ('framebuffer' in options) {
      const value = options.framebuffer
      if (value && isFramebufferCube(value)) {
        for (const face of (value as FramebufferCube).faces) {
          setFBO({ framebuffer: face }, () => clearImpl(options))
        }
      } else {
        setFBO({ framebuffer: value }, () => clearImpl(options))
      }
    } else {
      clearImpl(options)
    }
  }

  // -------------------------------------------------------------------------
  // read
  // -------------------------------------------------------------------------
  function readPixels(options?: ReadOptions | Uint8Array | Float32Array): unknown {
    const opts = isTypedArray(options) ? null : (options as ReadOptions | undefined)
    const explicitFramebuffer =
      opts && Object.prototype.hasOwnProperty.call(opts, 'framebuffer')

    if (explicitFramebuffer) {
      let result: unknown
      setFBO(
        { framebuffer: opts!.framebuffer },
        () => {
          result = readPixelsImpl(opts!)
        }
      )
      return result
    }
    return readPixelsImpl(options)
  }

  function readPixelsImpl(input?: ReadOptions | Uint8Array | Float32Array): unknown {
    pollViewport()
    const fb = runtime.currentFramebuffer
    const readOptions =
      input && !isTypedArray(input) ? (input as ReadOptions) : null
    const attachmentIndex = (readOptions?.colorAttachment || 0) | 0
    check(attachmentIndex >= 0, 'invalid color attachment for regl.read')
    let type: number
    if (!fb) {
      check(
        !!glAttributes.preserveDrawingBuffer,
        'you must create a webgl context with "preserveDrawingBuffer":true in order to read pixels from the drawing buffer'
      )
      check(attachmentIndex === 0, 'colorAttachment requires a framebuffer')
      type = GL.UNSIGNED_BYTE
    } else {
      const attachment = fb.colorAttachments[attachmentIndex]
      check(
        !!attachment && !!attachment.texture,
        'You cannot read from a renderbuffer or missing color attachment'
      )
      type = attachment.texture!._texture.flags.type
      if (type === GL.HALF_FLOAT || type === GL.HALF_FLOAT_OES) {
        // 半浮点读取在 WebGL 中不被支持，退化为 float 读取仅在驱动允许时可用
        raise('Reading from a half-float framebuffer is not supported')
      }
      check(
        type === GL.UNSIGNED_BYTE || type === GL.FLOAT,
        "Reading from a framebuffer is only allowed for the types 'uint8' and 'float'"
      )
      if (type === GL.FLOAT) {
        check(
          limits.readFloat,
          "Reading 'float' values is not permitted in your browser. For a fallback, please see: https://www.npmjs.com/package/glsl-read-float"
        )
      }
    }

    let x = 0
    let y = 0
    const fbWidth = fb ? fb.width : contextState.framebufferWidth
    const fbHeight = fb ? fb.height : contextState.framebufferHeight
    let width = fbWidth
    let height = fbHeight
    let data: Uint8Array | Float32Array | null = null
    let options: ReadOptions | null = null

    if (isTypedArray(input)) {
      data = input as Uint8Array
    } else if (input) {
      check(
        typeof input === 'object',
        'invalid arguments to regl.read()'
      )
      options = input as ReadOptions
      x = options.x! | 0
      y = options.y! | 0
      check(x >= 0 && x < fbWidth, 'invalid x offset for regl.read')
      check(y >= 0 && y < fbHeight, 'invalid y offset for regl.read')
      width = (options.width || fbWidth - x) | 0
      height = (options.height || fbHeight - y) | 0
      data = (options.data as Uint8Array) || null
    }

    if (data) {
      if (type === GL.UNSIGNED_BYTE) {
        check(
          data instanceof Uint8Array,
          "buffer must be 'Uint8Array' when reading from a framebuffer of type 'uint8'"
        )
      } else if (type === GL.FLOAT) {
        check(
          data instanceof Float32Array,
          "buffer must be 'Float32Array' when reading from a framebuffer of type 'float'"
        )
      }
    }

    check(
      width > 0 && width + x <= fbWidth,
      'invalid width for read pixels'
    )
    check(
      height > 0 && height + y <= fbHeight,
      'invalid height for read pixels'
    )

    const size = width * height * 4
    if (!data) {
      data =
        type === GL.UNSIGNED_BYTE
          ? new Uint8Array(size)
          : new Float32Array(size)
    }

    check(isTypedArray(data), 'data buffer for regl.read() must be a typedarray')
    check(
      (data as ArrayBufferView).byteLength >= size * (type === GL.FLOAT ? 4 : 1),
      'data buffer for regl.read() too small'
    )

    gl.pixelStorei(GL.PACK_ALIGNMENT, 4)
    // 普通 readPixels 不能有 PIXEL_PACK_BUFFER 绑定，否则会写入 PBO。
    if (caps.isWebGL2) {
      gl.bindBuffer(GL.PIXEL_PACK_BUFFER, null)
    }
    if (fb && attachmentIndex > 0) {
      check(caps.isWebGL2, 'colorAttachment read requires WebGL2')
      ;(gl as WebGL2RenderingContext).readBuffer(
        GL.COLOR_ATTACHMENT0 + attachmentIndex
      )
    }
    gl.readPixels(x, y, width, height, GL.RGBA, type, data as Uint8Array)
    if (fb && attachmentIndex > 0) {
      ;(gl as WebGL2RenderingContext).readBuffer(GL.COLOR_ATTACHMENT0)
    }
    void options
    return data
  }

  // -------------------------------------------------------------------------
  // PBO / buffer copy
  // -------------------------------------------------------------------------
  function readPixelsToBuffer(options: ReadPixelsToBufferOptions): Buffer {
    runtime.ensureUsable()
    check(caps.isWebGL2, 'readPixelsToBuffer requires WebGL2')
    const internal = getBuffer(options.pixelBuffer)
    check(!!internal && !!internal.handle, 'invalid pixel buffer')

    const run = (): void => {
      const fb = runtime.currentFramebuffer
      const attachmentIndex = (options.colorAttachment || 0) | 0
      check(attachmentIndex >= 0, 'invalid color attachment')
      let type: number = GL.UNSIGNED_BYTE
      if (!fb) {
        check(
          !!glAttributes.preserveDrawingBuffer,
          'you must create a webgl context with "preserveDrawingBuffer":true in order to read pixels from the drawing buffer'
        )
        check(attachmentIndex === 0, 'colorAttachment requires a framebuffer')
      } else {
        const attachment = fb.colorAttachments[attachmentIndex]
        check(!!attachment && !!attachment.texture, 'cannot read from renderbuffer')
        type = attachment.texture!._texture.flags.type
        check(
          type === GL.UNSIGNED_BYTE || type === GL.FLOAT,
          "reading from a framebuffer is only allowed for 'uint8' and 'float'"
        )
        if (type === GL.FLOAT) {
          check(limits.readFloat, 'reading float values is not permitted')
        }
      }

      const fbWidth = fb ? fb.width : contextState.framebufferWidth
      const fbHeight = fb ? fb.height : contextState.framebufferHeight
      const x = (options.x || 0) | 0
      const y = (options.y || 0) | 0
      const width = (options.width || fbWidth - x) | 0
      const height = (options.height || fbHeight - y) | 0
      const offset = (options.offset || 0) | 0
      check(
        x >= 0 && y >= 0 && width > 0 && height > 0 &&
          x + width <= fbWidth && y + height <= fbHeight,
        'invalid read rectangle'
      )
      check(offset >= 0, 'invalid PBO offset')
      const bytes = width * height * 4 * (type === GL.FLOAT ? 4 : 1)
      check(
        internal!.byteLength >= offset + bytes,
        'pixel buffer is too small for readPixels'
      )

      gl.bindBuffer(GL.PIXEL_PACK_BUFFER, internal!.handle)
      if (fb && attachmentIndex > 0) {
        ;(gl as WebGL2RenderingContext).readBuffer(
          GL.COLOR_ATTACHMENT0 + attachmentIndex
        )
      }
      ;(gl as WebGL2RenderingContext).readPixels(
        x,
        y,
        width,
        height,
        GL.RGBA,
        type,
        offset
      )
      if (fb && attachmentIndex > 0) {
        ;(gl as WebGL2RenderingContext).readBuffer(GL.COLOR_ATTACHMENT0)
      }
      gl.bindBuffer(GL.PIXEL_PACK_BUFFER, null)
    }

    if ('framebuffer' in options) {
      setFBO({ framebuffer: options.framebuffer }, run)
    } else {
      run()
    }
    return options.pixelBuffer
  }

  function readBuffer(
    buffer: Buffer,
    options: GetBufferSubDataOptions = {}
  ): Uint8Array {
    runtime.ensureUsable()
    check(caps.isWebGL2, 'readBuffer requires WebGL2')
    const internal = getBuffer(buffer)
    check(!!internal && !!internal.handle, 'invalid buffer')
    const offset = (options.offset || 0) | 0
    check(offset >= 0 && offset <= internal!.byteLength, 'invalid buffer offset')
    const length =
      options.length === undefined
        ? internal!.byteLength - offset
        : (options.length | 0)
    check(length >= 0 && offset + length <= internal!.byteLength, 'invalid buffer length')
    let data = options.data
    if (data) {
      check(data.byteLength >= length, 'data buffer is too small')
    } else {
      data = new Uint8Array(length)
    }
    gl.bindBuffer(internal!.bufferType, internal!.handle)
    ;(gl as WebGL2RenderingContext).getBufferSubData(
      internal!.bufferType,
      offset,
      data
    )
    gl.bindBuffer(internal!.bufferType, null)
    return data as Uint8Array
  }

  function copyBufferSubData(
    src: Buffer,
    dst: Buffer,
    srcOffset = 0,
    dstOffset = 0,
    size?: number
  ): void {
    runtime.ensureUsable()
    check(caps.isWebGL2, 'copyBufferSubData requires WebGL2')
    const source = getBuffer(src)
    const dest = getBuffer(dst)
    check(!!source && !!source.handle, 'invalid source buffer')
    check(!!dest && !!dest.handle, 'invalid destination buffer')
    srcOffset |= 0
    dstOffset |= 0
    const copySize =
      size === undefined
        ? Math.min(
            source!.byteLength - srcOffset,
            dest!.byteLength - dstOffset
          )
        : size | 0
    check(
      srcOffset >= 0 &&
        dstOffset >= 0 &&
        copySize >= 0 &&
        srcOffset + copySize <= source!.byteLength &&
        dstOffset + copySize <= dest!.byteLength,
      'invalid copyBufferSubData range'
    )
    const gl2 = gl as WebGL2RenderingContext
    gl.bindBuffer(GL.COPY_READ_BUFFER, source!.handle)
    gl.bindBuffer(GL.COPY_WRITE_BUFFER, dest!.handle)
    gl2.copyBufferSubData(
      GL.COPY_READ_BUFFER,
      GL.COPY_WRITE_BUFFER,
      srcOffset,
      dstOffset,
      copySize
    )
    gl.bindBuffer(GL.COPY_READ_BUFFER, null)
    gl.bindBuffer(GL.COPY_WRITE_BUFFER, null)
  }

  // -------------------------------------------------------------------------
  // Blit / MSAA resolve
  // -------------------------------------------------------------------------
  function blitFramebuffer(options: BlitOptions = {}): void {
    runtime.ensureUsable()
    check(caps.isWebGL2, 'blitFramebuffer requires WebGL2')

    const src = options.src ? framebuffers.get(options.src) : null
    const dst = options.dst ? framebuffers.get(options.dst) : null
    check(!!src || !!dst, 'blitFramebuffer requires a source or destination')

    const gl2 = gl as WebGL2RenderingContext
    const srcWidth = src ? src.width : gl.drawingBufferWidth
    const srcHeight = src ? src.height : gl.drawingBufferHeight
    const dstWidth = dst ? dst.width : gl.drawingBufferWidth
    const dstHeight = dst ? dst.height : gl.drawingBufferHeight

    const srcRect = normalizeBlitRect(
      options.srcRect,
      srcWidth,
      srcHeight,
      'src'
    )
    const dstRect = normalizeBlitRect(
      options.dstRect,
      dstWidth,
      dstHeight,
      'dst'
    )

    check(
      !(src && dst && src.handle === dst.handle),
      'cannot blit a framebuffer onto itself'
    )

    const maskValue = normalizeBlitMask(options.mask)
    const filterValue =
      src && src.samples > 1
        ? GL.NEAREST
        : options.filter === 'linear'
          ? GL.LINEAR
          : GL.NEAREST

    const previous = state.currentFramebuffer
    const colorAttachment = options.srcColorAttachment || 0
    if (src) {
      check(
        colorAttachment >= 0 &&
          colorAttachment < src.colorAttachments.length,
        'invalid source color attachment'
      )
      gl2.bindFramebuffer(GL.READ_FRAMEBUFFER, src.handle)
      gl2.readBuffer(GL.COLOR_ATTACHMENT0 + colorAttachment)
    } else {
      gl2.bindFramebuffer(GL.READ_FRAMEBUFFER, null)
    }
    gl2.bindFramebuffer(GL.DRAW_FRAMEBUFFER, dst ? dst.handle : null)

    gl2.blitFramebuffer(
      srcRect.x,
      srcRect.y,
      srcRect.x + srcRect.width,
      srcRect.y + srcRect.height,
      dstRect.x,
      dstRect.y,
      dstRect.x + dstRect.width,
      dstRect.y + dstRect.height,
      maskValue,
      filterValue
    )

    const error = gl.getError()
    gl.bindFramebuffer(GL.FRAMEBUFFER, previous)
    check(error === 0, `blitFramebuffer failed with GL error 0x${error.toString(16)}`)
  }

  function normalizeBlitRect(
    rect: BlitOptions['srcRect'],
    width: number,
    height: number,
    label: string
  ): { x: number; y: number; width: number; height: number } {
    const x = (rect?.x || 0) | 0
    const y = (rect?.y || 0) | 0
    const w = (rect?.width || width) | 0
    const h = (rect?.height || height) | 0
    check(
      x >= 0 && y >= 0 && w > 0 && h > 0 &&
        x + w <= width && y + h <= height,
      `invalid ${label} rect for blitFramebuffer`
    )
    return { x, y, width: w, height: h }
  }

  function normalizeBlitMask(mask: BlitOptions['mask']): number {
    const names = Array.isArray(mask) ? mask : mask ? [mask] : ['color']
    let value = 0
    for (const name of names) {
      if (name === 'color') value |= GL.COLOR_BUFFER_BIT
      else if (name === 'depth') value |= GL.DEPTH_BUFFER_BIT
      else if (name === 'stencil') value |= GL.STENCIL_BUFFER_BIT
      else raise(`invalid blitFramebuffer mask "${name}"`)
    }
    return value
  }

  // -------------------------------------------------------------------------
  // 命令入口
  // -------------------------------------------------------------------------
  const reglFunction = ((options: DrawConfig) =>
    compileCommand(
      runtime,
      options as unknown as Record<string, unknown>
    )) as unknown as Regl

  const regl = reglFunction

  // 资源方法
  const resourceAPI = {
    clear,
    prop: defineProp,
    context: defineContext,
    'this': defineThis,
    draw: compileCommand(runtime, {}),
    batch: (body: () => void) => {
      runtime.ensureUsable()
      const previous = runtime.batchId
      runtime.batchId = ++batchCounter
      try {
        body()
      } finally {
        runtime.batchId = previous
      }
    },
    scope: (config: DrawConfig, body: CommandBody) => {
      const command = compileCommand(
        runtime,
        config as unknown as Record<string, unknown>
      )
      command(body)
    },
    buffer: (options?: unknown) =>
      buffers.create(options as never, GL.ARRAY_BUFFER, false),
    pixelBuffer: (options?: unknown) => {
      if (!caps.isWebGL2) {
        raise('pixel buffers require WebGL2')
      }
      return buffers.create(options as never, GL.PIXEL_PACK_BUFFER, false)
    },
    elements: (options?: unknown) => elements.create(options as never),
    texture: (a?: unknown, b?: unknown) => textures.create2D(a, b),
    texture3D: (a?: unknown, b?: unknown, c?: unknown) => {
      if (!caps.isWebGL2) {
        raise('3D textures require WebGL2')
      }
      return textures.create3D(a as never, b as never, c as never)
    },
    texture2DArray: (a?: unknown, b?: unknown, c?: unknown) => {
      if (!caps.isWebGL2) {
        raise('2D array textures require WebGL2')
      }
      return textures.create2DArray(a as never, b as never, c as never)
    },
    cube: (
      a0?: unknown,
      a1?: unknown,
      a2?: unknown,
      a3?: unknown,
      a4?: unknown,
      a5?: unknown
    ) => textures.createCube(a0, a1, a2, a3, a4, a5),
    renderbuffer: (a?: unknown, b?: unknown) =>
      renderbuffers.create(a as never, b as never),
    framebuffer: (a?: unknown, b?: unknown) =>
      framebuffers.create(a as never, b as never),
    framebufferCube: (options?: unknown) =>
      framebuffers.createCube(options as never),
    vao: (options?: unknown) => vaos.create(options as never),
    sampler: (options?: unknown) => {
      if (!caps.isWebGL2) {
        raise('sampler objects require WebGL2')
      }
      return samplers.create(options as never)
    },
    uniformBuffer: (options?: unknown) => {
      if (!caps.isWebGL2) {
        raise('uniform buffers require WebGL2')
      }
      return createUniformBuffer(buffers, options as never)
    },
    attributes: glAttributes,
    frame,
    on,
    limits,
    hasExtension: (name: string) => caps.has(name),
    read: readPixels,
    readPixelsToBuffer,
    readBuffer,
    copyBufferSubData,
    blitFramebuffer: (options?: BlitOptions) => {
      if (!caps.isWebGL2) {
        raise('blitFramebuffer requires WebGL2')
      }
      blitFramebuffer(options)
    },
    destroy,
    _gl: gl,
    _refresh: refresh,
    poll: () => {
      poll()
      if (timer) timer.update()
    },
    now,
    stats
  }

  Object.assign(regl, resourceAPI)
  // frame/on 的返回值与 regl 类型一致
  ;(regl as unknown as { draw: () => void }).draw = resourceAPI.draw as unknown as () => void

  // profile 统计方法
  if (config.profile) {
    stats.getTotalBufferSize = () => {
      let total = 0
      for (const buffer of buffers.all()) total += buffer.stats.size
      return total
    }
    stats.getTotalTextureSize = () => textures.totalSize()
    stats.getTotalRenderbufferSize = () => renderbuffers.totalSize()
    stats.getMaxUniformsCount = () => shaders.getMaxUniformsCount()
    stats.getMaxAttributesCount = () => shaders.getMaxAttributesCount()
  }

  // -------------------------------------------------------------------------
  // 销毁
  // -------------------------------------------------------------------------
  function destroy(): void {
    if (destroyed) return
    destroyed = true
    rafCallbacks.length = 0
    stopRAF()

    if (canvas && typeof canvas.removeEventListener === 'function') {
      canvas.removeEventListener(CONTEXT_LOST_EVENT, handleContextLoss)
      canvas.removeEventListener(CONTEXT_RESTORED_EVENT, handleContextRestored)
    }

    framebuffers.clear()
    vaos.clear()
    renderbuffers.clear()
    samplers.clear()
    textures.clear()
    elements.clear()
    buffers.clear()
    shaders.clear()
    if (timer) timer.clear()

    for (const callback of destroyCallbacks) callback()
    destroyCallbacks.length = 0
  }

  // 初始化：同步一次状态
  refresh()

  config.onDone(null, regl)

  return regl
}
