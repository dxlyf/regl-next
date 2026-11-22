/**
 * 着色器编译 / 链接 / 反射。
 *
 * 反射（reflection）是 regl 自动绑定 uniform 与 attribute 的基础：
 * 链接完成后通过 `getActiveUniform` / `getActiveAttrib` 得到名称、类型、位置。
 *
 * 本实现相对旧版的改进：
 * - uniform 数组（包括 `lights[0].color` 这种结构体数组）展开逻辑更可靠；
 * - program 缓存带引用计数，命令销毁时能正确释放 GPU program；
 * - 上下文恢复时原地重建 program，已编译命令持有的引用继续有效；
 * - 支持 WebGL2 的新 uniform 类型（非方阵、整数/无符号整数、sampler3D 等）。
 */

import { DEV, check, raise, reportLinkError, reportShaderError } from '../util/check'
import { GL } from '../util/constants'
import type { GLContext } from './capabilities'

/** 字符串驻留表：同一份 shader 源码只保存一次，program 缓存用 id 做键。 */
export class StringStore {
  private readonly strings: string[] = []
  private readonly ids = new Map<string, number>()

  id(str: string): number {
    let id = this.ids.get(str)
    if (id === undefined) {
      id = this.strings.length
      this.strings.push(str)
      this.ids.set(str, id)
    }
    return id
  }

  str(id: number): string {
    return this.strings[id] || ''
  }

  clear(): void {
    this.strings.length = 0
    this.ids.clear()
  }
}

export interface ActiveInfo {
  name: string
  id: number
  location: WebGLUniformLocation | number | null
  type: number
  size: number
}

/** uniform block 中的一个活跃成员（std140 布局由驱动给出）。 */
export interface BlockUniformInfo {
  name: string
  type: number
  size: number
  offset: number
  arrayStride: number
  matrixStride: number
  rowMajor: boolean
}

/** program 中的一个活跃 uniform block。 */
export interface UniformBlockInfo {
  /** block 在 program 中的索引。 */
  index: number
  name: string
  /** regl 默认分配的 binding point（= index，可被命令覆盖）。 */
  binding: number
  /** block 的 std140 数据大小（字节）。 */
  dataSize: number
  uniforms: BlockUniformInfo[]
  vertex: boolean
  fragment: boolean
}

export interface ProgramInfo {
  id: number
  program: WebGLProgram
  vertSource: string
  fragSource: string
  /** 顶点属性（按链接结果排序）。 */
  attributes: ActiveInfo[]
  /** uniform（数组会被展开成多个条目）。 */
  uniforms: ActiveInfo[]
  /** WebGL2 uniform blocks。 */
  uniformBlocks: UniformBlockInfo[]
  refCount: number
  /** 用于销毁时释放 program 计数。 */
  style: string
  /** 反射版本号：上下文恢复 / 重新链接后递增，命令计划据此刷新 location。 */
  version: number
  stats?: { uniformsCount: number; attributesCount: number }
  /** 显式 attribute location 绑定（用于恢复）。 */
  attribLocations: [number, string][] | null
}

export interface ShaderStoreOptions {
  gl: GLContext
  strings: StringStore
  stats: { shaderCount: number }
  profile: boolean
}

export class ShaderStore {
  readonly gl: GLContext
  readonly strings: StringStore
  private readonly stats: { shaderCount: number }
  private readonly profile: boolean

  private readonly vertShaders = new Map<string, WebGLShader>()
  private readonly fragShaders = new Map<string, WebGLShader>()
  private readonly programs = new Map<string, ProgramInfo>()
  private readonly programList: ProgramInfo[] = []
  private programCounter = 0

  constructor(options: ShaderStoreOptions) {
    this.gl = options.gl
    this.strings = options.strings
    this.stats = options.stats
    this.profile = options.profile
  }

  // -------------------------------------------------------------------------
  // 编译
  // -------------------------------------------------------------------------

