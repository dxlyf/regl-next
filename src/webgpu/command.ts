/**
 * WGSL-first 的 regl 风格命令层。
 *
 * WebGPU 没有「全局 uniforms」：uniform 只是 bind group 里的 uniform buffer binding。
 * 因此命令层直接接受显式 `bindings`：
 *
 *   bindings: [
 *     { binding: 0, kind: 'uniform', resource: cameraBuffer },
 *     { binding: 1, kind: 'texture', resource: texture },
 *     { binding: 2, kind: 'sampler', resource: sampler }
 *   ]
 *
 * attribute 按对象键顺序对应 @location(0..n)。
 */

import { check } from '../util/check'
import { createBufferResource } from './buffer'
import {
  createBindGroupResource,
  createPipelineResource
} from './pipeline'
import type {
  GPUBindGroupResource,
  GPUBindingSpec,
  GPUBufferResource,
  GPUCommand,
  GPUCommandAttribute,
  GPUCommandBinding,
  GPUCommandOptions,
  GPUCommandProps,
  GPUPass,
  GPUPipelineResource,
  GPUVertexAttributeSpec,
  GPURenderOptions
} from './types'

function vertexFormat(
  type: GPUCommandAttribute['type'],
  size: number
): GPUVertexFormat {
  const suffix = `x${size}`
  switch (type || 'float32') {
    case 'float32':
      return `float32${suffix}` as GPUVertexFormat
    case 'float16':
      return `float16${suffix}` as GPUVertexFormat
    case 'int32':
      return `sint32${suffix}` as GPUVertexFormat
    case 'uint32':
      return `uint32${suffix}` as GPUVertexFormat
    case 'int16':
      return `sint16${suffix}` as GPUVertexFormat
    case 'uint16':
      return `uint16${suffix}` as GPUVertexFormat
    case 'int8':
      return `sint8${suffix}` as GPUVertexFormat
    case 'uint8':
      return `uint8${suffix}` as GPUVertexFormat
    case 'unorm8':
      return `unorm8${suffix}` as GPUVertexFormat
    case 'snorm8':
      return `snorm8${suffix}` as GPUVertexFormat
    case 'unorm16':
      return `unorm16${suffix}` as GPUVertexFormat
    case 'snorm16':
      return `snorm16${suffix}` as GPUVertexFormat
    default:
      return `float32${suffix}` as GPUVertexFormat
  }
}

function typeByteSize(type: GPUCommandAttribute['type']): number {
  switch (type || 'float32') {
    case 'float16':
    case 'int16':
    case 'uint16':
    case 'unorm16':
    case 'snorm16':
      return 2
    case 'int8':
    case 'uint8':
    case 'unorm8':
    case 'snorm8':
      return 1
    default:
      return 4
  }
}

function flattenAttributeData(
  data: ArrayBufferView | number[] | number[][]
): { data: ArrayBufferView | number[]; size: number } {
  if (ArrayBuffer.isView(data)) {
    return { data, size: 0 }
  }
  const first = data[0]
  if (Array.isArray(first)) {
    const rows = data as number[][]
    const size = rows[0].length
    const out: number[] = []
    for (const row of rows) {
      for (let i = 0; i < size; ++i) out.push(row[i] || 0)
    }
    return { data: out, size }
  }
  return { data: data as number[], size: 0 }
}

function buildAttributes(
  device: GPUDevice,
  attributes: GPUCommandOptions['attributes']
): {
  specs: GPUVertexAttributeSpec[]
  buffers: GPUBufferResource[]
  owned: GPUBufferResource[]
} {
  const specs: GPUVertexAttributeSpec[] = []
  const buffers: GPUBufferResource[] = []
  const owned: GPUBufferResource[] = []
  if (!attributes) return { specs, buffers, owned }

  let location = 0
  for (const name of Object.keys(attributes)) {
    const input = attributes[name]
    let spec: GPUCommandAttribute
    if (ArrayBuffer.isView(input) || Array.isArray(input)) {
      spec = { data: input as ArrayBufferView | number[] }
    } else {
      spec = input as GPUCommandAttribute
    }
    check(
      !!(spec.buffer || spec.data),
      `attribute "${name}" requires data or buffer`
    )
    let buffer = spec.buffer
    if (!buffer) {
      const flattened = flattenAttributeData(
        spec.data as ArrayBufferView | number[] | number[][]
      )
      const size = spec.size || flattened.size || 1
      const data =
        flattened.size === 0 ? flattened.data : (flattened.data as number[])
      buffer = createBufferResource(device, {
        data: ArrayBuffer.isView(data)
          ? data
          : new Float32Array(data as number[]),
        usage: ['vertex']
      })
      owned.push(buffer)
      spec = { ...spec, size: size as 1 | 2 | 3 | 4 }
    }
    const size = (spec.size || 1) as 1 | 2 | 3 | 4
    const format = spec.format || vertexFormat(spec.type, size)
    const stride = spec.stride || size * typeByteSize(spec.type)
    const index = buffers.length
    buffers.push(buffer)
    specs.push({
      format,
      buffer: index,
      offset: spec.offset || 0,
      stride,
      shaderLocation: spec.shaderLocation ?? location,
      stepMode: spec.divisor ? 'instance' : 'vertex'
    })
    location = Math.max(location, (spec.shaderLocation ?? location) + 1)
  }
  return { specs, buffers, owned }
}

