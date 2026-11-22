/**
 * 缂佹ê鍩楅崨鎴掓姢缂傛牞鐦ч崳銊ょ瑢閹笛嗩攽閸?閳ユ柡鈧?閺佺繝閲滄惔鎾舵畱閺嶇绺鹃妴? *
 * 鐠佹崘顓搁惄顔界垼閿? * 1. 娣囨繃瀵?regl 閻ㄥ嫯鐨熼悽銊╊棑閺嶇》绱癭regl({...})` 鏉╂柨娲栨稉鈧稉顏呮＆閸欘垰缍嬮崙鑺ユ殶鐠嬪啰鏁ら妴浣稿嫉閼虫垝缍旀稉? *    scope / batch 娴ｈ法鏁ら惃鍕嚒娴犮們鈧? * 2. 閺€鎯х磾閺冄呭閻?`new Function` 娴狅絿鐖滈悽鐔稿灇閿涘本鏁兼稉鎭掆偓宀勵暕缂傛牞鐦уЧ鍌氣偓鐓庢珤 + 閺勬儳绱＄拋鈥冲灊閵嗗秲鈧? *    鏉╂瑦鐗遍崗鐓庮啇 CSP閵嗕礁褰茬拠缁樷偓褎娲挎總濮愨偓浣风瘍閺囨潙顔愰弰鎾村⒖鐏?WebGL2閵? * 3. 閸忔娊鏁悜顓＄熅瀵板嫸绱欓悩鑸碘偓浣碘偓渚€銆婇悙鐟扮潣閹佲偓涔絥iform 娑撳﹣绱堕敍澶婃晼闁插繐浠涢崚浼存祩閸掑棝鍘ら妴浣稿讲缂傛挸鐡ㄩ妴? *
 * 閸涙垝鎶ら惃鍕瑏缁夊秵澧界悰灞灸佸蹇ョ窗
 * - draw閿涙矮绱堕崗?props 鐎电钖勯敍灞惧⒔鐞涘奔绔村▎锛勭帛閸掕绱? * - batch閿涙矮绱堕崗銉︽殶缂佸嫭鍨ㄩ弫鏉跨摟閿涘本瀵?props 閹靛綊鍣虹紒妯哄煑閿? * - scope閿涙矮绱堕崗銉ユ礀鐠嬪喛绱濋幎濠佺瑐娑撳鏋?閻樿埖鈧?uniform/attribute 缁涘顔曠純顔昏礋閵嗗奔缍旈悽銊ョ厵閵嗗稄绱? *   閸︺劌娲栫拫鍐ㄥ敶闁劍澧界悰宀€娈戠€涙劕鎳℃禒銈勭窗缂佈勫鏉╂瑤绨虹拋鍓х枂閵? */

import {
  DEV,
  check,
  checkCommand,
  checkCommandType,
  checkParameter,
  commandRaise,
  raise
} from '../util/check'
import { GL, primitiveTypes } from '../util/constants'
import { compileValue, EvalContext, CompiledValue, isDynamic } from './dynamic'
import {
  StateName,
  STATE_NAMES,
  applyStateValue,
  validateStateValue,
  isStateName
} from './state'
import {
  ProgramInfo,
  ShaderStore,
  uniformTypeInfo
} from './shader'
import type { Capabilities, GLContext } from './capabilities'
import type { Limits } from './limits'
import type { GLStateCache } from './state'
import type { BufferStore, Buffer } from '../resources/buffer'
import { isBufferData } from '../resources/buffer'
import {
  ElementBuffer,
  ElementsStore,
  ElementsWrapper,
  isElements
} from '../resources/elements'
import type {
  TextureStore,
  TextureInternal,
  Texture2DWrapper,
  TextureCubeWrapper,
  Texture3DWrapper,
  Texture2DArrayWrapper
} from '../resources/texture'
import {
  isTexture2D,
  isTextureCube,
  isTexture3D,
  isTexture2DArray
} from '../resources/texture'
import type {
  FramebufferStore,
  FramebufferInternal
} from '../resources/framebuffer'
import { isFramebuffer, isFramebufferCube } from '../resources/framebuffer'
import type { VertexArrayStore, VertexArray, VertexArrayWrapper } from '../resources/vao'
import { getVAO } from '../resources/vao'
import type { SamplerStore, SamplerInternal } from '../resources/sampler'
import { isSampler } from '../resources/sampler'
import {
  isUniformBuffer,
  isUniformBlockDescriptor,
  isUniformBlockValues,
  makeUniformBlockLayout,
  packUniformBlock,
  uniformBlockSignature,
  uploadUniformBlockData,
  UniformBlockLayout
} from '../resources/uniformbuffer'
import type { UniformBufferWrapper } from '../resources/uniformbuffer'

import {
  AttributeRecord,
  ATTRIB_STATE_CONSTANT,
  parseAttributeValue
} from './attribute'

export interface CommandStats {
  gpuTime: number
  cpuTime: number
  count: number
}

export interface TimerLike {
  beginQuery(stats: CommandStats): void
  endQuery(): void
}

export interface CommandRuntime {
  readonly gl: GLContext
  readonly caps: Capabilities
  readonly limits: Limits
  readonly state: GLStateCache
  readonly shaders: ShaderStore
  readonly buffers: BufferStore
  readonly elements: ElementsStore
  readonly textures: TextureStore
  readonly samplers: SamplerStore
  readonly framebuffers: FramebufferStore
  readonly vaos: VertexArrayStore
  readonly scope: ScopeState
  /** 濮ｅ繐鎶氭稉濠佺瑓閺傚洤顕挒鈽呯礄閺冨爼妫块妴浣筋潒閸欙絽鏄傜€靛摜鐡戦敍澶堚偓?*/
  readonly context: Record<string, unknown>
  readonly profile: boolean
  readonly timer: TimerLike | null
  readonly stats: {
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
  }
  contextLost: boolean
  /** 瑜版挸澧?batch id閿涙硜egl.batch 閸愬懏澧嶉張澶婂З閹礁褰夐柌蹇撳彙娴滎偁鈧?*/
  batchId: number
  currentFramebuffer: FramebufferInternal | null
  ensureUsable(): void
  bindFramebuffer(fb: FramebufferInternal | null): void
}

  /** scope 閸涙垝鎶ら崗鍙橀煩閻ㄥ嫮濮搁幀浣碘偓?*/
  export class ScopeState {
  attributes = new Map<string, AttributeRecord>()
  uniforms = new Map<string, unknown>()
  uniformBlocks = new Map<string, unknown>()
  shader: { vert?: string; frag?: string } = {}
  draw: {
    elements?: ElementBuffer | unknown
    count?: number
    offset?: number
    instances?: number
    primitive?: number
  } = {}
  vao: VertexArray | null = null
  framebuffer: FramebufferInternal | null | undefined = undefined

  snapshot(): ScopeSnapshot {
    return {
      attributes: new Map(this.attributes),
      uniforms: new Map(this.uniforms),
      uniformBlocks: new Map(this.uniformBlocks),
      shader: { ...this.shader },
      draw: { ...this.draw },
      vao: this.vao,
      framebuffer: this.framebuffer
    }
  }

  restore(snapshot: ScopeSnapshot): void {
    this.attributes = snapshot.attributes
    this.uniforms = snapshot.uniforms
    this.uniformBlocks = snapshot.uniformBlocks
    this.shader = snapshot.shader
    this.draw = snapshot.draw
    this.vao = snapshot.vao
    this.framebuffer = snapshot.framebuffer
  }
}

interface ScopeSnapshot {
  attributes: Map<string, AttributeRecord>
  uniforms: Map<string, unknown>
  uniformBlocks: Map<string, unknown>
  shader: { vert?: string; frag?: string }
  draw: ScopeState['draw']
  vao: VertexArray | null
  framebuffer: FramebufferInternal | null | undefined
}

/** 缂傛牞鐦ч崥搴ｆ畱閸涙垝鎶ょ拋鈥冲灊閵?*/
export interface CommandPlan {
  commandName: string
  /** 闂堟瑦鈧胶濮搁幀浣糕偓纭风礄閸欘垶鈧鎻╅柅鐔荤熅瀵板嫸绱氶妴?*/
  state: Map<StateName, CompiledValue>
  /** 閸斻劍鈧胶娈戝畵灞筋殰閻樿埖鈧礁顕挒鈽呯礉娓氬顩?blend: regl.prop('blend')閵?*/
  nestedState: { prefix: string; value: CompiledValue }[]
  framebuffer?: CompiledValue
  hasFramebuffer: boolean
  viewport?: CompiledValue

  elements?: CompiledValue
  staticElements: ElementBuffer | null
  ownedElements: ElementsWrapper[] | null

  count?: CompiledValue
  offset?: CompiledValue
  instances?: CompiledValue
  primitive?: CompiledValue

  vao?: CompiledValue
  staticVAO: VertexArray | null
  ownedVAO: VertexArrayWrapper | null
  /** 娴ｈ法鏁?VAO 閺冭绱漚ttributes 鐞氼偄鎷烽悾銉ｂ偓?*/
  useVAO: boolean

  vert?: CompiledValue
  frag?: CompiledValue

  attributes: Map<string, CompiledAttribute>
  uniforms: Map<string, CompiledValue>
  uniformBlocks: Map<string, CompiledValue>
  context: Map<string, CompiledValue>
  profile?: CompiledValue

  /** 闂堟瑦鈧胶绱拠鎴炴閻╁瓨甯村妤€鍩岄惃?program閵?*/
  programPlan: ProgramPlan | null
  /** 閸斻劍鈧?shader 閺冨墎娈?per-program 鐠佲€冲灊缂傛挸鐡ㄩ妴?*/
  programPlans: Map<number, ProgramPlan>
  /** 閸涙垝鎶ら懛顏勭箒閸掓稑缂撻獮鎯扮鐠愶綁鏀㈠В浣烘畱 buffer閵?*/
  ownedBuffers: Buffer[]
  /** 閺勬儳绱?attribute location 缂佹垵鐣鹃妴?*/
  attribLocations: [number, string][] | null
}

interface CompiledAttribute {
  value: CompiledValue
  /** 闂堟瑦鈧浇袙閺嬫劕銈介惃鍕唶瑜版洏鈧?*/
  record?: AttributeRecord
  /** 闂堟瑦鈧礁鍞撮懕鏃€鏆熼幑顔碱嚠鎼存梻娈?buffer閵?*/
  ownedBuffer?: Buffer
}

