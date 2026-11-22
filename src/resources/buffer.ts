/**
 * GPU buffer 资源。
 *
 * 支持的数据输入：
 * - TypedArray（Int8/Uint8/.../Float32）
 * - 普通数组（1D 或 2D 嵌套，自动展平）
 * - ndarray（shape / stride / offset）
 * - ArrayBuffer
 * - 数字（仅分配显存，不上传数据）
 *
 * 与旧版 regl 保持一致：只有「编译命令时内联的 attribute 数据」和
 * 「VAO 内联数据」会保存一份字节副本用于上下文恢复；`regl.buffer(...)`
 * 创建的普通 buffer 在上下文丢失后只会重建空存储（与旧版行为相同）。
 */

import {
  check,
  checkNonNegativeInt,
  checkParameter,
  checkType,
  isNDArrayLike,
  isTypedArray,
  NDArrayLike
} from '../util/check'
import {
  allocType,
  arrayShape,
  flattenArray,
  freeType,
  packNDArray,
  typedArrayCode,
  typeByteSize
} from '../util/data'
import { GL, dataTypes, usageTypes } from '../util/constants'
import type { GLContext } from '../core/capabilities'

/** 用户可传入的 buffer 数据。 */
export type BufferData =
  | ArrayLike<number>
  | ArrayBuffer
  | NDArrayLike

export interface BufferOptions {
  data?: BufferData
  usage?: 'static' | 'dynamic' | 'stream'
  type?: 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float'
  dimension?: number
  length?: number
}

export interface BufferStats {
  size: number
}

/** GPU buffer 的内部表示。 */
export class Buffer {
  id: number
  handle: WebGLBuffer | null
  readonly bufferType: number
  usage: number
  byteLength: number
  dimension: number
  dtype: number
  /** 用于上下文恢复的字节副本。 */
  persistentData: ArrayBufferView | null
  /** 是否由 stream 池管理（不参与普通资源统计）。 */
  isStream: boolean
  stats: BufferStats

  constructor(
    id: number,
    gl: GLContext,
    bufferType: number,
    isStream = false
  ) {
    this.id = id
    this.handle = gl.createBuffer()
    this.bufferType = bufferType
    this.usage = GL.STATIC_DRAW
    this.byteLength = 0
    this.dimension = 1
    this.dtype = GL.UNSIGNED_BYTE
    this.persistentData = null
    this.isStream = isStream
    this.stats = { size: 0 }
  }

  bind(gl: GLContext): void {
    gl.bindBuffer(this.bufferType, this.handle)
  }

  destroy(gl: GLContext): void {
    if (this.handle) {
      gl.deleteBuffer(this.handle)
      this.handle = null
    }
    this.persistentData = null
    this.byteLength = 0
  }
}

export interface BufferStoreOptions {
  gl: GLContext
  maxAttributes: number
  /** 公共 stats 对象，用于统计用户可见 buffer 数量。 */
  stats?: { bufferCount: number }
  /** buffer 被销毁时通知 attribute/VAO 层清理绑定。 */
  onDestroy: (buffer: Buffer) => void
}

/** 管理所有 buffer 的仓库。 */
export class BufferStore {
  readonly gl: GLContext
  private readonly onDestroyBuffer: (buffer: Buffer) => void
  private readonly stats: { bufferCount: number }
  private bufferCount = 0
  private readonly bufferSet = new Map<number, Buffer>()
  private readonly streamPool: Buffer[] = []

  constructor(options: BufferStoreOptions) {
    this.gl = options.gl
    this.onDestroyBuffer = options.onDestroy
    this.stats = options.stats || { bufferCount: 0 }
  }

  /**
   * 创建一个用户可见的 buffer。
   * @param options 数据/配置
   * @param bufferType ARRAY_BUFFER 或 ELEMENT_ARRAY_BUFFER
   * @param deferInit 是否延迟到第一次调用时才上传
   */
  create(
    options?: BufferOptions | BufferData | number | null,
    bufferType: number = GL.ARRAY_BUFFER,
    deferInit = false,
    persistent = false
  ): BufferWrapper {
    const buffer = new Buffer(this.bufferCount++, this.gl, bufferType)
    this.bufferSet.set(buffer.id, buffer)
    this.stats.bufferCount++

    const update = (input?: BufferOptions | BufferData | number | null): BufferWrapper => {
      this.upload(buffer, input, persistent)
      return wrapper
    }

    const wrapper = createBufferWrapper(buffer, update, this)
    if (!deferInit) {
      update(options as BufferOptions)
    }
    return wrapper
  }

