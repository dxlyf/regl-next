/**
 * 动态变量（dynamic variable）系统。
 *
 * regl 允许把「编译期常量」与「调用期才确定的值」混在一起写：
 *
 * ```js
 * const draw = regl({
 *   uniforms: {
 *     color: [1, 0, 0, 1],              // 静态
 *     time: regl.context('time'),        // 依赖每帧上下文
 *     scale: regl.prop('scale'),         // 依赖调用参数
 *     angle: (ctx, props) => props.a * ctx.tick // 自定义函数
 *   }
 * })
 * ```
 *
 * 旧实现把这些编译成一段 JavaScript 字符串（`new Function`）。本实现改为
 * 「预编译求值器」：每个动态值在编译期变成一个闭包，调用期直接执行。
 * 好处：
 * - 兼容 CSP（不需要 eval / new Function）；
 * - 可调试、可被 JS 引擎优化；
 * - 不需要维护一套代码生成器。
 *
 * 为了批量渲染优化，每个求值器会标记它是否依赖 props / context / this。
 */

/** 动态变量的种类。 */
export const enum DynamicKind {
  Function = 0,
  Prop = 1,
  Context = 2,
  This = 3,
  Constant = 4,
  Array = 5
}

/** 求值上下文：绘制命令每次执行时可用到的全部输入。 */
export interface EvalContext {
  /** 命令函数被调用时的 `this`（配合 `regl.this()` 使用）。 */
  thisArg: unknown
  /** regl 的上下文对象（时间、视口尺寸等）+ 用户通过 `context` 覆盖的值。 */
  context: Record<string, unknown>
  /** 本次绘制的 props。 */
  props: unknown
  /** 批处理中的索引，从 0 开始。 */
  batchId: number
}

/** 路径解析：把 `'a.b[0].c'` 拆成 ['a','b',0,'c']。 */
export type PathSegment = string | number

export function parsePath(path: string): PathSegment[] {
  const result: PathSegment[] = []
  const re = /[^.[\]]+|\[(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(path))) {
    if (match[1] !== undefined) {
      result.push(parseInt(match[1], 10))
    } else {
      result.push(match[0])
    }
  }
  return result
}

/** 按 path 读取属性。 */
export function readPath(object: unknown, path: PathSegment[]): unknown {
  let value: unknown = object
  for (let i = 0; i < path.length; ++i) {
    if (value === null || value === undefined) return undefined
    value = (value as Record<PathSegment, unknown>)[path[i]]
  }
  return value
}

/**
 * 动态变量。对用户暴露的只有通过 `regl.prop/context/this` 创建的对象。
 */
export class DynamicVariable<T = unknown> {
  /** 类型标记，便于外部区分动态变量与普通函数。 */
  readonly _dyn = true
  readonly kind: DynamicKind
  readonly path: PathSegment[]
  readonly fn: ((...args: unknown[]) => T) | null
  readonly value: T | null

  constructor(
    kind: DynamicKind,
    path: PathSegment[] = [],
    fn: ((...args: unknown[]) => T) | null = null,
    value: T | null = null
  ) {
    this.kind = kind
    this.path = path
    this.fn = fn
    this.value = value
  }
}

let VARIABLE_COUNTER = 0
export function nextDynamicId(): number {
  return VARIABLE_COUNTER++
}

/** 创建 `regl.prop('name')`。 */
export function defineProp<T = unknown>(path: string): DynamicVariable<T> {
  if (typeof path !== 'string') {
    throw new Error('(regl) regl.prop() expects a string')
  }
  return new DynamicVariable<T>(DynamicKind.Prop, parsePath(path))
}

/** 创建 `regl.context('name')`。 */
export function defineContext<T = unknown>(path: string): DynamicVariable<T> {
  if (typeof path !== 'string') {
    throw new Error('(regl) regl.context() expects a string')
  }
  return new DynamicVariable<T>(DynamicKind.Context, parsePath(path))
}

/** 创建 `regl.this('name')`。 */
export function defineThis<T = unknown>(path: string): DynamicVariable<T> {
  if (typeof path !== 'string') {
    throw new Error('(regl) regl.this() expects a string')
  }
  return new DynamicVariable<T>(DynamicKind.This, parsePath(path))
}

/**
 * 是否是「动态值」。
 * 注意：regl 的资源（texture/buffer/...）本身也是函数，但它们带有 _reglType，
 * 不能被当作动态函数处理。
 */
export function isDynamic(value: unknown): boolean {
  if (value instanceof DynamicVariable) return true
  return (
    typeof value === 'function' &&
    !(value as { _reglType?: string })._reglType
  )
}

/** 一个编译后的值求值器。 */
export interface CompiledValue<T = unknown> {
  /** 求值。静态值时直接返回缓存值。 */
  resolve: (ec: EvalContext) => T
  /** 是否包含任何动态部分。 */
  dynamic: boolean
  /** 是否依赖 props。 */
  propDep: boolean
  /** 是否依赖 context。 */
  contextDep: boolean
  /** 是否依赖 this。 */
  thisDep: boolean
  /** 静态值本身（dynamic === false 时有效）。 */
  staticValue?: T
}

const STATIC_EC: EvalContext = {
  thisArg: undefined,
  context: {},
  props: undefined,
  batchId: 0
}

