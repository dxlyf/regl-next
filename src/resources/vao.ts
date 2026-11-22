/**
 * 顶点数组对象（VAO）。
 *
 * WebGL2 原生支持 VAO；WebGL1 只有 OES_vertex_array_object 扩展。
 * 如果两者都没有，则退化为「模拟 VAO」：在绑定的时候重新提交所有属性指针。
 *
 * 命令层的 `vao` 选项既接受 VAO 资源，也接受 VAO 配置对象（会自动创建资源），
 * 这与 regl 的行为一致。
 */

import { check } from '../util/check'
import { GL, primitiveTypes } from '../util/constants'
import type { Capabilities } from '../core/capabilities'
import type { GLStateCache } from '../core/state'
import {
  ATTRIB_STATE_CONSTANT,
  AttributeRecord,
  cloneAttributeRecord,
  createAttributeRecord,
  parseAttributeValue
} from '../core/attribute'
import { Buffer, BufferStore } from './buffer'
import {
  ElementBuffer,
  ElementsStore,
  ElementsWrapper,
  isElements
} from './elements'

export interface VertexArrayOptions {
  attributes: (AttributeSpec | Buffer | unknown)[]
  elements?: ElementsWrapper | unknown[] | ArrayBufferView | number | null
  count?: number
  offset?: number
  instances?: number
  primitive?: string
}

export type AttributeSpec = Record<string, unknown>

export class VertexArray {
  readonly id: number
  handle: WebGLVertexArrayObject | null
  attributes: AttributeRecord[] = []
  elements: ElementsWrapper | null = null
  ownsElements = false
  count = 0
  offset = 0
  instances = -1
  primitive: number = GL.TRIANGLES
  /** 为内联 attribute 数据创建的 buffer，便于销毁。 */
  buffers: (Buffer | null)[] = []
  private readonly caps: Capabilities

  constructor(id: number, caps: Capabilities) {
    this.id = id
    this.caps = caps
    this.handle = caps.hasVAO ? caps.createVertexArray() : null
  }

  /** 把当前属性记录提交到原生 VAO。 */
  refresh(cache: GLStateCache): void {
    if (!this.handle || !this.caps.hasVAO) return
    const previous = cache.currentVAO
    this.caps.bindVertexArray(this.handle)
    // 绑定新 VAO 后属性缓存必须失效
    cache.invalidateVertexArrays()

    for (let i = 0; i < this.attributes.length; ++i) {
      applyRecord(cache, i, this.attributes[i])
    }
    for (let i = this.attributes.length; i < cache.attributes.length; ++i) {
      cache.setAttributeConstant(i, 0, 0, 0, 0)
    }
    if (this.elements) {
      cache.bindElementBuffer(this.elements._elements.buffer.handle)
    } else {
      cache.bindElementBuffer(null)
    }

    // 恢复到之前的 VAO
    this.caps.bindVertexArray(
      (previous as VertexArray | null)?.handle || null
    )
    cache.currentVAO = previous
    cache.invalidateVertexArrays()
  }

  /** 绑定 VAO（原生或模拟）。 */
  bind(cache: GLStateCache): void {
    if (this.caps.hasVAO) {
      if (cache.currentVAO === this) return
      this.caps.bindVertexArray(this.handle)
      cache.currentVAO = this
      cache.invalidateVertexArrays()
      return
    }

    // 模拟 VAO
    for (let i = 0; i < this.attributes.length; ++i) {
      applyRecord(cache, i, this.attributes[i])
    }
    for (let i = this.attributes.length; i < cache.attributes.length; ++i) {
      cache.setAttributeConstant(i, 0, 0, 0, 0)
    }
    if (this.elements) {
      cache.bindElementBuffer(this.elements._elements.buffer.handle)
    } else {
      cache.bindElementBuffer(null)
    }
    cache.currentVAO = this
  }

  /** 解绑（绘制结束后调用，避免污染后续命令）。 */
  static unbind(cache: GLStateCache, caps: Capabilities): void {
    if (!cache.currentVAO) return
    if (caps.hasVAO) {
      caps.bindVertexArray(null)
    }
    cache.currentVAO = null
    cache.invalidateVertexArrays()
  }

