/**
 * 数据转换工具：数组展平、TypedArray 推断、ndarray 转置、半精度浮点转换。
 *
 * regl 的很多 API 都接受「任意嵌套的普通数组 / TypedArray / ndarray」，
 * 这里把这些输入统一成 GPU 能直接上传的紧凑 TypedArray。
 */

import { isTypedArray, NDArrayLike } from './check'
import { GL, dataTypeSizes } from './constants'

/** TypedArray 构造器 -> WebGL 数据类型。 */
export function typedArrayCode(data: ArrayBufferView): number {
  if (data instanceof Int8Array) return GL.BYTE
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) return GL.UNSIGNED_BYTE
  if (data instanceof Int16Array) return GL.SHORT
  if (data instanceof Uint16Array) return GL.UNSIGNED_SHORT
  if (data instanceof Int32Array) return GL.INT
  if (data instanceof Uint32Array) return GL.UNSIGNED_INT
  if (data instanceof Float32Array) return GL.FLOAT
  if (data instanceof Float64Array) return GL.FLOAT
  return 0
}

/** 根据 WebGL 数据类型创建对应的 TypedArray。 */
export function typedArrayFor(dtype: number, length: number): ArrayBufferView {
  switch (dtype) {
    case GL.BYTE:
      return new Int8Array(length)
    case GL.UNSIGNED_BYTE:
      return new Uint8Array(length)
    case GL.SHORT:
      return new Int16Array(length)
    case GL.UNSIGNED_SHORT:
      return new Uint16Array(length)
    case GL.INT:
      return new Int32Array(length)
    case GL.UNSIGNED_INT:
      return new Uint32Array(length)
    case GL.FLOAT:
      return new Float32Array(length)
    case GL.HALF_FLOAT:
    case GL.HALF_FLOAT_OES:
      // 半精度没有 JS 原生类型，统一按 Uint16 处理位模式
      return new Uint16Array(length)
    default:
      return new Float32Array(length)
  }
}

/**
 * 小对象池：避免在纹理上传、buffer 更新等热路径上反复分配 TypedArray。
 * 只缓存较小的数组，防止长时间运行占满内存。
 */
const MAX_POOLED_LENGTH = 1 << 16
const pools = new Map<string, ArrayBufferView[]>()

export function allocType(dtype: number, length: number): ArrayBufferView {
  if (length <= MAX_POOLED_LENGTH) {
    const key = `${dtype}:${length}`
    const bucket = pools.get(key)
    if (bucket && bucket.length > 0) {
      return bucket.pop()!
    }
  }
  return typedArrayFor(dtype, length)
}

export function freeType(data: ArrayBufferView | null | undefined): void {
  if (!data || data.byteLength > MAX_POOLED_LENGTH * 4) return
  const dtype = typedArrayCode(data)
  if (!dtype) return
  const length = (data as unknown as { length: number }).length
  if (length > MAX_POOLED_LENGTH) return
  const key = `${dtype}:${length}`
  let bucket = pools.get(key)
  if (!bucket) {
    bucket = []
    pools.set(key, bucket)
  }
  if (bucket.length < 8) {
    bucket.push(data)
  }
}

/** 计算嵌套数组的形状，例如 [[1,2],[3,4]] -> [2,2]。 */
export function arrayShape(array: ArrayLike<unknown>): number[] {
  const shape: number[] = []
  let current: unknown = array
  while (Array.isArray(current) || isTypedArray(current)) {
    const len = (current as ArrayLike<unknown>).length
    shape.push(len)
    if (len === 0) break
    current = (current as ArrayLike<unknown>)[0]
  }
  return shape
}

/** 将嵌套数组按 shape 写入一个扁平的 TypedArray。 */
export function flattenArray(
  data: ArrayLike<unknown>,
  shape: number[],
  dtype: number
): ArrayBufferView {
  let total = 1
  for (let i = 0; i < shape.length; ++i) total *= shape[i]
  const result = allocType(dtype, total)

  let ptr = 0
  const target = result as unknown as { [index: number]: number }

  function write(value: unknown, depth: number): void {
    if (depth === shape.length - 1) {
      const arr = value as ArrayLike<number>
      for (let i = 0; i < arr.length; ++i) {
        target[ptr++] = +arr[i]
      }
      return
    }
    const arr = value as ArrayLike<unknown>
    for (let i = 0; i < arr.length; ++i) {
      write(arr[i], depth + 1)
    }
  }

  if (shape.length === 0) {
    // 空数组
    return result
  }
  write(data, 0)
  return result
}

