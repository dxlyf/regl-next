/**
 * 纹理 / 立方体贴图资源。
 *
 * 与旧版实现相比的主要改进：
 * 1. 统一的「格式描述表」：WebGL1 的扩展格式与 WebGL2 的核心/尺寸格式放在同一张表里，
 *    自动根据上下文能力裁剪可用格式，`regl.limits.textureFormats` 也由此生成。
 * 2. 显式的像素描述（level / face / data / element / copy），上下文恢复时尽量
 *    重新上传原始数据，而不是只分配空存储。
 * 3. 支持 WebGL2 的 sized internal format、整数纹理、浮点纹理、sRGB、更多压缩格式。
 * 4. 数据转换（普通数组、ndarray、DOM 元素、压缩数据）集中处理，避免分支散落。
 *
 * 保留 regl 的调用风格：
 *   regl.texture(width, height)
 *   regl.texture({ width, height, format, type, data, ... })
 *   regl.cube(size)
 *   regl.cube({ faces: [...], ... })
 */

import {
  check,
  checkCommand,
  checkOneOf,
  checkParameter,
  isArrayLike,
  isNDArrayLike,
  isTypedArray,
  NDArrayLike
} from '../util/check'
import {
  allocType,
  arrayShape,
  convertToHalfFloat,
  flattenArray,
  freeType,
  typedArrayCode
} from '../util/data'
import {
  GL,
  colorSpaces,
  magFilters,
  magFiltersInverse,
  minFilters,
  minFiltersInverse,
  mipmapHints,
  wrapModes,
  wrapModesInverse,
  isPow2
} from '../util/constants'
import type { Capabilities, GLContext } from '../core/capabilities'
import type { Limits } from '../core/limits'
import { getBuffer, Buffer } from './buffer'

// ---------------------------------------------------------------------------
// 格式与类型表
// ---------------------------------------------------------------------------

export interface TextureFormatInfo {
  /** 用户可见名称。 */
  name: string
  /** GL 内部格式。WebGL2 下可能是 sized format。 */
  internalFormat: number
  /** 外部 format（texImage2D 的 format 参数）。 */
  format: number
  /** 通道数。 */
  channels: number
  /** 默认数据类型。 */
  type?: number
  /** 是否压缩格式。 */
  compressed?: boolean
  /** 每像素字节数（压缩格式为平均字节数）。 */
  bytesPerPixel: number
  /** 是否只允许特定 type。 */
  fixedType?: boolean
  /** WebGL2 专属格式。 */
  webgl2?: boolean
}

export interface TextureTypeInfo {
  name: string
  type: number
  /** 该类型是否要求浮点纹理扩展（WebGL1）。 */
  float?: boolean
  halfFloat?: boolean
  integer?: boolean
  webgl2?: boolean
}

interface FormatTables {
  formats: Map<string, TextureFormatInfo>
  types: Map<string, TextureTypeInfo>
  formatNames: Map<number, string>
  typeNames: Map<number, string>
}

// 常用 sized internal format 常量
const RGBA8 = 0x8058
const RGB8 = 0x8051
const SRGB8_ALPHA8 = 0x8c43
const SRGB8 = 0x8c41
const R8 = 0x8229
const RG8 = 0x822b
const R16F = 0x822d
const RG16F = 0x822f
const RGB16F = 0x881b
const RGBA16F = 0x881a
const R32F = 0x822e
const RG32F = 0x8230
const RGB32F = 0x8815
const RGBA32F = 0x8814
const R8UI = 0x8232
const RG8UI = 0x8238
const RGB8UI = 0x8d7d
const RGBA8UI = 0x8d7c
const R16UI = 0x8234
const RG16UI = 0x823a
const RGBA16UI = 0x8d76
const R32UI = 0x8236
const RG32UI = 0x823c
const RGBA32UI = 0x8d70
const R8I = 0x8231
const RG8I = 0x8237
const RGBA8I = 0x8d8e
const R16I = 0x8233
const RG16I = 0x8239
const RGBA16I = 0x8d88
const R32I = 0x8235
const RG32I = 0x823b
const RGBA32I = 0x8d82
const DEPTH_COMPONENT16 = 0x81a5
const DEPTH_COMPONENT24 = 0x81a6
const DEPTH_COMPONENT32F = 0x8cac
const DEPTH24_STENCIL8 = 0x88f0

const RED = 0x1903
const RG = 0x8227
const RED_INTEGER = 0x8d94
const RG_INTEGER = 0x8d98
const RGB_INTEGER = 0x8d98
const RGBA_INTEGER = 0x8d99

function buildFormatTables(caps: Capabilities): FormatTables {
  const formats = new Map<string, TextureFormatInfo>()
  const types = new Map<string, TextureTypeInfo>()

  const addFormat = (info: TextureFormatInfo): void => {
    if (info.webgl2 && !caps.isWebGL2) return
    formats.set(info.name, info)
  }

  const addType = (info: TextureTypeInfo): void => {
    if (info.webgl2 && !caps.isWebGL2) return
    types.set(info.name, info)
  }

  // -------------------------------------------------------------------------
  // 基础类型
  // -------------------------------------------------------------------------
  addType({ name: 'uint8', type: GL.UNSIGNED_BYTE })
  addType({ name: 'uint16', type: GL.UNSIGNED_SHORT })
  addType({
    name: 'uint32',
    type: GL.UNSIGNED_INT,
    webgl2: false
  })
  if (caps.isWebGL2 || caps.has('oes_texture_float')) {
    addType({ name: 'float', type: GL.FLOAT, float: true })
    addType({ name: 'float32', type: GL.FLOAT, float: true })
  }
  if (caps.isWebGL2 || caps.has('oes_texture_half_float')) {
    addType({
      name: 'half float',
      type: caps.isWebGL2 ? GL.HALF_FLOAT : GL.HALF_FLOAT_OES,
      halfFloat: true
    })
    addType({
      name: 'float16',
      type: caps.isWebGL2 ? GL.HALF_FLOAT : GL.HALF_FLOAT_OES,
      halfFloat: true
    })
  }
  if (caps.isWebGL2) {
    addType({ name: 'int8', type: GL.BYTE, integer: true })
    addType({ name: 'int16', type: GL.SHORT, integer: true })
    addType({ name: 'int32', type: GL.INT, integer: true })
    // WebGL2 整数纹理使用无符号类型名
    addType({ name: 'uint8i', type: GL.UNSIGNED_BYTE, integer: true, webgl2: true })
    addType({ name: 'uint16i', type: GL.UNSIGNED_SHORT, integer: true, webgl2: true })
    addType({ name: 'uint32i', type: GL.UNSIGNED_INT, integer: true, webgl2: true })
  }
  if (caps.isWebGL2 || caps.has('webgl_depth_texture')) {
    addType({
      name: 'depth stencil',
      type: GL.UNSIGNED_INT_24_8,
      webgl2: false
    })
  }

  // 打包类型（也允许作为 type 名使用，与 regl 一致）
  addType({ name: 'rgba4', type: GL.UNSIGNED_SHORT_4_4_4_4 })
  addType({ name: 'rgb565', type: GL.UNSIGNED_SHORT_5_6_5 })
  addType({ name: 'rgb5 a1', type: GL.UNSIGNED_SHORT_5_5_5_1 })

  // -------------------------------------------------------------------------
  // 基础格式（WebGL1 核心 + WebGL2 兼容）
  // -------------------------------------------------------------------------
  addFormat({
    name: 'alpha',
    internalFormat: GL.ALPHA,
    format: GL.ALPHA,
    channels: 1,
    bytesPerPixel: 1
  })
  addFormat({
    name: 'luminance',
    internalFormat: GL.LUMINANCE,
    format: GL.LUMINANCE,
    channels: 1,
    bytesPerPixel: 1
  })
  addFormat({
    name: 'luminance alpha',
    internalFormat: GL.LUMINANCE_ALPHA,
    format: GL.LUMINANCE_ALPHA,
    channels: 2,
    bytesPerPixel: 2
  })
  addFormat({
    name: 'rgb',
    internalFormat: caps.isWebGL2 ? RGB8 : GL.RGB,
    format: GL.RGB,
    channels: 3,
    bytesPerPixel: 3
  })
  addFormat({
    name: 'rgba',
    internalFormat: caps.isWebGL2 ? RGBA8 : GL.RGBA,
    format: GL.RGBA,
    channels: 4,
    bytesPerPixel: 4
  })
  addFormat({
    name: 'rgba4',
    internalFormat: GL.RGBA4,
    format: GL.RGBA,
    channels: 4,
    type: GL.UNSIGNED_SHORT_4_4_4_4,
    bytesPerPixel: 2,
    fixedType: true
  })
  addFormat({
    name: 'rgb5 a1',
    internalFormat: GL.RGB5_A1,
    format: GL.RGBA,
    channels: 4,
    type: GL.UNSIGNED_SHORT_5_5_5_1,
    bytesPerPixel: 2,
    fixedType: true
  })
  addFormat({
    name: 'rgb565',
    internalFormat: GL.RGB565,
    format: GL.RGB,
    channels: 3,
    type: GL.UNSIGNED_SHORT_5_6_5,
    bytesPerPixel: 2,
    fixedType: true
  })

  // sRGB
  if (caps.isWebGL2 || caps.has('ext_srgb')) {
    addFormat({
      name: 'srgb',
      internalFormat: caps.isWebGL2 ? SRGB8 : 0x8c40,
      format: GL.RGB,
      channels: 3,
      bytesPerPixel: 3
    })
    addFormat({
      name: 'srgba',
      internalFormat: caps.isWebGL2 ? SRGB8_ALPHA8 : 0x8c42,
      format: GL.RGBA,
      channels: 4,
      bytesPerPixel: 4
    })
  }

  // 深度 / 深度模板
  if (caps.isWebGL2 || caps.has('webgl_depth_texture')) {
    addFormat({
      name: 'depth',
      internalFormat: caps.isWebGL2 ? DEPTH_COMPONENT24 : GL.DEPTH_COMPONENT,
      format: GL.DEPTH_COMPONENT,
      channels: 1,
      bytesPerPixel: 4
    })
    addFormat({
      name: 'depth stencil',
      internalFormat: caps.isWebGL2 ? DEPTH24_STENCIL8 : GL.DEPTH_STENCIL,
      format: GL.DEPTH_STENCIL,
      channels: 2,
      type: GL.UNSIGNED_INT_24_8,
      bytesPerPixel: 4,
      fixedType: true
    })
    if (caps.isWebGL2) {
      addFormat({
        name: 'depth16',
        internalFormat: DEPTH_COMPONENT16,
        format: GL.DEPTH_COMPONENT,
        channels: 1,
        type: GL.UNSIGNED_SHORT,
        bytesPerPixel: 2,
        fixedType: true,
        webgl2: true
      })
      addFormat({
        name: 'depth24',
        internalFormat: DEPTH_COMPONENT24,
        format: GL.DEPTH_COMPONENT,
        channels: 1,
        type: GL.UNSIGNED_INT,
        bytesPerPixel: 4,
        fixedType: true,
        webgl2: true
      })
      addFormat({
        name: 'depth32f',
        internalFormat: DEPTH_COMPONENT32F,
        format: GL.DEPTH_COMPONENT,
        channels: 1,
        type: GL.FLOAT,
        bytesPerPixel: 4,
        fixedType: true,
        webgl2: true
      })
      addFormat({
        name: 'depth24 stencil8',
        internalFormat: DEPTH24_STENCIL8,
        format: GL.DEPTH_STENCIL,
        channels: 2,
        type: GL.UNSIGNED_INT_24_8,
        bytesPerPixel: 4,
        fixedType: true,
        webgl2: true
      })
    }
  }

  // -------------------------------------------------------------------------
  // WebGL2 尺寸格式
  // -------------------------------------------------------------------------
  if (caps.isWebGL2) {
    const addSized = (
      name: string,
      internalFormat: number,
      format: number,
      channels: number,
      type: number,
      bytesPerPixel: number,
      fixedType = true
    ): void =>
      addFormat({
        name,
        internalFormat,
        format,
        channels,
        type,
        bytesPerPixel,
        fixedType,
        webgl2: true
      })

    addSized('r8', R8, RED, 1, GL.UNSIGNED_BYTE, 1)
    addSized('rg8', RG8, RG, 2, GL.UNSIGNED_BYTE, 2)
    addSized('rgb8', RGB8, GL.RGB, 3, GL.UNSIGNED_BYTE, 3)
    addSized('rgba8', RGBA8, GL.RGBA, 4, GL.UNSIGNED_BYTE, 4)
    addSized('r16f', R16F, RED, 1, GL.HALF_FLOAT, 2)
    addSized('rg16f', RG16F, RG, 2, GL.HALF_FLOAT, 4)
    addSized('rgb16f', RGB16F, GL.RGB, 3, GL.HALF_FLOAT, 6)
    addSized('rgba16f', RGBA16F, GL.RGBA, 4, GL.HALF_FLOAT, 8)
    addSized('r32f', R32F, RED, 1, GL.FLOAT, 4)
    addSized('rg32f', RG32F, RG, 2, GL.FLOAT, 8)
    addSized('rgb32f', RGB32F, GL.RGB, 3, GL.FLOAT, 12)
    addSized('rgba32f', RGBA32F, GL.RGBA, 4, GL.FLOAT, 16)

    // 无符号整数纹理
    addSized('r8ui', R8UI, RED_INTEGER, 1, GL.UNSIGNED_BYTE, 1)
    addSized('rg8ui', RG8UI, RG_INTEGER, 2, GL.UNSIGNED_BYTE, 2)
    addSized('rgb8ui', RGB8UI, RGB_INTEGER, 3, GL.UNSIGNED_BYTE, 3)
    addSized('rgba8ui', RGBA8UI, RGBA_INTEGER, 4, GL.UNSIGNED_BYTE, 4)
    addSized('r16ui', R16UI, RED_INTEGER, 1, GL.UNSIGNED_SHORT, 2)
    addSized('rg16ui', RG16UI, RG_INTEGER, 2, GL.UNSIGNED_SHORT, 4)
    addSized('rgba16ui', RGBA16UI, RGBA_INTEGER, 4, GL.UNSIGNED_SHORT, 8)
    addSized('r32ui', R32UI, RED_INTEGER, 1, GL.UNSIGNED_INT, 4)
    addSized('rg32ui', RG32UI, RG_INTEGER, 2, GL.UNSIGNED_INT, 8)
    addSized('rgba32ui', RGBA32UI, RGBA_INTEGER, 4, GL.UNSIGNED_INT, 16)

    // 有符号整数纹理
    addSized('r8i', R8I, RED_INTEGER, 1, GL.BYTE, 1)
    addSized('rg8i', RG8I, RG_INTEGER, 2, GL.BYTE, 2)
    addSized('rgba8i', RGBA8I, RGBA_INTEGER, 4, GL.BYTE, 4)
    addSized('r16i', R16I, RED_INTEGER, 1, GL.SHORT, 2)
    addSized('rg16i', RG16I, RG_INTEGER, 2, GL.SHORT, 4)
    addSized('rgba16i', RGBA16I, RGBA_INTEGER, 4, GL.SHORT, 8)
    addSized('r32i', R32I, RED_INTEGER, 1, GL.INT, 4)
    addSized('rg32i', RG32I, RG_INTEGER, 2, GL.INT, 8)
    addSized('rgba32i', RGBA32I, RGBA_INTEGER, 4, GL.INT, 16)
  }

  // -------------------------------------------------------------------------
  // 压缩纹理（按扩展/WebGL2 核心能力裁剪）
  // -------------------------------------------------------------------------
  const compressed = (
    name: string,
    internalFormat: number,
    bytesPerPixel: number,
    webgl2 = false
  ): void =>
    addFormat({
      name,
      internalFormat,
      format: internalFormat,
      channels: 0,
      bytesPerPixel,
      compressed: true,
      webgl2
    })

  if (caps.has('webgl_compressed_texture_s3tc')) {
    compressed('rgb s3tc dxt1', 0x83f0, 0.5)
    compressed('rgba s3tc dxt1', 0x83f1, 0.5)
    compressed('rgba s3tc dxt3', 0x83f2, 1)
    compressed('rgba s3tc dxt5', 0x83f3, 1)
  }
  if (caps.has('webgl_compressed_texture_s3tc_srgb')) {
    compressed('srgb s3tc dxt1', 0x8c4c, 0.5)
    compressed('srgba s3tc dxt1', 0x8c4d, 0.5)
    compressed('srgba s3tc dxt3', 0x8c4e, 1)
    compressed('srgba s3tc dxt5', 0x8c4f, 1)
  }
  if (caps.has('webgl_compressed_texture_atc')) {
    compressed('rgb atc', 0x8c92, 0.5)
    compressed('rgba atc explicit alpha', 0x8c93, 1)
    compressed('rgba atc interpolated alpha', 0x87ee, 1)
  }
  if (caps.has('webgl_compressed_texture_pvrtc')) {
    compressed('rgb pvrtc 4bppv1', 0x8c00, 0.5)
    compressed('rgb pvrtc 2bppv1', 0x8c01, 0.25)
    compressed('rgba pvrtc 4bppv1', 0x8c02, 0.5)
    compressed('rgba pvrtc 2bppv1', 0x8c03, 0.25)
  }
  if (caps.has('webgl_compressed_texture_etc1')) {
    compressed('rgb etc1', 0x8d64, 0.5)
  }
  if (caps.isWebGL2 || caps.has('webgl_compressed_texture_etc')) {
    // ETC2 / EAC（WebGL2 核心）
    compressed('rgb etc2', 0x9274, 0.5, true)
    compressed('rgba etc2', 0x9278, 1, true)
    compressed('rgb8 etc2', 0x9274, 0.5, true)
    compressed('rgba8 etc2', 0x9278, 1, true)
    compressed('r11 eac', 0x9270, 0.5, true)
    compressed('signed r11 eac', 0x9271, 0.5, true)
    compressed('rg11 eac', 0x9272, 1, true)
    compressed('signed rg11 eac', 0x9273, 1, true)
  }
  if (caps.has('webgl_compressed_texture_astc')) {
    compressed('rgba astc 4x4', 0x93b0, 1)
  }
  if (caps.has('webgl_compressed_texture_bptc')) {
    compressed('rgba bptc', 0x8e8c, 1)
  }

  // 反转表
  const formatNames = new Map<number, string>()
  for (const [name, info] of formats) {
    if (!formatNames.has(info.internalFormat)) {
      formatNames.set(info.internalFormat, name)
    }
  }
  const typeNames = new Map<number, string>()
  for (const [name, info] of types) {
    if (!typeNames.has(info.type)) {
      typeNames.set(info.type, name)
    }
  }

  return { formats, types, formatNames, typeNames }
}

