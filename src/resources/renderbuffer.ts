/**
 * Renderbuffer 资源（离屏渲染用的非纹理附件）。
 *
 * 支持 WebGL1 的核心格式 + 常用扩展格式，以及 WebGL2 的 sized 格式。
 * 所有格式都集中在 `buildRenderbufferFormats` 中生成，便于按上下文裁剪。
 */

import { check, checkParameter, checkType } from '../util/check'
import { GL } from '../util/constants'
import type { Capabilities, GLContext } from '../core/capabilities'
import type { Limits } from '../core/limits'

export interface RenderbufferFormatInfo {
  name: string
  format: number
  /** 每像素字节数，用于统计。 */
  bytesPerPixel: number
  depth?: boolean
  stencil?: boolean
  color?: boolean
  webgl2?: boolean
}

const RGBA8 = 0x8058
const RGB8 = 0x8051
const SRGB8_ALPHA8 = 0x8c43
const R8 = 0x8229
const RG8 = 0x822b
const R16F = 0x822d
const RG16F = 0x822f
const RGBA16F = 0x881a
const RGB16F = 0x881b
const R32F = 0x822e
const RG32F = 0x8230
const RGBA32F = 0x8814
const DEPTH_COMPONENT16 = 0x81a5
const DEPTH_COMPONENT24 = 0x81a6
const DEPTH_COMPONENT32F = 0x8cac
const DEPTH24_STENCIL8 = 0x88f0
const STENCIL_INDEX8 = 0x8d48

export function buildRenderbufferFormats(
  caps: Capabilities
): Map<string, RenderbufferFormatInfo> {
  const formats = new Map<string, RenderbufferFormatInfo>()
  const add = (info: RenderbufferFormatInfo): void => {
    if (info.webgl2 && !caps.isWebGL2) return
    formats.set(info.name, info)
  }

  add({ name: 'rgba4', format: GL.RGBA4, bytesPerPixel: 2, color: true })
  add({ name: 'rgb565', format: GL.RGB565, bytesPerPixel: 2, color: true })
  add({ name: 'rgb5 a1', format: GL.RGB5_A1, bytesPerPixel: 2, color: true })
  add({ name: 'depth', format: DEPTH_COMPONENT16, bytesPerPixel: 2, depth: true })
  add({ name: 'stencil', format: STENCIL_INDEX8, bytesPerPixel: 1, stencil: true })
  add({
    name: 'depth stencil',
    format: GL.DEPTH_STENCIL,
    bytesPerPixel: 4,
    depth: true,
    stencil: true
  })

  if (caps.isWebGL2 || caps.has('ext_srgb')) {
    add({
      name: 'srgba',
      format: caps.isWebGL2 ? SRGB8_ALPHA8 : 0x8c43,
      bytesPerPixel: 4,
      color: true
    })
  }

  // 浮点颜色缓冲
  const canHalfFloat =
    caps.has('ext_color_buffer_half_float') ||
    (caps.isWebGL2 && caps.has('ext_color_buffer_float'))
  if (canHalfFloat) {
    add({ name: 'rgba16f', format: RGBA16F, bytesPerPixel: 8, color: true })
    add({ name: 'rgb16f', format: RGB16F, bytesPerPixel: 6, color: true })
    if (caps.isWebGL2) {
      add({ name: 'r16f', format: R16F, bytesPerPixel: 2, color: true, webgl2: true })
      add({ name: 'rg16f', format: RG16F, bytesPerPixel: 4, color: true, webgl2: true })
    }
  }

  const canFloat =
    caps.has('webgl_color_buffer_float') ||
    caps.has('ext_color_buffer_float')
  if (canFloat) {
    add({ name: 'rgba32f', format: RGBA32F, bytesPerPixel: 16, color: true })
    if (caps.isWebGL2) {
      add({ name: 'r32f', format: R32F, bytesPerPixel: 4, color: true, webgl2: true })
      add({ name: 'rg32f', format: RG32F, bytesPerPixel: 8, color: true, webgl2: true })
    }
  }

  if (caps.isWebGL2) {
    add({ name: 'rgba8', format: RGBA8, bytesPerPixel: 4, color: true, webgl2: true })
    add({ name: 'rgb8', format: RGB8, bytesPerPixel: 3, color: true, webgl2: true })
    add({ name: 'r8', format: R8, bytesPerPixel: 1, color: true, webgl2: true })
    add({ name: 'rg8', format: RG8, bytesPerPixel: 2, color: true, webgl2: true })
    add({ name: 'rgba16f', format: RGBA16F, bytesPerPixel: 8, color: true, webgl2: true })
    add({ name: 'rgba32f', format: RGBA32F, bytesPerPixel: 16, color: true, webgl2: true })
    add({ name: 'depth16', format: DEPTH_COMPONENT16, bytesPerPixel: 2, depth: true, webgl2: true })
    add({ name: 'depth24', format: DEPTH_COMPONENT24, bytesPerPixel: 4, depth: true, webgl2: true })
    add({ name: 'depth32f', format: DEPTH_COMPONENT32F, bytesPerPixel: 4, depth: true, webgl2: true })
    add({
      name: 'depth24 stencil8',
      format: DEPTH24_STENCIL8,
      bytesPerPixel: 4,
      depth: true,
      stencil: true,
      webgl2: true
    })
  }

  return formats
}