  /** 创建一个临时 stream buffer（用于动态 attribute/elements，绘制后回收）。 */
  createStream(bufferType: number, data: BufferData): Buffer {
    let buffer = this.streamPool.pop()
    if (!buffer) {
      buffer = new Buffer(this.bufferCount++, this.gl, bufferType, true)
    }
    buffer.bind(this.gl)
    this.initFromData(buffer, data, GL.STREAM_DRAW, 0, 1, false)
    return buffer
  }

  destroyStream(buffer: Buffer): void {
    // 不立即删除 GL 资源，放入池中复用
    buffer.persistentData = null
    this.streamPool.push(buffer)
  }

  /** 根据用户输入上传数据。 */
  upload(
    buffer: Buffer,
    options?: BufferOptions | BufferData | number | null,
    persistent = false
  ): void {
    let usage: number = GL.STATIC_DRAW
    let data: BufferData | null = null
    let byteLength = 0
    let dtype = 0
    let dimension = 1

    if (Array.isArray(options) || isTypedArray(options) || isNDArrayLike(options) || options instanceof ArrayBuffer) {
      data = options as BufferData
    } else if (typeof options === 'number') {
      byteLength = options | 0
      checkNonNegativeInt(byteLength, 'buffer length must be a nonnegative integer')
    } else if (options) {
      checkType(options, 'object', 'buffer arguments must be an object, a number or an array')
      const opts = options as BufferOptions
      if ('data' in opts) {
        data = opts.data ?? null
      }
      if ('usage' in opts) {
        checkParameter(opts.usage, usageTypes, 'invalid buffer usage')
        usage = usageTypes[opts.usage!]
      }
      if ('type' in opts) {
        checkParameter(opts.type, dataTypes, 'invalid buffer type')
        dtype = dataTypes[opts.type!]
      }
      if ('dimension' in opts) {
        checkType(opts.dimension, 'number', 'invalid dimension')
        dimension = opts.dimension! | 0
      }
      if ('length' in opts) {
        byteLength = opts.length! | 0
        checkNonNegativeInt(byteLength, 'buffer length must be a nonnegative integer')
      }
    }

    buffer.bind(this.gl)
    if (data == null) {
      if (byteLength > 0) {
        this.gl.bufferData(buffer.bufferType, byteLength, usage)
      }
      buffer.dtype = dtype || GL.UNSIGNED_BYTE
      buffer.usage = usage
      buffer.dimension = dimension
      buffer.byteLength = byteLength
      buffer.persistentData =
        persistent && byteLength > 0 ? new Uint8Array(byteLength) : null
    } else {
      this.initFromData(buffer, data, usage, dtype, dimension, persistent)
    }
    buffer.stats.size = buffer.byteLength
  }

  private initFromData(
    buffer: Buffer,
    data: BufferData,
    usage: number,
    dtype: number,
    dimension: number,
    persist: boolean
  ): void {
    buffer.usage = usage
    const gl = this.gl

    if (Array.isArray(data)) {
      buffer.dtype = dtype || GL.FLOAT
      if ((data as unknown[]).length === 0) {
        buffer.byteLength = 0
        buffer.dimension = dimension
        buffer.persistentData = null
        return
      }
      const first = (data as unknown[])[0]

      if (typeof first === 'number') {
        buffer.dimension = dimension
        const typed = allocType(buffer.dtype, (data as number[]).length)
        ;(typed as unknown as { set(a: ArrayLike<number>): void }).set(data as ArrayLike<number>)
        this.uploadBytes(buffer, typed, usage, persist)
        freeType(typed)
      } else if (Array.isArray(first) || isTypedArray(first)) {
        const shape = arrayShape(data as unknown as ArrayLike<unknown>)
        let dim = 1
        for (let i = 1; i < shape.length; ++i) dim *= shape[i]
        buffer.dimension = dim
        const flat = flattenArray(data as unknown as ArrayLike<unknown>, shape, buffer.dtype)
        this.uploadBytes(buffer, flat, usage, persist)
        freeType(flat)
      } else {
        throw new Error('(regl) invalid buffer data')
      }
      return
    }

    if (isTypedArray(data)) {
      let typedData = data as ArrayBufferView
      // Float64Array 在 WebGL 中没有对应类型，统一转换到 Float32Array
      if (typedData instanceof Float64Array) {
        const converted = new Float32Array(typedData.length)
        converted.set(typedData)
        typedData = converted
      }      buffer.dtype = dtype || typedArrayCode(typedData) || GL.FLOAT
      buffer.dimension = dimension
      buffer.byteLength = typedData.byteLength
      gl.bufferData(buffer.bufferType, typedData, usage)
      if (persist) {
        buffer.persistentData = copyBytes(typedData)
      }
      return
    }

    if (isNDArrayLike(data)) {
      buffer.dtype = dtype || typedArrayCode(data.data as ArrayBufferView) || GL.FLOAT
      const packed = packNDArray(data, buffer.dtype)
      buffer.dimension = packed.dimension
      this.uploadBytes(buffer, packed.data, usage, persist)
      freeType(packed.data)
      return
    }

    if (data instanceof ArrayBuffer) {
      buffer.dtype = dtype || GL.UNSIGNED_BYTE
      buffer.dimension = dimension
      buffer.byteLength = data.byteLength
      gl.bufferData(buffer.bufferType, data, usage)
      if (persist) {
        buffer.persistentData = new Uint8Array(data.slice(0))
      }
      return
    }

    throw new Error('(regl) invalid buffer data')
  }

