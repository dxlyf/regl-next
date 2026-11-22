/**
 * Framebuffer（离屏渲染目标）。
 *
 * 支持：
 * - 颜色附件：纹理 / renderbuffer / 立方体贴图面；
 * - 深度、模板、深度模板附件；
 * - 多渲染目标（WebGL2 原生 / WebGL1 的 WEBGL_draw_buffers）；
 * - 立方体帧缓冲（每个面一个 2D FBO，共享深度附件）；
 * - resize / use(cb) 等 regl 惯用接口。
 *
 * 改进点：
 * - 附件格式校验通过能力表完成，WebGL2 下不再错误地要求 WEBGL_draw_buffers；
 * - 对附件引用计数的管理更严格（用户显式传入的附件与内部创建的附件区分清楚）；
 * - 状态恢复时统一重建 handle。
 */

import {
  check,
  checkOneOf,
  checkType,
  isTypedArray
} from '../util/check'
import { GL } from '../util/constants'
import type { Capabilities, GLContext } from '../core/capabilities'
import type { Limits } from '../core/limits'
import type { TextureStore, TextureInternal, Texture2DOptions } from './texture'
import {
  isTexture2D,
  isTextureCube,
  isTexture3D,
  isTexture2DArray
} from './texture'
import type {
  RenderbufferStore,
  RenderbufferInternal,
  RenderbufferOptions
} from './renderbuffer'
import { isRenderbuffer } from './renderbuffer'
import type { FramebufferColorFormat } from '../types'

type AttachmentTexture = {
  texture:
    | import('./texture').Texture2DWrapper
    | import('./texture').TextureCubeWrapper
    | import('./texture').Texture3DWrapper
    | import('./texture').Texture2DArrayWrapper
  renderbuffer: null
  target: number
  /** 3D / 2D array 的层号；普通 2D/cube 为 0。 */
  layer?: number
  /** 0 表示普通附件；>0 表示 multisample renderbuffer。 */
  samples?: number
  width: number
  height: number
}
type AttachmentRenderbuffer = {
  texture: null
  renderbuffer: import('./renderbuffer').RenderbufferWrapper
  target: number
  layer?: number
  samples?: number
  width: number
  height: number
}
type Attachment = AttachmentTexture | AttachmentRenderbuffer

export interface FramebufferInternal {
  id: number
  handle: WebGLFramebuffer | null
  width: number
  height: number
  /** 0 表示普通 framebuffer；>0 表示 multisample framebuffer。 */
  samples: number
  colorAttachments: Attachment[]
  depthAttachment: Attachment | null
  stencilAttachment: Attachment | null
  depthStencilAttachment: Attachment | null
  stats?: { size: number }
}

export interface FramebufferStoreOptions {
  gl: GLContext
  caps: Capabilities
  limits: Limits
  textures: TextureStore
  renderbuffers: RenderbufferStore
  stats: { framebufferCount: number }
}

const statusCode: Record<number, string> = {
  [GL.FRAMEBUFFER_COMPLETE]: 'complete',
  [GL.FRAMEBUFFER_INCOMPLETE_ATTACHMENT]: 'incomplete attachment',
  [GL.FRAMEBUFFER_INCOMPLETE_DIMENSIONS]: 'incomplete dimensions',
  [GL.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT]: 'incomplete, missing attachment',
  [GL.FRAMEBUFFER_UNSUPPORTED]: 'unsupported'
}

export class FramebufferStore {
  readonly gl: GLContext
  readonly caps: Capabilities
  readonly limits: Limits
  readonly textures: TextureStore
  readonly renderbuffers: RenderbufferStore
  private readonly stats: { framebufferCount: number }

  private count = 0
  private readonly set = new Map<number, FramebufferInternal>()

  /** 当前绑定的 framebuffer（由命令层写入，read() 等接口会用到）。 */
  cur: FramebufferInternal | null = null
  next: FramebufferInternal | null = null
  /** 用户可覆盖：由 regl 核心注入的 setFBO 命令。 */
  setFBO: ((options: { framebuffer: unknown }, body: () => void) => void) | null =
    null

  constructor(options: FramebufferStoreOptions) {
    this.gl = options.gl
    this.caps = options.caps
    this.limits = options.limits
    this.textures = options.textures
    this.renderbuffers = options.renderbuffers
    this.stats = options.stats
  }

  // -------------------------------------------------------------------------
  // 创建
  // -------------------------------------------------------------------------

  create(a0?: FramebufferOptions | number | null, a1?: number): FramebufferWrapper {
    const framebuffer: FramebufferInternal = {
      id: this.count++,
      handle: this.gl.createFramebuffer(),
      width: 0,
      height: 0,
      samples: 0,
      colorAttachments: [],
      depthAttachment: null,
      stencilAttachment: null,
      depthStencilAttachment: null
    }
    this.set.set(framebuffer.id, framebuffer)
    this.stats.framebufferCount++

    const update = (a?: FramebufferOptions | number | null, b?: number) => {
      this.update(framebuffer, a, b)
      return wrapper
    }
    const wrapper = createFramebufferWrapper(framebuffer, update, this)
    this.update(framebuffer, a0, a1)
    return wrapper
  }

