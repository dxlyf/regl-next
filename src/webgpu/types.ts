/// <reference types="@webgpu/types" />

/**
 * WebGPU-first PoC 的公共类型。
 *
 * 这不是 regl WebGL API 的 1:1 兼容层，而是一个更贴近 WebGPU
 * 显式管线模型的轻量封装：
 * - 资源创建保持同步；
 * - 回读通过 `readTexture` 异步完成；
 * - pipeline / bind group / render pass 都是显式对象。
 */

export type GPUBufferUsageName =
  | 'vertex'
  | 'index'
  | 'uniform'
  | 'storage'
  | 'copy-src'
  | 'copy-dst'
  | 'indirect'
  | 'query-resolve'
  | 'map-read'

export interface GPUBufferOptions {
  /** 初始数据；number 表示只分配字节数。 */
  data?: ArrayBufferView | ArrayBuffer | number
  size?: number
  usage?: GPUBufferUsageName[] | GPUBufferUsageFlags
  label?: string
}

export interface GPUBufferResource {
  readonly _gpuType: 'buffer'
  readonly buffer: GPUBuffer
  readonly size: number
  readonly usage: GPUBufferUsageFlags
  write(data: ArrayBufferView | ArrayBuffer, offset?: number): void
  destroy(): void
}

export type GPUTextureUsageName =
  | 'texture-binding'
  | 'storage-binding'
  | 'copy-src'
  | 'copy-dst'
  | 'render-attachment'

export type GPUTextureSource =
  | ImageBitmap
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | VideoFrame

export interface GPUTextureOptions {
  width: number
  height: number
  depthOrArrayLayers?: number
  /** 3D 深度；等价于 depthOrArrayLayers。 */
  depth?: number
  /** 2D array 层数；等价于 depthOrArrayLayers。 */
  layers?: number
  dimension?: GPUTextureDimension
  viewDimension?: GPUTextureViewDimension
  format?: GPUTextureFormat
  usage?: GPUTextureUsageName[] | GPUTextureUsageFlags
  data?: ArrayBufferView
  /** cube map 的 6 个 face；存在时自动创建 cube 纹理。 */
  faces?: ArrayBufferView[]
  image?: GPUTextureSource
  sampleCount?: number
  mipLevelCount?: number
  label?: string
}

export interface GPUTextureResource {
  readonly _gpuType: 'texture'
  readonly texture: GPUTexture
  readonly view: GPUTextureView
  readonly width: number
  readonly height: number
  readonly depthOrArrayLayers: number
  readonly dimension: GPUTextureDimension
  readonly viewDimension: GPUTextureViewDimension
  readonly format: GPUTextureFormat
  readonly sampleCount: number
  /** 2D array / cube 的某一层视图；3D 不支持单层 render view。 */
  layerView(layer: number, mipLevel?: number): GPUTextureView
  /** 重新上传完整纹理数据（用于对象池复用）。 */
  upload(data: ArrayBufferView, mipLevel?: number): void
  /** 上传某一个 cube face（用于对象池复用）。 */
  uploadFace(face: number, data: ArrayBufferView, mipLevel?: number): void
  destroy(): void
}

export interface GPUSamplerOptions {
  addressModeU?: GPUAddressMode
  addressModeV?: GPUAddressMode
  addressModeW?: GPUAddressMode
  magFilter?: GPUFilterMode
  minFilter?: GPUFilterMode
  mipmapFilter?: GPUMipmapFilterMode
  lodMinClamp?: number
  lodMaxClamp?: number
  compare?: GPUCompareFunction
  maxAnisotropy?: number
  label?: string
}

export interface GPUSamplerResource {
  readonly _gpuType: 'sampler'
  readonly sampler: GPUSampler
  destroy(): void
}

export type GPUVertexFormatName = GPUVertexFormat

export interface GPUVertexAttributeSpec {
  name?: string
  format: GPUVertexFormat
  /** 所属 vertex buffer slot，默认 0。 */
  buffer?: number
  offset?: number
  /** 该 vertex buffer 的 stride；同一个 buffer 只需在任意一个 attribute 上指定。 */
  stride?: number
  shaderLocation?: number
  stepMode?: GPUVertexStepMode
}

export type GPUBindingKind =
  | 'uniform'
  | 'storage'
  | 'read-only-storage'
  | 'texture'
  | 'storage-texture'
  | 'sampler'
  | 'comparison-sampler'

