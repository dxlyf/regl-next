/** WebGPU compute pipeline / dispatch。 */

import { check } from '../util/check'
import { buildBindGroupLayout } from './pipeline'
import type {
  GPUBindingSpec,
  GPUCommandBinding,
  GPUCompute,
  GPUComputeOptions,
  GPUComputePipelineResource
} from './types'
import {
  isBufferResource,
  isSamplerResource,
  isTextureResource
} from './util'

function bindingSpecs(bindings: GPUCommandBinding[]): GPUBindingSpec[] {
  return bindings.map((binding) => ({
    binding: binding.binding,
    group: binding.group,
    kind: binding.kind,
    visibility: binding.visibility ?? GPUShaderStage.COMPUTE,
    viewDimension: binding.viewDimension,
    textureSampleType: binding.textureSampleType,
    samplerType: binding.samplerType,
    storageTextureFormat: binding.storageTextureFormat,
    dynamicOffset: binding.dynamicOffset,
    minBindingSize: binding.size
  }))
}

export function createCompute(
  device: GPUDevice,
  options: GPUComputeOptions
): GPUCompute {
  check(
    typeof options.code === 'string' && options.code.length > 0,
    'compute requires WGSL code'
  )
  const bindings = options.bindings || []
  const specs = bindingSpecs(bindings)
  const module = device.createShaderModule({
    code: options.code,
    label: options.label
  })
  const bindGroupLayouts: GPUBindGroupLayout[] = []
  const grouped = new Map<number, GPUBindingSpec[]>()
  let maxGroup = 0
  for (const spec of specs) {
    const group = spec.group || 0
    maxGroup = Math.max(maxGroup, group)
    const list = grouped.get(group)
    if (list) list.push(spec)
    else grouped.set(group, [spec])
  }
  for (let group = 0; group <= maxGroup; ++group) {
    bindGroupLayouts.push(
      buildBindGroupLayout(device, grouped.get(group) || [])
    )
  }
  const bindGroupLayout = bindGroupLayouts[0]
  const layout = device.createPipelineLayout({
    bindGroupLayouts
  })
  const pipeline: GPUComputePipelineResource = {
    _gpuType: 'compute-pipeline',
    pipeline: device.createComputePipeline({
      layout,
      compute: {
        module,
        entryPoint: options.entryPoint || 'main'
      },
      label: options.label
    }),
    bindGroupLayout,
    bindGroupLayouts,
    layout,
    bindings: specs
  }

  const bindGroups: GPUBindGroup[] = []
  const groups = new Map<number, GPUCommandBinding[]>()
  for (const binding of bindings) {
    const group = binding.group || 0
    const list = groups.get(group)
    if (list) list.push(binding)
    else groups.set(group, [binding])
  }
  for (const [group, groupBindings] of groups) {
    const entries: GPUBindGroupEntry[] = groupBindings.map((binding) => {
      const resource = binding.resource
      if (
        binding.kind === 'uniform' ||
        binding.kind === 'storage' ||
        binding.kind === 'read-only-storage'
      ) {
        check(
          isBufferResource(resource),
          `binding ${binding.binding} requires a buffer`
        )
        return {
          binding: binding.binding,
          resource: {
            buffer: resource.buffer,
            offset: binding.dynamicOffset ? 0 : binding.offset,
            size: binding.size
          }
        }
      }
      if (
        binding.kind === 'texture' ||
        binding.kind === 'storage-texture'
      ) {
        check(
          isTextureResource(resource),
          `binding ${binding.binding} requires a texture`
        )
        return {
          binding: binding.binding,
          resource: resource.view
        }
      }
      check(
        isSamplerResource(resource),
        `binding ${binding.binding} requires a sampler`
      )
      return {
        binding: binding.binding,
        resource: resource.sampler
      }
    })
    bindGroups[group] = device.createBindGroup({
      layout: bindGroupLayouts[group],
      entries
    })
  }
  const bindGroup = bindGroups[0] || null

  const dispatch = (): void => {
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline.pipeline)
    for (let group = 0; group < bindGroups.length; ++group) {
      const bg = bindGroups[group]
      if (bg) {
        pass.setBindGroup(group, bg, options.dynamicOffsets?.[group])
      }
    }
    if (options.indirectBuffer) {
      pass.dispatchWorkgroupsIndirect(
        options.indirectBuffer.buffer.buffer,
        options.indirectBuffer.offset || 0
      )
    } else {
      const raw = options.workgroupCount ?? [1, 1, 1]
      const count: [number, number, number] =
        typeof raw === 'number' ? [raw, 1, 1] : raw
      pass.dispatchWorkgroups(count[0], count[1], count[2])
    }
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  const compute = dispatch as GPUCompute
  Object.defineProperties(compute, {
    pipeline: { value: pipeline, enumerable: true },
    bindGroup: { value: bindGroup, enumerable: true },
    bindGroups: { value: bindGroups, enumerable: true }
  })
  compute.destroy = () => {}
  return compute
}