// ---------------------------------------------------------------------------
// 纹理内部表示
// ---------------------------------------------------------------------------

/** 上传参数默认值。 */
interface PixelStorage {
  flipY: boolean
  premultiplyAlpha: boolean
  unpackAlignment: number
  colorSpace: number
}

/** 一个 mip 层级 / 立方体面的图像描述。 */
interface TexImageLevel extends PixelStorage {
  width: number
  height: number
  /** 3D 纹理深度 / 2D array 层数；2D/cube 为 1。 */
  depth: number
  channels: number
  internalFormat: number
  format: number
  type: number
  compressed: boolean
  data: ArrayBufferView | null
  element: TexImageSource | null
  needsCopy: boolean
  xOffset: number
  yOffset: number
  /** PBO 上传来源；非空时 data 必须为 null。 */
  pixelBuffer: WebGLBuffer | null
  pixelOffset: number
}

interface TextureFlags {
  internalFormat: number
  format: number
  formatName: string
  type: number
  typeName: string
  channels: number
  compressed: boolean
  width: number
  height: number
}

interface TextureInfo {
  minFilter: number
  magFilter: number
  wrapS: number
  wrapT: number
  wrapR: number
  anisotropic: number
  genMipmaps: boolean
  mipmapHint: number
}

function defaultPixelStorage(): PixelStorage {
  return {
    flipY: false,
    premultiplyAlpha: false,
    unpackAlignment: 1,
    colorSpace: GL.BROWSER_DEFAULT_WEBGL
  }
}

function defaultTextureInfo(): TextureInfo {
  return {
    minFilter: GL.NEAREST,
    magFilter: GL.NEAREST,
    wrapS: GL.CLAMP_TO_EDGE,
    wrapT: GL.CLAMP_TO_EDGE,
    wrapR: GL.CLAMP_TO_EDGE,
    anisotropic: 1,
    genMipmaps: false,
    mipmapHint: GL.DONT_CARE
  }
}

function defaultFlags(): TextureFlags {
  return {
    internalFormat: GL.RGBA,
    format: GL.RGBA,
    formatName: 'rgba',
    type: GL.UNSIGNED_BYTE,
    typeName: 'uint8',
    channels: 4,
    compressed: false,
    width: 0,
    height: 0
  }
}

/** 纹理内部对象（用户通过 `_texture` 访问）。 */
export class TextureInternal {
  id: number
  readonly target: number
  handle: WebGLTexture | null
  width = 0
  height = 0
  /** 3D 纹理深度 / 2D array 层数；普通 2D/cube 为 1。 */
  depth = 1
  flags: TextureFlags = defaultFlags()
  info: TextureInfo = defaultTextureInfo()
  /** 每个面的 mip 层级数组。2D 只有 face 0。 */
  faces: (TexImageLevel[] | null)[] = [null]
  mipmask = 0
  refCount = 1
  unit = -1
  bindCount = 0
  stats = { size: 0 }

  constructor(id: number, gl: GLContext, target: number) {
    this.id = id
    this.target = target
    this.handle = gl.createTexture()
  }

  get isCube(): boolean {
    return this.target === GL.TEXTURE_CUBE_MAP
  }

  get is3D(): boolean {
    return this.target === GL.TEXTURE_3D
  }

  get isArray(): boolean {
    return this.target === GL.TEXTURE_2D_ARRAY
  }

  get isLayered(): boolean {
    return this.is3D || this.isArray
  }

  // --- 兼容旧版 regl 的内部字段命名（部分外部代码会直接访问 _texture） ---
  get internalformat(): number {
    return this.flags.internalFormat
  }

  get format(): number {
    return this.flags.format
  }

  get type(): number {
    return this.flags.type
  }

  get channels(): number {
    return this.flags.channels
  }

  get texInfo(): TextureInfo {
    return this.info
  }

  get compressed(): boolean {
    return this.flags.compressed
  }

  get premultiplyAlpha(): boolean {
    return this.faces[0]?.[0]?.premultiplyAlpha ?? false
  }

  get flipY(): boolean {
    return this.faces[0]?.[0]?.flipY ?? false
  }

  get unpackAlignment(): number {
    return this.faces[0]?.[0]?.unpackAlignment ?? 1
  }

  get colorSpace(): number {
    return this.faces[0]?.[0]?.colorSpace ?? GL.BROWSER_DEFAULT_WEBGL
  }

  /** mip 层级数量。 */
  get mipLevels(): number {
    return mipLevelCount(
      this.width,
      this.height,
      this.is3D ? this.depth : 1
    )
  }
}

// ---------------------------------------------------------------------------
// 纹理仓库
// ---------------------------------------------------------------------------

export interface TextureStoreOptions {
  gl: GLContext
  caps: Capabilities
  limits: Limits
  /** 用于 `copy: true` 时同步当前 framebuffer。 */
  poll: () => void
  contextState: {
    viewportWidth: number
    viewportHeight: number
    framebufferWidth: number
    framebufferHeight: number
    drawingBufferWidth: number
    drawingBufferHeight: number
  }
  stats: {
    textureCount: number
    cubeCount: number
    maxTextureUnits: number
  }
  profile: boolean
}

export class TextureStore {
  readonly gl: GLContext
  readonly caps: Capabilities
  readonly limits: Limits
  readonly tables: FormatTables
  readonly stats: TextureStoreOptions['stats']
  readonly contextState: TextureStoreOptions['contextState']
  private readonly poll: () => void
  private readonly profile: boolean

  private textureCount = 0
  private readonly textureSet = new Map<number, TextureInternal>()
  private readonly units: (TextureInternal | null)[]

  constructor(options: TextureStoreOptions) {
    this.gl = options.gl
    this.caps = options.caps
    this.limits = options.limits
    this.stats = options.stats
    this.contextState = options.contextState
    this.poll = options.poll
    this.profile = options.profile
    this.tables = buildFormatTables(options.caps)
    this.limits.textureFormats = Array.from(this.tables.formats.keys())
    this.units = new Array(options.limits.maxTextureUnits).fill(null)
  }

  get supportedFormats(): string[] {
    return this.limits.textureFormats
  }

  // -------------------------------------------------------------------------
  // 绑定 / 纹理单元
  // -------------------------------------------------------------------------

  bindTexture(texture: TextureInternal): number {
    texture.bindCount += 1
    let unit = texture.unit
    if (unit < 0) {
      for (let i = 0; i < this.units.length; ++i) {
        const other = this.units[i]
        if (other) {
          if (other.bindCount > 0) continue
          other.unit = -1
        }
        this.units[i] = texture
        unit = i
        break
      }
      if (unit >= this.units.length) {
        throw new Error('(regl) insufficient number of texture units')
      }
      if (this.profile && this.stats.maxTextureUnits < unit + 1) {
        this.stats.maxTextureUnits = unit + 1
      }
      texture.unit = unit
      this.gl.activeTexture(GL.TEXTURE0 + unit)
      this.gl.bindTexture(texture.target, texture.handle)
    }
    return unit
  }

  unbindTexture(texture: TextureInternal): void {
    texture.bindCount -= 1
  }

  /** 每帧开始时重置纹理单元分配（与 regl 的 poll 行为一致）。 */
  refresh(): void {
    for (let i = 0; i < this.units.length; ++i) {
      const texture = this.units[i]
      if (texture) {
        texture.bindCount = 0
        texture.unit = -1
        this.units[i] = null
      }
      this.gl.activeTexture(GL.TEXTURE0 + i)
      this.gl.bindTexture(GL.TEXTURE_2D, null)
      this.gl.bindTexture(GL.TEXTURE_CUBE_MAP, null)
    }
  }

  private tempBind(texture: TextureInternal): (() => void) {
    const prev = this.units[0]
    this.gl.activeTexture(GL.TEXTURE0)
    this.gl.bindTexture(texture.target, texture.handle)
    return () => {
      this.gl.activeTexture(GL.TEXTURE0)
      if (prev) {
        this.gl.bindTexture(prev.target, prev.handle)
      } else {
        this.gl.bindTexture(texture.target, null)
      }
    }
  }

  // -------------------------------------------------------------------------
  // 创建 2D 纹理
  // -------------------------------------------------------------------------

  create2D(a?: unknown, b?: unknown): Texture2DWrapper {
    const texture = new TextureInternal(
      this.textureCount++,
      this.gl,
      GL.TEXTURE_2D
    )
    this.textureSet.set(texture.id, texture)
    this.stats.textureCount++

    const update = (input?: unknown, height?: unknown): Texture2DWrapper => {
      this.upload2D(texture, input, height)
      updateTextureProperties(wrapper, texture, this.tables)
      return wrapper
    }

    const wrapper = createTexture2DWrapper(texture, update, this)
    this.upload2D(texture, a, b)
    updateTextureProperties(wrapper, texture, this.tables)
    return wrapper
  }

