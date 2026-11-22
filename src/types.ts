/**
 * 公共 TypeScript 类型定义。
 *
 * 目标：
 * - 覆盖 regl 2.x 的主要 API；
 * - 提供比原 `regl.d.ts` 更好的 Props/Context 泛型推导；
 * - 对 WebGL2 新增能力做类型补充（version 选项、更多纹理格式等）。
 */

import type { WebGLVersion } from './core/webgl'

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
export type Vec4 = [number, number, number, number]
export type BVec2 = [boolean, boolean]
export type BVec3 = [boolean, boolean, boolean]
export type BVec4 = [boolean, boolean, boolean, boolean]
export type Mat2 = [number, number, number, number]
export type Mat3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
]
export type Mat4 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
]

/** 初始化选项。 */
export interface InitializationOptions {
  /** 已有的 WebGL1/WebGL2 上下文。 */
  gl?: WebGLRenderingContext | WebGL2RenderingContext
  /** 画布或选择器；未指定时会自动创建。 */
  canvas?: HTMLCanvasElement | string
  /** 容器元素或选择器。 */
  container?: HTMLElement | string
  /** getContext 的属性。 */
  attributes?: WebGLContextAttributes
  /** 必须存在的扩展。 */
  extensions?: string | string[]
  /** 可选扩展。 */
  optionalExtensions?: string | string[]
  /** 设备像素比。 */
  pixelRatio?: number
  /** 是否启用性能统计。 */
  profile?: boolean
  /** 创建完成回调。 */
  onDone?: (err: string | null, regl?: Regl) => void
  /**
   * WebGL 版本：
   * - `'auto'`（默认）优先 WebGL2，失败回退 WebGL1；
   * - `1` / `'webgl1'` 只创建 WebGL1；
   * - `2` / `'webgl2'` 只创建 WebGL2。
   */
  version?: WebGLVersion
}

/**
 * createREGL 接受的参数。
 *
 * 最常见的是 InitializationOptions；同时兼容旧 regl 的便捷形式：
 * 选择器、canvas / 容器元素、已有 WebGL 上下文。
 */
export type InitializationArgs =
  | InitializationOptions
  | string
  | HTMLElement
  | WebGLRenderingContext
  | WebGL2RenderingContext

/** 传给 frame / scope 回调的默认上下文。 */
export interface DefaultContext {
  time: number
  tick: number
  viewportWidth: number
  viewportHeight: number
  framebufferWidth: number
  framebufferHeight: number
  drawingBufferWidth: number
  drawingBufferHeight: number
  pixelRatio: number
}

export interface Cancellable {
  cancel(): void
}

export type FrameCallback<Context extends DefaultContext = DefaultContext> = (
  context: Context
) => void;

/** 动态变量。 */
export interface DynamicVariable<T> {
  readonly _dyn: true
  readonly kind: number
  readonly path: (string | number)[]
  readonly fn: ((...args: unknown[]) => T) | null
  readonly value: T | null
}

export type DynamicVariableFn<
  T,
  Context extends DefaultContext = DefaultContext,
  Props extends {} = {}
> = (context: Context, props: Props, batchId: number) => T

export type MaybeDynamic<
  Type,
  Context extends DefaultContext = DefaultContext,
  Props extends {} = {}
> = Type | DynamicVariable<Type> | DynamicVariableFn<Type, Context, Props>

export type MaybeDynamicUniforms<
  Context extends DefaultContext = DefaultContext,
  Props extends {} = {}
> = Record<string, MaybeDynamic<unknown, Context, Props>>

export interface ClearOptions {
  color?: Vec4
  depth?: number
  stencil?: number
  framebuffer?: Framebuffer | null
  /** WebGL2 MRT：只清除指定的颜色附件（0-based）。 */
  colorAttachment?: number | number[]
}

export interface ReadOptions<T extends Uint8Array | Float32Array = Uint8Array> {
  x?: number
  y?: number
  width?: number
  height?: number
  data?: T
  framebuffer?: Framebuffer | null
  /** WebGL2 MRT：读取指定的颜色附件（0-based）。 */
  colorAttachment?: number
}

export interface BlitRect {
  x?: number
  y?: number
  width?: number
  height?: number
}

export type BlitMask =
  | 'color'
  | 'depth'
  | 'stencil'
  | Array<'color' | 'depth' | 'stencil'>

export interface BlitOptions {
  src?: Framebuffer | null
  dst?: Framebuffer | null
  srcRect?: BlitRect
  dstRect?: BlitRect
  mask?: BlitMask
  filter?: 'nearest' | 'linear'
  /** 多颜色附件的源读取层。 */
  srcColorAttachment?: number
}