/** 编译一个可能包含动态变量的值。 */
export function compileValue<T = unknown>(value: T): CompiledValue<T> {
  // 动态变量
  if (value instanceof DynamicVariable) {
    return compileDynamicVariable(value)
  }

  // 函数：视为 (context, props, batchId) => value
  if (typeof value === 'function' && !(value as { _reglType?: string })._reglType) {
    const fn = value as unknown as (...args: unknown[]) => T
    const arity = fn.length
    return {
      dynamic: true,
      propDep: arity >= 2,
      contextDep: arity >= 1,
      thisDep: true,
      resolve: (ec) => fn.call(ec.thisArg, ec.context, ec.props, ec.batchId)
    }
  }

  // 数组：允许数组元素是动态值
  if (Array.isArray(value)) {
    let dynamic = false
    let propDep = false
    let contextDep = false
    let thisDep = false
    const items: CompiledValue[] = new Array(value.length)
    for (let i = 0; i < value.length; ++i) {
      const item = compileValue(value[i])
      items[i] = item
      if (item.dynamic) {
        dynamic = true
        propDep = propDep || item.propDep
        contextDep = contextDep || item.contextDep
        thisDep = thisDep || item.thisDep
      }
    }
    if (!dynamic) {
      return {
        dynamic: false,
        propDep: false,
        contextDep: false,
        thisDep: false,
        staticValue: value,
        resolve: () => value
      }
    }
    return {
      dynamic: true,
      propDep,
      contextDep,
      thisDep,
      resolve: (ec) => items.map((item) => item.resolve(ec)) as unknown as T
    }
  }

  // 普通对象：允许对象属性是动态值（例如 attribute 配置）
  if (isPlainObject(value)) {
    const keys = Object.keys(value as Record<string, unknown>)
    let dynamic = false
    let propDep = false
    let contextDep = false
    let thisDep = false
    const items: CompiledValue[] = new Array(keys.length)
    for (let i = 0; i < keys.length; ++i) {
      const item = compileValue((value as Record<string, unknown>)[keys[i]])
      items[i] = item
      if (item.dynamic) {
        dynamic = true
        propDep = propDep || item.propDep
        contextDep = contextDep || item.contextDep
        thisDep = thisDep || item.thisDep
      }
    }
    if (!dynamic) {
      return {
        dynamic: false,
        propDep: false,
        contextDep: false,
        thisDep: false,
        staticValue: value,
        resolve: () => value
      }
    }
    return {
      dynamic: true,
      propDep,
      contextDep,
      thisDep,
      resolve: (ec) => {
        const result: Record<string, unknown> = {}
        for (let i = 0; i < keys.length; ++i) {
          result[keys[i]] = items[i].resolve(ec)
        }
        return result as T
      }
    }
  }

  // 其余情况一律视为静态值（TypedArray、DOM 元素、资源函数等）
  return {
    dynamic: false,
    propDep: false,
    contextDep: false,
    thisDep: false,
    staticValue: value,
    resolve: () => value
  }
}

function compileDynamicVariable<T>(dyn: DynamicVariable<T>): CompiledValue<T> {
  switch (dyn.kind) {
    case DynamicKind.Prop:
      return {
        dynamic: true,
        propDep: true,
        contextDep: false,
        thisDep: false,
        resolve: (ec) => readPath(ec.props, dyn.path) as T
      }

    case DynamicKind.Context:
      return {
        dynamic: true,
        propDep: false,
        contextDep: true,
        thisDep: false,
        resolve: (ec) => readPath(ec.context, dyn.path) as T
      }

    case DynamicKind.This:
      return {
        dynamic: true,
        propDep: false,
        contextDep: false,
        thisDep: true,
        resolve: (ec) => readPath(ec.thisArg, dyn.path) as T
      }

    case DynamicKind.Function: {
      const fn = dyn.fn as (...args: unknown[]) => T
      const arity = fn.length
      return {
        dynamic: true,
        propDep: arity >= 2,
        contextDep: arity >= 1,
        thisDep: true,
        resolve: (ec) => fn.call(ec.thisArg, ec.context, ec.props, ec.batchId)
      }
    }

    case DynamicKind.Array: {
      const array = dyn.value as unknown as T[]
      const items = array.map((item) => compileValue(item))
      return {
        dynamic: true,
        propDep: items.some((i) => i.propDep),
        contextDep: items.some((i) => i.contextDep),
        thisDep: items.some((i) => i.thisDep),
        resolve: (ec) => items.map((item) => item.resolve(ec)) as unknown as T
      }
    }

    case DynamicKind.Constant:
    default:
      return {
        dynamic: false,
        propDep: false,
        contextDep: false,
        thisDep: false,
        staticValue: dyn.value as T,
        resolve: () => dyn.value as T
      }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** 供测试/调试使用：在给定上下文里直接求值。 */
export function evaluate<T>(value: CompiledValue<T>, ec: EvalContext = STATIC_EC): T {
  return value.resolve(ec)
}

/**
 * 把一个动态值「提升」成函数，供旧代码路径使用。
 * 保留该工具函数，便于在 scope / batch 外部做一次性求值。
 */
export function toResolver<T>(value: T): (ec: EvalContext) => T {
  return compileValue(value).resolve
}
