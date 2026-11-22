/**
 * 顶点属性绑定记录的解析。
 *
 * `attributes` 选项支持多种写法：
 *   position: [[0,0],[1,0],[0,1]]                 // 内联数据
 *   position: regl.buffer(...)                    // buffer 资源
 *   position: { buffer, size: 3, stride: 12, ... } // 指针描述
 *   position: { constant: [1, 0, 0, 1] }           // 常量属性
 *
 * 这里把这些写法统一成 AttributeRecord，供普通绘制与 VAO 共用。
 */

import {
  check,
  checkParameter,
  isArrayLike,
  isNDArrayLike,
  isTypedArray
} from '../util/check'
import { GL, dataTypes } from '../util/constants'
import {
  Buffer,
  BufferStore,
  BufferData,
  getBuffer,
  isBufferData
} from '../resources/buffer'

export const ATTRIB_STATE_POINTER = 1
export const ATTRIB_STATE_CONSTANT = 2

export interface AttributeRecord {
  state: number
  buffer: Buffer | null
  /** 0 表示使用 buffer.dtype。 */
  type: number
  /** 0 表示使用 shader 中该 attribute 的分量数。 */
  size: number
  normalized: boolean
  /** 是否使用 vertexAttribIPointer（整数 attribute）。 */
  integer?: boolean
  offset: number
  stride: number
  divisor: number
  x: number
  y: number
  z: number
  w: number
}

export function createAttributeRecord(): AttributeRecord {
  return {
    state: 0,
    buffer: null,
    type: 0,
    size: 0,
    normalized: false,
    offset: 0,
    stride: 0,
    divisor: 0,
    x: 0,
    y: 0,
    z: 0,
    w: 0
  }
}

export interface ParsedAttribute {
  record: AttributeRecord
  /** 如果为内联数据创建了临时 buffer，这里返回它（调用方负责回收/销毁）。 */
  createdBuffer: Buffer | null
  /** 是否属于 stream buffer（绘制后应放回池中）。 */
  stream: boolean
}

/**
 * 解析一个 attribute 值。
 * @param mode static：编译期解析，内联数据会创建持久 buffer；
 *             dynamic：每帧解析，内联数据使用 stream 池。
 */
export function parseAttributeValue(
  value: unknown,
  buffers: BufferStore,
  mode: 'static' | 'dynamic'
): ParsedAttribute {
  const record = createAttributeRecord()

  let createdBuffer: Buffer | null = null
  let stream = false

  const makeBuffer = (data: unknown): Buffer => {
    if (mode === 'dynamic') {
      const buffer = buffers.createStream(GL.ARRAY_BUFFER, data as BufferData)
      createdBuffer = buffer
      stream = true
      return buffer
    }
    const wrapper = buffers.create(
      data as BufferData,
      GL.ARRAY_BUFFER,
      false,
      true
    )
    createdBuffer = wrapper._buffer
    return wrapper._buffer
  }

  // 1. 直接是数据
  if (isBufferData(value)) {
    const buffer = makeBuffer(value)
    record.state = ATTRIB_STATE_POINTER
    record.buffer = buffer
    record.type = 0
    return { record, createdBuffer, stream }
  }

  // 2. 直接是 buffer 资源
  const directBuffer = getBuffer(value)
  if (directBuffer) {
    record.state = ATTRIB_STATE_POINTER
    record.buffer = directBuffer
    record.type = 0
    return { record, createdBuffer, stream }
  }

  // 3. VAO 风格的 { data: ... } 简写
  const spec = value as Record<string, unknown>
  if ('data' in spec && !('buffer' in spec) && !('constant' in spec)) {
    const buffer = makeBuffer(spec.data)
    record.state = ATTRIB_STATE_POINTER
    record.buffer = buffer
    record.size = (spec.size as number) | 0 || buffer.dimension
    record.normalized = !!spec.normalized
    record.integer = !!spec.integer
    record.type = ('type' in spec
      ? dataTypes[spec.type as string]
      : buffer.dtype) || buffer.dtype
    record.offset = (spec.offset as number) | 0 || 0
    record.stride = (spec.stride as number) | 0 || 0
    record.divisor = (spec.divisor as number) | 0 || 0
    return { record, createdBuffer, stream }
  }

  // 4. 描述对象
  check(
    !!value && typeof value === 'object',
    'invalid data for attribute'
  )
  const spec2 = value as Record<string, unknown>

  if ('constant' in spec2) {
    const constant = spec2.constant
    record.buffer = null
    record.state = ATTRIB_STATE_CONSTANT
    if (typeof constant === 'number') {
      record.x = constant
    } else {
      check(
        isArrayLike(constant) &&
          (constant as ArrayLike<number>).length > 0 &&
          (constant as ArrayLike<number>).length <= 4,
        'invalid constant for attribute'
      )
      const arr = constant as ArrayLike<number>
      record.x = +arr[0] || 0
      record.y = arr.length > 1 ? +arr[1] || 0 : 0
      record.z = arr.length > 2 ? +arr[2] || 0 : 0
      record.w = arr.length > 3 ? +arr[3] || 0 : 0
    }
    return { record, createdBuffer, stream }
  }

  let buffer: Buffer
  if (isBufferData(spec2.buffer)) {
    buffer = makeBuffer(spec2.buffer)
  } else {
    const found = getBuffer(spec2.buffer)
    check(!!found, 'missing buffer for attribute')
    buffer = found!
  }

  const offset = (spec2.offset as number) | 0
  check(offset >= 0, 'invalid attribute offset')
  const stride = (spec2.stride as number) | 0
  check(
    stride >= 0 && stride < 256,
    'invalid stride for attribute, must be integer between [0, 255]'
  )
  const size = (spec2.size as number) | 0
  check(
    !('size' in spec2) || (size > 0 && size <= 4),
    'invalid size for attribute, must be 1, 2, 3 or 4'
  )
  const normalized = !!spec2.normalized
  let type = 0
  if ('type' in spec2) {
    checkParameter(spec2.type, dataTypes, 'invalid type for attribute')
    type = dataTypes[spec2.type as string]
  }
  const divisor = (spec2.divisor as number) | 0
  check(divisor >= 0, 'invalid divisor for attribute')

  record.buffer = buffer
  record.state = ATTRIB_STATE_POINTER
  record.size = size
  record.normalized = normalized
  record.integer = !!spec2.integer
  record.type = type || buffer.dtype
  record.offset = offset
  record.stride = stride
  record.divisor = divisor

  return { record, createdBuffer, stream }
}

/** 将 record 复制成可长期保存的快照（避免动态记录被复用）。 */
export function cloneAttributeRecord(record: AttributeRecord): AttributeRecord {
  return { ...record }
}

/** 由 buffer 推断默认 size（用于 VAO 场景）。 */
export function bufferAttributeSize(buffer: Buffer): number {
  return buffer.dimension | 0
}

// 避免未使用告警
void isTypedArray
void isNDArrayLike