  private upload2D(
    texture: TextureInternal,
    a?: unknown,
    b?: unknown
  ): void {
    const info = defaultTextureInfo()
    const storage = defaultPixelStorage()
    const levels: TexImageLevel[] = []
    const flags = defaultFlags()

    if (typeof a === 'number') {
      const width = a | 0
      const height = typeof b === 'number' ? b | 0 : width
      check(width > 0 && height > 0, 'invalid texture shape')
      const level = this.makeLevel(width, height, 4, flags, storage)
      levels.push(level)
    } else if (a) {
      // 允许直接传像素数据 / DOM 元素，例如 regl.texture([[...], [...]])
      const options = isDirectPixelData(a)
        ? ({ data: a } as Texture2DOptionsInternal)
        : (a as Texture2DOptionsInternal)
      check(typeof options === 'object', 'invalid arguments to regl.texture')
      this.parseTextureInfo(info, options)
      this.parseFlags(flags, storage, options)
      this.parseMipmaps(levels, flags, storage, options)
    } else {
      // 空纹理默认 1x1
      const level = this.makeLevel(1, 1, 4, flags, storage)
      levels.push(level)
    }

    const width = levels[0].width
    const height = levels[0].height

    if (info.genMipmaps) {
      info.genMipmaps = true
    }

    this.validate2D(info, levels, width, height, flags)
    this.applyTexture(texture, GL.TEXTURE_2D, info, flags, [levels], width, height)
  }

  private makeLevel(
    width: number,
    height: number,
    channels: number,
    flags: TextureFlags,
    storage: PixelStorage,
    data: ArrayBufferView | null = null,
    element: TexImageSource | null = null,
    needsCopy = false,
    xOffset = 0,
    yOffset = 0,
    depth = 1,
    pixelBuffer: WebGLBuffer | null = null,
    pixelOffset = 0
  ): TexImageLevel {
    if (
      flags.type === GL.FLOAT &&
      !this.caps.isWebGL2 &&
      !this.caps.has('oes_texture_float')
    ) {
      throw new Error(
        '(regl) you must enable the OES_texture_float extension in order to use floating point textures'
      )
    }
    if (
      isHalfFloat(flags.type) &&
      !this.caps.isWebGL2 &&
      !this.caps.has('oes_texture_half_float')
    ) {
      throw new Error(
        '(regl) you must enable the OES_texture_half_float extension in order to use 16-bit floating point textures'
      )
    }
    return {
      width,
      height,
      depth,
      channels,
      internalFormat: flags.internalFormat,
      format: flags.format,
      type: flags.type,
      compressed: flags.compressed,
      data,
      element,
      needsCopy,
      xOffset,
      yOffset,
      pixelBuffer,
      pixelOffset,
      ...storage
    }
  }

  // -------------------------------------------------------------------------
  // 创建立方体贴图
  // -------------------------------------------------------------------------

  createCube(
    a0?: unknown,
    a1?: unknown,
    a2?: unknown,
    a3?: unknown,
    a4?: unknown,
    a5?: unknown
  ): TextureCubeWrapper {
    const texture = new TextureInternal(
      this.textureCount++,
      this.gl,
      GL.TEXTURE_CUBE_MAP
    )
    this.textureSet.set(texture.id, texture)
    this.stats.cubeCount++

    const update = (
      u0?: unknown,
      u1?: unknown,
      u2?: unknown,
      u3?: unknown,
      u4?: unknown,
      u5?: unknown
    ): TextureCubeWrapper => {
      this.uploadCube(texture, u0, u1, u2, u3, u4, u5)
      updateTextureProperties(wrapper, texture, this.tables)
      return wrapper
    }

    const wrapper = createTextureCubeWrapper(texture, update, this)
    this.uploadCube(texture, a0, a1, a2, a3, a4, a5)
    updateTextureProperties(wrapper, texture, this.tables)
    return wrapper
  }

  private uploadCube(
    texture: TextureInternal,
    a0?: unknown,
    a1?: unknown,
    a2?: unknown,
    a3?: unknown,
    a4?: unknown,
    a5?: unknown
  ): void {
    const info = defaultTextureInfo()
    const storage = defaultPixelStorage()
    const faces: TexImageLevel[][] = []
    const flags = defaultFlags()

    if (typeof a0 === 'number' || !a0) {
      const size = (typeof a0 === 'number' ? a0 : 1) | 0
      check(size > 0, 'invalid cube map size')
      for (let i = 0; i < 6; ++i) {
        faces.push([this.makeLevel(size, size, 4, flags, storage)])
      }
    } else {
      check(typeof a0 === 'object', 'invalid arguments to cube map')
      const options = a0 as TextureCubeOptionsInternal
      if (a1) {
        // 六个面分别传入
        const inputs = [a0, a1, a2, a3, a4, a5]
        for (let i = 0; i < 6; ++i) {
          const faceLevels: TexImageLevel[] = []
          const faceOptions = inputs[i] as Texture2DOptionsInternal
          this.parseFlags(flags, storage, faceOptions)
          this.parseMipmaps(faceLevels, flags, storage, faceOptions)
          faces.push(faceLevels)
        }
      } else {
        this.parseTextureInfo(info, options)
        this.parseFlags(flags, storage, options)
        if (options.faces) {
          check(
            Array.isArray(options.faces) && options.faces.length === 6,
            'cube faces must be a length 6 array'
          )
          for (let i = 0; i < 6; ++i) {
            const faceLevels: TexImageLevel[] = []
            this.parseMipmaps(
              faceLevels,
              flags,
              storage,
              options.faces[i] as Texture2DOptionsInternal
            )
            faces.push(faceLevels)
          }
        } else {
          for (let i = 0; i < 6; ++i) {
            const faceLevels: TexImageLevel[] = []
            this.parseMipmaps(faceLevels, flags, storage, options)
            faces.push(faceLevels)
          }
        }
      }
    }

    const width = faces[0][0].width
    const height = faces[0][0].height
    for (let i = 0; i < 6; ++i) {
      check(
        faces[i][0].width === width && faces[i][0].height === height,
        'inconsistent cube map face shape'
      )
    }
    check(width === height, 'cube map must be square')
    if (!this.limits.npotTextureCube) {
      check(isPow2(width), 'your browser does not support non power of two cube textures')
    }

    this.validateCube(info, faces, width, height)
    this.applyTexture(texture, GL.TEXTURE_CUBE_MAP, info, flags, faces, width, height)
  }

  // -------------------------------------------------------------------------
  // 创建 3D / 2D array 纹理
  // -------------------------------------------------------------------------

  create3D(
    a?: Texture3DOptionsInternal | number | null,
    b?: number,
    c?: number
  ): Texture3DWrapper {
    check(this.caps.isWebGL2, '3D textures require WebGL2')
    const texture = new TextureInternal(
      this.textureCount++,
      this.gl,
      GL.TEXTURE_3D
    )
    this.textureSet.set(texture.id, texture)
    this.stats.textureCount++

    const update = (
      u0?: Texture3DOptionsInternal | number | null,
      u1?: number,
      u2?: number
    ) => {
      this.upload3D(texture, u0, u1, u2, GL.TEXTURE_3D)
      updateTextureProperties(wrapper, texture, this.tables)
      return wrapper
    }
    const wrapper = createTexture3DWrapper(
      texture,
      update,
      this,
      false
    ) as Texture3DWrapper
    this.upload3D(texture, a, b, c, GL.TEXTURE_3D)
    updateTextureProperties(wrapper, texture, this.tables)
    return wrapper
  }

  create2DArray(
    a?: Texture3DOptionsInternal | number | null,
    b?: number,
    c?: number
  ): Texture2DArrayWrapper {
    check(this.caps.isWebGL2, '2D array textures require WebGL2')
    const texture = new TextureInternal(
      this.textureCount++,
      this.gl,
      GL.TEXTURE_2D_ARRAY
    )
    this.textureSet.set(texture.id, texture)
    this.stats.textureCount++

    const update = (
      u0?: Texture3DOptionsInternal | number | null,
      u1?: number,
      u2?: number
    ) => {
      this.upload3D(texture, u0, u1, u2, GL.TEXTURE_2D_ARRAY)
      updateTextureProperties(wrapper, texture, this.tables)
      return wrapper
    }
    const wrapper = createTexture3DWrapper(
      texture,
      update,
      this,
      true
    ) as Texture2DArrayWrapper
    this.upload3D(texture, a, b, c, GL.TEXTURE_2D_ARRAY)
    updateTextureProperties(wrapper, texture, this.tables)
    return wrapper
  }

  private upload3D(
    texture: TextureInternal,
    a?: Texture3DOptionsInternal | number | null,
    b?: number,
    c?: number,
    target: number = GL.TEXTURE_3D
  ): void {
    check(this.caps.isWebGL2, '3D / 2D array textures require WebGL2')
    const info = defaultTextureInfo()
    const storage = defaultPixelStorage()
    const levels: TexImageLevel[] = []
    const flags = defaultFlags()

    let depth = 0
    if (typeof a === 'number') {
      const width = a | 0
      const height = (b as number | undefined) !== undefined ? b! | 0 : width
      depth = (c as number | undefined) !== undefined ? c! | 0 : width
      check(width > 0 && height > 0 && depth > 0, 'invalid texture shape')
      levels.push(
        this.makeLevel(width, height, 4, flags, storage, null, null, false, 0, 0, depth)
      )
    } else if (a) {
      const options = a as Texture3DOptionsInternal
      check(typeof options === 'object', 'invalid arguments to 3D texture')
      this.parseTextureInfo(info, options)
      this.parseFlags(flags, storage, options)
      depth =
        (options.depth as number | undefined) ||
        (options.layers as number | undefined) ||
        0
      this.parseMipmaps3D(levels, flags, storage, options, depth, target === GL.TEXTURE_3D)
    } else {
      levels.push(
        this.makeLevel(1, 1, 4, flags, storage, null, null, false, 0, 0, 1)
      )
    }

    const width = levels[0].width
    const height = levels[0].height
    depth = levels[0].depth

    this.validate3D(info, levels, width, height, depth, target, flags)
    this.applyTexture(texture, target, info, flags, [levels], width, height, depth)
  }

  private validate3D(
    info: TextureInfo,
    levels: TexImageLevel[],
    width: number,
    height: number,
    depth: number,
    target: number,
    flags: TextureFlags
  ): void {
    check(width > 0 && width <= this.limits.maxTextureSize, 'invalid texture width')
    check(height > 0 && height <= this.limits.maxTextureSize, 'invalid texture height')
    if (target === GL.TEXTURE_3D) {
      check(
        depth > 0 && depth <= this.limits.max3DTextureSize,
        'invalid 3D texture depth'
      )
    } else {
      check(
        depth > 0 && depth <= this.limits.maxArrayTextureLayers,
        'invalid array texture layer count'
      )
    }

    if (info.genMipmaps) {
      check(
        flags.type !== GL.FLOAT,
        'mipmap generation not supported with float textures'
      )
      check(!flags.compressed, 'mipmap generation for compressed images not supported')
    }

    if (flags.compressed) {
      check(
        !info.genMipmaps,
        'mipmap generation for compressed images not supported'
      )
    }

    for (let i = 0; i < levels.length; ++i) {
      const level = levels[i]
      const mw = Math.max(1, width >> i)
      const mh = Math.max(1, height >> i)
      const md = target === GL.TEXTURE_3D
        ? Math.max(1, depth >> i)
        : depth
      check(
        level.width === mw && level.height === mh && level.depth === md,
        'invalid shape for mip images'
      )
      if (level.data && !level.compressed) {
        const bytesPerPixel = pixelSizeFor(flags, this.tables)
        const rowSize =
          Math.ceil(bytesPerPixel * mw / level.unpackAlignment) *
          level.unpackAlignment
        check(
          level.data.byteLength === rowSize * mh * md,
          'invalid data for image, buffer size is inconsistent with image format'
        )
      }
    }
  }

  private parseTextureInfo(info: TextureInfo, options: Record<string, unknown>): void {
    if (typeof options !== 'object' || !options) return

    if ('min' in options) {
      const min = options.min as string
      checkParameter(min, minFilters, 'invalid texture min filter')
      info.minFilter = minFilters[min]
      if (isMipmapFilter(info.minFilter) && !('faces' in options)) {
        info.genMipmaps = true
      }
    }
    if ('mag' in options) {
      const mag = options.mag as string
      checkParameter(mag, magFilters, 'invalid texture mag filter')
      info.magFilter = magFilters[mag]
    }

    let wrapS = info.wrapS
    let wrapT = info.wrapT
    let wrapR = info.wrapR
    if ('wrap' in options) {
      const wrap = options.wrap
      if (typeof wrap === 'string') {
        checkParameter(wrap, wrapModes, 'invalid texture wrap')
        wrapS = wrapT = wrapR = wrapModes[wrap]
      } else if (Array.isArray(wrap)) {
        checkParameter(wrap[0], wrapModes, 'invalid texture wrapS')
        checkParameter(wrap[1], wrapModes, 'invalid texture wrapT')
        wrapS = wrapModes[wrap[0]]
        wrapT = wrapModes[wrap[1]]
        if (wrap.length > 2) {
          checkParameter(wrap[2], wrapModes, 'invalid texture wrapR')
          wrapR = wrapModes[wrap[2]]
        }
      } else {
        throw new Error('(regl) invalid texture wrap')
      }
    } else {
      if ('wrapS' in options) {
        checkParameter(options.wrapS, wrapModes, 'invalid texture wrapS')
        wrapS = wrapModes[options.wrapS as string]
      }
      if ('wrapT' in options) {
        checkParameter(options.wrapT, wrapModes, 'invalid texture wrapT')
        wrapT = wrapModes[options.wrapT as string]
      }
      if ('wrapR' in options) {
        checkParameter(options.wrapR, wrapModes, 'invalid texture wrapR')
        wrapR = wrapModes[options.wrapR as string]
      }
    }
    info.wrapS = wrapS
    info.wrapT = wrapT
    info.wrapR = wrapR

    if ('anisotropic' in options) {
      const aniso = options.anisotropic as number
      check(
        typeof aniso === 'number' &&
          aniso >= 1 &&
          aniso <= this.limits.maxAnisotropic,
        `aniso samples must be between 1 and ${this.limits.maxAnisotropic}`
      )
      info.anisotropic = aniso
    }

    if ('mipmap' in options) {
      const mipmap = options.mipmap
      if (typeof mipmap === 'string') {
        checkParameter(mipmap, mipmapHints, 'invalid mipmap hint')
        info.mipmapHint = mipmapHints[mipmap]
        info.genMipmaps = true
      } else if (typeof mipmap === 'boolean') {
        info.genMipmaps = mipmap
      } else if (Array.isArray(mipmap)) {
        info.genMipmaps = false
      } else {
        throw new Error('(regl) invalid mipmap type')
      }
      if (!('min' in options)) {
        info.minFilter = GL.NEAREST_MIPMAP_NEAREST
      }
    }
  }

