/**
 * WebGL 枚举常量与名称映射表。
 *
 * 设计说明：
 * - 这里刻意不复用 `WebGLRenderingContext` 实例上的常量，而是使用字面量。
 *   这样同一份代码可以同时运行在 WebGL1 / WebGL2 上下文上，也便于在
 *   worker、测试环境（没有 DOM）中使用。
 * - 所有表都使用 `as const`，在 TS 中可以得到字面量类型，避免魔法数字散落各处。
 */

// ---------------------------------------------------------------------------
// 基础 GL 枚举
// ---------------------------------------------------------------------------
export const GL = {
  NO_ERROR: 0,
  ZERO: 0,
  ONE: 1,

  DEPTH_BUFFER_BIT: 0x0100,
  STENCIL_BUFFER_BIT: 0x0400,
  COLOR_BUFFER_BIT: 0x4000,

  POINTS: 0,
  LINES: 1,
  LINE_LOOP: 2,
  LINE_STRIP: 3,
  TRIANGLES: 4,
  TRIANGLE_STRIP: 5,
  TRIANGLE_FAN: 6,

  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  UNIFORM_BUFFER: 0x8a11,
  UNIFORM_BUFFER_OFFSET_ALIGNMENT: 0x8a34,
  PIXEL_PACK_BUFFER: 0x88EB,
  PIXEL_UNPACK_BUFFER: 0x88EC,
  COPY_READ_BUFFER: 0x8F36,
  COPY_WRITE_BUFFER: 0x8F37,

  STREAM_DRAW: 0x88e0,
  STATIC_DRAW: 0x88e4,
  DYNAMIC_DRAW: 0x88e8,
  STREAM_READ: 0x88e1,
  STREAM_COPY: 0x88e2,
  STATIC_READ: 0x88e5,
  STATIC_COPY: 0x88e6,
  DYNAMIC_READ: 0x88e9,
  DYNAMIC_COPY: 0x88ea,

  BYTE: 0x1400,
  UNSIGNED_BYTE: 0x1401,
  SHORT: 0x1402,
  UNSIGNED_SHORT: 0x1403,
  INT: 0x1404,
  UNSIGNED_INT: 0x1405,
  FLOAT: 0x1406,
  HALF_FLOAT: 0x140b,
  // WebGL1 的 OES_texture_half_float 使用不同的枚举值
  HALF_FLOAT_OES: 0x8d61,

  // 压缩 / 打包像素类型
  UNSIGNED_SHORT_4_4_4_4: 0x8033,
  UNSIGNED_SHORT_5_5_5_1: 0x8034,
  UNSIGNED_SHORT_5_6_5: 0x8363,
  UNSIGNED_INT_24_8: 0x84fa,

  // 着色器
  FRAGMENT_SHADER: 0x8b30,
  VERTEX_SHADER: 0x8b31,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  VALIDATE_STATUS: 0x8b83,
  ACTIVE_UNIFORMS: 0x8b86,
  ACTIVE_ATTRIBUTES: 0x8b89,
  ACTIVE_UNIFORM_BLOCKS: 0x8a36,
  UNIFORM_BLOCK_BINDING: 0x8a3f,
  UNIFORM_BLOCK_DATA_SIZE: 0x8a40,
  UNIFORM_BLOCK_ACTIVE_UNIFORMS: 0x8a42,
  UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES: 0x8a43,
  UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER: 0x8a44,
  UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER: 0x8a46,
  UNIFORM_TYPE: 0x8a37,
  UNIFORM_SIZE: 0x8a38,
  UNIFORM_BLOCK_INDEX: 0x8a3a,
  UNIFORM_OFFSET: 0x8a3b,
  UNIFORM_ARRAY_STRIDE: 0x8a3c,
  UNIFORM_MATRIX_STRIDE: 0x8a3d,
  UNIFORM_IS_ROW_MAJOR: 0x8a3e,

  // uniform / attribute 类型
  FLOAT_VEC2: 0x8b50,
  FLOAT_VEC3: 0x8b51,
  FLOAT_VEC4: 0x8b52,
  INT_VEC2: 0x8b53,
  INT_VEC3: 0x8b54,
  INT_VEC4: 0x8b55,
  BOOL: 0x8b56,
  BOOL_VEC2: 0x8b57,
  BOOL_VEC3: 0x8b58,
  BOOL_VEC4: 0x8b59,
  FLOAT_MAT2: 0x8b5a,
  FLOAT_MAT3: 0x8b5b,
  FLOAT_MAT4: 0x8b5c,
  SAMPLER_2D: 0x8b5e,
  SAMPLER_CUBE: 0x8b60,
  SAMPLER_3D: 0x8b5f,
  SAMPLER_2D_SHADOW: 0x8b62,
  SAMPLER_2D_ARRAY: 0x8dc1,
  SAMPLER_2D_ARRAY_SHADOW: 0x8dc4,
  SAMPLER_CUBE_SHADOW: 0x8dc5,
  INT_SAMPLER_2D: 0x8dca,
  INT_SAMPLER_3D: 0x8dcb,
  INT_SAMPLER_CUBE: 0x8dcc,
  INT_SAMPLER_2D_ARRAY: 0x8dcf,
  UNSIGNED_INT_SAMPLER_2D: 0x8dd2,
  UNSIGNED_INT_SAMPLER_3D: 0x8dd3,
  UNSIGNED_INT_SAMPLER_CUBE: 0x8dd4,
  UNSIGNED_INT_SAMPLER_2D_ARRAY: 0x8dd7,
  FLOAT_MAT2x3: 0x8b65,
  FLOAT_MAT2x4: 0x8b66,
  FLOAT_MAT3x2: 0x8b67,
  FLOAT_MAT3x4: 0x8b68,
  FLOAT_MAT4x2: 0x8b69,
  FLOAT_MAT4x3: 0x8b6a,
  UNSIGNED_INT_VEC2: 0x8dc6,
  UNSIGNED_INT_VEC3: 0x8dc7,
  UNSIGNED_INT_VEC4: 0x8dc8,

  // 外部像素格式
  RGBA: 0x1908,
  RGB: 0x1907,
  ALPHA: 0x1906,
  LUMINANCE: 0x1909,
  LUMINANCE_ALPHA: 0x190a,
  RED: 0x1903,
  RG: 0x8227,
  RED_INTEGER: 0x8d94,
  RG_INTEGER: 0x8d98,
  RGB_INTEGER: 0x8d98,
  RGBA_INTEGER: 0x8d99,

  // 内部格式
  RGBA4: 0x8056,
  RGB5_A1: 0x8057,
  RGB565: 0x8d62,
  DEPTH_COMPONENT: 0x1902,
  DEPTH_STENCIL: 0x84f9,
  COLOR: 0x1800,
  DEPTH: 0x1801,
  STENCIL: 0x1802,

  // 纹理
  TEXTURE_2D: 0x0de1,
  TEXTURE_3D: 0x806f,
  TEXTURE_2D_ARRAY: 0x8c1a,
  TEXTURE_CUBE_MAP: 0x8513,
  TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
  TEXTURE_CUBE_MAP_NEGATIVE_X: 0x8516,
  TEXTURE_CUBE_MAP_POSITIVE_Y: 0x8517,
  TEXTURE_CUBE_MAP_NEGATIVE_Y: 0x8518,
  TEXTURE_CUBE_MAP_POSITIVE_Z: 0x8519,
  TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851a,

  TEXTURE0: 0x84c0,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  TEXTURE_WRAP_R: 0x8072,
  TEXTURE_MIN_LOD: 0x813a,
  TEXTURE_MAX_LOD: 0x813b,
  TEXTURE_LOD_BIAS: 0x8501,
  TEXTURE_COMPARE_MODE: 0x884c,
  TEXTURE_COMPARE_FUNC: 0x884d,
  COMPARE_REF_TO_TEXTURE: 0x884e,
  NONE: 0,
  TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe,

  NEAREST: 0x2600,
  LINEAR: 0x2601,
  NEAREST_MIPMAP_NEAREST: 0x2700,
  LINEAR_MIPMAP_NEAREST: 0x2701,
  NEAREST_MIPMAP_LINEAR: 0x2702,
  LINEAR_MIPMAP_LINEAR: 0x2703,

  REPEAT: 0x2901,
  CLAMP_TO_EDGE: 0x812f,
  MIRRORED_REPEAT: 0x8370,
  CLAMP_TO_BORDER: 0x812d,

  UNPACK_ALIGNMENT: 0x0cf5,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
  PACK_ALIGNMENT: 0x0d05,
  BROWSER_DEFAULT_WEBGL: 0x9244,
  DONT_CARE: 0x1100,
  FASTEST: 0x1101,
  NICEST: 0x1102,
  GENERATE_MIPMAP_HINT: 0x8192,

  // 帧缓冲
  FRAMEBUFFER: 0x8d40,
  READ_FRAMEBUFFER: 0x8ca8,
  DRAW_FRAMEBUFFER: 0x8ca9,
  RENDERBUFFER: 0x8d41,
  COLOR_ATTACHMENT0: 0x8ce0,
  DEPTH_ATTACHMENT: 0x8d00,
  STENCIL_ATTACHMENT: 0x8d20,
  DEPTH_STENCIL_ATTACHMENT: 0x821a,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  FRAMEBUFFER_INCOMPLETE_ATTACHMENT: 0x8cd6,
  FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: 0x8cd7,
  FRAMEBUFFER_INCOMPLETE_DIMENSIONS: 0x8cd9,
  FRAMEBUFFER_UNSUPPORTED: 0x8cdd,

  // 开关 / 状态
  DITHER: 0x0bd0,
  BLEND: 0x0be2,
  CULL_FACE: 0x0b44,
  DEPTH_TEST: 0x0b71,
  STENCIL_TEST: 0x0b90,
  SCISSOR_TEST: 0x0c11,
  POLYGON_OFFSET_FILL: 0x8037,
  SAMPLE_ALPHA_TO_COVERAGE: 0x809e,
  SAMPLE_COVERAGE: 0x80a0,

  FRONT: 0x0404,
  BACK: 0x0405,
  FRONT_AND_BACK: 0x0408,
  CW: 0x0900,
  CCW: 0x0901,

  NEVER: 0x0200,
  LESS: 0x0201,
  EQUAL: 0x0202,
  LEQUAL: 0x0203,
  GREATER: 0x0204,
  NOTEQUAL: 0x0205,
  GEQUAL: 0x0206,
  ALWAYS: 0x0207,

  KEEP: 0x1e00,
  REPLACE: 0x1e01,
  INCR: 0x1e02,
  DECR: 0x1e03,
  INVERT: 0x150a,
  INCR_WRAP: 0x8507,
  DECR_WRAP: 0x8508,

  FUNC_ADD: 0x8006,
  FUNC_SUBTRACT: 0x800a,
  FUNC_REVERSE_SUBTRACT: 0x800b,
  MIN_EXT: 0x8007,
  MAX_EXT: 0x8008,

  // blend factor
  SRC_COLOR: 0x0300,
  ONE_MINUS_SRC_COLOR: 0x0301,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  DST_ALPHA: 0x0304,
  ONE_MINUS_DST_ALPHA: 0x0305,
  DST_COLOR: 0x0306,
  ONE_MINUS_DST_COLOR: 0x0307,
  SRC_ALPHA_SATURATE: 0x0308,
  CONSTANT_COLOR: 0x8001,
  ONE_MINUS_CONSTANT_COLOR: 0x8002,
  CONSTANT_ALPHA: 0x8003,
  ONE_MINUS_CONSTANT_ALPHA: 0x8004,

  // 查询
  QUERY_RESULT_EXT: 0x8866,
  QUERY_RESULT_AVAILABLE_EXT: 0x8867,
  TIME_ELAPSED_EXT: 0x88bf,
  GPU_DISJOINT_EXT: 0x8fbb,

  // 其它
  SUPPORTED_EXTENSIONS: 0x1f03,
  COMPRESSED_TEXTURE_FORMATS: 0x86a3,
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff,
  MAX_DRAW_BUFFERS: 0x8824,
  MAX_COLOR_ATTACHMENTS: 0x8cdf,
  RENDERER: 0x1f01,
  VENDOR: 0x1f00,
  VERSION: 0x1f02,
  SHADING_LANGUAGE_VERSION: 0x8b8c
} as const

