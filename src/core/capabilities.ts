/**
 * WebGL 能力探测层。
 *
 * 这是本重写版相对原版 regl 的一个结构性改进：
 * 原版把 WebGL1 的扩展（VAO、实例化、drawBuffers、32 位索引等）当作「有没有扩展」
 * 到处判断。WebGL2 中这些能力是核心功能，如果直接复制原逻辑会把它们当成不可用。
 *
 * 这里把这些能力抽象成 Capabilities 上的布尔标志与统一方法：
 *   - `caps.isWebGL2`
 *   - `caps.hasVAO` / `caps.vao`
 *   - `caps.hasInstancing` / `caps.instancing`
 *   - `caps.hasDrawBuffers` / `caps.drawBuffers`
 *   - `caps.hasUintElements`
 *
 * 对用户暴露的 `regl.hasExtension('oes_vertex_array_object')` 在 WebGL2 下也返回 true，
 * 这样依赖旧扩展名的代码可以无缝迁移。
 */

import { GL } from '../util/constants'
import { DEV } from '../util/check'

export type GLContext = WebGLRenderingContext | WebGL2RenderingContext

/** 兼容跨 realm / headless 环境的 WebGL2 检测。 */
export function isWebGL2Context(gl: GLContext): boolean {
  if (
    typeof WebGL2RenderingContext !== 'undefined' &&
    gl instanceof WebGL2RenderingContext
  ) {
    return true
  }
  return (
    typeof (gl as WebGL2RenderingContext).createVertexArray === 'function' &&
    typeof (gl as WebGL2RenderingContext).texStorage2D === 'function'
  )
}

/** 需要主动探测的可选扩展。 */
const OPTIONAL_EXTENSIONS = [
  // 顶点数组 / 实例化 / MRT
  'oes_vertex_array_object',
  'angle_instanced_arrays',
  'webgl_draw_buffers',
  // 索引类型
  'oes_element_index_uint',
  // 浮点纹理
  'oes_texture_float',
  'oes_texture_float_linear',
  'oes_texture_half_float',
  'oes_texture_half_float_linear',
  'webgl_depth_texture',
  'ext_srgb',
  'ext_blend_minmax',
  'ext_texture_filter_anisotropic',
  // 渲染到浮点纹理
  'webgl_color_buffer_float',
  'ext_color_buffer_float',
  'ext_color_buffer_half_float',
  // 计时器
  'ext_disjoint_timer_query',
  'ext_disjoint_timer_query_webgl2',
  // 着色器相关
  'oes_standard_derivatives',
  'ext_shader_texture_lod',
  'ext_frag_depth',
  'ext_draw_buffers',
  // 压缩纹理
  'webgl_compressed_texture_s3tc',
  'webgl_compressed_texture_s3tc_srgb',
  'webgl_compressed_texture_atc',
  'webgl_compressed_texture_pvrtc',
  'webgl_compressed_texture_etc1',
  'webgl_compressed_texture_etc',
  'webgl_compressed_texture_astc',
  'webgl_compressed_texture_bptc',
  // 其它
  'khr_parallel_shader_compile',
  'webgl_lose_context'
]

/**
 * WebGL2 中成为核心功能的扩展名。
 * 如果用户显式 require 这些扩展，在 WebGL2 下不应该报错。
 */
const WEBGL2_CORE_EXTENSIONS = new Set([
  'oes_vertex_array_object',
  'angle_instanced_arrays',
  'webgl_draw_buffers',
  'oes_element_index_uint',
  'webgl_depth_texture',
  'oes_texture_float',
  'oes_texture_half_float',
  'ext_blend_minmax',
  'oes_standard_derivatives',
  'ext_shader_texture_lod',
  'ext_frag_depth',
  'ext_srgb'
])

/** WebGL2 中通过 getExtension 才能获得的能力（并不是核心）。 */
const WEBGL2_STILL_EXTENSION = new Set([
  'ext_color_buffer_float',
  'ext_color_buffer_half_float',
  'ext_texture_filter_anisotropic',
  'webgl_color_buffer_float'
])

export interface CapabilitiesOptions {
  /** 必须存在的扩展；缺失会抛错。 */
  extensions?: string[]
  /** 可选扩展；缺失只记录日志（不报错）。 */
  optionalExtensions?: string[]
}

export class Capabilities {
  readonly gl: GLContext
  readonly isWebGL2: boolean
  /** 已成功加载（或 WebGL2 核心等价）的扩展表，键名小写。 */
  readonly extensions: Record<string, unknown> = {}
  /** 用户要求且必须存在的扩展名（小写）。 */
  readonly requestedExtensions: string[]

