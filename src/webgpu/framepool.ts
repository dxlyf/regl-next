/** WebGPU 帧级临时资源池。 */

import { check } from '../util/check'
import { createResourcePool } from './pool'
import type {
  GPUBufferOptions,
  GPUBufferResource,
  GPUFramePool,
  GPUPoolOptions,
  GPUPooled,
  GPUPoolStats,
  GPUTextureOptions,
  GPUTextureResource
} from './types'

/**
 * 帧级 transient pool。
 *
 * 语义：
 * - 本帧 acquire 的资源和 lease 会在 endFrame() 中统一 release；
 * - release 前等待 queue.onSubmittedWorkDone()，避免 GPU 仍在使用时销毁/复用；
 * - 这是安全但会等待 GPU 的简单实现，不声称零停顿。
 */
export function createFramePool(
  device: GPUDevice,
  options: GPUPoolOptions = {}
): GPUFramePool {
  const pool = createResourcePool(device, options)
  const leases: Array<{ release(): void }> = []
  let ending: Promise<void> | null = null
  let destroyed = false

  const guard = (): void => {
    check(!destroyed, 'frame pool has been destroyed')
    check(!ending, 'frame pool is ending; await endFrame() before acquiring')
  }

  const framePool: GPUFramePool = {
    _gpuType: 'frame-pool',
    buffer(
      input?: GPUBufferOptions | number | ArrayBufferView | ArrayBuffer
    ): GPUPooled<GPUBufferResource> {
      guard()
      const leased = pool.buffer(input)
      leases.push(leased)
      return leased
    },
    texture(textureOptions: GPUTextureOptions): GPUPooled<GPUTextureResource> {
      guard()
      const leased = pool.texture(textureOptions)
      leases.push(leased)
      return leased
    },
    async endFrame(): Promise<void> {
      if (ending) return ending
      ending = (async () => {
        await device.queue.onSubmittedWorkDone()
        for (const leased of leases) leased.release()
        leases.length = 0
        ending = null
      })()
      return ending
    },
    stats(): GPUPoolStats {
      return pool.stats()
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      for (const leased of leases) leased.release()
      leases.length = 0
      pool.destroy()
    }
  }
  return framePool
}
