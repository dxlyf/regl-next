/**
 * WebGL 状态缓存（State Cache）。
 *
 * 原版 regl 通过代码生成维护 `currentState` / `nextState` 两套状态，并用
 * `dirty` 标志决定何时重新提交。这个设计对生成代码很友好，但可读性差、
 * 外部通过 `_gl` 修改状态后很难正确失效。
 *
 * 本实现改为「立即应用 + 值缓存」：
 * - 每条命令只提交自己显式声明的状态（与 regl 语义一致：未声明的状态保持原样）；
 * - 每次提交前与缓存比较，相同则跳过，避免冗余 GL 调用；
 * - `invalidate()` 可以在外部直接操作 `_gl` 后强制重新同步。
 *
 * 这样既保留了性能，又大幅简化了状态机。
 */

import { GL } from '../util/constants'
import {
  blendEquations,
  blendFuncs,
  compareFuncs,
  invalidBlendCombinations,
  orientationTypes,
  stencilOps
} from '../util/constants'
import { checkCommand, checkCommandType, checkParameter, check } from '../util/check'
import type { Capabilities, GLContext } from './capabilities'

/** 顶点属性绑定记录（每个 attribute location 一份）。 */
export interface AttributeBinding {
  buffer: WebGLBuffer | null
  size: number
  type: number
  normalized: boolean
  /** 是否使用 vertexAttribIPointer（整数 attribute）。 */
  integer: boolean
  stride: number
  offset: number
  divisor: number
  // 常量属性值
  x: number
  y: number
  z: number
  w: number
}

export function createAttributeBinding(): AttributeBinding {
  return {
    buffer: null,
    size: 4,
    type: GL.FLOAT,
    normalized: false,
    integer: false,
    stride: 0,
    offset: 0,
    divisor: 0,
    x: 0,
    y: 0,
    z: 0,
    w: 0
  }
}

/** 顶点属性指针描述（用于 VAO 记录与缓存比较）。 */
export interface AttributePointer {
  buffer: WebGLBuffer
  size: number
  type: number
  normalized: boolean
  integer?: boolean
  stride: number
  offset: number
  divisor: number
}

/** 状态选项名。 */
export type StateName =
  | 'dither'
  | 'blend.enable'
  | 'blend.color'
  | 'blend.equation'
  | 'blend.func'
  | 'depth.enable'
  | 'depth.func'
  | 'depth.range'
  | 'depth.mask'
  | 'colorMask'
  | 'cull.enable'
  | 'cull.face'
  | 'frontFace'
  | 'lineWidth'
  | 'polygonOffset.enable'
  | 'polygonOffset.offset'
  | 'sample.alpha'
  | 'sample.enable'
  | 'sample.coverage'
  | 'stencil.enable'
  | 'stencil.mask'
  | 'stencil.func'
  | 'stencil.opFront'
  | 'stencil.opBack'
  | 'scissor.enable'
  | 'scissor.box'
  | 'viewport'

/** 所有可通过命令声明的状态键，顺序与 regl 的隐藏类初始化顺序保持一致。 */
export const STATE_NAMES: StateName[] = [
  'dither',
  'blend.enable',
  'blend.color',
  'blend.equation',
  'blend.func',
  'depth.enable',
  'depth.func',
  'depth.range',
  'depth.mask',
  'colorMask',
  'cull.enable',
  'cull.face',
  'frontFace',
  'lineWidth',
  'polygonOffset.enable',
  'polygonOffset.offset',
  'sample.alpha',
  'sample.enable',
  'sample.coverage',
  'stencil.enable',
  'stencil.mask',
  'stencil.func',
  'stencil.opFront',
  'stencil.opBack',
  'scissor.enable',
  'scissor.box',
  'viewport'
]

const STATE_NAME_SET = new Set<string>(STATE_NAMES)
export function isStateName(name: string): name is StateName {
  return STATE_NAME_SET.has(name)
}

/** 矩形框（viewport / scissor）。 */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 状态缓存。
 *
 * 注意：所有方法都假定当前 VAO 已正确绑定。VAO 切换时会调用
 * `invalidateVertexArrays()`，因为每个 VAO 拥有独立的属性状态。
 */
export class GLStateCache {
  readonly gl: GLContext
  readonly caps: Capabilities