/** 内部表示。 */
export class RenderbufferInternal {
  id: number
  handle: WebGLRenderbuffer | null
  refCount = 1
  format: number = GL.RGBA4
  formatName = 'rgba4'
  width = 0
  height = 0
  /** 0 表示普通 renderbuffer；>0 表示 multisample。 */
  samples = 0
  stats = { size: 0 }

  constructor(id: number, gl: GLContext) {
    this.id = id
    this.handle = gl.createRenderbuffer()
  }
}

export interface RenderbufferStoreOptions {
  gl: GLContext
  caps: Capabilities
  limits: Limits
  stats: { renderbufferCount: number }
}

export class RenderbufferStore {
  readonly gl: GLContext
  readonly caps: Capabilities
  readonly limits: Limits
  readonly formats: Map<string, RenderbufferFormatInfo>
  private readonly stats: { renderbufferCount: number }
  private count = 0
  private readonly set = new Map<number, RenderbufferInternal>()

  constructor(options: RenderbufferStoreOptions) {
    this.gl = options.gl
    this.caps = options.caps
    this.limits = options.limits
    this.stats = options.stats
    this.formats = buildRenderbufferFormats(options.caps)
  }

  create(
    a?: RenderbufferOptions | number | null,
    b?: number
  ): RenderbufferWrapper {
    const renderbuffer = new RenderbufferInternal(this.count++, this.gl)
    this.set.set(renderbuffer.id, renderbuffer)
    this.stats.renderbufferCount++

    const update = (input?: RenderbufferOptions | number | null, height?: number) => {
      this.upload(renderbuffer, input, height)
      return wrapper
    }
    const wrapper = createRenderbufferWrapper(renderbuffer, update, this)
    this.upload(renderbuffer, a, b)
    wrapper.width = renderbuffer.width
    wrapper.height = renderbuffer.height
    wrapper.format = renderbuffer.formatName
    wrapper.samples = renderbuffer.samples
    return wrapper
  }

  private upload(
    renderbuffer: RenderbufferInternal,
    a?: RenderbufferOptions | number | null,
    b?: number
  ): void {
    let width = 0
    let height = 0
    let format = this.formats.get('rgba4')!
    let samples = 0

    if (typeof a === 'object' && a) {
      const options = a as RenderbufferOptions
      if ('shape' in options) {
        const shape = options.shape!
        check(Array.isArray(shape) && shape.length >= 2, 'invalid renderbuffer shape')
        width = shape[0] | 0
        height = shape[1] | 0
      } else {
        if ('radius' in options) width = height = options.radius as number
        if ('width' in options) width = options.width as number
        if ('height' in options) height = options.height as number
      }
      if ('format' in options) {
        checkParameter(options.format, Object.fromEntries(this.formats), 'invalid renderbuffer format')
        format = this.formats.get(options.format!)!
      }
      if ('samples' in options) {
        samples = (options.samples as number) | 0
      }
    } else if (typeof a === 'number') {
      width = a | 0
      height = typeof b === 'number' ? b | 0 : width
    } else if (!a) {
      width = height = 1
    } else {
      throw new Error('(regl) invalid arguments to renderbuffer constructor')
    }

    check(
      width > 0 &&
        height > 0 &&
        width <= this.limits.maxRenderbufferSize &&
        height <= this.limits.maxRenderbufferSize,
      'invalid renderbuffer size'
    )
    check(
      samples === 0 ||
        (this.caps.isWebGL2 &&
          samples >= 1 &&
          samples <= this.limits.maxSamples),
      'invalid renderbuffer samples'
    )

    if (
      width === renderbuffer.width &&
      height === renderbuffer.height &&
      format.format === renderbuffer.format &&
      samples === renderbuffer.samples
    ) {
      return
    }

    renderbuffer.width = width
    renderbuffer.height = height
    renderbuffer.format = format.format
    renderbuffer.formatName = format.name
    renderbuffer.samples = samples

    this.gl.bindRenderbuffer(GL.RENDERBUFFER, renderbuffer.handle)
    this.storeStorage(renderbuffer)
    const error = this.gl.getError()
    check(error === 0, `invalid render buffer format (${format.name})`)

    renderbuffer.stats.size = format.bytesPerPixel * width * height * (samples || 1)
  }

  private storeStorage(renderbuffer: RenderbufferInternal): void {
    if (renderbuffer.samples > 0) {
      ;(this.gl as WebGL2RenderingContext).renderbufferStorageMultisample(
        GL.RENDERBUFFER,
        renderbuffer.samples,
        renderbuffer.format,
        renderbuffer.width,
        renderbuffer.height
      )
    } else {
      this.gl.renderbufferStorage(
        GL.RENDERBUFFER,
        renderbuffer.format,
        renderbuffer.width,
        renderbuffer.height
      )
    }
  }