  private update(
    framebuffer: FramebufferInternal,
    a0?: FramebufferOptions | number | null,
    a1?: number
  ): void {
    check(
      this.next !== framebuffer,
      'can not update framebuffer which is currently in use'
    )

    let width = 0
    let height = 0

    let needsDepth = true
    let needsStencil = true

    let colorBuffer: unknown = null
    let colorTexture = true
    let colorFormat = 'rgba'
    let colorType = 'uint8'
    let colorCount = 1

    let depthBuffer: unknown = null
    let stencilBuffer: unknown = null
    let depthStencilBuffer: unknown = null
    let depthStencilTexture = false
    let samples = 0

    if (typeof a0 === 'number') {
      width = a0 | 0
      height = ((a1 || 0) | 0) || width
    } else if (!a0) {
      width = height = 1
    } else {
      checkType(a0, 'object', 'invalid arguments for framebuffer')
      const options = a0 as FramebufferOptions
      if ('shape' in options) {
        const shape = options.shape!
        check(Array.isArray(shape) && shape.length >= 2, 'invalid shape for framebuffer')
        width = shape[0] | 0
        height = shape[1] | 0
      } else {
        if ('radius' in options) width = height = options.radius as number
        if ('width' in options) width = options.width as number
        if ('height' in options) height = options.height as number
      }

      if ('color' in options || 'colors' in options) {
        colorBuffer = options.color ?? options.colors
        if (Array.isArray(colorBuffer)) {
          check(
            colorBuffer.length === 1 || this.caps.hasDrawBuffers,
            'multiple render targets not supported'
          )
        }
      }
      if ('samples' in options) {
        samples = (options.samples as number) | 0
      }

      if (!colorBuffer) {
        if ('colorCount' in options) {
          colorCount = options.colorCount! | 0
          check(colorCount > 0, 'invalid color buffer count')
        }
        if ('colorTexture' in options) {
          colorTexture = !!options.colorTexture
          colorFormat = 'rgba4'
        }
        if ('colorType' in options) {
          colorType = options.colorType!
          if (!colorTexture) {
            if (colorType === 'half float' || colorType === 'float16') {
              check(
                this.caps.has('ext_color_buffer_half_float') ||
                  this.caps.has('ext_color_buffer_float'),
                'you must enable EXT_color_buffer_half_float to use 16-bit render buffers'
              )
              colorFormat = 'rgba16f'
            } else if (colorType === 'float' || colorType === 'float32') {
              check(
                this.caps.has('webgl_color_buffer_float') ||
                  this.caps.has('ext_color_buffer_float'),
                'you must enable WEBGL_color_buffer_float in order to use 32-bit floating point renderbuffers'
              )
              colorFormat = 'rgba32f'
            }
          } else {
            check(
              this.caps.isWebGL2 ||
                this.caps.has('oes_texture_float') ||
                (colorType !== 'float' && colorType !== 'float32'),
              'you must enable OES_texture_float in order to use floating point framebuffer objects'
            )
            check(
              this.caps.isWebGL2 ||
                this.caps.has('oes_texture_half_float') ||
                (colorType !== 'half float' && colorType !== 'float16'),
              'you must enable OES_texture_half_float in order to use floating point framebuffer objects'
            )
          }
          checkOneOf(
            colorType,
            ['uint8', 'half float', 'float16', 'float', 'float32'],
            'invalid color type'
          )
        }
        if ('colorFormat' in options) {
          colorFormat = options.colorFormat!
          // 与旧版 regl 一致：'rgba' 是纹理颜色附件；其余已知格式优先使用
          // renderbuffer（例如 rgba4 / rgb565 / rgba16f）。
          if (colorFormat === 'rgba' && this.textures.formatInfo('rgba')) {
            colorTexture = true
          } else if (this.renderbuffers.formats.has(colorFormat)) {
            colorTexture = false
          } else if (this.textures.formatInfo(colorFormat)) {
            colorTexture = true
          } else {
            throw new Error(`(regl) invalid color format "${colorFormat}"`)
          }
        }
      }

      if ('depthTexture' in options || 'depthStencilTexture' in options) {
        depthStencilTexture = !!(
          options.depthTexture || options.depthStencilTexture
        )
        check(
          this.caps.isWebGL2 || this.caps.has('webgl_depth_texture'),
          'webgl_depth_texture extension not supported'
        )
      }

      if ('depth' in options) {
        if (typeof options.depth === 'boolean') {
          needsDepth = options.depth
        } else {
          depthBuffer = options.depth
          needsStencil = false
        }
      }
      if ('stencil' in options) {
        if (typeof options.stencil === 'boolean') {
          needsStencil = options.stencil
        } else {
          stencilBuffer = options.stencil
          needsDepth = false
        }
      }
      if ('depthStencil' in options) {
        if (typeof options.depthStencil === 'boolean') {
          needsDepth = needsStencil = options.depthStencil
        } else {
          depthStencilBuffer = options.depthStencil
          needsDepth = false
          needsStencil = false
        }
      }
    }

    check(
      samples === 0 ||
        (this.caps.isWebGL2 &&
          samples >= 1 &&
          samples <= this.limits.maxSamples),
      'invalid framebuffer samples'
    )

    let colorAttachments: Attachment[]
    if (Array.isArray(colorBuffer)) {
      colorAttachments = colorBuffer.map((attachment) =>
        this.parseAttachment(attachment)
      )
    } else if (colorBuffer) {
      colorAttachments = [this.parseAttachment(colorBuffer)]
    } else {
      colorAttachments = []
      for (let i = 0; i < colorCount; ++i) {
        colorAttachments.push(
          this.allocAttachment(
            width,
            height,
            colorTexture,
            colorFormat,
            colorType,
            samples
          )
        )
      }
    }

    check(
      this.caps.hasDrawBuffers || colorAttachments.length <= 1,
      'you must enable the WEBGL_draw_buffers extension in order to use multiple color buffers.'
    )
    check(
      colorAttachments.length <= this.limits.maxColorAttachments,
      'too many color attachments, not supported'
    )

    width = width || colorAttachments[0]?.width || 1
    height = height || colorAttachments[0]?.height || 1
    if (samples === 0) {
      samples = colorAttachments[0]?.samples || 0
    }

    let depthAttachment: Attachment | null = null
    let stencilAttachment: Attachment | null = null
    let depthStencilAttachment: Attachment | null = null

    if (depthBuffer) {
      depthAttachment = this.parseAttachment(depthBuffer)
    } else if (needsDepth && !needsStencil) {
      depthAttachment = this.allocAttachment(
        width,
        height,
        depthStencilTexture,
        'depth',
        'uint32',
        samples
      )
    }

    if (stencilBuffer) {
      stencilAttachment = this.parseAttachment(stencilBuffer)
    } else if (needsStencil && !needsDepth) {
      stencilAttachment = this.allocAttachment(
        width,
        height,
        false,
        'stencil',
        'uint8',
        samples
      )
    }

    if (depthStencilBuffer) {
      depthStencilAttachment = this.parseAttachment(depthStencilBuffer)
    } else if (!depthBuffer && !stencilBuffer && needsStencil && needsDepth) {
      depthStencilAttachment = this.allocAttachment(
        width,
        height,
        depthStencilTexture,
        'depth stencil',
        'depth stencil',
        samples
      )
    }

    check(
      (depthBuffer ? 1 : 0) +
        (stencilBuffer ? 1 : 0) +
        (depthStencilBuffer ? 1 : 0) <=
        1,
      'invalid framebuffer configuration, can specify exactly one depth/stencil attachment'
    )

    if (samples === 0) {
      samples =
        depthAttachment?.samples ||
        stencilAttachment?.samples ||
        depthStencilAttachment?.samples ||
        0
    }
    for (const attachment of colorAttachments) {
      check(
        (attachment.samples || 0) === samples,
        'all framebuffer attachments must have the same sample count'
      )
    }
    for (const attachment of [
      depthAttachment,
      stencilAttachment,
      depthStencilAttachment
    ]) {
      if (attachment) {
        check(
          (attachment.samples || 0) === samples,
          'all framebuffer attachments must have the same sample count'
        )
      }
    }

    // 校验附件形状与格式
    let commonColorBpp = -1
    for (let i = 0; i < colorAttachments.length; ++i) {
      const attachment = colorAttachments[i]
      this.incRefAndCheckShape(attachment, width, height)
      check(
        !!attachment &&
          ((attachment.texture &&
            this.isColorTexture(attachment.texture._texture)) ||
            (attachment.renderbuffer &&
              this.isColorRenderbuffer(attachment.renderbuffer._renderbuffer))),
        `framebuffer color attachment ${i} is invalid`
      )
      if (attachment.texture) {
        const bpp = this.textureBpp(attachment.texture._texture)
        if (!this.caps.isWebGL2) {
          if (commonColorBpp < 0) {
            commonColorBpp = bpp
          } else {
            check(
              commonColorBpp === bpp,
              'all color attachments much have the same number of bits per pixel.'
            )
          }
        }
      }
    }

    this.checkDepthAttachment(depthAttachment, width, height, 'depth')
    this.checkStencilAttachment(stencilAttachment, width, height)
    this.checkDepthStencilAttachment(depthStencilAttachment, width, height)

    // 释放旧附件引用
    this.decRefs(framebuffer)

    framebuffer.width = width
    framebuffer.height = height
    framebuffer.width = width
    framebuffer.height = height
    framebuffer.samples = samples
    framebuffer.colorAttachments = colorAttachments
    framebuffer.depthAttachment = depthAttachment
    framebuffer.stencilAttachment = stencilAttachment
    framebuffer.depthStencilAttachment = depthStencilAttachment

    const wrapper = this.wrapperFor(framebuffer)
    if (wrapper) {
      wrapper.color = colorAttachments.map((a) => a.texture || a.renderbuffer)
      wrapper.depth = depthAttachment?.texture || depthAttachment?.renderbuffer || null
      wrapper.stencil =
        stencilAttachment?.texture || stencilAttachment?.renderbuffer || null
      wrapper.depthStencil =
        depthStencilAttachment?.texture ||
        depthStencilAttachment?.renderbuffer ||
        null
      wrapper.width = width
      wrapper.height = height
      wrapper.samples = samples
    }

    this.updateHandle(framebuffer)
  }

