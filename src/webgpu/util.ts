/** WebGPU 后端内部共享的工具函数。 */

import { check } from '../util/check'
import type {
  GPUBufferResource,
  GPUSamplerResource,
  GPUTextureResource
} from './types'

// WebGPU usage 常量使用数值字面量，避免在纯 WebGL 环境中
// 因为模块顶层访问 GPUBufferUsage / GPUTextureUsage 而崩溃。
const BUFFER_USAGE: Record<string, number> = {
  vertex: 0x0020,
  index: 0x0010,
  uniform: 0x0040,
  storage: 0x0080,
  'copy-src': 0x0004,
  'copy-dst': 0x0008,
  indirect: 0x0100,
  'query-resolve': 0x0200,
  'map-read': 0x0001
}

const TEXTURE_USAGE: Record<string, number> = {
  'texture-binding': 0x04,
  'storage-binding': 0x08,
  'copy-src': 0x01,
  'copy-dst': 0x02,
  'render-attachment': 0x10
}

const COPY_DST_BUFFER = 0x0008
const COPY_DST_TEXTURE = 0x02

export const DEPTH_FORMATS = new Set<GPUTextureFormat>([
  'depth16unorm',
  'depth24plus',
  'depth24plus-stencil8',
  'depth32float'
])

export function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}

export function toBytes(data: ArrayBufferView | ArrayBuffer): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

export function bytesPerPixel(format: GPUTextureFormat): number {
  switch (format) {
    case 'r8unorm':
    case 'r8snorm':
    case 'r8uint':
    case 'r8sint':
      return 1
    case 'rg8unorm':
    case 'rg8snorm':
    case 'rg8uint':
    case 'rg8sint':
      return 2
    case 'rgba8unorm':
    case 'rgba8unorm-srgb':
    case 'rgba8snorm':
    case 'rgba8uint':
    case 'rgba8sint':
    case 'bgra8unorm':
    case 'bgra8unorm-srgb':
    case 'rgb10a2unorm':
    case 'rg11b10ufloat':
      return 4
    case 'rgba16float':
    case 'rgba16uint':
    case 'rgba16sint':
      return 8
    case 'rgba32float':
    case 'rgba32uint':
    case 'rgba32sint':
      return 16
    default:
      return 0
  }
}

export function isTextureResource(value: unknown): value is GPUTextureResource {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { _gpuType?: string })._gpuType === 'texture'
  )
}

export function isBufferResource(value: unknown): value is GPUBufferResource {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { _gpuType?: string })._gpuType === 'buffer'
  )
}

export function isSamplerResource(value: unknown): value is GPUSamplerResource {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { _gpuType?: string })._gpuType === 'sampler'
  )
}

export function resolveBufferUsage(
  usage: unknown,
  hasData: boolean
): GPUBufferUsageFlags {
  if (typeof usage === 'number') {
    return hasData ? usage | COPY_DST_BUFFER : usage
  }
  let flags = 0
  for (const name of (usage as string[] | undefined) || ['vertex']) {
    const bit = BUFFER_USAGE[name]
    check(bit !== undefined, `invalid buffer usage "${name}"`)
    flags |= bit
  }
  if (hasData) flags |= COPY_DST_BUFFER
  return flags
}

export function resolveTextureUsage(
  usage: unknown,
  format: GPUTextureFormat,
  hasData: boolean
): GPUTextureUsageFlags {
  if (typeof usage === 'number') {
    return hasData ? usage | COPY_DST_TEXTURE : usage
  }
  if (usage) {
    let flags = 0
    for (const name of usage as string[]) {
      const bit = TEXTURE_USAGE[name]
      check(bit !== undefined, `invalid texture usage "${name}"`)
      flags |= bit
    }
    if (hasData) flags |= COPY_DST_TEXTURE
    return flags
  }
  if (DEPTH_FORMATS.has(format)) {
    return TEXTURE_USAGE['render-attachment'] | TEXTURE_USAGE['copy-src']
  }
  let flags =
    TEXTURE_USAGE['texture-binding'] |
    COPY_DST_TEXTURE |
    TEXTURE_USAGE['copy-src'] |
    TEXTURE_USAGE['render-attachment']
  if (hasData) flags |= COPY_DST_TEXTURE
  return flags
}
