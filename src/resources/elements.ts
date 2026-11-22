/**
 * 索引缓冲（elements）资源。
 *
 * 负责：
 * - 解析索引数据类型（uint8 / uint16 / uint32）；
 * - 推断图元类型（1D -> points，2D -> lines，3D -> triangles）；
 * - 维护顶点数量，供 `count` 缺省时使用；
 * - 提供 subdata 与上下文恢复。
 *
 * 32 位索引：WebGL2 原生支持，WebGL1 需要 OES_element_index_uint。
 */

import {
  check,
  checkParameter,
  checkType,
  isNDArrayLike,
  isTypedArray
} from '../util/check'
import { arrayShape, flattenArray } from '../util/data'
import { GL, dataTypeSizes, primitiveTypes, usageTypes } from '../util/constants'
import type { GLContext } from '../core/capabilities'
import type { Capabilities } from '../core/capabilities'
import { Buffer, BufferStore, BufferWrapper, BufferData as GPUData, isBufferData } from './buffer'

export type ElementsData = ArrayLike<number> | number[] | number[][] | import('../util/check').NDArrayLike

export interface ElementsOptions {
  data?: ElementsData
  usage?: 'static' | 'dynamic' | 'stream'
  primitive?: string
  count?: number
  type?: 'uint8' | 'uint16' | 'uint32'
  length?: number
}

/** elements 的内部表示。 */
export class ElementBuffer {
  id: number
  buffer: Buffer
  primType: number
  vertCount: number
  type: number
  readonly isStream: boolean

  constructor(id: number, buffer: Buffer, isStream = false) {
    this.id = id
    this.buffer = buffer
    this.primType = GL.TRIANGLES
    this.vertCount = 0
    this.type = GL.UNSIGNED_BYTE
    this.isStream = isStream
  }
}

export interface ElementsStoreOptions {
  gl: GLContext
  caps: Capabilities
  buffers: BufferStore
  stats: { elementsCount: number }
}

export class ElementsStore {
  readonly gl: GLContext
  readonly caps: Capabilities
  readonly buffers: BufferStore
  readonly stats: { elementsCount: number }

  private elementCount = 0
  private readonly elementSet = new Map<number, ElementBuffer>()
  private readonly streamPool: ElementBuffer[] = []

  constructor(options: ElementsStoreOptions) {
    this.gl = options.gl
    this.caps = options.caps
    this.buffers = options.buffers
    this.stats = options.stats
  }

  /** 创建用户可见的 elements 资源。 */
  create(options?: ElementsOptions | ElementsData | number | null): ElementsWrapper {
    const bufferWrapper = this.buffers.create(null, GL.ELEMENT_ARRAY_BUFFER, true)
    const elements = new ElementBuffer(
      this.elementCount++,
      bufferWrapper._buffer
    )
    this.elementSet.set(elements.id, elements)
    this.stats.elementsCount++

    const update = (input?: ElementsOptions | ElementsData | number | null) => {
      this.upload(elements, input)
      return wrapper
    }

    const wrapper = createElementsWrapper(elements, update, this)
    this.upload(elements, options)
    return wrapper
  }

  /** 创建临时索引流（动态 elements 数据），绘制后回收。 */
  createStream(data: ElementsData): ElementBuffer {
    let elements = this.streamPool.pop()
    if (!elements) {
      const bufferWrapper = this.buffers.create(null, GL.ELEMENT_ARRAY_BUFFER, true)
      elements = new ElementBuffer(this.elementCount++, bufferWrapper._buffer, true)
    }
    this.upload(elements, data)
    return elements
  }

  destroyStream(elements: ElementBuffer): void {
    // 只回收对象，底层 buffer 在池中复用
    this.streamPool.push(elements)
  }

