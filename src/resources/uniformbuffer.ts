/**
 * WebGL2 Uniform Buffer（UBO）资源。
 *
 * Phase 1：
 * - 创建原始 `UNIFORM_BUFFER`，支持 `subdata` / `destroy` / 上下文恢复；
 * - 绑定到命令的 `uniformBlocks` 选项；
 * - 当 UBO 被绑定到某个 program 的 block 后，缓存该 block 的反射布局，
 *   允许按成员更新：`ubo.member('view', mat4)`。
 *
 * Phase 2：
 * - 结构化值按反射 std140 布局整块打包；
 * - 支持静态缓存、动态值差量上传；
 * - 本文件只提供打包/差量工具，内部 UBO 的创建与生命周期由命令负责。
 */

import { GL } from '../util/constants'
import { parsePath, readPath } from '../core/dynamic'
import type { Buffer, BufferStore, BufferData } from './buffer'
import type { BlockUniformInfo } from '../core/shader'
import { uniformTypeInfo } from '../core/shader'

export interface UniformBufferOptions {
  data?: BufferData
  usage?: 'static' | 'dynamic' | 'stream'
  /** 仅分配字节数（等价于 buffer 的 length）。 */
  size?: number
  length?: number
  /** 是否保存数据副本用于上下文恢复，默认 false（与普通 buffer 一致）。 */
  persistent?: boolean
}

/** 公开的 block 成员布局。 */
export interface UniformBlockLayoutMember {
  name: string
  type: number
  offset: number
  size: number
  arrayStride: number
  matrixStride: number
  rowMajor: boolean
}

export interface UniformBlockLayoutData {
  name: string
  dataSize: number
  uniforms: UniformBlockLayoutMember[]
}

export interface UniformBlockLayout extends UniformBlockLayoutData {
  members: Record<string, UniformBlockLayoutMember>
}

export interface UniformBlockDescriptor {
  buffer: UniformBufferWrapper
  offset?: number
  size?: number
  binding?: number
}

/** Phase 2 显式结构化值包装：避免与成员名 `buffer` / `values` 冲突。 */
export interface UniformBlockValues {
  values: Record<string, unknown>
  binding?: number
}

export function isUniformBlockValues(
  value: unknown
): value is UniformBlockValues {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer
  ) {
    return false
  }
  const record = value as Record<string, unknown>
  if (!('values' in record)) return false
  const values = record.values
  if (
    !values ||
    typeof values !== 'object' ||
    Array.isArray(values) ||
    ArrayBuffer.isView(values) ||
    values instanceof ArrayBuffer
  ) {
    return false
  }
  for (const key of Object.keys(record)) {
    if (key !== 'values' && key !== 'binding') return false
  }
  return (
    record.binding === undefined || typeof record.binding === 'number'
  )
}

export interface UniformBufferWrapper {
  (options?: UniformBufferOptions | BufferData | number | null): UniformBufferWrapper
  _reglType: 'uniformBuffer'
  _buffer: Buffer
  /** 当前解析到的 block 布局；未绑定到任何 program 时为 null。 */
  readonly layout: UniformBlockLayout | null
  /** 更新单个成员（使用反射 offset，只上传成员范围）。 */
  member(name: string, value: unknown): UniformBufferWrapper
  /** 批量更新多个成员。 */
  set(values: Record<string, unknown>): UniformBufferWrapper
  /** 显式从命令解析布局（动态 shader 在第一次 draw 后可用）。 */
  attachLayout(
    commandOrLayout:
      | { uniformBlockLayout?: (name: string) => UniformBlockLayout | null }
      | UniformBlockLayoutData,
    blockName?: string
  ): UniformBufferWrapper
  subdata(data: BufferData, offset?: number): UniformBufferWrapper
  destroy(): void
  stats: { size: number }
}

// ---------------------------------------------------------------------------
// 布局工具
// ---------------------------------------------------------------------------

/** 生成用于校验的布局签名。 */
export function uniformBlockSignature(info: {
  name: string
  dataSize: number
  uniforms: BlockUniformInfo[]
}): string {
  const parts = info.uniforms
    .slice()
    .sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name))
    .map(
      (u) =>
        `${u.name}:${u.type}:${u.size}:${u.offset}:${u.arrayStride}:${u.matrixStride}:${u.rowMajor ? 1 : 0}`
    )
  return `${info.name}|${info.dataSize}|${parts.join(',')}`
}

