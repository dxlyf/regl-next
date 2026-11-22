/** WebGPU buffer 资源。 */

import { check } from '../util/check'
import type {
  GPUBufferOptions,
  GPUBufferResource
} from './types'
import { align, resolveBufferUsage, toBytes } from './util'

export function createBufferResource(
  device: GPUDevice,
  options: GPUBufferOptions | number | ArrayBufferView | ArrayBuffer
): GPUBufferResource {
  let data: ArrayBufferView | ArrayBuffer | null = null
  let size = 0
  let usage: GPUBufferOptions['usage'] | undefined
  let label: string | undefined

  if (typeof options === 'number') {
    size = options
  } else if (options instanceof ArrayBuffer || ArrayBuffer.isView(options)) {
    data = options
    size = options.byteLength
  } else {
    data = options.data && typeof options.data !== 'number' ? options.data : null
    size =
      typeof options.data === 'number'
        ? options.data
        : options.size ?? (data ? data.byteLength : 0)
    usage = options.usage
    label = options.label
  }

  check(size >= 0, 'invalid buffer size')
  size = Math.max(4, align(size, 4))
  const flags = resolveBufferUsage(usage, !!data)
  const buffer = device.createBuffer({ size, usage: flags, label })
  if (data) {
    let source = toBytes(data)
    if (source.byteLength % 4 !== 0) {
      const padded = new Uint8Array(align(source.byteLength, 4))
      padded.set(source)
      source = padded
    }
    device.queue.writeBuffer(buffer, 0, source as GPUAllowSharedBufferSource)
  }

  return {
    _gpuType: 'buffer',
    buffer,
    size,
    usage: flags,
    write(input, offset = 0) {
      check(
        (flags & GPUBufferUsage.COPY_DST) !== 0,
        'buffer was not created with COPY_DST'
      )
      check(offset % 4 === 0, 'buffer write offset must be a multiple of 4')
      check(
        toBytes(input).byteLength % 4 === 0,
        'buffer write size must be a multiple of 4'
      )
      device.queue.writeBuffer(
        buffer,
        offset,
        input as GPUAllowSharedBufferSource
      )
    },
    destroy() {
      buffer.destroy()
    }
  }
}