// ---------------------------------------------------------------------------
// 名称 -> 枚举 的映射表。
// regl 的 API 使用可读字符串（如 'triangles'、'one minus src alpha'），
// 这里保持完全兼容。
// ---------------------------------------------------------------------------

/** 图元类型。 */
export const primitiveTypes: Record<string, number> = {
  points: GL.POINTS,
  lines: GL.LINES,
  'line loop': GL.LINE_LOOP,
  'line strip': GL.LINE_STRIP,
  triangles: GL.TRIANGLES,
  'triangle strip': GL.TRIANGLE_STRIP,
  'triangle fan': GL.TRIANGLE_FAN
}

/** 顶点属性数据类型（buffer / elements 的 type）。 */
export const dataTypes: Record<string, number> = {
  int8: GL.BYTE,
  uint8: GL.UNSIGNED_BYTE,
  int16: GL.SHORT,
  uint16: GL.UNSIGNED_SHORT,
  int32: GL.INT,
  uint32: GL.UNSIGNED_INT,
  float32: GL.FLOAT,
  float: GL.FLOAT
}

/** 数据类型 -> 单元素字节数。 */
export const dataTypeSizes: Record<number, number> = {
  [GL.BYTE]: 1,
  [GL.UNSIGNED_BYTE]: 1,
  [GL.SHORT]: 2,
  [GL.UNSIGNED_SHORT]: 2,
  [GL.INT]: 4,
  [GL.UNSIGNED_INT]: 4,
  [GL.FLOAT]: 4,
  [GL.HALF_FLOAT]: 2,
  [GL.HALF_FLOAT_OES]: 2
}