  private compileShader(
    type: number,
    source: string,
    command?: string
  ): WebGLShader {
    const cache = type === GL.FRAGMENT_SHADER ? this.fragShaders : this.vertShaders
    const cached = cache.get(source)
    if (cached) return cached

    const gl = this.gl
    const shader = gl.createShader(type)
    check(!!shader, 'failed to create shader')
    gl.shaderSource(shader!, source)
    gl.compileShader(shader!)
    if (!gl.getShaderParameter(shader!, gl.COMPILE_STATUS)) {
      if (DEV) {
        reportShaderError(gl, shader!, source, type, command)
      } else {
        const log = gl.getShaderInfoLog(shader)
        gl.deleteShader(shader)
        raise(
          `Error compiling ${type === gl.FRAGMENT_SHADER ? 'fragment' : 'vertex'} shader${command ? ` in command ${command}` : ''}: ${log}`
        )
      }
    }
    cache.set(source, shader!)
    return shader!
  }

  /**
   * 取得（或创建）program。
   * @param attribLocations 显式 attribute 位置绑定，用于 VAO 场景。
   */
  program(
    vertSource: string,
    fragSource: string,
    attribLocations: [number, string][] | null,
    command?: string
  ): ProgramInfo {
    check(
      typeof vertSource === 'string' && vertSource.length > 0,
      'missing vertex shader'
    )
    check(
      typeof fragSource === 'string' && fragSource.length > 0,
      'missing fragment shader'
    )

    const vertId = this.strings.id(vertSource)
    const fragId = this.strings.id(fragSource)
    const locationKey = attribLocations
      ? '|' + attribLocations.map(([loc, name]) => `${loc}:${name}`).join(',')
      : ''
    const key = `${vertId}/${fragId}${locationKey}`

    let program = this.programs.get(key)
    if (program) {
      program.refCount++
      return program
    }

    program = this.linkProgram(
      vertSource,
      fragSource,
      attribLocations,
      command
    )
    this.programs.set(key, program)
    this.programList.push(program)
    this.programCounter++
    return program
  }

  private linkProgram(
    vertSource: string,
    fragSource: string,
    attribLocations: [number, string][] | null,
    command?: string
  ): ProgramInfo {
    const gl = this.gl
    const fragShader = this.compileShader(GL.FRAGMENT_SHADER, fragSource, command)
    const vertShader = this.compileShader(GL.VERTEX_SHADER, vertSource, command)

    const handle = gl.createProgram()
    check(!!handle, 'failed to create program')
    gl.attachShader(handle!, fragShader)
    gl.attachShader(handle!, vertShader)

    if (attribLocations) {
      for (const [location, name] of attribLocations) {
        gl.bindAttribLocation(handle!, location, name)
      }
    }

    gl.linkProgram(handle!)
    if (!gl.getProgramParameter(handle!, gl.LINK_STATUS)) {
      if (DEV) {
        reportLinkError(gl, handle!, fragSource, vertSource, command)
      } else {
        const log = gl.getProgramInfoLog(handle)
        raise(`Error linking program${command ? ` in command ${command}` : ''}: ${log}`)
      }
    }

    const info: ProgramInfo = {
      id: this.programCounter,
      program: handle!,
      vertSource,
      fragSource,
      attributes: [],
      uniforms: [],
      uniformBlocks: [],
      refCount: 1,
      style: attribLocations ? 'attribute locations' : 'auto',
      version: 0,
      attribLocations
    }

    // -----------------------------------------------------------------------
    // 反射 uniform
    // -----------------------------------------------------------------------
    const numUniforms = gl.getProgramParameter(
      handle!,
      GL.ACTIVE_UNIFORMS
    ) as number
    if (this.profile) {
      info.stats = { uniformsCount: numUniforms, attributesCount: 0 }
    }

    for (let i = 0; i < numUniforms; ++i) {
      const active = gl.getActiveUniform(handle!, i)
      if (!active) continue
      if (active.size > 1) {
        // 数组：展开成 name[0], name[1], ...
        for (let j = 0; j < active.size; ++j) {
          const name = expandArrayName(active.name, j)
          const location = gl.getUniformLocation(handle!, name)
          if (!location) continue
          info.uniforms.push({
            name,
            id: this.strings.id(name),
            location,
            type: active.type,
            size: 1
          })
        }
      } else {
        const location = gl.getUniformLocation(handle!, active.name)
        if (!location) continue
        info.uniforms.push({
          name: active.name,
          id: this.strings.id(active.name),
          location,
          type: active.type,
          size: 1
        })
      }
    }

    // -----------------------------------------------------------------------
    // 反射 attribute
    // -----------------------------------------------------------------------
    const numAttributes = gl.getProgramParameter(
      handle!,
      GL.ACTIVE_ATTRIBUTES
    ) as number
    if (this.profile && info.stats) {
      info.stats.attributesCount = numAttributes
    }

    for (let i = 0; i < numAttributes; ++i) {
      const active = gl.getActiveAttrib(handle!, i)
      if (!active) continue
      info.attributes.push({
        name: active.name,
        id: this.strings.id(active.name),
        location: gl.getAttribLocation(handle!, active.name),
        type: active.type,
        size: active.size
      })
    }

    this.reflectUniformBlocks(handle!, info)

    this.stats.shaderCount++
    return info
  }