  /** 解析并上传 elements 数据。 */
  upload(
    elements: ElementBuffer,
    input?: ElementsOptions | ElementsData | number | null
  ): void {
    const buffer = elements.buffer
    buffer.bind(this.gl)

    if (input == null) {
      buffer.dtype = GL.UNSIGNED_SHORT
      buffer.dimension = 3
      buffer.byteLength = 0
      buffer.usage = GL.STATIC_DRAW
      elements.primType = GL.TRIANGLES
      elements.vertCount = 0
      elements.type = GL.UNSIGNED_SHORT
      return
    }

    if (typeof input === 'number') {
      // 与 regl 兼容：数字表示分配 length 字节，count 也取该值
      const length = input | 0
      check(length >= 0, 'invalid elements length')
      buffer.usage = GL.STATIC_DRAW
      buffer.dtype = GL.UNSIGNED_BYTE
      buffer.dimension = 3
      buffer.byteLength = length
      buffer.persistentData = new Uint8Array(length)
      this.gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, length, GL.STATIC_DRAW)
      elements.primType = GL.TRIANGLES
      elements.vertCount = length
      elements.type = GL.UNSIGNED_BYTE
      return
    }

    let data: ElementsData | null = null
    let usage: number = GL.STATIC_DRAW
    let primType = -1
    let vertCount = -1
    let byteLength = 0
    let dtype = 0

    if (Array.isArray(input) || isTypedArray(input) || isNDArrayLike(input)) {
      data = input as ElementsData
    } else {
      checkType(input, 'object', 'invalid arguments for elements')
      const opts = input as ElementsOptions
      if ('data' in opts) {
        check(
          Array.isArray(opts.data) || isTypedArray(opts.data) || isNDArrayLike(opts.data),
          'invalid data for element buffer'
        )
        data = opts.data!
      }
      if ('usage' in opts) {
        checkParameter(opts.usage, usageTypes, 'invalid element buffer usage')
        usage = usageTypes[opts.usage!]
      }
      if ('primitive' in opts) {
        checkParameter(opts.primitive, primitiveTypes, 'invalid element buffer primitive')
        primType = primitiveTypes[opts.primitive!]
      }
      if ('count' in opts) {
        check(
          typeof opts.count === 'number' && opts.count >= 0,
          'invalid vertex count for elements'
        )
        vertCount = opts.count! | 0
      }
      if ('type' in opts) {
        check(
          opts.type === 'uint8' || opts.type === 'uint16' || opts.type === 'uint32',
          'invalid elements type'
        )
        dtype = typeNameToEnum(opts.type!)
      }
      if ('length' in opts) {
        byteLength = opts.length! | 0
      }
    }