  // -------------------------------------------------------------------------
  // 附件
  // -------------------------------------------------------------------------

  private parseAttachment(input: unknown): Attachment {
    let target: number = GL.TEXTURE_2D
    let data = input
    let layer = 0
    if (input && typeof input === 'object' && 'texture' in (input as object)) {
      const desc = input as {
        texture: unknown
        layer?: number
        target?: number
      }
      data = desc.texture
      layer = (desc.layer as number) | 0
      if ('target' in desc) target = desc.target! | 0
    } else if (
      input &&
      typeof input === 'object' &&
      'data' in (input as object)
    ) {
      const desc = input as { data: unknown; target?: number; layer?: number }
      data = desc.data
      layer = (desc.layer as number) | 0
      if ('target' in desc) target = desc.target! | 0
    }

    checkType(data, 'function', 'invalid attachment data')
    if (isTexture2D(data)) {
      return {
        texture: data as import('./texture').Texture2DWrapper,
        renderbuffer: null,
        target: GL.TEXTURE_2D,
        layer: 0,
        width: (data as import('./texture').Texture2DWrapper).width,
        height: (data as import('./texture').Texture2DWrapper).height
      }
    }
    if (isTextureCube(data)) {
      check(
        target >= GL.TEXTURE_CUBE_MAP_POSITIVE_X &&
          target < GL.TEXTURE_CUBE_MAP_POSITIVE_X + 6,
        'invalid cube map target'
      )
      return {
        texture: data as import('./texture').TextureCubeWrapper,
        renderbuffer: null,
        target,
        layer: 0,
        width: (data as import('./texture').TextureCubeWrapper).width,
        height: (data as import('./texture').TextureCubeWrapper).height
      }
    }
    if (isTexture3D(data)) {
      check(this.caps.isWebGL2, '3D texture attachments require WebGL2')
      const tex = data as import('./texture').Texture3DWrapper
      check(layer >= 0 && layer < tex.depth, 'invalid 3D texture layer')
      return {
        texture: tex,
        renderbuffer: null,
        target: GL.TEXTURE_3D,
        layer,
        width: tex.width,
        height: tex.height
      }
    }
    if (isTexture2DArray(data)) {
      check(this.caps.isWebGL2, '2D array texture attachments require WebGL2')
      const tex = data as import('./texture').Texture2DArrayWrapper
      check(layer >= 0 && layer < tex.depth, 'invalid array texture layer')
      return {
        texture: tex,
        renderbuffer: null,
        target: GL.TEXTURE_2D_ARRAY,
        layer,
        width: tex.width,
        height: tex.height
      }
    }
    if (isRenderbuffer(data)) {
      return {
        texture: null,
        renderbuffer: data as import('./renderbuffer').RenderbufferWrapper,
        target: GL.RENDERBUFFER,
        layer: 0,
        samples: (data as import('./renderbuffer').RenderbufferWrapper).samples,
        width: (data as import('./renderbuffer').RenderbufferWrapper).width,
        height: (data as import('./renderbuffer').RenderbufferWrapper).height
      }
    }
    throw new Error('(regl) invalid regl object for attachment')
  }