  destroy(store: VertexArrayStore): void {
    if (this.handle) {
      this.caps.deleteVertexArray(this.handle)
      this.handle = null
    }
    for (const buffer of this.buffers) {
      if (buffer && buffer.handle) {
        // 只销毁由 VAO 创建的 buffer
        store.buffers.destroy(buffer)
      }
    }
    this.buffers.length = 0
    if (this.ownsElements && this.elements) {
      this.elements.destroy()
      this.elements = null
      this.ownsElements = false
    }
    this.attributes.length = 0
    store.remove(this)
  }
}

function applyRecord(
  cache: GLStateCache,
  location: number,
  record: AttributeRecord
): void {
  if (record.state === ATTRIB_STATE_CONSTANT) {
    cache.setAttributeConstant(
      location,
      record.x,
      record.y,
      record.z,
      record.w,
      !!record.integer
    )
  } else if (record.buffer) {
    const buffer = record.buffer
    if (!buffer.handle) {
      throw new Error('(regl) attribute buffer has been destroyed')
    }
    cache.setAttributePointer(location, {
      buffer: buffer.handle,
      size: record.size || Math.min(4, Math.max(1, buffer.dimension)),
      type: record.type || buffer.dtype,
      normalized: record.normalized,
      integer: !!record.integer,
      stride: record.stride,
      offset: record.offset,
      divisor: record.divisor
    })
  } else {
    cache.setAttributeConstant(location, 0, 0, 0, 0)
  }
}

// ---------------------------------------------------------------------------
// VAO 仓库
// ---------------------------------------------------------------------------

export interface VertexArrayStoreOptions {
  caps: Capabilities
  buffers: BufferStore
  elements: ElementsStore
  /** 用于刷新 VAO 属性绑定的状态缓存。 */
  state: GLStateCache
  stats: { vaoCount: number }
}

export class VertexArrayStore {
  readonly caps: Capabilities
  readonly buffers: BufferStore
  readonly elements: ElementsStore
  readonly state: GLStateCache
  private readonly stats: { vaoCount: number }
  private count = 0
  private readonly set = new Map<number, VertexArray>()

  constructor(options: VertexArrayStoreOptions) {
    this.caps = options.caps
    this.buffers = options.buffers
    this.elements = options.elements
    this.state = options.state
    this.stats = options.stats
  }

  create(options: VertexArrayOptions | unknown[]): VertexArrayWrapper {
    const vao = new VertexArray(this.count++, this.caps)
    this.set.set(vao.id, vao)
    this.stats.vaoCount++

    const update = (input: VertexArrayOptions | unknown[]): VertexArrayWrapper => {
      this.update(vao, input)
      return wrapper
    }

    const wrapper = createVAOWrapper(vao, update, this)
    this.update(vao, options)
    return wrapper
  }

  private update(vao: VertexArray, options: VertexArrayOptions | unknown[]): void {
    let attributes: unknown[]
    if (Array.isArray(options)) {
      attributes = options
      if (vao.ownsElements && vao.elements) {
        vao.elements.destroy()
      }
      vao.elements = null
      vao.ownsElements = false
      vao.offset = 0
      vao.count = 0
      vao.instances = -1
      vao.primitive = GL.TRIANGLES
    } else {
      check(!!options && typeof options === 'object', 'invalid arguments for create vao')
      check('attributes' in options, 'must specify attributes for vao')
      const opts = options as VertexArrayOptions

      // elements
      if (opts.elements) {
        const elements = opts.elements
        if (vao.ownsElements && vao.elements) {
          if (isElements(elements)) {
            vao.elements.destroy()
            vao.ownsElements = false
          } else {
            ;(vao.elements as unknown as (v: unknown) => void)(elements)
            vao.ownsElements = false
          }
        } else if (this.elements.get(elements)) {
          vao.elements = elements as ElementsWrapper
          vao.ownsElements = false
        } else {
          vao.elements = this.elements.create(
            elements as Parameters<ElementsStore['create']>[0]
          )
          vao.ownsElements = true
        }
      } else {
        if (vao.ownsElements && vao.elements) {
          vao.elements.destroy()
        }
        vao.elements = null
        vao.ownsElements = false
      }

      attributes = opts.attributes
      check(Array.isArray(attributes), 'attributes must be an array')

      vao.offset = 0
      vao.count = -1
      vao.instances = -1
      vao.primitive = GL.TRIANGLES

      if (vao.elements) {
        vao.count = vao.elements._elements.vertCount
        vao.primitive = vao.elements._elements.primType
      }

      if ('offset' in opts) vao.offset = opts.offset! | 0
      if ('count' in opts) vao.count = opts.count! | 0
      if ('instances' in opts) vao.instances = opts.instances! | 0
      if ('primitive' in opts) {
        check(
          opts.primitive! in primitiveTypes,
          `bad primitive type: ${opts.primitive}`
        )
        vao.primitive = primitiveTypes[opts.primitive!]
      }
    }

    check(attributes.length > 0, 'must specify at least one attribute')
    check(
      attributes.length < 256,
      'too many attributes'
    )

    // 清理旧的 attribute buffers
    for (const buffer of vao.buffers) {
      if (buffer && buffer.handle) {
        this.buffers.destroy(buffer)
      }
    }
    vao.buffers = []
    vao.attributes = []

    for (let i = 0; i < attributes.length; ++i) {
      const spec = attributes[i]
      const record = createAttributeRecord()

      // 常量旧写法 {x, y, z, w}
      if (
        spec &&
        typeof spec === 'object' &&
        'x' in (spec as Record<string, unknown>) &&
        !('constant' in (spec as Record<string, unknown>))
      ) {
        const s = spec as Record<string, number>
        record.state = ATTRIB_STATE_CONSTANT
        record.x = +s.x || 0
        record.y = +s.y || 0
        record.z = +s.z || 0
        record.w = +s.w || 0
        vao.attributes.push(record)
        vao.buffers.push(null)
        continue
      }

      const parsed = parseAttributeValue(spec, this.buffers, 'static')
      const rec = parsed.record
      if (rec.buffer && !rec.size) {
        rec.size = Math.min(4, Math.max(1, rec.buffer.dimension))
      }
      if (rec.buffer && !rec.type) {
        rec.type = rec.buffer.dtype
      }
      vao.attributes.push(rec)
      vao.buffers.push(parsed.createdBuffer)
    }

    vao.refresh(this.state)
  }