  /** 是否支持顶点数组对象（WebGL2 原生或 OES 扩展）。 */
  readonly hasVAO: boolean
  /** 是否支持实例化绘制（WebGL2 原生或 ANGLE 扩展）。 */
  readonly hasInstancing: boolean
  /** 是否支持多渲染目标（WebGL2 原生或 WEBGL_draw_buffers）。 */
  readonly hasDrawBuffers: boolean
  /** 是否支持 32 位索引（WebGL2 原生或 OES_element_index_uint）。 */
  readonly hasUintElements: boolean

  /** VAO 扩展对象（WebGL1）或 null（WebGL2 使用原生 API）。 */
  readonly vaoExt: OESVertexArrayObjectLike | null
  /** 实例化扩展对象（WebGL1）或 null。 */
  readonly instancingExt: ANGLEInstancedArraysLike | null
  /** drawBuffers 扩展对象（WebGL1）或 null。 */
  readonly drawBuffersExt: WEBGLDrawBuffersLike | null
  /** 计时器查询扩展（已归一化，见 core/timer.ts）。 */
  readonly timerQueryExt: TimerQueryExtLike | null

  readonly maxAnisotropy: number
  readonly maxColorAttachments: number
  readonly maxDrawBuffers: number

  /** 是否可以从浮点 FBO 读取像素。 */
  readonly readFloat: boolean
  /** 是否支持非 2 次幂的立方体贴图。 */
  readonly npotTextureCube: boolean

  constructor(gl: GLContext, options: CapabilitiesOptions = {}) {
    this.gl = gl
    this.isWebGL2 = isWebGL2Context(gl)

    this.requestedExtensions = (options.extensions || []).map((name) =>
      name.toLowerCase()
    )

    // 加载必需扩展（WebGL2 核心扩展视为已满足）
    for (const name of this.requestedExtensions) {
      if (!this.loadExtension(name)) {
        throw new Error(
          `(regl) "${name}" extension is not supported by the current WebGL context, ` +
            'try upgrading your system or a different browser'
        )
      }
    }

    // 加载用户指定的可选扩展
    for (const name of options.optionalExtensions || []) {
      this.loadExtension(name.toLowerCase())
    }

    // 探测内部会用到的扩展
    for (const name of OPTIONAL_EXTENSIONS) {
      if (name in this.extensions) continue
      if (this.isWebGL2 && WEBGL2_CORE_EXTENSIONS.has(name)) {
        this.extensions[name] = true
        continue
      }
      this.loadExtension(name)
    }

    this.hasVAO = this.isWebGL2 || !!this.extensions.oes_vertex_array_object
    this.hasInstancing =
      this.isWebGL2 || !!this.extensions.angle_instanced_arrays
    this.hasDrawBuffers =
      this.isWebGL2 || !!this.extensions.webgl_draw_buffers
    this.hasUintElements =
      this.isWebGL2 || !!this.extensions.oes_element_index_uint

    this.vaoExt = this.isWebGL2
      ? null
      : (this.extensions.oes_vertex_array_object as OESVertexArrayObjectLike) ||
        null
    this.instancingExt = this.isWebGL2
      ? null
      : (this.extensions.angle_instanced_arrays as ANGLEInstancedArraysLike) ||
        null
    this.drawBuffersExt = this.isWebGL2
      ? null
      : (this.extensions.webgl_draw_buffers as WEBGLDrawBuffersLike) || null
    this.timerQueryExt = this.isWebGL2
      ? (this.extensions.ext_disjoint_timer_query_webgl2 as TimerQueryExtLike) ||
        null
      : (this.extensions.ext_disjoint_timer_query as TimerQueryExtLike) || null

    const anisotropyExt = this.extensions[
      'ext_texture_filter_anisotropic'
    ] as EXTTextureFilterAnisotropicLike | undefined
    this.maxAnisotropy = anisotropyExt
      ? (gl.getParameter(
          anisotropyExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT ||
            GL.MAX_TEXTURE_MAX_ANISOTROPY_EXT
        ) as number)
      : 1

    if (this.hasDrawBuffers) {
      const db = this.drawBuffersExt
      const gl2 = gl as WebGL2RenderingContext
      this.maxDrawBuffers = this.isWebGL2
        ? (gl2.getParameter(GL.MAX_DRAW_BUFFERS) as number)
        : (gl.getParameter(db!.MAX_DRAW_BUFFERS_WEBGL) as number)
      this.maxColorAttachments = this.isWebGL2
        ? (gl2.getParameter(GL.MAX_COLOR_ATTACHMENTS) as number)
        : (gl.getParameter(db!.MAX_COLOR_ATTACHMENTS_WEBGL) as number)
    } else {
      this.maxDrawBuffers = 1
      this.maxColorAttachments = 1
    }

    this.readFloat = detectReadFloat(gl, this)
    this.npotTextureCube = detectNpotCube(gl, this)
  }