  private allocAttachment(
    width: number,
    height: number,
    isTexture: boolean,
    format: string,
    type: string,
    samples = 0
  ): Attachment {
    width = Math.max(1, width)
    height = Math.max(1, height)
    if (isTexture && samples === 0) {
      // 若格式自带固定类型（如 rgba16f / rgb565 / rgba4），不要用 colorType 覆盖
      const formatInfo = this.textures.formatInfo(format)
      const textureType = formatInfo && formatInfo.type !== undefined
        ? undefined
        : type
      const textureOptions: Texture2DOptions = { width, height, format }
      if (textureType !== undefined) {
        textureOptions.type = textureType
      }
      const texture = this.textures.create2D(textureOptions)
      texture._texture.refCount = 0
      return {
        texture,
        renderbuffer: null,
        target: GL.TEXTURE_2D,
        samples: 0,
        width,
        height
      }
    }
    let rbFormat = this.renderbuffers.formats.has(format)
      ? format
      : (this.caps.isWebGL2 ? 'rgba8' : 'rgba4')
    if (samples > 0 && rbFormat === 'depth stencil') {
      rbFormat = 'depth24 stencil8'
    }
    const rb = this.renderbuffers.create({
      width,
      height,
      format: rbFormat,
      samples
    } as RenderbufferOptions)
    rb._renderbuffer.refCount = 0
    return {
      texture: null,
      renderbuffer: rb,
      target: GL.RENDERBUFFER,
      samples,
      width,
      height
    }
  }