export interface ReadPixelsToBufferOptions {
  framebuffer?: Framebuffer | null
  pixelBuffer: Buffer
  x?: number
  y?: number
  width?: number
  height?: number
  colorAttachment?: number
  /** PBO 字节偏移。 */
  offset?: number
}

export interface GetBufferSubDataOptions {
  offset?: number
  /** 读取字节数；省略时读取到 buffer 末尾。 */
  length?: number
  data?: ArrayBufferView
}

export type CommandBodyFn<
  Context extends DefaultContext = DefaultContext,
  Props extends {} = {}
> = (context: Context, props: Props | null, batchId: number) => void

export interface CommandStats {
  gpuTime: number
  cpuTime: number
  count: number
}

export interface DrawCommand<
  Context extends DefaultContext = DefaultContext,
  Props extends {} = {}
> {
  (props?: Props): void
  (count: number): void
  (props: Props[]): void
  (count: number, body: CommandBodyFn<Context, Props>): void
  (props: Props[], body: CommandBodyFn<Context, Props>): void
  (body: CommandBodyFn<Context, Props>): void
  stats: CommandStats
  uniformBlockLayout(blockName: string): UniformBlockLayout | null
  destroy(): void
}

export type PrimitiveType =
  | 'points'
  | 'lines'
  | 'line loop'
  | 'line strip'
  | 'triangles'
  | 'triangle strip'
  | 'triangle fan'

export type Uniform =
  | number
  | boolean
  | Vec2
  | Vec3
  | Vec4
  | BVec2
  | BVec3
  | BVec4
  | Mat2
  | Mat3
  | Mat4
  | Texture2D
  | TextureCube
  | Texture3D
  | Texture2DArray
  | Framebuffer
  | Framebuffer2D
  | FramebufferCube
  | SamplerTexture
  | ArrayLike<number>
  | ArrayLike<boolean>

// ---------------------------------------------------------------------------
// 状态选项
// ---------------------------------------------------------------------------

export type ComparisonOperatorType =
  | 'never'
  | 'less'
  | '<'
  | 'equal'
  | '='
  | '=='
  | '==='
  | 'lequal'
  | '<='
  | 'greater'
  | '>'
  | 'notequal'
  | '!='
  | '!=='
  | 'gequal'
  | '>='
  | 'always'

export interface DepthTestOptions {
  enable?: MaybeDynamic<boolean>
  func?: MaybeDynamic<ComparisonOperatorType>
  range?: MaybeDynamic<Vec2>
  mask?: MaybeDynamic<boolean>
}

export type BlendingEquation = 'add' | 'subtract' | 'reverse subtract' | 'min' | 'max'

export interface BlendingEquationSeparate {
  rgb: MaybeDynamic<BlendingEquation>
  alpha: MaybeDynamic<BlendingEquation>
}

export type BlendingFunction =
  | '0'
  | '1'
  | 'zero'
  | 'one'
  | 'src color'
  | 'one minus src color'
  | 'src alpha'
  | 'one minus src alpha'
  | 'dst color'
  | 'one minus dst color'
  | 'dst alpha'
  | 'one minus dst alpha'
  | 'constant color'
  | 'one minus constant color'
  | 'constant alpha'
  | 'one minus constant alpha'
  | 'src alpha saturate'

export interface BlendingFunctionCombined {
  src: MaybeDynamic<BlendingFunction>
  dst: MaybeDynamic<BlendingFunction>
}

export interface BlendingFunctionSeparate {
  srcRGB: MaybeDynamic<BlendingFunction>
  srcAlpha: MaybeDynamic<BlendingFunction>
  dstRGB: MaybeDynamic<BlendingFunction>
  dstAlpha: MaybeDynamic<BlendingFunction>
}

export interface BlendingOptions {
  enable?: MaybeDynamic<boolean>
  color?: MaybeDynamic<Vec4>
  equation?: MaybeDynamic<BlendingEquation | BlendingEquationSeparate>
  func?: MaybeDynamic<BlendingFunctionCombined | BlendingFunctionSeparate>
}

export type StencilOperationType =
  | '0'
  | 'zero'
  | 'keep'
  | 'replace'
  | 'increment'
  | 'decrement'
  | 'increment wrap'
  | 'decrement wrap'
  | 'invert'

export interface StencilOperation {
  fail?: MaybeDynamic<StencilOperationType>
  zfail?: MaybeDynamic<StencilOperationType>
  zpass?: MaybeDynamic<StencilOperationType>
}