  private flags = new Map<number, boolean>()
  private program: WebGLProgram | null = null
  private framebuffer: WebGLFramebuffer | null = null
  private framebufferColorCount = 0
  private arrayBuffer: WebGLBuffer | null = null
  private elementBuffer: WebGLBuffer | null = null
  private viewportValue: [number, number, number, number] = [0, 0, 0, 0]
  private scissorValue: [number, number, number, number] = [0, 0, 0, 0]
  private colorMaskValue: [boolean, boolean, boolean, boolean] = [
    true,
    true,
    true,
    true
  ]
  private blendColorValue: [number, number, number, number] = [0, 0, 0, 0]
  private blendEquationValue: [number, number] = [GL.FUNC_ADD, GL.FUNC_ADD]
  private blendFuncValue: [number, number, number, number] = [
    GL.ONE,
    GL.ZERO,
    GL.ONE,
    GL.ZERO
  ]
  private depthRangeValue: [number, number] = [0, 1]
  private stencilOpFrontValue: [number, number, number] = [
    GL.KEEP,
    GL.KEEP,
    GL.KEEP
  ]
  private stencilOpBackValue: [number, number, number] = [
    GL.KEEP,
    GL.KEEP,
    GL.KEEP
  ]
  private sampleCoverageValue: [number, boolean] = [1, false]
  private depthFuncValue = -1
  private depthMaskValue: boolean | null = null
  private cullFaceValue = -1
  private frontFaceValue = -1
  private lineWidthValue = -1
  private polygonOffsetValue: [number, number] = [Number.NaN, Number.NaN]
  private stencilMaskValue = Number.NaN
  private stencilFuncValue: [number, number, number] = [
    Number.NaN,
    Number.NaN,
    Number.NaN
  ]

  /** 顶点属性绑定缓存，按 location 索引。 */
  readonly attributes: AttributeBinding[]
  /** 当前绑定的 VAO（原生或模拟）。 */
  currentVAO: unknown = null
  /** 是否处于 VAO 模拟模式（WebGL1 无 OES_vertex_array_object）。 */
  readonly emulatedVAO: boolean

  // WebGL2 uniform buffer 相关缓存
  private readonly programBlockBindings = new Map<
    WebGLProgram,
    Map<number, number>
  >()
  private readonly uniformBufferBindings: Array<{
    buffer: WebGLBuffer | null
    offset: number
    size: number
  }> = []
  /** WebGL2 sampler object 按纹理单元缓存。 */
  private readonly boundSamplers: (WebGLSampler | null)[] = []

  constructor(gl: GLContext, caps: Capabilities, maxAttributes: number) {
    this.gl = gl
    this.caps = caps
    // WebGL1 且没有 OES_vertex_array_object 时使用模拟 VAO
    this.emulatedVAO = !caps.hasVAO
    this.attributes = new Array(maxAttributes)
    for (let i = 0; i < maxAttributes; ++i) {
      this.attributes[i] = createAttributeBinding()
    }
    gl.getError()
  }

  /** 清除所有缓存，下一次调用会重新提交。（上下文恢复 / 外部修改 _gl 后使用） */
  invalidate(): void {
    this.flags.clear()
    this.program = null
    this.framebuffer = null
    this.framebufferColorCount = 0
    this.arrayBuffer = null
    this.elementBuffer = null
    this.viewportValue = [0, 0, 0, 0]
    this.scissorValue = [0, 0, 0, 0]
    this.colorMaskValue = [false, false, false, false]
    this.blendColorValue = [-1, -1, -1, -1]
    this.blendEquationValue = [-1, -1]
    this.blendFuncValue = [-1, -1, -1, -1]
    this.depthRangeValue = [-1, -1]
    this.stencilOpFrontValue = [-1, -1, -1]
    this.stencilOpBackValue = [-1, -1, -1]
    this.sampleCoverageValue = [-1, false]
    this.depthFuncValue = -1
    this.depthMaskValue = null
    this.cullFaceValue = -1
    this.frontFaceValue = -1
    this.lineWidthValue = -1
    this.polygonOffsetValue = [Number.NaN, Number.NaN]
    this.stencilMaskValue = Number.NaN
    this.stencilFuncValue = [Number.NaN, Number.NaN, Number.NaN]
    for (let i = 0; i < this.attributes.length; ++i) {
      const attr = this.attributes[i]
      attr.buffer = null
      attr.size = 0
      attr.type = 0
      attr.normalized = false
      attr.integer = false
      attr.stride = -1
      attr.offset = -1
      attr.divisor = -1
      attr.x = Number.NaN
      attr.y = Number.NaN
      attr.z = Number.NaN
      attr.w = Number.NaN
    }
    this.currentVAO = null
    this.programBlockBindings.clear()
    this.uniformBufferBindings.length = 0
    this.boundSamplers.length = 0
  }

  // -------------------------------------------------------------------------
  // 开关
  // -------------------------------------------------------------------------

  setFlag(capability: number, enabled: boolean): void {
    const prev = this.flags.get(capability)
    if (prev === enabled) return
    if (enabled) {
      this.gl.enable(capability)
    } else {
      this.gl.disable(capability)
    }
    this.flags.set(capability, enabled)
  }

  // -------------------------------------------------------------------------
  // Program / Framebuffer / Buffer
  // -------------------------------------------------------------------------

  useProgram(program: WebGLProgram | null): void {
    if (this.program === program) return
    this.gl.useProgram(program)
    this.program = program
  }

