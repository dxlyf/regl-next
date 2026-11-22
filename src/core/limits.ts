/**
 * 设备能力 / 限制查询。
 *
 * 返回对象会直接暴露为 `regl.limits`，字段名与 regl 2.x 保持兼容，
 * 同时补充 WebGL2 特有的限制值。
 */

import { GL } from '../util/constants'
import type { Capabilities, GLContext } from './capabilities'

export interface Limits {
  // 帧缓冲位深
  colorBits: [number, number, number, number]
  depthBits: number
  stencilBits: number
  subpixelBits: number

  // 扩展
  extensions: string[]

  // 各向异性过滤
  maxAnisotropic: number

  // 多渲染目标
  maxDrawbuffers: number
  maxColorAttachments: number

  // 尺寸
  pointSizeDims: Float32Array | number[]
  lineWidthDims: Float32Array | number[]
  maxViewportDims: Int32Array | number[]
  maxCombinedTextureUnits: number
  maxCubeMapSize: number
  maxRenderbufferSize: number
  maxTextureUnits: number
  maxTextureSize: number
  maxAttributes: number
  maxVertexUniforms: number
  maxVertexTextureUnits: number
  maxVaryingVectors: number
  maxFragmentUniforms: number

  // 驱动信息
  glsl: string
  renderer: string
  vendor: string
  version: string

  // 兼容性/怪癖
  readFloat: boolean
  npotTextureCube: boolean

  // 纹理格式（由 texture 模块在初始化时补充）
  textureFormats: string[]

  // -------------------------------------------------------------------------
  // 以下为 WebGL2 增强字段
  // -------------------------------------------------------------------------
  isWebGL2: boolean
  max3DTextureSize: number
  maxArrayTextureLayers: number
  maxSamples: number
  maxElementIndex: number
  maxUniformBlockSize: number
  maxUniformBufferBindings: number
  uniformBufferOffsetAlignment: number
  maxVertexOutputComponents: number
  maxFragmentInputComponents: number
  maxRenderbufferSamples: number
}

// WebGL2 专属枚举（用字面量避免依赖 WebGL2RenderingContext 类型）
const MAX_3D_TEXTURE_SIZE = 0x8073
const MAX_ARRAY_TEXTURE_LAYERS = 0x88ff
const MAX_SAMPLES = 0x8d57
const MAX_ELEMENT_INDEX = 0x8d6b
const MAX_UNIFORM_BLOCK_SIZE = 0x8a30
const MAX_UNIFORM_BUFFER_BINDINGS = 0x8a2f
const MAX_VERTEX_OUTPUT_COMPONENTS = 0x9122
const MAX_FRAGMENT_INPUT_COMPONENTS = 0x9125
const MAX_RENDERBUFFER_SIZE = 0x84e8
const MAX_SAMPLES_WEBGL2 = 0x8d57
// WEBGL_multisampled_render_to_texture
const MAX_SAMPLES_EXT = 0x8d57

function param(gl: GLContext, pname: number): number {
  return gl.getParameter(pname) as number
}

/** 构建 limits 对象。 */
export function buildLimits(gl: GLContext, caps: Capabilities): Limits {
  const isWebGL2 = caps.isWebGL2

  const limits: Limits = {
    colorBits: [
      param(gl, 0x0d52), // RED_BITS
      param(gl, 0x0d53), // GREEN_BITS
      param(gl, 0x0d54), // BLUE_BITS
      param(gl, 0x0d55) // ALPHA_BITS
    ],
    depthBits: param(gl, 0x0d56),
    stencilBits: param(gl, 0x0d57),
    subpixelBits: param(gl, 0x0d50),

    extensions: caps.list(),

    maxAnisotropic: caps.maxAnisotropy,

    maxDrawbuffers: caps.maxDrawBuffers,
    maxColorAttachments: caps.maxColorAttachments,

    pointSizeDims: gl.getParameter(0x846d) as Float32Array,
    lineWidthDims: gl.getParameter(0x846e) as Float32Array,
    maxViewportDims: gl.getParameter(0x0d3a) as Int32Array,
    maxCombinedTextureUnits: param(gl, 0x8b4d),
    maxCubeMapSize: param(gl, 0x851c),
    maxRenderbufferSize: param(gl, MAX_RENDERBUFFER_SIZE),
    maxTextureUnits: param(gl, 0x8872),
    maxTextureSize: param(gl, 0x0d33),
    maxAttributes: param(gl, 0x8869),
    maxVertexUniforms: param(gl, 0x8dfb),
    maxVertexTextureUnits: param(gl, 0x8b4c),
    maxVaryingVectors: param(gl, 0x8dfc),
    maxFragmentUniforms: param(gl, 0x8dfd),

    glsl: gl.getParameter(GL.SHADING_LANGUAGE_VERSION) as string,
    renderer: gl.getParameter(GL.RENDERER) as string,
    vendor: gl.getParameter(GL.VENDOR) as string,
    version: gl.getParameter(GL.VERSION) as string,

    readFloat: caps.readFloat,
    npotTextureCube: caps.npotTextureCube,

    textureFormats: [],

    isWebGL2,
    max3DTextureSize: isWebGL2 ? param(gl, MAX_3D_TEXTURE_SIZE) : 0,
    maxArrayTextureLayers: isWebGL2 ? param(gl, MAX_ARRAY_TEXTURE_LAYERS) : 0,
    maxSamples: isWebGL2 ? param(gl, MAX_SAMPLES) : 0,
    maxElementIndex: isWebGL2
      ? param(gl, MAX_ELEMENT_INDEX)
      : caps.hasUintElements
        ? 0xffffffff
        : 0xffff,
    maxUniformBlockSize: isWebGL2 ? param(gl, MAX_UNIFORM_BLOCK_SIZE) : 0,
    maxUniformBufferBindings: isWebGL2 ? param(gl, MAX_UNIFORM_BUFFER_BINDINGS) : 0,
    uniformBufferOffsetAlignment: isWebGL2
      ? param(gl, GL.UNIFORM_BUFFER_OFFSET_ALIGNMENT)
      : 0,
    maxVertexOutputComponents: isWebGL2
      ? param(gl, MAX_VERTEX_OUTPUT_COMPONENTS)
      : 0,
    maxFragmentInputComponents: isWebGL2
      ? param(gl, MAX_FRAGMENT_INPUT_COMPONENTS)
      : 0,
    maxRenderbufferSamples: 0
  }

  // 避免未使用常量告警（同时保留可读性）
  void MAX_SAMPLES_WEBGL2
  void MAX_SAMPLES_EXT

  // EXT_multisampled_render_to_texture / WebGL2 多重采样能力
  const msaaExt = caps.get<{ MAX_SAMPLES_EXT?: number; samples?: number }>(
    'ext_multisampled_render_to_texture'
  )
  if (msaaExt && typeof msaaExt.samples === 'number') {
    limits.maxRenderbufferSamples = msaaExt.samples
  }

  return limits
}