export interface GPUBindingSpec {
  binding: number
  kind: GPUBindingKind
  /** bind group index，默认 0。 */
  group?: number
  visibility?: GPUShaderStageFlags
  textureSampleType?: GPUTextureSampleType
  viewDimension?: GPUTextureViewDimension
  samplerType?: GPUSamplerBindingType
  storageTextureFormat?: GPUTextureFormat
  /** uniform / storage buffer 的最小绑定字节数。 */
  minBindingSize?: number
  /** 是否在 draw / dispatch 时传 dynamic offset。 */
  dynamicOffset?: boolean
}

export type GPUBindingResource =
  | GPUBufferResource
  | GPUTextureResource
  | GPUSamplerResource

export interface GPUBindGroupEntry {
  binding: number
  resource: GPUBindingResource
  /** bind group index，默认 0。 */
  group?: number
  /** buffer binding 的字节偏移；必须满足 WebGPU 对齐要求。 */
  offset?: number
  /** buffer binding 的字节长度；省略表示到 buffer 末尾。 */
  size?: number
  /** dynamic uniform/storage buffer binding。 */
  dynamicOffset?: boolean
}

export interface GPUPipelineOptions {
  /** WGSL 源码；vertex/fragment 在同一个 module 中。 */
  code: string
  vertexEntry?: string
  fragmentEntry?: string
  bindings?: GPUBindingSpec[]
  attributes?: GPUVertexAttributeSpec[]
  targets?: GPUColorTargetState[]
  /** 未指定 targets 时使用的颜色格式。 */
  format?: GPUTextureFormat
  depth?: GPUDepthStencilState | false
  primitive?: GPUPrimitiveState
  multisample?: GPUMultisampleState
  label?: string
}

export interface GPUPipelineResource {
  readonly _gpuType: 'pipeline'
  readonly pipeline: GPURenderPipeline
  /** group 0 的 layout，保留兼容。 */
  readonly bindGroupLayout: GPUBindGroupLayout
  readonly bindGroupLayouts: GPUBindGroupLayout[]
  readonly layout: GPUPipelineLayout
  readonly bindings: GPUBindingSpec[]
  readonly attributes: GPUVertexAttributeSpec[]
  readonly label?: string
}

export interface GPUBindGroupResource {
  readonly _gpuType: 'bind-group'
  readonly bindGroup: GPUBindGroup
  readonly pipeline: GPUPipelineResource
  readonly group: number
  readonly dynamicBindings: number[]
  destroy(): void
}

export interface GPUVertexBuffer {
  buffer: GPUBufferResource
  offset?: number
  size?: number
}

export interface GPUIndexBuffer {
  buffer: GPUBufferResource
  format: GPUIndexFormat
  offset?: number
  size?: number
}

export interface GPUIndirectBuffer {
  buffer: GPUBufferResource
  offset?: number
}

export interface GPUDrawOptions {
  pipeline: GPUPipelineResource
  /** group 0 的 bind group，保留兼容。 */
  bindGroup?: GPUBindGroupResource
  /** 多 bind group。 */
  bindGroups?: GPUBindGroupResource[]
  /** 每个 group 的 dynamic offsets。 */
  dynamicOffsets?: Record<number, number[]>
  vertexBuffers?: Array<GPUBufferResource | GPUVertexBuffer>
  indexBuffer?: GPUIndexBuffer
  /** indirect draw；存在时优先于 count。 */
  indirect?: GPUIndirectBuffer
  count: number
  instances?: number
  firstVertex?: number
  firstInstance?: number
  firstIndex?: number
  baseVertex?: number
}

export interface GPUPass {
  draw(options: GPUDrawOptions): void
}

export type GPUClearColor = GPUColor | [number, number, number, number]

export interface GPURenderOptions {
  /** 省略时渲染到 canvas current texture。 */
  color?: GPUTextureResource | GPUTextureView | Array<GPUTextureResource | GPUTextureView>
  clearColor?: GPUClearColor | false
  /** MSAA 解析目标，数量必须与 color 一致。 */
  resolve?: GPUTextureResource | GPUTextureResource[]
  depth?: GPUTextureResource
  clearDepth?: number
  queries?: GPURenderQueries
  label?: string
}

export interface GPURenderQueries {
  timestamp?: {
    querySet: GPUQuerySetResource
    beginningOfPassWriteIndex?: number
    endOfPassWriteIndex?: number
  }
  occlusion?: {
    querySet: GPUQuerySetResource
    index: number
  }
}