  /**
   * 反射 WebGL2 uniform blocks。
   * 驱动给出的 offset / stride 已经是 std140 实际布局，直接用于成员更新与自动打包。
   */
  private reflectUniformBlocks(program: WebGLProgram, info: ProgramInfo): void {
    info.uniformBlocks.length = 0
    const gl = this.gl as WebGL2RenderingContext
    if (typeof gl.getActiveUniformBlockName !== 'function') {
      // WebGL1
      return
    }

    const numBlocks = gl.getProgramParameter(
      program,
      GL.ACTIVE_UNIFORM_BLOCKS
    ) as number
    if (!numBlocks) return

    for (let blockIndex = 0; blockIndex < numBlocks; ++blockIndex) {
      const name = gl.getActiveUniformBlockName(program, blockIndex)
      if (!name) continue

      const dataSize = gl.getActiveUniformBlockParameter(
        program,
        blockIndex,
        GL.UNIFORM_BLOCK_DATA_SIZE
      ) as number

      const indices = gl.getActiveUniformBlockParameter(
        program,
        blockIndex,
        GL.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES
      ) as Uint32Array | number[]

      const referencedByVertex = !!gl.getActiveUniformBlockParameter(
        program,
        blockIndex,
        GL.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER
      )
      const referencedByFragment = !!gl.getActiveUniformBlockParameter(
        program,
        blockIndex,
        GL.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER
      )

      const uniformIndices = Array.from(indices || [])
      const uniforms: BlockUniformInfo[] = []

      if (uniformIndices.length > 0) {
        const offsets = gl.getActiveUniforms(program, uniformIndices, GL.UNIFORM_OFFSET) as number[]
        const types = gl.getActiveUniforms(program, uniformIndices, GL.UNIFORM_TYPE) as number[]
        const sizes = gl.getActiveUniforms(program, uniformIndices, GL.UNIFORM_SIZE) as number[]
        const arrayStrides = gl.getActiveUniforms(
          program,
          uniformIndices,
          GL.UNIFORM_ARRAY_STRIDE
        ) as number[]
        const matrixStrides = gl.getActiveUniforms(
          program,
          uniformIndices,
          GL.UNIFORM_MATRIX_STRIDE
        ) as number[]
        const rowMajors = gl.getActiveUniforms(
          program,
          uniformIndices,
          GL.UNIFORM_IS_ROW_MAJOR
        ) as boolean[]

        for (let i = 0; i < uniformIndices.length; ++i) {
          const active = gl.getActiveUniform(program, uniformIndices[i])
          if (!active) continue
          uniforms.push({
            name: active.name,
            type: types[i],
            size: sizes[i],
            offset: offsets[i],
            arrayStride: arrayStrides[i] || 0,
            matrixStride: matrixStrides[i] || 0,
            rowMajor: !!rowMajors[i]
          })
        }
      }

      // regl 接管 block binding：默认使用 block index，命令可以覆盖。
      gl.uniformBlockBinding(program, blockIndex, blockIndex)

      info.uniformBlocks.push({
        index: blockIndex,
        name,
        binding: blockIndex,
        dataSize,
        uniforms,
        vertex: referencedByVertex,
        fragment: referencedByFragment
      })
    }
  }