/** 把反射出的 block 信息转换成公开的布局对象。 */
export function makeUniformBlockLayout(info: {
  name: string
  dataSize: number
  uniforms: BlockUniformInfo[]
}): UniformBlockLayout {
  const members: Record<string, UniformBlockLayoutMember> = {}
  const uniforms: UniformBlockLayoutMember[] = []
  for (const u of info.uniforms) {
    const member: UniformBlockLayoutMember = {
      name: u.name,
      type: u.type,
      offset: u.offset,
      size: u.size,
      arrayStride: u.arrayStride,
      matrixStride: u.matrixStride,
      rowMajor: u.rowMajor
    }
    members[u.name] = member
    uniforms.push(member)
  }
  return { name: info.name, dataSize: info.dataSize, uniforms, members }
}

export interface UniformBufferInternal {
  buffer: Buffer
  layoutInfo: UniformBlockLayoutData | null
  signature: string | null
  layout: UniformBlockLayout | null
}

/** 把 UBO 绑定到 block 布局；相同布局可重复绑定，不同布局直接报错。 */
export function attachUniformBlockLayout(
  internal: UniformBufferInternal,
  info: {
    name: string
    dataSize: number
    uniforms: BlockUniformInfo[]
  }
): UniformBlockLayout {
  // 热路径：同一个 program 的 block 信息对象直接复用，避免每帧重算签名
  if (internal.layoutInfo === info) {
    return internal.layout!
  }

  const signature = uniformBlockSignature(info)
  if (internal.signature !== null) {
    if (internal.signature !== signature) {
      throw new Error(
        `(regl) uniform buffer is already bound to a different std140 layout for block "${info.name}"`
      )
    }
    // restore 后 block 信息是新对象，更新引用，后续绘制可直接命中身份比较
    internal.layoutInfo = info
    return internal.layout!
  }

  internal.layoutInfo = info
  internal.signature = signature
  internal.layout = makeUniformBlockLayout(info)
  return internal.layout
}

/**
 * 从 UBO wrapper 取内部 Buffer。
 */
export function getUniformBuffer(value: unknown): Buffer | null {
  if (!isUniformBuffer(value)) return null
  return value._buffer
}

export function isUniformBuffer(value: unknown): value is UniformBufferWrapper {
  return (
    typeof value === 'function' &&
    (value as unknown as { _reglType?: string })._reglType === 'uniformBuffer'
  )
}

export function isUniformBlockDescriptor(
  value: unknown
): value is UniformBlockDescriptor {
  return (
    !!value &&
    typeof value === 'object' &&
    isUniformBuffer((value as UniformBlockDescriptor).buffer)
  )
}

// ---------------------------------------------------------------------------
// 成员编码
// ---------------------------------------------------------------------------

function canonicalName(name: string): string {
  return name.replace(/\[0\]$/, '')
}

export function findBlockMember(
  layout: { name: string; uniforms: UniformBlockLayoutMember[] },
  name: string
): UniformBlockLayoutMember | null {
  const stripBlock = (memberName: string): string =>
    memberName.startsWith(`${layout.name}.`)
      ? memberName.slice(layout.name.length + 1)
      : memberName

  const target = canonicalName(name)
  for (const u of layout.uniforms) {
    const memberName = stripBlock(u.name)
    if (u.name === name || memberName === name) return u
    if (canonicalName(memberName) === target) return u
    if (memberName.endsWith(`.${name}`)) return u
  }
  return null
}

function flattenNumbers(value: unknown): number[] {
  if (typeof value === 'number') return [value]
  if (typeof value === 'boolean') return [value ? 1 : 0]
  if (Array.isArray(value)) {
    const result: number[] = []
    for (const item of value) result.push(...flattenNumbers(item))
    return result
  }
  if (ArrayBuffer.isView(value)) {
    const result: number[] = []
    const view = value as unknown as ArrayLike<number>
    for (let i = 0; i < view.length; ++i) result.push(+view[i])
    return result
  }
  throw new Error('(regl) invalid uniform block member value')
}

interface EncodedMember {
  offset: number
  data: Uint8Array
}

