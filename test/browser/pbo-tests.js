/* global window */
/**
 * WebGL2 PBO 回读 / copyBufferSubData / getBufferSubData 测试。
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

  function makeRedFbo (ctx) {
    var texture = ctx.regl.texture({
      width: 4,
      height: 4,
      min: 'nearest',
      mag: 'nearest'
    })
    var fbo = ctx.regl.framebuffer({
      color: texture,
      depth: false
    })
    ctx.regl.clear({
      framebuffer: fbo,
      color: [1, 0, 0, 1]
    })
    return fbo
  }

  test('PBO: readPixelsToBuffer + readBuffer', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var fbo = makeRedFbo(ctx)
    var pbo = ctx.regl.pixelBuffer({ length: 4 * 4 * 4 })
    ctx.regl.readPixelsToBuffer({
      framebuffer: fbo,
      pixelBuffer: pbo
    })
    var data = ctx.regl.readBuffer(pbo)
    assert(data instanceof Uint8Array, 'readBuffer returns Uint8Array')
    assert(data.length === 64, 'readBuffer length')
    assertPixel(data, 4, [255, 0, 0, 255], 1, 'PBO read')
    finish(ctx)
  })

  test('PBO: offset readback', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var fbo = makeRedFbo(ctx)
    var pbo = ctx.regl.pixelBuffer({ length: 128 })
    ctx.regl.readPixelsToBuffer({
      framebuffer: fbo,
      pixelBuffer: pbo,
      offset: 16
    })
    var data = ctx.regl.readBuffer(pbo, { offset: 16, length: 64 })
    assertPixel(data, 4, [255, 0, 0, 255], 1, 'PBO offset read')
    finish(ctx)
  })

  test('buffer: copyBufferSubData', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var src = ctx.regl.buffer(new Float32Array([1.5, 2.5, 3.5]))
    var dst = ctx.regl.buffer(new Float32Array(3))
    ctx.regl.copyBufferSubData(src, dst, 0, 0, 12)
    var bytes = ctx.regl.readBuffer(dst)
    var values = new Float32Array(bytes.buffer, bytes.byteOffset, 3)
    assert(values[0] === 1.5 && values[1] === 2.5 && values[2] === 3.5, 'copied values')
    finish(ctx)
  })

  test('buffer: getBufferSubData with typed data', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var buffer = ctx.regl.buffer(new Float32Array([4, 5, 6]))
    var out = new Float32Array(3)
    var result = ctx.regl.readBuffer(buffer, { data: out })
    assert(result === out, 'readBuffer returns provided data')
    assert(out[0] === 4 && out[1] === 5 && out[2] === 6, 'getBufferSubData values')
    finish(ctx)
  })

  test('PBO: texture upload', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var pixels = new Uint8Array(16)
    for (var i = 0; i < 16; i += 4) {
      pixels[i] = 255
      pixels[i + 1] = 0
      pixels[i + 2] = 0
      pixels[i + 3] = 255
    }
    var pbo = ctx.regl.pixelBuffer(pixels)
    var texture = ctx.regl.texture({
      width: 2,
      height: 2,
      min: 'nearest',
      mag: 'nearest',
      pixelBuffer: pbo
    })
    var draw = ctx.regl({
      vert: [
        'precision mediump float;',
        'attribute vec2 position;',
        'attribute vec2 uv;',
        'varying vec2 vUv;',
        'void main () {',
        '  vUv = uv;',
        '  gl_Position = vec4(position, 0, 1);',
        '}'
      ].join('\n'),
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'varying vec2 vUv;',
        'void main () { gl_FragColor = texture2D(tex, vUv); }'
      ].join('\n'),
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]],
        uv: [[0, 0], [2, 0], [0, 2]]
      },
      uniforms: { tex: texture },
      count: 3
    })
    draw()
    assert(ctx.gl.getError() === 0, 'no GL error for PBO texture upload')
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'PBO texture')
    finish(ctx)
  })

  test('PBO: WebGL1 error', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var threw = false
    try {
      ctx.regl.pixelBuffer({ length: 16 })
    } catch (err) {
      threw = /WebGL2/.test(String(err))
    }
    assert(threw, 'pixelBuffer on WebGL1')
    finish(ctx)
  })
})()