  /** 解析 format / type / shape / channels。 */
  private parseFlags(
    flags: TextureFlags,
    storage: PixelStorage,
    options: Record<string, unknown>
  ): void {
    if (typeof options !== 'object' || !options) return

    if ('premultiplyAlpha' in options) {
      check(
        typeof options.premultiplyAlpha === 'boolean',
        'invalid premultiplyAlpha'
      )
      storage.premultiplyAlpha = options.premultiplyAlpha
    }
    if ('flipY' in options) {
      check(typeof options.flipY === 'boolean', 'invalid texture flip')
      storage.flipY = options.flipY
    }
    if ('alignment' in options) {
      checkOneOf(options.alignment, [1, 2, 4, 8], 'invalid texture unpack alignment')
      storage.unpackAlignment = options.alignment as number
    }
    if ('colorSpace' in options) {
      checkParameter(options.colorSpace, colorSpaces, 'invalid colorSpace')
      storage.colorSpace = colorSpaces[options.colorSpace as string]
    }

    let typeSpecified = false
    if ('type' in options) {
      const typeName = options.type as string
      const typeInfo = this.tables.types.get(typeName)
      check(!!typeInfo, `invalid texture type "${typeName}"`)
      flags.type = typeInfo!.type
      flags.typeName = canonicalTypeName(typeInfo!.type)
      typeSpecified = true
    }

    // shape / width / height / channels
    let width = 0
    let height = 0
    let channels = 0
    let hasChannels = false

    if ('shape' in options) {
      const shape = options.shape
      check(Array.isArray(shape) && shape.length >= 2, 'shape must be an array')
      width = (shape as number[])[0] | 0
      height = (shape as number[])[1] | 0
      if ((shape as number[]).length === 3) {
        channels = (shape as number[])[2] | 0
        check(channels > 0 && channels <= 4, 'invalid number of channels')
        hasChannels = true
      }
    } else {
      if ('radius' in options) {
        width = height = options.radius as number
      }
      if ('width' in options) width = options.width as number
      if ('height' in options) height = options.height as number
      if ('channels' in options) {
        channels = options.channels as number
        check(channels > 0 && channels <= 4, 'invalid number of channels')
        hasChannels = true
      }
    }
    check(width >= 0 && width <= this.limits.maxTextureSize, 'invalid texture width')
    check(height >= 0 && height <= this.limits.maxTextureSize, 'invalid texture height')

    let hasFormat = false
    if ('format' in options) {
      const formatName = options.format as string
      const fmt = this.tables.formats.get(formatName)
      check(!!fmt, `invalid texture format "${formatName}"`)
      flags.formatName = formatName
      flags.internalFormat = fmt!.internalFormat
      flags.format = fmt!.format
      flags.channels = fmt!.channels
      flags.compressed = !!fmt!.compressed
      if (fmt!.type !== undefined) {
        if (!typeSpecified) {
          flags.type = fmt!.type
          flags.typeName = canonicalTypeName(fmt!.type)
        }
      }
      hasFormat = true
    }

    if (!hasFormat && hasChannels) {
      // 只有 channels 时使用对应的基础格式
      const map: Record<number, string> = {
        1: 'luminance',
        2: 'luminance alpha',
        3: 'rgb',
        4: 'rgba'
      }
      const name = map[channels]
      const fmt = this.tables.formats.get(name)!
      flags.formatName = name
      flags.internalFormat = fmt.internalFormat
      flags.format = fmt.format
      flags.channels = fmt.channels
    } else if (hasFormat && hasChannels) {
      check(
        channels === flags.channels,
        'number of channels inconsistent with specified format'
      )
    }

    // WebGL2 / 浮点类型的 internalformat 选择
    if (this.caps.isWebGL2 && !flags.compressed) {
      flags.internalFormat = resolveWebGL2InternalFormat(
        flags,
        this.tables
      )
    }

    // 深度纹理的默认类型：WebGL1 要求 UNSIGNED_INT，WebGL2 使用 24 位
    if (
      !typeSpecified &&
      (flags.formatName === 'depth' || flags.formatName === 'depth stencil')
    ) {
      if (flags.formatName === 'depth') {
        flags.type = GL.UNSIGNED_INT
        flags.typeName = 'uint32'
      } else {
        flags.type = GL.UNSIGNED_INT_24_8
        flags.typeName = 'depth stencil'
      }
    }

    // WebGL1 深度格式的 internalformat 必须与 type 匹配
    if (!this.caps.isWebGL2) {
      if (flags.formatName === 'depth' && flags.type === GL.UNSIGNED_SHORT) {
        flags.internalFormat = DEPTH_COMPONENT16
      }
    }

    flags.width = width
    flags.height = height
    flags.channels = channels || flags.channels || 4

    // 基础 rgba/rgb 格式只支持 8 位归一化、float / half float；
    // 16/32 位整数像素应使用显式的整数格式（如 rgba16ui、rgba32ui）。
    if (
      !flags.compressed &&
      (flags.formatName === 'rgba' || flags.formatName === 'rgb') &&
      (flags.type === GL.UNSIGNED_SHORT || flags.type === GL.UNSIGNED_INT)
    ) {
      throw new Error(
        `(regl) unsupported type for texture format "${flags.formatName}", ` +
          'use an integer format such as rgba16ui instead'
      )
    }

    // 检查 type 与格式的兼容性
    if (flags.compressed) {
      check(
        flags.type === GL.UNSIGNED_BYTE || !('data' in options),
        'compressed texture data must be stored in a uint8array'
      )
    }
    if (flags.formatName === 'depth' || flags.formatName === 'depth stencil') {
      // 深度纹理必须使用 WEBGL_depth_texture / WebGL2
      check(
        this.caps.isWebGL2 || this.caps.has('webgl_depth_texture'),
        'webgl_depth_texture extension not supported'
      )
    }
  }

  /** 解析 mipmap 数组或单张图像。 */
  private parseMipmaps(
    levels: TexImageLevel[],
    flags: TextureFlags,
    storage: PixelStorage,
    options: Texture2DOptionsInternal
  ): void {
    const mipmap = options.mipmap
    if (Array.isArray(mipmap)) {
      let width = flags.width
      let height = flags.height
      for (let i = 0; i < mipmap.length; ++i) {
        const entry = mipmap[i]
        const levelOptions: Texture2DOptionsInternal = isDirectPixelData(entry)
          ? ({ data: entry } as Texture2DOptionsInternal)
          : ({ ...(entry as Texture2DOptionsInternal) } as Texture2DOptionsInternal)
        if (levelOptions.width === undefined) levelOptions.width = width
        if (levelOptions.height === undefined) levelOptions.height = height
        if (levelOptions.format === undefined) levelOptions.format = options.format
        if (levelOptions.type === undefined) levelOptions.type = options.type
        if (levelOptions.channels === undefined) {
          levelOptions.channels = options.channels
        }
        const level = this.parseImage(
          levelOptions,
          flags,
          storage
        )
        levels.push(level)
        width >>= 1
        height >>= 1
      }
      return
    }

    levels.push(this.parseImage(options, flags, storage))
  }

  /** 解析 3D / 2D array 的 mipmap 数组或单层。 */
  private parseMipmaps3D(
    levels: TexImageLevel[],
    flags: TextureFlags,
    storage: PixelStorage,
    options: Texture3DOptionsInternal,
    depth: number,
    is3D: boolean
  ): void {
    const mipmap = options.mipmap
    if (Array.isArray(mipmap)) {
      let width = flags.width || (options.width as number) || 0
      let height = flags.height || (options.height as number) || 0
      let d = depth || 0
      for (let i = 0; i < mipmap.length; ++i) {
        const entry = mipmap[i]
        const levelOptions: Texture3DOptionsInternal = isDirectPixelData(entry)
          ? ({ data: entry } as Texture3DOptionsInternal)
          : ({ ...(entry as Texture3DOptionsInternal) } as Texture3DOptionsInternal)
        if (levelOptions.width === undefined && width) levelOptions.width = width
        if (levelOptions.height === undefined && height) levelOptions.height = height
        if (levelOptions.depth === undefined && d) levelOptions.depth = d
        if (levelOptions.format === undefined) levelOptions.format = options.format
        if (levelOptions.type === undefined) levelOptions.type = options.type
        if (levelOptions.channels === undefined) levelOptions.channels = options.channels
        const level = this.parseImage3D(levelOptions, flags, storage, d)
        levels.push(level)
        width = level.width
        height = level.height
        d = level.depth
        width >>= 1
        height >>= 1
        if (is3D) d >>= 1
      }
      return
    }

    levels.push(this.parseImage3D(options, flags, storage, depth))
  }

  /** 解析单层 3D / 2D array 数据。 */
  private parseImage3D(
    options: Texture3DOptionsInternal,
    flags: TextureFlags,
    storage: PixelStorage,
    depthOption = 0
  ): TexImageLevel {
    check(
      !options.pixelBuffer,
      'pixelBuffer upload is not supported for 3D / 2D array textures'
    )
    const pixelStorage: PixelStorage = { ...storage }
    if ('premultiplyAlpha' in options) {
      check(
        typeof options.premultiplyAlpha === 'boolean',
        'invalid premultiplyAlpha'
      )
      pixelStorage.premultiplyAlpha = options.premultiplyAlpha
    }
    if ('flipY' in options) {
      check(typeof options.flipY === 'boolean', 'invalid flipY')
      check(!options.flipY, 'flipY is not supported for 3D / array textures')
      pixelStorage.flipY = options.flipY
    }
    if ('unpackAlignment' in options) {
      const alignment = options.unpackAlignment as number
      check(
        alignment === 1 || alignment === 2 || alignment === 4 || alignment === 8,
        'invalid unpackAlignment'
      )
      pixelStorage.unpackAlignment = alignment
    }
    if ('colorSpace' in options) {
      const colorSpace = options.colorSpace as string
      check(
        colorSpace === 'none' || colorSpace === 'browser',
        'invalid colorSpace'
      )
      pixelStorage.colorSpace =
        colorSpace === 'none'
          ? GL.NONE
          : GL.BROWSER_DEFAULT_WEBGL
    }

    const widthOption = options.width as number | undefined
    const heightOption = options.height as number | undefined
    const depthValue =
      depthOption ||
      (options.depth as number | undefined) ||
      (options.layers as number | undefined) ||
      0
    let width = widthOption === undefined ? flags.width : widthOption
    let height = heightOption === undefined ? flags.height : heightOption
    let depth = depthValue
    let channels =
      (options.channels as number | undefined) ?? flags.channels
    const raw = options.data

    if (raw === undefined || raw === null) {
      width = width || 1
      height = height || 1
      depth = depth || 1
      channels = channels || 4
      return this.makeLevel(
        width,
        height,
        channels,
        flags,
        pixelStorage,
        null,
        null,
        false,
        0,
        0,
        depth
      )
    }

    check(
      !flags.compressed || raw instanceof Uint8Array,
      'compressed texture data must be stored in a uint8array'
    )

    if (raw instanceof ArrayBuffer) {
      const bytes = new Uint8Array(raw)
      channels = channels || 4
      if (!wasChannelsExplicit(options)) {
        applyChannelFormat(flags, channels, this.tables)
      }
      flags.type = GL.UNSIGNED_BYTE
      flags.typeName = 'uint8'
      if (!width || !height || !depth) {
        throw new Error(
          '(regl) 3D/array texture with ArrayBuffer data requires width, height and depth/layers'
        )
      }
      return this.makeLevel(
        width,
        height,
        channels,
        flags,
        pixelStorage,
        bytes,
        null,
        false,
        0,
        0,
        depth
      )
    }

    if (isTypedArray(raw)) {
      channels = channels || 4
      if (!wasChannelsExplicit(options)) {
        applyChannelFormat(flags, channels, this.tables)
      }
      if (!('type' in options) && flags.type === GL.UNSIGNED_BYTE) {
        const code = typedArrayCode(raw)
        if (code) {
          flags.type = code
          flags.typeName = canonicalTypeName(code)
        }
      }
      if (!width || !height) {
        throw new Error(
          '(regl) 3D/array texture with typed data requires width and height'
        )
      }
      if (!depth) {
        const bytesPerPixel = pixelSizeFor(flags, this.tables)
        depth = Math.max(1, Math.floor(raw.byteLength / (width * height * bytesPerPixel)))
      }
      return this.makeLevel(
        width,
        height,
        channels,
        flags,
        pixelStorage,
        raw,
        null,
        false,
        0,
        0,
        depth
      )
    }

    if (Array.isArray(raw)) {
      const shape = arrayShape(raw as ArrayLike<unknown>)
      let d = depth
      let h = height
      let w = width
      let c = channels
      let shape4 = false
      if (shape.length === 4) {
        d = d || shape[0]
        h = h || shape[1]
        w = w || shape[2]
        c = c || shape[3]
        shape4 = true
      } else if (shape.length === 3) {
        d = d || shape[0]
        h = h || shape[1]
        w = w || shape[2]
        c = c || 1
      } else {
        throw new Error(
          '(regl) 3D/array texture data must be [depth][height][width][channels]'
        )
      }
      check(d > 0 && h > 0 && w > 0, 'invalid 3D/array texture shape')
      if (!wasChannelsExplicit(options)) {
        applyChannelFormat(flags, c, this.tables)
      }
      if (!shape4 && c !== 1) {
        throw new Error(
          '(regl) 3D/array texture data with multiple channels must include a channel dimension'
        )
      }
      const flat = flattenArray(
        raw as ArrayLike<unknown>,
        shape4 ? [d, h, w, c] : [d, h, w],
        isHalfFloat(flags.type) ? GL.FLOAT : flags.type
      )
      const data = isHalfFloat(flags.type)
        ? convertToHalfFloat(flat as Float32Array)
        : flat
      return this.makeLevel(
        w,
        h,
        c,
        flags,
        pixelStorage,
        data,
        null,
        false,
        0,
        0,
        d
      )
    }

    throw new Error('(regl) invalid 3D/array texture data')
  }

