/* global window */
/**
 * WebGL2 MRT readBuffer / clearBuffer 测试。
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

  function createMRT (ctx) {
    var size = 4
    var a = ctx.regl.texture({
      width: size,
      height: size,
      min: 'nearest',
      mag: 'nearest'
    })
    var b = ctx.regl.texture({
      width: size,
      height: size,
      min: 'nearest',
      mag: 'nearest'
    })
    var fbo = ctx.regl.framebuffer({
      color: [a, b],
      depth: false
    })
    var draw = ctx.regl({
      framebuffer: fbo,
      viewport: { x: 0, y: 0, width: size, height: size },
      vert: [
        '#version 300 es',
        'in vec2 position;',
        'void main () { gl_Position = vec4(position, 0, 1); }'
      ].join('\n'),
      frag: [
        '#version 300 es',
        'precision highp float;',
        'layout(location = 0) out vec4 outA;',
        'layout(location = 1) out vec4 outB;',
        'void main () {',
        '  outA = vec4(1.0, 0.0, 0.0, 1.0);',
        '  outB = vec4(0.0, 1.0, 0.0, 1.0);',
        '}'
      ].join('\n'),
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]]
      },
      count: 3
    })
    draw()
    return { fbo: fbo, a: a, b: b }
  }

  test('MRT: readBuffer color attachment', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var mrt = createMRT(ctx)
    var a = ctx.regl.read({
      framebuffer: mrt.fbo,
      colorAttachment: 0
    })
    var b = ctx.regl.read({
      framebuffer: mrt.fbo,
      colorAttachment: 1
    })
    assertPixel(a, 4, [255, 0, 0, 255], 1, 'mrt read 0')
    assertPixel(b, 4, [0, 255, 0, 255], 1, 'mrt read 1')
    finish(ctx)
  })

  test('MRT: clearBuffer one attachment', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var mrt = createMRT(ctx)
    ctx.regl.clear({
      framebuffer: mrt.fbo,
      colorAttachment: 1,
      color: [0, 0, 1, 1]
    })
    var a = ctx.regl.read({
      framebuffer: mrt.fbo,
      colorAttachment: 0
    })
    var b = ctx.regl.read({
      framebuffer: mrt.fbo,
      colorAttachment: 1
    })
    assertPixel(a, 4, [255, 0, 0, 255], 1, 'clear attachment 1 keeps 0')
    assertPixel(b, 4, [0, 0, 255, 255], 1, 'clear attachment 1')
    finish(ctx)
  })

  test('MRT: clearBuffer multiple attachments', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var mrt = createMRT(ctx)
    ctx.regl.clear({
      framebuffer: mrt.fbo,
      colorAttachment: [0, 1],
      color: [1, 1, 0, 1]
    })
    var a = ctx.regl.read({
      framebuffer: mrt.fbo,
      colorAttachment: 0
    })
    var b = ctx.regl.read({
      framebuffer: mrt.fbo,
      colorAttachment: 1
    })
    assertPixel(a, 4, [255, 255, 0, 255], 1, 'clear both 0')
    assertPixel(b, 4, [255, 255, 0, 255], 1, 'clear both 1')
    finish(ctx)
  })
})()