/** 按反射 offset / stride 编码单个 block 成员。 */
export function encodeUniformBlockMember(
  member: BlockUniformInfo,
  value: unknown,
  elementIndex?: number
): EncodedMember {
  const info = uniformTypeInfo(member.type)
  if (!info) {
    throw new Error(
      `(regl) unsupported uniform block member type for "${member.name}"`
    )
  }

  const components = info.components
  const cols = info.matrixCols ?? info.matrixDim ?? 1
  const rows = info.matrixRows ?? info.matrixDim ?? 1
  const isMatrix = !!info.matrixDim || !!info.matrixCols
  const singleElement = elementIndex !== undefined
  const elements = singleElement ? 1 : member.size || 1

  const bytes = new Uint8Array(
    calculateSpan(member, components, cols, rows, elements)
  )
  const view = new DataView(bytes.buffer)

  const numbers = flattenNumbers(value)
  const required = singleElement ? components : elements * components
  if (numbers.length !== required) {
    throw new Error(
      `(regl) invalid value for uniform block member "${member.name}": ` +
        `expected ${required} numbers, got ${numbers.length}`
    )
  }

  const writeScalar = (offset: number, n: number): void => {
    switch (member.type) {
      case GL.FLOAT:
      case GL.FLOAT_VEC2:
      case GL.FLOAT_VEC3:
      case GL.FLOAT_VEC4:
      case GL.FLOAT_MAT2:
      case GL.FLOAT_MAT3:
      case GL.FLOAT_MAT4:
      case GL.FLOAT_MAT2x3:
      case GL.FLOAT_MAT2x4:
      case GL.FLOAT_MAT3x2:
      case GL.FLOAT_MAT3x4:
      case GL.FLOAT_MAT4x2:
      case GL.FLOAT_MAT4x3:
        view.setFloat32(offset, n, true)
        break
      case GL.UNSIGNED_INT:
      case GL.UNSIGNED_INT_VEC2:
      case GL.UNSIGNED_INT_VEC3:
      case GL.UNSIGNED_INT_VEC4:
        view.setUint32(offset, n >>> 0, true)
        break
      case GL.INT:
      case GL.INT_VEC2:
      case GL.INT_VEC3:
      case GL.INT_VEC4:
      case GL.BOOL:
      case GL.BOOL_VEC2:
      case GL.BOOL_VEC3:
      case GL.BOOL_VEC4:
        view.setInt32(offset, n | 0, true)
        break
      default:
        view.setFloat32(offset, n, true)
    }
  }

  for (let element = 0; element < elements; ++element) {
    const elementBase = element * member.arrayStride
    if (isMatrix) {
      for (let c = 0; c < cols; ++c) {
        for (let r = 0; r < rows; ++r) {
          const valueIndex = element * components + c * rows + r
          const n = numbers[valueIndex] || 0
          const offset = member.rowMajor
            ? elementBase + r * member.matrixStride + c * 4
            : elementBase + c * member.matrixStride + r * 4
          writeScalar(offset, n)
        }
      }
    } else {
      for (let c = 0; c < components; ++c) {
        const n = numbers[element * components + c] || 0
        writeScalar(elementBase + c * 4, n)
      }
    }
  }

  return {
    offset:
      member.offset + (singleElement ? elementIndex! * member.arrayStride : 0),
    data: bytes
  }
}

function calculateSpan(
  member: BlockUniformInfo,
  components: number,
  cols: number,
  rows: number,
  elements: number
): number {
  const isMatrix = cols > 1 || rows > 1
  if (!isMatrix) {
    return (
      (elements - 1) * member.arrayStride + components * 4
    )
  }
  const lastElement = (elements - 1) * member.arrayStride
  const lastRow = (rows - 1) * member.matrixStride
  const lastCol = (cols - 1) * 4
  return lastElement + lastRow + lastCol + 4
}

/** 查找并编码成员。 */
export function encodeMemberByName(
  block: { name: string; uniforms: UniformBlockLayoutMember[] },
  name: string,
  value: unknown
): EncodedMember {
  // 支持 weights[2] 这种单元素更新
  const arrayMatch = /^(.*)\[(\d+)\]$/.exec(name)
  if (arrayMatch) {
    const base = findBlockMember(block, arrayMatch[1])
    const index = parseInt(arrayMatch[2], 10)
    if (base && base.size > index) {
      return encodeUniformBlockMember(base, value, index)
    }
  }

  const member = findBlockMember(block, name)
  if (!member) {
    throw new Error(
      `(regl) unknown uniform block member "${name}" in block "${block.name}"`
    )
  }
  return encodeUniformBlockMember(member, value)
}