/** 把普通数组 / TypedArray 统一转成指定类型的 TypedArray。 */
export function toTypedArray(
  data: ArrayLike<number>,
  dtype: number
): ArrayBufferView {
  if (isTypedArray(data) && typedArrayCode(data) === dtype) {
    return data
  }
  const result = allocType(dtype, data.length)
  const target = result as unknown as { set?: (a: ArrayLike<number>) => void; [index: number]: number }
  if (typeof target.set === 'function') {
    target.set(data)
  } else {
    for (let i = 0; i < data.length; ++i) target[i] = data[i]
  }
  return result
}

/** ndarray 的二维转置/打包。 */
export function transpose2D(
  result: { [index: number]: number },
  data: ArrayLike<number>,
  shapeX: number,
  shapeY: number,
  strideX: number,
  strideY: number,
  offset: number
): void {
  let ptr = 0
  for (let i = 0; i < shapeX; ++i) {
    for (let j = 0; j < shapeY; ++j) {
      result[ptr++] = data[strideX * i + strideY * j + offset]
    }
  }
}

/**
 * ndarray -> 紧凑数组。
 * 返回数据以及每行的元素个数（dimension）。
 */
export function packNDArray(
  nd: NDArrayLike,
  dtype: number
): { data: ArrayBufferView; dimension: number } {
  const shape = nd.shape
  const stride = nd.stride
  const offset = nd.offset || 0
  if (shape.length === 1) {
    const result = allocType(dtype, shape[0])
    const out = result as unknown as { [index: number]: number }
    for (let i = 0; i < shape[0]; ++i) {
      out[i] = (nd.data as ArrayLike<number>)[stride[0] * i + offset]
    }
    return { data: result, dimension: 1 }
  }
  if (shape.length === 2) {
    const result = allocType(dtype, shape[0] * shape[1])
    transpose2D(
      result as unknown as { [index: number]: number },
      nd.data as ArrayLike<number>,
      shape[0],
      shape[1],
      stride[0],
      stride[1],
      offset
    )
    return { data: result, dimension: shape[1] }
  }
  throw new Error('(regl) invalid ndarray shape, must be 1D or 2D')
}

// ---------------------------------------------------------------------------
// 半精度浮点
// ---------------------------------------------------------------------------

const floatView = new Float32Array(1)
const int32View = new Int32Array(floatView.buffer)

/**
 * Float32 -> Float16 位模式。
 * 使用经典的 IEEE 754 位运算实现；对 NaN/Inf/溢出做了处理。
 */
export function toHalfFloat(value: number): number {
  floatView[0] = value
  const x = int32View[0]
  let bits = (x >> 16) & 0x8000 // 符号位
  let m = (x >> 12) & 0x07ff // 尾数
  const e = (x >> 23) & 0xff // 指数

  if (e < 103) {
    return bits
  }
  if (e > 142) {
    bits |= 0x7c00 // Inf / NaN
    bits |= (e === 255 ? 0 : 1) && x & 0x007fffff
    return bits
  }
  if (e < 113) {
    m |= 0x0800
    bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1)
    return bits
  }
  bits |= ((e - 112) << 10) | (m >> 1)
  bits += m & 1
  return bits
}

/** 把 Float32 数组批量转换成半精度（Uint16 位模式）。 */
export function convertToHalfFloat(data: ArrayLike<number>): Uint16Array {
  const result = new Uint16Array(data.length)
  for (let i = 0; i < data.length; ++i) {
    result[i] = toHalfFloat(data[i])
  }
  return result
}

/** 数据类型对应的字节大小。 */
export function typeByteSize(dtype: number): number {
  return dataTypeSizes[dtype] || 1
}