  // -------------------------------------------------------------------------
  // 统计 / 生命周期
  // -------------------------------------------------------------------------

  getMaxUniformsCount(): number {
    let max = 0
    for (const program of this.programList) {
      const count = program.stats?.uniformsCount || 0
      if (count > max) max = count
    }
    return max
  }

  getMaxAttributesCount(): number {
    let max = 0
    for (const program of this.programList) {
      const count = program.stats?.attributesCount || 0
      if (count > max) max = count
    }
    return max
  }

  /** 命令销毁时调用；引用计数归零则删除 GPU program。 */
  destroyProgram(program: ProgramInfo): void {
    program.refCount--
    if (program.refCount > 0) return
    const index = this.programList.indexOf(program)
    if (index >= 0) this.programList.splice(index, 1)
    for (const [key, cached] of this.programs) {
      if (cached === program) {
        this.programs.delete(key)
        break
      }
    }
    if (program.program) {
      this.gl.deleteProgram(program.program)
      program.program = null as unknown as WebGLProgram
    }
    this.stats.shaderCount--
  }

  /** 上下文恢复：原地重建所有 program。 */
  restore(): void {
    // 旧 shader 句柄已失效，清空缓存
    this.vertShaders.clear()
    this.fragShaders.clear()
    for (const info of this.programList) {
      const handle = this.gl.createProgram()
      check(!!handle, 'failed to create program')
      const fragShader = this.compileShader(
        GL.FRAGMENT_SHADER,
        info.fragSource
      )
      const vertShader = this.compileShader(GL.VERTEX_SHADER, info.vertSource)
      this.gl.attachShader(handle!, fragShader)
      this.gl.attachShader(handle!, vertShader)
      if (info.attribLocations) {
        for (const [location, name] of info.attribLocations) {
          this.gl.bindAttribLocation(handle!, location, name)
        }
      }
      this.gl.linkProgram(handle!)
      if (!this.gl.getProgramParameter(handle!, this.gl.LINK_STATUS)) {
        raise('Error restoring program')
      }
      info.program = handle!
      // 重新反射（uniform 位置可能改变）
      this.reflect(info)
    }
  }

  private reflect(info: ProgramInfo): void {
    const gl = this.gl
    info.version++
    info.uniforms.length = 0
    info.attributes.length = 0

    const numUniforms = gl.getProgramParameter(
      info.program,
      GL.ACTIVE_UNIFORMS
    ) as number
    for (let i = 0; i < numUniforms; ++i) {
      const active = gl.getActiveUniform(info.program, i)
      if (!active) continue
      if (active.size > 1) {
        for (let j = 0; j < active.size; ++j) {
          const name = expandArrayName(active.name, j)
          const location = gl.getUniformLocation(info.program, name)
          if (!location) continue
          info.uniforms.push({
            name,
            id: this.strings.id(name),
            location,
            type: active.type,
            size: 1
          })
        }
      } else {
        const location = gl.getUniformLocation(info.program, active.name)
        if (!location) continue
        info.uniforms.push({
          name: active.name,
          id: this.strings.id(active.name),
          location,
          type: active.type,
          size: 1
        })
      }
    }

    const numAttributes = gl.getProgramParameter(
      info.program,
      GL.ACTIVE_ATTRIBUTES
    ) as number
    for (let i = 0; i < numAttributes; ++i) {
      const active = gl.getActiveAttrib(info.program, i)
      if (!active) continue
      info.attributes.push({
        name: active.name,
        id: this.strings.id(active.name),
        location: gl.getAttribLocation(info.program, active.name),
        type: active.type,
        size: active.size
      })
    }

    this.reflectUniformBlocks(info.program, info)
  }

