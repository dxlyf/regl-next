/* global window */
/**
 * WebGL2 MSAA render target / blit resolve 测试。
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

  test('MSAA: renderbuffer samples', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var maxSamples = ctx.regl.limits.maxSamples
    assert(maxSamples >= 2, 'max samples')
    var samples = Math.min(4, maxSamples)
    var rb = ctx.regl.renderbuffer({
      width: 4,
      height: 4,
      format: 'rgba8',
      samples: samples
    })
    assert(rb.samples === samples, 'renderbuffer samples')
    var fbo = ctx.regl.framebuffer({
      width: 4,
      height: 4,
      samples: samples,
      depth: false
    })
    assert(fbo.samples === samples, 'framebuffer samples')
    finish(ctx)
  })

  test('MSAA: blit resolve color', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var maxSamples = ctx.regl.limits.maxSamples
    var samples = Math.min(4, maxSamples)
    var msaa = ctx.regl.framebuffer({
      width: 4,
      height: 4,
      samples: samples,
      depth: false
    })
    var resolveTexture = ctx.regl.texture({
      width: 4,
      height: 4,
      min: 'nearest',
      mag: 'nearest'
    })
    var resolve = ctx.regl.framebuffer({
      color: resolveTexture,
      depth: false
    })

    ctx.regl.clear({
      framebuffer: msaa,
      color: [1, 0, 0, 1]
    })
    ctx.regl.blitFramebuffer({
      src: msaa,
      dst: resolve,
      mask: 'color',
      filter: 'nearest'
    })

    var pixels = ctx.regl.read({ framebuffer: resolve })
    assertPixel(pixels, 8, [255, 0, 0, 255], 1, 'msaa resolve')
    finish(ctx)
  })

  test('MSAA: draw then resolve', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var maxSamples = ctx.regl.limits.maxSamples
    var samples = Math.min(4, maxSamples)
    var msaa = ctx.regl.framebuffer({
      width: 4,
      height: 4,
      samples: samples,
      depth: false
    })
    var resolveTexture = ctx.regl.texture({
      width: 4,
      height: 4,
      min: 'nearest',
      mag: 'nearest'
    })
    var resolve = ctx.regl.framebuffer({
      color: resolveTexture,
      depth: false
    })

    var draw = ctx.regl({
      framebuffer: msaa,
      viewport: { x: 0, y: 0, width: 4, height: 4 },
      vert: [
        'precision mediump float;',
        'attribute vec2 position;',
        'void main () { gl_Position = vec4(position, 0, 1); }'
      ].join('\n'),
      frag: [
        'precision mediump float;',
        'void main () { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }'
      ].join('\n'),
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]]
      },
      count: 3
    })

    ctx.regl.clear({
      framebuffer: msaa,
      color: [0, 0, 0, 1]
    })
    draw()
    ctx.regl.blitFramebuffer({
      src: msaa,
      dst: resolve,
      mask: 'color'
    })
    var pixels = ctx.regl.read({ framebuffer: resolve })
    assertPixel(pixels, 8, [0, 255, 0, 255], 1, 'msaa draw resolve')
    finish(ctx)
  })

  test('MSAA: WebGL1 errors', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var threw = false
    try {
      ctx.regl.renderbuffer({ width: 4, height: 4, samples: 4 })
    } catch (err) {
      threw = /samples|WebGL2/.test(String(err))
    }
    assert(threw, 'renderbuffer samples on WebGL1')
    finish(ctx)
  })
})()