  get currentProgram(): WebGLProgram | null {
    return this.program
  }

  /**
   * 绑定 framebuffer，并同步 drawBuffers。
   * @param colorCount 颜色附件数量；0 表示默认帧缓冲。
   */
  bindFramebuffer(framebuffer: WebGLFramebuffer | null, colorCount = 0): void {
    if (this.framebuffer === framebuffer && this.framebufferColorCount === colorCount) {
      return
    }
    this.gl.bindFramebuffer(GL.FRAMEBUFFER, framebuffer)
    this.framebuffer = framebuffer
    this.framebufferColorCount = colorCount

    if (this.caps.hasDrawBuffers) {
      if (framebuffer) {
        const buffers = new Array(colorCount)
        for (let i = 0; i < colorCount; ++i) {
          buffers[i] = GL.COLOR_ATTACHMENT0 + i
        }
        // 颜色附件数量为 0 时不能调用 drawBuffers([])
        if (colorCount > 0) {
          this.capsDrawBuffers(buffers)
        }
      } else {
        this.capsDrawBuffers([GL.BACK])
      }
    }
  }

  get currentFramebuffer(): WebGLFramebuffer | null {
    return this.framebuffer
  }

  private capsDrawBuffers(buffers: number[]): void {
    this.caps.drawBuffers(buffers)
  }

  bindArrayBuffer(buffer: WebGLBuffer | null): void {
    if (this.arrayBuffer === buffer) return
    this.gl.bindBuffer(GL.ARRAY_BUFFER, buffer)
    this.arrayBuffer = buffer
  }