interface ProgramPlan {
  program: ProgramInfo
  attributes: AttributePlan[]
  uniforms: UniformPlan[]
  blocks: UniformBlockPlan[]
  /** 閺嬪嫬缂撻弮鍓佹畱閸欏秴鐨犻悧鍫熸拱閿涙硜estore 閸氬孩宓佸銈呭煕閺?location閵?*/
  version: number
}

interface UniformBlockPlan {
  info: ProgramInfo['uniformBlocks'][number]
  value: CompiledValue | null
  /** Phase 2閿涙氨绮ㄩ弸鍕閸婅壈鍤滈崝銊﹀ⅵ閸栧懍濞囬悽銊ф畱閸愬懘鍎?UBO閵?*/
  owned?: OwnedUniformBlock
}

interface OwnedUniformBlock {
  buffer: Buffer
  layout: UniformBlockLayout
  signature: string
  blockInfo: ProgramInfo['uniformBlocks'][number]
  lastBytes: Uint8Array | null
  lastHandle: WebGLBuffer | null
}

interface AttributePlan {
  name: string
  location: number
  typeSize: number
  /** 閺勵垰鎯佺€电懓绨?shader 娑擃厾娈戦弫瀛樻殶 attribute閿涘潟vec/uvec/int/uint閿涘鈧?*/
  integer: boolean
  value: CompiledValue | null
}

interface UniformPlan {
  name: string
  location: WebGLUniformLocation
  type: number
  value: CompiledValue | null
  /** 閺佹壆绮?uniform 閻ㄥ嫬鐔€閸氬稄绱濇笟瀣洤 u[2] -> u閵?*/
  arrayBase?: string
  arrayIndex?: number
}

/** 閻劍鍩涢崣顖濐潌閻ㄥ嫬鎳℃禒銈呭毐閺佽埇鈧?*/
export interface REGLCommand {
  (props?: Record<string, unknown>): void
  (count: number, body: CommandBody): void
  (props: Record<string, unknown>[], body: CommandBody): void
  (body: CommandBody): void
  stats: CommandStats
  /** 閸欐牕绶?program 娑擃厽鐓囨稉?uniform block 閻ㄥ嫬鍙曞鈧敮鍐ㄧ湰閿涘牓娼ら幀?shader 缂傛牞鐦ч崥搴″祮閸欘垳鏁ら敍澶堚偓?*/
  uniformBlockLayout(blockName: string): UniformBlockLayout | null
  destroy(): void
}

export type CommandBody = (
  context: Record<string, unknown>,
  props: Record<string, unknown> | null,
  batchId: number
) => void

// ---------------------------------------------------------------------------
// 闁銆嶉幍浣搁挬閸?// ---------------------------------------------------------------------------
const NESTED_KEYS = [
  'blend',
  'depth',
  'cull',
  'stencil',
  'polygonOffset',
  'scissor',
  'sample'
]

const OPTION_KEYS = new Set([
  'vert',
  'frag',
  'attributes',
  'uniforms',
  'uniformBlocks',
  'context',
  'framebuffer',
  'elements',
  'count',
  'offset',
  'instances',
  'primitive',
  'vao',
  'profile',
  ...STATE_NAMES
])

/**
 * 閹跺﹦鏁ら幋鐑解偓澶愩€嶉崢瀣挬閿? *   blend: { enable: true, func: {...} } -> 'blend.enable', 'blend.func'
 *   stencil: { op: {...} }              -> 'stencil.opFront', 'stencil.opBack'
 *
 * 婵″倹鐏夊畵灞筋殰鐎电钖勯弫缈犵秼閺勵垰濮╅幀浣糕偓纭风礄婵?blend: regl.prop('blend')閿涘绱濋崚娆庣箽閻ｆ瑤璐? * dynamicNested閿涘苯婀紒妯哄煑閺冭泛鍟€鐏炴洖绱戦妴? */
function flattenOptions(options: Record<string, unknown>): {
  flat: Map<string, unknown>
  nested: { prefix: string; value: unknown }[]
} {
  const flat = new Map<string, unknown>()
  const nested: { prefix: string; value: unknown }[] = []

  for (const key of Object.keys(options)) {
    const value = options[key]
    // 閸忎浇顔忛弰鎯х础閸?undefined 鐞涖劎銇氶妴灞肩瑝鐠佸墽鐤嗙拠銉┾偓澶愩€嶉妴宥忕礉閺傞€涚┒閺夆€叉瀵繘鍘ょ純?
if (value === undefined) continue
    if (NESTED_KEYS.indexOf(key) >= 0) {
      if (isDynamicLike(value)) {
        nested.push({ prefix: key, value })
        continue
      }
      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>
        for (const prop of Object.keys(obj)) {
          let propName = prop
          let propValue = obj[prop]
          if (key === 'stencil' && prop === 'op') {
            flat.set('stencil.opFront', propValue)
            flat.set('stencil.opBack', propValue)
            continue
          }
          const name = `${key}.${propName}`
          if (!isStateName(name)) {
            if (DEV) {
              raise(`unknown parameter "${name}"`)
            }
            continue
          }
          flat.set(name, propValue)
        }
        continue
      }
      // 閸忎浇顔?blend: true 娑斿琚惃鍕暆閸愭瑱绱祌egl 娑撳秵鏁幐渚婄礉閻╁瓨甯撮幎銉╂晩
      commandRaise(`invalid ${key} option`)
    }

    if (key === 'stencil' || key === 'attributes' || key === 'uniforms' || key === 'context') {
      // 閻㈠崬鎮囬懛顏勫瀻閺€顖氼槱閻?
}

    flat.set(key, value)
  }

  return { flat, nested }
}

function isDynamicLike(value: unknown): boolean {
  return isDynamic(value)
}

// ---------------------------------------------------------------------------
// 缂傛牞鐦?// ---------------------------------------------------------------------------
let COMMAND_COUNTER = 0