    if (data) {
      // 未指定类型时根据数据推断；普通数组默认使用能支持的最大索引类型
      let predictedType = dtype
      if (!predictedType) {
        if (isTypedArray(data)) {
          predictedType = normalizeIndexType(inferIndexType(data))
        } else if (isNDArrayLike(data)) {
          predictedType = isTypedArray(data.data)
            ? normalizeIndexType(inferIndexType(data.data as ArrayBufferView))
            : this.caps.hasUintElements
              ? GL.UNSIGNED_INT
              : GL.UNSIGNED_SHORT
        } else {
          predictedType = this.caps.hasUintElements
            ? GL.UNSIGNED_INT
            : GL.UNSIGNED_SHORT
        }
      }

      check(
        predictedType !== GL.UNSIGNED_INT || this.caps.hasUintElements,
        '32 bit element buffers not supported, enable oes_element_index_uint first'
      )

      buffer.usage = usage
      buffer.dtype = predictedType
      buffer.dimension = 3

      // 复用 buffer 的数据上传逻辑，但需要强制使用索引类型
      this.buffers.upload(buffer, {
        data: data as GPUData,
        usage: 'static',
        type: indexTypeName(predictedType),
        // 索引缓冲区默认按三角形列表处理；嵌套数组会覆盖为内层长度
        dimension: 3
      })
      buffer.usage = usage
      elements.type = predictedType
    } else {
      // 没有 data：可能是仅分配长度
      buffer.usage = usage
      buffer.dtype = dtype || GL.UNSIGNED_BYTE
      buffer.dimension = 3
      elements.type = buffer.dtype
      if (byteLength > 0) {
        this.gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, byteLength, usage)
        buffer.byteLength = byteLength
        buffer.persistentData = new Uint8Array(byteLength)
      } else {
        buffer.byteLength = 0
        buffer.persistentData = null
      }
    }

    // 根据数据长度/显式 count 计算顶点数
    if (vertCount < 0) {
      vertCount = Math.floor(buffer.byteLength / (dataTypeSizes[elements.type] || 1))
    }
    elements.vertCount = vertCount

    if (primType < 0) {
      // 根据 buffer.dimension 推断；显式 dimension=3 时是三角形列表
      primType = GL.TRIANGLES
      const dimension = buffer.dimension
      if (dimension === 1) primType = GL.POINTS
      else if (dimension === 2) primType = GL.LINES
    }
    elements.primType = primType
  }

  subdata(
    elements: ElementBuffer,
    data: ElementsData,
    byteOffset = 0
  ): void {
    // 索引数据需要与 elements.type 匹配
    let payload: ArrayBufferView | ArrayBuffer
    let freeAfter = false
    if (isTypedArray(data) || data instanceof ArrayBuffer) {
      payload = data as ArrayBufferView | ArrayBuffer
    } else if (Array.isArray(data)) {
      const arr = data as unknown[]
      if (arr.length === 0) return
      if (typeof arr[0] === 'number') {
        const typed = new (typedArrayConstructor(elements.type))(arr.length)
        ;(typed as unknown as { set(a: ArrayLike<number>): void }).set(arr as ArrayLike<number>)
        payload = typed
        freeAfter = false
      } else {
        const shape = arrayShape(arr as ArrayLike<unknown>)
        payload = flattenArray(arr as ArrayLike<unknown>, shape, elements.type)
        freeAfter = true
      }
    } else if (isNDArrayLike(data)) {
      const shape = data.shape
      const stride = data.stride
      const offset = data.offset || 0
      const total = shape.reduce((a, b) => a * b, 1)
      const out = new (typedArrayConstructor(elements.type))(total)
      let ptr = 0
      if (shape.length === 1) {
        for (let i = 0; i < shape[0]; ++i) {
          out[ptr++] = (data.data as ArrayLike<number>)[stride[0] * i + offset]
        }
      } else if (shape.length === 2) {
        for (let i = 0; i < shape[0]; ++i) {
          for (let j = 0; j < shape[1]; ++j) {
            out[ptr++] = (data.data as ArrayLike<number>)[
              stride[0] * i + stride[1] * j + offset
            ]
          }
        }
      } else {
        throw new Error('(regl) invalid shape for elements subdata')
      }
      payload = out
      freeAfter = false
    } else {
      throw new Error('(regl) invalid data for element buffer subdata')
    }

    this.buffers.subdata(elements.buffer, payload as BufferDataForSub, byteOffset)
    if (freeAfter) {
      // payload 由临时数组创建，交给 GC 即可（这里不进入全局池）
    }
  }

  get(value: unknown): ElementBuffer | null {
    if (
      typeof value === 'function' &&
      (value as unknown as { _reglType?: string })._reglType === 'elements'
    ) {
      const internal = (value as unknown as { _elements?: ElementBuffer })._elements
      return internal instanceof ElementBuffer ? internal : null
    }
    return null
  }

  destroy(elements: ElementBuffer): void {
    check(!!elements.buffer.handle, 'must not double destroy elements')
    this.elementSet.delete(elements.id)
    this.stats.elementsCount--
    this.buffers.destroy(elements.buffer)
  }

  clear(): void {
    for (const elements of Array.from(this.elementSet.values())) {
      this.destroy(elements)
    }
    this.streamPool.length = 0
    this.elementSet.clear()
  }

  restore(): void {
    // 底层 buffer 由 BufferStore.restore() 统一恢复
  }
}