/** buffer 用途。 */
export const usageTypes: Record<string, number> = {
  'static': GL.STATIC_DRAW,
  'dynamic': GL.DYNAMIC_DRAW,
  'stream': GL.STREAM_DRAW
}

/** 深度比较函数。 */
export const compareFuncs: Record<string, number> = {
  never: GL.NEVER,
  less: GL.LESS,
  '<': GL.LESS,
  equal: GL.EQUAL,
  '=': GL.EQUAL,
  '==': GL.EQUAL,
  '===': GL.EQUAL,
  lequal: GL.LEQUAL,
  '<=': GL.LEQUAL,
  greater: GL.GREATER,
  '>': GL.GREATER,
  notequal: GL.NOTEQUAL,
  '!=': GL.NOTEQUAL,
  '!==': GL.NOTEQUAL,
  gequal: GL.GEQUAL,
  '>=': GL.GEQUAL,
  always: GL.ALWAYS
}

/** 混合因子。 */
export const blendFuncs: Record<string, number> = {
  '0': GL.ZERO,
  '1': GL.ONE,
  'zero': GL.ZERO,
  'one': GL.ONE,
  'src color': GL.SRC_COLOR,
  'one minus src color': GL.ONE_MINUS_SRC_COLOR,
  'src alpha': GL.SRC_ALPHA,
  'one minus src alpha': GL.ONE_MINUS_SRC_ALPHA,
  'dst color': GL.DST_COLOR,
  'one minus dst color': GL.ONE_MINUS_DST_COLOR,
  'dst alpha': GL.DST_ALPHA,
  'one minus dst alpha': GL.ONE_MINUS_DST_ALPHA,
  'constant color': GL.CONSTANT_COLOR,
  'one minus constant color': GL.ONE_MINUS_CONSTANT_COLOR,
  'constant alpha': GL.CONSTANT_ALPHA,
  'one minus constant alpha': GL.ONE_MINUS_CONSTANT_ALPHA,
  'src alpha saturate': GL.SRC_ALPHA_SATURATE
}