export interface StencilFunction {
  cmp?: MaybeDynamic<ComparisonOperatorType>
  ref?: MaybeDynamic<number>
  mask?: MaybeDynamic<number>
}

export interface StencilOptions {
  enable?: MaybeDynamic<boolean>
  mask?: MaybeDynamic<number>
  func?: MaybeDynamic<StencilFunction>
  opFront?: MaybeDynamic<StencilOperation>
  opBack?: MaybeDynamic<StencilOperation>
  /** `op` 会同时设置 opFront 与 opBack。 */
  op?: MaybeDynamic<StencilOperation>
}

export interface PolygonOffsetOptions {
  enable?: MaybeDynamic<boolean>
  offset?: MaybeDynamic<{ factor?: number; units?: number }>
}

export type FaceOrientationType = 'front' | 'back'
export type FaceWindingType = 'cw' | 'ccw'

export interface CullingOptions {
  enable?: MaybeDynamic<boolean>
  face?: MaybeDynamic<FaceOrientationType>
}

export interface SampleCoverage {
  value?: MaybeDynamic<number>
  invert?: MaybeDynamic<boolean>
}

export interface SamplingOptions {
  alpha?: MaybeDynamic<boolean>
  enable?: MaybeDynamic<boolean>
  coverage?: MaybeDynamic<SampleCoverage>
}

export interface ScissorOptions {
  enable?: MaybeDynamic<boolean>
  box?: MaybeDynamic<BoundingBox>
}

export interface BoundingBox {
  x?: number
  y?: number
  width?: number
  height?: number
}

// ---------------------------------------------------------------------------
// uniform / attribute
// ---------------------------------------------------------------------------

export type Uniforms = Record<string, MaybeDynamic<Uniform>>

export interface ConstantAttribute {
  constant:
    | number
    | Vec2
    | Vec3
    | Vec4
    | [number]
    | [number, number]
    | [number, number, number]
}

export interface AttributeConfig {
  buffer: Buffer | BufferData
  offset?: number
  stride?: number
  size?: 1 | 2 | 3 | 4
  type?:
    | 'int8'
    | 'uint8'
    | 'int16'
    | 'uint16'
    | 'int32'
    | 'uint32'
    | 'float'
    | 'float32'
  normalized?: boolean
  /** 仅 WebGL2：以整数 attribute 方式绑定（ivec/uvec）。 */
  integer?: boolean
  divisor?: number
}

export type Attribute =
  | Buffer
  | BufferData
  | ConstantAttribute
  | AttributeConfig
  /** 显式 attribute location（配合 VAO 使用）。 */
  | number

export type Attributes = Record<string, MaybeDynamic<Attribute>>

// ---------------------------------------------------------------------------
// 资源
// ---------------------------------------------------------------------------

export interface Resource {
  destroy(): void
  readonly _reglType: string
}

export type BufferUsageHint = 'static' | 'dynamic' | 'stream'
export type BufferDataType =
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'float'
  | 'float32'

export interface BufferDataOptions {
  data?: BufferData
  usage?: BufferUsageHint
  type?: BufferDataType
  dimension?: number
  length?: number
}

export type BufferData =
  | ArrayLike<number>
  | Array<ArrayLike<number>>
  | ArrayBuffer
  | NDArrayLike

/** 兼容旧版 regl.d.ts 的命名。 */
export type BufferOptions = BufferDataOptions

export interface Buffer extends Resource {
  (options?: BufferDataOptions | BufferData | number | null): Buffer
  subdata(data: BufferData, offset?: number): Buffer
  _buffer: unknown
  stats: { size: number }
}

export type ElementsDataType = 'uint8' | 'uint16' | 'uint32'

export interface ElementsOptions {
  data?: ElementsData
  usage?: BufferUsageHint
  primitive?: PrimitiveType
  count?: number
  type?: ElementsDataType
  length?: number
}

export type ElementsData =
  | ArrayLike<number>
  | number[]
  | number[][]
  | NDArrayLike

export interface Elements extends Resource {
  (options?: ElementsOptions | ElementsData | number | null): Elements
  subdata(data: ElementsData, offset?: number): Elements
  _elements: unknown
}

export interface NDArrayLike {
  shape: number[]
  stride: number[]
  offset?: number
  data: ArrayLike<number> | ArrayBufferView
}

