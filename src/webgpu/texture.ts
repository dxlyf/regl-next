/** WebGPU texture 资源与上传。 */

import { check } from '../util/check'
import type {
  GPUTextureOptions,
  GPUTextureResource
} from './types'
import {
  align,
  bytesPerPixel,
  DEPTH_FORMATS,
  resolveTextureUsage,
  toBytes
} from './util'

/**
 * 上传一层或多层紧凑排列的数据。
 * WebGPU 要求 bytesPerRow 按 256 对齐，因此这里负责逐行 / 逐层重排。
 */
function uploadTextureData(
  device: GPUDevice,
  texture: GPUTexture,
  data: ArrayBufferView,
  width: number,
  height: number,
  layers: number,
  format: GPUTextureFormat,
  originZ = 0
): void {
  const bpp = bytesPerPixel(format)
  check(bpp > 0, `unsupported texture upload format "${format}"`)
  const rowBytes = width * bpp
  const bytesPerRow = align(rowBytes, 256)
  const rowsPerImage = height
  const source = toBytes(data)
  check(
    source.byteLength >= rowBytes * height * layers,
    'texture data is smaller than width * height * layers * bytesPerPixel'
  )

  let packed: Uint8Array
  if (bytesPerRow === rowBytes) {
    packed = source.subarray(0, rowBytes * height * layers)
  } else {
    packed = new Uint8Array(bytesPerRow * height * layers)
    for (let layer = 0; layer < layers; ++layer) {
      for (let y = 0; y < height; ++y) {
        const src = (layer * height + y) * rowBytes
        const dst = (layer * height + y) * bytesPerRow
        packed.set(source.subarray(src, src + rowBytes), dst)
      }
    }
  }

  device.queue.writeTexture(
    { texture, origin: { x: 0, y: 0, z: originZ } },
    packed as GPUAllowSharedBufferSource,
    { bytesPerRow, rowsPerImage },
    { width, height, depthOrArrayLayers: layers }
  )
}

export function createTextureResource(
  device: GPUDevice,
  options: GPUTextureOptions
): GPUTextureResource {
  const format = options.format || 'rgba8unorm'
  const width = options.width | 0
  const height = options.height | 0
  check(width > 0 && height > 0, 'invalid texture size')
  const faces = options.faces
  if (faces) check(faces.length === 6, 'cube texture requires exactly 6 faces')
  const layers = faces
    ? 6
    : options.depthOrArrayLayers ||
      options.depth ||
      options.layers ||
      1
  const dimension: GPUTextureDimension =
    options.dimension === '3d' ? '3d' : '2d'
  check(!(faces && dimension === '3d'), 'cube textures must be 2D')
  const viewDimension: GPUTextureViewDimension =
    options.viewDimension ||
    (dimension === '3d'
      ? '3d'
      : faces
        ? 'cube'
        : layers > 1
          ? '2d-array'
          : '2d')
  const hasData = !!options.data || !!options.image || !!faces
  const usage = resolveTextureUsage(options.usage, format, hasData)
  const texture = device.createTexture({
    size: { width, height, depthOrArrayLayers: layers },
    dimension,
    format,
    usage,
    sampleCount: options.sampleCount || 1,
    mipLevelCount: options.mipLevelCount || 1,
    label: options.label
  })

  if (faces) {
    for (let face = 0; face < 6; ++face) {
      uploadTextureData(
        device,
        texture,
        faces[face],
        width,
        height,
        1,
        format,
        face
      )
    }
  } else if (options.data) {
    uploadTextureData(
      device,
      texture,
      options.data,
      width,
      height,
      layers,
      format
    )
  } else if (options.image) {
    check(layers === 1, 'external images can only upload a single layer')
    device.queue.copyExternalImageToTexture(
      { source: options.image },
      { texture },
      { width, height }
    )
  }

  const aspect = DEPTH_FORMATS.has(format) ? 'depth-only' : 'all'
  const view = texture.createView({
    format,
    aspect,
    dimension: viewDimension,
    baseMipLevel: 0,
    mipLevelCount: options.mipLevelCount || 1,
    baseArrayLayer: 0,
    arrayLayerCount:
      viewDimension === 'cube' ? 6 : viewDimension === '3d' ? 1 : layers
  })

  return {
    _gpuType: 'texture',
    texture,
    view,
    width,
    height,
    depthOrArrayLayers: layers,
    dimension,
    viewDimension,
    format,
    sampleCount: options.sampleCount || 1,
    layerView(layer: number, mipLevel = 0) {
      check(
        dimension !== '3d',
        'cannot create a 2D layer view of a 3D texture'
      )
      check(layer >= 0 && layer < layers, 'invalid texture layer')
      return texture.createView({
        format,
        aspect,
        dimension: '2d',
        baseMipLevel: mipLevel,
        mipLevelCount: 1,
        baseArrayLayer: layer,
        arrayLayerCount: 1
      })
    },
    upload(data: ArrayBufferView, mipLevel = 0) {
      check(mipLevel === 0, 'pooled texture upload currently supports mip 0 only')
      uploadTextureData(
        device,
        texture,
        data,
        width,
        height,
        layers,
        format
      )
    },
    uploadFace(face: number, data: ArrayBufferView, mipLevel = 0) {
      check(layers === 6, 'uploadFace is only valid for cube textures')
      check(face >= 0 && face < 6, 'invalid cube face')
      check(mipLevel === 0, 'pooled texture upload currently supports mip 0 only')
      uploadTextureData(
        device,
        texture,
        data,
        width,
        height,
        1,
        format,
        face
      )
    },
    destroy() {
      texture.destroy()
    }
  }
}
