/**
 * WebGL2 Sampler Object。
 *
 * Sampler 与 texture 解耦：texture 只保存图像数据，sampler 保存
 * min/mag/wrap/compare/LOD 等采样状态。绑定到纹理单元后，会覆盖
 * texture 自带的采样参数。
 *
 * 仅 WebGL2 可用。
 */

import { GL, compareFuncs, magFilters, minFilters, wrapModes } from '../util/constants'
import { check, checkParameter } from '../util/check'
import type { Capabilities, GLContext } from '../core/capabilities'
import type { Limits } from '../core/limits'
import type { StatsObject } from '../core/stats'

export type SamplerFilter =
  | 'nearest'
  | 'linear'
  | 'mipmap'
  | 'nearest mipmap nearest'
  | 'linear mipmap nearest'
  | 'nearest mipmap linear'
  | 'linear mipmap linear'

export type SamplerWrap = 'repeat' | 'clamp' | 'mirror'

export type SamplerCompare =
  | 'none'
  | 'never'
  | 'less'
  | '<'
  | 'equal'
  | '='
  | '=='
  | '==='
  | 'lequal'
  | '<='
  | 'greater'
  | '>'
  | 'notequal'
  | '!='
  | '!=='
  | 'gequal'
  | '>='
  | 'always'

export interface SamplerOptions {
  min?: SamplerFilter
  mag?: 'nearest' | 'linear'
  wrap?: SamplerWrap | [SamplerWrap, SamplerWrap]
  wrapS?: SamplerWrap
  wrapT?: SamplerWrap
  wrapR?: SamplerWrap
  /** 阴影比较；默认 'none'（普通采样）。 */
  compare?: SamplerCompare | false
  minLod?: number
  maxLod?: number
  lodBias?: number
  /** 各向异性过滤，需要 EXT_texture_filter_anisotropic。 */
  anisotropic?: number
}

export interface SamplerInfo {
  minFilter: number
  magFilter: number
  wrapS: number
  wrapT: number
  wrapR: number
  compareMode: number
  compareFunc: number
  minLod: number
  maxLod: number
  lodBias: number
  anisotropic: number
}

export interface SamplerInternal {
  id: number
  handle: WebGLSampler | null
  info: SamplerInfo
}

export interface SamplerWrapper {
  (options?: SamplerOptions): SamplerWrapper
  _reglType: 'sampler'
  _sampler: SamplerInternal
  destroy(): void
}

export interface SamplerStoreOptions {
  gl: GLContext
  caps: Capabilities
  limits: Limits
  stats: StatsObject
  onDestroy?: (handle: WebGLSampler) => void
}

const DEFAULT_INFO: SamplerInfo = {
  minFilter: GL.NEAREST,
  magFilter: GL.NEAREST,
  wrapS: GL.CLAMP_TO_EDGE,
  wrapT: GL.CLAMP_TO_EDGE,
  wrapR: GL.CLAMP_TO_EDGE,
  compareMode: GL.NONE,
  compareFunc: GL.LEQUAL,
  minLod: -1000,
  maxLod: 1000,
  lodBias: 0,
  anisotropic: 1
}

export function isSampler(value: unknown): value is SamplerWrapper {
  return (
    typeof value === 'function' &&
    (value as { _reglType?: string })._reglType === 'sampler'
  )
}

export function getSampler(value: unknown): SamplerInternal | null {
  if (!isSampler(value)) return null
  return value._sampler
}

export class SamplerStore {
  readonly gl: GLContext
  readonly caps: Capabilities
  readonly limits: Limits
  readonly stats: StatsObject
  private readonly onDestroy?: (handle: WebGLSampler) => void

  private readonly samplers = new Map<number, SamplerInternal>()
  private samplerId = 0

  constructor(options: SamplerStoreOptions) {
    this.gl = options.gl
    this.caps = options.caps
    this.limits = options.limits
    this.stats = options.stats
    this.onDestroy = options.onDestroy
  }

  create(options?: SamplerOptions | null): SamplerWrapper {
    check(this.caps.isWebGL2, 'sampler objects require WebGL2')
    const gl = this.gl as WebGL2RenderingContext
    const handle = gl.createSampler()
    check(!!handle, 'failed to create sampler object')

    const sampler: SamplerInternal = {
      id: this.samplerId++,
      handle,
      info: { ...DEFAULT_INFO }
    }
    this.parseInfo(sampler, options)
    this.apply(sampler)
    this.samplers.set(sampler.id, sampler)
    this.stats.samplerCount++

    const wrapper = ((next?: SamplerOptions | null) => {
      if (next) {
        this.parseInfo(sampler, next)
        this.apply(sampler)
      }
      return wrapper
    }) as SamplerWrapper

    wrapper._reglType = 'sampler'
    wrapper._sampler = sampler
    wrapper.destroy = () => this.destroy(sampler)
    return wrapper
  }

  get(wrapper: unknown): SamplerInternal | null {
    if (!isSampler(wrapper)) return null
    const sampler = wrapper._sampler
    return this.samplers.get(sampler.id) || null
  }

  destroy(sampler: SamplerInternal): void {
    if (!sampler.handle) return
    const handle = sampler.handle
    this.samplers.delete(sampler.id)
    this.onDestroy?.(handle)
    ;(this.gl as WebGL2RenderingContext).deleteSampler(handle)
    sampler.handle = null
    this.stats.samplerCount = Math.max(0, this.stats.samplerCount - 1)
  }