export type TextureFormatType =
  | 'alpha'
  | 'luminance'
  | 'luminance alpha'
  | 'rgb'
  | 'rgba'
  | 'rgba4'
  | 'rgb5 a1'
  | 'rgb565'
  | 'srgb'
  | 'srgba'
  | 'depth'
  | 'depth stencil'
  | 'r8'
  | 'rg8'
  | 'rgb8'
  | 'rgba8'
  | 'r8ui'
  | 'rg8ui'
  | 'rgb8ui'
  | 'rgba8ui'
  | 'r16ui'
  | 'rg16ui'
  | 'rgba16ui'
  | 'r32ui'
  | 'rg32ui'
  | 'rgba32ui'
  | 'r8i'
  | 'rg8i'
  | 'rgba8i'
  | 'r16i'
  | 'rg16i'
  | 'rgba16i'
  | 'r32i'
  | 'rg32i'
  | 'rgba32i'
  | 'r16f'
  | 'rg16f'
  | 'rgb16f'
  | 'rgba16f'
  | 'r32f'
  | 'rg32f'
  | 'rgb32f'
  | 'rgba32f'
  | 'depth16'
  | 'depth24'
  | 'depth32f'
  | 'depth24 stencil8'
  | 'rgb s3tc dxt1'
  | 'rgba s3tc dxt1'
  | 'rgba s3tc dxt3'
  | 'rgba s3tc dxt5'
  | 'rgb etc1'
  | 'rgb etc2'
  | 'rgba etc2'
  | 'r11 eac'
  | 'rg11 eac'
  | 'rgba astc 4x4'
  | 'rgba bptc'
  | string

export type TextureDataType =
  | 'uint8'
  | 'uint16'
  | 'uint32'
  | 'float'
  | 'float32'
  | 'half float'
  | 'float16'
  | 'int8'
  | 'int16'
  | 'int32'
  | 'depth stencil'
  | 'uint8i'
  | 'uint16i'
  | 'uint32i'
  | 'rgba4'
  | 'rgb565'
  | 'rgb5 a1'

export type TextureMagFilterType = 'nearest' | 'linear'
export type TextureMinFilterType =
  | TextureMagFilterType
  | 'mipmap'
  | 'nearest mipmap nearest'
  | 'linear mipmap nearest'
  | 'nearest mipmap linear'
  | 'linear mipmap linear'
export type TextureWrapModeType = 'repeat' | 'clamp' | 'mirror'
export type TextureMipmapHintType = "don't care" | 'dont care' | 'nice' | 'fast'
export type TextureColorSpaceType = 'none' | 'browser'
export type TextureChannelsType = 1 | 2 | 3 | 4
export type TextureUnpackAlignmentType = 1 | 2 | 4 | 8
export type TextureCubeFaceIndex = 0 | 1 | 2 | 3 | 4 | 5

export type TextureImageData =
  | ArrayLike<number>
  | number[]
  | number[][]
  | number[][][]
  | NDArrayLike
  | ImageData
  | HTMLImageElement
  | HTMLCanvasElement
  | HTMLVideoElement
  | ImageBitmap
  | OffscreenCanvas
  | CanvasRenderingContext2D
  | Uint8Array

export interface Texture2DOptions {
  shape?: [number, number] | [number, number, number]
  radius?: number
  width?: number
  height?: number
  channels?: TextureChannelsType
  format?: TextureFormatType
  type?: TextureDataType
  data?: TextureImageData
  /** 从 WebGL2 PBO 上传；不能同时指定 data/copy。 */
  pixelBuffer?: Buffer
  pixelOffset?: number
  copy?: boolean
  x?: number
  y?: number
  mipmap?: boolean | TextureMipmapHintType | Texture2DOptions[]
  min?: TextureMinFilterType
  mag?: TextureMagFilterType
  wrap?: TextureWrapModeType | [TextureWrapModeType, TextureWrapModeType]
  wrapS?: TextureWrapModeType
  wrapT?: TextureWrapModeType
  anisotropic?: number
  alignment?: TextureUnpackAlignmentType
  flipY?: boolean
  premultiplyAlpha?: boolean
  colorSpace?: TextureColorSpaceType
}

export interface Texture2D extends Resource {
  (
    options?: Texture2DOptions | TextureImageData | number | null,
    height?: number
  ): Texture2D
  width: number
  height: number
  format: string
  type: string
  min: string
  mag: string
  wrapS: string
  wrapT: string
  subimage(
    image: Texture2DOptions | TextureImageData,
    x?: number,
    y?: number,
    level?: number
  ): Texture2D
  resize(width: number, height?: number): Texture2D
  stats: { size: number }
  _texture: unknown
}

export interface TextureCubeOptions extends Texture2DOptions {
  faces?: (Texture2DOptions | TextureImageData)[]
}