/** 将嵌套对象展开成成员路径。 */
function flattenMembers(
  values: Record<string, unknown>,
  prefix = ''
): Array<[string, unknown]> {
  const result: Array<[string, unknown]> = []
  for (const key of Object.keys(values)) {
    const value = values[key]
    const path = prefix ? `${prefix}.${key}` : key
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !ArrayBuffer.isView(value)
    ) {
      result.push(
        ...flattenMembers(value as Record<string, unknown>, path)
      )
    } else {
      result.push([path, value])
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Phase 2：结构化值打包 / 差量上传
// ---------------------------------------------------------------------------

/** 反射成员在用户对象中的路径。 */
function memberValuePath(
  blockName: string,
  member: UniformBlockLayoutMember
): string {
  let name = member.name
  const prefix = `${blockName}.`
  if (name.startsWith(prefix)) name = name.slice(prefix.length)
  // float weights[4] / mat4 bones[2] 这类反射名通常带 [0]
  if (member.size > 1 && name.endsWith('[0]')) {
    name = name.slice(0, -3)
  }
  return name
}

/** 单个成员占据的字节范围大小（包含数组/矩阵 stride）。 */
export function uniformBlockMemberSize(member: BlockUniformInfo): number {
  const info = uniformTypeInfo(member.type)
  if (!info) return 0
  const cols = info.matrixCols ?? info.matrixDim ?? 1
  const rows = info.matrixRows ?? info.matrixDim ?? 1
  return calculateSpan(
    member,
    info.components,
    cols,
    rows,
    member.size || 1
  )
}

/**
 * 按反射布局把结构化对象打包成 std140 字节。
 *
 * `previous` 存在时先复制旧字节；对象中缺失的成员会保留旧值。
 * 这样动态对象可以只提供变化的成员。
 */
export function packUniformBlock(
  layout: UniformBlockLayoutData,
  values: Record<string, unknown>,
  previous?: Uint8Array | null
): Uint8Array {
  const bytes = new Uint8Array(layout.dataSize)
  if (previous && previous.length === bytes.length) {
    bytes.set(previous)
  }

  for (const member of layout.uniforms) {
    const path = memberValuePath(layout.name, member)
    if (!path) continue
    let value = readPath(values, parsePath(path))
    if (value === undefined && member.name !== path) {
      // 兼容用户直接使用反射名（例如 "Camera.view" 或 "lights[0].color"）作为 key
      value = readPath(values, parsePath(member.name))
    }
    if (value === undefined) continue

    const encoded = encodeUniformBlockMember(member, value)
    const end = encoded.offset + encoded.data.length
    if (encoded.offset < 0 || end > bytes.length) {
      throw new Error(
        `(regl) uniform block member "${member.name}" exceeds block "${layout.name}"`
      )
    }
    bytes.set(encoded.data, encoded.offset)
  }

  return bytes
}

/**
 * 差量上传：按成员范围比较新旧字节，只上传发生变化的连续区间。
 * 区间过多或变化字节超过一半时直接整块上传。
 */
export function uploadUniformBlockData(
  store: BufferStore,
  buffer: Buffer,
  layout: UniformBlockLayoutData,
  data: Uint8Array,
  previous: Uint8Array | null
): void {
  if (!previous || previous.length !== data.length) {
    store.subdata(buffer, data, 0)
    return
  }

  const ranges: Array<[number, number]> = []
  let changedBytes = 0

  for (const member of layout.uniforms) {
    const size = uniformBlockMemberSize(member)
    if (size <= 0) continue
    const start = Math.max(0, member.offset)
    const end = Math.min(data.length, member.offset + size)
    if (end <= start) continue

    let changed = false
    for (let i = start; i < end; ++i) {
      if (data[i] !== previous[i]) {
        changed = true
        break
      }
    }
    if (!changed) continue
    changedBytes += end - start
    ranges.push([start, end])
  }

  if (ranges.length === 0) return
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) {
      if (range[1] > last[1]) last[1] = range[1]
    } else {
      merged.push([range[0], range[1]])
    }
  }

  if (merged.length > 8 || changedBytes > data.length / 2) {
    store.subdata(buffer, data, 0)
    return
  }

  store.subdataRanges(buffer, data, merged)
}

// ---------------------------------------------------------------------------
// 创建 UBO wrapper
// ---------------------------------------------------------------------------

