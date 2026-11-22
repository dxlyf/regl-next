/**
 * 公共类型的使用示例（编译期测试，不运行）。
 *
 * 通过 `npm run test:types` 检查；确保泛型 Props/Context 推导、资源类型、
 * 命令调用形式都符合预期。
 */
import createREGL, {
  Buffer,
  DefaultContext,
  DrawCommand,
  Elements,
  Framebuffer2D,
  FramebufferCube,
  Regl,
  Renderbuffer,
  Texture2D,
  TextureCube,
  VertexArrayObject,
  Vec4
} from '../../src/index'

const regl: Regl = createREGL({
  container: document.body,
  extensions: ['oes_texture_float'],
  optionalExtensions: ['ext_texture_filter_anisotropic'],
  version: 'auto'
})

const reglDefault: Regl = createREGL()
const reglCanvas: Regl = createREGL(document.createElement('canvas'))
const reglSelector: Regl = createREGL('#app')
const existingContext = document
  .createElement('canvas')
  .getContext('webgl2') as WebGL2RenderingContext
const reglContext: Regl = createREGL(existingContext)
void reglDefault
void reglCanvas
void reglSelector
void reglContext

regl.batch(() => {
  regl.draw()
})
regl.scope({}, () => {
  regl.draw()
})

const buffer: Buffer = regl.buffer({
  data: new Float32Array([0, 0, 1, 0, 0, 1]),
  usage: 'static',
  type: 'float32'
})

const elements: Elements = regl.elements({
  data: new Uint16Array([0, 1, 2]),
  primitive: 'triangles'
})

const texture: Texture2D = regl.texture({
  width: 2,
  height: 2,
  format: 'rgba',
  type: 'uint8',
  data: new Uint8Array(16),
  min: 'nearest',
  mag: 'nearest',
  wrap: 'clamp'
})

const cube: TextureCube = regl.cube(4)
cube.subimage(0, { data: [[[255, 255, 255, 255]]] })

const renderbuffer: Renderbuffer = regl.renderbuffer({
  radius: 4,
  format: 'rgba4'
})

const fbo: Framebuffer2D = regl.framebuffer({
  colors: [texture],
  depth: renderbuffer
})
fbo.use(() => regl.clear({ color: [0, 0, 0, 1] }))

const cubeFbo: FramebufferCube = regl.framebufferCube(4)
cubeFbo.resize(8)

const vao: VertexArrayObject = regl.vao({
  attributes: [{ data: [[0, 0], [1, 0], [0, 1]] }],
  elements
})

// Uniform Buffer（WebGL2）
const ubo = regl.uniformBuffer({
  data: new Float32Array(80),
  usage: 'dynamic'
})
const uboDraw = regl({
  vert: 'precision mediump float; void main () { gl_Position = vec4(0.0); }',
  frag: 'precision mediump float; void main () { gl_FragColor = vec4(1.0); }',
  uniformBlocks: {
    Camera: ubo
  },
  count: 1
})
const blockLayout = uboDraw.uniformBlockLayout('Camera')
void blockLayout
ubo.member('view', new Float32Array(16))
ubo.set({ time: 1 })
ubo.attachLayout(uboDraw, 'Camera')

const volume = regl.texture3D({
  width: 8,
  height: 8,
  depth: 4,
  data: new Uint8Array(8 * 8 * 4 * 4)
})
volume.subimage(0, new Uint8Array(8 * 8 * 4))

const layers = regl.texture2DArray({
  width: 8,
  height: 8,
  layers: 4,
  data: new Uint8Array(8 * 8 * 4 * 4)
})
layers.subimage(1, new Uint8Array(8 * 8 * 4))

const layerFbo = regl.framebuffer({
  color: { texture: layers, layer: 1 },
  depth: false
})
void volume
void layerFbo

const msaaFbo = regl.framebuffer({
  width: 8,
  height: 8,
  samples: 4,
  depth: true
})
const msaaRb = regl.renderbuffer({
  width: 8,
  height: 8,
  format: 'rgba8',
  samples: 4
})
regl.blitFramebuffer({
  src: msaaFbo,
  dst: fbo,
  mask: ['color', 'depth'],
  filter: 'nearest'
})
void msaaRb