type BufferDataForSub = GPUData | ArrayLike<number>

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function typeNameToEnum(name: 'uint8' | 'uint16' | 'uint32'): number {
  switch (name) {
    case 'uint8':
      return GL.UNSIGNED_BYTE
    case 'uint16':
      return GL.UNSIGNED_SHORT
    case 'uint32':
      return GL.UNSIGNED_INT
  }
}

function indexTypeName(type: number): 'uint8' | 'uint16' | 'uint32' {
  if (type === GL.UNSIGNED_BYTE) return 'uint8'
  if (type === GL.UNSIGNED_INT) return 'uint32'
  return 'uint16'
}

/** 索引类型 -> TypedArray 构造器。 */
function typedArrayConstructor(type: number) {
  if (type === GL.UNSIGNED_BYTE) return Uint8Array
  if (type === GL.UNSIGNED_INT) return Uint32Array
  return Uint16Array
}

function inferIndexType(data: ArrayBufferView): number {
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) return GL.UNSIGNED_BYTE
  if (data instanceof Uint16Array) return GL.UNSIGNED_SHORT
  if (data instanceof Uint32Array) return GL.UNSIGNED_INT
  if (data instanceof Int8Array) return GL.UNSIGNED_BYTE
  if (data instanceof Int16Array) return GL.UNSIGNED_SHORT
  if (data instanceof Int32Array) return GL.UNSIGNED_INT
  return GL.UNSIGNED_SHORT
}

function normalizeIndexType(type: number): number {
  switch (type) {
    case GL.BYTE:
    case GL.UNSIGNED_BYTE:
      return GL.UNSIGNED_BYTE
    case GL.SHORT:
    case GL.UNSIGNED_SHORT:
      return GL.UNSIGNED_SHORT
    case GL.INT:
    case GL.UNSIGNED_INT:
      return GL.UNSIGNED_INT
    default:
      return GL.UNSIGNED_SHORT
  }
}

// ---------------------------------------------------------------------------
// 用户可见包装
// ---------------------------------------------------------------------------

export interface ElementsWrapper {
  (options?: ElementsOptions | ElementsData | number | null): ElementsWrapper
  _reglType: 'elements'
  _elements: ElementBuffer
  subdata(data: ElementsData | ArrayLike<number>, offset?: number): ElementsWrapper
  destroy(): void
}

function createElementsWrapper(
  elements: ElementBuffer,
  update: (options?: ElementsOptions | ElementsData | number | null) => ElementsWrapper,
  store: ElementsStore
): ElementsWrapper {
  const wrapper = ((options?: ElementsOptions | ElementsData | number | null) =>
    update(options)) as ElementsWrapper
  wrapper._reglType = 'elements'
  wrapper._elements = elements
  wrapper.subdata = (data: ElementsData | ArrayLike<number>, offset = 0) => {
    store.subdata(elements, data as ElementsData, offset | 0)
    return wrapper
  }
  wrapper.destroy = () => {
    store.destroy(elements)
  }
  return wrapper
}

/** 判断一个值是否是 elements 资源。 */
export function isElements(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as { _reglType?: string })._reglType === 'elements'
  )
}

/** 判断是否是 elements 数据。 */
export function isElementsData(value: unknown): boolean {
  return isBufferData(value)
}

/** 计算索引类型对应的字节数。 */
export function indexByteSize(type: number): number {
  return dataTypeSizes[type] || 1
}

/** 供外部调试：关联的 GPU buffer。 */
export function elementsBuffer(elements: ElementBuffer): Buffer {
  return elements.buffer
}

export function isElementsWrapper(value: unknown): value is ElementsWrapper {
  return isElements(value)
}

/** 导出内部类型，避免 TS 未使用告警。 */
export type { BufferWrapper }