  /** 解析单张图像（data / element / copy / 空存储）。 */
  private parseImage(
    options: Texture2DOptionsInternal,
    flags: TextureFlags,
    storage: PixelStorage
  ): TexImageLevel {
    const pixelStorage: PixelStorage = { ...storage }

    // 局部覆盖像素存储参数
    if ('premultiplyAlpha' in options) {
      check(
        typeof options.premultiplyAlpha === 'boolean',
        'invalid premultiplyAlpha'
      )
      pixelStorage.premultiplyAlpha = options.premultiplyAlpha
    }
    if ('flipY' in options) {
      check(typeof options.flipY === 'boolean', 'invalid texture flip')
      pixelStorage.flipY = options.flipY
    }
    if ('alignment' in options) {
      checkOneOf(options.alignment, [1, 2, 4, 8], 'invalid texture unpack alignment')
      pixelStorage.unpackAlignment = options.alignment as number
    }

    let element: TexImageSource | null = null
    let xOffset = 0
    let yOffset = 0

    if ('x' in options) xOffset = (options.x as number) | 0
    if ('y' in options) yOffset = (options.y as number) | 0

    const direct = isDirectPixelData(options)
    const raw = direct ? (options as unknown) : (options as { data?: unknown }).data

    // copy 从当前 framebuffer 复制
    if (options.copy) {
      check(raw === undefined, 'can not specify copy and data field for the same texture')
      this.poll()
      const viewW = this.contextState.viewportWidth
      const viewH = this.contextState.viewportHeight
      const width = flags.width || viewW - xOffset
      const height = flags.height || viewH - yOffset
      check(
        xOffset >= 0 &&
          xOffset < viewW &&
          yOffset >= 0 &&
          yOffset < viewH &&
          width > 0 &&
          width <= viewW &&
          height > 0 &&
          height <= viewH &&
          xOffset + width <= viewW &&
          yOffset + height <= viewH,
        'copy texture read out of bounds'
      )
      return this.makeLevel(
        width,
        height,
        flags.channels,
        flags,
        pixelStorage,
        null,
        null,
        true,
        xOffset,
        yOffset
      )
    }

    const widthOption = options.width as number | undefined
    const heightOption = options.height as number | undefined
    let width = widthOption === undefined ? flags.width : widthOption
    let height = heightOption === undefined ? flags.height : heightOption
    let channels =
      (options.channels as number | undefined) ?? flags.channels

    if (options.pixelBuffer) {
      check(this.caps.isWebGL2, 'pixel buffer textures require WebGL2')
      check(
        raw === undefined && !options.copy,
        'can not specify pixelBuffer together with data/copy'
      )
      const pixelBuffer = getBuffer(options.pixelBuffer)
      check(
        !!pixelBuffer && !!pixelBuffer.handle,
        'invalid pixel buffer for texture upload'
      )
      const pixelOffset = (options.pixelOffset as number) | 0
      check(pixelOffset >= 0, 'invalid pixel buffer offset')
      width = width || 1
      height = height || 1
      channels = channels || 4
      return this.makeLevel(
        width,
        height,
        channels,
        flags,
        pixelStorage,
        null,
        null,
        false,
        0,
        0,
        1,
        pixelBuffer!.handle,
        pixelOffset
      )
    }

    if (raw === undefined || raw === null) {
      width = width || 1
      height = height || 1
      channels = channels || 4
      return this.makeLevel(width, height, channels, flags, pixelStorage)
    }

    check(
      !flags.compressed || raw instanceof Uint8Array,
      'compressed texture data must be stored in a uint8array'
    )

    if (raw instanceof ArrayBuffer) {
      const bytes = new Uint8Array(raw)
      if (!width || !height) {
        const inferred = inferTextureShape(bytes, channels || 4)
        width = width || inferred.width
        height = height || inferred.height
      }
      channels = channels || 4
      if (!wasChannelsExplicit(options)) {
        applyChannelFormat(flags, channels, this.tables)
      }
      flags.type = GL.UNSIGNED_BYTE
      flags.typeName = 'uint8'
      return this.makeLevel(width, height, channels, flags, pixelStorage, bytes)
    }

    if (isTypedArray(raw)) {
      // 根据第一个像素推断尺寸
      if (!width || !height) {
        const inferred = inferTextureShape(raw, channels)
        width = width || inferred.width
        height = height || inferred.height
      }
      channels = channels || 4
      if (!wasChannelsExplicit(options)) {
        applyChannelFormat(flags, channels, this.tables)
      }
      if (!('type' in options) && flags.type === GL.UNSIGNED_BYTE) {
        const code = typedArrayCode(raw)
        if (code) {
          flags.type = code
          flags.typeName = canonicalTypeName(code)
        }
      }
      return this.makeLevel(width, height, channels, flags, pixelStorage, raw)
    }

    if (Array.isArray(raw) && (raw.length === 0 || typeof raw[0] === 'number')) {
      // 一维数值数组
      if (!width || !height) {
        // 没有尺寸信息时按单行处理（height = 1）
        channels = channels || 4
        width = width || Math.max(1, Math.floor(raw.length / channels))
        height = height || 1
      }
      if (!wasChannelsExplicit(options)) {
        applyChannelFormat(flags, channels, this.tables)
      }
      const converted = this.convertArray(raw as number[], flags)
      return this.makeLevel(width, height, channels, flags, pixelStorage, converted)
    }

    if (isNDArrayLike(raw)) {
      const shape = raw.shape
      const stride = raw.stride
      const isTyped = isTypedArray(raw.data)
      if (!isTyped && flags.type === GL.UNSIGNED_BYTE) {
        const code = typedArrayCode(raw.data as ArrayBufferView)
        if (code) {
          flags.type = code
          flags.typeName = canonicalTypeName(code)
        }
      }
      let shapeC = 1
      let strideC = 1
      if (shape.length === 3) {
        shapeC = shape[2]
        strideC = stride[2]
      } else {
        check(shape.length === 2, 'invalid ndarray pixel data, must be 2 or 3D')
      }
      width = shape[0]
      height = shape[1]
      channels = shapeC
      if (!wasChannelsExplicit(options)) {
        applyChannelFormat(flags, channels, this.tables)
      }
      const converted = this.convertNDArray(
        raw,
        width,
        height,
        channels,
        stride[1],
        stride[0],
        strideC,
        flags
      )
      return this.makeLevel(width, height, channels, flags, pixelStorage, converted)
    }

    const tag = Object.prototype.toString.call(raw)
    if (
      tag === '[object HTMLCanvasElement]' ||
      tag === '[object OffscreenCanvas]' ||
      tag === '[object CanvasRenderingContext2D]' ||
      tag === '[object ImageBitmap]' ||
      tag === '[object HTMLImageElement]' ||
      tag === '[object HTMLVideoElement]' ||
      tag === '[object ImageData]'
    ) {
      if (tag === '[object CanvasRenderingContext2D]') {
        element = (raw as CanvasRenderingContext2D).canvas
      } else {
        element = raw as TexImageSource
      }
      width = (element as { width: number }).width
      height = (element as { height: number }).height
      if (tag === '[object HTMLImageElement]') {
        width = (element as HTMLImageElement).naturalWidth
        height = (element as HTMLImageElement).naturalHeight
      } else if (tag === '[object HTMLVideoElement]') {
        width = (element as HTMLVideoElement).videoWidth
        height = (element as HTMLVideoElement).videoHeight
      }
      channels = 4
      if (!wasChannelsExplicit(options)) {
        applyChannelFormat(flags, 4, this.tables)
      }
      return this.makeLevel(width, height, channels, flags, pixelStorage, null, element)
    }

    if (Array.isArray(raw) && (raw.length === 0 || Array.isArray(raw[0]) || isTypedArray(raw[0]))) {
      // 二维嵌套数组（可能带通道）
      const shape = arrayShape(raw as ArrayLike<unknown>)
      const h = shape[0]
      const w = shape[1]
      const c = shape.length > 2 ? shape[2] : 1
      if (!wasChannelsExplicit(options)) {
        channels = c
        applyChannelFormat(flags, channels, this.tables)
      } else {
        channels = channels || c
      }
      if (isHalfFloat(flags.type)) {
        const floatData = flattenArray(
          raw as ArrayLike<unknown>,
          [h, w, channels],
          GL.FLOAT
        ) as Float32Array
        const halfData = convertToHalfFloat(floatData)
        return this.makeLevel(w, h, channels, flags, pixelStorage, halfData)
      }
      const flat = flattenArray(raw as ArrayLike<unknown>, [h, w, channels], flags.type)
      return this.makeLevel(w, h, channels, flags, pixelStorage, flat)
    }

    throw new Error('(regl) invalid texture image data')
  }

  /** 普通数值数组 -> 指定类型。 */
  private convertArray(
    array: number[],
    flags: TextureFlags
  ): ArrayBufferView {
    if (isHalfFloat(flags.type)) {
      return convertToHalfFloat(array)
    }
    const converted = allocType(flags.type, array.length)
    ;(converted as unknown as { set(a: ArrayLike<number>): void }).set(array)
    return converted
  }

  /** ndarray -> RGBA 顺序的紧凑数组。 */
  private convertNDArray(
    nd: NDArrayLike,
    width: number,
    height: number,
    channels: number,
    strideY: number,
    strideX: number,
    strideC: number,
    flags: TextureFlags
  ): ArrayBufferView {
    if (isHalfFloat(flags.type)) {
      const floatData = new Float32Array(width * height * channels)
      const out = floatData
      const src = nd.data as ArrayLike<number>
      let ptr = 0
      for (let i = 0; i < height; ++i) {
        for (let j = 0; j < width; ++j) {
          for (let k = 0; k < channels; ++k) {
            out[ptr++] =
              src[strideX * j + strideY * i + strideC * k + (nd.offset || 0)]
          }
        }
      }
      return convertToHalfFloat(floatData)
    }
    const data = allocType(flags.type, width * height * channels)
    const out = data as unknown as { [index: number]: number }
    const src = nd.data as ArrayLike<number>
    let ptr = 0
    for (let i = 0; i < height; ++i) {
      for (let j = 0; j < width; ++j) {
        for (let k = 0; k < channels; ++k) {
          out[ptr++] = src[strideX * j + strideY * i + strideC * k + (nd.offset || 0)]
        }
      }
    }
    return data
  }

  // -------------------------------------------------------------------------
  // 校验
  // -------------------------------------------------------------------------

  private validate2D(
    info: TextureInfo,
    levels: TexImageLevel[],
    width: number,
    height: number,
    flags: TextureFlags
  ): void {
    check(
      width > 0 && width <= this.limits.maxTextureSize,
      'invalid texture width'
    )
    check(
      height > 0 && height <= this.limits.maxTextureSize,
      'invalid texture height'
    )

    if (info.wrapS !== GL.CLAMP_TO_EDGE || info.wrapT !== GL.CLAMP_TO_EDGE) {
      check(
        isPow2(width) && isPow2(height),
        'incompatible wrap mode for texture, both width and height must be power of 2'
      )
    }

    if (info.genMipmaps) {
      // WebGL1 的 NPOT 纹理不能生成 mipmap
      if (!this.caps.isWebGL2) {
        check(
          isPow2(width) && isPow2(height),
          'texture must be a square power of 2 to support mipmapping'
        )
      }
    } else if (isMipmapFilter(info.minFilter)) {
      const required = mipLevelCount(width, height)
      check(
        levels.length >= required,
        'missing or incomplete mipmap data'
      )
    }

    // 浮点纹理过滤限制
    if (flags.type === GL.FLOAT) {
      if (!this.caps.isWebGL2 && !this.caps.has('oes_texture_float_linear')) {
        check(
          info.minFilter === GL.NEAREST && info.magFilter === GL.NEAREST,
          'filter not supported, must enable oes_texture_float_linear'
        )
      }
      check(!info.genMipmaps, 'mipmap generation not supported with float textures')
    }
    if (
      (flags.type === GL.HALF_FLOAT || flags.type === GL.HALF_FLOAT_OES) &&
      !this.caps.isWebGL2 &&
      !this.caps.has('oes_texture_half_float_linear')
    ) {
      check(
        info.minFilter === GL.NEAREST && info.magFilter === GL.NEAREST,
        'filter not supported, must enable oes_texture_half_float_linear'
      )
    }

    if (flags.compressed) {
      check(!info.genMipmaps, 'mipmap generation for compressed images not supported')
      // S3TC/DXT1/3/5 在 level 0 要求宽高是 4 的倍数
      if (
        flags.internalFormat === 0x83f0 ||
        flags.internalFormat === 0x83f1 ||
        flags.internalFormat === 0x83f2 ||
        flags.internalFormat === 0x83f3 ||
        flags.internalFormat === 0x8c4c ||
        flags.internalFormat === 0x8c4d ||
        flags.internalFormat === 0x8c4e ||
        flags.internalFormat === 0x8c4f
      ) {
        check(
          width % 4 === 0 && height % 4 === 0,
          'for compressed texture formats, mipmap level 0 must have width and height that are a multiple of 4'
        )
      }
    }

    // 检查每一级尺寸和数据大小
    for (let i = 0; i < levels.length; ++i) {
      const level = levels[i]
      const mw = Math.max(1, width >> i)
      const mh = Math.max(1, height >> i)
      check(
        level.width === mw && level.height === mh,
        'invalid shape for mip images'
      )
      if (level.data && !level.compressed) {
        const bytesPerPixel = pixelSizeFor(flags, this.tables)
        const rowSize =
          Math.ceil(bytesPerPixel * mw / level.unpackAlignment) *
          level.unpackAlignment
        check(
          level.data.byteLength === rowSize * mh,
          'invalid data for image, buffer size is inconsistent with image format'
        )
      }
    }
  }

