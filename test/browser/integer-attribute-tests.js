/* global window */
/**
 * WebGL2 整数顶点属性（vertexAttribIPointer）测试。
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
    'in ivec2 position;',
    'out vec4 vColor;',
    'void main () {',
    '  gl_Position = vec4(vec2(position) / 4.0, 0.0, 1.0);',
    '  vColor = vec4(1.0);',
    '}'
  ].join('\n')

  var FRAG = [
    '#version 300 es',
    'precision highp float;',
    'in vec4 vColor;',
    'out vec4 fragColor;',
    'void main () { fragColor = vColor; }'
  ].join('\n')

  test('integer attribute: ivec2 + Int32Array', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var buffer = ctx.regl.buffer(
      new Int32Array([-4, -4, 4, -4, 0, 4])
    )
    var draw = ctx.regl({
      vert: VERT,
      frag: FRAG,
      attributes: {
        position: {
          buffer: buffer,
          size: 2,
          type: 'int32'
        }
      },
      count: 3
    })
    draw()
    assert(ctx.gl.getError() === 0, 'no gl error for integer attribute')
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 255, 255, 255], 1, 'integer attr')
    finish(ctx)
  })

  test('integer attribute: uint8 normalized ignored', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var buffer = ctx.regl.buffer(
      new Uint8Array([0, 0, 8, 0, 4, 8])
    )
    var draw = ctx.regl({
      vert: [
        '#version 300 es',
        'in uvec2 position;',
        'out vec4 vColor;',
        'void main () {',
        '  gl_Position = vec4(vec2(position) / 8.0 - 0.5, 0.0, 1.0);',
        '  vColor = vec4(0.2, 0.8, 1.0, 1.0);',
        '}'
      ].join('\n'),
      frag: FRAG,
      attributes: {
        position: {
          buffer: buffer,
          size: 2,
          type: 'uint8',
          normalized: true
        }
      },
      count: 3
    })
    draw()
    assert(ctx.gl.getError() === 0, 'no gl error for uint8 integer attribute')
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [51, 204, 255, 255], 1, 'uint8 attr')
    finish(ctx)
  })

  test('integer attribute: VAO', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var vao = ctx.regl.vao({
      attributes: [
        {
          data: new Int32Array([-4, -4, 4, -4, 0, 4]),
          size: 2,
          type: 'int32',
          integer: true
        }
      ]
    })
    var draw = ctx.regl({
      vert: VERT,
      frag: FRAG,
      vao: vao,
      attributes: { position: 0 },
      count: 3
    })
    draw()
    assert(ctx.gl.getError() === 0, 'no gl error for VAO integer attribute')
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 255, 255, 255], 1, 'VAO integer attr')
    finish(ctx)
  })
})()