const intPositions = regl.buffer(new Int32Array([0, 0, 4, 0, 0, 4]))
const intVao = regl.vao({
  attributes: [
    {
      data: new Int32Array([0, 0, 4, 0, 0, 4]),
      size: 2,
      type: 'int32',
      integer: true
    }
  ]
})
const intDraw = regl({
  vert: 'precision mediump float; void main () { gl_Position = vec4(0.0); }',
  frag: 'precision mediump float; void main () { gl_FragColor = vec4(1.0); }',
  attributes: {
    position: {
      buffer: intPositions,
      size: 2,
      type: 'int32',
      integer: true
    }
  },
  count: 3
})
void intVao
void intDraw

regl.read({ framebuffer: fbo, colorAttachment: 1 })
regl.clear({
  framebuffer: fbo,
  colorAttachment: [0, 1],
  color: [0, 0, 0, 1]
})

const pbo = regl.pixelBuffer({ length: 16 })
regl.readPixelsToBuffer({ framebuffer: fbo, pixelBuffer: pbo })
const pboBytes = regl.readBuffer(pbo)
regl.copyBufferSubData(pbo, pbo, 0, 0, 16)
const pboTexture = regl.texture({
  width: 2,
  height: 2,
  pixelBuffer: pbo
})
void pboBytes
void pboTexture

// WebGL2 sampler object
const sampler = regl.sampler({
  min: 'linear',
  mag: 'linear',
  wrap: 'clamp',
  compare: 'lequal',
  minLod: -1000,
  maxLod: 1000,
  lodBias: 0,
  anisotropic: 1
})
const sampledDraw = regl({
  vert: 'precision mediump float; void main () { gl_Position = vec4(0.0); }',
  frag: 'precision mediump float; void main () { gl_FragColor = vec4(1.0); }',
  uniforms: {
    tex: { texture: texture, sampler: sampler }
  },
  count: 1
})
sampler({ min: 'nearest' })
sampler.destroy()
void sampledDraw

// Phase 2 结构化值
const structuredDraw = regl({
  vert: 'precision mediump float; void main () { gl_Position = vec4(0.0); }',
  frag: 'precision mediump float; void main () { gl_FragColor = vec4(1.0); }',
  uniformBlocks: {
    Camera: {
      view: new Float32Array(16),
      time: 1,
      eye: [0, 0, 5]
    },
    Light: {
      values: {
        color: [1, 1, 1, 1]
      },
      binding: 2
    }
  },
  count: 1
})
void structuredDraw

interface Props {
  color: Vec4
  scale: number
}

const draw: DrawCommand<DefaultContext, Props> = regl<Props>({
  vert: `
    precision mediump float;
    attribute vec2 position;
    uniform float scale;
    void main () { gl_Position = vec4(position * scale, 0, 1); }
  `,
  frag: `
    precision mediump float;
    uniform vec4 color;
    void main () { gl_FragColor = color; }
  `,
  attributes: { position: buffer },
  uniforms: {
    color: regl.prop('color'),
    scale: (context: DefaultContext, props: Props) =>
      props.scale * (1 + context.tick)
  },
  elements,
  count: 3,
  depth: { enable: true, func: 'lequal' },
  profile: false
})

draw({ color: [1, 0, 0, 1], scale: 1 })
draw(3, (context, props, batchId) => {
  void context.tick
  void props
  void batchId
})

const batchDraw: DrawCommand<DefaultContext, Props> = regl<Props>({
  vert: 'precision mediump float; void main () { gl_Position = vec4(0.0); }',
  frag: 'precision mediump float; void main () { gl_FragColor = vec4(1.0); }',
  count: 1
})
batchDraw([
  { color: [1, 0, 0, 1], scale: 1 },
  { color: [0, 1, 0, 1], scale: 2 }
])

const pixels: Uint8Array = regl.read({ x: 0, y: 0, width: 1, height: 1 })
const floatPixels: Float32Array = regl.read({
  framebuffer: fbo,
  data: new Float32Array(4)
})

const limits = regl.limits
void limits.maxTextureSize
void limits.isWebGL2
void limits.max3DTextureSize
void texture.width
void cube.height
void fbo.width
void renderbuffer.format
void vao._vao
void pixels
void floatPixels

regl.frame((context) => {
  void context.time
  void context.tick
})
regl.on('destroy', () => {})
regl.destroy()