export type GPUQueryTypeName = 'occlusion' | 'timestamp'

export interface GPUQuerySetOptions {
  type?: GPUQueryTypeName
  count?: number
  label?: string
}

export interface GPUQuerySetResource {
  readonly _gpuType: 'query-set'
  readonly querySet: GPUQuerySet
  readonly type: GPUQueryTypeName
  readonly count: number
  destroy(): void
}

export interface GPUResolveQuerySetOptions {
  querySet: GPUQuerySetResource
  destination: GPUBufferResource
  firstQuery?: number
  queryCount?: number
  destinationOffset?: number
}

export interface GPUReadTextureOptions {
  /** 只读取指定层 / z slice / cube face。 */
  layer?: number
  mipLevel?: number
}

export interface GPUReadBufferOptions {
  offset?: number
  size?: number
}

export interface GPUContextOptions {
  canvas?: HTMLCanvasElement
  context?: GPUCanvasContext
  device?: GPUDevice
  adapter?: GPUAdapter
  format?: GPUTextureFormat
  alphaMode?: GPUCanvasAlphaMode
  /** requestDevice 时可选的 requiredFeatures。 */
  features?: GPUFeatureName[]
}

export interface WEBGPUOptions extends GPUContextOptions {
  /** 自动创建 canvas 并挂载到容器。 */
  container?: HTMLElement | string
  width?: number
  height?: number
}

export interface GPUContext {
  readonly _gpuType: 'context'
  readonly device: GPUDevice
  readonly adapter: GPUAdapter
  readonly context: GPUCanvasContext | null
  readonly canvas: HTMLCanvasElement | null
  readonly format: GPUTextureFormat

  buffer(options?: GPUBufferOptions | number | ArrayBufferView | ArrayBuffer): GPUBufferResource
  texture(options: GPUTextureOptions): GPUTextureResource
  sampler(options?: GPUSamplerOptions): GPUSamplerResource
  pipeline(options: GPUPipelineOptions): GPUPipelineResource
  bindGroup(
    pipeline: GPUPipelineResource,
    entries: GPUBindGroupEntry[],
    group?: number
  ): GPUBindGroupResource

  render(options: GPURenderOptions, callback: (pass: GPUPass) => void): void
  command(options: GPUCommandOptions): GPUCommand
  compute(options: GPUComputeOptions): GPUCompute
  scope(options?: GPURenderOptions, callback?: (scope: GPUScope) => void): GPUScope
  batch(options: GPURenderOptions, callback: (batch: GPUBatch) => void): void
  querySet(options?: GPUQuerySetOptions): GPUQuerySetResource
  resolveQuerySet(options: GPUResolveQuerySetOptions): void
  pool(options?: GPUPoolOptions): GPUResourcePool
  framePool(options?: GPUPoolOptions): GPUFramePool
  clearPipelineCache(): void
  readTexture(
    texture: GPUTextureResource,
    options?: GPUReadTextureOptions
  ): Promise<Uint8Array>
  readBuffer(
    buffer: GPUBufferResource,
    options?: GPUReadBufferOptions
  ): Promise<Uint8Array>
  destroy(): void
}

export interface GPUCommandAttribute {
  data?: ArrayBufferView | number[] | number[][]
  buffer?: GPUBufferResource
  size?: 1 | 2 | 3 | 4
  type?:
    | 'float32'
    | 'float16'
    | 'int32'
    | 'uint32'
    | 'int16'
    | 'uint16'
    | 'int8'
    | 'uint8'
    | 'unorm8'
    | 'snorm8'
    | 'unorm16'
    | 'snorm16'
  format?: GPUVertexFormat
  stride?: number
  offset?: number
  divisor?: number
  shaderLocation?: number
}

export interface GPUCommandBinding {
  binding: number
  kind: GPUBindingKind
  resource: GPUBindingResource
  /** bind group index，默认 0。 */
  group?: number
  visibility?: GPUShaderStageFlags
  viewDimension?: GPUTextureViewDimension
  textureSampleType?: GPUTextureSampleType
  samplerType?: GPUSamplerBindingType
  storageTextureFormat?: GPUTextureFormat
  /** buffer binding 的字节偏移 / 长度。 */
  offset?: number
  size?: number
  /** 是否使用 dynamic offset。 */
  dynamicOffset?: boolean
}