  private incRefAndCheckShape(
    attachment: Attachment | null,
    width: number,
    height: number
  ): void {
    if (!attachment) return
    if (attachment.texture) {
      const texture = attachment.texture._texture
      check(
        Math.max(1, texture.width) === width && Math.max(1, texture.height) === height,
        'inconsistent width/height for supplied texture'
      )
      texture.refCount += 1
    } else {
      const rb = attachment.renderbuffer._renderbuffer
      check(
        rb.width === width && rb.height === height,
        'inconsistent width/height for renderbuffer'
      )
      rb.refCount += 1
    }
  }

  private decRef(attachment: Attachment | null): void {
    if (!attachment) return
    if (attachment.texture) {
      this.textures.decRef(attachment.texture._texture)
    } else {
      this.renderbuffers.decRef(attachment.renderbuffer._renderbuffer)
    }
  }

  private decRefs(framebuffer: FramebufferInternal): void {
    for (const attachment of framebuffer.colorAttachments) this.decRef(attachment)
    this.decRef(framebuffer.depthAttachment)
    this.decRef(framebuffer.stencilAttachment)
    this.decRef(framebuffer.depthStencilAttachment)
    framebuffer.colorAttachments = []
    framebuffer.depthAttachment = null
    framebuffer.stencilAttachment = null
    framebuffer.depthStencilAttachment = null
  }

  private isColorTexture(texture: TextureInternal): boolean {
    if (texture.flags.compressed) return false
    const name = texture.flags.formatName
    // WebGL1 只保证 RGBA 纹理可作为颜色附件（与旧版 regl 一致）；
    // WebGL2 允许更多（含整数格式）
    if (!this.caps.isWebGL2) {
      return name === 'rgba'
    }
    const info = this.textures.formatInfo(name)
    if (!info) return false
    // 深度 / 深度模板不能作为颜色附件；整数纹理可以作为颜色附件
    return (
      info.format !== GL.DEPTH_COMPONENT &&
      info.format !== GL.DEPTH_STENCIL
    )
  }

  private isColorRenderbuffer(rb: RenderbufferInternal): boolean {
    const info = this.renderbuffers.infoForFormat(rb.format)
    return !!info && !!info.color
  }

  private textureBpp(texture: TextureInternal): number {
    const info = this.textures.formatInfo(texture.flags.formatName)
    const channels = info?.channels || 4
    const typeSize =
      texture.flags.type === GL.FLOAT
        ? 4
        : texture.flags.type === GL.HALF_FLOAT ||
            texture.flags.type === GL.HALF_FLOAT_OES ||
            texture.flags.type === GL.UNSIGNED_SHORT
          ? 2
          : 1
    return channels * typeSize
  }

  private checkDepthAttachment(
    attachment: Attachment | null,
    width: number,
    height: number,
    kind: 'depth'
  ): void {
    if (!attachment) return
    this.incRefAndCheckShape(attachment, width, height)
    const valid = attachment.texture
      ? attachment.texture._texture.flags.formatName.startsWith('depth')
      : this.renderbuffers.infoForFormat(
          attachment.renderbuffer._renderbuffer.format
        )?.depth === true
    check(valid, `invalid ${kind} attachment for framebuffer object`)
  }

  private checkStencilAttachment(
    attachment: Attachment | null,
    width: number,
    height: number
  ): void {
    if (!attachment) return
    this.incRefAndCheckShape(attachment, width, height)
    const valid = attachment.renderbuffer
      ? this.renderbuffers.infoForFormat(
          attachment.renderbuffer._renderbuffer.format
        )?.stencil === true
      : false
    check(valid, 'invalid stencil attachment for framebuffer object')
  }

  private checkDepthStencilAttachment(
    attachment: Attachment | null,
    width: number,
    height: number
  ): void {
    if (!attachment) return
    this.incRefAndCheckShape(attachment, width, height)
    const valid = attachment.texture
      ? isDepthStencilFormatName(
          attachment.texture._texture.flags.formatName
        )
      : this.renderbuffers.infoForFormat(
          attachment.renderbuffer._renderbuffer.format
        )?.stencil === true &&
        this.renderbuffers.infoForFormat(
          attachment.renderbuffer._renderbuffer.format
        )?.depth === true
    check(valid, 'invalid depth-stencil attachment for framebuffer object')
  }

  // -------------------------------------------------------------------------
  // 提交到 GL
  // -------------------------------------------------------------------------