  private uploadBytes(
    buffer: Buffer,
    data: ArrayBufferView,
    usage: number,
    persist: boolean
  ): void {
    buffer.byteLength = data.byteLength
    this.gl.bufferData(buffer.bufferType, data, usage)
    if (persist) {
      buffer.persistentData = copyBytes(data)
    }
  }

  /** 更新 buffer 的一部分。 */
  subdata(
    buffer: Buffer,
    data: BufferData | ArrayLike<number>,
    byteOffset = 0
  ): void {
    check(
      !!buffer.handle,
      'buffer must not be deleted already'
    )
    let payload: ArrayBufferView | ArrayBuffer
    let freeAfter = false

    if (isTypedArray(data) || data instanceof ArrayBuffer) {
      payload = data as ArrayBufferView | ArrayBuffer
    } else if (Array.isArray(data)) {
      const arr = data as unknown[]
      if (arr.length === 0) return
      if (typeof arr[0] === 'number') {
        const converted = allocType(buffer.dtype, arr.length)
        ;(converted as unknown as { set(a: ArrayLike<number>): void }).set(arr as ArrayLike<number>)
        payload = converted
        freeAfter = true
      } else {
        const shape = arrayShape(arr as ArrayLike<unknown>)
        payload = flattenArray(arr as ArrayLike<unknown>, shape, buffer.dtype)
        freeAfter = true
      }
    } else if (isNDArrayLike(data)) {
      const dtype = Array.isArray(data.data)
        ? buffer.dtype
        : typedArrayCode(data.data as ArrayBufferView) || buffer.dtype
      const packed = packNDArray(data, dtype)
      payload = packed.data
      freeAfter = true
    } else {
      throw new Error('(regl) invalid data for buffer subdata')
    }

    const byteLength =
      payload instanceof ArrayBuffer ? payload.byteLength : payload.byteLength
    check(
      byteOffset + byteLength <= buffer.byteLength,
      `invalid buffer subdata call, buffer is too small. ` +
        `Can't write data of size ${byteLength} starting from offset ${byteOffset} ` +
        `to a buffer of size ${buffer.byteLength}`
    )

    buffer.bind(this.gl)
    this.gl.bufferSubData(buffer.bufferType, byteOffset, payload)

    // 同步持久副本，保证上下文恢复后数据完整
    if (buffer.persistentData) {
      const bytes =
        payload instanceof ArrayBuffer
          ? new Uint8Array(payload)
          : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
      const target = new Uint8Array(
        buffer.persistentData.buffer,
        buffer.persistentData.byteOffset,
        buffer.persistentData.byteLength
      )
      target.set(bytes, byteOffset)
    }

    if (freeAfter) freeType(payload as ArrayBufferView)
  }

  /**
   * 一次绑定上传多个不连续区间。
   * Phase 2 的 UBO 差量更新会合并成员范围后使用这个接口，避免重复 bindBuffer。
   */
  subdataRanges(
    buffer: Buffer,
    data: Uint8Array,
    ranges: Array<[number, number]>
  ): void {
    check(!!buffer.handle, 'buffer must not be deleted already')
    if (ranges.length === 0) return

    for (const [start, end] of ranges) {
      check(
        start >= 0 && end >= start && end <= data.byteLength,
        'invalid buffer subdata range'
      )
      check(
        end <= buffer.byteLength,
        `invalid buffer subdata range: end ${end} exceeds buffer size ${buffer.byteLength}`
      )
    }

    buffer.bind(this.gl)
    for (const [start, end] of ranges) {
      this.gl.bufferSubData(buffer.bufferType, start, data.subarray(start, end))
    }

    if (buffer.persistentData) {
      const target = new Uint8Array(
        buffer.persistentData.buffer,
        buffer.persistentData.byteOffset,
        buffer.persistentData.byteLength
      )
      for (const [start, end] of ranges) {
        target.set(data.subarray(start, end), start)
      }
    }
  }

