import { describe, expect, it } from 'vitest'
import {
  compileValue,
  defineContext,
  defineProp,
  defineThis,
  DynamicVariable,
  isDynamic,
  parsePath,
  readPath
} from '../../src/core/dynamic'
import {
  arrayShape,
  flattenArray,
  packNDArray,
  toHalfFloat,
  typedArrayCode
} from '../../src/util/data'
import { GL } from '../../src/util/constants'
import { ScopeState } from '../../src/core/command'
import { checkParameter, isTypedArray } from '../../src/util/check'

describe('dynamic variables', () => {
  it('parses paths with dots and indices', () => {
    expect(parsePath('a.b[0].c')).toEqual(['a', 'b', 0, 'c'])
    expect(parsePath('colors[12]')).toEqual(['colors', 12])
    expect(parsePath('plain')).toEqual(['plain'])
  })

  it('reads nested paths', () => {
    const value = { a: { b: [{ c: 42 }] } }
    expect(readPath(value, parsePath('a.b[0].c'))).toBe(42)
    expect(readPath(value, parsePath('a.missing.c'))).toBeUndefined()
  })

  it('identifies dynamic values but not resources', () => {
    expect(isDynamic(defineProp('x'))).toBe(true)
    expect(isDynamic(() => 1)).toBe(true)
    const textureLike = Object.assign(() => 1, { _reglType: 'texture2d' })
    expect(isDynamic(textureLike)).toBe(false)
    expect(isDynamic(3)).toBe(false)
    expect(isDynamic([1, 2])).toBe(false)
  })

  it('compiles prop/context/this/function values', () => {
    const compiled = compileValue({
      prop: defineProp<number>('value'),
      context: defineContext<number>('tick'),
      self: defineThis<number>('id'),
      fn: (context: { tick: number }, props: { value: number }) =>
        context.tick + props.value,
      constant: 7
    })
    expect(compiled.dynamic).toBe(true)
    expect(compiled.propDep).toBe(true)
    expect(compiled.contextDep).toBe(true)
    expect(compiled.thisDep).toBe(true)

    const result = compiled.resolve({
      thisArg: { id: 5 },
      context: { tick: 2 },
      props: { value: 3 },
      batchId: 0
    }) as Record<string, number>
    expect(result.prop).toBe(3)
    expect(result.context).toBe(2)
    expect(result.self).toBe(5)
    expect(result.fn).toBe(5)
    expect(result.constant).toBe(7)
  })

  it('keeps static values static', () => {
    const compiled = compileValue([1, 2, 3])
    expect(compiled.dynamic).toBe(false)
    expect(compiled.resolve({} as never)).toBe(compiled.staticValue)
  })

  it('creates DynamicVariable instances', () => {
    expect(defineProp('x')).toBeInstanceOf(DynamicVariable)
  })
})

describe('data helpers', () => {
  it('computes nested array shapes', () => {
    expect(arrayShape([[1, 2], [3, 4]])).toEqual([2, 2])
    expect(arrayShape([[[1, 2, 3]]])).toEqual([1, 1, 3])
    expect(arrayShape([])).toEqual([0])
  })

  it('flattens nested arrays into typed arrays', () => {
    const flat = flattenArray(
      [[1, 2], [3, 4]],
      [2, 2],
      GL.FLOAT
    ) as Float32Array
    expect(Array.from(flat)).toEqual([1, 2, 3, 4])
  })

  it('packs ndarrays', () => {
    const nd = {
      shape: [2, 2],
      stride: [2, 1],
      offset: 0,
      data: new Float32Array([1, 2, 3, 4])
    }
    const packed = packNDArray(nd, GL.FLOAT)
    expect(packed.dimension).toBe(2)
    expect(Array.from(packed.data as Float32Array)).toEqual([1, 2, 3, 4])
  })

  it('converts half floats', () => {
    expect(toHalfFloat(1)).toBe(0x3c00)
    expect(toHalfFloat(0.5)).toBe(0x3800)
    expect(toHalfFloat(-2)).toBe(0xc000)
  })

  it('detects typed array GL types', () => {
    expect(typedArrayCode(new Uint8Array(4))).toBe(GL.UNSIGNED_BYTE)
    expect(typedArrayCode(new Uint16Array(4))).toBe(GL.UNSIGNED_SHORT)
    expect(typedArrayCode(new Float32Array(4))).toBe(GL.FLOAT)
    expect(isTypedArray(new Float32Array(1))).toBe(true)
  })
})

describe('scope state snapshots', () => {
  it('restores uniforms/attributes/draw state', () => {
    const scope = new ScopeState()
    scope.uniforms.set('a', 1)
    scope.draw.count = 3
    const snapshot = scope.snapshot()
    scope.uniforms.set('a', 2)
    scope.draw.count = 6
    scope.restore(snapshot)
    expect(scope.uniforms.get('a')).toBe(1)
    expect(scope.draw.count).toBe(3)
  })
})

describe('error checking', () => {
  it('rejects unknown parameters', () => {
    expect(() => checkParameter('nope', { a: 1 }, 'test')).toThrow(
      /unknown parameter/
    )
  })
})
