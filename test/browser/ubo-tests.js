/* global window */
/**
 * Uniform Buffer（WebGL2 UBO）浏览器测试。
 */
(function () {
  'use strict'

  var kit = window.reglTestKit
  var test = kit.test
  var assert = kit.assert
  var assertNear = kit.assertNear
  var assertPixel = kit.assertPixel
  var makeRegl = kit.makeRegl
  var pixelAt = kit.pixelAt
  var finish = kit.finish
  var FULLSCREEN_VERT = kit.FULLSCREEN_VERT

  var UBO_VERT = [
    '#version 300 es',
    'layout(std140) uniform Camera {',
    '  mat4 transform;',
    '  vec4 color;',
    '};',
    'in vec2 position;',
    'void main () {',
    '  gl_Position = transform * vec4(position, 0.0, 1.0);',
    '}'
  ].join('\n')

  var UBO_FRAG = [
    '#version 300 es',
    'precision highp float;',
    'layout(std140) uniform Camera {',
    '  mat4 transform;',
    '  vec4 color;',
    '};',
    'out vec4 fragColor;',
    'void main () { fragColor = color; }'
  ].join('\n')

  var SIMPLE_FRAG = [
    'precision mediump float;',
    'void main () { gl_FragColor = vec4(1.0); }'
  ].join('\n')

  function uboData (color) {
    // std140: mat4 占 64 字节，vec4 从 offset 64 开始
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
      color[0], color[1], color[2], color[3]
    ])
  }

  test('UBO: raw buffer + member updates', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var ubo = ctx.regl.uniformBuffer({
      data: uboData([1, 0, 0, 1]),
      usage: 'dynamic'
    })
    var draw = ctx.regl({
      vert: UBO_VERT,
      frag: UBO_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: { Camera: ubo },
      count: 3
    })

    assert(ubo.layout, 'layout resolved')
    assert(ubo.layout.dataSize >= 80, 'block data size')
    var colorMember = null
    var names = Object.keys(ubo.layout.members)
    for (var i = 0; i < names.length; ++i) {
      if (names[i] === 'color' || names[i].indexOf('color') >= 0) {
        colorMember = ubo.layout.members[names[i]]
      }
    }
    assert(colorMember, 'color member layout')
    assert(
      colorMember.offset === 64,
      'color offset = 64, got ' + colorMember.offset
    )

    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'ubo red')

    ubo.member('color', [0, 1, 0, 1])
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'ubo member green')

    ubo.set({ color: [0, 0, 1, 1] })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 0, 255, 255], 1, 'ubo set blue')
    finish(ctx)
  })

  test('UBO: range binding + explicit binding', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var alignment = ctx.regl.limits.uniformBufferOffsetAlignment || 256
    var offset = Math.max(alignment, 256)
    var data = new Float32Array((offset + 80) / 4)
    data.set(uboData([1, 0, 0, 1]), 0)
    data.set(uboData([0, 1, 0, 1]), offset / 4)
    var ubo = ctx.regl.uniformBuffer({ data: data, usage: 'dynamic' })
    var draw = ctx.regl({
      vert: UBO_VERT,
      frag: UBO_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: {
        Camera: {
          buffer: ubo,
          offset: offset,
          size: 80,
          binding: 2
        }
      },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'ubo range green')
    finish(ctx)
  })

  test('UBO: scope inheritance', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var ubo = ctx.regl.uniformBuffer({ data: uboData([1, 0, 1, 1]) })
    var draw = ctx.regl({
      vert: UBO_VERT,
      frag: UBO_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      count: 3
    })
    var setup = ctx.regl({ uniformBlocks: { Camera: ubo } })
    setup(function () {
      draw()
    })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 255, 255], 1, 'ubo scope')
    finish(ctx)
  })

  test('UBO: batch with prop buffer', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var red = ctx.regl.uniformBuffer({ data: uboData([1, 0, 0, 1]) })
    var green = ctx.regl.uniformBuffer({ data: uboData([0, 1, 0, 1]) })
    var draw = ctx.regl({
      vert: UBO_VERT,
      frag: UBO_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: { Camera: ctx.regl.prop('camera') },
      viewport: ctx.regl.prop('viewport'),
      count: 3
    })
    draw([
      {
        camera: red,
        viewport: { x: 0, y: 0, width: 8, height: 16 }
      },
      {
        camera: green,
        viewport: { x: 8, y: 0, width: 8, height: 16 }
      }
    ])
    assertPixel(pixelAt(ctx.regl, 4, 8), 0, [255, 0, 0, 255], 1, 'ubo batch red')
    assertPixel(pixelAt(ctx.regl, 12, 8), 0, [0, 255, 0, 255], 1, 'ubo batch green')
    finish(ctx)
  })

  test('UBO: multiple blocks + dynamic shader layout', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var camera = ctx.regl.uniformBuffer({ data: uboData([1, 0, 0, 1]) })
    var tint = ctx.regl.uniformBuffer({
      data: new Float32Array([0, 0, 1, 1])
    })
    var vert = [
      '#version 300 es',
      'layout(std140) uniform Camera { mat4 transform; };',
      'in vec2 position;',
      'void main () { gl_Position = transform * vec4(position, 0.0, 1.0); }'
    ].join('\n')
    var frag = [
      '#version 300 es',
      'precision highp float;',
      'layout(std140) uniform Tint { vec4 color; };',
      'out vec4 fragColor;',
      'void main () { fragColor = color; }'
    ].join('\n')
    var draw = ctx.regl({
      vert: ctx.regl.prop('vert'),
      frag: ctx.regl.prop('frag'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: {
        Camera: camera,
        Tint: tint
      },
      count: 3
    })
    assert(camera.layout === null, 'dynamic shader layout not resolved before draw')
    draw({ vert: vert, frag: frag })
    assert(camera.layout, 'camera layout resolved after draw')
    assert(tint.layout, 'tint layout resolved after draw')
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 0, 255, 255], 1, 'two blocks')

    var layout = draw.uniformBlockLayout('Tint')
    assert(layout && layout.dataSize >= 16, 'command layout')
    tint.member('color', [0, 1, 0, 1])
    draw({ vert: vert, frag: frag })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'tint member')
    finish(ctx)
  })

  test('UBO: WebGL1 errors', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var threw = false
    try {
      ctx.regl.uniformBuffer({ size: 64 })
    } catch (err) {
      threw = /WebGL2/.test(String(err))
    }
    assert(threw, 'uniformBuffer throws on WebGL1')

    threw = false
    var uboErr = ''
    try {
      ctx.regl({
        vert: FULLSCREEN_VERT,
        frag: SIMPLE_FRAG,
        uniformBlocks: { Camera: {} },
        count: 1
      })
    } catch (err) {
      uboErr = String(err)
      threw = /WebGL2/.test(uboErr)
    }
    assert(threw, 'uniformBlocks throws on WebGL1: ' + uboErr)
    finish(ctx)
  })

  test('UBO: context restore + member rewrite', async function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var ext = ctx.gl.getExtension('WEBGL_lose_context')
    if (!ext) {
      finish(ctx)
      return 'skipped (WEBGL_lose_context unavailable)'
    }
    var ubo = ctx.regl.uniformBuffer({ data: uboData([1, 0, 0, 1]) })
    var draw = ctx.regl({
      vert: UBO_VERT,
      frag: UBO_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: { Camera: ubo },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'ubo before restore')

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

    // buffer 内容按旧版 buffer 语义不会持久化；layout 仍然有效
    assert(ubo.layout, 'layout survives restore')
    ubo.member('transform', [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ])
    ubo.member('color', [0, 1, 0, 1])
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'ubo after restore')
    finish(ctx)
  })

  test('UBO: limits', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    assert(ctx.regl.limits.maxUniformBlockSize > 0, 'max block size')
    assert(ctx.regl.limits.maxUniformBufferBindings > 0, 'max bindings')
    assert(ctx.regl.limits.uniformBufferOffsetAlignment > 0, 'offset alignment')
    finish(ctx)
  })

  test('UBO: array member stride / vec3 padding', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var ubo = ctx.regl.uniformBuffer({ size: 128, usage: 'dynamic' })
    var vert = [
      '#version 300 es',
      'in vec2 position;',
      'void main () { gl_Position = vec4(position, 0.0, 1.0); }'
    ].join('\n')
    var frag = [
      '#version 300 es',
      'precision highp float;',
      'layout(std140) uniform Params {',
      '  float weights[4];',
      '  vec3 tint;',
      '  float scale;',
      '};',
      'out vec4 fragColor;',
      'void main () { fragColor = vec4(tint * scale, weights[2]); }'
    ].join('\n')
    var draw = ctx.regl({
      vert: vert,
      frag: frag,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: { Params: ubo },
      count: 3
    })
    ubo.set({
      weights: [0.1, 0.2, 1, 0.4],
      tint: [0, 1, 0],
      scale: 1
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'array stride')
    ubo.member('weights[2]', 0.5)
    draw()
    assertNear(pixelAt(ctx.regl, 8, 8)[3], 128, 2, 'array element update')
    var weights = ubo.layout.members['Params.weights[0]'] ||
      ubo.layout.members['weights[0]'] ||
      ubo.layout.members.weights
    assert(weights && weights.arrayStride === 16, 'weights array stride')
    assert(weights.offset === 0, 'weights offset')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // Phase 2：结构化值自动打包
  // -------------------------------------------------------------------------

  var IDENTITY = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]

  test('UBO Phase 2: static structured values', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var draw = ctx.regl({
      vert: UBO_VERT,
      frag: UBO_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: {
        Camera: {
          transform: IDENTITY,
          color: [1, 0, 0, 1]
        }
      },
      count: 3
    })
    draw()
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'static structured')
    finish(ctx)
  })

  test('UBO Phase 2: dynamic structured + diff', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var draw = ctx.regl({
      vert: UBO_VERT,
      frag: UBO_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: {
        Camera: {
          transform: ctx.regl.prop('transform'),
          color: ctx.regl.prop('color')
        }
      },
      count: 3
    })
    draw({ transform: IDENTITY, color: [1, 0, 0, 1] })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'dynamic red')
    draw({ transform: IDENTITY, color: [0, 1, 0, 1] })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'dynamic green')
    finish(ctx)
  })

  test('UBO Phase 2: missing members keep previous value', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var draw = ctx.regl({
      vert: UBO_VERT,
      frag: UBO_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: {
        Camera: ctx.regl.prop('camera')
      },
      count: 3
    })
    draw({ camera: { transform: IDENTITY, color: [1, 0, 0, 1] } })
    // 省略 transform，应保留上一次的矩阵
    draw({ camera: { color: [0, 1, 0, 1] } })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'keep previous')
    finish(ctx)
  })

  test('UBO Phase 2: scope inheritance', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var draw = ctx.regl({
      vert: UBO_VERT,
      frag: UBO_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      count: 3
    })
    var setup = ctx.regl({
      uniformBlocks: {
        Camera: { transform: IDENTITY, color: [1, 0, 1, 1] }
      }
    })
    setup(function () {
      draw()
    })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 255, 255], 1, 'structured scope')
    finish(ctx)
  })

  test('UBO Phase 2: batch structured values', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var draw = ctx.regl({
      vert: UBO_VERT,
      frag: UBO_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: {
        Camera: {
          transform: IDENTITY,
          color: ctx.regl.prop('color')
        }
      },
      viewport: ctx.regl.prop('viewport'),
      count: 3
    })
    draw([
      { color: [1, 0, 0, 1], viewport: { x: 0, y: 0, width: 8, height: 16 } },
      { color: [0, 1, 0, 1], viewport: { x: 8, y: 0, width: 8, height: 16 } }
    ])
    assertPixel(pixelAt(ctx.regl, 4, 8), 0, [255, 0, 0, 255], 1, 'structured batch red')
    assertPixel(pixelAt(ctx.regl, 12, 8), 0, [0, 255, 0, 255], 1, 'structured batch green')
    finish(ctx)
  })

  test('UBO Phase 2: explicit values wrapper + binding', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var draw = ctx.regl({
      vert: UBO_VERT,
      frag: UBO_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: {
        Camera: {
          values: {
            transform: IDENTITY,
            color: [1, 0, 0, 1]
          },
          binding: 2
        }
      },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'values wrapper')
    finish(ctx)
  })

  test('UBO Phase 2: array + vec3 structured values', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var vert = [
      '#version 300 es',
      'in vec2 position;',
      'void main () { gl_Position = vec4(position, 0.0, 1.0); }'
    ].join('\n')
    var frag = [
      '#version 300 es',
      'precision highp float;',
      'layout(std140) uniform Params {',
      '  float weights[4];',
      '  vec3 tint;',
      '  float scale;',
      '};',
      'out vec4 fragColor;',
      'void main () { fragColor = vec4(tint * scale, weights[2]); }'
    ].join('\n')
    var draw = ctx.regl({
      vert: vert,
      frag: frag,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: {
        Params: {
          weights: [0.1, 0.2, 1, 0.4],
          tint: [0, 1, 0],
          scale: 1
        }
      },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'structured array')
    finish(ctx)
  })

  test('UBO Phase 2: nested struct array', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var vert = [
      '#version 300 es',
      'in vec2 position;',
      'void main () { gl_Position = vec4(position, 0.0, 1.0); }'
    ].join('\n')
    var frag = [
      '#version 300 es',
      'precision highp float;',
      'struct Light { vec4 color; float intensity; };',
      'layout(std140) uniform Scene { Light lights[2]; };',
      'out vec4 fragColor;',
      'void main () {',
      '  fragColor = lights[1].color * lights[1].intensity;',
      '}'
    ].join('\n')
    var draw = ctx.regl({
      vert: vert,
      frag: frag,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: {
        Scene: {
          lights: [
            { color: [1, 0, 0, 1], intensity: 0 },
            { color: [0, 1, 0, 1], intensity: 1 }
          ]
        }
      },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'struct array')
    finish(ctx)
  })

  test('UBO Phase 2: mixed with Phase 1 resource', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var camera = ctx.regl.uniformBuffer({ data: uboData([1, 1, 1, 1]) })
    var vert = [
      '#version 300 es',
      'layout(std140) uniform Camera { mat4 transform; vec4 color; };',
      'in vec2 position;',
      'void main () { gl_Position = transform * vec4(position, 0.0, 1.0); }'
    ].join('\n')
    var frag = [
      '#version 300 es',
      'precision highp float;',
      'layout(std140) uniform Camera { mat4 transform; vec4 color; };',
      'layout(std140) uniform Tint { vec4 tint; };',
      'out vec4 fragColor;',
      'void main () { fragColor = color * tint; }'
    ].join('\n')
    var draw = ctx.regl({
      vert: vert,
      frag: frag,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: {
        Camera: camera,
        Tint: { values: { tint: [0, 1, 0, 1] } }
      },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'mixed blocks')
    finish(ctx)
  })

  test('UBO Phase 2: context restore re-packs structured values', async function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var ext = ctx.gl.getExtension('WEBGL_lose_context')
    if (!ext) {
      finish(ctx)
      return 'skipped (WEBGL_lose_context unavailable)'
    }
    var draw = ctx.regl({
      vert: UBO_VERT,
      frag: UBO_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniformBlocks: {
        Camera: {
          transform: IDENTITY,
          color: ctx.regl.prop('color')
        }
      },
      count: 3
    })
    draw({ color: [1, 0, 0, 1] })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'structured before restore')

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

    draw({ color: [0, 1, 0, 1] })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'structured after restore')
    finish(ctx)
  })
})()
