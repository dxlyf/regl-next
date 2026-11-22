/**
 * GPU 计时器（EXT_disjoint_timer_query / EXT_disjoint_timer_query_webgl2）。
 *
 * 与 regl 的实现思路一致：把查询放入队列，帧末通过 update() 回收已经完成的
 * 查询，并把时间累加到对应的命令统计上。WebGL1 与 WebGL2 的扩展 API 名称
 * 不同，这里做了归一化。
 */

import { GL } from '../util/constants'
import type { Capabilities, GLContext } from './capabilities'

export interface TimerStats {
  gpuTime: number
  cpuTime: number
  count: number
}

interface PendingStats {
  startQueryIndex: number
  endQueryIndex: number
  sum: number
  stats: TimerStats | null
}

export interface Timer {
  beginQuery(stats: TimerStats): void
  endQuery(): void
  update(): void
  clear(): void
  restore(): void
}

export function createTimer(
  gl: GLContext,
  caps: Capabilities
): Timer | null {
  const ext = caps.timerQueryExt
  if (!ext) return null

  const isWebGL2 = caps.isWebGL2
  const queryTarget = GL.TIME_ELAPSED_EXT
  const availablePname = GL.QUERY_RESULT_AVAILABLE_EXT
  const resultPname = GL.QUERY_RESULT_EXT

  const gl2 = gl as WebGL2RenderingContext

  const createQuery = (): WebGLQuery => {
    if (isWebGL2) {
      return gl2.createQuery()!
    }
    return ext.createQueryEXT!()
  }
  const deleteQuery = (query: WebGLQuery): void => {
    if (isWebGL2) {
      gl2.deleteQuery(query)
    } else {
      ext.deleteQueryEXT!(query)
    }
  }
  const beginQuery = (query: WebGLQuery): void => {
    if (isWebGL2) {
      gl2.beginQuery(queryTarget, query)
    } else {
      ext.beginQueryEXT!(queryTarget, query)
    }
  }
  const endQuery = (): void => {
    if (isWebGL2) {
      gl2.endQuery(queryTarget)
    } else {
      ext.endQueryEXT!(queryTarget)
    }
  }
  const isAvailable = (query: WebGLQuery): boolean => {
    if (isWebGL2) {
      return !!gl2.getQueryParameter(query, availablePname)
    }
    return !!ext.getQueryObjectEXT!(query, availablePname)
  }
  const getResult = (query: WebGLQuery): number => {
    if (isWebGL2) {
      return (gl2.getQueryParameter(query, resultPname) as number) || 0
    }
    return (ext.getQueryObjectEXT!(query, resultPname) as number) || 0
  }

  const queryPool: WebGLQuery[] = []
  const pendingQueries: WebGLQuery[] = []

  function allocQuery(): WebGLQuery {
    return queryPool.pop() || createQuery()
  }

  const pendingStatsPool: PendingStats[] = []
  const pendingStats: PendingStats[] = []

  function pushScopeStats(
    start: number,
    end: number,
    stats: TimerStats
  ): void {
    const ps = pendingStatsPool.pop() || {
      startQueryIndex: -1,
      endQueryIndex: -1,
      sum: 0,
      stats: null
    }
    ps.startQueryIndex = start
    ps.endQueryIndex = end
    ps.sum = 0
    ps.stats = stats
    pendingStats.push(ps)
  }

  const timeSum: number[] = []
  const queryPtr: number[] = []

  function update(): void {
    const n = pendingQueries.length
    if (n === 0) return

    timeSum.length = Math.max(timeSum.length, n + 1)
    queryPtr.length = Math.max(queryPtr.length, n + 1)
    timeSum[0] = 0
    queryPtr[0] = 0

    let queryTime = 0
    let ptr = 0
    for (let i = 0; i < pendingQueries.length; ++i) {
      const query = pendingQueries[i]
      if (isAvailable(query)) {
        queryTime += getResult(query)
        queryPool.push(query)
      } else {
        pendingQueries[ptr++] = query
      }
      timeSum[i + 1] = queryTime
      queryPtr[i + 1] = ptr
    }
    pendingQueries.length = ptr

    ptr = 0
    for (let i = 0; i < pendingStats.length; ++i) {
      const stats = pendingStats[i]
      const start = stats.startQueryIndex
      const end = stats.endQueryIndex
      stats.sum += timeSum[end] - timeSum[start]
      const startPtr = queryPtr[start]
      const endPtr = queryPtr[end]
      if (endPtr === startPtr) {
        if (stats.stats) stats.stats.gpuTime += stats.sum / 1e6
        pendingStatsPool.push(stats)
      } else {
        stats.startQueryIndex = startPtr
        stats.endQueryIndex = endPtr
        pendingStats[ptr++] = stats
      }
    }
    pendingStats.length = ptr
  }

  return {
    beginQuery(stats: TimerStats): void {
      const query = allocQuery()
      beginQuery(query)
      pendingQueries.push(query)
      pushScopeStats(pendingQueries.length - 1, pendingQueries.length, stats)
    },
    endQuery,
    update,
    clear(): void {
      queryPool.push(...pendingQueries)
      pendingQueries.length = 0
      for (const query of queryPool) {
        deleteQuery(query)
      }
      queryPool.length = 0
      pendingStats.length = 0
    },
    restore(): void {
      pendingQueries.length = 0
      queryPool.length = 0
      pendingStats.length = 0
    }
  }
}