  private validateCube(
    info: TextureInfo,
    faces: TexImageLevel[][],
    width: number,
    height: number
  ): void {
    check(width === height, 'cube map must be square')
    check(
      info.wrapS === GL.CLAMP_TO_EDGE && info.wrapT === GL.CLAMP_TO_EDGE,
      'wrap mode not supported by cube map'
    )
    check(
      width > 0 && width <= this.limits.maxCubeMapSize,
      'invalid cube map size'
    )
    for (let i = 0; i < 6; ++i) {
      check(
        faces[i][0].width === width && faces[i][0].height === height,
        'inconsistent cube map face shape'
      )
      if (info.genMipmaps) {
        check(!faces[i][0].compressed, 'can not generate mipmap for compressed textures')
      }
    }
  }

  // -------------------------------------------------------------------------
  // 上传
  // -------------------------------------------------------------------------

  private applyTexture(
    texture: TextureInternal,
    target: number,
    info: TextureInfo,
    flags: TextureFlags,
    faces: TexImageLevel[][],
    width: number,
    height: number,
    depth = 1
  ): void {
    texture.flags = { ...flags }
    texture.info = info
    texture.width = width
    texture.height = height
    texture.depth = depth
    texture.faces = faces
    const levelsForMip = texture.is3D ? mipLevelCount(width, height, depth) : mipLevelCount(width, height)
    texture.mipmask = info.genMipmaps
      ? (1 << levelsForMip) - 1
      : (1 << faces[0].length) - 1

    const restore = this.tempBind(texture)
    try {
      const faceCount = target === GL.TEXTURE_CUBE_MAP ? 6 : 1
      for (let face = 0; face < faceCount; ++face) {
        const faceTarget =
          target === GL.TEXTURE_CUBE_MAP
            ? GL.TEXTURE_CUBE_MAP_POSITIVE_X + face
            : target
        const levels = faces[face]
        for (let level = 0; level < levels.length; ++level) {
          this.uploadLevel(faceTarget, level, levels[level])
        }
      }

      this.setTextureInfo(target, info)

      if (info.genMipmaps) {
        this.gl.hint(GL.GENERATE_MIPMAP_HINT, info.mipmapHint)
        this.gl.generateMipmap(target)
      }
    } finally {
      restore()
    }

    const formatInfo = this.tables.formats.get(flags.formatName)
    texture.stats.size = getTextureSize(
      formatInfo?.bytesPerPixel || 4,
      width,
      height,
      info.genMipmaps ? mipLevelCount(width, height, depth) : faces[0].length,
      target === GL.TEXTURE_CUBE_MAP,
      depth,
      target === GL.TEXTURE_3D
    )
  }

  private uploadLevel(
    faceTarget: number,
    level: number,
    image: TexImageLevel
  ): void {
    const gl = this.gl as WebGL2RenderingContext
    this.setPixelStorage(image)
    const pixelBuffer = image.pixelBuffer
    if (pixelBuffer) {
      gl.bindBuffer(GL.PIXEL_UNPACK_BUFFER, pixelBuffer)
    }
    try {
      if (faceTarget === GL.TEXTURE_3D || faceTarget === GL.TEXTURE_2D_ARRAY) {
        if (image.compressed) {
          if (pixelBuffer) {
            ;(gl.compressedTexImage3D as unknown as (
              target: number,
              level: number,
              internalformat: number,
              width: number,
              height: number,
              depth: number,
              border: number,
              pboOffset: number
            ) => void)(
              faceTarget,
              level,
              image.internalFormat,
              image.width,
              image.height,
              image.depth,
              0,
              image.pixelOffset
            )
          } else {
            gl.compressedTexImage3D(
              faceTarget,
              level,
              image.internalFormat,
              image.width,
              image.height,
              image.depth,
              0,
              image.data as ArrayBufferView
            )
          }
        } else if (pixelBuffer) {
          gl.texImage3D(
            faceTarget,
            level,
            image.internalFormat,
            image.width,
            image.height,
            image.depth,
            0,
            image.format,
            image.type,
            image.pixelOffset
          )
        } else {
          gl.texImage3D(
            faceTarget,
            level,
            image.internalFormat,
            image.width,
            image.height,
            image.depth,
            0,
            image.format,
            image.type,
            image.data
          )
        }
        return
      }

      if (image.element) {
        gl.texImage2D(
          faceTarget,
          level,
          image.internalFormat,
          image.format,
          image.type,
          image.element
        )
      } else if (image.compressed) {
        if (pixelBuffer) {
          ;(gl.compressedTexImage2D as unknown as (
            target: number,
            level: number,
            internalformat: number,
            width: number,
            height: number,
            border: number,
            pboOffset: number
          ) => void)(
            faceTarget,
            level,
            image.internalFormat,
            image.width,
            image.height,
            0,
            image.pixelOffset
          )
        } else {
          gl.compressedTexImage2D(
            faceTarget,
            level,
            image.internalFormat,
            image.width,
            image.height,
            0,
            image.data as ArrayBufferView
          )
        }
      } else if (image.needsCopy) {
        gl.copyTexImage2D(
          faceTarget,
          level,
          image.format,
          image.xOffset,
          image.yOffset,
          image.width,
          image.height,
          0
        )
      } else if (pixelBuffer) {
        gl.texImage2D(
          faceTarget,
          level,
          image.internalFormat,
          image.width,
          image.height,
          0,
          image.format,
          image.type,
          image.pixelOffset
        )
      } else {
        gl.texImage2D(
          faceTarget,
          level,
          image.internalFormat,
          image.width,
          image.height,
          0,
          image.format,
          image.type,
          image.data
        )
      }
    } finally {
      if (pixelBuffer) {
        gl.bindBuffer(GL.PIXEL_UNPACK_BUFFER, null)
      }
    }
  }