  private attach(location: number, attachment: Attachment | null): void {
    if (!attachment) return
    if (attachment.texture) {
      if (
        attachment.target === GL.TEXTURE_3D ||
        attachment.target === GL.TEXTURE_2D_ARRAY
      ) {
        ;(this.gl as WebGL2RenderingContext).framebufferTextureLayer(
          GL.FRAMEBUFFER,
          location,
          attachment.texture._texture.handle,
          0,
          attachment.layer || 0
        )
      } else {
        this.gl.framebufferTexture2D(
          GL.FRAMEBUFFER,
          location,
          attachment.target,
          attachment.texture._texture.handle,
          0
        )
      }
    } else {
      this.gl.framebufferRenderbuffer(
        GL.FRAMEBUFFER,
        location,
        GL.RENDERBUFFER,
        attachment.renderbuffer._renderbuffer.handle
      )
    }
  }

  private updateHandle(framebuffer: FramebufferInternal): void {
    const gl = this.gl
    gl.bindFramebuffer(GL.FRAMEBUFFER, framebuffer.handle)

    for (let i = 0; i < framebuffer.colorAttachments.length; ++i) {
      this.attach(GL.COLOR_ATTACHMENT0 + i, framebuffer.colorAttachments[i])
    }
    for (let i = framebuffer.colorAttachments.length; i < this.limits.maxColorAttachments; ++i) {
      gl.framebufferTexture2D(
        GL.FRAMEBUFFER,
        GL.COLOR_ATTACHMENT0 + i,
        GL.TEXTURE_2D,
        null,
        0
      )
    }

    // 先清空深度/模板附件，再挂载新附件
    gl.framebufferTexture2D(
      GL.FRAMEBUFFER,
      GL.DEPTH_STENCIL_ATTACHMENT,
      GL.TEXTURE_2D,
      null,
      0
    )
    gl.framebufferTexture2D(
      GL.FRAMEBUFFER,
      GL.DEPTH_ATTACHMENT,
      GL.TEXTURE_2D,
      null,
      0
    )
    gl.framebufferTexture2D(
      GL.FRAMEBUFFER,
      GL.STENCIL_ATTACHMENT,
      GL.TEXTURE_2D,
      null,
      0
    )

    this.attach(GL.DEPTH_ATTACHMENT, framebuffer.depthAttachment)
    this.attach(GL.STENCIL_ATTACHMENT, framebuffer.stencilAttachment)
    this.attach(GL.DEPTH_STENCIL_ATTACHMENT, framebuffer.depthStencilAttachment)

    const status = gl.checkFramebufferStatus(GL.FRAMEBUFFER)
    if (!gl.isContextLost() && status !== GL.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `(regl) framebuffer configuration not supported, status = ${statusCode[status] || status}`
      )
    }