  clear(): void {
    for (const program of this.programList) {
      if (program.program) {
        this.gl.deleteProgram(program.program)
        program.program = null as unknown as WebGLProgram
      }
    }
    this.programList.length = 0
    this.programs.clear()
    for (const shader of this.vertShaders.values()) {
      this.gl.deleteShader(shader)
    }
    for (const shader of this.fragShaders.values()) {
      this.gl.deleteShader(shader)
    }
    this.vertShaders.clear()
    this.fragShaders.clear()
    this.stats.shaderCount = 0
  }
}

/**
 * 展开数组 uniform 名称。
 * 处理 `u[0]`、`lights[0].color` 等写法；如果没有 `[0]`，退化为追加下标。
 */
function expandArrayName(name: string, index: number): string {
  if (name.indexOf('[0]') >= 0) {
    return name.replace('[0]', `[${index}]`)
  }
  return `${name}[${index}]`
}

// ---------------------------------------------------------------------------
// uniform 类型信息
// ---------------------------------------------------------------------------

/** uniform 类型的元信息。 */
export interface UniformTypeInfo {
  /** 每个元素的 GLSL 值数量（向量/矩阵）。 */
  components: number
  /** 上传函数后缀：1f/2f/3f/4f/1i/2i/3i/4i/Matrix2fv/... */
  infix: string
  /** 是否是采样器。 */
  sampler: boolean
  /** 采样器要求的纹理目标。 */
  textureTarget?: number
  /** 矩阵维度（用于 Float32Array 转换）。 */
  matrixDim?: number
  /** 矩阵列数 x 行数（WebGL2 非方阵）。 */
  matrixCols?: number
  matrixRows?: number
}

const uniformTypeCache = new Map<number, UniformTypeInfo>()

