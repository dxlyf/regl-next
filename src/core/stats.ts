/**
 * 全局统计对象。
 *
 * 计数字段与 regl 2.x 保持一致；`profile: true` 时还会挂载若干显存估算方法。
 */

export interface StatsObject {
  vaoCount: number
  bufferCount: number
  elementsCount: number
  framebufferCount: number
  shaderCount: number
  textureCount: number
  cubeCount: number
  renderbufferCount: number
  samplerCount: number
  maxTextureUnits: number
  getTotalBufferSize?(): number
  getTotalTextureSize?(): number
  getTotalRenderbufferSize?(): number
  getMaxUniformsCount?(): number
  getMaxAttributesCount?(): number
}

export function newStats(): StatsObject {
  return {
    vaoCount: 0,
    bufferCount: 0,
    elementsCount: 0,
    framebufferCount: 0,
    shaderCount: 0,
    textureCount: 0,
    cubeCount: 0,
    renderbufferCount: 0,
    samplerCount: 0,
    maxTextureUnits: 0
  }
}
