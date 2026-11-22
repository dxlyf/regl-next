/**
 * WebGPU-first 入口。
 *
 * 对外只暴露 createWEBGPU（以及兼容别名 createGPU）。
 * 具体资源、pipeline、render pass、readback 实现分别位于同目录模块中。
 */

export { createWEBGPU, createGPU } from './context'
export type * from './types'