  /** 让 VAO 的 element 数据被绘制命令使用。 */
  getVAO(value: unknown): VertexArray | null {
    if (
      typeof value === 'function' &&
      (value as unknown as { _reglType?: string })._reglType === 'vao'
    ) {
      const internal = (value as unknown as { _vao?: VertexArray })._vao
      return internal instanceof VertexArray ? internal : null
    }
    return null
  }

  remove(vao: VertexArray): void {
    if (this.set.delete(vao.id)) {
      this.stats.vaoCount--
    }
  }

  /** buffer 销毁时，清空 VAO 中对应的记录。 */
  onBufferDestroy(buffer: Buffer): void {
    for (const vao of this.set.values()) {
      for (const record of vao.attributes) {
        if (record.buffer === buffer) {
          record.buffer = null
          record.state = 0
        }
      }
    }
  }

  clear(): void {
    for (const vao of Array.from(this.set.values())) {
      vao.destroy(this)
    }
    this.set.clear()
    this.stats.vaoCount = 0
  }

  restore(): void {
    for (const vao of this.set.values()) {
      vao.handle = this.caps.hasVAO ? this.caps.createVertexArray() : null
      vao.refresh(this.state)
    }
  }
}

// ---------------------------------------------------------------------------
// 用户可见包装
// ---------------------------------------------------------------------------

export interface VertexArrayWrapper {
  (options?: VertexArrayOptions | unknown[]): VertexArrayWrapper
  _reglType: 'vao'
  _vao: VertexArray
  destroy(): void
}

function createVAOWrapper(
  vao: VertexArray,
  update: (options: VertexArrayOptions | unknown[]) => VertexArrayWrapper,
  store: VertexArrayStore
): VertexArrayWrapper {
  const wrapper = ((options?: VertexArrayOptions | unknown[]) => {
    update(options || { attributes: [] })
    return wrapper
  }) as VertexArrayWrapper
  wrapper._reglType = 'vao'
  wrapper._vao = vao
  wrapper.destroy = () => {
    vao.destroy(store)
  }
  return wrapper
}

/** 判断是否是 VAO 资源。 */
export function isVAO(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as { _reglType?: string })._reglType === 'vao'
  )
}

/** 从包装取内部 VAO。 */
export function getVAO(value: unknown): VertexArray | null {
  if (!isVAO(value)) return null
  const internal = (value as unknown as { _vao?: VertexArray })._vao
  return internal instanceof VertexArray ? internal : null
}

// ---------------------------------------------------------------------------
// 供命令层复用
// ---------------------------------------------------------------------------

export { applyRecord, cloneAttributeRecord, ElementBuffer }
