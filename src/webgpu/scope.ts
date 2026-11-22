/** WebGPU render scope / batch：一个 command encoder + 一个 render pass。 */

import { beginRenderPass } from './render'
import type {
  GPUCommand,
  GPUCommandProps,
  GPURenderOptions,
  GPUScope
} from './types'

export function createScope(
  device: GPUDevice,
  context: GPUCanvasContext | null,
  options: GPURenderOptions
): GPUScope {
  const handle = beginRenderPass(device, context, options)
  let ended = false
  const scope: GPUScope = {
    draw(command: GPUCommand, props?: GPUCommandProps) {
      if (ended) throw new Error('(regl) scope has already ended')
      command.draw(handle.pass, props)
    },
    end() {
      if (ended) return
      ended = true
      handle.end()
    }
  }
  return scope
}