  /** 是否拥有某个扩展（WebGL2 核心能力会以扩展名返回 true）。 */
  has(name: string): boolean {
    return !!this.extensions[name.toLowerCase()]
  }

  /** 取扩展对象（对 WebGL2 核心扩展返回 gl 本身或 true）。 */
  get<T = unknown>(name: string): T | null {
    return (this.extensions[name.toLowerCase()] as T) || null
  }

  private loadExtension(name: string): boolean {
    name = name.toLowerCase()
    if (name in this.extensions) {
      return !!this.extensions[name]
    }
    if (this.isWebGL2 && WEBGL2_CORE_EXTENSIONS.has(name)) {
      this.extensions[name] = true
      return true
    }
    let ext: unknown = null
    try {
      ext = this.gl.getExtension(name)
    } catch (err) {
      if (DEV) {
        // 某些浏览器对未知扩展名会抛异常，这里吞掉并当作不支持
        // eslint-disable-next-line no-console
        console.warn(`(regl) failed to load extension "${name}"`, err)
      }
    }
    this.extensions[name] = ext
    return !!ext
  }

  /** 上下文恢复后重新获取扩展。 */
  restore(): void {
    for (const name of Object.keys(this.extensions)) {
      if (this.isWebGL2 && WEBGL2_CORE_EXTENSIONS.has(name)) {
        this.extensions[name] = true
        continue
      }
      if (this.isWebGL2 && WEBGL2_STILL_EXTENSION.has(name)) {
        this.extensions[name] = this.gl.getExtension(name)
        continue
      }
      // 用户明确要求的扩展在恢复后必须仍然存在
      const ext = this.gl.getExtension(name)
      if (!ext && this.requestedExtensions.indexOf(name) >= 0) {
        throw new Error(`(regl) error restoring extension ${name}`)
      }
      this.extensions[name] = ext
    }
  }

  /** 返回所有真实存在的能力名（用于 regl.limits.extensions）。 */
  list(): string[] {
    return Object.keys(this.extensions).filter((name) => !!this.extensions[name])
  }

  /** 创建 VAO。 */
  createVertexArray(): WebGLVertexArrayObject | null {
    if (this.isWebGL2) {
      return (this.gl as WebGL2RenderingContext).createVertexArray()
    }
    return this.vaoExt ? this.vaoExt.createVertexArrayOES() : null
  }

  bindVertexArray(vao: WebGLVertexArrayObject | null): void {
    if (this.isWebGL2) {
      ;(this.gl as WebGL2RenderingContext).bindVertexArray(vao)
    } else if (this.vaoExt) {
      this.vaoExt.bindVertexArrayOES(vao as WebGLVertexArrayObjectOES)
    }
  }

  deleteVertexArray(vao: WebGLVertexArrayObject | null): void {
    if (!vao) return
    if (this.isWebGL2) {
      ;(this.gl as WebGL2RenderingContext).deleteVertexArray(vao)
    } else if (this.vaoExt) {
      this.vaoExt.deleteVertexArrayOES(vao as WebGLVertexArrayObjectOES)
    }
  }

  /** 设置顶点属性除数（实例化）。 */
  vertexAttribDivisor(location: number, divisor: number): void {
    if (this.isWebGL2) {
      ;(this.gl as WebGL2RenderingContext).vertexAttribDivisor(location, divisor)
    } else if (this.instancingExt) {
      this.instancingExt.vertexAttribDivisorANGLE(location, divisor)
    }
  }

  /** 实例化 drawArrays。 */
  drawArraysInstanced(
    mode: number,
    first: number,
    count: number,
    instances: number
  ): void {
    if (this.isWebGL2) {
      ;(this.gl as WebGL2RenderingContext).drawArraysInstanced(
        mode,
        first,
        count,
        instances
      )
    } else {
      this.instancingExt!.drawArraysInstancedANGLE(mode, first, count, instances)
    }
  }

  /** 实例化 drawElements。 */
  drawElementsInstanced(
    mode: number,
    count: number,
    type: number,
    offset: number,
    instances: number
  ): void {
    if (this.isWebGL2) {
      ;(this.gl as WebGL2RenderingContext).drawElementsInstanced(
        mode,
        count,
        type,
        offset,
        instances
      )
    } else {
      this.instancingExt!.drawElementsInstancedANGLE(
        mode,
        count,
        type,
        offset,
        instances
      )
    }
  }

  /** 设置 draw buffers（MRT）。 */
  drawBuffers(buffers: number[]): void {
    if (this.isWebGL2) {
      ;(this.gl as WebGL2RenderingContext).drawBuffers(buffers)
    } else if (this.drawBuffersExt) {
      this.drawBuffersExt.drawBuffersWEBGL(buffers)
    }
  }
}