  get(buffer: Buffer): Buffer | null {
    return buffer instanceof Buffer ? buffer : null
  }

  /** 删除 buffer 并通知上层清理绑定。 */
  destroy(buffer: Buffer): void {
    check(!!buffer.handle, 'buffer must not be deleted already')
    this.onDestroyBuffer(buffer)
    buffer.destroy(this.gl)
    this.bufferSet.delete(buffer.id)
    this.stats.bufferCount = Math.max(0, this.stats.bufferCount - 1)
  }

  /** 上下文恢复：重新创建所有 buffer 并上传持久数据。 */
  restore(): void {
    for (const buffer of this.bufferSet.values()) {
      buffer.handle = this.gl.createBuffer()
      this.gl.bindBuffer(buffer.bufferType, buffer.handle)
      if (buffer.persistentData) {
        this.gl.bufferData(buffer.bufferType, buffer.persistentData, buffer.usage)
      } else if (buffer.byteLength > 0) {
        this.gl.bufferData(buffer.bufferType, buffer.byteLength, buffer.usage)
      }
    }
    // stream pool 中的对象不需要恢复（下一帧会重新初始化）
    this.streamPool.length = 0
  }

  /** 清理全部资源（regl.destroy）。 */
  clear(): void {
    for (const buffer of this.bufferSet.values()) {
      this.onDestroyBuffer(buffer)
      buffer.destroy(this.gl)
    }
    this.bufferSet.clear()
    for (const buffer of this.streamPool) {
      buffer.destroy(this.gl)
    }
    this.streamPool.length = 0
    this.stats.bufferCount = 0
  }

  /** 所有用户创建的 buffer（不含 stream），用于统计。 */
  all(): Buffer[] {
    return Array.from(this.bufferSet.values())
  }

  get count(): number {
    return this.bufferSet.size
  }
}

// ---------------------------------------------------------------------------
// 用户可见的 Buffer 包装
// ---------------------------------------------------------------------------

/** regl.buffer() 返回的对象：既是资源，也可以当作函数重新上传数据。 */
export interface BufferWrapper {
  (options?: BufferOptions | BufferData | number | null): BufferWrapper
  _reglType: 'buffer'
  _buffer: Buffer
  subdata(data: BufferData | ArrayLike<number>, offset?: number): BufferWrapper
  destroy(): void
  stats: BufferStats
}

function copyBytes(data: ArrayBufferView): ArrayBufferView {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
  // 保留原始类型，便于 restore 时直接 bufferData
  if (data instanceof Float32Array) return new Float32Array(bytes.buffer)
  if (data instanceof Uint16Array) return new Uint16Array(bytes.buffer)
  if (data instanceof Int16Array) return new Int16Array(bytes.buffer)
  if (data instanceof Uint32Array) return new Uint32Array(bytes.buffer)
  if (data instanceof Int32Array) return new Int32Array(bytes.buffer)
  if (data instanceof Int8Array) return new Int8Array(bytes.buffer)
  return bytes
}

function createBufferWrapper(
  buffer: Buffer,
  update: (options?: BufferOptions | BufferData | number | null) => BufferWrapper,
  store: BufferStore
): BufferWrapper {
  const wrapper = ((options?: BufferOptions | BufferData | number | null) =>
    update(options)) as BufferWrapper
  wrapper._reglType = 'buffer'
  wrapper._buffer = buffer
  wrapper.stats = buffer.stats
  wrapper.subdata = (data: BufferData | ArrayLike<number>, offset = 0) => {
    store.subdata(buffer, data, offset | 0)
    return wrapper
  }
  wrapper.destroy = () => {
    store.destroy(buffer)
  }
  return wrapper
}

/** 判断一个值是否是 buffer 数据（而不是 buffer 资源）。 */
export function isBufferData(value: unknown): boolean {
  return (
    Array.isArray(value) ||
    isTypedArray(value) ||
    isNDArrayLike(value) ||
    value instanceof ArrayBuffer
  )
}

/** 从 wrapper 取内部 buffer。 */
export function getBuffer(value: unknown): Buffer | null {
  if (
    typeof value === 'function' &&
    (value as unknown as { _reglType?: string })._reglType === 'buffer'
  ) {
    const internal = (value as unknown as { _buffer?: Buffer })._buffer
    return internal instanceof Buffer ? internal : null
  }
  return null
}

/** 计算某个 buffer 的顶点数量（用于 attribute 校验）。 */
export function bufferVertexCount(buffer: Buffer): number {
  return Math.floor(buffer.byteLength / (typeByteSize(buffer.dtype) * Math.max(buffer.dimension, 1)))
}
