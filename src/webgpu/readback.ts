/** WebGPU 纹理异步回读。 */

import { check } from '../util/check'
import type {
  GPUBufferResource,
  GPUReadBufferOptions,
  GPUReadTextureOptions,
  GPUTextureResource
} from './types'
import { align, bytesPerPixel } from './util'

export async function readBuffer(
  device: GPUDevice,
  buffer: GPUBufferResource,
  options: GPUReadBufferOptions = {}
): Promise<Uint8Array> {
  const offset = (options.offset || 0) | 0
  const size = (options.size || buffer.size - offset) | 0
  check(offset >= 0 && size > 0, 'invalid buffer read range')
  check(offset + size <= buffer.size, 'buffer read out of bounds')
  const alignedSize = align(size, 4)
  const staging = device.createBuffer({
    size: alignedSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })
  const encoder = device.createCommandEncoder()
  encoder.copyBufferToBuffer(buffer.buffer, offset, staging, 0, size)
  device.queue.submit([encoder.finish()])
  await staging.mapAsync(GPUMapMode.READ)
  const mapped = new Uint8Array(staging.getMappedRange())
  const result = mapped.slice(0, size)
  staging.unmap()
  staging.destroy()
  return result
}

export async function readTexture(
  device: GPUDevice,
  texture: GPUTextureResource,
  options: GPUReadTextureOptions = {}
): Promise<Uint8Array> {
  const bpp = bytesPerPixel(texture.format)
  check(
    bpp === 4,
    'readTexture currently supports 4-byte color formats only'
  )
  const mipLevel = (options.mipLevel || 0) | 0
  check(mipLevel >= 0, 'invalid mip level')
  const layer = options.layer
  const hasLayer = layer !== undefined
  if (hasLayer) {
    check(
      layer! >= 0 && layer! < texture.depthOrArrayLayers,
      'invalid texture layer'
    )
  }
  const layers = hasLayer ? 1 : texture.depthOrArrayLayers
  const width = Math.max(1, texture.width >> mipLevel)
  const height = Math.max(1, texture.height >> mipLevel)
  const bytesPerRow = align(width * bpp, 256)
  const staging = device.createBuffer({
    size: bytesPerRow * height * layers,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer(
    {
      texture: texture.texture,
      mipLevel,
      origin: {
        x: 0,
        y: 0,
        z: hasLayer ? layer! : 0
      }
    },
    {
      buffer: staging,
      bytesPerRow,
      rowsPerImage: height
    },
    {
      width,
      height,
      depthOrArrayLayers: layers
    }
  )
  device.queue.submit([encoder.finish()])
  await staging.mapAsync(GPUMapMode.READ)
  const source = new Uint8Array(staging.getMappedRange())
  const result = new Uint8Array(width * height * layers * bpp)
  const rowBytes = width * bpp
  for (let z = 0; z < layers; ++z) {
    for (let y = 0; y < height; ++y) {
      const src = (z * height + y) * bytesPerRow
      const dst = (z * height + y) * rowBytes
      result.set(source.subarray(src, src + rowBytes), dst)
    }
  }
  staging.unmap()
  staging.destroy()
  return result
}
