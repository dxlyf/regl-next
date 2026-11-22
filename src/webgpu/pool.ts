/** WebGPU buffer / texture 对象池。 */

import { check } from '../util/check'
import { createBufferResource } from './buffer'
import { createTextureResource } from './texture'
import type {
  GPUBufferOptions,
  GPUBufferResource,
  GPUPoolOptions,
  GPUPoolStats,
  GPUPooled,
  GPUResourcePool,
  GPUTextureOptions,
  GPUTextureResource
} from './types'
import { align, resolveBufferUsage } from './util'

interface BufferSpec {
  key: string
  size: number
  usage: GPUBufferUsageFlags
  data: ArrayBufferView | ArrayBuffer | null
}

interface TextureSpec {
  key: string
  options: GPUTextureOptions
}

function normalizeBuffer(
  input: GPUBufferOptions | number | ArrayBufferView | ArrayBuffer
): BufferSpec {
  let data: ArrayBufferView | ArrayBuffer | null = null
  let size = 0
  let usage: GPUBufferOptions['usage'] | undefined
  if (typeof input === 'number') {
    size = input
  } else if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    data = input
    size = input.byteLength
  } else {
    const options = input
    data =
      options.data && typeof options.data !== 'number' ? options.data : null
    size =
      typeof options.data === 'number'
        ? options.data
        : options.size ?? (data ? data.byteLength : 0)
    usage = options.usage
  }
  size = Math.max(4, align(size, 4))
  const flags = resolveBufferUsage(usage, !!data)
  return { key: `${size}:${flags}`, size, usage: flags, data }
}

function normalizeTexture(options: GPUTextureOptions): TextureSpec {
  const faces = !!options.faces
  const layers = faces
    ? 6
    : options.depthOrArrayLayers ||
      options.depth ||
      options.layers ||
      1
  const format = options.format || 'rgba8unorm'
  const sampleCount = options.sampleCount || 1
  const mipLevelCount = options.mipLevelCount || 1
  const dimension = options.dimension || '2d'
  const key = [
    options.width,
    options.height,
    layers,
    faces ? 'cube' : 'layers',
    format,
    options.usage,
    sampleCount,
    mipLevelCount,
    dimension,
    options.viewDimension
  ].join(':')
  return { key, options }
}

function padBufferData(data: ArrayBufferView | ArrayBuffer): Uint8Array {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (bytes.byteLength % 4 === 0) return bytes
  const padded = new Uint8Array(align(bytes.byteLength, 4))
  padded.set(bytes)
  return padded
}

export function createResourcePool(
  device: GPUDevice,
  options: GPUPoolOptions = {}
): GPUResourcePool {
  const maxFreeBuffers = options.maxFreeBuffers ?? 32
  const maxFreeTextures = options.maxFreeTextures ?? 16
  const freeBuffers = new Map<string, GPUBufferResource[]>()
  const freeTextures = new Map<string, GPUTextureResource[]>()
  const leases = new Map<
    GPUBufferResource | GPUTextureResource,
    { kind: 'buffer' | 'texture'; key: string; count: number }
  >()
  let destroyed = false

  function lease<T extends GPUBufferResource | GPUTextureResource>(
    kind: 'buffer' | 'texture',
    key: string,
    resource: T
  ): GPUPooled<T> {
    const state = { kind, key, count: 1 }
    leases.set(resource, state)
    const pooled: GPUPooled<T> = {
      resource,
      get refCount() {
        return state.count
      },
      retain() {
        check(!destroyed, 'resource pool has been destroyed')
        check(state.count > 0, 'cannot retain a released resource')
        state.count++
      },
      release() {
        if (state.count <= 0) return
        state.count--
        if (state.count !== 0) return
        leases.delete(resource)
        if (destroyed) {
          resource.destroy()
          return
        }
        if (kind === 'buffer') {
          const list = freeBuffers.get(key) || []
          if (list.length < maxFreeBuffers) {
            list.push(resource as GPUBufferResource)
            freeBuffers.set(key, list)
          } else {
            resource.destroy()
          }
        } else {
          const list = freeTextures.get(key) || []
          if (list.length < maxFreeTextures) {
            list.push(resource as GPUTextureResource)
            freeTextures.set(key, list)
          } else {
            resource.destroy()
          }
        }
      }
    }
    return pooled
  }

  const pool: GPUResourcePool = {
    _gpuType: 'pool',
    buffer(input) {
      check(!destroyed, 'resource pool has been destroyed')
      const spec = normalizeBuffer(input ?? 4)
      const free = freeBuffers.get(spec.key)
      const resource =
        free && free.length > 0
          ? free.pop()!
          : createBufferResource(device, {
              size: spec.size,
              usage: spec.usage
            })
      if (spec.data) {
        check(
          (resource.usage & GPUBufferUsage.COPY_DST) !== 0,
          'pooled buffer was not created with COPY_DST'
        )
        resource.write(padBufferData(spec.data))
      }
      return lease('buffer', spec.key, resource)
    },
    texture(textureOptions) {
      check(!destroyed, 'resource pool has been destroyed')
      const spec = normalizeTexture(textureOptions)
      const free = freeTextures.get(spec.key)
      let resource = free && free.length > 0 ? free.pop()! : null
      if (!resource) {
        resource = createTextureResource(device, textureOptions)
      } else if (textureOptions.faces) {
        for (let face = 0; face < 6; ++face) {
          resource.uploadFace(face, textureOptions.faces[face])
        }
      } else if (textureOptions.data) {
        resource.upload(textureOptions.data)
      } else if (textureOptions.image) {
        // 外部图片源不能复用旧纹理，直接创建新的。
        if (resource) {
          free!.push(resource)
        }
        resource = createTextureResource(device, textureOptions)
      }
      return lease('texture', spec.key, resource)
    },
    stats(): GPUPoolStats {
      let freeBufferCount = 0
      let freeTextureCount = 0
      for (const list of freeBuffers.values()) freeBufferCount += list.length
      for (const list of freeTextures.values()) freeTextureCount += list.length
      let leasedBufferCount = 0
      let leasedTextureCount = 0
      for (const state of leases.values()) {
        if (state.kind === 'buffer') leasedBufferCount++
        else leasedTextureCount++
      }
      return {
        buffers: { free: freeBufferCount, leased: leasedBufferCount },
        textures: { free: freeTextureCount, leased: leasedTextureCount }
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      for (const list of freeBuffers.values()) {
        for (const buffer of list) buffer.destroy()
      }
      for (const list of freeTextures.values()) {
        for (const texture of list) texture.destroy()
      }
      for (const resource of leases.keys()) {
        resource.destroy()
      }
      freeBuffers.clear()
      freeTextures.clear()
      leases.clear()
    }
  }
  return pool
}
