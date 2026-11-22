/* global window */
/**
 * WebGL2 3D / 2D array 纹理测试。
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

  var VERT = [
    '#version 300 es',
    'in vec2 position;',
    'in vec2 uv;',
    'out vec2 vUv;',
    'void main () {',
    '  vUv = uv;',
    '  gl_Position = vec4(position, 0.0, 1.0);',
    '}'
  ].join('\n')

  function layer (color) {
    return [
      [color, color],
      [color, color]
    ]
  }

  function makeDraw (regl, tex, frag) {
    return regl({
      vert: VERT,
      frag: frag,
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]],
        uv: [[0, 0], [2, 0], [0, 2]]
      },
      uniforms: { tex: tex },
      framebuffer: null,
      count: 3
    })
  }

  test('texture3D: sample depth slice + subimage', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var tex = ctx.regl.texture3D({
      width: 2,
      height: 2,
      depth: 2,
      data: [
        layer([255, 0, 0, 255]),
        layer([0, 255, 0, 255])
      ]
    })
    assert(tex.width === 2 && tex.height === 2 && tex.depth === 2, '3d shape')
    var draw = makeDraw(ctx.regl, tex, [
      '#version 300 es',
      'precision highp float;',
      'uniform highp sampler3D tex;',
      'in vec2 vUv;',
      'out vec4 fragColor;',
      'void main () { fragColor = texture(tex, vec3(vUv, 0.75)); }'
    ].join('\n'))
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, '3d layer 1')

    tex.subimage(1, {
      data: layer([0, 0, 255, 255])
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 0, 255, 255], 1, '3d subimage')
    finish(ctx)
  })

  test('texture2DArray: sample layer + subimage', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var tex = ctx.regl.texture2DArray({
      width: 2,
      height: 2,
      layers: 2,
      data: [
        layer([255, 0, 0, 255]),
        layer([0, 255, 0, 255])
      ]
    })
    assert(tex.depth === 2 && tex.layers === 2, 'array shape')
    var draw = makeDraw(ctx.regl, tex, [
      '#version 300 es',
      'precision highp float;',
      'uniform highp sampler2DArray tex;',
      'in vec2 vUv;',
      'out vec4 fragColor;',
      'void main () { fragColor = texture(tex, vec3(vUv, 1.0)); }'
    ].join('\n'))
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'array layer 1')

    tex.subimage(1, {
      data: layer([255, 255, 0, 255])
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 255, 0, 255], 1, 'array subimage')
    finish(ctx)
  })

  test('texture3D: mipmap generation', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var tex = ctx.regl.texture3D({
      width: 4,
      height: 4,
      depth: 4,
      min: 'linear mipmap linear',
      mag: 'linear',
      data: new Uint8Array(4 * 4 * 4 * 4).fill(255)
    })
    assert(tex._texture.mipmask !== 0, '3d mipmask')
    var draw = makeDraw(ctx.regl, tex, [
      '#version 300 es',
      'precision highp float;',
      'uniform highp sampler3D tex;',
      'in vec2 vUv;',
      'out vec4 fragColor;',
      'void main () { fragColor = texture(tex, vec3(vUv, 0.5)); }'
    ].join('\n'))
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 255, 255, 255], 1, '3d mipmap')
    finish(ctx)
  })

  test('texture3D: sampler object', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var tex = ctx.regl.texture3D({
      width: 2,
      height: 2,
      depth: 2,
      data: [
        layer([255, 0, 0, 255]),
        layer([0, 255, 0, 255])
      ]
    })
    var sampler = ctx.regl.sampler({
      min: 'nearest',
      mag: 'nearest',
      wrap: 'clamp'
    })
    var draw = ctx.regl({
      vert: VERT,
      frag: [
        '#version 300 es',
        'precision highp float;',
        'uniform highp sampler3D tex;',
        'in vec2 vUv;',
        'out vec4 fragColor;',
        'void main () { fragColor = texture(tex, vec3(vUv, 0.75)); }'
      ].join('\n'),
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]],
        uv: [[0, 0], [2, 0], [0, 2]]
      },
      uniforms: {
        tex: { texture: tex, sampler: sampler }
      },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, '3d sampler')
    finish(ctx)
  })

  test('texture3D: framebuffer layer attachment', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var tex = ctx.regl.texture3D({
      width: 2,
      height: 2,
      depth: 2,
      data: [
        layer([255, 0, 0, 255]),
        layer([0, 255, 0, 255])
      ]
    })
    var fbo = ctx.regl.framebuffer({
      color: { texture: tex, layer: 0 },
      depth: false
    })
    var drawFbo = ctx.regl({
      framebuffer: fbo,
      viewport: { x: 0, y: 0, width: 2, height: 2 },
      vert: VERT,
      frag: [
        '#version 300 es',
        'precision highp float;',
        'out vec4 fragColor;',
        'void main () { fragColor = vec4(0.0, 0.0, 1.0, 1.0); }'
      ].join('\n'),
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]],
        uv: [[0, 0], [2, 0], [0, 2]]
      },
      count: 3
    })
    ctx.regl.clear({
      framebuffer: fbo,
      color: [0, 0, 0, 1]
    })
    drawFbo()
    var draw = makeDraw(ctx.regl, tex, [
      '#version 300 es',
      'precision highp float;',
      'uniform highp sampler3D tex;',
      'in vec2 vUv;',
      'out vec4 fragColor;',
      'void main () { fragColor = texture(tex, vec3(vUv, 0.25)); }'
    ].join('\n'))
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 0, 255, 255], 1, 'fbo layer 0')
    finish(ctx)
  })

  test('texture3D: context restore', async function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var ext = ctx.gl.getExtension('WEBGL_lose_context')
    if (!ext) {
      finish(ctx)
      return 'skipped (WEBGL_lose_context unavailable)'
    }
    var tex = ctx.regl.texture3D({
      width: 2,
      height: 2,
      depth: 2,
      data: [
        layer([255, 0, 0, 255]),
        layer([0, 255, 0, 255])
      ]
    })
    var draw = makeDraw(ctx.regl, tex, [
      '#version 300 es',
      'precision highp float;',
      'uniform highp sampler3D tex;',
      'in vec2 vUv;',
      'out vec4 fragColor;',
      'void main () { fragColor = texture(tex, vec3(vUv, 0.75)); }'
    ].join('\n'))
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, '3d before restore')

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
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, '3d after restore')
    finish(ctx)
  })
})()
