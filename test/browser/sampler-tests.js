/* global window */
/**
 * WebGL2 Sampler Object 测试。
 */
(function () {
  'use strict'

  var kit = window.reglTestKit
  var test = kit.test
  var assert = kit.assert
  var assertPixel = kit.assertPixel
  var makeRegl = kit.makeRegl
  var pixelAt = kit.pixelAt
  var finish = kit.finish

  var TEX_VERT = [
    'precision mediump float;',
    'attribute vec2 position;',
    'attribute vec2 uv;',
    'varying vec2 vUv;',
    'void main () {',
    '  gl_Position = vec4(position, 0.0, 1.0);',
    '  vUv = uv;',
    '}'
  ].join('\n')

  var TEX_FRAG = [
    'precision mediump float;',
    'uniform sampler2D tex;',
    'varying vec2 vUv;',
    'void main () { gl_FragColor = texture2D(tex, vUv); }'
  ].join('\n')

  function makeTexture (regl) {
    return regl.texture({
      width: 2,
      height: 2,
      data: new Uint8Array([
        255, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 255, 255,
        255, 255, 255, 255
      ]),
      min: 'nearest',
      mag: 'nearest',
      wrap: 'clamp'
    })
  }

  function makeCommand (regl, uniforms) {
    return regl({
      vert: TEX_VERT,
      frag: TEX_FRAG,
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]],
        uv: [[0, 0], [2, 0], [0, 2]]
      },
      uniforms: uniforms,
      count: 3
    })
  }

  test('Sampler: nearest vs linear filtering', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var tex = makeTexture(ctx.regl)
    var nearest = ctx.regl.sampler({
      min: 'nearest',
      mag: 'nearest',
      wrap: 'clamp'
    })
    var linear = ctx.regl.sampler({
      min: 'linear',
      mag: 'linear',
      wrap: 'clamp'
    })
    var draw = makeCommand(ctx.regl, {
      tex: ctx.regl.prop('tex')
    })

    draw({ tex: { texture: tex, sampler: nearest } })
    var nearestPixel = pixelAt(ctx.regl, 8, 8)
    draw({ tex: { texture: tex, sampler: linear } })
    var linearPixel = pixelAt(ctx.regl, 8, 8)

    var diff =
      Math.abs(nearestPixel[0] - linearPixel[0]) +
      Math.abs(nearestPixel[1] - linearPixel[1]) +
      Math.abs(nearestPixel[2] - linearPixel[2])
    assert(diff > 30, 'nearest and linear should differ, got ' + diff)
    finish(ctx)
  })

  test('Sampler: binding is cleared when texture has no sampler', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var tex = makeTexture(ctx.regl)
    var linear = ctx.regl.sampler({
      min: 'linear',
      mag: 'linear',
      wrap: 'clamp'
    })
    var draw = makeCommand(ctx.regl, { tex: ctx.regl.prop('tex') })

    // sampler 使用 linear
    draw({ tex: { texture: tex, sampler: linear } })
    var sampled = pixelAt(ctx.regl, 8, 8)

    // 不传 sampler，应该回到 texture 自己的 nearest
    draw({ tex: tex })
    var plain = pixelAt(ctx.regl, 8, 8)

    var diff =
      Math.abs(sampled[0] - plain[0]) +
      Math.abs(sampled[1] - plain[1]) +
      Math.abs(sampled[2] - plain[2])
    assert(diff > 30, 'stale sampler should be unbound, got ' + diff)
    finish(ctx)
  })

  test('Sampler: update parameters', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var tex = makeTexture(ctx.regl)
    var sampler = ctx.regl.sampler({
      min: 'nearest',
      mag: 'nearest',
      wrap: 'clamp'
    })
    var draw = makeCommand(ctx.regl, {
      tex: { texture: tex, sampler: sampler }
    })

    draw()
    var first = pixelAt(ctx.regl, 8, 8)
    sampler({ min: 'linear', mag: 'linear' })
    draw()
    var second = pixelAt(ctx.regl, 8, 8)

    var diff =
      Math.abs(first[0] - second[0]) +
      Math.abs(first[1] - second[1]) +
      Math.abs(first[2] - second[2])
    assert(diff > 30, 'updated sampler should change filtering, got ' + diff)
    finish(ctx)
  })

  test('Sampler: destroy unbinds and updates stats', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var tex = makeTexture(ctx.regl)
    var sampler = ctx.regl.sampler({
      min: 'linear',
      mag: 'linear',
      wrap: 'clamp'
    })
    assert(ctx.regl.stats.samplerCount === 1, 'sampler count')
    var draw = makeCommand(ctx.regl, {
      tex: ctx.regl.prop('tex')
    })
    draw({ tex: { texture: tex, sampler: sampler } })
    sampler.destroy()
    assert(ctx.regl.stats.samplerCount === 0, 'sampler count after destroy')
    draw({ tex: tex })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 255, 255, 255], 2, 'after destroy')
    finish(ctx)
  })

  test('Sampler: shadow compare', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var depth = ctx.regl.texture({
      width: 1,
      height: 1,
      format: 'depth',
      type: 'uint16',
      data: new Uint16Array([0x8000])
    })
    var sampler = ctx.regl.sampler({
      min: 'nearest',
      mag: 'nearest',
      wrap: 'clamp',
      compare: 'lequal'
    })
    var vert = [
      '#version 300 es',
      'in vec2 position;',
      'out vec2 vUv;',
      'void main () {',
      '  gl_Position = vec4(position, 0.0, 1.0);',
      '  vUv = position * 0.5 + 0.5;',
      '}'
    ].join('\n')
    var frag = [
      '#version 300 es',
      'precision highp float;',
      'uniform highp sampler2DShadow shadowTex;',
      'in vec2 vUv;',
      'out vec4 fragColor;',
      'void main () {',
      '  float v = texture(shadowTex, vec3(vUv, 0.5));',
      '  fragColor = vec4(v, v, v, 1.0);',
      '}'
    ].join('\n')
    var draw = ctx.regl({
      vert: vert,
      frag: frag,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: {
        shadowTex: { texture: depth, sampler: sampler }
      },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 255, 255, 255], 2, 'shadow compare')
    finish(ctx)
  })

  test('Sampler: cube texture', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var face = new Uint8Array([255, 255, 0, 255])
    var cube = ctx.regl.cube(
      { width: 1, height: 1, data: face },
      { width: 1, height: 1, data: face },
      { width: 1, height: 1, data: face },
      { width: 1, height: 1, data: face },
      { width: 1, height: 1, data: face },
      { width: 1, height: 1, data: face }
    )
    var sampler = ctx.regl.sampler({
      min: 'nearest',
      mag: 'nearest',
      wrap: 'clamp'
    })
    var vert = [
      'precision mediump float;',
      'attribute vec2 position;',
      'varying vec3 vDir;',
      'void main () {',
      '  gl_Position = vec4(position, 0.0, 1.0);',
      '  vDir = vec3(position, 1.0);',
      '}'
    ].join('\n')
    var frag = [
      'precision mediump float;',
      'uniform samplerCube env;',
      'varying vec3 vDir;',
      'void main () { gl_FragColor = textureCube(env, normalize(vDir)); }'
    ].join('\n')
    var draw = ctx.regl({
      vert: vert,
      frag: frag,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: {
        env: { texture: cube, sampler: sampler }
      },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 255, 0, 255], 2, 'cube sampler')
    finish(ctx)
  })

  test('Sampler: context restore', async function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var ext = ctx.gl.getExtension('WEBGL_lose_context')
    if (!ext) {
      finish(ctx)
      return 'skipped (WEBGL_lose_context unavailable)'
    }
    var tex = makeTexture(ctx.regl)
    var sampler = ctx.regl.sampler({
      min: 'linear',
      mag: 'linear',
      wrap: 'clamp'
    })
    var draw = makeCommand(ctx.regl, {
      tex: { texture: tex, sampler: sampler }
    })
    draw()
    var before = pixelAt(ctx.regl, 8, 8)

    var lost = new Promise(function (resolve) {
      ctx.regl.on('lost', resolve)
    })
    var restored = new Promise(function (resolve) {
      ctx.regl.on('restore', resolve)
    })
    ext.loseContext()
    await lost
    await new Promise(function (resolve) {
      setTimeout(resolve, 100)
    })
    ext.restoreContext()
    await restored

    draw()
    var after = pixelAt(ctx.regl, 8, 8)
    assert(
      Math.abs(before[0] - after[0]) <= 2 &&
        Math.abs(before[1] - after[1]) <= 2 &&
        Math.abs(before[2] - after[2]) <= 2,
      'sampler output after restore'
    )
    finish(ctx)
  })

  test('Sampler: WebGL1 errors', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var threw = false
    try {
      ctx.regl.sampler({ min: 'nearest' })
    } catch (err) {
      threw = /WebGL2/.test(String(err))
    }
    assert(threw, 'sampler throws on WebGL1')
    finish(ctx)
  })
})()
