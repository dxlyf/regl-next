/* global window */
/**
 * WebGPU-first PoC 娴嬭瘯銆? *
 * 浣跨敤 createGPU / texture / pipeline / bindGroup / render / readTexture
 * 瑕嗙洊鏈€灏忛棴鐜細娓呭睆銆佺汗鐞嗛噰鏍枫€乽niform buffer 鏇存柊銆? */
(function () {
  'use strict'

  var tests = []

  function test (name, fn) {
    tests.push({ name: name, fn: fn })
  }

  function assert (value, message) {
    if (!value) throw new Error(message || 'assertion failed')
  }

  function assertPixel (pixels, width, expected, tolerance, label) {
    var index = (Math.floor(pixels.length / 4 / width / 2) * width +
      Math.floor(width / 2)) * 4
    for (var i = 0; i < 4; ++i) {
      var delta = Math.abs(pixels[index + i] - expected[i])
      if (delta > tolerance) {
        throw new Error(
          (label || 'pixel') + ' channel ' + i + ': got ' +
          pixels[index + i] + ', expected ' + expected[i]
        )
      }
    }
  }

  function fullscreenVertexData () {
    return new Float32Array([
      -1, -1, 0, 0,
      3, -1, 2, 0,
      -1, 3, 0, 2
    ])
  }

  function solidTexture (gpu, color) {
    var data = new Uint8Array(16)
    for (var i = 0; i < 4; ++i) {
      data[i * 4] = color[0]
      data[i * 4 + 1] = color[1]
      data[i * 4 + 2] = color[2]
      data[i * 4 + 3] = color[3]
    }
    return gpu.texture({ width: 2, height: 2, data: data })
  }

  var WGSL = [
    'struct Uniforms { color: vec4<f32> };',
    '@group(0) @binding(0) var<uniform> u: Uniforms;',
    '@group(0) @binding(1) var tex: texture_2d<f32>;',
    '@group(0) @binding(2) var samp: sampler;',
    'struct VSOut {',
    '  @builtin(position) pos: vec4<f32>,',
    '  @location(0) uv: vec2<f32>',
    '};',
    '@vertex fn vs_main(',
    '  @location(0) position: vec2<f32>,',
    '  @location(1) uv: vec2<f32>',
    ') -> VSOut {',
    '  var out: VSOut;',
    '  out.pos = vec4<f32>(position, 0.0, 1.0);',
    '  out.uv = uv;',
    '  return out;',
    '}',
    '@fragment fn fs_main(input: VSOut) -> @location(0) vec4<f32> {',
    '  return textureSample(tex, samp, input.uv) * u.color;',
    '}'
  ].join('\n')

  function makePipeline (gpu, format) {
    return gpu.pipeline({
      code: WGSL,
      format: format,
      attributes: [
        { format: 'float32x2', stride: 16, offset: 0 },
        { format: 'float32x2', stride: 16, offset: 8 }
      ],
      bindings: [
        { binding: 0, kind: 'uniform' },
        { binding: 1, kind: 'texture' },
        { binding: 2, kind: 'sampler' }
      ]
    })
  }

  test('WebGPU: main entry exports createWEBGPU', async function () {
    assert(
      typeof window.createWEBGPU === 'function',
      'main bundle does not export createWEBGPU'
    )
    assert(
      typeof window.createREGL === 'function',
      'main bundle does not export createREGL'
    )
  })

  test('WebGPU: clear and read texture', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 4,
        height: 4,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      gpu.render({ color: target, clearColor: [1, 0, 0, 1] }, function () {})
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 4, [255, 0, 0, 255], 1, 'clear/read')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: textured fullscreen triangle', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var texture = solidTexture(gpu, [255, 0, 0, 255])
      var sampler = gpu.sampler({
        magFilter: 'nearest',
        minFilter: 'nearest'
      })
      var uniform = gpu.buffer({
        data: new Float32Array([1, 1, 1, 1]),
        usage: ['uniform']
      })
      var vertices = gpu.buffer({
        data: fullscreenVertexData(),
        usage: ['vertex']
      })
      var pipeline = makePipeline(gpu, 'rgba8unorm')
      var bindGroup = gpu.bindGroup(pipeline, [
        { binding: 0, resource: uniform },
        { binding: 1, resource: texture },
        { binding: 2, resource: sampler }
      ])
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        pass.draw({
          pipeline: pipeline,
          bindGroup: bindGroup,
          vertexBuffers: [vertices],
          count: 3
        })
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [255, 0, 0, 255], 1, 'textured triangle')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: uniform buffer write', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var texture = solidTexture(gpu, [255, 255, 255, 255])
      var sampler = gpu.sampler({
        magFilter: 'nearest',
        minFilter: 'nearest'
      })
      var uniform = gpu.buffer({
        data: new Float32Array([0, 1, 0, 1]),
        usage: ['uniform']
      })
      var vertices = gpu.buffer({
        data: fullscreenVertexData(),
        usage: ['vertex']
      })
      var pipeline = makePipeline(gpu, 'rgba8unorm')
      var bindGroup = gpu.bindGroup(pipeline, [
        { binding: 0, resource: uniform },
        { binding: 1, resource: texture },
        { binding: 2, resource: sampler }
      ])
      var draw = function () {
        gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
          pass.draw({
            pipeline: pipeline,
            bindGroup: bindGroup,
            vertexBuffers: [vertices],
            count: 3
          })
        })
      }
      draw()
      var green = await gpu.readTexture(target)
      assertPixel(green, 8, [0, 255, 0, 255], 1, 'uniform green')

      uniform.write(new Float32Array([1, 0, 1, 1]))
      draw()
      var magenta = await gpu.readTexture(target)
      assertPixel(magenta, 8, [255, 0, 255, 255], 1, 'uniform magenta')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: depth test', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var depth = gpu.texture({
        width: 8,
        height: 8,
        format: 'depth24plus',
        usage: ['render-attachment']
      })
      var near = gpu.buffer({
        data: new Float32Array([
          -1, -1, 0.2,
           3, -1, 0.2,
          -1,  3, 0.2
        ]),
        usage: ['vertex']
      })
      var far = gpu.buffer({
        data: new Float32Array([
          -1, -1, 0.8,
           3, -1, 0.8,
          -1,  3, 0.8
        ]),
        usage: ['vertex']
      })
      var redUniform = gpu.buffer({
        data: new Float32Array([1, 0, 0, 1]),
        usage: ['uniform']
      })
      var greenUniform = gpu.buffer({
        data: new Float32Array([0, 1, 0, 1]),
        usage: ['uniform']
      })
      var pipeline = gpu.pipeline({
        code: [
          'struct U { color: vec4<f32> };',
          '@group(0) @binding(0) var<uniform> u: U;',
          '@vertex fn vs_main(@location(0) p: vec3<f32>) -> @builtin(position) vec4<f32> {',
          '  return vec4<f32>(p, 1.0);',
          '}',
          '@fragment fn fs_main() -> @location(0) vec4<f32> {',
          '  return u.color;',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: [{ format: 'float32x3', stride: 12, offset: 0 }],
        bindings: [{ binding: 0, kind: 'uniform' }],
        depth: {
          format: 'depth24plus',
          depthWriteEnabled: true,
          depthCompare: 'less'
        }
      })
      var redBindGroup = gpu.bindGroup(pipeline, [
        { binding: 0, resource: redUniform }
      ])
      var greenBindGroup = gpu.bindGroup(pipeline, [
        { binding: 0, resource: greenUniform }
      ])
      gpu.render(
        {
          color: target,
          depth: depth,
          clearColor: [0, 0, 0, 1],
          clearDepth: 1
        },
        function (pass) {
          pass.draw({
            pipeline: pipeline,
            bindGroup: redBindGroup,
            vertexBuffers: [near],
            count: 3
          })
          pass.draw({
            pipeline: pipeline,
            bindGroup: greenBindGroup,
            vertexBuffers: [far],
            count: 3
          })
        }
      )
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [255, 0, 0, 255], 1, 'depth keeps near fragment')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: indexed draw', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var vertices = gpu.buffer({
        data: new Float32Array([
          -1, -1,
           3, -1,
          -1,  3
        ]),
        usage: ['vertex']
      })
      var indices = gpu.buffer({
        data: new Uint16Array([0, 1, 2]),
        usage: ['index']
      })
      var uniform = gpu.buffer({
        data: new Float32Array([0, 1, 0, 1]),
        usage: ['uniform']
      })
      var pipeline = gpu.pipeline({
        code: [
          'struct U { color: vec4<f32> };',
          '@group(0) @binding(0) var<uniform> u: U;',
          '@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> {',
          '  return vec4<f32>(p, 0.0, 1.0);',
          '}',
          '@fragment fn fs_main() -> @location(0) vec4<f32> {',
          '  return u.color;',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: [{ format: 'float32x2', stride: 8, offset: 0 }],
        bindings: [{ binding: 0, kind: 'uniform' }]
      })
      var bindGroup = gpu.bindGroup(pipeline, [
        { binding: 0, resource: uniform }
      ])
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        pass.draw({
          pipeline: pipeline,
          bindGroup: bindGroup,
          vertexBuffers: [vertices],
          indexBuffer: { buffer: indices, format: 'uint16' },
          count: 3
        })
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [0, 255, 0, 255], 1, 'indexed draw')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: MSAA resolve', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var msaa = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        sampleCount: 4,
        usage: ['render-attachment']
      })
      var resolved = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var uniform = gpu.buffer({
        data: new Float32Array([1, 0, 0, 1]),
        usage: ['uniform']
      })
      var vertices = gpu.buffer({
        data: fullscreenVertexData(),
        usage: ['vertex']
      })
      var pipeline = gpu.pipeline({
        code: [
          'struct U { color: vec4<f32> };',
          '@group(0) @binding(0) var<uniform> u: U;',
          '@vertex fn vs_main(',
          '  @location(0) p: vec2<f32>,',
          '  @location(1) uv: vec2<f32>',
          ') -> @builtin(position) vec4<f32> {',
          '  return vec4<f32>(p, 0.0, 1.0);',
          '}',
          '@fragment fn fs_main() -> @location(0) vec4<f32> {',
          '  return u.color;',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: [
          { format: 'float32x2', stride: 16, offset: 0 },
          { format: 'float32x2', stride: 16, offset: 8 }
        ],
        bindings: [{ binding: 0, kind: 'uniform' }],
        multisample: { count: 4 }
      })
      var bindGroup = gpu.bindGroup(pipeline, [
        { binding: 0, resource: uniform }
      ])
      gpu.render(
        {
          color: msaa,
          resolve: resolved,
          clearColor: [0, 0, 0, 1]
        },
        function (pass) {
          pass.draw({
            pipeline: pipeline,
            bindGroup: bindGroup,
            vertexBuffers: [vertices],
            count: 3
          })
        }
      )
      var pixels = await gpu.readTexture(resolved)
      assertPixel(pixels, 8, [255, 0, 0, 255], 1, 'MSAA resolve')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: WGSL command layer', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var uniform = gpu.buffer({
        data: new Float32Array([0, 1, 0, 1]),
        usage: ['uniform']
      })
      var command = gpu({
        code: [
          'struct U { color: vec4<f32> };',
          '@group(0) @binding(0) var<uniform> u: U;',
          '@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> {',
          '  return vec4<f32>(p, 0.0, 1.0);',
          '}',
          '@fragment fn fs_main() -> @location(0) vec4<f32> {',
          '  return u.color;',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: {
          position: {
            data: new Float32Array([-1, -1, 3, -1, -1, 3]),
            size: 2
          }
        },
        bindings: [
          { binding: 0, kind: 'uniform', resource: uniform }
        ],
        count: 3
      })
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        command.draw(pass)
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [0, 255, 0, 255], 1, 'WGSL command')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: command textures/samplers', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var texture = solidTexture(gpu, [255, 0, 0, 255])
      var sampler = gpu.sampler({
        magFilter: 'nearest',
        minFilter: 'nearest'
      })
      var command = gpu({
        code: [
          '@group(0) @binding(0) var tex: texture_2d<f32>;',
          '@group(0) @binding(1) var samp: sampler;',
          'struct VSOut {',
          '  @builtin(position) pos: vec4<f32>,',
          '  @location(0) uv: vec2<f32>',
          '};',
          '@vertex fn vs_main(',
          '  @location(0) p: vec2<f32>,',
          '  @location(1) uv: vec2<f32>',
          ') -> VSOut {',
          '  var out: VSOut;',
          '  out.pos = vec4<f32>(p, 0.0, 1.0);',
          '  out.uv = uv;',
          '  return out;',
          '}',
          '@fragment fn fs_main(input: VSOut) -> @location(0) vec4<f32> {',
          '  return textureSample(tex, samp, input.uv);',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: {
          position: {
            data: new Float32Array([-1, -1, 3, -1, -1, 3]),
            size: 2
          },
          uv: {
            data: new Float32Array([0, 0, 2, 0, 0, 2]),
            size: 2
          }
        },
        bindings: [
          {
            binding: 0,
            kind: 'texture',
            resource: texture,
            viewDimension: '2d'
          },
          { binding: 1, kind: 'sampler', resource: sampler }
        ],
        count: 3
      })
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        command.draw(pass)
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [255, 0, 0, 255], 1, 'command texture')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: command index buffer', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var indices = gpu.buffer({
        data: new Uint16Array([0, 1, 2]),
        usage: ['index']
      })
      var uniform = gpu.buffer({
        data: new Float32Array([0, 0, 1, 1]),
        usage: ['uniform']
      })
      var command = gpu({
        code: [
          'struct U { color: vec4<f32> };',
          '@group(0) @binding(0) var<uniform> u: U;',
          '@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> {',
          '  return vec4<f32>(p, 0.0, 1.0);',
          '}',
          '@fragment fn fs_main() -> @location(0) vec4<f32> {',
          '  return u.color;',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: {
          position: {
            data: new Float32Array([-1, -1, 3, -1, -1, 3]),
            size: 2
          }
        },
        bindings: [
          { binding: 0, kind: 'uniform', resource: uniform }
        ],
        indexBuffer: { buffer: indices, format: 'uint16' },
        count: 3
      })
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        command.draw(pass)
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [0, 0, 255, 255], 1, 'command index buffer')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: command instancing', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var uniform = gpu.buffer({
        data: new Float32Array([0, 1, 0, 1]),
        usage: ['uniform']
      })
      var command = gpu({
        code: [
          'struct U { color: vec4<f32> };',
          '@group(0) @binding(0) var<uniform> u: U;',
          '@vertex fn vs_main(',
          '  @location(0) p: vec2<f32>,',
          '  @location(1) offset: vec2<f32>',
          ') -> @builtin(position) vec4<f32> {',
          '  return vec4<f32>(p + offset, 0.0, 1.0);',
          '}',
          '@fragment fn fs_main() -> @location(0) vec4<f32> {',
          '  return u.color;',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: {
          position: {
            data: new Float32Array([-1, -1, 3, -1, -1, 3]),
            size: 2
          },
          offset: {
            data: new Float32Array([0, 0, 0.4, 0]),
            size: 2,
            divisor: 1
          }
        },
        bindings: [
          { binding: 0, kind: 'uniform', resource: uniform }
        ],
        count: 3,
        instances: 2
      })
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        command.draw(pass)
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [0, 255, 0, 255], 1, 'command instancing')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: 3D texture sampling', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var data = new Uint8Array(4 * 4 * 2 * 4)
      for (var layer = 0; layer < 2; ++layer) {
        for (var i = 0; i < 16; ++i) {
          var offset = (layer * 16 + i) * 4
          data[offset] = layer === 0 ? 255 : 0
          data[offset + 1] = layer === 0 ? 0 : 255
          data[offset + 3] = 255
        }
      }
      var texture = gpu.texture({
        width: 4,
        height: 4,
        depth: 2,
        dimension: '3d',
        data: data
      })
      var sampler = gpu.sampler({ magFilter: 'nearest', minFilter: 'nearest' })
      var vertices = gpu.buffer({
        data: fullscreenVertexData(),
        usage: ['vertex']
      })
      var pipeline = gpu.pipeline({
        code: [
          '@group(0) @binding(0) var tex: texture_3d<f32>;',
          '@group(0) @binding(1) var samp: sampler;',
          'struct VSOut {',
          '  @builtin(position) pos: vec4<f32>,',
          '  @location(0) uv: vec2<f32>',
          '};',
          '@vertex fn vs_main(',
          '  @location(0) p: vec2<f32>,',
          '  @location(1) uv: vec2<f32>',
          ') -> VSOut {',
          '  var out: VSOut;',
          '  out.pos = vec4<f32>(p, 0.0, 1.0);',
          '  out.uv = uv;',
          '  return out;',
          '}',
          '@fragment fn fs_main(input: VSOut) -> @location(0) vec4<f32> {',
          '  return textureSample(tex, samp, vec3<f32>(input.uv, 0.75));',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: [
          { format: 'float32x2', stride: 16, offset: 0 },
          { format: 'float32x2', stride: 16, offset: 8 }
        ],
        bindings: [
          { binding: 0, kind: 'texture', viewDimension: '3d' },
          { binding: 1, kind: 'sampler' }
        ]
      })
      var bindGroup = gpu.bindGroup(pipeline, [
        { binding: 0, resource: texture },
        { binding: 1, resource: sampler }
      ])
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        pass.draw({
          pipeline: pipeline,
          bindGroup: bindGroup,
          vertexBuffers: [vertices],
          count: 3
        })
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [0, 255, 0, 255], 1, '3D texture')

      var slices = await gpu.readTexture(texture, { layer: 1 })
      assertPixel(slices, 4, [0, 255, 0, 255], 1, '3D readback')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: 2D array texture sampling', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var data = new Uint8Array(4 * 4 * 2 * 4)
      for (var layer = 0; layer < 2; ++layer) {
        for (var i = 0; i < 16; ++i) {
          var offset = (layer * 16 + i) * 4
          data[offset] = layer === 0 ? 255 : 0
          data[offset + 1] = layer === 0 ? 0 : 255
          data[offset + 3] = 255
        }
      }
      var texture = gpu.texture({
        width: 4,
        height: 4,
        layers: 2,
        data: data
      })
      var sampler = gpu.sampler({ magFilter: 'nearest', minFilter: 'nearest' })
      var vertices = gpu.buffer({
        data: fullscreenVertexData(),
        usage: ['vertex']
      })
      var pipeline = gpu.pipeline({
        code: [
          '@group(0) @binding(0) var tex: texture_2d_array<f32>;',
          '@group(0) @binding(1) var samp: sampler;',
          'struct VSOut {',
          '  @builtin(position) pos: vec4<f32>,',
          '  @location(0) uv: vec2<f32>',
          '};',
          '@vertex fn vs_main(',
          '  @location(0) p: vec2<f32>,',
          '  @location(1) uv: vec2<f32>',
          ') -> VSOut {',
          '  var out: VSOut;',
          '  out.pos = vec4<f32>(p, 0.0, 1.0);',
          '  out.uv = uv;',
          '  return out;',
          '}',
          '@fragment fn fs_main(input: VSOut) -> @location(0) vec4<f32> {',
          '  return textureSample(tex, samp, input.uv, 1);',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: [
          { format: 'float32x2', stride: 16, offset: 0 },
          { format: 'float32x2', stride: 16, offset: 8 }
        ],
        bindings: [
          { binding: 0, kind: 'texture', viewDimension: '2d-array' },
          { binding: 1, kind: 'sampler' }
        ]
      })
      var bindGroup = gpu.bindGroup(pipeline, [
        { binding: 0, resource: texture },
        { binding: 1, resource: sampler }
      ])
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        pass.draw({
          pipeline: pipeline,
          bindGroup: bindGroup,
          vertexBuffers: [vertices],
          count: 3
        })
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [0, 255, 0, 255], 1, '2D array texture')

      var layers = await gpu.readTexture(texture, { layer: 1 })
      assertPixel(layers, 4, [0, 255, 0, 255], 1, '2D array readback')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: cube texture sampling', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var face = new Uint8Array(2 * 2 * 4)
      for (var i = 0; i < 4; ++i) {
        face[i * 4] = 0
        face[i * 4 + 1] = 255
        face[i * 4 + 3] = 255
      }
      var texture = gpu.texture({
        width: 2,
        height: 2,
        faces: [face, face, face, face, face, face]
      })
      var sampler = gpu.sampler({ magFilter: 'nearest', minFilter: 'nearest' })
      var vertices = gpu.buffer({
        data: fullscreenVertexData(),
        usage: ['vertex']
      })
      var pipeline = gpu.pipeline({
        code: [
          '@group(0) @binding(0) var tex: texture_cube<f32>;',
          '@group(0) @binding(1) var samp: sampler;',
          'struct VSOut {',
          '  @builtin(position) pos: vec4<f32>,',
          '  @location(0) uv: vec2<f32>',
          '};',
          '@vertex fn vs_main(',
          '  @location(0) p: vec2<f32>,',
          '  @location(1) uv: vec2<f32>',
          ') -> VSOut {',
          '  var out: VSOut;',
          '  out.pos = vec4<f32>(p, 0.0, 1.0);',
          '  out.uv = uv;',
          '  return out;',
          '}',
          '@fragment fn fs_main(input: VSOut) -> @location(0) vec4<f32> {',
          '  let dir = normalize(vec3<f32>(input.uv * 2.0 - 1.0, 1.0));',
          '  return textureSample(tex, samp, dir);',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: [
          { format: 'float32x2', stride: 16, offset: 0 },
          { format: 'float32x2', stride: 16, offset: 8 }
        ],
        bindings: [
          { binding: 0, kind: 'texture', viewDimension: 'cube' },
          { binding: 1, kind: 'sampler' }
        ]
      })
      var bindGroup = gpu.bindGroup(pipeline, [
        { binding: 0, resource: texture },
        { binding: 1, resource: sampler }
      ])
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        pass.draw({
          pipeline: pipeline,
          bindGroup: bindGroup,
          vertexBuffers: [vertices],
          count: 3
        })
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [0, 255, 0, 255], 1, 'cube texture')

      var face = await gpu.readTexture(texture, { layer: 0 })
      assertPixel(face, 2, [0, 255, 0, 255], 1, 'cube readback')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: uniform buffer subrange binding', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var camera = gpu.buffer({
        size: 512,
        usage: ['uniform', 'copy-dst']
      })
      camera.write(new Float32Array([1, 0, 0, 1]), 0)
      camera.write(new Float32Array([0, 1, 0, 1]), 256)
      var command = gpu({
        code: [
          'struct U { color: vec4<f32> };',
          '@group(0) @binding(0) var<uniform> u: U;',
          '@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> {',
          '  return vec4<f32>(p, 0.0, 1.0);',
          '}',
          '@fragment fn fs_main() -> @location(0) vec4<f32> {',
          '  return u.color;',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: {
          position: {
            data: new Float32Array([-1, -1, 3, -1, -1, 3]),
            size: 2
          }
        },
        bindings: [
          {
            binding: 0,
            kind: 'uniform',
            resource: camera,
            offset: 256,
            size: 16
          }
        ],
        count: 3
      })
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        command.draw(pass)
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [0, 255, 0, 255], 1, 'uniform subrange')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: compute storage buffer', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var buffer = gpu.buffer({
        data: new Uint32Array([0]),
        usage: ['storage', 'copy-src', 'copy-dst']
      })
      var compute = gpu.compute({
        code: [
          '@group(0) @binding(0) var<storage, read_write> data: array<u32>;',
          '@compute @workgroup_size(1) fn main() {',
          '  data[0] = data[0] + 1u;',
          '}'
        ].join('\n'),
        bindings: [
          { binding: 0, kind: 'storage', resource: buffer }
        ],
        workgroupCount: [1, 1, 1]
      })
      compute()
      var bytes = await gpu.readBuffer(buffer)
      var values = new Uint32Array(bytes.buffer, bytes.byteOffset, 1)
      assert(values[0] === 1, 'compute storage result')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: pipeline cache', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var options = {
        code: [
          '@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> {',
          '  return vec4<f32>(p, 0.0, 1.0);',
          '}',
          '@fragment fn fs_main() -> @location(0) vec4<f32> {',
          '  return vec4<f32>(1.0);',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: [{ format: 'float32x2', stride: 8 }]
      }
      var a = gpu.pipeline(options)
      var b = gpu.pipeline(options)
      assert(a === b, 'pipeline should be cached')
      gpu.clearPipelineCache()
      var c = gpu.pipeline(options)
      assert(c !== a, 'pipeline cache should clear')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: buffer pool refcount/reuse', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var pool = gpu.pool()
      var first = pool.buffer({ size: 64, usage: ['vertex'] })
      var resource = first.resource
      first.retain()
      first.release()
      assert(first.refCount === 1, 'refcount after retain/release')
      var second = pool.buffer({ size: 64, usage: ['vertex'] })
      assert(second.resource !== resource, 'leased buffer must not be reused')
      first.release()
      var third = pool.buffer({ size: 64, usage: ['vertex'] })
      assert(third.resource === resource, 'released buffer should be reused')
      third.release()
      second.release()
      var stats = pool.stats()
      assert(stats.buffers.free === 2, 'buffer pool free count')
      pool.destroy()
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: texture pool reuse/upload', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var pool = gpu.pool()
      var red = new Uint8Array(4 * 4 * 4)
      var green = new Uint8Array(4 * 4 * 4)
      for (var i = 0; i < 16; ++i) {
        red[i * 4] = 255
        red[i * 4 + 3] = 255
        green[i * 4 + 1] = 255
        green[i * 4 + 3] = 255
      }
      var first = pool.texture({ width: 4, height: 4, data: red })
      var texture = first.resource.texture
      first.release()
      var second = pool.texture({ width: 4, height: 4, data: green })
      assert(second.resource.texture === texture, 'texture should be reused')
      var pixels = await gpu.readTexture(second.resource)
      assertPixel(pixels, 4, [0, 255, 0, 255], 1, 'pooled texture upload')
      second.release()
      pool.destroy()
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: scope and batch', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var makeTarget = function () {
        return gpu.texture({
          width: 8,
          height: 8,
          format: 'rgba8unorm',
          usage: ['render-attachment', 'copy-src', 'texture-binding']
        })
      }
      var code = function (color) {
        return [
          '@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> {',
          '  return vec4<f32>(p, 0.0, 1.0);',
          '}',
          '@fragment fn fs_main() -> @location(0) vec4<f32> {',
          '  return vec4<f32>(' + color.join(', ') + ');',
          '}'
        ].join('\n')
      }
      var green = gpu({
        code: code([0, 1, 0, 1]),
        format: 'rgba8unorm',
        attributes: {
          position: {
            data: new Float32Array([-1, -1, 3, -1, -1, 3]),
            size: 2
          }
        },
        count: 3
      })
      var red = gpu({
        code: code([1, 0, 0, 1]),
        format: 'rgba8unorm',
        attributes: {
          position: {
            data: new Float32Array([-0.5, -0.5, 0.5, -0.5, 0, 0.5]),
            size: 2
          }
        },
        count: 3
      })

      var target = makeTarget()
      gpu.batch(
        {
          color: target,
          clearColor: [0, 0, 0, 1]
        },
        function (batch) {
          batch.draw(green)
          batch.draw(red)
        }
      )
      var batchPixels = await gpu.readTexture(target)
      assertPixel(batchPixels, 8, [255, 0, 0, 255], 1, 'batch center')
      assert(
        batchPixels[0] === 0 &&
          batchPixels[1] === 255 &&
          batchPixels[2] === 0,
        'batch corner should keep green'
      )

      var scopeTarget = makeTarget()
      var scope = gpu.scope({
        color: scopeTarget,
        clearColor: [0, 0, 0, 1]
      })
      scope.draw(green)
      scope.draw(red)
      scope.end()
      var scopePixels = await gpu.readTexture(scopeTarget)
      assertPixel(scopePixels, 8, [255, 0, 0, 255], 1, 'scope center')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: indirect draw', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var indirect = gpu.buffer({
        data: new Uint32Array([3, 1, 0, 0]),
        usage: ['indirect']
      })
      var command = gpu({
        code: [
          '@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> {',
          '  return vec4<f32>(p, 0.0, 1.0);',
          '}',
          '@fragment fn fs_main() -> @location(0) vec4<f32> {',
          '  return vec4<f32>(0.0, 1.0, 0.0, 1.0);',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: {
          position: {
            data: new Float32Array([-1, -1, 3, -1, -1, 3]),
            size: 2
          }
        },
        indirectBuffer: { buffer: indirect },
        count: 0
      })
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        command.draw(pass)
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [0, 255, 0, 255], 1, 'indirect draw')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: indexed indirect draw + dispatchIndirect', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var indices = gpu.buffer({
        data: new Uint16Array([0, 1, 2]),
        usage: ['index']
      })
      var indirectDraw = gpu.buffer({
        data: new Uint32Array([3, 1, 0, 0, 0]),
        usage: ['indirect']
      })
      var command = gpu({
        code: [
          '@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> {',
          '  return vec4<f32>(p, 0.0, 1.0);',
          '}',
          '@fragment fn fs_main() -> @location(0) vec4<f32> {',
          '  return vec4<f32>(0.0, 0.0, 1.0, 1.0);',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: {
          position: {
            data: new Float32Array([-1, -1, 3, -1, -1, 3]),
            size: 2
          }
        },
        indexBuffer: { buffer: indices, format: 'uint16' },
        indirectBuffer: { buffer: indirectDraw },
        count: 0
      })
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        command.draw(pass)
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [0, 0, 255, 255], 1, 'indexed indirect draw')

      var storage = gpu.buffer({
        data: new Uint32Array([0]),
        usage: ['storage', 'copy-src', 'copy-dst']
      })
      var indirectDispatch = gpu.buffer({
        data: new Uint32Array([1, 1, 1]),
        usage: ['indirect']
      })
      var compute = gpu.compute({
        code: [
          '@group(0) @binding(0) var<storage, read_write> data: array<u32>;',
          '@compute @workgroup_size(1) fn main() {',
          '  data[0] = data[0] + 1u;',
          '}'
        ].join('\n'),
        bindings: [
          { binding: 0, kind: 'storage', resource: storage }
        ],
        indirectBuffer: { buffer: indirectDispatch }
      })
      compute()
      var bytes = await gpu.readBuffer(storage)
      var values = new Uint32Array(bytes.buffer, bytes.byteOffset, 1)
      assert(values[0] === 1, 'dispatchIndirect result')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: timestamp query', async function () {
    var adapter = await navigator.gpu.requestAdapter()
    if (!adapter || !adapter.features.has('timestamp-query')) {
      return
    }
    var gpu = await window.createWEBGPU({ features: ['timestamp-query'] })
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var querySet = gpu.querySet({ type: 'timestamp', count: 2 })
      var queryBuffer = gpu.buffer({
        size: 16,
        usage: ['query-resolve', 'copy-src', 'copy-dst']
      })
      gpu.render(
        {
          color: target,
          clearColor: [0, 0, 0, 1],
          queries: {
            timestamp: { querySet: querySet }
          }
        },
        function () {}
      )
      gpu.resolveQuerySet({
        querySet: querySet,
        destination: queryBuffer
      })
      var bytes = await gpu.readBuffer(queryBuffer)
      var times = new BigUint64Array(bytes.buffer, bytes.byteOffset, 2)
      assert(times[0] > 0n, 'timestamp should be non-zero')
      assert(times[1] >= times[0], 'end timestamp should follow start')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: occlusion query', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var querySet = gpu.querySet({ type: 'occlusion', count: 1 })
      var queryBuffer = gpu.buffer({
        size: 8,
        usage: ['query-resolve', 'copy-src', 'copy-dst']
      })
      var command = gpu({
        code: [
          '@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> {',
          '  return vec4<f32>(p, 0.0, 1.0);',
          '}',
          '@fragment fn fs_main() -> @location(0) vec4<f32> {',
          '  return vec4<f32>(1.0);',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: {
          position: {
            data: new Float32Array([-1, -1, 3, -1, -1, 3]),
            size: 2
          }
        },
        count: 3
      })
      gpu.render(
        {
          color: target,
          clearColor: [0, 0, 0, 1],
          queries: {
            occlusion: { querySet: querySet, index: 0 }
          }
        },
        function (pass) {
          command.draw(pass)
        }
      )
      gpu.resolveQuerySet({
        querySet: querySet,
        destination: queryBuffer
      })
      var bytes = await gpu.readBuffer(queryBuffer)
      var samples = new BigUint64Array(bytes.buffer, bytes.byteOffset, 1)
      assert(samples[0] > 0n, 'occlusion samples should be non-zero')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: compute storage texture', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var texture = gpu.texture({
        width: 4,
        height: 4,
        format: 'rgba8unorm',
        usage: ['storage-binding', 'copy-src', 'texture-binding'],
        data: new Uint8Array(64)
      })
      var compute = gpu.compute({
        code: [
          '@group(0) @binding(0) var tex: texture_storage_2d<rgba8unorm, write>;',
          '@compute @workgroup_size(1) fn main() {',
          '  textureStore(tex, vec2<i32>(2, 2), vec4<f32>(1.0, 0.0, 0.0, 1.0));',
          '}'
        ].join('\n'),
        bindings: [
          {
            binding: 0,
            kind: 'storage-texture',
            resource: texture,
            storageTextureFormat: 'rgba8unorm'
          }
        ],
        workgroupCount: [1, 1, 1]
      })
      compute()
      var pixels = await gpu.readTexture(texture)
      assertPixel(pixels, 4, [255, 0, 0, 255], 1, 'storage texture')
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: frame pool', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var frame = gpu.framePool()
      var first = frame.buffer({ size: 64, usage: ['vertex'] })
      var resource = first.resource
      await frame.endFrame()
      var second = frame.buffer({ size: 64, usage: ['vertex'] })
      assert(second.resource === resource, 'frame resource should be reused')
      await frame.endFrame()
      frame.destroy()
    } finally {
      gpu.destroy()
    }
  })

  test('WebGPU: multiple bind groups + dynamic offset', async function () {
    var gpu = await window.createWEBGPU()
    try {
      var target = gpu.texture({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: ['render-attachment', 'copy-src', 'texture-binding']
      })
      var camera = gpu.buffer({
        size: 512,
        usage: ['uniform', 'copy-dst']
      })
      camera.write(new Float32Array([1, 0, 0, 1]), 0)
      camera.write(new Float32Array([0, 1, 0, 1]), 256)
      var white = new Uint8Array(16).fill(255)
      var texture = gpu.texture({ width: 2, height: 2, data: white })
      var sampler = gpu.sampler({
        magFilter: 'nearest',
        minFilter: 'nearest'
      })
      var command = gpu({
        code: [
          'struct U { color: vec4<f32> };',
          '@group(0) @binding(0) var<uniform> u: U;',
          '@group(1) @binding(0) var tex: texture_2d<f32>;',
          '@group(1) @binding(1) var samp: sampler;',
          'struct VSOut {',
          '  @builtin(position) pos: vec4<f32>,',
          '  @location(0) uv: vec2<f32>',
          '};',
          '@vertex fn vs_main(',
          '  @location(0) p: vec2<f32>,',
          '  @location(1) uv: vec2<f32>',
          ') -> VSOut {',
          '  var out: VSOut;',
          '  out.pos = vec4<f32>(p, 0.0, 1.0);',
          '  out.uv = uv;',
          '  return out;',
          '}',
          '@fragment fn fs_main(input: VSOut) -> @location(0) vec4<f32> {',
          '  return textureSample(tex, samp, input.uv) * u.color;',
          '}'
        ].join('\n'),
        format: 'rgba8unorm',
        attributes: {
          position: {
            data: new Float32Array([-1, -1, 3, -1, -1, 3]),
            size: 2
          },
          uv: {
            data: new Float32Array([0, 0, 2, 0, 0, 2]),
            size: 2
          }
        },
        bindings: [
          {
            group: 0,
            binding: 0,
            kind: 'uniform',
            resource: camera,
            size: 16,
            dynamicOffset: true
          },
          {
            group: 1,
            binding: 0,
            kind: 'texture',
            resource: texture,
            viewDimension: '2d'
          },
          {
            group: 1,
            binding: 1,
            kind: 'sampler',
            resource: sampler
          }
        ],
        count: 3
      })
      gpu.render({ color: target, clearColor: [0, 0, 0, 1] }, function (pass) {
        command.draw(pass, { dynamicOffsets: { 0: [256] } })
      })
      var pixels = await gpu.readTexture(target)
      assertPixel(pixels, 8, [0, 255, 0, 255], 1, 'dynamic offset/group1')
    } finally {
      gpu.destroy()
    }
  })

  window.runWebGPUTests = async function () {
    var results = []
    for (var i = 0; i < tests.length; ++i) {
      var started = performance.now()
      try {
        await tests[i].fn()
        results.push({
          name: tests[i].name,
          ok: true,
          ms: performance.now() - started
        })
      } catch (error) {
        results.push({
          name: tests[i].name,
          ok: false,
          ms: performance.now() - started,
          error: String(error && (error.stack || error))
        })
      }
    }
    return results
  }
})()