export interface TextureCube extends Resource {
  (
    options?: TextureCubeOptions | TextureImageData | number | null,
    a1?: Texture2DOptions | TextureImageData,
    a2?: Texture2DOptions | TextureImageData,
    a3?: Texture2DOptions | TextureImageData,
    a4?: Texture2DOptions | TextureImageData,
    a5?: Texture2DOptions | TextureImageData
  ): TextureCube
  width: number
  height: number
  format: string
  type: string
  min: string
  mag: string
  wrapS: string
  wrapT: string
  subimage(
    face: TextureCubeFaceIndex,
    image: Texture2DOptions | TextureImageData,
    x?: number,
    y?: number,
    level?: number
  ): TextureCube
  resize(radius: number): TextureCube
  stats: { size: number }
  _texture: unknown
}

export type Texture = Texture2D | TextureCube | Texture3D | Texture2DArray

export interface Texture3DOptions extends Texture2DOptions {
  depth?: number
  layers?: number
  wrapR?: TextureWrapModeType
  mipmap?: boolean | TextureMipmapHintType | Texture3DOptions[]
}

export interface Texture3D extends Resource {
  (
    options?: Texture3DOptions | TextureImageData | number | null,
    height?: number,
    depth?: number
  ): Texture3D
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
    image: Texture3DOptions | TextureImageData,
    x?: number,
    y?: number,
    level?: number
  ): Texture3D
  stats: { size: number }
  _texture: unknown
}

export interface Texture2DArrayOptions extends Texture3DOptions {
  layers?: number
}

export interface Texture2DArray extends Resource {
  (
    options?: Texture2DArrayOptions | TextureImageData | number | null,
    height?: number,
    layers?: number
  ): Texture2DArray
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
    image: Texture2DArrayOptions | TextureImageData,
    x?: number,
    y?: number,
    level?: number
  ): Texture2DArray
  stats: { size: number }
  _texture: unknown
}

export type RenderbufferFormat =
  | 'rgba4'
  | 'rgb565'
  | 'rgb5 a1'
  | 'rgba8'
  | 'rgb8'
  | 'r8'
  | 'rg8'
  | 'srgba'
  | 'rgba16f'
  | 'rgb16f'
  | 'r16f'
  | 'rg16f'
  | 'rgba32f'
  | 'r32f'
  | 'rg32f'
  | 'depth'
  | 'depth16'
  | 'depth24'
  | 'depth32f'
  | 'stencil'
  | 'depth stencil'
  | 'depth24 stencil8'
  | string

export interface RenderbufferOptions {
  shape?: [number, number]
  radius?: number
  width?: number
  height?: number
  format?: RenderbufferFormat
  samples?: number
}

export interface Renderbuffer extends Resource {
  (options?: RenderbufferOptions | number | null, height?: number): Renderbuffer
  width: number
  height: number
  format: string
  samples: number
  resize(width: number, height?: number): Renderbuffer
  stats: { size: number }
  _renderbuffer: unknown
}

export interface FramebufferTextureLayer {
  texture: Texture3D | Texture2DArray
  layer?: number
}

export type Framebuffer2DAttachment =
  | Texture2D
  | Texture3D
  | Texture2DArray
  | FramebufferTextureLayer
  | Renderbuffer

export type FramebufferColorFormat =
  | 'rgba'
  | 'rgb'
  | 'rgba4'
  | 'rgb565'
  | 'rgb5 a1'
  | 'rgba8'
  | 'rgb8'
  | 'r8'
  | 'rg8'
  | 'srgba'
  | 'rgba16f'
  | 'rgb16f'
  | 'r16f'
  | 'rg16f'
  | 'rgba32f'
  | 'r32f'
  | 'rg32f'
  | string

export interface FramebufferOptions {
  shape?: [number, number]
  radius?: number
  width?: number
  height?: number
  color?: Framebuffer2DAttachment | Framebuffer2DAttachment[]
  colors?: Framebuffer2DAttachment | Framebuffer2DAttachment[]
  colorCount?: number
  colorTexture?: boolean
  colorFormat?: FramebufferColorFormat
  colorType?: 'uint8' | 'half float' | 'float16' | 'float' | 'float32'
  /** WebGL2 multisample 数量；0 / 省略表示普通 framebuffer。 */
  samples?: number
  depth?: boolean | Texture2D | Renderbuffer
  stencil?: boolean | Renderbuffer
  depthStencil?: boolean | Texture2D | Renderbuffer
  depthTexture?: boolean
  depthStencilTexture?: boolean
}