  bindElementBuffer(buffer: WebGLBuffer | null): void {
    if (this.elementBuffer === buffer) return
    this.gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, buffer)
    this.elementBuffer = buffer
  }

  get currentElementBuffer(): WebGLBuffer | null {
    return this.elementBuffer
  }

  // -------------------------------------------------------------------------
  // 矩形 / 视口
  // -------------------------------------------------------------------------

  viewport(x: number, y: number, width: number, height: number): void {
    const v = this.viewportValue
    if (v[0] === x && v[1] === y && v[2] === width && v[3] === height) return
    this.gl.viewport(x, y, width, height)
    v[0] = x
    v[1] = y
    v[2] = width
    v[3] = height
  }

  scissor(x: number, y: number, width: number, height: number): void {
    const s = this.scissorValue
    if (s[0] === x && s[1] === y && s[2] === width && s[3] === height) return
    this.gl.scissor(x, y, width, height)
    s[0] = x
    s[1] = y
    s[2] = width
    s[3] = height
  }

  // -------------------------------------------------------------------------
  // 各状态
  // -------------------------------------------------------------------------

  colorMask(r: boolean, g: boolean, b: boolean, a: boolean): void {
    const c = this.colorMaskValue
    if (c[0] === r && c[1] === g && c[2] === b && c[3] === a) return
    this.gl.colorMask(r, g, b, a)
    c[0] = r
    c[1] = g
    c[2] = b
    c[3] = a
  }

  blendColor(r: number, g: number, b: number, a: number): void {
    const c = this.blendColorValue
    if (c[0] === r && c[1] === g && c[2] === b && c[3] === a) return
    this.gl.blendColor(r, g, b, a)
    c[0] = r
    c[1] = g
    c[2] = b
    c[3] = a
  }

  blendEquation(rgb: number, alpha: number): void {
    const e = this.blendEquationValue
    if (e[0] === rgb && e[1] === alpha) return
    this.gl.blendEquationSeparate(rgb, alpha)
    e[0] = rgb
    e[1] = alpha
  }

  blendFunc(srcRGB: number, dstRGB: number, srcAlpha: number, dstAlpha: number): void {
    const f = this.blendFuncValue
    if (
      f[0] === srcRGB &&
      f[1] === dstRGB &&
      f[2] === srcAlpha &&
      f[3] === dstAlpha
    ) {
      return
    }
    this.gl.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha)
    f[0] = srcRGB
    f[1] = dstRGB
    f[2] = srcAlpha
    f[3] = dstAlpha
  }

  depthFunc(func: number): void {
    if (this.depthFuncValue === func) return
    this.gl.depthFunc(func)
    this.depthFuncValue = func
  }

  depthRange(near: number, far: number): void {
    const r = this.depthRangeValue
    if (r[0] === near && r[1] === far) return
    this.gl.depthRange(near, far)
    r[0] = near
    r[1] = far
  }

  depthMask(mask: boolean): void {
    if (this.depthMaskValue === mask) return
    this.gl.depthMask(mask)
    this.depthMaskValue = mask
  }

  cullFace(face: number): void {
    if (this.cullFaceValue === face) return
    this.gl.cullFace(face)
    this.cullFaceValue = face
  }

  frontFace(mode: number): void {
    if (this.frontFaceValue === mode) return
    this.gl.frontFace(mode)
    this.frontFaceValue = mode
  }

  lineWidth(width: number): void {
    if (this.lineWidthValue === width) return
    this.gl.lineWidth(width)
    this.lineWidthValue = width
  }

  polygonOffset(factor: number, units: number): void {
    const v = this.polygonOffsetValue
    if (v[0] === factor && v[1] === units) return
    this.gl.polygonOffset(factor, units)
    v[0] = factor
    v[1] = units
  }

  sampleCoverage(value: number, invert: boolean): void {
    const c = this.sampleCoverageValue
    if (c[0] === value && c[1] === invert) return
    this.gl.sampleCoverage(value, invert)
    c[0] = value
    c[1] = invert
  }

  stencilMask(mask: number): void {
    if (this.stencilMaskValue === mask) return
    this.gl.stencilMask(mask)
    this.stencilMaskValue = mask
  }

  stencilFunc(func: number, ref: number, mask: number): void {
    const v = this.stencilFuncValue
    if (v[0] === func && v[1] === ref && v[2] === mask) return
    this.gl.stencilFunc(func, ref, mask)
    v[0] = func
    v[1] = ref
    v[2] = mask
  }

  stencilOpFront(fail: number, zfail: number, zpass: number): void {
    const v = this.stencilOpFrontValue
    if (v[0] === fail && v[1] === zfail && v[2] === zpass) return
    this.gl.stencilOpSeparate(GL.FRONT, fail, zfail, zpass)
    v[0] = fail
    v[1] = zfail
    v[2] = zpass
  }

  stencilOpBack(fail: number, zfail: number, zpass: number): void {
    const v = this.stencilOpBackValue
    if (v[0] === fail && v[1] === zfail && v[2] === zpass) return
    this.gl.stencilOpSeparate(GL.BACK, fail, zfail, zpass)
    v[0] = fail
    v[1] = zfail
    v[2] = zpass
  }

  // -------------------------------------------------------------------------
  // 顶点属性
  // -------------------------------------------------------------------------

  /** 应用一个顶点属性指针（buffer 方式）。 */
  setAttributePointer(
    location: number,
    pointer: AttributePointer
  ): void {
    const binding = this.attributes[location]
    if (!binding) return

    if (binding.buffer === null) {
      this.gl.enableVertexAttribArray(location)
    }
    if (binding.buffer !== pointer.buffer) {
      this.gl.bindBuffer(GL.ARRAY_BUFFER, pointer.buffer)
      this.arrayBuffer = pointer.buffer
    }
    if (
      binding.buffer !== pointer.buffer ||
      binding.size !== pointer.size ||
      binding.type !== pointer.type ||
      binding.normalized !== pointer.normalized ||
      binding.integer !== !!pointer.integer ||
      binding.stride !== pointer.stride ||
      binding.offset !== pointer.offset
    ) {
      if (pointer.integer) {
        ;(this.gl as WebGL2RenderingContext).vertexAttribIPointer(
          location,
          pointer.size,
          pointer.type,
          pointer.stride,
          pointer.offset
        )
      } else {
        this.gl.vertexAttribPointer(
          location,
          pointer.size,
          pointer.type,
          pointer.normalized,
          pointer.stride,
          pointer.offset
        )
      }
      binding.size = pointer.size
      binding.type = pointer.type
      binding.normalized = !!pointer.normalized
      binding.integer = !!pointer.integer
      binding.stride = pointer.stride
      binding.offset = pointer.offset
    }
    binding.buffer = pointer.buffer
    binding.x = 0
    binding.y = 0
    binding.z = 0
    binding.w = 0

    if (this.caps.hasInstancing && binding.divisor !== pointer.divisor) {
      this.instancingDivisor(location, pointer.divisor)
      binding.divisor = pointer.divisor
    }
  }

  /** 应用常量顶点属性。 */
  setAttributeConstant(
    location: number,
    x: number,
    y: number,
    z: number,
    w: number,
    integer = false
  ): void {
    const binding = this.attributes[location]
    if (!binding) return
    if (binding.buffer !== null) {
      this.gl.disableVertexAttribArray(location)
      binding.buffer = null
      binding.divisor = 0
    }
    if (
      binding.x !== x ||
      binding.y !== y ||
      binding.z !== z ||
      binding.w !== w ||
      binding.integer !== integer
    ) {
      if (integer) {
        ;(this.gl as WebGL2RenderingContext).vertexAttribI4i(
          location,
          x | 0,
          y | 0,
          z | 0,
          w | 0
        )
      } else {
        this.gl.vertexAttrib4f(location, x, y, z, w)
      }
      binding.x = x
      binding.y = y
      binding.z = z
      binding.w = w
      binding.integer = integer
    }
  }

  private instancingDivisor(location: number, divisor: number): void {
    this.caps.vertexAttribDivisor(location, divisor)
  }

  /**
   * 设置 program 中某个 uniform block 的 binding point。
   * WebGL2 中 block binding 是 per-program 状态，这里做二次缓存避免重复调用。
   */
  uniformBlockBinding(
    program: WebGLProgram,
    blockIndex: number,
    binding: number
  ): void {
    let bindings = this.programBlockBindings.get(program)
    if (!bindings) {
      bindings = new Map()
      this.programBlockBindings.set(program, bindings)
    }
    if (bindings.get(blockIndex) === binding) return
    ;(this.gl as WebGL2RenderingContext).uniformBlockBinding(
      program,
      blockIndex,
      binding
    )
    bindings.set(blockIndex, binding)
  }

  /**
   * 绑定 UBO 到 indexed binding point。
   * size > 0 时使用 bindBufferRange，否则使用 bindBufferBase。
   */
  bindUniformBuffer(
    program: WebGLProgram,
    blockIndex: number,
    binding: number,
    buffer: WebGLBuffer | null,
    offset = 0,
    size = 0
  ): void {
    this.uniformBlockBinding(program, blockIndex, binding)

    const current = this.uniformBufferBindings[binding]
    if (
      current &&
      current.buffer === buffer &&
      current.offset === offset &&
      current.size === size
    ) {
      return
    }

    const gl = this.gl as WebGL2RenderingContext
    if (size > 0) {
      gl.bindBufferRange(GL.UNIFORM_BUFFER, binding, buffer, offset, size)
    } else {
      gl.bindBufferBase(GL.UNIFORM_BUFFER, binding, buffer)
    }
    this.uniformBufferBindings[binding] = { buffer, offset, size }
  }

  /** program 销毁时清理 block binding 缓存。 */
  forgetProgram(program: WebGLProgram | null): void {
    if (program) this.programBlockBindings.delete(program)
  }

  /** 某个 UBO 被销毁时，清空所有指向它的 indexed binding。 */
  forgetUniformBuffer(buffer: WebGLBuffer | null): void {
    if (!buffer) return
    const gl = this.gl as WebGL2RenderingContext
    for (let i = 0; i < this.uniformBufferBindings.length; ++i) {
      const binding = this.uniformBufferBindings[i]
      if (binding && binding.buffer === buffer) {
        gl.bindBufferBase(GL.UNIFORM_BUFFER, i, null)
        this.uniformBufferBindings[i] = {
          buffer: null,
          offset: 0,
          size: 0
        }
      }
    }
  }
  /** 绑定 sampler object 到纹理单元；相同则跳过。 */
  bindSampler(unit: number, sampler: WebGLSampler | null): void {
    if (!this.caps.isWebGL2) return
    if (this.boundSamplers[unit] === sampler) return
    ;(this.gl as WebGL2RenderingContext).bindSampler(unit, sampler)
    this.boundSamplers[unit] = sampler
  }

  /** 解绑所有已记录的 sampler（用于 refresh / 手动重置状态）。 */
  unbindAllSamplers(): void {
    for (let i = 0; i < this.boundSamplers.length; ++i) {
      if (this.boundSamplers[i]) {
        ;(this.gl as WebGL2RenderingContext).bindSampler(i, null)
        this.boundSamplers[i] = null
      }
    }
  }

  /** sampler 被销毁时解绑所有引用它的纹理单元。 */
  forgetSampler(sampler: WebGLSampler | null): void {
    if (!sampler) return
    for (let i = 0; i < this.boundSamplers.length; ++i) {
      if (this.boundSamplers[i] === sampler) {
        this.bindSampler(i, null)
      }
    }
  }

  /**
   * 某个 buffer 被销毁时，清除所有指向它的顶点属性 / 索引 / UBO 绑定。
   */
  forgetBuffer(handle: WebGLBuffer | null): void {
    if (!handle) return
    this.forgetUniformBuffer(handle)
    for (let i = 0; i < this.attributes.length; ++i) {
      const attr = this.attributes[i]
      if (attr.buffer === handle) {
        this.gl.disableVertexAttribArray(i)
        attr.buffer = null
        attr.size = 0
        attr.type = 0
        attr.integer = false
        attr.stride = -1
        attr.offset = -1
        attr.divisor = 0
      }
    }
    if (this.arrayBuffer === handle) this.arrayBuffer = null
    if (this.elementBuffer === handle) {
      this.gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, null)
      this.elementBuffer = null
    }
  }

  /**
   * 切换 VAO 后必须清空属性缓存：每个 VAO 保存自己的一套属性绑定。
   * 对模拟 VAO 则直接重新绑定属性。
   */
  invalidateVertexArrays(): void {
    for (let i = 0; i < this.attributes.length; ++i) {
      const attr = this.attributes[i]
      attr.buffer = null
      attr.size = 0
      attr.type = 0
      attr.integer = false
      attr.stride = -1
      attr.offset = -1
      attr.divisor = -1
      attr.x = Number.NaN
      attr.y = Number.NaN
      attr.z = Number.NaN
      attr.w = Number.NaN
    }
    this.elementBuffer = null
    this.arrayBuffer = null
  }
}