  resize(renderbuffer: RenderbufferInternal, width: number, height = width): void {
    width |= 0
    height = (height | 0) || width
    check(
      width > 0 &&
        height > 0 &&
        width <= this.limits.maxRenderbufferSize &&
        height <= this.limits.maxRenderbufferSize,
      'invalid renderbuffer size'
    )
    if (width === renderbuffer.width && height === renderbuffer.height) return
    renderbuffer.width = width
    renderbuffer.height = height
    this.gl.bindRenderbuffer(GL.RENDERBUFFER, renderbuffer.handle)
    this.storeStorage(renderbuffer)
    const info = this.formats.get(renderbuffer.formatName)
    renderbuffer.stats.size =
      (info?.bytesPerPixel || 4) * width * height * (renderbuffer.samples || 1)
  }

  decRef(renderbuffer: RenderbufferInternal): void {
    if (--renderbuffer.refCount > 0) return
    this.destroy(renderbuffer)
  }

  destroy(renderbuffer: RenderbufferInternal): void {
    check(!!renderbuffer.handle, 'must not double destroy renderbuffer')
    this.gl.bindRenderbuffer(GL.RENDERBUFFER, null)
    this.gl.deleteRenderbuffer(renderbuffer.handle)
    renderbuffer.handle = null
    renderbuffer.refCount = 0
    this.set.delete(renderbuffer.id)
    this.stats.renderbufferCount--
  }

  get(value: unknown): RenderbufferInternal | null {
    if (
      typeof value === 'function' &&
      (value as unknown as { _reglType?: string })._reglType === 'renderbuffer'
    ) {
      const internal = (value as unknown as { _renderbuffer?: RenderbufferInternal })
        ._renderbuffer
      return internal instanceof RenderbufferInternal ? internal : null
    }
    return null
  }

  clear(): void {
    for (const rb of Array.from(this.set.values())) {
      rb.refCount = 1
      this.destroy(rb)
    }
    this.set.clear()
    this.stats.renderbufferCount = 0
  }

  restore(): void {
    for (const rb of this.set.values()) {
      rb.handle = this.gl.createRenderbuffer()
      this.gl.bindRenderbuffer(GL.RENDERBUFFER, rb.handle)
      this.storeStorage(rb)
    }
    this.gl.bindRenderbuffer(GL.RENDERBUFFER, null)
  }

  /** 根据 GL 格式判断是否是深度/模板格式。 */
  infoForFormat(format: number): RenderbufferFormatInfo | undefined {
    for (const info of this.formats.values()) {
      if (info.format === format) return info
    }
    return undefined
  }

  /** 所有 renderbuffer 占用显存估算（字节）。 */
  totalSize(): number {
    let total = 0
    for (const rb of this.set.values()) {
      total += rb.stats.size
    }
    return total
  }
}

export interface RenderbufferOptions {
  shape?: [number, number]
  radius?: number
  width?: number
  height?: number
  format?: string
  /** WebGL2 multisample 数量；0 / 省略表示普通 renderbuffer。 */
  samples?: number
}

export interface RenderbufferWrapper {
  (a?: RenderbufferOptions | number | null, b?: number): RenderbufferWrapper
  _reglType: 'renderbuffer'
  _renderbuffer: RenderbufferInternal
  width: number
  height: number
  format: string
  samples: number
  resize(width: number, height?: number): RenderbufferWrapper
  destroy(): void
  stats: { size: number }
}

function createRenderbufferWrapper(
  renderbuffer: RenderbufferInternal,
  update: (a?: RenderbufferOptions | number | null, b?: number) => RenderbufferWrapper,
  store: RenderbufferStore
): RenderbufferWrapper {
  const wrapper = ((a?: RenderbufferOptions | number | null, b?: number) => {
    update(a, b)
    wrapper.width = renderbuffer.width
    wrapper.height = renderbuffer.height
    wrapper.format = renderbuffer.formatName
    wrapper.samples = renderbuffer.samples
    return wrapper
  }) as RenderbufferWrapper

  wrapper._reglType = 'renderbuffer'
  wrapper._renderbuffer = renderbuffer
  wrapper.stats = renderbuffer.stats
  wrapper.width = renderbuffer.width
  wrapper.height = renderbuffer.height
  wrapper.format = renderbuffer.formatName
  wrapper.samples = renderbuffer.samples
  wrapper.resize = (width: number, height?: number) => {
    store.resize(renderbuffer, width, height)
    wrapper.width = renderbuffer.width
    wrapper.height = renderbuffer.height
    wrapper.samples = renderbuffer.samples
    return wrapper
  }
  wrapper.destroy = () => {
    store.decRef(renderbuffer)
  }
  return wrapper
}

/** 判断是否是 renderbuffer 资源。 */
export function isRenderbuffer(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as { _reglType?: string })._reglType === 'renderbuffer'
  )
}

// 避免未使用告警
void checkType