    // 恢复之前绑定的 framebuffer，保持状态缓存一致
    const previous = this.next
    gl.bindFramebuffer(GL.FRAMEBUFFER, previous ? previous.handle : null)
    this.cur = previous
    // 清空错误码：某些驱动（含 headless-gl）会在 checkFramebufferStatus 后残留错误
    gl.getError()
  }

  // -------------------------------------------------------------------------
  // 尺寸调整
  // -------------------------------------------------------------------------

  resize(framebuffer: FramebufferInternal, w: number, h?: number): void {
    check(
      this.next !== framebuffer,
      'can not resize a framebuffer which is currently in use'
    )
    const width = Math.max(w | 0, 1)
    const height = Math.max(((h || 0) | 0) || width, 1)
    if (width === framebuffer.width && height === framebuffer.height) return

    for (const attachment of framebuffer.colorAttachments) {
      this.resizeAttachment(attachment, width, height)
    }
    this.resizeAttachment(framebuffer.depthAttachment, width, height)
    this.resizeAttachment(framebuffer.stencilAttachment, width, height)
    this.resizeAttachment(framebuffer.depthStencilAttachment, width, height)

    framebuffer.width = width
    framebuffer.height = height
    const wrapper = this.wrapperFor(framebuffer)
    if (wrapper) {
      wrapper.width = width
      wrapper.height = height
      wrapper.samples = framebuffer.samples
    }
    this.updateHandle(framebuffer)
  }

  private resizeAttachment(
    attachment: Attachment | null,
    width: number,
    height: number
  ): void {
    if (!attachment) return
    if (attachment.texture) {
      check(
        attachment.target !== GL.TEXTURE_3D &&
          attachment.target !== GL.TEXTURE_2D_ARRAY,
        'cannot resize a 3D / 2D array framebuffer attachment'
      )
      ;(attachment.texture as
        | import('./texture').Texture2DWrapper
        | import('./texture').TextureCubeWrapper).resize(width, height)
    } else {
      attachment.renderbuffer.resize(width, height)
    }
    attachment.width = width
    attachment.height = height
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  private wrappers = new WeakMap<FramebufferInternal, FramebufferWrapper>()

  private wrapperFor(fb: FramebufferInternal): FramebufferWrapper | undefined {
    return this.wrappers.get(fb)
  }

  destroy(framebuffer: FramebufferInternal): void {
    check(!!framebuffer.handle, 'must not double destroy framebuffer')
    this.gl.deleteFramebuffer(framebuffer.handle)
    framebuffer.handle = null
    this.stats.framebufferCount--
    this.set.delete(framebuffer.id)
    this.decRefs(framebuffer)
  }

  get(value: unknown): FramebufferInternal | null {
    if (
      typeof value === 'function' &&
      (value as unknown as { _reglType?: string })._reglType === 'framebuffer'
    ) {
      const internal = (value as unknown as { _framebuffer?: FramebufferInternal })
        ._framebuffer
      return internal && this.set.has(internal.id) ? internal : null
    }
    return null
  }

  clear(): void {
    for (const fb of Array.from(this.set.values())) {
      if (fb.handle) {
        this.gl.deleteFramebuffer(fb.handle)
        fb.handle = null
      }
      this.decRefs(fb)
    }
    this.set.clear()
    this.stats.framebufferCount = 0
    this.cur = null
    this.next = null
  }

  restore(): void {
    this.cur = null
    this.next = null
    for (const fb of this.set.values()) {
      fb.handle = this.gl.createFramebuffer()
      this.updateHandle(fb)
    }
  }

  /** 注册 wrapper，供 update 时同步公开字段。 */
  register(fb: FramebufferInternal, wrapper: FramebufferWrapper): void {
    this.wrappers.set(fb, wrapper)
  }

  // -------------------------------------------------------------------------
  // 立方体 FBO
  // -------------------------------------------------------------------------

  createCube(options?: FramebufferCubeOptions | number | null): FramebufferCubeWrapper {
    const faces: FramebufferWrapper[] = []
    let colorCubes: import('./texture').TextureCubeWrapper[] = []
    let radius = 0

    const update = (input?: FramebufferCubeOptions | number | null) => {
      let colorBuffer: unknown = null
      let colorFormat = 'rgba'
      let colorType = 'uint8'
      let colorCount = 1
      const params: FramebufferOptions = { color: null }

      if (typeof input === 'number') {
        radius = input | 0
      } else if (!input) {
        radius = 1
      } else {
        checkType(input, 'object', 'invalid arguments for framebuffer')
        const opts = input
        if ('shape' in opts) {
          const shape = opts.shape!
          check(
            Array.isArray(shape) && shape.length >= 2,
            'invalid shape for framebuffer'
          )
          check(shape[0] === shape[1], 'cube framebuffer must be square')
          radius = shape[0]
        } else {
          if ('radius' in opts) radius = opts.radius as number
          if ('width' in opts) {
            radius = opts.width as number
            if ('height' in opts) {
              check(opts.height === radius, 'must be square')
            }
          } else if ('height' in opts) {
            radius = opts.height as number
          }
        }
        if ('color' in opts || 'colors' in opts) {
          colorBuffer = opts.color ?? opts.colors
          if (Array.isArray(colorBuffer)) {
            check(
              colorBuffer.length === 1 || this.caps.hasDrawBuffers,
              'multiple render targets not supported'
            )
          }
        }
        if (!colorBuffer) {
          if ('colorCount' in opts) {
            colorCount = opts.colorCount! | 0
            check(colorCount > 0, 'invalid color buffer count')
          }
          if ('colorType' in opts) colorType = opts.colorType!
          if ('colorFormat' in opts) {
            check(
              !!this.textures.formatInfo(opts.colorFormat!),
              'invalid color format for texture'
            )
            colorFormat = opts.colorFormat!
          }
        }
        if ('depth' in opts) params.depth = opts.depth
        if ('stencil' in opts) params.stencil = opts.stencil
        if ('depthStencil' in opts) params.depthStencil = opts.depthStencil
      }

      if (colorBuffer) {
        colorCubes = (
          Array.isArray(colorBuffer) ? colorBuffer : [colorBuffer]
        ) as import('./texture').TextureCubeWrapper[]
      } else {
        colorCubes = []
        for (let i = 0; i < colorCount; ++i) {
          colorCubes.push(
            this.textures.createCube({
              radius,
              format: colorFormat,
              type: colorType
            })
          )
        }
      }

      params.color = colorCubes.map((cube) => {
        check(
          typeof cube === 'function' && cube._reglType === 'textureCube',
          'invalid cube map'
        )
        radius = radius || cube.width
        check(
          cube.width === radius && cube.height === radius,
          'invalid cube map shape'
        )
        return { target: GL.TEXTURE_CUBE_MAP_POSITIVE_X, data: cube }
      })

      for (let i = 0; i < 6; ++i) {
        for (let j = 0; j < colorCubes.length; ++j) {
          ;(params.color as { target: number; data: unknown }[])[j].target =
            GL.TEXTURE_CUBE_MAP_POSITIVE_X + i
        }
        if (i > 0) {
          params.depth = faces[0].depth as never
          params.stencil = faces[0].stencil as never
          params.depthStencil = faces[0].depthStencil as never
        }
        if (faces[i]) {
          ;(faces[i] as unknown as (o: FramebufferOptions) => void)(params)
        } else {
          faces[i] = this.create(params)
        }
      }

      cubeWrapper.width = radius
      cubeWrapper.height = radius
      cubeWrapper.color = colorCubes
    }

    const cubeWrapper = updateCubeWrapper(update, faces)
    update(options)
    return cubeWrapper
  }

  destroyCube(cube: FramebufferCubeWrapper): void {
    for (const face of cube.faces) {
      if (face) face.destroy()
    }
  }
}