// ---------------------------------------------------------------------------
// 状态值校验与提交
// ---------------------------------------------------------------------------

function isArrayLikeValue(value: unknown): value is ArrayLike<number> {
  return Array.isArray(value) || ArrayBuffer.isView(value)
}

/** 校验并提交一个状态值。动态值每帧走这里，静态值也复用同一套逻辑。 */
export function applyStateValue(
  cache: GLStateCache,
  name: StateName,
  value: unknown,
  command?: string
): void {
  switch (name) {
    case 'dither':
      cache.setFlag(GL.DITHER, !!checkBoolean(value, name, command))
      break

    case 'blend.enable':
      cache.setFlag(GL.BLEND, !!checkBoolean(value, name, command))
      break

    case 'blend.color': {
      checkCommand(
        isArrayLikeValue(value) && value.length === 4,
        `${name} must be a 4d array`,
        command
      )
      const v = value as ArrayLike<number>
      cache.blendColor(+v[0], +v[1], +v[2], +v[3])
      break
    }

    case 'blend.equation': {
      if (typeof value === 'string') {
        checkParameter(value, blendEquations, name)
        const eq = blendEquations[value]
        cache.blendEquation(eq, eq)
      } else if (value && typeof value === 'object') {
        const eq = value as { rgb?: string; alpha?: string }
        checkParameter(eq.rgb, blendEquations, `${name}.rgb`)
        checkParameter(eq.alpha, blendEquations, `${name}.alpha`)
        cache.blendEquation(blendEquations[eq.rgb!], blendEquations[eq.alpha!])
      } else {
        checkCommand(false, 'invalid blend.equation', command)
      }
      break
    }

    case 'blend.func': {
      checkCommand(
        !!value && typeof value === 'object',
        'invalid blend.func, must be an object',
        command
      )
      const func = value as {
        srcRGB?: string
        srcAlpha?: string
        dstRGB?: string
        dstAlpha?: string
        src?: string
        dst?: string
      }
      const srcRGB = 'srcRGB' in func ? func.srcRGB : func.src
      const srcAlpha = 'srcAlpha' in func ? func.srcAlpha : func.src
      const dstRGB = 'dstRGB' in func ? func.dstRGB : func.dst
      const dstAlpha = 'dstAlpha' in func ? func.dstAlpha : func.dst
      checkParameter(srcRGB, blendFuncs, `${name}.srcRGB`)
      checkParameter(srcAlpha, blendFuncs, `${name}.srcAlpha`)
      checkParameter(dstRGB, blendFuncs, `${name}.dstRGB`)
      checkParameter(dstAlpha, blendFuncs, `${name}.dstAlpha`)
      checkCommand(
        invalidBlendCombinations.indexOf(`${srcRGB}, ${dstRGB}`) === -1,
        `unallowed blending combination (srcRGB, dstRGB) = (${srcRGB}, ${dstRGB})`,
        command
      )
      cache.blendFunc(
        blendFuncs[srcRGB!],
        blendFuncs[dstRGB!],
        blendFuncs[srcAlpha!],
        blendFuncs[dstAlpha!]
      )
      break
    }

    case 'depth.enable':
      cache.setFlag(GL.DEPTH_TEST, !!checkBoolean(value, name, command))
      break

    case 'depth.func':
      checkParameter(value, compareFuncs, name)
      cache.depthFunc(compareFuncs[value as string])
      break

    case 'depth.range':
      checkCommand(
        isArrayLikeValue(value) &&
          value.length === 2 &&
          typeof value[0] === 'number' &&
          typeof value[1] === 'number' &&
          value[0] <= value[1],
        'depth range is 2d array',
        command
      )
      cache.depthRange(+(value as ArrayLike<number>)[0], +(value as ArrayLike<number>)[1])
      break

    case 'depth.mask':
      cache.depthMask(!!checkBoolean(value, name, command))
      break

    case 'colorMask': {
      checkCommand(
        isArrayLikeValue(value) && value.length === 4,
        'color.mask must be length 4 array',
        command
      )
      const v = value as ArrayLike<unknown>
      cache.colorMask(!!v[0], !!v[1], !!v[2], !!v[3])
      break
    }

    case 'cull.enable':
      cache.setFlag(GL.CULL_FACE, !!checkBoolean(value, name, command))
      break

    case 'cull.face':
      checkCommand(
        value === 'front' || value === 'back',
        'invalid cull.face',
        command
      )
      cache.cullFace(value === 'front' ? GL.FRONT : GL.BACK)
      break

    case 'frontFace':
      checkParameter(value, orientationTypes, name)
      cache.frontFace(orientationTypes[value as string])
      break

    case 'lineWidth': {
      const width = value as number
      checkCommand(
        typeof width === 'number' && width > 0,
        'invalid line width, must be a positive number',
        command
      )
      cache.lineWidth(width)
      break
    }

    case 'polygonOffset.enable':
      cache.setFlag(GL.POLYGON_OFFSET_FILL, !!checkBoolean(value, name, command))
      break

    case 'polygonOffset.offset': {
      checkCommand(
        !!value && typeof value === 'object',
        'invalid polygonOffset.offset',
        command
      )
      const offset = value as { factor?: number; units?: number }
      cache.polygonOffset(+(offset.factor || 0), +(offset.units || 0))
      break
    }

    case 'sample.alpha':
      cache.setFlag(
        GL.SAMPLE_ALPHA_TO_COVERAGE,
        !!checkBoolean(value, name, command)
      )
      break

    case 'sample.enable':
      cache.setFlag(GL.SAMPLE_COVERAGE, !!checkBoolean(value, name, command))
      break

    case 'sample.coverage': {
      checkCommand(
        !!value && typeof value === 'object',
        'invalid sample.coverage',
        command
      )
      const cov = value as { value?: number; invert?: boolean }
      const covValue = cov.value === undefined ? 1 : +cov.value
      checkCommand(
        covValue >= 0 && covValue <= 1,
        'sample.coverage.value must be a number between 0 and 1',
        command
      )
      cache.sampleCoverage(covValue, !!cov.invert)
      break
    }

    case 'stencil.enable':
      cache.setFlag(GL.STENCIL_TEST, !!checkBoolean(value, name, command))
      break

    case 'stencil.mask': {
      checkCommandType(value, 'number', 'invalid stencil.mask', command)
      cache.stencilMask((value as number) | 0)
      break
    }

    case 'stencil.func': {
      checkCommand(
        !!value && typeof value === 'object',
        'invalid stencil.func',
        command
      )
      const func = value as { cmp?: string; ref?: number; mask?: number }
      const cmp = func.cmp || 'always'
      checkParameter(cmp, compareFuncs, `${name}.cmp`)
      cache.stencilFunc(
        compareFuncs[cmp],
        (func.ref || 0) | 0,
        ('mask' in func ? func.mask! : -1) | 0
      )
      break
    }

    case 'stencil.opFront':
    case 'stencil.opBack': {
      checkCommand(
        !!value && typeof value === 'object',
        `invalid ${name}`,
        command
      )
      const op = value as { fail?: string; zfail?: string; zpass?: string }
      const fail = op.fail || 'keep'
      const zfail = op.zfail || 'keep'
      const zpass = op.zpass || 'keep'
      checkParameter(fail, stencilOps, `${name}.fail`)
      checkParameter(zfail, stencilOps, `${name}.zfail`)
      checkParameter(zpass, stencilOps, `${name}.zpass`)
      if (name === 'stencil.opFront') {
        cache.stencilOpFront(stencilOps[fail], stencilOps[zfail], stencilOps[zpass])
      } else {
        cache.stencilOpBack(stencilOps[fail], stencilOps[zfail], stencilOps[zpass])
      }
      break
    }

    case 'scissor.enable':
      cache.setFlag(GL.SCISSOR_TEST, !!checkBoolean(value, name, command))
      break

    case 'scissor.box': {
      const box = value as Partial<Box> | null | undefined
      checkCommand(
        !!box && typeof box === 'object',
        'invalid scissor.box',
        command
      )
      cache.scissor(
        box!.x! | 0,
        box!.y! | 0,
        box!.width! | 0,
        box!.height! | 0
      )
      break
    }

    case 'viewport': {
      const box = value as Partial<Box> | null | undefined
      checkCommand(!!box && typeof box === 'object', 'invalid viewport', command)
      cache.viewport(
        box!.x! | 0,
        box!.y! | 0,
        box!.width! | 0,
        box!.height! | 0
      )
      break
    }

    default:
      checkCommand(false, `unknown state option ${name}`, command)
  }
}