export interface Framebuffer2D extends Resource {
  (options?: FramebufferOptions | number | null, height?: number): Framebuffer2D
  width: number
  height: number
  samples: number
  color: Framebuffer2DAttachment[]
  depth: Texture2D | Renderbuffer | null
  stencil: Renderbuffer | null
  depthStencil: Texture2D | Renderbuffer | null
  resize(width: number, height?: number): Framebuffer2D
  use(block: () => void): void
  _framebuffer: unknown
}

export interface FramebufferCubeOptions extends Omit<FramebufferOptions, 'color'> {
  color?: TextureCube | TextureCube[]
}

export interface FramebufferCube extends Resource {
  (options?: FramebufferCubeOptions | number | null): FramebufferCube
  width: number
  height: number
  color: TextureCube[]
  faces: Framebuffer2D[]
  resize(radius: number): FramebufferCube
}

export type Framebuffer = Framebuffer2D | FramebufferCube

export interface VertexArrayAttributeSpec {
  data?: BufferData
  buffer?: Buffer | BufferData
  size?: 1 | 2 | 3 | 4
  type?: BufferDataType
  offset?: number
  stride?: number
  normalized?: boolean
  /** 仅 WebGL2：以整数 attribute 方式绑定（ivec/uvec）。 */
  integer?: boolean
  divisor?: number
  constant?: number | Vec2 | Vec3 | Vec4
  x?: number
  y?: number
  z?: number
  w?: number
}

export interface VertexArrayOptions {
  attributes: (Attribute | VertexArrayAttributeSpec | number)[]
  elements?: Elements | ElementsData
  count?: number
  offset?: number
  instances?: number
  primitive?: PrimitiveType
}

export interface VertexArrayObject extends Resource {
  (options?: VertexArrayOptions | Attribute[]): VertexArrayObject
  _vao: unknown
}

// ---------------------------------------------------------------------------
// WebGL2 Sampler Object
// ---------------------------------------------------------------------------

export type SamplerCompare = ComparisonOperatorType | 'none'

export interface SamplerOptions {
  min?: TextureMinFilterType
  mag?: TextureMagFilterType
  wrap?: TextureWrapModeType | [TextureWrapModeType, TextureWrapModeType]
  wrapS?: TextureWrapModeType
  wrapT?: TextureWrapModeType
  wrapR?: TextureWrapModeType
  compare?: SamplerCompare | false
  minLod?: number
  maxLod?: number
  lodBias?: number
  anisotropic?: number
}

export interface Sampler extends Resource {
  (options?: SamplerOptions): Sampler
  _sampler: unknown
}

/** 将 texture 与 sampler object 配对作为 sampler uniform 的值。 */
export interface SamplerTexture {
  texture:
    | Texture2D
    | TextureCube
    | Texture3D
    | Texture2DArray
    | Framebuffer2D
    | FramebufferCube
  sampler?: Sampler
}

// ---------------------------------------------------------------------------
// Uniform Buffer（WebGL2 UBO）
// ---------------------------------------------------------------------------

export interface UniformBlockLayoutMember {
  name: string
  type: number
  offset: number
  size: number
  arrayStride: number
  matrixStride: number
  rowMajor: boolean
}

export interface UniformBlockLayout {
  name: string
  dataSize: number
  uniforms: UniformBlockLayoutMember[]
  members: Record<string, UniformBlockLayoutMember>
}

export interface UniformBufferOptions {
  data?: BufferData
  usage?: BufferUsageHint
  size?: number
  length?: number
  persistent?: boolean
}

export interface UniformBlockRange {
  buffer: UniformBuffer
  offset?: number
  size?: number
  binding?: number
}

/** Phase 2 显式结构化值包装。 */
export interface UniformBlockValues {
  values: Record<string, unknown>
  binding?: number
}

export type UniformBlockValue =
  | UniformBuffer
  | UniformBlockRange
  | UniformBlockValues
  | Record<string, unknown>

export interface UniformBuffer extends Resource {
  (
    options?: UniformBufferOptions | BufferData | number | null
  ): UniformBuffer
  readonly layout: UniformBlockLayout | null
  member(name: string, value: unknown): UniformBuffer
  set(values: Record<string, unknown>): UniformBuffer
  attachLayout(
    commandOrLayout:
      | { uniformBlockLayout?: (name: string) => UniformBlockLayout | null }
      | UniformBlockLayout,
    blockName?: string
  ): UniformBuffer
  subdata(data: BufferData, offset?: number): UniformBuffer
  stats: { size: number }
  _buffer: unknown
}

// ---------------------------------------------------------------------------
// 绘制配置
// ---------------------------------------------------------------------------