// ---------------------------------------------------------------------------
// 用户可见包装
// ---------------------------------------------------------------------------

export interface FramebufferOptions {
  shape?: [number, number]
  radius?: number
  width?: number
  height?: number
  color?: unknown
  colors?: unknown
  colorCount?: number
  colorTexture?: boolean
  colorFormat?: FramebufferColorFormat | string
  colorType?: 'uint8' | 'half float' | 'float16' | 'float' | 'float32'
  samples?: number
  depth?: boolean | unknown
  stencil?: boolean | unknown
  depthStencil?: boolean | unknown
  depthTexture?: boolean
  depthStencilTexture?: boolean
}

export interface FramebufferCubeOptions extends FramebufferOptions {
  color?: unknown
}

export interface FramebufferWrapper {
  (a?: FramebufferOptions | number | null, b?: number): FramebufferWrapper
  _reglType: 'framebuffer'
  _framebuffer: FramebufferInternal
  width: number
  height: number
  samples: number
  color: unknown[]
  depth: unknown
  stencil: unknown
  depthStencil: unknown
  resize(width: number, height?: number): FramebufferWrapper
  use(block: () => void): void
  destroy(): void
}

export interface FramebufferCubeWrapper {
  (options?: FramebufferCubeOptions | number | null): FramebufferCubeWrapper
  _reglType: 'framebufferCube'
  width: number
  height: number
  color: import('./texture').TextureCubeWrapper[]
  faces: FramebufferWrapper[]
  resize(radius: number): FramebufferCubeWrapper
  destroy(): void
}

function isDepthStencilFormatName(name: string): boolean {
  return name === 'depth stencil' || name === 'depth24 stencil8'
}

function createFramebufferWrapper(  framebuffer: FramebufferInternal,
  update: (a?: FramebufferOptions | number | null, b?: number) => FramebufferWrapper,
  store: FramebufferStore
): FramebufferWrapper {
  const wrapper = ((a?: FramebufferOptions | number | null, b?: number) => {
    update(a, b)
    return wrapper
  }) as FramebufferWrapper

  wrapper._reglType = 'framebuffer'
  wrapper._framebuffer = framebuffer
  wrapper.width = framebuffer.width
  wrapper.height = framebuffer.height
  wrapper.samples = framebuffer.samples
  wrapper.color = []
  wrapper.depth = null
  wrapper.stencil = null
  wrapper.depthStencil = null
  wrapper.resize = (width: number, height?: number) => {
    store.resize(framebuffer, width, height)
    return wrapper
  }
  wrapper.use = (block: () => void) => {
    if (store.setFBO) {
      store.setFBO({ framebuffer: wrapper }, block)
    } else {
      throw new Error('(regl) framebuffer.use() is not ready yet')
    }
  }
  wrapper.destroy = () => {
    store.destroy(framebuffer)
  }

  store.register(framebuffer, wrapper)
  return wrapper
}

function updateCubeWrapper(
  update: (options?: FramebufferCubeOptions | number | null) => void,
  faces: FramebufferWrapper[]
): FramebufferCubeWrapper {
  const wrapper: FramebufferCubeWrapper = ((options?: FramebufferCubeOptions | number | null) => {
    update(options)
    return wrapper
  }) as FramebufferCubeWrapper

  wrapper._reglType = 'framebufferCube'
  wrapper.width = 0
  wrapper.height = 0
  wrapper.color = []
  wrapper.faces = faces
  wrapper.resize = (radius: number) => {
    const r = radius | 0
    check(r > 0, 'invalid radius for cube fbo')
    for (const cube of wrapper.color) {
      cube.resize(r)
    }
    for (const face of faces) {
      face.resize(r)
    }
    wrapper.width = wrapper.height = r
    return wrapper
  }
  wrapper.destroy = () => {
    for (const face of faces) {
      if (face && (face as unknown as { _framebuffer?: FramebufferInternal })._framebuffer?.handle) {
        face.destroy()
      }
    }
  }
  return wrapper
}

/** 判断是否是 framebuffer 资源。 */
export function isFramebuffer(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as { _reglType?: string })._reglType === 'framebuffer'
  )
}

/** 判断是否是立方体 framebuffer。 */
export function isFramebufferCube(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as { _reglType?: string })._reglType === 'framebufferCube'
  )
}

// 避免未使用告警
void isTypedArray
