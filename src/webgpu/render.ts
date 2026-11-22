/** WebGPU render pass 录制。 */

import { check } from '../util/check'
import type {
  GPUClearColor,
  GPUDrawOptions,
  GPUPass,
  GPURenderOptions
} from './types'
import { isBufferResource, isTextureResource } from './util'

function normalizeColor(color: GPUClearColor): GPUColor {
  if (Array.isArray(color)) {
    return { r: color[0], g: color[1], b: color[2], a: color[3] }
  }
  return color
}

export interface GPURenderPassHandle {
  pass: GPUPass
  end(): void
}

export function beginRenderPass(
  device: GPUDevice,
  context: GPUCanvasContext | null,
  options: GPURenderOptions
): GPURenderPassHandle {
  const encoder = device.createCommandEncoder({ label: options.label })
  const views: GPUTextureView[] = []
  if (options.color === undefined) {
    check(!!context, 'render() without a canvas requires a color target')
    views.push(context!.getCurrentTexture().createView())
  } else if (Array.isArray(options.color)) {
    for (const target of options.color) {
      views.push(isTextureResource(target) ? target.view : target)
    }
  } else {
    views.push(
      isTextureResource(options.color) ? options.color.view : options.color
    )
  }

  const clearColor =
    options.clearColor === false
      ? null
      : normalizeColor(options.clearColor || [0, 0, 0, 1])
  const resolveViews: GPUTextureView[] = []
  if (options.resolve) {
    check(
      options.color !== undefined,
      'MSAA resolve requires an explicit color target'
    )
    const targets = Array.isArray(options.resolve)
      ? options.resolve
      : [options.resolve]
    check(
      targets.length === views.length,
      'resolve target count must match color target count'
    )
    for (const target of targets) resolveViews.push(target.view)
  }
  const colorAttachments: GPURenderPassColorAttachment[] = views.map(
    (view, index) => ({
      view,
      resolveTarget: resolveViews[index],
      clearValue: clearColor || undefined,
      loadOp: clearColor ? 'clear' : 'load',
      storeOp: 'store'
    })
  )

  let depthStencilAttachment:
    | GPURenderPassDepthStencilAttachment
    | undefined
  if (options.depth) {
    depthStencilAttachment = {
      view: options.depth.view,
      depthClearValue: options.clearDepth ?? 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store'
    }
  }

  const pass = encoder.beginRenderPass({
    colorAttachments,
    depthStencilAttachment,
    timestampWrites: options.queries?.timestamp
      ? {
          querySet: options.queries.timestamp.querySet.querySet,
          beginningOfPassWriteIndex:
            options.queries.timestamp.beginningOfPassWriteIndex ?? 0,
          endOfPassWriteIndex:
            options.queries.timestamp.endOfPassWriteIndex ?? 1
        }
      : undefined,
    occlusionQuerySet: options.queries?.occlusion
      ? options.queries.occlusion.querySet.querySet
      : undefined
  })
  const occlusion = options.queries?.occlusion
  if (occlusion) {
    pass.beginOcclusionQuery(occlusion.index)
  }
  let ended = false
  const wrapped: GPUPass = {
    draw(drawOptions: GPUDrawOptions) {
      pass.setPipeline(drawOptions.pipeline.pipeline)
      if (drawOptions.bindGroups && drawOptions.bindGroups.length > 0) {
        for (const bindGroup of drawOptions.bindGroups) {
          pass.setBindGroup(
            bindGroup.group,
            bindGroup.bindGroup,
            drawOptions.dynamicOffsets?.[bindGroup.group]
          )
        }
      } else if (drawOptions.bindGroup) {
        pass.setBindGroup(
          0,
          drawOptions.bindGroup.bindGroup,
          drawOptions.dynamicOffsets?.[0]
        )
      }
      const buffers = drawOptions.vertexBuffers || []
      for (let i = 0; i < buffers.length; ++i) {
        const source = buffers[i]
        const buffer = isBufferResource(source)
          ? source.buffer
          : source.buffer.buffer
        const offset = isBufferResource(source) ? 0 : source.offset
        const size = isBufferResource(source) ? undefined : source.size
        pass.setVertexBuffer(i, buffer, offset, size)
      }
      if (drawOptions.indexBuffer) {
        pass.setIndexBuffer(
          drawOptions.indexBuffer.buffer.buffer,
          drawOptions.indexBuffer.format,
          drawOptions.indexBuffer.offset || 0,
          drawOptions.indexBuffer.size
        )
        if (drawOptions.indirect) {
          pass.drawIndexedIndirect(
            drawOptions.indirect.buffer.buffer,
            drawOptions.indirect.offset || 0
          )
        } else {
          pass.drawIndexed(
            drawOptions.count,
            drawOptions.instances || 1,
            drawOptions.firstIndex || 0,
            drawOptions.baseVertex || 0,
            drawOptions.firstInstance || 0
          )
        }
      } else if (drawOptions.indirect) {
        pass.drawIndirect(
          drawOptions.indirect.buffer.buffer,
          drawOptions.indirect.offset || 0
        )
      } else {
        pass.draw(
          drawOptions.count,
          drawOptions.instances || 1,
          drawOptions.firstVertex || 0,
          drawOptions.firstInstance || 0
        )
      }
    }
  }
  return {
    pass: wrapped,
    end() {
      if (ended) return
      ended = true
      if (occlusion) pass.endOcclusionQuery()
      pass.end()
      device.queue.submit([encoder.finish()])
    }
  }
}

export function renderPass(
  device: GPUDevice,
  context: GPUCanvasContext | null,
  options: GPURenderOptions,
  callback: (pass: GPUPass) => void
): void {
  const handle = beginRenderPass(device, context, options)
  try {
    callback(handle.pass)
  } finally {
    handle.end()
  }
}