export interface DrawConfig<
  Context extends DefaultContext = DefaultContext,
  Props extends {} = {}
> {
  vert?: MaybeDynamic<string, Context, Props>
  frag?: MaybeDynamic<string, Context, Props>
  attributes?: Record<string, MaybeDynamic<Attribute, Context, Props>>
  uniforms?: Record<string, MaybeDynamic<Uniform, Context, Props>>
  uniformBlocks?: Record<
    string,
    MaybeDynamic<UniformBlockValue | null, Context, Props>
  >
  context?: Record<string, MaybeDynamic<unknown, Context, Props>>
  framebuffer?: MaybeDynamic<Framebuffer2D | null, Context, Props>
  vao?: MaybeDynamic<VertexArrayObject | VertexArrayOptions | null, Context, Props>
  elements?: MaybeDynamic<Elements | ElementsData | null, Context, Props>
  count?: MaybeDynamic<number, Context, Props>
  offset?: MaybeDynamic<number, Context, Props>
  instances?: MaybeDynamic<number, Context, Props>
  primitive?: MaybeDynamic<PrimitiveType, Context, Props>
  profile?: MaybeDynamic<boolean, Context, Props>

  dither?: MaybeDynamic<boolean, Context, Props>
  blend?: BlendingOptions
  depth?: DepthTestOptions
  cull?: CullingOptions
  stencil?: StencilOptions
  polygonOffset?: PolygonOffsetOptions
  sample?: SamplingOptions
  scissor?: ScissorOptions
  viewport?: MaybeDynamic<BoundingBox, Context, Props>
  colorMask?: MaybeDynamic<BVec4, Context, Props>
  frontFace?: MaybeDynamic<FaceWindingType, Context, Props>
  lineWidth?: MaybeDynamic<number, Context, Props>

  // 扁平写法（regl 同时支持两种）
  'blend.enable'?: MaybeDynamic<boolean, Context, Props>
  'blend.color'?: MaybeDynamic<Vec4, Context, Props>
  'blend.equation'?: MaybeDynamic<BlendingEquation | BlendingEquationSeparate, Context, Props>
  'blend.func'?: MaybeDynamic<BlendingFunctionCombined | BlendingFunctionSeparate, Context, Props>
  'depth.enable'?: MaybeDynamic<boolean, Context, Props>
  'depth.func'?: MaybeDynamic<ComparisonOperatorType, Context, Props>
  'depth.range'?: MaybeDynamic<Vec2, Context, Props>
  'depth.mask'?: MaybeDynamic<boolean, Context, Props>
  'cull.enable'?: MaybeDynamic<boolean, Context, Props>
  'cull.face'?: MaybeDynamic<FaceOrientationType, Context, Props>
  'polygonOffset.enable'?: MaybeDynamic<boolean, Context, Props>
  'polygonOffset.offset'?: MaybeDynamic<{ factor?: number; units?: number }, Context, Props>
  'sample.alpha'?: MaybeDynamic<boolean, Context, Props>
  'sample.enable'?: MaybeDynamic<boolean, Context, Props>
  'sample.coverage'?: MaybeDynamic<SampleCoverage, Context, Props>
  'stencil.enable'?: MaybeDynamic<boolean, Context, Props>
  'stencil.mask'?: MaybeDynamic<number, Context, Props>
  'stencil.func'?: MaybeDynamic<StencilFunction, Context, Props>
  'stencil.opFront'?: MaybeDynamic<StencilOperation, Context, Props>
  'stencil.opBack'?: MaybeDynamic<StencilOperation, Context, Props>
  'scissor.enable'?: MaybeDynamic<boolean, Context, Props>
  'scissor.box'?: MaybeDynamic<BoundingBox, Context, Props>
}

// ---------------------------------------------------------------------------
// 限制 / 统计
// ---------------------------------------------------------------------------

export interface Limits {
  colorBits: [number, number, number, number]
  depthBits: number
  stencilBits: number
  subpixelBits: number
  extensions: string[]
  maxAnisotropic: number
  maxDrawbuffers: number
  maxColorAttachments: number
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
  glsl: string
  renderer: string
  vendor: string
  version: string
  readFloat: boolean
  npotTextureCube: boolean
  textureFormats: string[]
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

export interface Stats {
  vaoCount: number
  bufferCount: number
  elementsCount: number
  framebufferCount: number
  shaderCount: number
  textureCount: number
  cubeCount: number
  renderbufferCount: number
  samplerCount: number
  maxTextureUnits: number
  getTotalBufferSize?(): number
  getTotalTextureSize?(): number
  getTotalRenderbufferSize?(): number
  getMaxUniformsCount?(): number
  getMaxAttributesCount?(): number
}

// ---------------------------------------------------------------------------
// Regl 实例
// ---------------------------------------------------------------------------

export interface Regl {
  <Props extends {} = {}, Context extends DefaultContext = DefaultContext>(
    config: DrawConfig<Context, Props>
  ): DrawCommand<Context, Props>