/**
 * WebGL 规范禁止的一些 blend 组合（srcRGB 与 dstRGB 同时使用常量因子）。
 * 这些组合在部分驱动上会直接产生 INVALID_OPERATION。
 */
export const invalidBlendCombinations: string[] = [
  'constant color, constant alpha',
  'one minus constant color, constant alpha',
  'constant color, one minus constant alpha',
  'one minus constant color, one minus constant alpha',
  'constant alpha, constant color',
  'constant alpha, one minus constant color',
  'one minus constant alpha, constant color',
  'one minus constant alpha, one minus constant color'
]

/** 混合方程。 */
export const blendEquations: Record<string, number> = {
  add: GL.FUNC_ADD,
  subtract: GL.FUNC_SUBTRACT,
  'reverse subtract': GL.FUNC_REVERSE_SUBTRACT
}

/** 模板操作。 */
export const stencilOps: Record<string, number> = {
  '0': GL.ZERO,
  zero: GL.ZERO,
  keep: GL.KEEP,
  replace: GL.REPLACE,
  increment: GL.INCR,
  decrement: GL.DECR,
  'increment wrap': GL.INCR_WRAP,
  'decrement wrap': GL.DECR_WRAP,
  invert: GL.INVERT
}

/** 正面朝向。 */
export const orientationTypes: Record<string, number> = {
  cw: GL.CW,
  ccw: GL.CCW
}

