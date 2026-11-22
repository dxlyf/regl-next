/** WebGPU pipeline 与 bind group。 */

import { check } from '../util/check'
import type {
  GPUBindGroupEntry as GPUBindGroupEntrySpec,
  GPUBindGroupResource,
  GPUBindingSpec,
  GPUPipelineOptions,
  GPUPipelineResource,
  GPUVertexAttributeSpec
} from './types'
import {
  align,
  isBufferResource,
  isSamplerResource,
  isTextureResource
} from './util'

function formatComponentSize(format: GPUVertexFormat): number {
  if (
    format.startsWith('float32') ||
    format.startsWith('uint32') ||
    format.startsWith('sint32')
  ) {
    return 4
  }
  if (
    format.startsWith('float16') ||
    format.startsWith('uint16') ||
    format.startsWith('sint16')
  ) {
    return 2
  }
  if (
    format.startsWith('unorm8') ||
    format.startsWith('snorm8') ||
    format.startsWith('uint8') ||
    format.startsWith('sint8')
  ) {
    return 1
  }
  return 4
}

function vertexFormatSize(format: GPUVertexFormat): number {
  if (format.endsWith('x2')) return 2 * formatComponentSize(format)
  if (format.endsWith('x3')) return 3 * formatComponentSize(format)
  if (format.endsWith('x4')) return 4 * formatComponentSize(format)
  return formatComponentSize(format)
}

function buildVertexLayouts(
  attributes: GPUVertexAttributeSpec[]
): GPUVertexBufferLayout[] {
  let location = 0
  const groups = new Map<number, GPUVertexAttributeSpec[]>()
  for (const attribute of attributes) {
    const spec: GPUVertexAttributeSpec = {
      ...attribute,
      shaderLocation: attribute.shaderLocation ?? location
    }
    location = Math.max(location, spec.shaderLocation! + 1)
    const slot = spec.buffer || 0
    const group = groups.get(slot)
    if (group) group.push(spec)
    else groups.set(slot, [spec])
  }

  const slots = Array.from(groups.keys()).sort((a, b) => a - b)
  const layouts: GPUVertexBufferLayout[] = []
  for (let i = 0; i < slots.length; ++i) {
    check(slots[i] === i, 'vertex buffer slots must be contiguous from 0')
    const group = groups.get(slots[i])!
    let stride = group.find((a) => a.stride)?.stride || 0
    if (!stride) {
      for (const attribute of group) {
        stride = Math.max(
          stride,
          (attribute.offset || 0) + vertexFormatSize(attribute.format)
        )
      }
    }
    layouts.push({
      arrayStride: align(Math.max(4, stride), 4),
      stepMode: group[0].stepMode || 'vertex',
      attributes: group.map((attribute) => ({
        shaderLocation: attribute.shaderLocation!,
        offset: attribute.offset || 0,
        format: attribute.format
      }))
    })
  }
  return layouts
}

export function buildBindGroupLayout(
  device: GPUDevice,
  specs: GPUBindingSpec[]
): GPUBindGroupLayout {
  const entries: GPUBindGroupLayoutEntry[] = specs.map((spec) => {
    const entry: GPUBindGroupLayoutEntry = {
      binding: spec.binding,
      visibility:
        spec.visibility ??
        (GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT)
    }
    switch (spec.kind) {
      case 'uniform':
        entry.buffer = {
          type: 'uniform',
          hasDynamicOffset: !!spec.dynamicOffset,
          minBindingSize: spec.minBindingSize || 0
        }
        break
      case 'storage':
        entry.buffer = {
          type: 'storage',
          hasDynamicOffset: !!spec.dynamicOffset,
          minBindingSize: spec.minBindingSize || 0
        }
        break
      case 'read-only-storage':
        entry.buffer = {
          type: 'read-only-storage',
          hasDynamicOffset: !!spec.dynamicOffset,
          minBindingSize: spec.minBindingSize || 0
        }
        break
      case 'texture':
        entry.texture = {
          sampleType: spec.textureSampleType || 'float',
          viewDimension: spec.viewDimension || '2d',
          multisampled: false
        }
        break
      case 'storage-texture':
        entry.storageTexture = {
          access: 'write-only',
          format: spec.storageTextureFormat || 'rgba8unorm',
          viewDimension: spec.viewDimension || '2d'
        }
        break
      case 'sampler':
        entry.sampler = { type: spec.samplerType || 'filtering' }
        break
      case 'comparison-sampler':
        entry.sampler = { type: spec.samplerType || 'comparison' }
        break
    }
    return entry
  })
  return device.createBindGroupLayout({ entries })
}