// ---------------------------------------------------------------------------
// 能力探测
// ---------------------------------------------------------------------------

function detectReadFloat(gl: GLContext, caps: Capabilities): boolean {
  // WebGL2 中浮点纹理是核心功能，但能否 render-to-float / readPixels 还要看扩展
  const supported =
    caps.isWebGL2 ||
    !!caps.extensions.oes_texture_float
  if (!supported) return false

  const texture = gl.createTexture()
  if (!texture) return false
  gl.bindTexture(GL.TEXTURE_2D, texture)
  // WebGL2 必须使用 sized internal format
  const internalFormat = caps.isWebGL2 ? 0x8814 : GL.RGBA
  gl.texImage2D(
    GL.TEXTURE_2D,
    0,
    internalFormat,
    1,
    1,
    0,
    GL.RGBA,
    GL.FLOAT,
    null
  )
  const fbo = gl.createFramebuffer()
  gl.bindFramebuffer(GL.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(
    GL.FRAMEBUFFER,
    GL.COLOR_ATTACHMENT0,
    GL.TEXTURE_2D,
    texture,
    0
  )
  let result = false
  if (gl.checkFramebufferStatus(GL.FRAMEBUFFER) === GL.FRAMEBUFFER_COMPLETE) {
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array
    gl.viewport(0, 0, 1, 1)
    gl.clearColor(1, 0, 0, 1)
    gl.clear(GL.COLOR_BUFFER_BIT)
    const pixels = new Float32Array(4)
    gl.readPixels(0, 0, 1, 1, GL.RGBA, GL.FLOAT, pixels)
    result = gl.getError() === 0 && pixels[0] === 1
    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3])
  }
  gl.bindFramebuffer(GL.FRAMEBUFFER, null)
  gl.deleteFramebuffer(fbo)
  gl.deleteTexture(texture)
  return result
}

function detectNpotCube(gl: GLContext, caps: Capabilities): boolean {
  if (caps.isWebGL2) return true
  // 通过尝试上传一个 3x3 立方体贴图判断（IE/旧驱动不支持 NPOT cube）
  const texture = gl.createTexture()
  gl.bindTexture(GL.TEXTURE_CUBE_MAP, texture)
  gl.texImage2D(
    GL.TEXTURE_CUBE_MAP_POSITIVE_X,
    0,
    GL.RGBA,
    3,
    3,
    0,
    GL.RGBA,
    GL.UNSIGNED_BYTE,
    null
  )
  const result = gl.getError() === 0
  gl.bindTexture(GL.TEXTURE_CUBE_MAP, null)
  gl.deleteTexture(texture)
  return result
}

// ---------------------------------------------------------------------------
// 扩展的最小接口（避免依赖各浏览器厂商的 d.ts 差异）
// ---------------------------------------------------------------------------

export interface OESVertexArrayObjectLike {
  createVertexArrayOES(): WebGLVertexArrayObjectOES
  deleteVertexArrayOES(vao: WebGLVertexArrayObjectOES | null): void
  bindVertexArrayOES(vao: WebGLVertexArrayObjectOES | null): void
  isVertexArrayOES(vao: WebGLVertexArrayObjectOES | null): boolean
  VERTEX_ARRAY_BINDING_OES: number
}

export interface ANGLEInstancedArraysLike {
  drawArraysInstancedANGLE(
    mode: number,
    first: number,
    count: number,
    primcount: number
  ): void
  drawElementsInstancedANGLE(
    mode: number,
    count: number,
    type: number,
    offset: number,
    primcount: number
  ): void
  vertexAttribDivisorANGLE(index: number, divisor: number): void
  VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: number
}

export interface WEBGLDrawBuffersLike {
  drawBuffersWEBGL(buffers: number[]): void
  MAX_DRAW_BUFFERS_WEBGL: number
  MAX_COLOR_ATTACHMENTS_WEBGL: number
}

export interface EXTTextureFilterAnisotropicLike {
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: number
  TEXTURE_MAX_ANISOTROPY_EXT: number
}

/**
 * 计时器查询扩展的归一化接口。
 * WebGL1 的 EXT_disjoint_timer_query 与 WebGL2 的
 * EXT_disjoint_timer_query_webgl2 方法名不同，timer 实现里会统一处理。
 */
export interface TimerQueryExtLike {
  createQueryEXT?: () => WebGLQuery
  deleteQueryEXT?: (query: WebGLQuery) => void
  beginQueryEXT?: (target: number, query: WebGLQuery) => void
  endQueryEXT?: (target: number) => void
  getQueryObjectEXT?: (query: WebGLQuery, pname: number) => number | boolean
  QUERY_RESULT_EXT?: number
  QUERY_RESULT_AVAILABLE_EXT?: number
  TIME_ELAPSED_EXT?: number
}