/** 纹理环绕模式。 */
export const wrapModes: Record<string, number> = {
  repeat: GL.REPEAT,
  clamp: GL.CLAMP_TO_EDGE,
  mirror: GL.MIRRORED_REPEAT
}

/** 纹理放大过滤。 */
export const magFilters: Record<string, number> = {
  nearest: GL.NEAREST,
  linear: GL.LINEAR
}

/** 纹理缩小过滤（包含 mipmap 版本）。 */
export const minFilters: Record<string, number> = {
  nearest: GL.NEAREST,
  linear: GL.LINEAR,
  mipmap: GL.LINEAR_MIPMAP_LINEAR,
  'nearest mipmap nearest': GL.NEAREST_MIPMAP_NEAREST,
  'linear mipmap nearest': GL.LINEAR_MIPMAP_NEAREST,
  'nearest mipmap linear': GL.NEAREST_MIPMAP_LINEAR,
  'linear mipmap linear': GL.LINEAR_MIPMAP_LINEAR
}

/** mipmap 生成提示。 */
export const mipmapHints: Record<string, number> = {
  "don't care": GL.DONT_CARE,
  'dont care': GL.DONT_CARE,
  nice: GL.NICEST,
  fast: GL.FASTEST
}

/** 纹理颜色空间。 */
export const colorSpaces: Record<string, number> = {
  none: 0,
  browser: GL.BROWSER_DEFAULT_WEBGL
}

/** 反向表：枚举 -> 名称，用于暴露 texture.min / texture.format 等属性。 */
export function invertRecord(record: Record<string, number>): Record<number, string> {
  const result: Record<number, string> = {}
  for (const key of Object.keys(record)) {
    result[record[key]] = key
  }
  return result
}

export const magFiltersInverse = invertRecord(magFilters)
export const minFiltersInverse = invertRecord(minFilters)
export const wrapModesInverse = invertRecord(wrapModes)

/** 判断一个数是否是 2 的幂。 */
export function isPow2(v: number): boolean {
  return v > 0 && (v & (v - 1)) === 0
}