export interface GPUCommandOptions {
  /** 单个 WGSL module；与 vert/frag 二选一。 */
  code?: string
  /** vertex + fragment WGSL 分段，内部按顺序拼接。 */
  vert?: string
  frag?: string
  vertexEntry?: string
  fragmentEntry?: string
  attributes?: Record<
    string,
    GPUCommandAttribute | ArrayBufferView | number[] | number[][]
  >
  /**
   * 显式 bind group 描述。
   * WebGPU 没有全局 uniforms；uniform 数据就是 kind: 'uniform' 的 buffer binding。
   */
  bindings?: GPUCommandBinding[]
  /** 复用已有 pipeline；与 code 二选一。 */
  pipeline?: GPUPipelineResource
  /** 复用已有 bind group（group 0）。 */
  bindGroup?: GPUBindGroupResource
  /** 复用已有多个 bind group。 */
  bindGroups?: GPUBindGroupResource[]
  indexBuffer?: GPUIndexBuffer
  indirectBuffer?: GPUIndirectBuffer
  count?: number
  instances?: number
  targets?: GPUColorTargetState[]
  format?: GPUTextureFormat
  depth?: GPUDepthStencilState | false
  primitive?: GPUPrimitiveState
  multisample?: GPUMultisampleState
  label?: string
}

export interface GPUCommandProps {
  count?: number
  instances?: number
  indexBuffer?: GPUIndexBuffer
  indirectBuffer?: GPUIndirectBuffer
  dynamicOffsets?: Record<number, number[]>
  [name: string]: unknown
}

export interface GPUComputeOptions {
  code: string
  entryPoint?: string
  bindings?: GPUCommandBinding[]
  workgroupCount?: [number, number, number] | number
  indirectBuffer?: GPUIndirectBuffer
  dynamicOffsets?: Record<number, number[]>
  label?: string
}

export interface GPUComputePipelineResource {
  readonly _gpuType: 'compute-pipeline'
  readonly pipeline: GPUComputePipeline
  readonly bindGroupLayout: GPUBindGroupLayout
  readonly bindGroupLayouts: GPUBindGroupLayout[]
  readonly layout: GPUPipelineLayout
  readonly bindings: GPUBindingSpec[]
}

export interface GPUCompute {
  (): void
  readonly pipeline: GPUComputePipelineResource
  readonly bindGroup: GPUBindGroup | null
  readonly bindGroups: GPUBindGroup[]
  destroy(): void
}

export interface GPUScope {
  draw(command: GPUCommand, props?: GPUCommandProps): void
  end(): void
}

export interface GPUBatch {
  draw(command: GPUCommand, props?: GPUCommandProps): void
}

export interface GPUPoolOptions {
  maxFreeBuffers?: number
  maxFreeTextures?: number
}

export interface GPUPooled<T> {
  readonly resource: T
  readonly refCount: number
  retain(): void
  release(): void
}

export interface GPUPoolStats {
  buffers: { free: number; leased: number }
  textures: { free: number; leased: number }
}

export interface GPUResourcePool {
  readonly _gpuType: 'pool'
  buffer(
    options?: GPUBufferOptions | number | ArrayBufferView | ArrayBuffer
  ): GPUPooled<GPUBufferResource>
  texture(options: GPUTextureOptions): GPUPooled<GPUTextureResource>
  stats(): GPUPoolStats
  destroy(): void
}

export interface GPUFramePool extends Omit<GPUResourcePool, '_gpuType'> {
  readonly _gpuType: 'frame-pool'
  /** 等 GPU 完成后回收本帧所有 lease。 */
  endFrame(): Promise<void>
}

export interface GPUCommand {
  (props?: GPUCommandProps): void
  draw(pass: GPUPass, props?: GPUCommandProps): void
  readonly pipeline: GPUPipelineResource
  readonly bindGroup: GPUBindGroupResource | null
  readonly bindGroups: GPUBindGroupResource[]
  destroy(): void
}

/** 涓?createREGL 瀵归綈鐨?WebGPU 娓叉煋鍣ㄧ被鍨嬨€?*/
export interface WEBGPUFrameInfo {
  time: number
  width: number
  height: number
  pixelRatio: number
}

export interface WEBGPUFrame {
  cancel(): void
}

export interface WEBGPU extends GPUContext {
  (options: GPUCommandOptions): GPUCommand
  readonly limits: GPUSupportedLimits
  frame(callback: (info: WEBGPUFrameInfo) => void): WEBGPUFrame
}