  private setPixelStorage(image: PixelStorage): void {
    const gl = this.gl
    gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, image.flipY)
    gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, image.premultiplyAlpha)
    gl.pixelStorei(GL.UNPACK_COLORSPACE_CONVERSION_WEBGL, image.colorSpace)
    gl.pixelStorei(GL.UNPACK_ALIGNMENT, image.unpackAlignment)
  }

  private setTextureInfo(target: number, info: TextureInfo): void {
    const gl = this.gl
    gl.texParameteri(target, GL.TEXTURE_MIN_FILTER, info.minFilter)
    gl.texParameteri(target, GL.TEXTURE_MAG_FILTER, info.magFilter)
    gl.texParameteri(target, GL.TEXTURE_WRAP_S, info.wrapS)
    gl.texParameteri(target, GL.TEXTURE_WRAP_T, info.wrapT)
    if (target === GL.TEXTURE_3D || target === GL.TEXTURE_2D_ARRAY) {
      gl.texParameteri(target, GL.TEXTURE_WRAP_R, info.wrapR)
    }
    if (this.caps.has('ext_texture_filter_anisotropic')) {
      gl.texParameteri(
        target,
        GL.TEXTURE_MAX_ANISOTROPY_EXT,
        info.anisotropic
      )
    }
  }

  // -------------------------------------------------------------------------
  // 子更新 / 尺寸调整
  // -------------------------------------------------------------------------

  subimage2D(
    texture: TextureInternal,
    image: unknown,
    x = 0,
    y = 0,
    level = 0
  ): void {
    check(!!image, 'must specify image data')
    check(
      (texture.mipmask & (1 << level)) !== 0,
      'missing mipmap data'
    )

    const flags: TextureFlags = { ...texture.flags }
    const storage: PixelStorage = {
      flipY: false,
      premultiplyAlpha: false,
      unpackAlignment: 1,
      colorSpace: GL.BROWSER_DEFAULT_WEBGL
    }
    let options: Texture2DOptionsInternal
    if (
      typeof image === 'object' &&
      image !== null &&
      !isTypedArray(image) &&
      !Array.isArray(image) &&
      !isNDArrayLike(image) &&
      !isTexImageSource(image)
    ) {
      options = image as Texture2DOptionsInternal
    } else {
      options = { data: image } as Texture2DOptionsInternal
    }

    const parsed = this.parseImage(options, flags, storage)
    check(!parsed.pixelBuffer, 'pixelBuffer subimage is not supported')
    parsed.width = (options.width as number) || (texture.width >> level) - x
    parsed.height = (options.height as number) || (texture.height >> level) - y

    check(
      texture.flags.type === parsed.type &&
        texture.flags.format === parsed.format &&
        texture.flags.internalFormat === parsed.internalFormat,
      'incompatible format for texture.subimage'
    )
    check(
      x >= 0 &&
        y >= 0 &&
        x + parsed.width <= Math.max(1, texture.width >> level) &&
        y + parsed.height <= Math.max(1, texture.height >> level),
      'texture.subimage write out of bounds'
    )
    check(
      (texture.mipmask & (1 << level)) !== 0,
      'missing mipmap data'
    )

    const restore = this.tempBind(texture)
    try {
      this.uploadSubLevel(GL.TEXTURE_2D, x, y, level, parsed)
    } finally {
      restore()
    }
  }

  subimageCube(
    texture: TextureInternal,
    face: number,
    image: unknown,
    x = 0,
    y = 0,
    level = 0
  ): void {
    check(
      typeof face === 'number' && face === (face | 0) && face >= 0 && face < 6,
      'invalid face'
    )
    check(!!image, 'must specify image data')
    const flags: TextureFlags = { ...texture.flags }
    const storage: PixelStorage = {
      flipY: false,
      premultiplyAlpha: false,
      unpackAlignment: 1,
      colorSpace: GL.BROWSER_DEFAULT_WEBGL
    }
    const options =
      typeof image === 'object' &&
      image !== null &&
      !isTypedArray(image) &&
      !Array.isArray(image) &&
      !isNDArrayLike(image) &&
      !isTexImageSource(image)
        ? (image as Texture2DOptionsInternal)
        : ({ data: image } as Texture2DOptionsInternal)

    const parsed = this.parseImage(options, flags, storage)
    check(!parsed.pixelBuffer, 'pixelBuffer subimage is not supported')
    parsed.width = (options.width as number) || (texture.width >> level) - x
    parsed.height = (options.height as number) || (texture.height >> level) - y

    check(
      texture.flags.type === parsed.type &&
        texture.flags.format === parsed.format &&
        texture.flags.internalFormat === parsed.internalFormat,
      'incompatible format for texture.subimage'
    )
    check(
      x >= 0 &&
        y >= 0 &&
        x + parsed.width <= (texture.width >> level) &&
        y + parsed.height <= (texture.height >> level),
      'texture.subimage write out of bounds'
    )

    const restore = this.tempBind(texture)
    try {
      this.uploadSubLevel(
        GL.TEXTURE_CUBE_MAP_POSITIVE_X + face,
        x,
        y,
        level,
        parsed
      )
    } finally {
      restore()
    }
  }

  subimage3D(
    texture: TextureInternal,
    slice: number,
    image: unknown,
    x = 0,
    y = 0,
    level = 0
  ): void {
    check(texture.isLayered, 'texture is not 3D / 2D array')
    check(
      slice === (slice | 0) && slice >= 0 && slice < texture.depth,
      'invalid layer / depth slice'
    )
    check(!!image, 'must specify image data')
    check((texture.mipmask & (1 << level)) !== 0, 'missing mipmap data')

    const flags: TextureFlags = { ...texture.flags }
    const storage: PixelStorage = {
      flipY: false,
      premultiplyAlpha: false,
      unpackAlignment: 1,
      colorSpace: GL.BROWSER_DEFAULT_WEBGL
    }
    const options =
      typeof image === 'object' &&
      image !== null &&
      !isTypedArray(image) &&
      !Array.isArray(image) &&
      !isNDArrayLike(image) &&
      !isTexImageSource(image)
        ? (image as Texture2DOptionsInternal)
        : ({ data: image } as Texture2DOptionsInternal)

    const parsed = this.parseImage(options, flags, storage)
    parsed.depth = 1
    parsed.width = (options.width as number) || (texture.width >> level) - x
    parsed.height = (options.height as number) || (texture.height >> level) - y

    check(
      texture.flags.type === parsed.type &&
        texture.flags.format === parsed.format &&
        texture.flags.internalFormat === parsed.internalFormat,
      'incompatible format for texture.subimage'
    )
    check(
      x >= 0 &&
        y >= 0 &&
        x + parsed.width <= (texture.width >> level) &&
        y + parsed.height <= (texture.height >> level),
      'texture.subimage write out of bounds'
    )

    const restore = this.tempBind(texture)
    try {
      this.uploadSubLevel3D(
        texture.target,
        x,
        y,
        slice,
        level,
        parsed
      )
    } finally {
      restore()
    }
  }

  private uploadSubLevel3D(
    target: number,
    x: number,
    y: number,
    z: number,
    level: number,
    image: TexImageLevel
  ): void {
    const gl = this.gl as WebGL2RenderingContext
    this.setPixelStorage(image)
    if (image.compressed) {
      gl.compressedTexSubImage3D(
        target,
        level,
        x,
        y,
        z,
        image.width,
        image.height,
        1,
        image.format,
        image.data as ArrayBufferView
      )
    } else {
      gl.texSubImage3D(
        target,
        level,
        x,
        y,
        z,
        image.width,
        image.height,
        1,
        image.format,
        image.type,
        image.data
      )
    }
  }

  private uploadSubLevel(
    target: number,
    x: number,
    y: number,
    level: number,
    image: TexImageLevel
  ): void {    const gl = this.gl
    this.setPixelStorage(image)
    if (image.element) {
      gl.texSubImage2D(
        target,
        level,
        x,
        y,
        image.format,
        image.type,
        image.element
      )
    } else if (image.compressed) {
      gl.compressedTexSubImage2D(
        target,
        level,
        x,
        y,
        image.width,
        image.height,
        image.format,
        image.data as ArrayBufferView
      )
    } else if (image.needsCopy) {
      gl.copyTexSubImage2D(
        target,
        level,
        x,
        y,
        image.xOffset,
        image.yOffset,
        image.width,
        image.height
      )
    } else {
      gl.texSubImage2D(
        target,
        level,
        x,
        y,
        image.width,
        image.height,
        image.format,
        image.type,
        image.data
      )
    }
  }

  resize2D(texture: TextureInternal, width: number, height = width): void {
    width |= 0
    height = (height | 0) || width
    if (width === texture.width && height === texture.height) return
    check(
      width > 0 &&
        height > 0 &&
        width <= this.limits.maxTextureSize &&
        height <= this.limits.maxTextureSize,
      'invalid texture size'
    )

    const oldWidth = texture.width
    texture.width = width
    texture.height = height

    const restore = this.tempBind(texture)
    try {
      const levels = texture.info.genMipmaps
        ? mipLevelCount(width, height)
        : Math.max(1, texture.faces[0]?.length || 1)
      for (let i = 0; i < levels; ++i) {
        const w = Math.max(1, width >> i)
        const h = Math.max(1, height >> i)
        if (!w || !h) break
        this.gl.texImage2D(
          GL.TEXTURE_2D,
          i,
          texture.flags.internalFormat,
          w,
          h,
          0,
          texture.flags.format,
          texture.flags.type,
          null
        )
      }
      if (texture.info.genMipmaps) {
        this.gl.generateMipmap(GL.TEXTURE_2D)
      }
    } finally {
      restore()
    }

    texture.faces[0] = null
    texture.mipmask = (1 << mipLevelCount(width, height)) - 1
    const formatInfo = this.tables.formats.get(texture.flags.formatName)
    texture.stats.size = getTextureSize(
      formatInfo?.bytesPerPixel || 4,
      width,
      height,
      mipLevelCount(width, height),
      false
    )
    void oldWidth
  }

  resizeCube(texture: TextureInternal, radius: number): void {
    radius |= 0
    check(
      radius > 0 && radius <= this.limits.maxCubeMapSize,
      'invalid cube map size'
    )
    if (radius === texture.width) return
    texture.width = radius
    texture.height = radius

    const restore = this.tempBind(texture)
    try {
      const levels = texture.info.genMipmaps
        ? mipLevelCount(radius, radius)
        : Math.max(1, texture.faces[0]?.length || 1)
      for (let face = 0; face < 6; ++face) {
        for (let level = 0; level < levels; ++level) {
          this.gl.texImage2D(
            GL.TEXTURE_CUBE_MAP_POSITIVE_X + face,
            level,
            texture.flags.internalFormat,
            Math.max(1, radius >> level),
            Math.max(1, radius >> level),
            0,
            texture.flags.format,
            texture.flags.type,
            null
          )
        }
      }
      if (texture.info.genMipmaps) {
        this.gl.generateMipmap(GL.TEXTURE_CUBE_MAP)
      }
    } finally {
      restore()
    }

    texture.faces = [null, null, null, null, null, null]
    texture.mipmask = (1 << mipLevelCount(radius, radius)) - 1
    const formatInfo = this.tables.formats.get(texture.flags.formatName)
    texture.stats.size = getTextureSize(
      formatInfo?.bytesPerPixel || 4,
      radius,
      radius,
      mipLevelCount(radius, radius),
      true
    )
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  decRef(texture: TextureInternal): void {
    if (--texture.refCount > 0) return
    this.destroyTexture(texture)
  }

  private destroyTexture(texture: TextureInternal): void {
    check(!!texture.handle, 'must not double destroy texture')
    const unit = texture.unit
    if (unit >= 0) {
      this.gl.activeTexture(GL.TEXTURE0 + unit)
      this.gl.bindTexture(texture.target, null)
      this.units[unit] = null
    }
    this.gl.deleteTexture(texture.handle)
    texture.handle = null
    texture.refCount = 0
    this.textureSet.delete(texture.id)
    if (texture.isCube) {
      this.stats.cubeCount--
    } else {
      this.stats.textureCount--
    }
  }

  clear(): void {
    for (const texture of Array.from(this.textureSet.values())) {
      texture.refCount = 1
      this.destroyTexture(texture)
    }
    this.textureSet.clear()
    this.resetUnits()
    this.stats.textureCount = 0
    this.stats.cubeCount = 0
  }

  private resetUnits(): void {
    for (let i = 0; i < this.units.length; ++i) {
      const texture = this.units[i]
      if (texture) {
        texture.bindCount = 0
        texture.unit = -1
        this.units[i] = null
      }
      this.gl.activeTexture(GL.TEXTURE0 + i)
      this.gl.bindTexture(GL.TEXTURE_2D, null)
      this.gl.bindTexture(GL.TEXTURE_CUBE_MAP, null)
    }
  }

  restore(): void {
    this.resetUnits()
    const gl2 = this.gl as WebGL2RenderingContext
    for (const texture of this.textureSet.values()) {
      texture.handle = this.gl.createTexture()
      texture.unit = -1
      texture.bindCount = 0
      texture.refCount = Math.max(1, texture.refCount)

      const restoreBind = this.tempBind(texture)
      try {
        // 先按 mipmask 分配所有层级的存储
        const levels = Math.max(1, bitCount(texture.mipmask))
        for (let level = 0; level < levels; ++level) {
          const w = Math.max(1, texture.width >> level)
          const h = Math.max(1, texture.height >> level)
          if (!w || !h) break
          if (texture.isLayered && !texture.flags.compressed) {
            const d = texture.is3D
              ? Math.max(1, texture.depth >> level)
              : texture.depth
            gl2.texImage3D(
              texture.target,
              level,
              texture.flags.internalFormat,
              w,
              h,
              d,
              0,
              texture.flags.format,
              texture.flags.type,
              null
            )
          } else if (!texture.isLayered && texture.isCube) {
            for (let face = 0; face < 6; ++face) {
              this.gl.texImage2D(
                GL.TEXTURE_CUBE_MAP_POSITIVE_X + face,
                level,
                texture.flags.internalFormat,
                w,
                h,
                0,
                texture.flags.format,
                texture.flags.type,
                null
              )
            }
          } else {
            this.gl.texImage2D(
              GL.TEXTURE_2D,
              level,
              texture.flags.internalFormat,
              w,
              h,
              0,
              texture.flags.format,
              texture.flags.type,
              null
            )
          }
        }

        // 再上传仍然保留描述的层级
        for (let face = 0; face < texture.faces.length; ++face) {
          const faceLevels = texture.faces[face]
          if (!faceLevels) continue
          const faceTarget = texture.isCube
            ? GL.TEXTURE_CUBE_MAP_POSITIVE_X + face
            : texture.isLayered
              ? texture.target
              : GL.TEXTURE_2D
          for (let level = 0; level < faceLevels.length; ++level) {
            const image = faceLevels[level]
            if (!image || image.needsCopy) continue
            this.uploadLevel(faceTarget, level, image)
          }
        }

        this.setTextureInfo(texture.target, texture.info)
        if (texture.info.genMipmaps) {
          this.gl.hint(GL.GENERATE_MIPMAP_HINT, texture.info.mipmapHint)
          this.gl.generateMipmap(texture.target)
        }
      } finally {
        restoreBind()
      }
    }
  }

  get(texture: unknown): TextureInternal | null {
    if (
      typeof texture === 'function' &&
      ((texture as unknown as { _reglType?: string })._reglType === 'texture2d' ||
        (texture as unknown as { _reglType?: string })._reglType === 'textureCube' ||
        (texture as unknown as { _reglType?: string })._reglType === 'texture3d' ||
        (texture as unknown as { _reglType?: string })._reglType === 'texture2dArray')
    ) {
      const internal = (texture as unknown as { _texture?: TextureInternal })
        ._texture
      return internal instanceof TextureInternal ? internal : null
    }
    return null
  }

  /** 用于 framebuffer 查询纹理格式是否可作为颜色附件。 */
  formatInfo(name: string): TextureFormatInfo | undefined {
    return this.tables.formats.get(name)
  }

  /** 所有纹理占用的显存估算（字节）。 */
  totalSize(): number {
    let total = 0
    for (const texture of this.textureSet.values()) {
      total += texture.stats.size
    }
    return total
  }
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

interface Texture2DOptionsInternal extends Record<string, unknown> {
  width?: number
  height?: number
  radius?: number
  channels?: number
  format?: string
  type?: string
  data?: unknown
  pixelBuffer?: Buffer
  pixelOffset?: number
  copy?: boolean
  x?: number
  y?: number
  mipmap?: unknown
  min?: string
  mag?: string
  wrap?: string | string[]
  wrapS?: string
  wrapT?: string
  wrapR?: string
  anisotropic?: number
  alignment?: number
  unpackAlignment?: number
  colorSpace?: string
  depth?: number
  layers?: number
  flipY?: boolean
  premultiplyAlpha?: boolean
  faces?: unknown[]
}

interface TextureCubeOptionsInternal extends Texture2DOptionsInternal {
  faces?: unknown[]
}

interface Texture3DOptionsInternal extends Texture2DOptionsInternal {
  depth?: number
  layers?: number
}

function isMipmapFilter(filter: number): boolean {
  return (
    filter === GL.NEAREST_MIPMAP_NEAREST ||
    filter === GL.NEAREST_MIPMAP_LINEAR ||
    filter === GL.LINEAR_MIPMAP_NEAREST ||
    filter === GL.LINEAR_MIPMAP_LINEAR
  )
}

/** 是否是半精度浮点类型（WebGL1 / WebGL2 枚举不同）。 */
function isHalfFloat(type: number): boolean {
  return type === GL.HALF_FLOAT || type === GL.HALF_FLOAT_OES
}

/** 规范化的类型名称，与旧版 regl 的 texture.type 输出保持一致。 */
function canonicalTypeName(type: number): string {
  switch (type) {
    case GL.UNSIGNED_BYTE:
      return 'uint8'
    case GL.BYTE:
      return 'int8'
    case GL.UNSIGNED_SHORT:
      return 'uint16'
    case GL.SHORT:
      return 'int16'
    case GL.UNSIGNED_INT:
      return 'uint32'
    case GL.INT:
      return 'int32'
    case GL.FLOAT:
      return 'float32'
    case GL.HALF_FLOAT:
    case GL.HALF_FLOAT_OES:
      return 'float16'
    case GL.UNSIGNED_SHORT_4_4_4_4:
      return 'rgba4'
    case GL.UNSIGNED_SHORT_5_6_5:
      return 'rgb565'
    case GL.UNSIGNED_SHORT_5_5_5_1:
      return 'rgb5 a1'
    case GL.UNSIGNED_INT_24_8:
      return 'depth stencil'
    default:
      return 'uint8'
  }
}

function mipLevelCount(width: number, height: number, depth = 1): number {
  return Math.floor(Math.log2(Math.max(width, height, depth))) + 1
}

/** 统计 mipmask 中置位的数量，即已分配的 mip 层级数。 */
function bitCount(mask: number): number {
  let count = 0
  while (mask) {
    count += mask & 1
    mask >>>= 1
  }
  return count
}

/** 每像素字节数（考虑类型大小与打包格式）。 */
function pixelSizeFor(flags: TextureFlags, tables: FormatTables): number {
  const fmt = tables.formats.get(flags.formatName)
  if (fmt && (fmt.fixedType || fmt.compressed)) {
    return fmt.bytesPerPixel
  }
  let typeSize = 1
  switch (flags.type) {
    case GL.FLOAT:
    case GL.UNSIGNED_INT:
    case GL.INT:
      typeSize = 4
      break
    case GL.HALF_FLOAT:
    case GL.HALF_FLOAT_OES:
    case GL.UNSIGNED_SHORT:
    case GL.SHORT:
      typeSize = 2
      break
    default:
      typeSize = 1
  }
  return flags.channels * typeSize
}

function getTextureSize(
  bytesPerPixel: number,
  width: number,
  height: number,
  levels: number,
  isCube: boolean,
  depth = 1,
  is3D = false
): number {
  let total = 0
  let w = width
  let h = height
  let d = depth
  for (let i = 0; i < levels; ++i) {
    total += w * h * d * bytesPerPixel
    w = Math.max(1, w >> 1)
    h = Math.max(1, h >> 1)
    d = is3D ? Math.max(1, d >> 1) : d
  }
  return Math.floor(total * (isCube ? 6 : 1))
}

function inferTextureShape(
  data: ArrayBufferView,
  channels: number
): { width: number; height: number } {
  const pixels = data.byteLength / (channels * byteSize(data))
  // 默认假设正方形纹理
  const side = Math.max(1, Math.round(Math.sqrt(pixels)))
  if (side * side === pixels) {
    return { width: side, height: side }
  }
  return { width: Math.max(1, pixels), height: 1 }
}

function byteSize(data: ArrayBufferView): number {
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) return 1
  if (data instanceof Uint16Array || data instanceof Int16Array) return 2
  if (
    data instanceof Uint32Array ||
    data instanceof Int32Array ||
    data instanceof Float32Array
  ) {
    return 4
  }
  if (data instanceof Int8Array) return 1
  return 1
}