/** 取得 uniform 类型的上传信息；未知类型返回 null。 */
export function uniformTypeInfo(type: number): UniformTypeInfo | null {
  const cached = uniformTypeCache.get(type)
  if (cached) return cached

  let info: UniformTypeInfo | null = null
  switch (type) {
    case GL.FLOAT:
      info = { components: 1, infix: '1f', sampler: false }
      break
    case GL.FLOAT_VEC2:
      info = { components: 2, infix: '2f', sampler: false }
      break
    case GL.FLOAT_VEC3:
      info = { components: 3, infix: '3f', sampler: false }
      break
    case GL.FLOAT_VEC4:
      info = { components: 4, infix: '4f', sampler: false }
      break
    case GL.INT:
    case GL.BOOL:
      info = { components: 1, infix: '1i', sampler: false }
      break
    case GL.INT_VEC2:
    case GL.BOOL_VEC2:
      info = { components: 2, infix: '2i', sampler: false }
      break
    case GL.INT_VEC3:
    case GL.BOOL_VEC3:
      info = { components: 3, infix: '3i', sampler: false }
      break
    case GL.INT_VEC4:
    case GL.BOOL_VEC4:
      info = { components: 4, infix: '4i', sampler: false }
      break
    case GL.UNSIGNED_INT:
      info = { components: 1, infix: '1ui', sampler: false }
      break
    case GL.UNSIGNED_INT_VEC2:
      info = { components: 2, infix: '2ui', sampler: false }
      break
    case GL.UNSIGNED_INT_VEC3:
      info = { components: 3, infix: '3ui', sampler: false }
      break
    case GL.UNSIGNED_INT_VEC4:
      info = { components: 4, infix: '4ui', sampler: false }
      break
    case GL.FLOAT_MAT2:
      info = { components: 4, infix: 'Matrix2fv', sampler: false, matrixDim: 2 }
      break
    case GL.FLOAT_MAT3:
      info = { components: 9, infix: 'Matrix3fv', sampler: false, matrixDim: 3 }
      break
    case GL.FLOAT_MAT4:
      info = { components: 16, infix: 'Matrix4fv', sampler: false, matrixDim: 4 }
      break
    case GL.FLOAT_MAT2x3:
      info = {
        components: 6,
        infix: 'Matrix2x3fv',
        sampler: false,
        matrixCols: 2,
        matrixRows: 3
      }
      break
    case GL.FLOAT_MAT2x4:
      info = {
        components: 8,
        infix: 'Matrix2x4fv',
        sampler: false,
        matrixCols: 2,
        matrixRows: 4
      }
      break
    case GL.FLOAT_MAT3x2:
      info = {
        components: 6,
        infix: 'Matrix3x2fv',
        sampler: false,
        matrixCols: 3,
        matrixRows: 2
      }
      break
    case GL.FLOAT_MAT3x4:
      info = {
        components: 12,
        infix: 'Matrix3x4fv',
        sampler: false,
        matrixCols: 3,
        matrixRows: 4
      }
      break
    case GL.FLOAT_MAT4x2:
      info = {
        components: 8,
        infix: 'Matrix4x2fv',
        sampler: false,
        matrixCols: 4,
        matrixRows: 2
      }
      break
    case GL.FLOAT_MAT4x3:
      info = {
        components: 12,
        infix: 'Matrix4x3fv',
        sampler: false,
        matrixCols: 4,
        matrixRows: 3
      }
      break
    case GL.SAMPLER_2D:
      info = { components: 1, infix: '1i', sampler: true, textureTarget: GL.TEXTURE_2D }
      break
    case GL.SAMPLER_CUBE:
      info = {
        components: 1,
        infix: '1i',
        sampler: true,
        textureTarget: GL.TEXTURE_CUBE_MAP
      }
      break
    case GL.SAMPLER_3D:
      info = { components: 1, infix: '1i', sampler: true, textureTarget: GL.TEXTURE_3D }
      break
    case GL.SAMPLER_2D_ARRAY:
      info = {
        components: 1,
        infix: '1i',
        sampler: true,
        textureTarget: GL.TEXTURE_2D_ARRAY
      }
      break
    case GL.SAMPLER_2D_SHADOW:
      info = { components: 1, infix: '1i', sampler: true, textureTarget: GL.TEXTURE_2D }
      break
    case GL.SAMPLER_CUBE_SHADOW:
      info = {
        components: 1,
        infix: '1i',
        sampler: true,
        textureTarget: GL.TEXTURE_CUBE_MAP
      }
      break
    case GL.SAMPLER_2D_ARRAY_SHADOW:
      info = {
        components: 1,
        infix: '1i',
        sampler: true,
        textureTarget: GL.TEXTURE_2D_ARRAY
      }
      break
    case GL.INT_SAMPLER_2D:
    case GL.UNSIGNED_INT_SAMPLER_2D:
      info = { components: 1, infix: '1i', sampler: true, textureTarget: GL.TEXTURE_2D }
      break
    case GL.INT_SAMPLER_CUBE:
    case GL.UNSIGNED_INT_SAMPLER_CUBE:
      info = {
        components: 1,
        infix: '1i',
        sampler: true,
        textureTarget: GL.TEXTURE_CUBE_MAP
      }
      break
    case GL.INT_SAMPLER_3D:
    case GL.UNSIGNED_INT_SAMPLER_3D:
      info = { components: 1, infix: '1i', sampler: true, textureTarget: GL.TEXTURE_3D }
      break
    case GL.INT_SAMPLER_2D_ARRAY:
    case GL.UNSIGNED_INT_SAMPLER_2D_ARRAY:
      info = {
        components: 1,
        infix: '1i',
        sampler: true,
        textureTarget: GL.TEXTURE_2D_ARRAY
      }
      break
    default:
      info = null
  }

  if (info) uniformTypeCache.set(type, info)
  return info
}

/** 判断 uniform 类型是否是采样器。 */
export function isSamplerType(type: number): boolean {
  return uniformTypeInfo(type)?.sampler === true
}

/** 判断 uniform 类型是否是矩阵。 */
export function isMatrixType(type: number): boolean {
  return uniformTypeInfo(type)?.infix.startsWith('Matrix') === true
}