export function createPipelineResource(
  device: GPUDevice,
  options: GPUPipelineOptions
): GPUPipelineResource {
  check(
    typeof options.code === 'string' && options.code.length > 0,
    'pipeline requires WGSL code'
  )
  const module = device.createShaderModule({
    code: options.code,
    label: options.label
  })
  const bindings = options.bindings || []
  const grouped = new Map<number, GPUBindingSpec[]>()
  let maxGroup = 0
  for (const binding of bindings) {
    const group = binding.group || 0
    maxGroup = Math.max(maxGroup, group)
    const list = grouped.get(group)
    if (list) list.push(binding)
    else grouped.set(group, [binding])
  }
  const bindGroupLayouts: GPUBindGroupLayout[] = []
  for (let group = 0; group <= maxGroup; ++group) {
    bindGroupLayouts.push(
      buildBindGroupLayout(device, grouped.get(group) || [])
    )
  }
  const bindGroupLayout = bindGroupLayouts[0]
  const layout = device.createPipelineLayout({
    bindGroupLayouts
  })
  const layouts = buildVertexLayouts(options.attributes || [])
  const targets = options.targets || [
    { format: options.format || 'rgba8unorm' }
  ]
  const pipeline = device.createRenderPipeline({
    layout,
    vertex: {
      module,
      entryPoint: options.vertexEntry || 'vs_main',
      buffers: layouts
    },
    fragment: {
      module,
      entryPoint: options.fragmentEntry || 'fs_main',
      targets
    },
    primitive: options.primitive || { topology: 'triangle-list' },
    depthStencil: options.depth === false ? undefined : options.depth,
    multisample: options.multisample || { count: 1 },
    label: options.label
  })
  return {
    _gpuType: 'pipeline',
    pipeline,
    bindGroupLayout,
    bindGroupLayouts,
    layout,
    bindings,
    attributes: options.attributes || [],
    label: options.label
  }
}

export function createBindGroupResource(
  device: GPUDevice,
  pipeline: GPUPipelineResource,
  entries: GPUBindGroupEntrySpec[],
  group = 0
): GPUBindGroupResource {
  const specs = new Map<number, GPUBindingSpec>()
  for (const spec of pipeline.bindings) {
    if ((spec.group || 0) === group) specs.set(spec.binding, spec)
  }
  const resources = new Map(
    entries
      .filter((entry) => (entry.group || 0) === group)
      .map((entry) => [entry.binding, entry])
  )
  const dynamicBindings = pipeline.bindings
    .filter(
      (spec) =>
        (spec.group || 0) === group &&
        !!spec.dynamicOffset &&
        (spec.kind === 'uniform' ||
          spec.kind === 'storage' ||
          spec.kind === 'read-only-storage')
    )
    .map((spec) => spec.binding)
  const gpuEntries: Array<{
    binding: number
    resource: GPUSampler | GPUTextureView | GPUBufferBinding
  }> = []
  for (const spec of specs.values()) {
    const entry = resources.get(spec.binding)
    check(!!entry, `missing bind group entry ${spec.binding}`)
    const value = entry!.resource
    resources.delete(spec.binding)
    if (
      spec.kind === 'uniform' ||
      spec.kind === 'storage' ||
      spec.kind === 'read-only-storage'
    ) {
      check(
        isBufferResource(value),
        `binding ${spec.binding} requires a buffer`
      )
      gpuEntries.push({
        binding: spec.binding,
        resource: {
          buffer: value.buffer,
          offset: spec.dynamicOffset ? 0 : entry!.offset,
          size: entry!.size
        }
      })
    } else if (spec.kind === 'texture' || spec.kind === 'storage-texture') {
      check(
        isTextureResource(value),
        `binding ${spec.binding} requires a texture`
      )
      gpuEntries.push({
        binding: spec.binding,
        resource: value.view
      })
    } else {
      check(
        isSamplerResource(value),
        `binding ${spec.binding} requires a sampler`
      )
      gpuEntries.push({
        binding: spec.binding,
        resource: value.sampler
      })
    }
  }
  check(resources.size === 0, 'bind group contains unknown bindings')
  const bindGroup = device.createBindGroup({
    layout: pipeline.bindGroupLayouts[group],
    entries: gpuEntries
  })
  return {
    _gpuType: 'bind-group',
    bindGroup,
    pipeline,
    group,
    dynamicBindings,
    destroy() {}
  }
}