function isTexImageSource(value: unknown): boolean {
  const tag = Object.prototype.toString.call(value)
  return (
    tag === '[object HTMLCanvasElement]' ||
    tag === '[object OffscreenCanvas]' ||
    tag === '[object CanvasRenderingContext2D]' ||
    tag === '[object ImageBitmap]' ||
    tag === '[object HTMLImageElement]' ||
    tag === '[object HTMLVideoElement]' ||
    tag === '[object ImageData]'
  )
}

/** 判断参数本身是否就是像素数据（而不是 options 对象）。 */
function isDirectPixelData(value: unknown): boolean {
  return (
    isTypedArray(value) ||
    Array.isArray(value) ||
    isNDArrayLike(value) ||
    value instanceof ArrayBuffer ||
    isTexImageSource(value)
  )
}

/** 用户是否显式指定了通道数/格式。 */
function wasChannelsExplicit(options: Record<string, unknown>): boolean {
  if ('channels' in options || 'format' in options) return true
  const shape = options.shape
  return Array.isArray(shape) && shape.length === 3
}

/**
 * 当用户只给了数据、没有给格式时，根据通道数推断基础格式。
 * 只修改 alpha/luminance/rgb/rgba 这类非 sized 的默认格式。
 */
function applyChannelFormat(
  flags: TextureFlags,
  channels: number,
  tables: FormatTables
): void {
  if (
    flags.formatName !== 'rgba' &&
    flags.formatName !== 'rgb' &&
    flags.formatName !== 'luminance' &&
    flags.formatName !== 'luminance alpha' &&
    flags.formatName !== 'alpha'
  ) {
    return
  }
  const name =
    channels === 1
      ? 'luminance'
      : channels === 2
        ? 'luminance alpha'
        : channels === 3
          ? 'rgb'
          : 'rgba'
  const info = tables.formats.get(name)
  if (!info) return
  flags.formatName = name
  flags.internalFormat = info.internalFormat
  flags.format = info.format
  flags.channels = info.channels
}

/** 根据 type 与 format 选择 WebGL2 sized internal format。 */
function resolveWebGL2InternalFormat(
  flags: TextureFlags & { width?: number; height?: number },
  tables: FormatTables
): number {
  const base = flags.formatName
  const type = flags.type
  if (base === 'rgba' || base === 'rgb') {
    const isFloat = type === GL.FLOAT
    const isHalf = type === GL.HALF_FLOAT
    if (base === 'rgba') {
      if (isFloat) return RGBA32F
      if (isHalf) return RGBA16F
      return RGBA8
    }
    if (isFloat) return RGB32F
    if (isHalf) return RGB16F
    return RGB8
  }
  if (base === 'alpha' || base === 'luminance') {
    // 保持 legacy 内部格式
    return flags.internalFormat
  }
  if (base === 'luminance alpha') return flags.internalFormat
  if (base === 'srgb' || base === 'srgba') {
    const info = tables.formats.get(base)
    return info ? info.internalFormat : flags.internalFormat
  }
  if (base === 'depth') {
    if (type === GL.UNSIGNED_SHORT) return DEPTH_COMPONENT16
    if (type === GL.FLOAT) return DEPTH_COMPONENT32F
    return DEPTH_COMPONENT24
  }
  if (base === 'depth stencil') return DEPTH24_STENCIL8
  return flags.internalFormat
}

// ---------------------------------------------------------------------------
// 用户可见包装
// ---------------------------------------------------------------------------

export interface Texture2DOptions {
  width?: number
  height?: number
  radius?: number
  shape?: [number, number] | [number, number, number]
  channels?: 1 | 2 | 3 | 4
  format?: string
  type?: string
  data?: unknown
  /** 从 WebGL2 PBO 上传；不能同时指定 data/copy。 */
  pixelBuffer?: Buffer
  pixelOffset?: number
  copy?: boolean
  x?: number
  y?: number
  mipmap?: boolean | string | unknown[]
  min?: string
  mag?: string
  wrap?: string | [string, string]
  wrapS?: string
  wrapT?: string
  anisotropic?: number
  alignment?: 1 | 2 | 4 | 8
  flipY?: boolean
  premultiplyAlpha?: boolean
  colorSpace?: 'none' | 'browser'
}

export interface TextureCubeOptions extends Texture2DOptions {
  faces?: Texture2DOptions[]
}

export interface Texture2DWrapper {
  (a?: Texture2DOptions | number | null, b?: number): Texture2DWrapper
  _reglType: 'texture2d'
  _texture: TextureInternal
  width: number
  height: number
  format: string
  type: string
  min: string
  mag: string
  wrapS: string
  wrapT: string
  subimage(
    image: unknown,
    x?: number,
    y?: number,
    level?: number
  ): Texture2DWrapper
  resize(width: number, height?: number): Texture2DWrapper
  destroy(): void
  stats: { size: number }
}

export interface TextureCubeWrapper {
  (
    a0?: TextureCubeOptions | number | null,
    a1?: Texture2DOptions,
    a2?: Texture2DOptions,
    a3?: Texture2DOptions,
    a4?: Texture2DOptions,
    a5?: Texture2DOptions
  ): TextureCubeWrapper
  _reglType: 'textureCube'
  _texture: TextureInternal
  width: number
  height: number
  format: string
  type: string
  min: string
  mag: string
  wrapS: string
  wrapT: string
  subimage(
    face: number,
    image: unknown,
    x?: number,
    y?: number,
    level?: number
  ): TextureCubeWrapper
  resize(radius: number): TextureCubeWrapper
  destroy(): void
  stats: { size: number }
}

export interface Texture3DWrapper {
  (
    a?: Texture3DOptionsInternal | number | null,
    b?: number,
    c?: number
  ): Texture3DWrapper
  _reglType: 'texture3d'
  _texture: TextureInternal
  width: number
  height: number
  depth: number
  format: string
  type: string
  min: string
  mag: string
  wrapS: string
  wrapT: string
  wrapR: string
  subimage(
    z: number,
    image: unknown,
    x?: number,
    y?: number,
    level?: number
  ): Texture3DWrapper
  destroy(): void
  stats: { size: number }
}

export interface Texture2DArrayWrapper {
  (
    a?: Texture3DOptionsInternal | number | null,
    b?: number,
    c?: number
  ): Texture2DArrayWrapper
  _reglType: 'texture2dArray'
  _texture: TextureInternal
  width: number
  height: number
  depth: number
  layers: number
  format: string
  type: string
  min: string
  mag: string
  wrapS: string
  wrapT: string
  wrapR: string
  subimage(
    layer: number,
    image: unknown,
    x?: number,
    y?: number,
    level?: number
  ): Texture2DArrayWrapper
  destroy(): void
  stats: { size: number }
}

function updateTextureProperties(
  wrapper: Texture2DWrapper | TextureCubeWrapper | Texture3DWrapper | Texture2DArrayWrapper,
  texture: TextureInternal,
  tables: FormatTables
): void {
  wrapper.width = texture.width
  wrapper.height = texture.height
  if ('depth' in wrapper) {
    wrapper.depth = texture.depth
  }
  if ('layers' in wrapper) {
    wrapper.layers = texture.depth
  }
  wrapper.format =
    texture.flags.formatName ||
    tables.formatNames.get(texture.flags.internalFormat) ||
    'rgba'
  wrapper.type =
    texture.flags.typeName || tables.typeNames.get(texture.flags.type) || 'uint8'
  wrapper.min = minFiltersInverse[texture.info.minFilter] || 'nearest'
  wrapper.mag = magFiltersInverse[texture.info.magFilter] || 'nearest'
  wrapper.wrapS = wrapModesInverse[texture.info.wrapS] || 'clamp'
  wrapper.wrapT = wrapModesInverse[texture.info.wrapT] || 'clamp'
  if ('wrapR' in wrapper) {
    wrapper.wrapR = wrapModesInverse[texture.info.wrapR] || 'clamp'
  }
}

function createTexture2DWrapper(
  texture: TextureInternal,
  update: (a?: unknown, b?: unknown) => Texture2DWrapper,
  store: TextureStore
): Texture2DWrapper {
  // 使用函数作为可调用资源
  const wrapper = ((a?: Texture2DOptions | number | null, b?: number) => {
    update(a, b)
    updateTextureProperties(wrapper, texture, store.tables)
    return wrapper
  }) as Texture2DWrapper

  wrapper._reglType = 'texture2d'
  wrapper._texture = texture
  wrapper.stats = texture.stats
  wrapper.width = texture.width
  wrapper.height = texture.height
  wrapper.format = 'rgba'
  wrapper.type = 'uint8'
  wrapper.min = 'nearest'
  wrapper.mag = 'nearest'
  wrapper.wrapS = 'clamp'
  wrapper.wrapT = 'clamp'

  wrapper.subimage = (
    image: unknown,
    x = 0,
    y = 0,
    level = 0
  ) => {
    store.subimage2D(texture, image, x | 0, y | 0, level | 0)
    return wrapper
  }
  wrapper.resize = (width: number, height?: number) => {
    store.resize2D(texture, width, height)
    updateTextureProperties(wrapper, texture, store.tables)
    return wrapper
  }
  wrapper.destroy = () => {
    store.decRef(texture)
  }

  // 初次上传后再同步属性
  updateTextureProperties(wrapper, texture, store.tables)
  return wrapper
}

function createTextureCubeWrapper(
  texture: TextureInternal,
  update: (
    a0?: unknown,
    a1?: unknown,
    a2?: unknown,
    a3?: unknown,
    a4?: unknown,
    a5?: unknown
  ) => TextureCubeWrapper,
  store: TextureStore
): TextureCubeWrapper {
  const wrapper = ((
    a0?: unknown,
    a1?: unknown,
    a2?: unknown,
    a3?: unknown,
    a4?: unknown,
    a5?: unknown
  ) => {
    update(a0, a1, a2, a3, a4, a5)
    return wrapper
  }) as unknown as TextureCubeWrapper

  wrapper._reglType = 'textureCube'
  wrapper._texture = texture
  wrapper.stats = texture.stats
  wrapper.width = texture.width
  wrapper.height = texture.height
  wrapper.format = 'rgba'
  wrapper.type = 'uint8'
  wrapper.min = 'nearest'
  wrapper.mag = 'nearest'
  wrapper.wrapS = 'clamp'
  wrapper.wrapT = 'clamp'

  wrapper.subimage = (
    face: number,
    image: unknown,
    x = 0,
    y = 0,
    level = 0
  ) => {
    store.subimageCube(texture, face, image, x | 0, y | 0, level | 0)
    return wrapper
  }
  wrapper.resize = (radius: number) => {
    store.resizeCube(texture, radius)
    updateTextureProperties(wrapper, texture, store.tables)
    return wrapper
  }
  wrapper.destroy = () => {
    store.decRef(texture)
  }

  updateTextureProperties(wrapper, texture, store.tables)
  return wrapper
}

function createTexture3DWrapper(
  texture: TextureInternal,
  update: (
    a?: Texture3DOptionsInternal | number | null,
    b?: number,
    c?: number
  ) => Texture3DWrapper | Texture2DArrayWrapper,
  store: TextureStore,
  isArray: boolean
): Texture3DWrapper | Texture2DArrayWrapper {
  const wrapper = ((
    a?: Texture3DOptionsInternal | number | null,
    b?: number,
    c?: number
  ) => {
    update(a, b, c)
    return wrapper
  }) as Texture3DWrapper | Texture2DArrayWrapper

  wrapper._reglType = isArray ? 'texture2dArray' : 'texture3d'
  wrapper._texture = texture
  wrapper.stats = texture.stats
  wrapper.width = texture.width
  wrapper.height = texture.height
  wrapper.depth = texture.depth
  if (isArray) {
    ;(wrapper as Texture2DArrayWrapper).layers = texture.depth
  }
  wrapper.format = 'rgba'
  wrapper.type = 'uint8'
  wrapper.min = 'nearest'
  wrapper.mag = 'nearest'
  wrapper.wrapS = 'clamp'
  wrapper.wrapT = 'clamp'
  wrapper.wrapR = 'clamp'

  wrapper.subimage = ((
    slice: number,
    image: unknown,
    x = 0,
    y = 0,
    level = 0
  ) => {
    store.subimage3D(texture, slice | 0, image, x | 0, y | 0, level | 0)
    return wrapper
  }) as typeof wrapper.subimage
  wrapper.destroy = () => {
    store.decRef(texture)
  }

  updateTextureProperties(wrapper, texture, store.tables)
  return wrapper
}

/** 判断是否是纹理资源。 */
export function isTexture(value: unknown): boolean {
  if (typeof value !== 'function') return false
  const type = (value as unknown as { _reglType?: string })._reglType
  return (
    type === 'texture2d' ||
    type === 'textureCube' ||
    type === 'texture3d' ||
    type === 'texture2dArray'
  )
}

/** 判断是否是 2D 纹理资源。 */
export function isTexture2D(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as { _reglType?: string })._reglType === 'texture2d'
  )
}

/** 判断是否是立方体纹理资源。 */
export function isTextureCube(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as { _reglType?: string })._reglType === 'textureCube'
  )
}

/** 判断是否是 3D 纹理资源。 */
export function isTexture3D(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as { _reglType?: string })._reglType === 'texture3d'
  )
}

/** 判断是否是 2D array 纹理资源。 */
export function isTexture2DArray(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as { _reglType?: string })._reglType === 'texture2dArray'
  )
}

// 避免未使用告警
void freeType
void convertToHalfFloat
void checkCommand
void isArrayLike