export function createUniformBuffer(
  store: BufferStore,
  options?: UniformBufferOptions | BufferData | number | null
): UniformBufferWrapper {
  const normalized = normalizeOptions(options)
  const persistent = !!normalized?.persistent
  const bufferWrapper = store.create(
    normalized,
    GL.UNIFORM_BUFFER,
    false,
    persistent
  )
  const buffer = bufferWrapper._buffer

  const internal: UniformBufferInternal = {
    buffer,
    layoutInfo: null,
    signature: null,
    layout: null
  }

  // 这里不使用 glFromBuffer；BufferStore 的 create 已经完成存储分配。
  // attachUniformBlockLayout 中若需要扩容，会在 wrapper 层通过 store.upload 完成。

  function ensureLayoutSize(info: { name: string; dataSize: number }): void {
    if (buffer.byteLength === 0 && info.dataSize > 0) {
      store.upload(
        buffer,
        { length: info.dataSize, usage: 'dynamic' },
        persistent
      )
    }
    if (buffer.byteLength < info.dataSize) {
      throw new Error(
        `(regl) uniform buffer too small for block "${info.name}": ` +
          `need ${info.dataSize} bytes, have ${buffer.byteLength}`
      )
    }
  }

  const wrapper = ((next?: UniformBufferOptions | BufferData | number | null) => {
    const normalizedNext = normalizeOptions(next)
    if (normalizedNext) {
      store.upload(
        buffer,
        normalizedNext,
        normalizedNext.persistent ?? persistent
      )
    }
    return wrapper
  }) as UniformBufferWrapper

  wrapper._reglType = 'uniformBuffer'
  wrapper._buffer = buffer
  wrapper.stats = buffer.stats

  Object.defineProperty(wrapper, 'layout', {
    get(): UniformBlockLayout | null {
      return internal.layout
    }
  })

  wrapper.member = (name: string, value: unknown) => {
    if (!internal.layoutInfo) {
      throw new Error(
        '(regl) uniform buffer has no resolved block layout yet; ' +
          'bind it to a command or call attachLayout() first'
      )
    }
    const encoded = encodeMemberByName(internal.layoutInfo, name, value)
    store.subdata(buffer, encoded.data, encoded.offset)
    return wrapper
  }

  wrapper.set = (values: Record<string, unknown>) => {
    const entries = flattenMembers(values)
    for (const [name, value] of entries) {
      wrapper.member(name, value)
    }
    return wrapper
  }

  wrapper.attachLayout = (
    commandOrLayout:
      | { uniformBlockLayout?: (name: string) => UniformBlockLayout | null }
      | UniformBlockLayoutData,
    blockName?: string
  ) => {
    let info: UniformBlockLayoutData | null = null
    if (
      'uniforms' in commandOrLayout &&
      Array.isArray((commandOrLayout as UniformBlockLayoutData).uniforms)
    ) {
      info = commandOrLayout as UniformBlockLayoutData
    } else if (
      typeof (commandOrLayout as { uniformBlockLayout?: unknown })
        .uniformBlockLayout === 'function'
    ) {
      if (!blockName) {
        throw new Error(
          '(regl) attachLayout(command, blockName) requires a block name'
        )
      }
      info = (commandOrLayout as {
        uniformBlockLayout: (name: string) => UniformBlockLayout | null
      }).uniformBlockLayout(blockName)
    }
    if (!info) {
      throw new Error(
        '(regl) uniform block layout is not available yet; ' +
          'draw the command once or use a static shader'
      )
    }
    ensureLayoutSize(info)
    attachUniformBlockLayout(internal, info)
    return wrapper
  }

  wrapper.subdata = (data: BufferData, offset = 0) => {
    store.subdata(buffer, data, offset | 0)
    return wrapper
  }

  wrapper.destroy = () => {
    store.destroy(buffer)
  }

  return wrapper
}

interface NormalizedUniformBufferOptions {
  data?: BufferData
  usage?: 'static' | 'dynamic' | 'stream'
  length?: number
  persistent?: boolean
}

function normalizeOptions(
  options?: UniformBufferOptions | BufferData | number | null
): NormalizedUniformBufferOptions | null {
  if (options === null || options === undefined) return null
  if (typeof options === 'number') {
    return { length: options | 0 }
  }
  if (
    Array.isArray(options) ||
    ArrayBuffer.isView(options) ||
    options instanceof ArrayBuffer
  ) {
    return { data: options as BufferData }
  }
  const opts = options as UniformBufferOptions
  const result: NormalizedUniformBufferOptions = {}
  if ('persistent' in opts) result.persistent = !!opts.persistent
  if ('data' in opts) result.data = opts.data
  if ('usage' in opts) result.usage = opts.usage
  if ('size' in opts) result.length = opts.size
  if ('length' in opts) result.length = opts.length
  return result
}