  /** 上下文丢失：旧 handle 已失效，避免 restore 误判为仍有效。 */
  lose(): void {
    for (const sampler of this.samplers.values()) {
      sampler.handle = null
    }
  }

  restore(): void {
    if (!this.caps.isWebGL2) return
    const gl = this.gl as WebGL2RenderingContext
    for (const sampler of this.samplers.values()) {
      if (sampler.handle) continue
      const handle = gl.createSampler()
      if (!handle) continue
      sampler.handle = handle
      this.apply(sampler)
    }
  }

  clear(): void {
    const gl = this.gl as WebGL2RenderingContext
    for (const sampler of this.samplers.values()) {
      if (sampler.handle) {
        this.onDestroy?.(sampler.handle)
        gl.deleteSampler(sampler.handle)
        sampler.handle = null
      }
    }
    this.samplers.clear()
    this.stats.samplerCount = 0
  }

  private parseInfo(
    sampler: SamplerInternal,
    options?: SamplerOptions | null
  ): void {
    if (!options) return
    const info = sampler.info

    if ('min' in options) {
      const min = options.min as string
      checkParameter(min, minFilters, 'invalid sampler min filter')
      info.minFilter = minFilters[min]
    }
    if ('mag' in options) {
      const mag = options.mag as string
      checkParameter(mag, magFilters, 'invalid sampler mag filter')
      info.magFilter = magFilters[mag]
    }

    if ('wrap' in options) {
      const wrap = options.wrap
      if (typeof wrap === 'string') {
        checkParameter(wrap, wrapModes, 'invalid sampler wrap')
        info.wrapS = info.wrapT = wrapModes[wrap]
      } else if (Array.isArray(wrap)) {
        checkParameter(wrap[0], wrapModes, 'invalid sampler wrapS')
        checkParameter(wrap[1], wrapModes, 'invalid sampler wrapT')
        info.wrapS = wrapModes[wrap[0]]
        info.wrapT = wrapModes[wrap[1]]
      } else {
        throw new Error('(regl) invalid sampler wrap')
      }
    } else {
      if ('wrapS' in options) {
        checkParameter(options.wrapS, wrapModes, 'invalid sampler wrapS')
        info.wrapS = wrapModes[options.wrapS as string]
      }
      if ('wrapT' in options) {
        checkParameter(options.wrapT, wrapModes, 'invalid sampler wrapT')
        info.wrapT = wrapModes[options.wrapT as string]
      }
    }
    if ('wrapR' in options) {
      checkParameter(options.wrapR, wrapModes, 'invalid sampler wrapR')
      info.wrapR = wrapModes[options.wrapR as string]
    }

    if ('compare' in options) {
      const compare = options.compare
      if (compare === false || compare === 'none') {
        info.compareMode = GL.NONE
        info.compareFunc = GL.LEQUAL
      } else {
        checkParameter(compare, compareFuncs, 'invalid sampler compare')
        info.compareMode = GL.COMPARE_REF_TO_TEXTURE
        info.compareFunc = compareFuncs[compare as string]
      }
    }

    if ('minLod' in options) {
      info.minLod = checkFinite(options.minLod, 'invalid sampler minLod')
    }
    if ('maxLod' in options) {
      info.maxLod = checkFinite(options.maxLod, 'invalid sampler maxLod')
    }
    if ('lodBias' in options) {
      info.lodBias = checkFinite(options.lodBias, 'invalid sampler lodBias')
    }
    if ('anisotropic' in options) {
      const aniso = options.anisotropic as number
      check(
        typeof aniso === 'number' &&
          aniso >= 1 &&
          (this.limits.maxAnisotropic <= 1 ||
            aniso <= this.limits.maxAnisotropic),
        `aniso samples must be between 1 and ${Math.max(1, this.limits.maxAnisotropic)}`
      )
      info.anisotropic = aniso
    }
  }

  private apply(sampler: SamplerInternal): void {
    if (!sampler.handle) return
    const gl = this.gl as WebGL2RenderingContext
    const info = sampler.info
    const handle = sampler.handle

    gl.samplerParameteri(handle, GL.TEXTURE_MIN_FILTER, info.minFilter)
    gl.samplerParameteri(handle, GL.TEXTURE_MAG_FILTER, info.magFilter)
    gl.samplerParameteri(handle, GL.TEXTURE_WRAP_S, info.wrapS)
    gl.samplerParameteri(handle, GL.TEXTURE_WRAP_T, info.wrapT)
    gl.samplerParameteri(handle, GL.TEXTURE_WRAP_R, info.wrapR)
    gl.samplerParameteri(handle, GL.TEXTURE_COMPARE_MODE, info.compareMode)
    gl.samplerParameteri(handle, GL.TEXTURE_COMPARE_FUNC, info.compareFunc)
    gl.samplerParameterf(handle, GL.TEXTURE_MIN_LOD, info.minLod)
    gl.samplerParameterf(handle, GL.TEXTURE_MAX_LOD, info.maxLod)
    gl.samplerParameterf(handle, GL.TEXTURE_LOD_BIAS, info.lodBias)

    if (
      this.caps.has('ext_texture_filter_anisotropic') &&
      this.limits.maxAnisotropic > 1
    ) {
      gl.samplerParameterf(
        handle,
        GL.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(info.anisotropic, this.limits.maxAnisotropic)
      )
    }
  }
}

function checkFinite(value: unknown, message: string): number {
  check(typeof value === 'number' && isFinite(value), message)
  return value as number
}