  clear(options: ClearOptions): void

  prop<T = any>(name: string): DynamicVariable<T>
  context<T = any>(name: string): DynamicVariable<T>
  this<T = any>(name: string): DynamicVariable<T>

  /** 空命令，主要用作 scope。 */
  draw(): void

  /** 同一批命令共享 batchId，用于动态变量缓存与批量绘制。 */
  batch(body: () => void): void

  /** 应用一组状态并在其作用域内执行命令。 */
  scope(
    config: DrawConfig<DefaultContext, Record<string, unknown>>,
    body: CommandBodyFn<DefaultContext, Record<string, unknown>>
  ): void

  buffer(options?: BufferDataOptions | BufferData | number | null): Buffer
  elements(options?: ElementsOptions | ElementsData | number | null): Elements
  texture(
    options?: Texture2DOptions | TextureImageData | number | null,
    height?: number
  ): Texture2D
  cube(
    options?: TextureCubeOptions | TextureImageData | number | null,
    a1?: Texture2DOptions | TextureImageData,
    a2?: Texture2DOptions | TextureImageData,
    a3?: Texture2DOptions | TextureImageData,
    a4?: Texture2DOptions | TextureImageData,
    a5?: Texture2DOptions | TextureImageData
  ): TextureCube
  /** WebGL2 3D 纹理。 */
  texture3D(
    options?: Texture3DOptions | TextureImageData | number | null,
    height?: number,
    depth?: number
  ): Texture3D
  /** WebGL2 2D array 纹理。 */
  texture2DArray(
    options?: Texture2DArrayOptions | TextureImageData | number | null,
    height?: number,
    layers?: number
  ): Texture2DArray
  renderbuffer(options?: RenderbufferOptions | number | null, height?: number): Renderbuffer
  framebuffer(options?: FramebufferOptions | number | null, height?: number): Framebuffer2D
  framebufferCube(options?: FramebufferCubeOptions | number | null): FramebufferCube
  vao(options?: VertexArrayOptions | Attribute[]): VertexArrayObject
  /** 创建 WebGL2 sampler object（WebGL1 下抛错）。 */
  sampler(options?: SamplerOptions): Sampler
  /** 创建 WebGL2 uniform buffer（WebGL1 下抛错）。 */
  uniformBuffer(
    options?: UniformBufferOptions | BufferData | number | null
  ): UniformBuffer

  attributes: WebGLContextAttributes
  frame(callback: FrameCallback): Cancellable
  on(event: 'frame', callback: FrameCallback): Cancellable
  on(event: 'lost' | 'restore' | 'destroy', callback: () => void): Cancellable

  limits: Limits
  hasExtension(name: string): boolean
  read(options: ReadOptions<Float32Array> & { data: Float32Array }): Float32Array
  read(data: Float32Array): Float32Array
  read(options?: ReadOptions<Uint8Array> | Uint8Array): Uint8Array
  /** 创建 WebGL2 PBO（PIXEL_PACK_BUFFER）。 */
  pixelBuffer(options?: BufferDataOptions | BufferData | number | null): Buffer
  /** 将 readPixels 结果异步写入 PBO。 */
  readPixelsToBuffer(options: ReadPixelsToBufferOptions): Buffer
  /** 从 PBO / 普通 buffer 异步回读。 */
  readBuffer(buffer: Buffer, options?: GetBufferSubDataOptions): Uint8Array
  /** WebGL2 copyBufferSubData。 */
  copyBufferSubData(
    src: Buffer,
    dst: Buffer,
    srcOffset?: number,
    dstOffset?: number,
    size?: number
  ): void
  /** WebGL2 framebuffer blit / MSAA resolve。 */
  blitFramebuffer(options?: BlitOptions): void
  destroy(): void

  readonly _gl: WebGLRenderingContext | WebGL2RenderingContext
  _refresh(): void
  poll(): void
  now(): number
  stats: Stats
}

/** 创建 regl 实例。 */
export type CreateREGL = {
  (): Regl
  (selector: string): Regl
  (container: HTMLElement): Regl
  (canvas: HTMLCanvasElement): Regl
  (gl: WebGLRenderingContext | WebGL2RenderingContext): Regl
  (options: InitializationOptions): Regl
}
