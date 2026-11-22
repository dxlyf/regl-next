/** WebGPU sampler 资源。 */

import type {
  GPUSamplerOptions,
  GPUSamplerResource
} from './types'

export function createSamplerResource(
  device: GPUDevice,
  options: GPUSamplerOptions = {}
): GPUSamplerResource {
  const sampler = device.createSampler({
    addressModeU: options.addressModeU || 'clamp-to-edge',
    addressModeV: options.addressModeV || 'clamp-to-edge',
    addressModeW: options.addressModeW || 'clamp-to-edge',
    magFilter: options.magFilter || 'nearest',
    minFilter: options.minFilter || 'nearest',
    mipmapFilter: options.mipmapFilter || 'nearest',
    lodMinClamp: options.lodMinClamp ?? 0,
    lodMaxClamp: options.lodMaxClamp ?? 32,
    compare: options.compare,
    maxAnisotropy: options.maxAnisotropy || 1,
    label: options.label
  })
  return {
    _gpuType: 'sampler',
    sampler,
    destroy() {}
  }
}