function checkBoolean(value: unknown, name: string, command?: string): boolean {
  if (typeof value === 'boolean') return value
  // regl 允许 0/1，但类型严格只有 boolean；这里对动态值做兼容
  if (value === 0 || value === 1) return !!value
  checkCommand(false, `invalid flag ${name}`, command)
  return false
}

/** 校验静态状态值，提前暴露错误（动态值在绘制时才会校验）。 */
export function validateStateValue(
  name: StateName,
  value: unknown,
  command?: string
): void {
  // 复用 applyStateValue 的校验逻辑，但不实际提交 GL。
  // 用一个轻量「空缓存」会依赖真实上下文，这里直接做类型检查。
  switch (name) {
    case 'dither':
    case 'blend.enable':
    case 'depth.enable':
    case 'depth.mask':
    case 'cull.enable':
    case 'polygonOffset.enable':
    case 'sample.alpha':
    case 'sample.enable':
    case 'stencil.enable':
    case 'scissor.enable': {
      if (typeof value !== 'boolean') {
        checkCommand(false, `invalid flag ${name}`, command)
      }
      break
    }
    case 'blend.color':
      checkCommand(
        isArrayLikeValue(value) && value.length === 4,
        'blend.color must be a 4d array',
        command
      )
      break
    case 'colorMask':
      checkCommand(
        isArrayLikeValue(value) && value.length === 4,
        'color.mask must be length 4 array',
        command
      )
      break
    case 'depth.func':
      checkParameter(value, compareFuncs, name)
      break
    case 'depth.range':
      checkCommand(
        isArrayLikeValue(value) &&
          value.length === 2 &&
          typeof value[0] === 'number' &&
          typeof value[1] === 'number' &&
          value[0] <= value[1],
        'depth range is 2d array',
        command
      )
      break
    case 'blend.func': {
      checkCommand(
        !!value && typeof value === 'object',
        'invalid blend.func, must be an object',
        command
      )
      const func = value as Record<string, string>
      const srcRGB = 'srcRGB' in func ? func.srcRGB : func.src
      const srcAlpha = 'srcAlpha' in func ? func.srcAlpha : func.src
      const dstRGB = 'dstRGB' in func ? func.dstRGB : func.dst
      const dstAlpha = 'dstAlpha' in func ? func.dstAlpha : func.dst
      checkParameter(srcRGB, blendFuncs, 'blend.func.srcRGB')
      checkParameter(srcAlpha, blendFuncs, 'blend.func.srcAlpha')
      checkParameter(dstRGB, blendFuncs, 'blend.func.dstRGB')
      checkParameter(dstAlpha, blendFuncs, 'blend.func.dstAlpha')
      checkCommand(
        invalidBlendCombinations.indexOf(`${srcRGB}, ${dstRGB}`) === -1,
        `unallowed blending combination (srcRGB, dstRGB) = (${srcRGB}, ${dstRGB})`,
        command
      )
      break
    }
    case 'blend.equation':
      if (typeof value === 'string') {
        checkParameter(value, blendEquations, name)
      } else if (value && typeof value === 'object') {
        const eq = value as Record<string, string>
        checkParameter(eq.rgb, blendEquations, `${name}.rgb`)
        checkParameter(eq.alpha, blendEquations, `${name}.alpha`)
      } else {
        checkCommand(false, 'invalid blend.equation', command)
      }
      break
    case 'cull.face':
      checkCommand(
        value === 'front' || value === 'back',
        'invalid cull.face',
        command
      )
      break
    case 'frontFace':
      checkParameter(value, orientationTypes, name)
      break
    case 'lineWidth':
      checkCommand(
        typeof value === 'number' && value > 0,
        'invalid line width, must be a positive number',
        command
      )
      break
    case 'polygonOffset.offset':
      checkCommand(
        !!value && typeof value === 'object',
        'invalid polygonOffset.offset',
        command
      )
      break
    case 'sample.coverage': {
      checkCommand(
        !!value && typeof value === 'object',
        'invalid sample.coverage',
        command
      )
      const cov = value as { value?: number }
      const covValue = cov.value === undefined ? 1 : +cov.value
      checkCommand(
        covValue >= 0 && covValue <= 1,
        'sample.coverage.value must be a number between 0 and 1',
        command
      )
      break
    }
    case 'stencil.mask':
      checkCommandType(value, 'number', 'invalid stencil.mask', command)
      break
    case 'stencil.func': {
      checkCommand(
        !!value && typeof value === 'object',
        'invalid stencil.func',
        command
      )
      const func = value as Record<string, unknown>
      checkParameter(func.cmp || 'always', compareFuncs, `${name}.cmp`)
      break
    }
    case 'stencil.opFront':
    case 'stencil.opBack': {
      checkCommand(
        !!value && typeof value === 'object',
        `invalid ${name}`,
        command
      )
      const op = value as Record<string, string>
      checkParameter(op.fail || 'keep', stencilOps, `${name}.fail`)
      checkParameter(op.zfail || 'keep', stencilOps, `${name}.zfail`)
      checkParameter(op.zpass || 'keep', stencilOps, `${name}.zpass`)
      break
    }
    case 'scissor.box':
    case 'viewport': {
      checkCommand(!!value && typeof value === 'object', `invalid ${name}`, command)
      const box = value as Record<string, unknown>
      if ('width' in box) {
        checkCommand(
          typeof box.width === 'number' && box.width >= 0,
          `invalid ${name}`,
          command
        )
      }
      if ('height' in box) {
        checkCommand(
          typeof box.height === 'number' && box.height >= 0,
          `invalid ${name}`,
          command
        )
      }
      break
    }
    default:
      break
  }
}

/** 检查状态名是否在合法列表中；供测试使用。 */
export function assertKnownStateName(name: string): asserts name is StateName {
  check(isStateName(name), `unknown state ${name}`)
}