function bindingSpecs(bindings: GPUCommandBinding[]): GPUBindingSpec[] {
  return bindings.map((binding) => ({
    binding: binding.binding,
    group: binding.group,
    kind: binding.kind,
    visibility: binding.visibility,
    viewDimension: binding.viewDimension,
    textureSampleType: binding.textureSampleType,
    samplerType: binding.samplerType,
    storageTextureFormat: binding.storageTextureFormat,
    dynamicOffset: binding.dynamicOffset,
    minBindingSize: binding.size
  }))
}

export function createCommand(
  device: GPUDevice,
  options: GPUCommandOptions,
  render: (
    options: GPURenderOptions,
    callback: (pass: GPUPass) => void
  ) => void,
  defaultFormat: GPUTextureFormat = 'rgba8unorm'
): GPUCommand {
  const code =
    options.code ||
    [options.vert, options.frag].filter((part) => !!part).join('\n')
  const attributes = buildAttributes(device, options.attributes)
  const bindings = options.bindings || []

  let pipeline: GPUPipelineResource
  if (options.pipeline) {
    pipeline = options.pipeline
  } else {
    check(!!code, 'command requires WGSL code or an existing pipeline')
    pipeline = createPipelineResource(device, {
      code,
      vertexEntry: options.vertexEntry,
      fragmentEntry: options.fragmentEntry,
      attributes: attributes.specs,
      bindings: bindingSpecs(bindings),
      targets: options.targets,
      format: options.format || defaultFormat,
      depth: options.depth,
      primitive: options.primitive,
      multisample: options.multisample,
      label: options.label
    })
  }

  const bindGroups: GPUBindGroupResource[] = []
  if (options.bindGroups) bindGroups.push(...options.bindGroups)
  if (options.bindGroup && !bindGroups.some((entry) => entry.group === 0)) {
    bindGroups.push(options.bindGroup)
  }
  if (!options.bindGroup && !options.bindGroups && bindings.length > 0) {
    const groups = new Map<number, typeof bindings>()
    for (const binding of bindings) {
      const group = binding.group || 0
      const list = groups.get(group)
      if (list) list.push(binding)
      else groups.set(group, [binding])
    }
    for (const [group, groupBindings] of groups) {
      bindGroups.push(
        createBindGroupResource(
          device,
          pipeline,
          groupBindings.map((binding) => ({
            binding: binding.binding,
            group: binding.group,
            resource: binding.resource,
            offset: binding.offset,
            size: binding.size,
            dynamicOffset: binding.dynamicOffset
          })),
          group
        )
      )
    }
  }
  bindGroups.sort((a, b) => a.group - b.group)
  const bindGroup = bindGroups.find((entry) => entry.group === 0) || null

  const draw = (pass: GPUPass, props: GPUCommandProps = {}): void => {
    const indirect = props.indirectBuffer || options.indirectBuffer
    const count = (props.count ?? options.count ?? 0) as number
    check(
      count > 0 || !!indirect,
      'command requires a positive count or an indirect buffer'
    )
    pass.draw({
      pipeline,
      bindGroup: bindGroup || undefined,
      bindGroups,
      dynamicOffsets: props.dynamicOffsets,
      vertexBuffers: attributes.buffers,
      indexBuffer: props.indexBuffer || options.indexBuffer,
      indirect,
      count,
      instances: (props.instances ?? options.instances ?? 1) as number
    })
  }

  const command = ((props: GPUCommandProps = {}) => {
    render({ clearColor: false }, (pass) => draw(pass, props))
  }) as GPUCommand
  Object.defineProperties(command, {
    pipeline: { value: pipeline, enumerable: true },
    bindGroup: { value: bindGroup, enumerable: true },
    bindGroups: { value: bindGroups, enumerable: true }
  })
  command.draw = (pass: GPUPass, props?: GPUCommandProps) => draw(pass, props)
  command.destroy = () => {
    for (const buffer of attributes.owned) buffer.destroy()
  }
  return command
}
