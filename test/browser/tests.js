/* global window, document, createREGL */
/**
 * regl-next 浏览器端集成测试。
 *
 * 这些测试运行在真实 WebGL1/WebGL2 上下文（Chrome + SwiftShader）上，
 * 覆盖绘制、uniform、batch、scope、纹理、FBO、VAO、实例化、MRT、上下文丢失等。
 */
(function () {
  'use strict'

  var tests = []

  function test(name, fn, options) {
    tests.push({ name: name, fn: fn, options: options || {} })
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message || 'assertion failed')
  }

  function assertNear(actual, expected, tolerance, message) {
    tolerance = tolerance === undefined ? 2 : tolerance
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(
        (message || 'value mismatch') +
          ': got ' +
          actual +
          ', expected ' +
          expected +
          ' (±' +
          tolerance +
          ')'
      )
    }
  }

  function assertPixel(pixels, index, expected, tolerance, message) {
    var offset = index * 4
    for (var i = 0; i < 4; ++i) {
      assertNear(
        pixels[offset + i],
        expected[i],
        tolerance === undefined ? 2 : tolerance,
        (message || 'pixel') + ' channel ' + i
      )
    }
  }

  function makeContext(version) {
    var canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    // 上下文丢失事件只在已挂载的画布上稳定触发
    document.body.appendChild(canvas)
    var gl = canvas.getContext(version, {
      preserveDrawingBuffer: true,
      antialias: false,
      alpha: true,
      depth: true,
      stencil: true
    })
    if (!gl) return null
    return { canvas: canvas, gl: gl }
  }

  // 复用 WebGL1 / WebGL2 上下文，避免触发浏览器的上下文数量上限。
  var contextPool = {}

  function getContext(version) {
    var cached = contextPool[version]
    if (cached && !cached.gl.isContextLost()) {
      return cached
    }
    var ctx = makeContext(version)
    if (ctx) contextPool[version] = ctx
    return ctx
  }

  function makeRegl(version, options) {
    var ctx = getContext(version)
    if (!ctx) return null
    var regl = createREGL(
      Object.assign(
        {
          gl: ctx.gl,
          attributes: {
            preserveDrawingBuffer: true,
            antialias: false,
            alpha: false,
            depth: true,
            stencil: true
          }
        },
        options || {}
      )
    )
    return { regl: regl, gl: ctx.gl, canvas: ctx.canvas }
  }

  /** 把 GL 状态恢复到默认值，避免测试之间互相污染。 */
  function resetGL(gl) {
    try {
      var extVAO = gl.getExtension('OES_vertex_array_object')
      if (extVAO) extVAO.bindVertexArrayOES(null)
      if (gl.bindVertexArray) gl.bindVertexArray(null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.bindRenderbuffer(gl.RENDERBUFFER, null)
      gl.bindBuffer(gl.ARRAY_BUFFER, null)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
      gl.useProgram(null)
      for (var i = 0; i < 8; ++i) {
        gl.activeTexture(gl.TEXTURE0 + i)
        gl.bindTexture(gl.TEXTURE_2D, null)
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, null)
      }
      gl.disable(gl.BLEND)
      gl.disable(gl.CULL_FACE)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.SCISSOR_TEST)
      gl.disable(gl.STENCIL_TEST)
      gl.disable(gl.POLYGON_OFFSET_FILL)
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE)
      gl.disable(gl.SAMPLE_COVERAGE)
      gl.colorMask(true, true, true, true)
      gl.depthMask(true)
      gl.depthFunc(gl.LESS)
      gl.depthRange(0, 1)
      gl.stencilMask(0xffffffff)
      gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ZERO)
      gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD)
      gl.cullFace(gl.BACK)
      gl.frontFace(gl.CCW)
      gl.lineWidth(1)
      gl.polygonOffset(0, 0)
      gl.sampleCoverage(1, false)
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.scissor(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
      var maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS)
      for (var a = 0; a < maxAttributes; ++a) {
        gl.disableVertexAttribArray(a)
        gl.vertexAttrib4f(a, 0, 0, 0, 1)
      }
      gl.clearColor(0, 0, 0, 0)
      gl.clearDepth(1)
      gl.clearStencil(0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    } catch (e) {}
  }

  function finish(ctx) {
    try {
      ctx.regl.destroy()
    } catch (e) {}
    resetGL(ctx.gl)
  }

  function pixelAt(regl, x, y, framebuffer) {
    var data = new Uint8Array(4)
    regl.read({
      x: x,
      y: y,
      width: 1,
      height: 1,
      data: data,
      framebuffer: framebuffer || null
    })
    return data
  }

  var FULLSCREEN_VERT = [
    'precision mediump float;',
    'attribute vec2 position;',
    'void main () { gl_Position = vec4(position, 0.0, 1.0); }'
  ].join('\n')

  var SOLID_FRAG = [
    'precision mediump float;',
    'uniform vec4 color;',
    'void main () { gl_FragColor = color; }'
  ].join('\n')

  function fullscreenTriangle(extra) {
    return Object.assign(
      {
        vert: FULLSCREEN_VERT,
        frag: SOLID_FRAG,
        attributes: {
          position: [[-1, -1], [3, -1], [-1, 3]]
        },
        uniforms: { color: [1, 0, 0, 1] },
        count: 3,
        viewport: { x: 0, y: 0, width: 16, height: 16 }
      },
      extra || {}
    )
  }

  // -------------------------------------------------------------------------
  // 基础绘制
  // -------------------------------------------------------------------------
  test('triangle (webgl1)', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl(fullscreenTriangle())
    draw()
    var pixels = ctx.regl.read()
    assertPixel(pixels, 0, [255, 0, 0, 255], 0, 'bottom-left')
    assertPixel(pixels, 15 * 16 + 15, [255, 0, 0, 255], 0, 'top-right')
    assert(ctx.gl.getError() === 0, 'gl error after draw')
    finish(ctx)
  })

  test('triangle (webgl2)', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var draw = ctx.regl(fullscreenTriangle())
    draw()
    var pixels = ctx.regl.read()
    assertPixel(pixels, 0, [255, 0, 0, 255], 0, 'bottom-left')
    assert(ctx.gl.getError() === 0, 'gl error after draw')
    finish(ctx)
  })

  test('uniforms: vector, int, matrix', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl({
      vert: [
        'precision mediump float;',
        'attribute vec2 position;',
        'uniform mat4 transform;',
        'void main () { gl_Position = transform * vec4(position, 0.0, 1.0); }'
      ].join('\n'),
      frag: [
        'precision mediump float;',
        'uniform vec2 color;',
        'uniform int extra;',
        'void main () { gl_FragColor = vec4(color, float(extra) / 255.0, 1.0); }'
      ].join('\n'),
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]]
      },
      uniforms: {
        transform: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1
        ],
        color: [0.25, 0.5],
        extra: 51
      },
      count: 3,
      viewport: { x: 0, y: 0, width: 4, height: 4 }
    })
    draw()
    var pixels = ctx.regl.read({ width: 4, height: 4 })
    assertPixel(pixels, 0, [64, 128, 51, 255], 1, 'uniform pixel')
    finish(ctx)
  })

  test('dynamic props + batch + viewport', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl(
      fullscreenTriangle({
        uniforms: { color: ctx.regl.prop('color') },
        viewport: ctx.regl.prop('viewport')
      })
    )
    draw([
      { color: [1, 0, 0, 1], viewport: { x: 0, y: 0, width: 4, height: 16 } },
      { color: [0, 1, 0, 1], viewport: { x: 4, y: 0, width: 4, height: 16 } },
      { color: [0, 0, 1, 1], viewport: { x: 8, y: 0, width: 4, height: 16 } }
    ])
    assertPixel(pixelAt(ctx.regl, 1, 8), 0, [255, 0, 0, 255], 1, 'batch 0')
    assertPixel(pixelAt(ctx.regl, 5, 8), 0, [0, 255, 0, 255], 1, 'batch 1')
    assertPixel(pixelAt(ctx.regl, 9, 8), 0, [0, 0, 255, 255], 1, 'batch 2')
    finish(ctx)
  })

  test('scope inherits uniforms/state', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl(
      fullscreenTriangle({
        uniforms: {},
        frag: [
          'precision mediump float;',
          'uniform vec4 color;',
          'void main () { gl_FragColor = color; }'
        ].join('\n'),
        viewport: undefined
      })
    )
    var setup = ctx.regl({
      uniforms: { color: [0, 0.5, 0, 1] },
      viewport: { x: 0, y: 0, width: 8, height: 8 }
    })
    setup(function () {
      draw()
    })
    var pixels = ctx.regl.read({ width: 8, height: 8 })
    assertPixel(pixels, 0, [0, 128, 0, 255], 2, 'scope uniform')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // elements / offset
  // -------------------------------------------------------------------------
  test('elements + offset', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: {
        position: [[-1, -1], [1, -1], [1, 1], [-1, 1]]
      },
      elements: {
        data: [0, 1, 2, 0, 2, 3],
        primitive: 'triangles',
        count: 6
      },
      uniforms: { color: [1, 0, 0, 1] },
      count: 3,
      offset: 3
    })
    ctx.regl.clear({ color: [0, 0, 0, 1] })
    draw()
    // 第二个三角形（索引 0,2,3）覆盖左上部分
    assertPixel(pixelAt(ctx.regl, 2, 13), 0, [255, 0, 0, 255], 1, 'offset triangle')
    assertPixel(pixelAt(ctx.regl, 13, 2), 0, [0, 0, 0, 255], 1, 'background')
    finish(ctx)
  })

  test('elements subdata', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var elements = ctx.regl.elements({
      data: [0, 1, 2, 1, 2, 3],
      primitive: 'triangles',
      count: 6
    })
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: {
        position: [[-1, -1], [1, -1], [1, 1], [-1, 1]]
      },
      elements: elements,
      uniforms: { color: [0, 1, 0, 1] }
    })
    elements.subdata([0, 1, 2], 0)
    draw()
    assertPixel(pixelAt(ctx.regl, 2, 2), 0, [0, 255, 0, 255], 1, 'subdata triangle')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // 纹理
  // -------------------------------------------------------------------------
  test('texture 2d sampling', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var texture = ctx.regl.texture([
      [[255, 0, 0], [0, 255, 0]],
      [[0, 0, 255], [255, 255, 255]]
    ])
    assert(texture.width === 2 && texture.height === 2, 'texture size')
    assert(texture.format === 'rgb', 'texture format: ' + texture.format)
    var draw = ctx.regl({
      vert: [
        'precision mediump float;',
        'attribute vec2 position;',
        'varying vec2 uv;',
        'void main () { uv = 0.5 * (1.0 + position); gl_Position = vec4(position, 0.0, 1.0); }'
      ].join('\n'),
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'varying vec2 uv;',
        'void main () { gl_FragColor = texture2D(tex, uv); }'
      ].join('\n'),
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]]
      },
      uniforms: { tex: texture },
      count: 3
    })
    draw()
    var pixels = ctx.regl.read()
    // 左下 -> (0,0) 红色；右下 -> (1,0) 绿色；左上 -> (0,1) 蓝色；右上白色
    assertPixel(pixels, 0, [255, 0, 0, 255], 2, 'texture bottom-left')
    assertPixel(pixels, 15, [0, 255, 0, 255], 2, 'texture bottom-right')
    assertPixel(pixels, 15 * 16, [0, 0, 255, 255], 2, 'texture top-left')
    assertPixel(pixels, 15 * 16 + 15, [255, 255, 255, 255], 2, 'texture top-right')
    finish(ctx)
  })

  test('texture subimage + resize', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var texture = ctx.regl.texture({
      width: 2,
      height: 2,
      data: new Uint8Array([
        255, 0, 0, 255, 255, 0, 0, 255,
        255, 0, 0, 255, 255, 0, 0, 255
      ])
    })
    texture.resize(4, 4)
    texture.subimage({ width: 1, height: 1, data: [0, 0, 255, 255] }, 0, 0)
    assert(texture.width === 4 && texture.height === 4, 'resized texture')
    var draw = ctx.regl({
      vert: [
        'precision mediump float;',
        'attribute vec2 position;',
        'varying vec2 uv;',
        'void main () { uv = 0.5 * (1.0 + position); gl_Position = vec4(position, 0.0, 1.0); }'
      ].join('\n'),
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'varying vec2 uv;',
        'void main () { gl_FragColor = texture2D(tex, uv); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: texture },
      count: 3
    })
    draw()
    var pixels = ctx.regl.read()
    assertPixel(pixels, 0, [0, 0, 255, 255], 2, 'subimage bottom-left')
    finish(ctx)
  })

  test('float texture (webgl2)', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var texture = ctx.regl.texture({
      width: 1,
      height: 1,
      format: 'rgba',
      type: 'float',
      data: new Float32Array([0.5, 0.25, 0.75, 1])
    })
    assert(texture.type === 'float' || texture.type === 'float32', 'float type: ' + texture.type)
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'void main () { gl_FragColor = texture2D(tex, vec2(0.5)); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: texture },
      count: 3
    })
    draw()
    var pixels = ctx.regl.read()
    assertPixel(pixels, 0, [128, 64, 191, 255], 2, 'float texture')
    finish(ctx)
  })

  test('half float texture from plain array', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var texture = ctx.regl.texture({
      width: 1,
      height: 1,
      format: 'rgba',
      type: 'half float',
      data: [1, 0.5, 0.25, 1]
    })
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'void main () { gl_FragColor = texture2D(tex, vec2(0.5)); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: texture },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 128, 64, 255], 2, 'half float data')
    finish(ctx)
  })

  test('texture float formats + canonical type names', function () {
    var ctx = makeRegl('webgl', {
      optionalExtensions: ['oes_texture_float']
    })
    assert(ctx, 'webgl not supported')
    if (!ctx.regl.hasExtension('oes_texture_float')) {
      finish(ctx)
      return 'skipped (OES_texture_float unavailable)'
    }
    var cases = [
      { type: 'float', shape: [1, 1, 1], format: 'luminance', formatName: 'luminance' },
      { type: 'float', shape: [1, 1], format: 'alpha', formatName: 'alpha' },
      { type: 'float', shape: [1, 1, 2], formatName: 'luminance alpha' },
      { type: 'float', shape: [1, 1, 3], formatName: 'rgb' }
    ]
    for (var i = 0; i < cases.length; ++i) {
      var texture = ctx.regl.texture(cases[i])
      assert(texture.type === 'float32', 'canonical float32: ' + texture.type)
      assert(texture.format === cases[i].formatName, 'format ' + cases[i].formatName)
    }
    assert(ctx.gl.getError() === 0, 'float format uploads')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // Framebuffer
  // -------------------------------------------------------------------------
  test('framebuffer render to texture', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var fbo = ctx.regl.framebuffer({
      width: 4,
      height: 4,
      colorFormat: 'rgba',
      depth: false,
      stencil: false
    })
    var drawFBO = ctx.regl(
      fullscreenTriangle({
        framebuffer: fbo,
        viewport: { x: 0, y: 0, width: 4, height: 4 },
        uniforms: { color: [0, 0, 1, 1] }
      })
    )
    drawFBO()
    var pixels = ctx.regl.read({ framebuffer: fbo })
    assertPixel(pixels, 0, [0, 0, 255, 255], 1, 'fbo read')

    var drawScreen = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'void main () { gl_FragColor = texture2D(tex, vec2(0.5)); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: fbo.color[0] },
      count: 3,
      viewport: { x: 0, y: 0, width: 8, height: 8 }
    })
    drawScreen()
    assertPixel(pixelAt(ctx.regl, 4, 4), 0, [0, 0, 255, 255], 1, 'fbo texture')
    finish(ctx)
  })

  test('framebuffer resize', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var fbo = ctx.regl.framebuffer({ radius: 4, depth: false, stencil: false })
    fbo.resize(8, 8)
    assert(fbo.width === 8 && fbo.height === 8, 'fbo size')
    assert(fbo.color[0].width === 8, 'attachment resized')
    var draw = ctx.regl(
      fullscreenTriangle({
        framebuffer: fbo,
        viewport: { x: 0, y: 0, width: 8, height: 8 },
        uniforms: { color: [1, 1, 0, 1] }
      })
    )
    draw()
    var pixels = ctx.regl.read({ framebuffer: fbo })
    assertPixel(pixels, 0, [255, 255, 0, 255], 1, 'resized fbo')
    finish(ctx)
  })

  test('MRT (webgl2)', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var fbo = ctx.regl.framebuffer({
      width: 4,
      height: 4,
      colorCount: 2,
      depth: false,
      stencil: false
    })
    assert(fbo.color.length === 2, 'two color attachments')
    var draw = ctx.regl({
      vert: [
        '#version 300 es',
        'in vec2 position;',
        'void main () { gl_Position = vec4(position, 0.0, 1.0); }'
      ].join('\n'),
      frag: [
        '#version 300 es',
        'precision highp float;',
        'layout(location = 0) out vec4 out0;',
        'layout(location = 1) out vec4 out1;',
        'void main () { out0 = vec4(1.0, 0.0, 0.0, 1.0); out1 = vec4(0.0, 1.0, 0.0, 1.0); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      count: 3,
      framebuffer: fbo,
      viewport: { x: 0, y: 0, width: 4, height: 4 }
    })
    draw()

    var drawScreen = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'void main () { gl_FragColor = texture2D(tex, vec2(0.5)); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: fbo.color[1] },
      count: 3,
      viewport: { x: 0, y: 0, width: 4, height: 4 }
    })
    drawScreen()
    assertPixel(pixelAt(ctx.regl, 2, 2), 0, [0, 255, 0, 255], 1, 'mrt second attachment')
    finish(ctx)
  })

  test('MRT (webgl1 / WEBGL_draw_buffers)', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    if (!ctx.regl.hasExtension('webgl_draw_buffers')) {
      finish(ctx)
      return 'skipped (WEBGL_draw_buffers unavailable)'
    }
    var fbo = ctx.regl.framebuffer({
      width: 4,
      height: 4,
      colorCount: 2,
      depth: false,
      stencil: false
    })
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        '#extension GL_EXT_draw_buffers : require',
        'precision mediump float;',
        'void main () {',
        '  gl_FragData[0] = vec4(1.0, 0.0, 0.0, 1.0);',
        '  gl_FragData[1] = vec4(0.0, 0.0, 1.0, 1.0);',
        '}'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      count: 3,
      framebuffer: fbo,
      viewport: { x: 0, y: 0, width: 4, height: 4 }
    })
    draw()
    var pixels = ctx.regl.read({
      framebuffer: fbo,
      width: 1,
      height: 1,
      data: new Uint8Array(4)
    })
    assertPixel(pixels, 0, [255, 0, 0, 255], 1, 'webgl1 mrt first')
    finish(ctx)
  })

  test('cube framebuffer', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var cube = ctx.regl.framebufferCube(4)
    var draw = ctx.regl(
      fullscreenTriangle({
        framebuffer: cube.faces[2],
        viewport: { x: 0, y: 0, width: 4, height: 4 },
        uniforms: { color: [1, 0, 1, 1] }
      })
    )
    draw()
    var pixels = ctx.regl.read({ framebuffer: cube.faces[2] })
    assertPixel(pixels, 0, [255, 0, 255, 255], 1, 'cube face 2')
    assert(cube.faces.length === 6, 'six cube faces')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // VAO / instancing
  // -------------------------------------------------------------------------
  test('vao + instancing', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var indexBuffer = ctx.regl.elements({
      data: [0, 1, 2, 0, 2, 3],
      primitive: 'triangles',
      count: 6
    })
    var vao = ctx.regl.vao({
      attributes: [
        // 顶点位置：单位四边形
        { data: [[-0.4, -0.8], [0.4, -0.8], [0.4, 0.8], [-0.4, 0.8]] },
        // instancing：每个实例的偏移
        {
          data: [[-0.9, 0], [0, 0], [0.9, 0]],
          divisor: 1
        }
      ],
      elements: indexBuffer
    })
    var draw = ctx.regl({
      vert: [
        'precision mediump float;',
        'attribute vec2 position;',
        'attribute vec2 offset;',
        'void main () { gl_Position = vec4(position + offset, 0.0, 1.0); }'
      ].join('\n'),
      frag: SOLID_FRAG,
      attributes: { position: 0, offset: 1 },
      uniforms: { color: [0, 1, 1, 1] },
      vao: vao,
      instances: 3,
      viewport: { x: 0, y: 0, width: 16, height: 16 }
    })
    draw()
    var pixels = ctx.regl.read()
    assertPixel(pixelAt(ctx.regl, 1, 8), 0, [0, 255, 255, 255], 1, 'instance left')
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 255, 255], 1, 'instance center')
    assertPixel(pixelAt(ctx.regl, 15, 8), 0, [0, 255, 255, 255], 1, 'instance right')
    assert(ctx.gl.getError() === 0, 'gl error after instanced draw')
    finish(ctx)
  })

  test('scope VAO inheritance (numeric attribute locations)', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var vao = ctx.regl.vao([[[-1, -1], [3, -1], [-1, 3]]])
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: { position: 0 },
      uniforms: { color: [1, 0, 1, 1] },
      count: 3
    })
    var setup = ctx.regl({ vao: vao })
    setup(function () {
      draw()
    })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 255, 255], 1, 'scope vao')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // 状态：depth / blend / clear
  // -------------------------------------------------------------------------
  test('depth test', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    ctx.regl.clear({ color: [0, 0, 0, 1], depth: 1 })
    var vert = [
      'precision mediump float;',
      'attribute vec2 position;',
      'uniform float z;',
      'void main () { gl_Position = vec4(position, z, 1.0); }'
    ].join('\n')
    var drawRed = ctx.regl({
      vert: vert,
      frag: SOLID_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { color: [1, 0, 0, 1], z: 0 },
      count: 3,
      depth: { enable: true, func: 'less', mask: true }
    })
    var drawGreen = ctx.regl({
      vert: vert,
      frag: SOLID_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { color: [0, 1, 0, 1], z: 0 },
      count: 3,
      depth: { enable: true, func: 'less', mask: true }
    })
    drawRed()
    drawGreen()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'depth keeps red')
    finish(ctx)
  })

  test('blending', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    ctx.regl.clear({ color: [0, 0, 0, 1] })
    var draw = ctx.regl(
      fullscreenTriangle({
        uniforms: { color: [1, 0, 0, 0.5] },
        blend: {
          enable: true,
          func: { src: 'src alpha', dst: 'one minus src alpha' }
        }
      })
    )
    draw()
    var pixel = pixelAt(ctx.regl, 8, 8)
    assertNear(pixel[0], 128, 3, 'blend red')
    // alpha 通道使用同样的 src alpha 混合，清屏 alpha=1 时结果为 0.75
    assertNear(pixel[3], 191, 2, 'blend alpha')
    finish(ctx)
  })

  test('clear + scissor', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    ctx.regl.clear({ color: [0, 0, 1, 1] })
    var draw = ctx.regl(
      fullscreenTriangle({
        uniforms: { color: [1, 0, 0, 1] },
        scissor: {
          enable: true,
          box: { x: 0, y: 0, width: 4, height: 4 }
        }
      })
    )
    draw()
    assertPixel(pixelAt(ctx.regl, 1, 1), 0, [255, 0, 0, 255], 1, 'scissor inside')
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 0, 255, 255], 1, 'scissor outside')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // 资源更新
  // -------------------------------------------------------------------------
  test('buffer subdata', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var buffer = ctx.regl.buffer(new Float32Array([1, 1, 1]))
    var draw = ctx.regl({
      vert: [
        'precision mediump float;',
        'attribute vec2 position;',
        'attribute float value;',
        'varying float v;',
        'void main () { v = value; gl_Position = vec4(position, 0.0, 1.0); }'
      ].join('\n'),
      frag: [
        'precision mediump float;',
        'varying float v;',
        'void main () { gl_FragColor = vec4(v, 0.0, 0.0, 1.0); }'
      ].join('\n'),
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]],
        value: buffer
      },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'before subdata')
    buffer.subdata(new Float32Array([0.5, 0.5, 0.5]))
    draw()
    assertNear(pixelAt(ctx.regl, 8, 8)[0], 128, 2, 'after subdata')
    finish(ctx)
  })

  test('dynamic elements data', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: {
        position: [[-1, -1], [1, -1], [1, 1], [-1, 1]]
      },
      elements: ctx.regl.prop('indices'),
      count: 6,
      uniforms: { color: [0, 1, 0, 1] }
    })
    draw({ indices: [0, 1, 2, 0, 2, 3] })
    assertPixel(pixelAt(ctx.regl, 2, 2), 0, [0, 255, 0, 255], 1, 'dynamic indices')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // 上下文丢失 / 性能统计
  // -------------------------------------------------------------------------
  test('context loss and restore', async function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var ext = ctx.gl.getExtension('WEBGL_lose_context')
    if (!ext) return 'skipped (WEBGL_lose_context unavailable)'
    var draw = ctx.regl(fullscreenTriangle())
    draw()

    var lost = new Promise(function (resolve) {
      ctx.regl.on('lost', resolve)
    })
    var restored = new Promise(function (resolve) {
      ctx.regl.on('restore', resolve)
    })
    ext.loseContext()
    await lost
    // 给浏览器一个事件循环，确保 webglcontextlost 的 preventDefault 已生效
    await new Promise(function (resolve) {
      setTimeout(resolve, 100)
    })
    ext.restoreContext()
    await restored
    draw()
    var pixel = pixelAt(ctx.regl, 8, 8)
    assertPixel(pixel, 0, [255, 0, 0, 255], 1, 'after restore')
    finish(ctx)
  })

  test('profile stats', function () {
    var ctx = makeRegl('webgl', { profile: true })
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl(
      fullscreenTriangle({
        profile: true
      })
    )
    draw()
    draw()
    assert(draw.stats.count === 2, 'stats.count = ' + draw.stats.count)
    assert(draw.stats.cpuTime > 0, 'cpuTime > 0')
    assert(typeof ctx.regl.stats.getTotalBufferSize === 'function', 'profile helpers')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // 更多纹理能力
  // -------------------------------------------------------------------------
  test('cube texture sampling + subimage', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var faces = []
    var colors = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 0, 255],
      [255, 0, 255, 255],
      [0, 255, 255, 255]
    ]
    for (var i = 0; i < 6; ++i) {
      faces.push({ data: [[colors[i]]] })
    }
    var cube = ctx.regl.cube({ faces: faces })
    assert(cube.width === 1, 'cube size')
    // +Y 方向对应第 3 个面（索引 2）
    cube.subimage(2, { width: 1, height: 1, data: [255, 255, 255, 255] })

    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform samplerCube tex;',
        'uniform vec3 dir;',
        'void main () { gl_FragColor = textureCube(tex, dir); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: cube, dir: ctx.regl.prop('dir') },
      count: 3
    })
    draw({ dir: [1, 0, 0] })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'cube +X')

    draw({ dir: [0, 1, 0] })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 255, 255, 255], 1, 'cube +Y subimage')
    finish(ctx)
  })

  test('texture params + copy', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    ctx.regl.clear({ color: [0, 1, 0, 1] })
    var copy = ctx.regl.texture({
      copy: true,
      width: 8,
      height: 8,
      wrap: 'repeat',
      min: 'nearest',
      mag: 'linear'
    })
    assert(copy.wrapS === 'repeat', 'wrapS=' + copy.wrapS)
    assert(copy.wrapT === 'repeat', 'wrapT=' + copy.wrapT)
    assert(copy.min === 'nearest', 'min=' + copy.min)
    assert(copy.mag === 'linear', 'mag=' + copy.mag)
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'void main () { gl_FragColor = texture2D(tex, vec2(0.5)); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: copy },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 2, 'copy texture')
    finish(ctx)
  })

  test('texture format r8 (webgl2)', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var texture = ctx.regl.texture({
      width: 2,
      height: 2,
      format: 'r8',
      data: new Uint8Array([255, 128, 64, 0])
    })
    assert(texture.format === 'r8', 'format=' + texture.format)
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'void main () { gl_FragColor = vec4(vec3(texture2D(tex, vec2(0.25)).r), 1.0); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: texture },
      count: 3,
      viewport: { x: 0, y: 0, width: 4, height: 4 }
    })
    draw()
    assertNear(pixelAt(ctx.regl, 1, 1)[0], 255, 2, 'r8 red channel')
    finish(ctx)
  })

  test('texture from canvas element', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2
    var context2d = canvas.getContext('2d')
    context2d.fillStyle = 'rgb(0, 255, 0)'
    context2d.fillRect(0, 0, 2, 2)
    var texture = ctx.regl.texture(canvas)
    assert(texture.width === 2 && texture.height === 2, 'canvas texture size')
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'void main () { gl_FragColor = texture2D(tex, vec2(0.5)); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: texture },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 2, 'canvas texture')
    finish(ctx)
  })

  test('compressed texture (optional)', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    if (!ctx.regl.hasExtension('webgl_compressed_texture_s3tc')) {
      finish(ctx)
      return 'skipped (S3TC unavailable)'
    }
    var data = new Uint8Array(8)
    // 一个 4x4 的 DXT1 block：color0 = 红色，color1 = 0
    data[0] = 0x00
    data[1] = 0xf8
    data[2] = 0
    data[3] = 0
    var texture = ctx.regl.texture({
      width: 4,
      height: 4,
      format: 'rgb s3tc dxt1',
      data: data
    })
    assert(texture.format === 'rgb s3tc dxt1', 'compressed format')
    assert(ctx.gl.getError() === 0, 'compressed upload error')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // 动态变量
  // -------------------------------------------------------------------------
  test('dynamic function / context / this / nested prop', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform vec4 color;',
        'void main () { gl_FragColor = color; }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: {
        color: function (context, props, batchId) {
          return [props.nested.value, context.tick % 2, batchId, 1]
        }
      },
      count: 3
    })
    ctx.regl.poll()
    var thisObj = { value: 1 }
    // 通过 this 动态变量读取调用方对象
    var drawThis = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform vec4 color;',
        'void main () { gl_FragColor = color; }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { color: ctx.regl.this('value') },
      count: 3
    })
    drawThis.call({ value: [0, 1, 0, 1] })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'this variable')

    draw({ nested: { value: 0.5 } })
    var pixel = pixelAt(ctx.regl, 8, 8)
    assertNear(pixel[0], 128, 2, 'function dynamic red')
    finish(ctx)
  })

  test('uniform array (base name)', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform float weights[2];',
        'void main () { gl_FragColor = vec4(weights[0], weights[1], 0.0, 1.0); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { weights: [0.25, 0.75] },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [64, 191, 0, 255], 2, 'uniform array')
    finish(ctx)
  })

  test('constant attribute', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl({
      vert: [
        'precision mediump float;',
        'attribute vec2 position;',
        'attribute vec4 color;',
        'varying vec4 vColor;',
        'void main () { vColor = color; gl_Position = vec4(position, 0.0, 1.0); }'
      ].join('\n'),
      frag: [
        'precision mediump float;',
        'varying vec4 vColor;',
        'void main () { gl_FragColor = vColor; }'
      ].join('\n'),
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]],
        color: { constant: [0, 1, 0, 1] }
      },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'constant attribute')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // scope 属性 / 批量状态
  // -------------------------------------------------------------------------
  test('scope attributes + elements', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      uniforms: { color: [1, 1, 1, 1] }
    })
    var setup = ctx.regl({
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]]
      },
      elements: [0, 1, 2],
      count: 3
    })
    setup(function () {
      draw()
    })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 255, 255, 255], 1, 'scope attrs')
    finish(ctx)
  })

  test('batch prop-dependent state + count', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: {
        position: [
          [-1, -1], [1, -1], [1, 1],
          [-1, -1], [1, 1], [-1, 1]
        ]
      },
      uniforms: { color: ctx.regl.prop('color') },
      count: ctx.regl.prop('count'),
      viewport: ctx.regl.prop('viewport'),
      depth: { enable: ctx.regl.prop('depth') }
    })
    draw([
      {
        color: [1, 0, 0, 1],
        count: 3,
        depth: false,
        viewport: { x: 0, y: 0, width: 8, height: 16 }
      },
      {
        color: [0, 0, 1, 1],
        count: 6,
        depth: false,
        viewport: { x: 8, y: 0, width: 8, height: 16 }
      }
    ])
    assertPixel(pixelAt(ctx.regl, 2, 2), 0, [255, 0, 0, 255], 1, 'batch first triangle')
    assertPixel(pixelAt(ctx.regl, 13, 13), 0, [0, 0, 255, 255], 1, 'batch quad')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // 32 位索引 / WebGL1 实例化
  // -------------------------------------------------------------------------
  test('uint32 elements (webgl2)', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: {
        position: [[-1, -1], [3, -1], [-1, 3]]
      },
      elements: {
        data: new Uint32Array([0, 1, 2]),
        type: 'uint32',
        count: 3
      },
      uniforms: { color: [1, 0, 1, 1] },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 255, 255], 1, 'uint32 elements')
    finish(ctx)
  })

  test('instancing (webgl1 / ANGLE)', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    if (!ctx.regl.hasExtension('angle_instanced_arrays')) {
      finish(ctx)
      return 'skipped (ANGLE_instanced_arrays unavailable)'
    }
    var vao = ctx.regl.vao({
      attributes: [
        { data: [[-0.3, -0.5], [0.3, -0.5], [0.3, 0.5], [-0.3, 0.5]] },
        { data: [[-0.6, 0], [0, 0], [0.6, 0]], divisor: 1 }
      ],
      elements: { data: [0, 1, 2, 0, 2, 3], count: 6 }
    })
    var draw = ctx.regl({
      vert: [
        'precision mediump float;',
        'attribute vec2 position;',
        'attribute vec2 offset;',
        'void main () { gl_Position = vec4(position + offset, 0.0, 1.0); }'
      ].join('\n'),
      frag: SOLID_FRAG,
      attributes: { position: 0, offset: 1 },
      uniforms: { color: [1, 0.5, 0, 1] },
      vao: vao,
      instances: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 4, 8), 0, [255, 128, 0, 255], 1, 'webgl1 instancing')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // 帧循环
  // -------------------------------------------------------------------------
  test('frame callback', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    return new Promise(function (resolve, reject) {
      var count = 0
      var timer = setTimeout(function () {
        reject(new Error('frame callback not fired'))
      }, 3000)
      var handle = ctx.regl.frame(function (frameContext) {
        count++
        try {
          assert(frameContext.tick > 0, 'tick > 0')
          assert(frameContext.time >= 0, 'time >= 0')
          assert(frameContext.viewportWidth > 0, 'viewport width')
        } catch (err) {
          clearTimeout(timer)
          handle.cancel()
          reject(err)
          return
        }
        if (count >= 2) {
          clearTimeout(timer)
          handle.cancel()
          finish(ctx)
          resolve()
        }
      })
    })
  })

  test('context restore with resources', async function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var ext = ctx.gl.getExtension('WEBGL_lose_context')
    if (!ext) {
      finish(ctx)
      return 'skipped (WEBGL_lose_context unavailable)'
    }
    var texture = ctx.regl.texture([
      [[255, 0, 0, 255]]
    ])
    var fbo = ctx.regl.framebuffer({ radius: 2, depth: false, stencil: false })
    var drawFBO = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { color: [0, 0, 1, 1] },
      count: 3,
      framebuffer: fbo,
      viewport: { x: 0, y: 0, width: 2, height: 2 }
    })
    var drawScreen = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'void main () { gl_FragColor = texture2D(tex, vec2(0.5)); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: texture },
      count: 3,
      viewport: { x: 0, y: 0, width: 16, height: 16 }
    })
    drawFBO()
    drawScreen()

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
    drawFBO()
    var fboPixels = ctx.regl.read({ framebuffer: fbo })
    assertPixel(fboPixels, 0, [0, 0, 255, 255], 1, 'restored fbo')
    drawScreen()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'restored texture')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // Framebuffer 使用方式 / 深度纹理 / 浮点读取
  // -------------------------------------------------------------------------
  test('framebuffer.use + clear framebuffer', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var fbo = ctx.regl.framebuffer({ radius: 4, depth: false, stencil: false })
    fbo.use(function () {
      ctx.regl.clear({ color: [0, 1, 0, 1] })
    })
    var pixels = ctx.regl.read({ framebuffer: fbo })
    assertPixel(pixels, 0, [0, 255, 0, 255], 1, 'fbo clear inside use')

    ctx.regl.clear({ framebuffer: fbo, color: [1, 0, 1, 1] })
    pixels = ctx.regl.read({ framebuffer: fbo })
    assertPixel(pixels, 0, [255, 0, 255, 255], 1, 'clear with framebuffer option')
    finish(ctx)
  })

  test('depth texture attachment', function () {
    var ctx = makeRegl('webgl', {
      extensions: ['WEBGL_depth_texture']
    })
    assert(ctx, 'webgl not supported')
    var fbo = ctx.regl.framebuffer({
      radius: 4,
      depthTexture: true,
      depth: true,
      stencil: false
    })
    assert(fbo.depth, 'depth texture attachment')
    var draw = ctx.regl(
      fullscreenTriangle({
        framebuffer: fbo,
        viewport: { x: 0, y: 0, width: 4, height: 4 },
        uniforms: { color: [1, 0.5, 0, 1] }
      })
    )
    draw()
    var pixels = ctx.regl.read({ framebuffer: fbo })
    assertPixel(pixels, 0, [255, 128, 0, 255], 1, 'depth texture fbo')
    finish(ctx)
  })

  test('read float framebuffer (webgl2)', function () {
    var ctx = makeRegl('webgl2', {
      extensions: ['EXT_color_buffer_float']
    })
    assert(ctx, 'webgl2 not supported')
    if (!ctx.regl.limits.readFloat) {
      finish(ctx)
      return 'skipped (float read not supported)'
    }
    var fbo = ctx.regl.framebuffer({
      width: 2,
      height: 2,
      colorType: 'float',
      depth: false,
      stencil: false
    })
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision highp float;',
        'void main () { gl_FragColor = vec4(0.25, 0.5, 0.75, 1.0); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      count: 3,
      framebuffer: fbo,
      viewport: { x: 0, y: 0, width: 2, height: 2 }
    })
    draw()
    var data = new Float32Array(2 * 2 * 4)
    ctx.regl.read({ framebuffer: fbo, data: data })
    assertNear(data[0], 0.25, 0.01, 'float read r')
    assertNear(data[1], 0.5, 0.01, 'float read g')
    finish(ctx)
  })

  test('half float framebuffer (webgl2)', function () {
    var ctx = makeRegl('webgl2', {
      optionalExtensions: ['EXT_color_buffer_float']
    })
    assert(ctx, 'webgl2 not supported')
    if (!ctx.regl.hasExtension('ext_color_buffer_float')) {
      finish(ctx)
      return 'skipped (EXT_color_buffer_float unavailable)'
    }
    var fbo = ctx.regl.framebuffer({
      width: 4,
      height: 4,
      colorType: 'float16',
      depth: false,
      stencil: false
    })
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'void main () { gl_FragColor = vec4(0.5, 0.25, 1.0, 1.0); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      count: 3,
      framebuffer: fbo,
      viewport: { x: 0, y: 0, width: 4, height: 4 }
    })
    draw()
    var drawScreen = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'void main () { gl_FragColor = texture2D(tex, vec2(0.5)); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: fbo.color[0] },
      count: 3,
      viewport: { x: 0, y: 0, width: 16, height: 16 }
    })
    drawScreen()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [128, 64, 255, 255], 3, 'half float fbo')
    finish(ctx)
  })

  test('integer texture (webgl2)', function () {
    var ctx = makeRegl('webgl2')
    assert(ctx, 'webgl2 not supported')
    var texture = ctx.regl.texture({
      width: 1,
      height: 1,
      format: 'rgba8ui',
      type: 'uint8',
      data: new Uint8Array([255, 128, 64, 255])
    })
    var draw = ctx.regl({
      vert: [
        '#version 300 es',
        'in vec2 position;',
        'void main () { gl_Position = vec4(position, 0.0, 1.0); }'
      ].join('\n'),
      frag: [
        '#version 300 es',
        'precision highp float;',
        'precision highp usampler2D;',
        'uniform usampler2D tex;',
        'out vec4 color;',
        'void main () {',
        '  uvec4 v = texelFetch(tex, ivec2(0), 0);',
        '  color = vec4(float(v.r) / 255.0, 0.0, 0.0, 1.0);',
        '}'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: texture },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 2, 'integer texture')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // 纹理 mipmap / 立方体 resize
  // -------------------------------------------------------------------------
  test('texture mipmap generation', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var data = new Uint8Array(4 * 4 * 4)
    for (var i = 0; i < data.length; i += 4) {
      data[i] = 0
      data[i + 1] = 255
      data[i + 2] = 0
      data[i + 3] = 255
    }
    var texture = ctx.regl.texture({
      width: 4,
      height: 4,
      data: data,
      min: 'linear mipmap linear',
      mag: 'linear'
    })
    assert(texture.min === 'linear mipmap linear', 'min=' + texture.min)
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: [
        'precision mediump float;',
        'uniform sampler2D tex;',
        'void main () { gl_FragColor = texture2D(tex, vec2(0.5)); }'
      ].join('\n'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { tex: texture },
      count: 3
    })
    draw()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 2, 'mipmap texture')
    finish(ctx)
  })

  test('framebufferCube resize', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var cube = ctx.regl.framebufferCube(4)
    cube.resize(8)
    assert(cube.width === 8 && cube.height === 8, 'cube fbo resized')
    assert(cube.faces.length === 6, 'six faces')
    assert(cube.color[0].width === 8, 'cube texture resized')
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // 初始化 / 生命周期 / 统计
  // -------------------------------------------------------------------------
  test('auto context creation (version option)', function () {
    var canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    document.body.appendChild(canvas)
    // 用一个临时上下文探测 WebGL2 支持，避免影响目标画布的属性
    var probeCanvas = document.createElement('canvas')
    var probe = probeCanvas.getContext('webgl2')
    var version = probe ? 2 : 1
    if (probe) {
      var lose = probe.getExtension('WEBGL_lose_context')
      if (lose) lose.loseContext()
    }
    var regl = createREGL({
      canvas: canvas,
      version: version,
      attributes: { preserveDrawingBuffer: true }
    })
    assert(regl, 'auto regl')
    assert(!!regl.limits.isWebGL2 === (version === 2), 'detected version')
    var draw = regl(fullscreenTriangle())
    draw()
    var pixels = regl.read()
    assertPixel(pixels, 0, [255, 0, 0, 255], 0, 'auto context draw')
    regl.destroy()
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
  })

  test('onDone error for missing extension', function () {
    var error = null
    var regl = createREGL({
      gl: getContext('webgl').gl,
      extensions: ['not_a_real_extension'],
      onDone: function (err) {
        error = err
      }
    })
    assert(regl === null, 'regl is null on error')
    assert(!!error && /not_a_real_extension/.test(error), 'onDone error message')
  })

  test('stats counters + destroy idempotent', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var buffer = ctx.regl.buffer([1, 2, 3])
    var elements = ctx.regl.elements([0, 1, 2])
    var texture = ctx.regl.texture(2)
    var fbo = ctx.regl.framebuffer({ radius: 2, depth: false, stencil: false })
    var vao = ctx.regl.vao({
      attributes: [{ data: [[0, 0], [1, 0], [0, 1]] }]
    })
    assert(ctx.regl.stats.bufferCount >= 3, 'buffer count')
    assert(ctx.regl.stats.elementsCount === 1, 'elements count')
    assert(ctx.regl.stats.textureCount >= 2, 'texture count')
    assert(ctx.regl.stats.framebufferCount === 1, 'framebuffer count')
    assert(ctx.regl.stats.vaoCount === 1, 'vao count')
    vao.destroy()
    elements.destroy()
    texture.destroy()
    fbo.destroy()
    buffer.destroy()
    assert(ctx.regl.stats.vaoCount === 0, 'vao count after destroy')
    ctx.regl.destroy()
    ctx.regl.destroy()
    resetGL(ctx.gl)
  })

  test('profile false override', function () {
    var ctx = makeRegl('webgl', { profile: true })
    assert(ctx, 'webgl not supported')
    var draw = ctx.regl(
      fullscreenTriangle({
        profile: false
      })
    )
    draw()
    assert(draw.stats.count === 0, 'profile false count = ' + draw.stats.count)
    finish(ctx)
  })

  test('profile stats: batch and scope', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var base = {
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { color: [1, 0, 0, 1] },
      count: 3
    }
    var staticOn = ctx.regl(Object.assign({ profile: true }, base))
    staticOn([{}, {}])
    assert(staticOn.stats.count === 2, 'batch profile count = ' + staticOn.stats.count)
    staticOn(3, function () {})
    assert(staticOn.stats.count === 5, 'scope profile count = ' + staticOn.stats.count)

    var dynamic = ctx.regl(
      Object.assign(
        {
          profile: ctx.regl.prop('on')
        },
        base
      )
    )
    dynamic([{ on: true }, { on: false }, { on: true }])
    assert(dynamic.stats.count === 2, 'prop profile count = ' + dynamic.stats.count)
    finish(ctx)
  })

  // -------------------------------------------------------------------------
  // 动态 shader / 动态 framebuffer / 动态属性
  // -------------------------------------------------------------------------
  test('dynamic shaders + scope shader inheritance', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var dynamic = ctx.regl({
      vert: ctx.regl.prop('vert'),
      frag: ctx.regl.prop('frag'),
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { color: [1, 0, 0, 1] },
      count: 3
    })
    dynamic({ vert: FULLSCREEN_VERT, frag: SOLID_FRAG })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'dynamic shader red')

    var greenFrag = [
      'precision mediump float;',
      'void main () { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }'
    ].join('\n')
    dynamic({ vert: FULLSCREEN_VERT, frag: greenFrag })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'dynamic shader green')

    // 不写 shader 的子命令继承 scope 中的 shader
    var child = ctx.regl({
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { color: [0, 0, 1, 1] },
      count: 3
    })
    var scope = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG
    })
    scope(function () {
      child()
    })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 0, 255, 255], 1, 'scope shader')
    finish(ctx)
  })

  test('dynamic framebuffer', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var fbo = ctx.regl.framebuffer({
      width: 4,
      height: 4,
      depth: false,
      stencil: false
    })
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { color: [1, 0, 0, 1] },
      count: 3,
      framebuffer: ctx.regl.prop('fbo'),
      viewport: { x: 0, y: 0, width: 4, height: 4 }
    })
    draw({ fbo: fbo })
    var fboPixel = ctx.regl.read({
      framebuffer: fbo,
      width: 1,
      height: 1,
      data: new Uint8Array(4)
    })
    assertPixel(fboPixel, 0, [255, 0, 0, 255], 1, 'dynamic fbo')
    draw({ fbo: null })
    assertPixel(pixelAt(ctx.regl, 2, 2), 0, [255, 0, 0, 255], 1, 'dynamic default fbo')
    finish(ctx)
  })

  test('dynamic attribute buffer', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var buffer = ctx.regl.buffer([[-1, -1], [3, -1], [-1, 3]])
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: { position: ctx.regl.prop('buffer') },
      uniforms: { color: [0, 1, 1, 1] },
      count: 3
    })
    draw({ buffer: buffer })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 255, 255], 1, 'dynamic attribute')
    finish(ctx)
  })

  test('dynamic nested attribute config + nested state object', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var buffer = ctx.regl.buffer([[-1, -1], [3, -1], [-1, 3]])
    var draw = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: {
        position: {
          buffer: ctx.regl.prop('buffer'),
          size: 2,
          offset: 0,
          stride: 0
        }
      },
      uniforms: { color: [1, 1, 1, 1] },
      blend: ctx.regl.prop('blend'),
      count: 3
    })
    draw({
      buffer: buffer,
      blend: {
        enable: false,
        color: [0, 0, 0, 0]
      }
    })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 255, 255, 255], 1, 'nested dynamic')
    finish(ctx)
  })

  test('clear cube framebuffer', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var cube = ctx.regl.framebufferCube(4)
    ctx.regl.clear({ framebuffer: cube, color: [1, 0, 1, 1] })
    var pixels = ctx.regl.read({
      framebuffer: cube.faces[0],
      width: 1,
      height: 1,
      data: new Uint8Array(4)
    })
    assertPixel(pixels, 0, [255, 0, 255, 255], 1, 'clear cube fbo')
    finish(ctx)
  })

  test('regl.draw scope-only + inherited draw', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var count = 0
    ctx.regl.draw(5, function (context, props, batchId) {
      assert(props === null, 'props is null')
      assert(batchId === count, 'batchId order')
      count++
      void context
    })
    assert(count === 5, 'scope-only calls')

    var setup = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      uniforms: { color: [1, 1, 0, 1] },
      count: 3
    })
    setup(function () {
      // regl.draw() 自身没有 shader / attributes / count，应继承 scope 的设置
      ctx.regl.draw()
    })
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 255, 0, 255], 1, 'inherited draw')
    finish(ctx)
  })

  test('regl.batch + regl.scope', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')

    var ids = []
    function recordBatch (context, props, batchId) {
      ids.push(batchId)
      void context
      void props
    }
    ctx.regl.batch(function () {
      ctx.regl.draw(recordBatch)
      ctx.regl.draw(recordBatch)
    })
    assert(ids.length === 2 && ids[0] === ids[1] && ids[0] > 0, 'batch id shared')

    var child = ctx.regl({
      vert: FULLSCREEN_VERT,
      frag: SOLID_FRAG,
      attributes: { position: [[-1, -1], [3, -1], [-1, 3]] },
      count: 3
    })
    ctx.regl.scope(
      { uniforms: { color: [0, 1, 0, 1] } },
      function () {
        child()
      }
    )
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [0, 255, 0, 255], 1, 'scope uniform')
    finish(ctx)
  })

  test('destroy bound buffer + shared program', function () {
    var ctx = makeRegl('webgl')
    assert(ctx, 'webgl not supported')
    var a1 = ctx.regl.buffer([[-1, -1], [1, -1], [0, 1]])
    var a2 = ctx.regl.buffer([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    var vert = [
      'precision mediump float;',
      'attribute vec2 a1;',
      'attribute vec3 a2;',
      'varying vec4 color;',
      'void main () { gl_Position = vec4(a1, 0, 1); color = vec4(a2, 1); }'
    ].join('\n')
    var frag = [
      'precision mediump float;',
      'varying vec4 color;',
      'void main () { gl_FragColor = color; }'
    ].join('\n')
    var command = ctx.regl({
      vert: vert,
      frag: frag,
      attributes: { a1: a1, a2: a2 },
      primitive: 'points',
      count: 3
    })
    command()
    a2.destroy()
    var vert2 = [
      'precision mediump float;',
      'attribute vec2 a1;',
      'void main () { gl_Position = vec4(a1, 0, 1); }'
    ].join('\n')
    var frag2 = [
      'precision mediump float;',
      'void main () { gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); }'
    ].join('\n')
    var command2 = ctx.regl({
      vert: vert2,
      frag: frag2,
      attributes: { a1: a1 },
      primitive: 'points',
      count: 3
    })
    command2()
    var destroyErr = ctx.gl.getError()
    assert(destroyErr === 0, 'no error after destroying bound buffer (got ' + destroyErr + ')')
    a1.destroy()

    // 共享同一个 program 的两个命令：销毁一个不应影响另一个
    var b1 = ctx.regl.buffer([[-1, -1], [1, -1], [0, 1]])
    var sharedVert = FULLSCREEN_VERT
    var sharedFrag = SOLID_FRAG
    var c1 = ctx.regl({
      vert: sharedVert,
      frag: sharedFrag,
      attributes: { position: b1 },
      uniforms: { color: [1, 0, 0, 1] },
      count: 3
    })
    var c2 = ctx.regl({
      vert: sharedVert,
      frag: sharedFrag,
      attributes: { position: b1 },
      uniforms: { color: [1, 0, 0, 1] },
      count: 3
    })
    c1.destroy()
    c2()
    assertPixel(pixelAt(ctx.regl, 8, 8), 0, [255, 0, 0, 255], 1, 'shared program')
    b1.destroy()
    c2.destroy()
    finish(ctx)
  })

  // 暴露测试工具，供 ubo-tests.js 追加测试
  window.reglTestKit = {
    test: test,
    assert: assert,
    assertNear: assertNear,
    assertPixel: assertPixel,
    makeRegl: makeRegl,
    pixelAt: pixelAt,
    finish: finish,
    FULLSCREEN_VERT: FULLSCREEN_VERT,
    SOLID_FRAG: SOLID_FRAG
  }

  // -------------------------------------------------------------------------
  // 运行器
  // -------------------------------------------------------------------------
  window.runReglTests = async function () {
    var results = []
    for (var i = 0; i < tests.length; ++i) {
      var entry = tests[i]
      var result = {
        name: entry.name,
        ok: false,
        skipped: false,
        error: null,
        note: null,
        ms: 0
      }
      var start = performance.now()
      try {
        var note = await Promise.race([
          Promise.resolve(entry.fn()),
          new Promise(function (_, reject) {
            setTimeout(function () {
              reject(new Error('test timeout (10s)'))
            }, 10000)
          })
        ])
        result.ok = true
        if (typeof note === 'string') result.note = note
      } catch (err) {
        result.error = (err && (err.stack || err.message)) || String(err)
      }
      result.ms = performance.now() - start
      results.push(result)
    }
    return results
  }
})()
