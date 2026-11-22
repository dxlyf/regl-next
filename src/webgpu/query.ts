/** WebGPU query set：timestamp / occlusion。 */

import { check } from '../util/check'
import type {
  GPUQuerySetOptions,
  GPUQuerySetResource,
  GPUResolveQuerySetOptions
} from './types'

export function createQuerySet(
  device: GPUDevice,
  options: GPUQuerySetOptions = {}
): GPUQuerySetResource {
  const type = options.type || 'occlusion'
  check(
    type === 'occlusion' || type === 'timestamp',
    'invalid query type'
  )
  if (type === 'timestamp') {
    check(
      device.features.has('timestamp-query'),
      'timestamp queries require the "timestamp-query" device feature'
    )
  }
  const count = (options.count || 1) | 0
  check(count > 0, 'invalid query count')
  const querySet = device.createQuerySet({
    type,
    count,
    label: options.label
  })
  return {
    _gpuType: 'query-set',
    querySet,
    type,
    count,
    destroy() {
      querySet.destroy()
    }
  }
}

export function resolveQuerySet(
  device: GPUDevice,
  options: GPUResolveQuerySetOptions
): void {
  const firstQuery = (options.firstQuery || 0) | 0
  const queryCount =
    options.queryCount === undefined
      ? options.querySet.count - firstQuery
      : (options.queryCount | 0)
  check(firstQuery >= 0 && queryCount > 0, 'invalid query range')
  check(
    firstQuery + queryCount <= options.querySet.count,
    'query range out of bounds'
  )
  const encoder = device.createCommandEncoder()
  encoder.resolveQuerySet(
    options.querySet.querySet,
    firstQuery,
    queryCount,
    options.destination.buffer,
    options.destinationOffset || 0
  )
  device.queue.submit([encoder.finish()])
}
