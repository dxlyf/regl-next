/** createWEBGPU / createGPU 的上下文实现。 */

import { check } from '../util/check'
import { createBufferResource } from './buffer'
import { createCommand } from './command'
import { createCompute } from './compute'
import { createFramePool } from './framepool'
import { createResourcePool } from './pool'
import { createScope } from './scope'
import { createQuerySet, resolveQuerySet } from './query'
import { createBindGroupResource, createPipelineResource } from './pipeline'
import { readBuffer, readTexture } from './readback'
import { renderPass } from './render'
import { createSamplerResource } from './sampler'
import { createTextureResource } from './texture'
import type {
  GPUBufferResource,
  GPUBindGroupEntry,
  GPUBindGroupResource,
  GPUCommandOptions,
  GPUCompute,
  GPUComputeOptions,
  GPUPipelineOptions,
  GPUPipelineResource,
  GPUPoolOptions,
  GPUResourcePool,
  GPUFramePool,
  GPUPass,
  GPURenderOptions,
  GPUScope,
  GPUBatch,
  GPUQuerySetOptions,
  GPUQuerySetResource,
  GPUResolveQuerySetOptions,
  GPUSamplerOptions,
  GPUSamplerResource,
  GPUTextureOptions,
  GPUTextureResource,
  WEBGPU,
  WEBGPUOptions
} from './types'

function resolveCanvas(options: WEBGPUOptions): HTMLCanvasElement | null {
  if (options.canvas) return options.canvas
  if (options.context) return options.context.canvas as HTMLCanvasElement
  if (!options.container) return null
  check(
    typeof document !== 'undefined',
    'container requires a DOM environment'
  )
  const parent =
    typeof options.container === 'string'
      ? document.querySelector(options.container)
      : options.container
  check(!!parent, 'invalid WebGPU container')
  const canvas = document.createElement('canvas')
  canvas.width = options.width || 300
  canvas.height = options.height || 150
  ;(parent as HTMLElement).appendChild(canvas)
  return canvas
}

export async function createWEBGPU(
  options: WEBGPUOptions = {}
): Promise<WEBGPU> {
  check(!!navigator.gpu, 'WebGPU is not available in this browser')
  const adapter = options.adapter || (await navigator.gpu.requestAdapter())
  check(!!adapter, 'WebGPU adapter is not available')
  const device =
    options.device ||
    (await adapter!.requestDevice({
      requiredFeatures: options.features
    }))
  const canvas = resolveCanvas(options)
  const context =
    options.context || (canvas ? canvas.getContext('webgpu') : null)
  const format =
    options.format ||
    (context ? navigator.gpu.getPreferredCanvasFormat() : 'rgba8unorm')
  if (context) {
    context.configure({
      device,
      format,
      alphaMode: options.alphaMode || 'premultiplied'
    })
  }

  const render = (
    renderOptions: GPURenderOptions,
    callback: (pass: GPUPass) => void
  ): void => renderPass(device, context, renderOptions, callback)

  const pipelineCache = new Map<string, GPUPipelineResource>()
  const pools = new Set<GPUResourcePool>()
  const framePools = new Set<GPUFramePool>()

  const api = ((commandOptions: GPUCommandOptions) =>
    createCommand(device, commandOptions, render, format)) as WEBGPU

  Object.assign(api, {
    _gpuType: 'context',
    device,
    adapter: adapter!,
    context,
    canvas,
    format,
    limits: device.limits,
    command(commandOptions: GPUCommandOptions) {
      return createCommand(device, commandOptions, render, format)
    },
    compute(computeOptions: GPUComputeOptions): GPUCompute {
      return createCompute(device, computeOptions)
    },
    scope(
      scopeOptions: GPURenderOptions = {},
      callback?: (scope: GPUScope) => void
    ): GPUScope {
      const scope = createScope(device, context, scopeOptions)
      if (callback) {
        try {
          callback(scope)
        } finally {
          scope.end()
        }
      }
      return scope
    },
    batch(
      renderOptions: GPURenderOptions,
      callback: (batch: GPUBatch) => void
    ): void {
      const scope = createScope(device, context, renderOptions)
      try {
        callback({
          draw(command, props) {
            scope.draw(command, props)
          }
        })
      } finally {
        scope.end()
      }
    },
    pool(poolOptions?: GPUPoolOptions): GPUResourcePool {
      const pool = createResourcePool(device, poolOptions)
      pools.add(pool)
      return pool
    },
    framePool(poolOptions?: GPUPoolOptions): GPUFramePool {
      const framePool = createFramePool(device, poolOptions)
      framePools.add(framePool)
      return framePool
    },
    querySet(queryOptions?: GPUQuerySetOptions): GPUQuerySetResource {
      return createQuerySet(device, queryOptions)
    },
    resolveQuerySet(resolveOptions: GPUResolveQuerySetOptions): void {
      resolveQuerySet(device, resolveOptions)
    },
    frame(callback: (info: import('./types').WEBGPUFrameInfo) => void) {
      let active = true
      let handle = 0
      const loop = (time: number): void => {
        if (!active) return
        callback({
          time: time * 0.001,
          width: canvas?.width || 0,
          height: canvas?.height || 0,
          pixelRatio:
            typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
        })
        handle = requestAnimationFrame(loop)
      }
      handle = requestAnimationFrame(loop)
      return {
        cancel() {
          active = false
          cancelAnimationFrame(handle)
        }
      }
    },
    buffer(input?: GPUBufferOptionsLike) {
      return createBufferResource(device, input ?? 4)
    },
    texture(textureOptions: GPUTextureOptions): GPUTextureResource {
      return createTextureResource(device, textureOptions)
    },
    sampler(samplerOptions?: GPUSamplerOptions): GPUSamplerResource {
      return createSamplerResource(device, samplerOptions)
    },
    pipeline(pipelineOptions: GPUPipelineOptions): GPUPipelineResource {
      const key = JSON.stringify(pipelineOptions)
      let pipeline = pipelineCache.get(key)
      if (!pipeline) {
        pipeline = createPipelineResource(device, pipelineOptions)
        pipelineCache.set(key, pipeline)
      }
      return pipeline
    },
    clearPipelineCache(): void {
      pipelineCache.clear()
    },
    bindGroup(
      pipeline: GPUPipelineResource,
      entries: GPUBindGroupEntry[],
      group = 0
    ): GPUBindGroupResource {
      return createBindGroupResource(device, pipeline, entries, group)
    },
    render,
    readTexture(
      texture: GPUTextureResource,
      readOptions?: import('./types').GPUReadTextureOptions
    ): Promise<Uint8Array> {
      return readTexture(device, texture, readOptions)
    },
    readBuffer(
      buffer: GPUBufferResource,
      readOptions?: import('./types').GPUReadBufferOptions
    ): Promise<Uint8Array> {
      return readBuffer(device, buffer, readOptions)
    },
    destroy(): void {
      pipelineCache.clear()
      for (const pool of pools) pool.destroy()
      pools.clear()
      for (const framePool of framePools) framePool.destroy()
      framePools.clear()
      context?.unconfigure()
      device.destroy()
    }
  })
  return api
}

type GPUBufferOptionsLike =
  | import('./types').GPUBufferOptions
  | number
  | ArrayBufferView
  | ArrayBuffer

/** 兼容旧名称。 */
export const createGPU = createWEBGPU

export type {
  GPUBufferResource,
  GPUBindGroupResource,
  GPUPipelineResource,
  GPUTextureResource
}