export function compileCommand(
  runtime: CommandRuntime,
  options: Record<string, unknown>
): REGLCommand {
  check(!!options, 'invalid args to regl({...})')
  checkCommandType(options, 'object', 'invalid args to regl({...})')

  const commandName = `anonymous_${COMMAND_COUNTER++}`
  const { flat, nested } = flattenOptions(options)

  // -------------------------------------------------------------------------
  // 閺嶏繝鐛欓張顏嗙叀閸欏倹鏆?  // -------------------------------------------------------------------------
if (DEV) {
    for (const key of flat.keys()) {
      if (!OPTION_KEYS.has(key)) {
        commandRaise(`unknown parameter "${key}"`, commandName)
      }
    }
  }

  // -------------------------------------------------------------------------
  // 閻樿埖鈧?  // -------------------------------------------------------------------------
const state = new Map<StateName, CompiledValue>()
  for (const key of STATE_NAMES) {
    if (!flat.has(key)) continue
    const value = flat.get(key)
    const compiled = compileValue(value)
    if (!compiled.dynamic) {
      validateStateValue(key, compiled.staticValue, commandName)
    }
    state.set(key, compiled)
  }

  const nestedState = nested.map((entry) => ({
    prefix: entry.prefix,
    value: compileValue(entry.value)
  }))

  // -------------------------------------------------------------------------
  // framebuffer / viewport / scissor
  // -------------------------------------------------------------------------
const hasFramebuffer = flat.has('framebuffer')
  const framebuffer = hasFramebuffer
    ? compileValue(flat.get('framebuffer'))
    : undefined
  let viewport: CompiledValue | undefined
  if (flat.has('viewport')) {
    viewport = compileValue(flat.get('viewport'))
    const v = viewport
    if (!v.dynamic) {
      validateBox(v.staticValue, 'viewport', commandName)
    }
  }

  // -------------------------------------------------------------------------
  // 缂佹ê鍩楅崣鍌涙殶
  // -------------------------------------------------------------------------
const elementsValue = flat.get('elements')
  let elements: CompiledValue | undefined
  let staticElements: ElementBuffer | null = null
  let ownedElements: ElementsWrapper[] | null = null

  if (flat.has('elements')) {
    if (elementsValue === null || elementsValue === undefined) {
      elements = compileValue(elementsValue)
    } else if (isElements(elementsValue)) {
      staticElements = (elementsValue as { _elements: ElementBuffer })._elements
      elements = compileValue(elementsValue)
    } else if (isBufferData(elementsValue)) {
      const wrapper = runtime.elements.create(
        elementsValue as Parameters<ElementsStore['create']>[0]
      )
      staticElements = wrapper._elements
      ownedElements = [wrapper]
      elements = compileValue(wrapper)
    } else if (isElementsConfig(elementsValue)) {
      const wrapper = runtime.elements.create(
        elementsValue as Parameters<ElementsStore['create']>[0]
      )
      staticElements = wrapper._elements
      ownedElements = [wrapper]
      elements = compileValue(wrapper)
    } else if (isDynamicLike(elementsValue)) {
      elements = compileValue(elementsValue)
    } else {
      commandRaise('invalid elements', commandName)
    }
  }

  const count = flat.has('count') ? compileValue(flat.get('count')) : undefined
  if (count && !count.dynamic) {
    const c = count.staticValue as number
    checkCommand(
      typeof c === 'number' && c >= 0 && (c | 0) === c,
      'invalid vertex count',
      commandName
    )
  }

  const offset = flat.has('offset') ? compileValue(flat.get('offset')) : undefined
  if (offset && !offset.dynamic) {
    const o = offset.staticValue as number
    checkCommand(
      typeof o === 'number' && o >= 0 && (o | 0) === o,
      'invalid offset',
      commandName
    )
  }

  const instances = flat.has('instances')
    ? compileValue(flat.get('instances'))
    : undefined
  if (instances && !instances.dynamic) {
    const i = instances.staticValue as number
    checkCommand(
      typeof i === 'number' && i >= 0 && (i | 0) === i,
      'invalid instances',
      commandName
    )
  }

  const primitive = flat.has('primitive')
    ? compileValue(flat.get('primitive'))
    : undefined
  if (primitive && !primitive.dynamic) {
    checkParameter(primitive.staticValue, primitiveTypes, 'invalid primitive')
  }

  // -------------------------------------------------------------------------
  // VAO
  // -------------------------------------------------------------------------
let vao: CompiledValue | undefined
  let staticVAO: VertexArray | null = null
  let ownedVAO: VertexArrayWrapper | null = null
  let useVAO = false

  if (flat.has('vao')) {
    const v = flat.get('vao')
    if (v !== null && v !== undefined) {
      useVAO = true
      if (isVAOValue(v)) {
        staticVAO = getVAO(v)
        vao = compileValue(v)
      } else if (typeof v === 'object' && !isDynamicLike(v)) {
        ownedVAO = runtime.vaos.create(v as never)
        staticVAO = ownedVAO._vao
        vao = compileValue(ownedVAO)
      } else {
        vao = compileValue(v)
        if (!vao.dynamic) {
          commandRaise('invalid vao', commandName)
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // shader
  // -------------------------------------------------------------------------
const vert = flat.has('vert') ? compileValue(flat.get('vert')) : undefined
  const frag = flat.has('frag') ? compileValue(flat.get('frag')) : undefined
  if (vert && !vert.dynamic) {
    checkCommandType(vert.staticValue, 'string', 'missing vertex shader', commandName)
  }
  if (frag && !frag.dynamic) {
    checkCommandType(frag.staticValue, 'string', 'missing fragment shader', commandName)
  }

  // -------------------------------------------------------------------------
  // attributes
  // -------------------------------------------------------------------------
const attributeOption = (flat.get('attributes') || {}) as Record<string, unknown>
  checkCommandType(attributeOption, 'object', 'invalid attributes', commandName)
  const attributes = new Map<string, CompiledAttribute>()
  const ownedBuffers: Buffer[] = []
  let attribLocations: [number, string][] | null = null

  const attributeKeys = Object.keys(attributeOption)
  if (attributeKeys.length > 0) {
    // 婵″倹鐏夐幍鈧張澶娾偓濂稿厴閺勵垱鏆熺€涙绱濋崚娆掝潒娑撶儤妯夊?attribute location閿涘牓鍘ら崥?VAO 娴ｈ法鏁ら敍?
let allNumbers = true
    for (const name of attributeKeys) {
      if (typeof attributeOption[name] !== 'number') {
        allNumbers = false
        break
      }
    }
    if (allNumbers) {
      // 閺勬儳绱?attribute location 閻劋绨柊宥呮値 VAO閿涘牆鎳℃禒銈堝殰闊偅鍨?scope 娑擃厽褰佹笟娑崇礆
      useVAO = true
      attribLocations = attributeKeys.map((name) => [
        attributeOption[name] as number,
        name
      ])
    } else {
      for (const name of attributeKeys) {
        const raw = attributeOption[name]
        const compiled = compileValue(raw)
        if (!compiled.dynamic && !useVAO) {
          const parsed = parseAttributeValue(
            compiled.staticValue,
            runtime.buffers,
            'static'
          )
          if (parsed.createdBuffer) ownedBuffers.push(parsed.createdBuffer)
          attributes.set(name, {
            value: compiled,
            record: parsed.record,
            ownedBuffer: parsed.createdBuffer || undefined
          })
        } else {
          attributes.set(name, { value: compiled })
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // uniforms / context
  // -------------------------------------------------------------------------
const uniformOption = (flat.get('uniforms') || {}) as Record<string, unknown>
  checkCommandType(uniformOption, 'object', 'invalid uniforms', commandName)
  const uniforms = new Map<string, CompiledValue>()
  for (const name of Object.keys(uniformOption)) {
    uniforms.set(name, compileValue(uniformOption[name]))
  }

  const uniformBlockOption = (flat.get('uniformBlocks') || {}) as Record<
    string,
    unknown
  >
  checkCommandType(
    uniformBlockOption,
    'object',
    'invalid uniformBlocks',
    commandName
  )
  const uniformBlocks = new Map<string, CompiledValue>()
  const uniformBlockNames = Object.keys(uniformBlockOption)
  if (uniformBlockNames.length > 0 && !runtime.caps.isWebGL2) {
    commandRaise('uniform blocks require WebGL2', commandName)
  }
  for (const name of uniformBlockNames) {
    uniformBlocks.set(name, compileValue(uniformBlockOption[name]))
  }

  const contextOption = (flat.get('context') || {}) as Record<string, unknown>
  checkCommandType(contextOption, 'object', 'invalid context', commandName)
  const context = new Map<string, CompiledValue>()
  for (const name of Object.keys(contextOption)) {
    context.set(name, compileValue(contextOption[name]))
  }

  const profile = flat.has('profile')
    ? compileValue(flat.get('profile'))
    : undefined

  // -------------------------------------------------------------------------
  // 缂佸嫯顥婄拋鈥冲灊
  // -------------------------------------------------------------------------
const plan: CommandPlan = {
    commandName,
    state,
    nestedState,
    framebuffer,
    hasFramebuffer,
    viewport,
    elements,
    staticElements,
    ownedElements,
    count,
    offset,
    instances,
    primitive,
    vao,
    staticVAO,
    ownedVAO,
    useVAO,
    vert,
    frag,
    attributes,
    uniforms,
    uniformBlocks,
    context,
    profile,
    programPlan: null,
    programPlans: new Map(),
    ownedBuffers,
    attribLocations
  }

  // 闂堟瑦鈧?shader 缁斿宓嗙紓鏍槯閿涘苯鏁栭弮鈺傛瘹闂囨煡鏁婄拠?
if (vert && frag && !vert.dynamic && !frag.dynamic) {
    const program = runtime.shaders.program(
      vert.staticValue as string,
      frag.staticValue as string,
      attribLocations,
      commandName
    )
    plan.programPlan = buildProgramPlan(plan, program)
  }

  return createCommandFunction(runtime, plan)
}

function isVAOValue(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as { _reglType?: string })._reglType === 'vao'
  )
}

/** elements 閻ㄥ嫰鍘ょ純顔碱嚠鐠炩槄绱欐稉宥嗘Ц閺佺増宓侀妴浣风瘍娑撳秵妲哥挧鍕爱閿涘鈧?*/
function isElementsConfig(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !ArrayBuffer.isView(value) &&
    !('shape' in (value as object) && 'stride' in (value as object)) &&
    ('data' in (value as object) ||
      'count' in (value as object) ||
      'length' in (value as object) ||
      'primitive' in (value as object))
  )
}

function validateBox(value: unknown, name: string, command: string): void {
  checkCommand(!!value && typeof value === 'object', `invalid ${name}`, command)
  const box = value as Record<string, unknown>
  if ('width' in box) {
    checkCommand(
      typeof box.width === 'number' && (box.width as number) >= 0,
      `invalid ${name}`,
      command
    )
  }
  if ('height' in box) {
    checkCommand(
      typeof box.height === 'number' && (box.height as number) >= 0,
      `invalid ${name}`,
      command
    )
  }
}

// ---------------------------------------------------------------------------
// Program 鐠佲€冲灊
// ---------------------------------------------------------------------------

function buildProgramPlan(
  plan: CommandPlan,
  program: ProgramInfo
): ProgramPlan {
  const attributes: AttributePlan[] = []
  for (const info of program.attributes) {
    let value = plan.attributes.get(info.name)?.value || null
    // 閸忕厧顔?webgl2 缂佹挻鐎担鎾存殶缂佸嫸绱癮ttribute 閸氬秶袨娑撯偓閼割兛绗夌敮锔芥殶缂佸嫪绗呴弽鍥风礉閺冪娀娓舵径鍕倞
    attributes.push({
      name: info.name,
      location: info.location as number,
      typeSize: attributeTypeSize(info.type),
      integer: isIntegerAttributeType(info.type),
      value
    })
  }

  const uniforms: UniformPlan[] = []
  for (const info of program.uniforms) {
    let value = plan.uniforms.get(info.name) || null
    let arrayBase: string | undefined
    let arrayIndex: number | undefined
    if (!value) {
      const match = /^(.+)\[(\d+)\]$/.exec(info.name)
      if (match) {
        const base = plan.uniforms.get(match[1])
        if (base) {
          value = base
          arrayBase = match[1]
          arrayIndex = parseInt(match[2], 10)
        }
      }
    }
    uniforms.push({
      name: info.name,
      location: info.location as WebGLUniformLocation,
      type: info.type,
      value,
      arrayBase,
      arrayIndex
    })
  }

  const blocks: UniformBlockPlan[] = []
  for (const info of program.uniformBlocks) {
    const value = plan.uniformBlocks.get(info.name) || null
    if (value && !value.dynamic) {
      attachStaticUniformBlock(value.staticValue, info)
    }
    blocks.push({ info, value })
  }

  return { program, attributes, uniforms, blocks, version: program.version }
}

function attachStaticUniformBlock(value: unknown, info: ProgramInfo['uniformBlocks'][number]): void {
  if (isUniformBuffer(value)) {
    value.attachLayout(info)
  } else if (isUniformBlockDescriptor(value)) {
    value.buffer.attachLayout(info)
  }
}

/**
 * 娑撳﹣绗呴弬鍥ㄤ划婢跺秴鎮?program 閻?uniform/attribute location 娴兼艾褰夐崠鏍モ偓? * 鏉╂瑩鍣烽幐澶婃倳缁変即鍣搁弬鏉挎倱濮濄儰绔村▎鈽呯幢濮濓絽鐖堕幆鍛枌娑?version 閻╃鎮撻敍宀€娲块幒銉ㄧ箲閸ョ偑鈧? */
function refreshProgramPlan(plan: ProgramPlan): ProgramPlan {
  if (plan.version === plan.program.version) return plan
  for (const attribute of plan.attributes) {
    const info = plan.program.attributes.find((a) => a.name === attribute.name)
    if (info) attribute.location = info.location as number
  }
  for (const uniform of plan.uniforms) {
    const info = plan.program.uniforms.find((u) => u.name === uniform.name)
    if (info) uniform.location = info.location as WebGLUniformLocation
  }
  // block 娣団剝浼呴崷?restore 閸氬孩妲搁弬鎵畱鐎电钖勯敍灞惧瘻閸氬秶袨閸氬本顒?
for (const block of plan.blocks) {
    const info = plan.program.uniformBlocks.find(
      (b) => b.name === block.info.name
    )
    if (info) block.info = info
  }
  plan.version = plan.program.version
  return plan
}

/** shader 娑?attribute 缁鐎烽惃鍕瀻闁插繑鏆熼妴?*/
function attributeTypeSize(type: number): number {
  switch (type) {
    case GL.FLOAT_VEC2:
    case GL.INT_VEC2:
    case GL.UNSIGNED_INT_VEC2:
    case GL.BOOL_VEC2:
      return 2
    case GL.FLOAT_VEC3:
    case GL.INT_VEC3:
    case GL.UNSIGNED_INT_VEC3:
    case GL.BOOL_VEC3:
      return 3
    case GL.FLOAT_VEC4:
    case GL.INT_VEC4:
    case GL.UNSIGNED_INT_VEC4:
    case GL.BOOL_VEC4:
      return 4
    default:
      return 1
  }
}

/** WebGL2 娑擃參娓剁憰?vertexAttribIPointer 閻?attribute 缁鐎烽妴?*/
function isIntegerAttributeType(type: number): boolean {
  switch (type) {
    case GL.INT:
    case GL.INT_VEC2:
    case GL.INT_VEC3:
    case GL.INT_VEC4:
    case GL.UNSIGNED_INT:
    case GL.UNSIGNED_INT_VEC2:
    case GL.UNSIGNED_INT_VEC3:
    case GL.UNSIGNED_INT_VEC4:
      return true
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// 閸涙垝鎶ら崙鑺ユ殶
// ---------------------------------------------------------------------------
const EMPTY_PROPS: Record<string, unknown>[] = []

function createCommandFunction(
  runtime: CommandRuntime,
  plan: CommandPlan
): REGLCommand {
  const stats: CommandStats = { gpuTime: 0, cpuTime: 0, count: 0 }

  function REGLCommand(this: unknown, args?: unknown, body?: unknown): unknown {
    runtime.ensureUsable()

    if (typeof args === 'function') {
      return executeScope(runtime, plan, stats, this, undefined, args as CommandBody, runtime.batchId)
    }
    if (typeof body === 'function') {
      if (typeof args === 'number') {
        for (let i = 0; i < (args | 0); ++i) {
          executeScope(runtime, plan, stats, this, undefined, body as CommandBody, runtime.batchId + i)
        }
        return
      }
      if (Array.isArray(args)) {
        for (let i = 0; i < args.length; ++i) {
          executeScope(runtime, plan, stats, this, args[i], body as CommandBody, runtime.batchId + i)
        }
        return
      }
      return executeScope(
        runtime,
        plan,
        stats,
        this,
        args as Record<string, unknown> | undefined,
        body as CommandBody,
        runtime.batchId
      )
    }

    if (typeof args === 'number') {
      const n = args | 0
      if (n > 0) {
        return executeBatch(runtime, plan, stats, this, EMPTY_PROPS, n)
      }
      return
    }
    if (Array.isArray(args)) {
      if (args.length) {
        return executeBatch(runtime, plan, stats, this, args, args.length)
      }
      return
    }
    return executeDraw(runtime, plan, stats, this, args as Record<string, unknown> | undefined)
  }

  ;(REGLCommand as unknown as REGLCommand).stats = stats
  ;(REGLCommand as unknown as REGLCommand).uniformBlockLayout = (
    blockName: string
  ): UniformBlockLayout | null => {
    const find = (programPlan: ProgramPlan): UniformBlockLayout | null => {
      const block = programPlan.blocks.find(
        (b) => b.info.name === blockName
      )
      return block ? makeUniformBlockLayout(block.info) : null
    }
    if (plan.programPlan) {
      const layout = find(plan.programPlan)
      if (layout) return layout
    }
    for (const programPlan of plan.programPlans.values()) {
      const layout = find(programPlan)
      if (layout) return layout
    }
    return null
  }
  ;(REGLCommand as unknown as REGLCommand).destroy = () => {
    destroyPlan(runtime, plan)
  }

  return REGLCommand as unknown as REGLCommand
}

function destroyPlan(runtime: CommandRuntime, plan: CommandPlan): void {
  if (plan.programPlan) {
    for (const block of plan.programPlan.blocks) {
      destroyOwnedUniformBlock(runtime, block)
    }
    const program = plan.programPlan.program.program
    runtime.shaders.destroyProgram(plan.programPlan.program)
    runtime.state.forgetProgram(program)
    plan.programPlan = null
  }
  for (const programPlan of plan.programPlans.values()) {
    for (const block of programPlan.blocks) {
      destroyOwnedUniformBlock(runtime, block)
    }
    const program = programPlan.program.program
    runtime.shaders.destroyProgram(programPlan.program)
    runtime.state.forgetProgram(program)
  }
  plan.programPlans.clear()
  for (const buffer of plan.ownedBuffers) {
    if (buffer.handle) runtime.buffers.destroy(buffer)
  }
  plan.ownedBuffers.length = 0
  if (plan.ownedElements) {
    for (const elements of plan.ownedElements) {
      elements.destroy()
    }
    plan.ownedElements = null
  }
  if (plan.ownedVAO) {
    plan.ownedVAO.destroy()
    plan.ownedVAO = null
  }
}

// ---------------------------------------------------------------------------
// 缂佹ê鍩楁稉濠佺瑓閺?// ---------------------------------------------------------------------------

interface DrawFrame {
  thisArg: unknown
  props: unknown
  context: Record<string, unknown>
  batchId: number
}

/** 鎼存梻鏁?context 鐟曞棛娲婇敍宀冪箲閸ョ偞浠径宥呭毐閺佽埇鈧?*/
function applyContext(
  runtime: CommandRuntime,
  plan: CommandPlan,
  frame: DrawFrame
): (() => void) | null {
  if (plan.context.size === 0) return null
  const saves: [string, unknown][] = []
  for (const [name, value] of plan.context) {
    saves.push([name, runtime.context[name]])
    runtime.context[name] = value.resolve(frame as EvalContext)
  }
  return () => {
    for (const [name, old] of saves) {
      runtime.context[name] = old
    }
  }
}

/** 鐠侊紕鐣?framebuffer 鐏忓搫顕€电懓绨查惃鍕帛鐠?viewport閵?*/
function framebufferSize(
  runtime: CommandRuntime,
  fb: FramebufferInternal | null
): [number, number] {
  if (fb) return [fb.width, fb.height]
  return [
    runtime.gl.drawingBufferWidth,
    runtime.gl.drawingBufferHeight
  ]
}

function normalizeBox(
  value: unknown,
  fallbackWidth: number,
  fallbackHeight: number,
  name: string,
  command: string
): { x: number; y: number; width: number; height: number } {
  checkCommand(!!value && typeof value === 'object', `invalid ${name}`, command)
  const box = value as Record<string, unknown>
  const x = (box.x as number) | 0 || 0
  const y = (box.y as number) | 0 || 0
  const width =
    'width' in box ? ((box.width as number) | 0) : fallbackWidth - x
  const height =
    'height' in box ? ((box.height as number) | 0) : fallbackHeight - y
  checkCommand(
    width >= 0 && height >= 0,
    `invalid ${name}`,
    command
  )
  return { x, y, width, height }
}

/**
 * 缂佹垵鐣?framebuffer 楠炶埖娲块弬棰佺瑐娑撳鏋冮柌宀€娈?framebuffer 鐏忓搫顕妴? */
function setFramebuffer(
  runtime: CommandRuntime,
  fb: FramebufferInternal | null
): void {
  runtime.bindFramebuffer(fb)
  const [w, h] = framebufferSize(runtime, fb)
  runtime.context.framebufferWidth = w
  runtime.context.framebufferHeight = h
}

/**
 * 鐟欙絾鐎?command 閻?framebuffer 闁銆嶉敍娉唍defined 鐞涖劎銇氶妴灞肩瑝娣囶喗鏁奸妴宥冣偓? */
function resolveFramebuffer(
  runtime: CommandRuntime,
  plan: CommandPlan,
  frame: DrawFrame
): FramebufferInternal | null | undefined {
  if (!plan.framebuffer) return undefined
  const value = plan.framebuffer.resolve(frame as EvalContext)
  if (!value) return null
  if (isFramebufferCube(value)) {
    commandRaise('can not use a cube framebuffer directly, use framebufferCube.faces[i]', plan.commandName)
  }
  const fb = runtime.framebuffers.get(value)
  if (!fb) {
    commandRaise('invalid framebuffer object', plan.commandName)
  }
  return fb
}

// ---------------------------------------------------------------------------
// 閸楁洘顐肩紒妯哄煑
// ---------------------------------------------------------------------------

function executeDraw(
  runtime: CommandRuntime,
  plan: CommandPlan,
  stats: CommandStats,
  thisArg: unknown,
  props: Record<string, unknown> | undefined
): void {
  const frame: DrawFrame = {
    thisArg,
    props,
    context: runtime.context,
    batchId: runtime.batchId
  }
  const profiling = wantsProfile(runtime, plan, frame)
  const start = profiling ? now() : 0
  if (profiling && runtime.timer) runtime.timer.beginQuery(stats)

  const restoreContext = applyContext(runtime, plan, frame)
  const previousFramebuffer = runtime.currentFramebuffer
  const streams: { buffer: Buffer; stream: boolean }[] = []
  const streamElements: ElementBuffer[] = []
  const boundTextures: TextureInternal[] = []

  try {
    // framebuffer
const fb = resolveFramebuffer(runtime, plan, frame)
    if (fb !== undefined) {
      setFramebuffer(runtime, fb)
    }

    // viewport / scissor
const [fbWidth, fbHeight] = framebufferSize(runtime, runtime.currentFramebuffer)
    if (plan.viewport) {
      const box = normalizeBox(
        plan.viewport.resolve(frame as EvalContext),
        fbWidth,
        fbHeight,
        'viewport',
        plan.commandName
      )
      runtime.state.viewport(box.x, box.y, box.width, box.height)
      runtime.context.viewportWidth = box.width
      runtime.context.viewportHeight = box.height
    } else if (fb !== undefined) {
      runtime.state.viewport(0, 0, fbWidth, fbHeight)
      runtime.context.viewportWidth = fbWidth
      runtime.context.viewportHeight = fbHeight
    }

    // 閻樿埖鈧?
applyStatePlans(runtime, plan, frame)
    const scissorPlan = plan.state.get('scissor.box')
    if (scissorPlan) {
      const box = normalizeBox(
        scissorPlan.resolve(frame as EvalContext),
        fbWidth,
        fbHeight,
        'scissor.box',
        plan.commandName
      )
      runtime.state.scissor(box.x, box.y, box.width, box.height)
    }

    // VAO
const vao = resolveVAO(plan, frame, runtime.scope)
    if (vao) {
      vao.bind(runtime.state)
    }

    // program
const programPlan = ensureProgramPlan(runtime, plan, frame)
    runtime.state.useProgram(programPlan.program.program)
    bindUniformBlocks(runtime, plan, programPlan, frame)

    // attributes
if (!vao) {
      bindAttributes(runtime, plan, programPlan, frame, streams)
    }

    // uniforms
    uploadUniforms(runtime, programPlan, frame, boundTextures)

    // draw
    performDraw(
      runtime,
      plan,
      frame,
      vao,
      streamElements
    )

    if (profiling) stats.count++
  } finally {
    if (profiling) {
      stats.cpuTime += now() - start
      if (runtime.timer) runtime.timer.endQuery()
    }

    for (const texture of boundTextures) {
      runtime.textures.unbindTexture(texture)
    }
    for (const stream of streamElements) {
      runtime.elements.destroyStream(stream)
    }
    for (const entry of streams) {
      if (entry.stream) runtime.buffers.destroyStream(entry.buffer)
    }
    if (runtime.state.currentVAO) {
      // 鐟欙絿绮?VAO閿涘矂浼╅崗宥嗚杽閺屾挸鎮楃紒顓炴嚒娴?
if (runtime.caps.hasVAO) runtime.caps.bindVertexArray(null)
      runtime.state.currentVAO = null
      runtime.state.invalidateVertexArrays()
    }

    if (runtime.currentFramebuffer !== previousFramebuffer) {
      setFramebuffer(runtime, previousFramebuffer)
    }
    if (restoreContext) restoreContext()
  }
}

function applyStatePlans(
  runtime: CommandRuntime,
  plan: CommandPlan,
  frame: DrawFrame
): void {
  for (const [name, value] of plan.state) {
    if (name === 'scissor.box' || name === 'viewport') continue
    applyStateValue(
      runtime.state,
      name,
      value.resolve(frame as EvalContext),
      plan.commandName
    )
  }
  // 閸斻劍鈧礁绁垫總妤冨Ц閹礁顕挒?
for (const entry of plan.nestedState) {
    const object = entry.value.resolve(frame as EvalContext)
    if (!object || typeof object !== 'object') {
      commandRaise(`invalid ${entry.prefix}`, plan.commandName)
    }
    const obj = object as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      const stateName = `${entry.prefix}.${key}`
      if (entry.prefix === 'stencil' && key === 'op') {
        applyStateValue(runtime.state, 'stencil.opFront', obj[key], plan.commandName)
        applyStateValue(runtime.state, 'stencil.opBack', obj[key], plan.commandName)
        continue
      }
      if (!isStateName(stateName)) {
        commandRaise(`unknown parameter "${stateName}"`, plan.commandName)
      }
      applyStateValue(runtime.state, stateName as StateName, obj[key], plan.commandName)
    }
  }
  // scissor.box 闂団偓鐟曚焦鐗撮幑顔肩秼閸?framebuffer 鐏忓搫顕悰銉ュ弿 width/height
const scissor = plan.state.get('scissor.box')
  if (scissor) {
    const [w, h] = framebufferSize(runtime, runtime.currentFramebuffer)
    const box = normalizeBox(
      scissor.resolve(frame as EvalContext),
      w,
      h,
      'scissor.box',
      plan.commandName
    )
    runtime.state.scissor(box.x, box.y, box.width, box.height)
  }
}

function applyScissorPlan(
  runtime: CommandRuntime,
  plan: CommandPlan,
  frame: DrawFrame
): void {
  const scissor = plan.state.get('scissor.box')
  if (!scissor) return
  const [w, h] = framebufferSize(runtime, runtime.currentFramebuffer)
  const box = normalizeBox(
    scissor.resolve(frame as EvalContext),
    w,
    h,
    'scissor.box',
    plan.commandName
  )
  runtime.state.scissor(box.x, box.y, box.width, box.height)
}

/**
 * 鎼存梻鏁ら崝銊︹偓浣哥サ婵傛濮搁幀渚婄礄娓氬顩?blend: regl.prop('blend')閿涘鈧? * @param propDependent true 閸欘亜绨查悽銊ょ贩鐠?props 閻ㄥ嫰銆嶉敍娌燼lse 閸欘亜绨查悽銊ょ瑝娓氭繆绂?props 閻ㄥ嫰銆嶉妴? */
function applyNestedState(
  runtime: CommandRuntime,
  plan: CommandPlan,
  frame: DrawFrame,
  propDependent: boolean
): void {
  for (const entry of plan.nestedState) {
    if (entry.value.propDep !== propDependent) continue
    const object = entry.value.resolve(frame as EvalContext)
    if (!object || typeof object !== 'object') {
      commandRaise(`invalid ${entry.prefix}`, plan.commandName)
    }
    const obj = object as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      const name = `${entry.prefix}.${key}`
      if (entry.prefix === 'stencil' && key === 'op') {
        applyStateValue(runtime.state, 'stencil.opFront', obj[key], plan.commandName)
        applyStateValue(runtime.state, 'stencil.opBack', obj[key], plan.commandName)
        continue
      }
      if (!isStateName(name)) {
        commandRaise(`unknown parameter "${name}"`, plan.commandName)
      }
      applyStateValue(runtime.state, name as StateName, obj[key], plan.commandName)
    }
  }
}

function resolveVAO(
  plan: CommandPlan,
  frame: DrawFrame,
  scope: { vao: VertexArray | null }
): VertexArray | null {
  if (plan.vao) {
    const value = plan.vao.resolve(frame as EvalContext)
    if (value) {
      const vao = getVAO(value)
      if (!vao) {
        commandRaise('invalid vao', plan.commandName)
      }
      return vao
    }
    // 閺勬儳绱?vao 鐟欙絾鐎芥稉?null 閺冭绱濋崶鐐衡偓鈧崚?scope 閻?targetVAO閿涘牅绗?regl 娑撯偓閼疯揪绱?
return plan.useVAO ? scope.vao : null
  }
  // 闁俺绻?numeric attribute location 娴ｈ法鏁?VAO 閻ㄥ嫬鎳℃禒銈忕礉娴?scope 缂佈勫
if (plan.useVAO) {
    return scope.vao
  }
  return null
}

function ensureProgramPlan(
  runtime: CommandRuntime,
  plan: CommandPlan,
  frame: DrawFrame
): ProgramPlan {
  if (plan.programPlan) return refreshProgramPlan(plan.programPlan)

  const vert = plan.vert
    ? (plan.vert.resolve(frame as EvalContext) as string)
    : runtime.scope.shader.vert
  const frag = plan.frag
    ? (plan.frag.resolve(frame as EvalContext) as string)
    : runtime.scope.shader.frag

  if (typeof vert !== 'string' || !vert) {
    commandRaise('missing vertex shader', plan.commandName)
  }
  if (typeof frag !== 'string' || !frag) {
    commandRaise('missing fragment shader', plan.commandName)
  }

  const program = runtime.shaders.program(
    vert,
    frag,
    plan.attribLocations,
    plan.commandName
  )

  let programPlan = plan.programPlans.get(program.id)
  if (!programPlan) {
    programPlan = buildProgramPlan(plan, program)
    plan.programPlans.set(program.id, programPlan)
  }
  return refreshProgramPlan(programPlan)
}

function bindAttributes(
  runtime: CommandRuntime,
  plan: CommandPlan,
  programPlan: ProgramPlan,
  frame: DrawFrame,
  streams: { buffer: Buffer; stream: boolean }[]
): void {
  for (const binding of programPlan.attributes) {
    const user = binding.value
    let record: AttributeRecord | null = null

    if (user) {
      const compiled = plan.attributes.get(binding.name)!
      if (compiled.record) {
        record = compiled.record
      } else {
        const raw = user.resolve(frame as EvalContext)
        const parsed = parseAttributeValue(raw, runtime.buffers, 'dynamic')
        record = parsed.record
        if (parsed.createdBuffer) {
          streams.push({ buffer: parsed.createdBuffer, stream: parsed.stream })
        }
      }
    } else {
      record = runtime.scope.attributes.get(binding.name) || null
    }

    if (!record) {
      commandRaise(`missing attribute ${binding.name}`, plan.commandName)
    }

    applyAttribute(runtime, binding, record!, frame, streams)
  }
}

function applyAttribute(
  runtime: CommandRuntime,
  binding: AttributePlan,
  record: AttributeRecord,
  frame: DrawFrame,
  streams: { buffer: Buffer; stream: boolean }[]
): void {
  void frame
  void streams
  if (record.state === ATTRIB_STATE_CONSTANT || !record.buffer) {
    runtime.state.setAttributeConstant(
      binding.location,
      record.x,
      record.y,
      record.z,
      record.w,
      binding.integer
    )
    return
  }

  const buffer = record.buffer
  if (!buffer.handle) {
    commandRaise('attribute buffer has been destroyed')
  }
  const attributeType = record.type || buffer.dtype
  if (binding.integer && attributeType === GL.FLOAT) {
    commandRaise(
      `integer attribute "${binding.name}" requires an integer buffer type (int8/uint8/int16/uint16/int32/uint32)`
    )
  }
  runtime.state.setAttributePointer(binding.location, {
    buffer: buffer.handle!,
    size: record.size || binding.typeSize,
    type: attributeType,
    normalized: record.normalized,
    integer: binding.integer,
    stride: record.stride,
    offset: record.offset,
    divisor: record.divisor
  })
}

// ---------------------------------------------------------------------------
// uniform block 缂佹垵鐣?// ---------------------------------------------------------------------------

function ensureOwnedUniformBlock(
  runtime: CommandRuntime,
  block: UniformBlockPlan
): OwnedUniformBlock {
  const info = block.info
  let owned = block.owned

  if (
    owned &&
    owned.buffer.handle &&
    owned.buffer.byteLength >= info.dataSize &&
    owned.blockInfo === info
  ) {
    return owned
  }

  if (owned && owned.buffer.handle) {
    const signature = uniformBlockSignature(info)
    if (
      owned.buffer.byteLength >= info.dataSize &&
      owned.signature === signature
    ) {
      // restore / 闁插秵鏌婇柧鐐复閸氬簼淇婇幁顖氼嚠鐠炩€冲綁娴滃棴绱濇担鍡楃鐏炩偓閻╃鎮?      owned.blockInfo = info
      owned.layout = makeUniformBlockLayout(info)
      return owned
    }
    runtime.buffers.destroy(owned.buffer)
    block.owned = undefined
    owned = undefined
  }

  const wrapper = runtime.buffers.create(
    { length: info.dataSize, usage: 'dynamic' },
    GL.UNIFORM_BUFFER,
    false
  )
  owned = {
    buffer: wrapper._buffer,
    layout: makeUniformBlockLayout(info),
    signature: uniformBlockSignature(info),
    blockInfo: info,
    lastBytes: null,
    lastHandle: null
  }
  block.owned = owned
  return owned
}

function destroyOwnedUniformBlock(
  runtime: CommandRuntime,
  block: UniformBlockPlan
): void {
  if (!block.owned) return
  if (block.owned.buffer.handle) {
    runtime.buffers.destroy(block.owned.buffer)
  }
  block.owned = undefined
}

function isPlainBlockValues(
  value: unknown
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !ArrayBuffer.isView(value) &&
    !(value instanceof ArrayBuffer)
  )
}

function bindUniformBlocks(
  runtime: CommandRuntime,
  plan: CommandPlan,
  programPlan: ProgramPlan,
  frame: DrawFrame
): void {
  for (const block of programPlan.blocks) {
    const value = block.value
      ? block.value.resolve(frame as EvalContext)
      : runtime.scope.uniformBlocks.get(block.info.name)

    if (value === undefined || value === null) continue

    let owner: UniformBufferWrapper | null = null
    let buffer: Buffer
    let offset = 0
    let size = 0
    let binding = block.info.index
    let values: Record<string, unknown> | null = null

    if (isUniformBuffer(value)) {
      owner = value
      buffer = value._buffer
    } else if (isUniformBlockDescriptor(value)) {
      owner = value.buffer
      buffer = owner._buffer
      offset = value.offset! | 0
      if (value.size !== undefined) {
        size = value.size | 0
      } else if (value.offset !== undefined) {
        size = block.info.dataSize
      }
      if (value.binding !== undefined) binding = value.binding | 0
    } else if (isUniformBlockValues(value)) {
      values = value.values
      if (value.binding !== undefined) binding = value.binding | 0
    } else if (isPlainBlockValues(value)) {
      values = value
    } else {
      commandRaise(
        `invalid uniform block "${block.info.name}"`,
        plan.commandName
      )
      continue
    }

    if (values) {
      // Phase 2閿涙氨绮ㄩ弸鍕閸婅偐鏁遍崨鎴掓姢閹镐焦婀侀崘鍛村劥 UBO
const owned = ensureOwnedUniformBlock(runtime, block)
      const staticValue = !!block.value && !block.value.dynamic
      const handle = owned.buffer.handle
      const canSkip =
        staticValue &&
        owned.lastBytes !== null &&
        owned.lastHandle === handle

      if (!canSkip) {
        const previous =
          owned.lastHandle === handle ? owned.lastBytes : null
        const packed = packUniformBlock(owned.layout, values, previous)
        uploadUniformBlockData(
          runtime.buffers,
          owned.buffer,
          owned.layout,
          packed,
          previous
        )
        owned.lastBytes = packed
        owned.lastHandle = handle
      }
      buffer = owned.buffer
    } else {
      // Phase 1閿涙俺袙閺嬫劕鑻熼弽锟犵崣 std140 layout閿涙盯顩诲▎锛勭拨鐎规碍妞傛い杞扮┒閸掑棝鍘ょ€涙ê鍋?      owner!.attachLayout(block.info)
      buffer = owner!._buffer
    }

    if (!buffer.handle) {
      commandRaise(
        `uniform buffer for block "${block.info.name}" has been destroyed`,
        plan.commandName
      )
    }
    if (buffer.byteLength < block.info.dataSize) {
      commandRaise(
        `uniform buffer too small for block "${block.info.name}": ` +
          `need ${block.info.dataSize} bytes, have ${buffer.byteLength}`,
        plan.commandName
      )
    }
    if (binding < 0 || binding >= runtime.limits.maxUniformBufferBindings) {
      commandRaise(
        `invalid uniform block binding ${binding} for "${block.info.name}"`,
        plan.commandName
      )
    }
    if (offset < 0 || size < 0) {
      commandRaise(
        `invalid uniform buffer range for block "${block.info.name}"`,
        plan.commandName
      )
    }
    if (size > 0) {
      const alignment = runtime.limits.uniformBufferOffsetAlignment
      if (alignment > 0 && offset % alignment !== 0) {
        commandRaise(
          `uniform buffer offset ${offset} is not aligned to ${alignment}`,
          plan.commandName
        )
      }
      if (size < block.info.dataSize) {
        commandRaise(
          `uniform buffer range too small for block "${block.info.name}"`,
          plan.commandName
        )
      }
      if (offset + size > buffer.byteLength) {
        commandRaise(
          `uniform buffer range out of bounds for block "${block.info.name}"`,
          plan.commandName
        )
      }
    }

    runtime.state.bindUniformBuffer(
      programPlan.program.program,
      block.info.index,
      binding,
      buffer.handle,
      offset,
      size
    )
  }
}

// ---------------------------------------------------------------------------
// uniform 娑撳﹣绱?// ---------------------------------------------------------------------------
const matrixScratch = new Float32Array(16)

function uploadUniforms(
  runtime: CommandRuntime,
  programPlan: ProgramPlan,
  frame: DrawFrame,
  boundTextures: TextureInternal[]
): void {
  const gl = runtime.gl

  for (const uniform of programPlan.uniforms) {
    let value: unknown
    if (uniform.value) {
      value = uniform.value.resolve(frame as EvalContext)
      if (uniform.arrayBase !== undefined && Array.isArray(value)) {
        value = value[uniform.arrayIndex!]
      }
    } else {
      value = runtime.scope.uniforms.get(uniform.name)
      if (value === undefined && uniform.arrayBase !== undefined) {
        value = runtime.scope.uniforms.get(uniform.arrayBase)
        if (Array.isArray(value)) value = value[uniform.arrayIndex!]
      }
    }

    if (value === undefined) {
      if (DEV) {
        commandRaise(`missing uniform "${uniform.name}"`, programPlan.program.style)
      }
      continue
    }

    const info = uniformTypeInfo(uniform.type)
    if (!info) {
      if (DEV) {
        console.warn(
          `(regl) unsupported uniform type 0x${uniform.type.toString(16)} for "${uniform.name}"`
        )
      }
      continue
    }

    if (info.sampler) {
      const resolved = resolveSamplerTexture(
        runtime,
        value,
        info.textureTarget!,
        uniform.name
      )
      const unit = runtime.textures.bindTexture(resolved.texture)
      runtime.state.bindSampler(
        unit,
        resolved.sampler ? resolved.sampler.handle : null
      )
      gl.uniform1i(uniform.location, unit)
      boundTextures.push(resolved.texture)
      continue
    }

    if (info.matrixDim || info.matrixCols) {
      let data: Float32Array
      if (value instanceof Float32Array) {
        data = value
      } else if (ArrayBuffer.isView(value)) {
        // Float64Array 缁涘娓剁憰渚€鈧劕鍘撶槐鐘烘祮閹诡澁绱濇稉宥堝厴閻╁瓨甯撮幐澶婄摟閼哄倿鍣哥憴锝夊櫞
const source = value as unknown as ArrayLike<number>
        if (DEV) {
          checkCommand(
            source.length === info.components,
            `invalid matrix for uniform ${uniform.name}`,
            programPlan.program.style
          )
        }
        data = matrixScratch.subarray(0, info.components)
        for (let i = 0; i < info.components; ++i) {
          data[i] = +source[i] || 0
        }
      } else {
        checkCommand(
          Array.isArray(value) && value.length === info.components,
          `invalid matrix for uniform ${uniform.name}`,
          programPlan.program.style
        )
        for (let i = 0; i < info.components; ++i) {
          matrixScratch[i] = +(value as number[])[i] || 0
        }
        data = matrixScratch.subarray(0, info.components)
      }
      ;(gl as unknown as Record<string, Function>)[`uniform${info.infix}`](
        uniform.location,
        false,
        data
      )
      continue
    }

    if (info.components === 1) {
      if (DEV) {
        if (value === null || value === undefined) {
          commandRaise(
            `missing uniform "${uniform.name}"`,
            programPlan.program.style
          )
        }
        if (uniform.type === GL.FLOAT && typeof value !== 'number') {
          commandRaise(
            `invalid type for uniform ${uniform.name}, expected number`,
            programPlan.program.style
          )
        }
        if (uniform.type === GL.INT && typeof value !== 'number') {
          commandRaise(
            `invalid type for uniform ${uniform.name}, expected number`,
            programPlan.program.style
          )
        }
        if (
          uniform.type === GL.BOOL &&
          typeof value !== 'boolean' &&
          typeof value !== 'number'
        ) {
          commandRaise(
            `invalid type for uniform ${uniform.name}, expected boolean`,
            programPlan.program.style
          )
        }
      }
      if (info.infix === '1i') {
        const intValue =
          typeof value === 'boolean' ? (value ? 1 : 0) : (value as number) | 0
        gl.uniform1i(uniform.location, intValue)
      } else if (info.infix === '1ui') {
        ;(gl as WebGL2RenderingContext).uniform1ui(
          uniform.location,
          (value as number) >>> 0
        )
      } else {
        gl.uniform1f(uniform.location, +(value as number) || 0)
      }
      continue
    }

    // 閸氭垿鍣洪敍姘复閸欐鏆熺紒?/ TypedArray閿涘奔绡冮幒銉ュ綀閺嶅洭鍣洪敍鍫モ偓鈧崠鏍﹁礋闁插秴顦查敍鐕傜礆閳ユ柡鈧柧绻氶幐浣峰紬閺?
checkCommand(
      (Array.isArray(value) || ArrayBuffer.isView(value)) &&
        (value as ArrayLike<number>).length === info.components,
      `invalid vector for uniform ${uniform.name}, expected length ${info.components}`,
      programPlan.program.style
    )
    const v = value as ArrayLike<number>
    switch (info.infix) {
      case '2f':
        gl.uniform2f(uniform.location, +v[0], +v[1])
        break
      case '3f':
        gl.uniform3f(uniform.location, +v[0], +v[1], +v[2])
        break
      case '4f':
        gl.uniform4f(uniform.location, +v[0], +v[1], +v[2], +v[3])
        break
      case '2i':
        gl.uniform2i(uniform.location, v[0] | 0, v[1] | 0)
        break
      case '3i':
        gl.uniform3i(uniform.location, v[0] | 0, v[1] | 0, v[2] | 0)
        break
      case '4i':
        gl.uniform4i(uniform.location, v[0] | 0, v[1] | 0, v[2] | 0, v[3] | 0)
        break
      case '2ui':
        ;(gl as WebGL2RenderingContext).uniform2ui(
          uniform.location,
          v[0] >>> 0,
          v[1] >>> 0
        )
        break
      case '3ui':
        ;(gl as WebGL2RenderingContext).uniform3ui(
          uniform.location,
          v[0] >>> 0,
          v[1] >>> 0,
          v[2] >>> 0
        )
        break
      case '4ui':
        ;(gl as WebGL2RenderingContext).uniform4ui(
          uniform.location,
          v[0] >>> 0,
          v[1] >>> 0,
          v[2] >>> 0,
          v[3] >>> 0
        )
        break
    }
  }
}

interface ResolvedSamplerTexture {
  texture: TextureInternal
  sampler: SamplerInternal | null
}

function isSamplerTextureValue(
  value: unknown
): value is { texture: unknown; sampler?: unknown } {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'texture' in value
  )
}

function resolveSamplerTexture(
  runtime: CommandRuntime,
  value: unknown,
  target: number,
  uniformName: string
): ResolvedSamplerTexture {
  let textureValue = value
  let sampler: SamplerInternal | null = null

  if (isSamplerTextureValue(value)) {
    textureValue = value.texture
    if (value.sampler !== undefined && value.sampler !== null) {
      if (!isSampler(value.sampler)) {
        raise(`invalid sampler for uniform ${uniformName}`)
      }
      sampler = runtime.samplers.get(value.sampler)
      if (!sampler || !sampler.handle) {
        raise(`sampler for uniform ${uniformName} has been destroyed`)
      }
    }
  }

  // framebuffer -> 妫版粏澹婇梽鍕缁惧湱鎮婇敍鍧甧gl 閻ㄥ嫪绌堕崚鈺勵攽娑撶尨绱?
if (isFramebuffer(textureValue)) {
    const fb = runtime.framebuffers.get(textureValue)
    if (!fb || fb.colorAttachments.length === 0) {
      raise(`invalid framebuffer for uniform ${uniformName}`)
    }
    const attachment = fb.colorAttachments[0]
    if (!attachment.texture) {
      raise(`framebuffer has no texture color attachment for uniform ${uniformName}`)
    }
    return { texture: attachment.texture._texture, sampler }
  }
  if (isFramebufferCube(textureValue)) {
    const cube = textureValue as unknown as {
      color: import('../resources/texture').TextureCubeWrapper[]
    }
    if (!cube.color || cube.color.length === 0) {
      raise(`invalid cube framebuffer for uniform ${uniformName}`)
    }
    return { texture: cube.color[0]._texture, sampler }
  }

  if (target === GL.TEXTURE_2D) {
    if (!isTexture2D(textureValue)) {
      raise(`invalid texture for uniform ${uniformName}`)
    }
    return {
      texture: (textureValue as Texture2DWrapper)._texture,
      sampler
    }
  }
  if (target === GL.TEXTURE_CUBE_MAP) {
    if (!isTextureCube(textureValue)) {
      raise(`invalid cube texture for uniform ${uniformName}`)
    }
    return {
      texture: (textureValue as TextureCubeWrapper)._texture,
      sampler
    }
  }
  if (target === GL.TEXTURE_3D) {
    if (!isTexture3D(textureValue)) {
      raise(`invalid 3D texture for uniform ${uniformName}`)
    }
    return {
      texture: (textureValue as Texture3DWrapper)._texture,
      sampler
    }
  }
  if (target === GL.TEXTURE_2D_ARRAY) {
    if (!isTexture2DArray(textureValue)) {
      raise(`invalid 2D array texture for uniform ${uniformName}`)
    }
    return {
      texture: (textureValue as Texture2DArrayWrapper)._texture,
      sampler
    }
  }
  // 閸忚泛鐣犻柌鍥ㄧ壉閸ｎ煉绱?D / 2D array閿涘娈忛弮璺哄涧閹恒儱褰堢敮?_texture 閻ㄥ嫬顕挒?
const texture = (textureValue as { _texture?: TextureInternal })?._texture
  if (!texture) {
    raise(`invalid texture for uniform ${uniformName}`)
  }
  return { texture, sampler }
}

// ---------------------------------------------------------------------------
// draw 鐠嬪啰鏁?// ---------------------------------------------------------------------------

function performDraw(
  runtime: CommandRuntime,
  plan: CommandPlan,
  frame: DrawFrame,
  vao: VertexArray | null,
  streamElements: ElementBuffer[]
): void {
  const gl = runtime.gl
  const ec = frame as EvalContext

  // 鐟欙絾鐎?elements
let elements: ElementBuffer | null = null
  let elementsValue: unknown = undefined
  if (plan.elements) {
    elementsValue = plan.elements.resolve(ec)
  } else if (runtime.scope.draw.elements !== undefined) {
    elementsValue = runtime.scope.draw.elements
  } else if (vao && vao.elements) {
    elements = vao.elements._elements
  }

  if (elementsValue !== undefined && elementsValue !== null) {
    if (isElements(elementsValue)) {
      elements = (elementsValue as { _elements: ElementBuffer })._elements
    } else if (isBufferData(elementsValue)) {
      elements = runtime.elements.createStream(
        elementsValue as never
      )
      streamElements.push(elements)
    } else if (isElementsConfig(elementsValue)) {
      elements = runtime.elements.createStream(elementsValue as never)
      streamElements.push(elements)
    } else {
      commandRaise('invalid elements', plan.commandName)
    }
  }

  // count
let count: number
  let countFromElements = false
  if (plan.count) {
    count = (plan.count.resolve(ec) as number) | 0
  } else if (runtime.scope.draw.count !== undefined) {
    count = runtime.scope.draw.count | 0
  } else if (elements) {
    count = elements.vertCount
    countFromElements = true
  } else if (vao) {
    count = vao.count
    countFromElements = true
  } else {
    count = -1
  }
  checkCommand(count >= 0, 'missing vertex count', plan.commandName)

  // offset / instances / primitive
let offset: number
  if (plan.offset) {
    offset = (plan.offset.resolve(ec) as number) | 0
  } else if (runtime.scope.draw.offset !== undefined) {
    offset = runtime.scope.draw.offset | 0
  } else if (vao) {
    offset = vao.offset
  } else {
    offset = 0
  }
  checkCommand(offset >= 0, 'invalid offset', plan.commandName)
  if (elements && countFromElements) {
    count -= offset
    checkCommand(count >= 0, 'invalid vertex offset/element buffer too small', plan.commandName)
  }

  let instances: number
  if (plan.instances) {
    instances = (plan.instances.resolve(ec) as number) | 0
  } else if (runtime.scope.draw.instances !== undefined) {
    instances = runtime.scope.draw.instances | 0
  } else if (vao) {
    instances = vao.instances
  } else {
    instances = -1
  }

  let primitive: number
  if (plan.primitive) {
    const p = plan.primitive.resolve(ec) as string
    checkCommand(p in primitiveTypes, `invalid primitive ${p}`, plan.commandName)
    primitive = primitiveTypes[p]
  } else if (runtime.scope.draw.primitive !== undefined) {
    primitive = runtime.scope.draw.primitive
  } else if (elements) {
    primitive = elements.primType
  } else if (vao) {
    primitive = vao.primitive
  } else {
    primitive = GL.TRIANGLES
  }

  if (count <= 0) return

  if (elements) {
    // 娴ｈ法鏁?VAO 閺?ELEMENT_ARRAY_BUFFER 瀹歌尙绮￠崠鍛儓閸?VAO 娑?
if (!vao) {
      if (!elements.buffer.handle) {
        commandRaise('element buffer has been destroyed', plan.commandName)
      }
      runtime.state.bindElementBuffer(elements.buffer.handle)
    }
    const offsetBytes = offset * indexByteSize(elements.type)
    if (instances >= 0) {
      runtime.caps.drawElementsInstanced(
        primitive,
        count,
        elements.type,
        offsetBytes,
        instances
      )
    } else {
      gl.drawElements(primitive, count, elements.type, offsetBytes)
    }
  } else {
    if (instances >= 0) {
      runtime.caps.drawArraysInstanced(primitive, offset, count, instances)
    } else {
      gl.drawArrays(primitive, offset, count)
    }
  }
}

function indexByteSize(type: number): number {
  if (type === GL.UNSIGNED_BYTE) return 1
  if (type === GL.UNSIGNED_SHORT) return 2
  return 4
}

// ---------------------------------------------------------------------------
// 閹靛綊鍣虹紒妯哄煑
// ---------------------------------------------------------------------------

function executeBatch(
  runtime: CommandRuntime,
  plan: CommandPlan,
  stats: CommandStats,
  thisArg: unknown,
  propsList: unknown[],
  count: number
): void {
  const profileFrame: DrawFrame = {
    thisArg,
    props: propsList[0],
    context: runtime.context,
    batchId: runtime.batchId
  }
  const profileByProp = !!plan.profile?.propDep
  const profiling = profileByProp
    ? runtime.profile || !!plan.profile
    : wantsProfile(runtime, plan, profileFrame)
  const start = profiling ? now() : 0
  if (profiling && runtime.timer) runtime.timer.beginQuery(stats)

  const previousFramebuffer = runtime.currentFramebuffer
  const restoredScope = runtime.scope.snapshot()
  const restoreContext = contextInvariant(plan)
    ? applyContext(runtime, plan, {
        thisArg,
        props: undefined,
        context: runtime.context,
        batchId: runtime.batchId
      })
    : null

  const fbInvariant = !plan.framebuffer || !plan.framebuffer.propDep
  if (fbInvariant && plan.framebuffer) {
    const fb = resolveFramebuffer(runtime, plan, {
      thisArg,
      props: undefined,
      context: runtime.context,
      batchId: runtime.batchId
    })
    if (fb !== undefined) setFramebuffer(runtime, fb)
  }

  // 鎼存梻鏁ゆ稉宥勭贩鐠?props 閻ㄥ嫮濮搁幀?
for (const [name, value] of plan.state) {
    if (name === 'scissor.box' || name === 'viewport') continue
    if (!value.propDep) {
      applyStateValue(
        runtime.state,
        name,
        value.resolve({ thisArg, props: undefined, context: runtime.context, batchId: runtime.batchId }),
        plan.commandName
      )
    }
  }
  applyNestedState(runtime, plan, {
    thisArg,
    props: undefined,
    context: runtime.context,
    batchId: runtime.batchId
  }, false)
  const scissorInvariant = plan.state.get('scissor.box')
  if (scissorInvariant && !scissorInvariant.propDep) {
    applyScissorPlan(runtime, plan, {
      thisArg,
      props: undefined,
      context: runtime.context,
      batchId: runtime.batchId
    })
  }

  const streams: { buffer: Buffer; stream: boolean }[] = []
  const streamElements: ElementBuffer[] = []
  const boundTextures: TextureInternal[] = []

  try {
    for (let i = 0; i < count; ++i) {
      const props = propsList[i]
      const frame: DrawFrame = {
        thisArg,
        props,
        context: runtime.context,
        batchId: runtime.batchId + i
      }
      const restoreItemContext = !contextInvariant(plan)
        ? applyContext(runtime, plan, frame)
        : null
      try {
        // framebuffer
if (!fbInvariant) {
          const fb = resolveFramebuffer(runtime, plan, frame)
          if (fb !== undefined) setFramebuffer(runtime, fb)
        }

        // viewport / scissor
const [fbWidth, fbHeight] = framebufferSize(
          runtime,
          runtime.currentFramebuffer
        )
        if (plan.viewport) {
          if (!plan.viewport.propDep && !plan.viewport.contextDep) {
            if (i === 0) {
              const box = normalizeBox(
                plan.viewport.resolve(frame as EvalContext),
                fbWidth,
                fbHeight,
                'viewport',
                plan.commandName
              )
              runtime.state.viewport(box.x, box.y, box.width, box.height)
              runtime.context.viewportWidth = box.width
              runtime.context.viewportHeight = box.height
            }
          } else {
            const box = normalizeBox(
              plan.viewport.resolve(frame as EvalContext),
              fbWidth,
              fbHeight,
              'viewport',
              plan.commandName
            )
            runtime.state.viewport(box.x, box.y, box.width, box.height)
            runtime.context.viewportWidth = box.width
            runtime.context.viewportHeight = box.height
          }
        }

        // 娓氭繆绂?props 閻ㄥ嫮濮搁幀?
for (const [name, value] of plan.state) {
          if (name === 'scissor.box' || name === 'viewport') continue
          if (value.propDep) {
            applyStateValue(
              runtime.state,
              name,
              value.resolve(frame as EvalContext),
              plan.commandName
            )
          }
        }
        applyNestedState(runtime, plan, frame, true)
        const scissor = plan.state.get('scissor.box')
        if (scissor && scissor.propDep) {
          applyScissorPlan(runtime, plan, frame)
        }

        // VAO / program
const vao = resolveVAO(plan, frame, restoredScope)
        if (vao) vao.bind(runtime.state)
        const programPlan = ensureProgramPlan(runtime, plan, frame)
        runtime.state.useProgram(programPlan.program.program)
        bindUniformBlocks(runtime, plan, programPlan, frame)

        if (!vao) bindAttributes(runtime, plan, programPlan, frame, streams)
        uploadUniforms(runtime, programPlan, frame, boundTextures)
        performDraw(runtime, plan, frame, vao, streamElements)

        if (profileByProp && plan.profile!.resolve(frame as EvalContext)) {
          stats.count++
        }
      } finally {
        if (restoreItemContext) restoreItemContext()
      }
    }

    if (profiling && !profileByProp) {
      stats.count += count
    }
  } finally {
    if (profiling) {
      stats.cpuTime += now() - start
      if (runtime.timer) runtime.timer.endQuery()
    }
    for (const texture of boundTextures) {
      runtime.textures.unbindTexture(texture)
    }
    for (const elements of streamElements) {
      runtime.elements.destroyStream(elements)
    }
    for (const entry of streams) {
      if (entry.stream) runtime.buffers.destroyStream(entry.buffer)
    }
    if (runtime.state.currentVAO) {
      if (runtime.caps.hasVAO) runtime.caps.bindVertexArray(null)
      runtime.state.currentVAO = null
      runtime.state.invalidateVertexArrays()
    }
    runtime.scope.restore(restoredScope)
    if (runtime.currentFramebuffer !== previousFramebuffer) {
      setFramebuffer(runtime, previousFramebuffer)
    }
    if (restoreContext) restoreContext()
  }
}

function contextInvariant(plan: CommandPlan): boolean {
  for (const value of plan.context.values()) {
    if (value.propDep) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Scope 閸涙垝鎶?// ---------------------------------------------------------------------------

function executeScope(
  runtime: CommandRuntime,
  plan: CommandPlan,
  stats: CommandStats,
  thisArg: unknown,
  props: Record<string, unknown> | undefined,
  body: CommandBody,
  batchId: number
): void {
  const frame: DrawFrame = {
    thisArg,
    props,
    context: runtime.context,
    batchId
  }
  const profiling = wantsProfile(runtime, plan, frame)
  const start = profiling ? now() : 0
  if (profiling && runtime.timer) runtime.timer.beginQuery(stats)
  const restoreContext = applyContext(runtime, plan, frame)
  const previousFramebuffer = runtime.currentFramebuffer
  const snapshot = runtime.scope.snapshot()
  const streams: { buffer: Buffer; stream: boolean }[] = []

  try {
    // framebuffer
const fb = resolveFramebuffer(runtime, plan, frame)
    if (fb !== undefined) {
      setFramebuffer(runtime, fb)
      runtime.scope.framebuffer = fb
    }

    // viewport / scissor / state
const [fbWidth, fbHeight] = framebufferSize(runtime, runtime.currentFramebuffer)
    if (plan.viewport) {
      const box = normalizeBox(
        plan.viewport.resolve(frame as EvalContext),
        fbWidth,
        fbHeight,
        'viewport',
        plan.commandName
      )
      runtime.state.viewport(box.x, box.y, box.width, box.height)
      runtime.context.viewportWidth = box.width
      runtime.context.viewportHeight = box.height
    } else if (fb !== undefined) {
      runtime.state.viewport(0, 0, fbWidth, fbHeight)
      runtime.context.viewportWidth = fbWidth
      runtime.context.viewportHeight = fbHeight
    }
    applyStatePlans(runtime, plan, frame)

    // 娣囨繂鐡ㄩ崚?scope閿涘奔绶?body 閸愬懐娈戠€涙劕鎳℃禒銈囨埛閹?
for (const [name, value] of plan.uniforms) {
      runtime.scope.uniforms.set(name, value.resolve(frame as EvalContext))
    }
    for (const [name, value] of plan.uniformBlocks) {
      runtime.scope.uniformBlocks.set(
        name,
        value.resolve(frame as EvalContext)
      )
    }
    for (const [name, compiled] of plan.attributes) {
      if (compiled.record) {
        runtime.scope.attributes.set(name, compiled.record)
      } else {
        const raw = compiled.value.resolve(frame as EvalContext)
        const parsed = parseAttributeValue(raw, runtime.buffers, 'dynamic')
        runtime.scope.attributes.set(name, parsed.record)
        if (parsed.createdBuffer) {
          streams.push({ buffer: parsed.createdBuffer, stream: parsed.stream })
        }
      }
    }
    // shader
if (plan.vert) {
      runtime.scope.shader.vert = plan.vert.resolve(frame as EvalContext) as string
    }
    if (plan.frag) {
      runtime.scope.shader.frag = plan.frag.resolve(frame as EvalContext) as string
    }
    // draw 閸欏倹鏆?
if (plan.elements) {
      runtime.scope.draw.elements = plan.elements.resolve(frame as EvalContext) as never
    }
    if (plan.count) runtime.scope.draw.count = plan.count.resolve(frame as EvalContext) as number
    if (plan.offset) runtime.scope.draw.offset = plan.offset.resolve(frame as EvalContext) as number
    if (plan.instances) {
      runtime.scope.draw.instances = plan.instances.resolve(frame as EvalContext) as number
    }
    if (plan.primitive) {
      const p = plan.primitive.resolve(frame as EvalContext) as string
      checkCommand(p in primitiveTypes, `invalid primitive ${p}`, plan.commandName)
      runtime.scope.draw.primitive = primitiveTypes[p]
    }
    // vao
const vao = resolveVAO(plan, frame, snapshot)
    if (vao) runtime.scope.vao = vao

    // 鎵ц body
const previousBatchId = runtime.batchId
    runtime.batchId = batchId
    try {
      body.call(thisArg, runtime.context, props || null, batchId)
    } finally {
      runtime.batchId = previousBatchId
    }

    if (profiling) stats.count++
  } finally {
    if (profiling) {
      stats.cpuTime += now() - start
      if (runtime.timer) runtime.timer.endQuery()
    }
    for (const entry of streams) {
      if (entry.stream) runtime.buffers.destroyStream(entry.buffer)
    }
    runtime.scope.restore(snapshot)
    if (runtime.currentFramebuffer !== previousFramebuffer) {
      setFramebuffer(runtime, previousFramebuffer)
    }
    if (restoreContext) restoreContext()
  }
}

// ---------------------------------------------------------------------------
// 瀹搞儱鍙?// ---------------------------------------------------------------------------

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** 閺勵垰鎯佺€电懓缍嬮崜宥呮嚒娴犮倕浠涢幀褑鍏樼紒鐔活吀閵?*/
function wantsProfile(
  runtime: CommandRuntime,
  plan: CommandPlan,
  frame: DrawFrame
): boolean {
  if (plan.profile) {
    return !!plan.profile.resolve(frame as EvalContext)
  }
  return runtime.profile
}
