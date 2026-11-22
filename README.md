# regl-next

> npm 包名：`@dxyl/regl-next`

> 用 TypeScript 重写的 [regl](https://github.com/regl-project/regl)：保持函数式 API 与整体使用风格，
> 同时支持 **WebGL1** 与 **WebGL2**，并对状态管理、资源恢复、格式表、类型系统等做了现代化重构。

---

## 特性

- **API 风格与 regl 一致**：`regl({...})` 创建命令，`regl.buffer / texture / framebuffer / vao ...` 创建资源，
  `regl.frame / clear / read / on / destroy` 等接口保持不变。
- **regl.batch / regl.scope**：batch 共享 batchId，scope 应用一组临时状态并在结束后恢复。
- **WebGL2 Uniform Buffer（UBO）**：`regl.uniformBuffer(...)` + 命令的 `uniformBlocks` 选项，
  支持按 block 反射布局更新单个成员，也支持 Phase 2 结构化值自动打包。
- **WebGL2 Sampler Object**：`regl.sampler(...)`，与 texture 解耦，支持
  `min/mag/wrap/compare/LOD/anisotropic` 与 `bindSampler` 状态缓存。
- **WebGL2 3D / 2D Array 纹理**：`regl.texture3D(...)`、`regl.texture2DArray(...)`，
  支持 `subimage`、mipmap、压缩数据和 FBO layer 附件。
- **WebGL2 MSAA**：`samples` framebuffer / renderbuffer + `regl.blitFramebuffer(...)` resolve。
- **WebGL2 整数顶点属性**：`ivec` / `uvec` attribute 使用 `vertexAttribIPointer`。
- **MRT 附件操作**：`regl.read({ colorAttachment })` 与 `regl.clear({ colorAttachment })`。
- **WebGL2 PBO**：`regl.pixelBuffer`、`readPixelsToBuffer`、`readBuffer`、2D PBO 纹理上传。
- **Buffer 复制 / 回读**：`copyBufferSubData`、`getBufferSubData`。
- **WebGPU-first PoC**：`createWEBGPU` 从主入口导出，同时保留
  `@dxyl/regl-next/webgpu` 独立入口，提供 buffer / texture / sampler / pipeline /
  bindGroup / render / readTexture。
- **WebGPU 多 bind group / dynamic offset**：支持 `group: 0..N`、`hasDynamicOffset` 和
  draw/dispatch 时的 dynamic offsets。
- **同时支持 WebGL1 与 WebGL2**：
  - WebGL2 下原生使用 VAO、实例化、`drawBuffers`（MRT）、32 位索引；
  - WebGL1 下自动回退到 `OES_vertex_array_object`、`ANGLE_instanced_arrays`、
    `WEBGL_draw_buffers`、`OES_element_index_uint`；
  - 对用户代码而言，`regl.hasExtension('oes_vertex_array_object')` 在 WebGL2 下也返回 `true`。
- **CSP 友好**：不再使用 `new Function` 生成绘制代码，改为编译期生成「求值器 + 绘制计划」。
- **完整 TypeScript 类型**：命令的 Props / Context 泛型、资源类型、状态选项类型均可推导。
- **全中文注释**：核心设计、状态机、纹理格式、上下文恢复等关键位置均有详细说明。
- **更清晰的资源生命周期**：buffer / elements / texture / renderbuffer / framebuffer / VAO / program
  都有明确的引用计数或所有权规则，支持上下文丢失恢复。

---

## 安装与构建

```bash
npm install

# 类型检查
npm run typecheck

# 构建：dist/regl-next.js (ESM) / dist/regl-next.cjs / dist/regl-next.min.js / dist/types
npm run build

# Node 单元测试
npm test

# 浏览器集成测试（需要本机 Chrome / Edge，使用 SwiftShader 软件渲染）
npm run test:browser

# 示例页面冒烟测试（逐个加载 examples/*.html）
npm run test:examples

# 公共类型使用示例的编译期测试
npm run test:types
```

产物：

| 文件 | 说明 |
| --- | --- |
| `dist/regl-next.js` | ESM |
| `dist/regl-next.cjs` | CommonJS |
| `dist/regl-next.min.js` | IIFE，全局变量 `createREGL` |
| `dist/regl-next.dev.js` | 开发版 IIFE（保留运行时断言） |
| `dist/types/index.d.ts` | 类型声明 |

---

## 快速开始

```ts
import createREGL from '@dxyl/regl-next'

const regl = createREGL({
  // 默认 'auto'：优先 WebGL2，失败回退 WebGL1
  version: 'auto',
  extensions: ['oes_texture_float'],
  optionalExtensions: ['ext_texture_filter_anisotropic'],
  container: document.body
})

const drawTriangle = regl({
  vert: `
    precision mediump float;
    attribute vec2 position;
    uniform float angle;
    void main () {
      float s = sin(angle), c = cos(angle);
      gl_Position = vec4(mat2(c, -s, s, c) * position, 0, 1);
    }
  `,
  frag: `
    precision mediump float;
    uniform vec4 color;
    void main () { gl_FragColor = color; }
  `,
  attributes: {
    position: [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]]
  },
  uniforms: {
    color: [1, 0.3, 0.2, 1],
    angle: regl.context('time')
  },
  count: 3,
  depth: { enable: false },
  blend: {
    enable: true,
    func: { src: 'src alpha', dst: 'one minus src alpha' }
  }
})

regl.frame(() => {
  regl.clear({ color: [0.05, 0.05, 0.08, 1], depth: 1 })
  drawTriangle()
})
```

### 3D / 2D Array 纹理（WebGL2）

```ts
const volume = regl.texture3D({
  width: 64,
  height: 64,
  depth: 32,
  data: volumeBytes,
  min: 'linear',
  mag: 'linear'
})

const layers = regl.texture2DArray({
  width: 64,
  height: 64,
  layers: 8,
  data: layerBytes
})

// 更新一帧/一层
volume.subimage(4, { data: sliceBytes })
layers.subimage(2, { data: sliceBytes })
```

FBO 可以直接挂载 3D / array 的某一层：

```ts
const fbo = regl.framebuffer({
  color: { texture: layers, layer: 3 },
  depth: false
})
```

### MSAA + blit resolve（WebGL2）

```ts
const msaa = regl.framebuffer({
  width: 512,
  height: 512,
  samples: 4,
  depth: true
})

const resolvedTexture = regl.texture({
  width: 512,
  height: 512,
  min: 'linear',
  mag: 'linear'
})
const resolved = regl.framebuffer({ color: resolvedTexture })

// 渲染到 msaa
regl.clear({ framebuffer: msaa, color: [0, 0, 0, 1], depth: 1 })
drawScene()

// resolve 到普通 texture
regl.blitFramebuffer({
  src: msaa,
  dst: resolved,
  mask: 'color'
})
```

`renderbuffer({ samples: 4 })` 也可以显式创建 multisample renderbuffer。

### MRT 单附件读取 / 清除（WebGL2）

```ts
// 读取第 1 个颜色附件
const pixels = regl.read({
  framebuffer: fbo,
  colorAttachment: 1
})

// 只清除第 1 个颜色附件
regl.clear({
  framebuffer: fbo,
  colorAttachment: 1,
  color: [0, 0, 1, 1]
})

// 清除多个颜色附件
regl.clear({
  framebuffer: fbo,
  colorAttachment: [0, 1],
  color: [1, 1, 0, 1]
})
```

### PBO / Buffer 异步回读（WebGL2）

```ts
const pbo = regl.pixelBuffer({
  length: width * height * 4
})

regl.readPixelsToBuffer({
  framebuffer: fbo,
  pixelBuffer: pbo
})

// 稍后读取
const pixels = regl.readBuffer(pbo)

// PBO 直接作为纹理上传来源
const texture = regl.texture({
  width: 256,
  height: 256,
  pixelBuffer: pbo
})

// 普通 buffer 复制 / 回读
regl.copyBufferSubData(srcBuffer, dstBuffer, 0, 0, byteLength)
const bytes = regl.readBuffer(dstBuffer)
```

### 命令的三种执行方式

```ts
// 1. 普通绘制：props 通过 regl.prop(...) / 函数读取
drawTriangle({ color: [0, 1, 0, 1] })

// 2. 批量绘制：同一命令、不同 props
drawTriangle([
  { color: [1, 0, 0, 1] },
  { color: [0, 1, 0, 1] }
])

// 3. 作用域：把上下文/状态/uniform/attribute 设置给回调内部的子命令
const setup = regl({
  uniforms: { color: [0, 0, 1, 1] },
  viewport: { x: 0, y: 0, width: 256, height: 256 }
})
setup(() => {
  drawTriangle()
})

// 4. batch：所有命令共享同一个 batchId
regl.batch(() => {
  drawTriangle({ color: [1, 0, 0, 1] })
  drawTriangle({ color: [0, 1, 0, 1] })
})

// 5. scope：临时状态只作用于回调内部
regl.scope(
  {
    uniforms: { color: [0, 0, 1, 1] },
    viewport: { x: 0, y: 0, width: 256, height: 256 }
  },
  () => {
    drawTriangle()
  }
)
```

### 资源

```ts
const position = regl.buffer(new Float32Array([0, 0, 1, 0, 0, 1]))
const indices = regl.elements(new Uint16Array([0, 1, 2]))
const texture = regl.texture({ width: 2, height: 2, data: new Uint8Array(16) })
const fbo = regl.framebuffer({ width: 512, height: 512, colorFormat: 'rgba' })
const vao = regl.vao({
  attributes: [{ buffer: position, size: 2 }],
  elements: indices
})
```

### Uniform Buffer（WebGL2）

```ts
const camera = regl.uniformBuffer({
  size: 128,
  usage: 'dynamic'
})

const drawScene = regl({
  vert, frag,
  uniformBlocks: {
    Camera: camera
  },
  count: 3
})

// 命令使用静态 shader 时，创建命令后 layout 已解析
camera.member('view', viewMatrix)
camera.member('projection', projectionMatrix)
camera.member('time', 1.5)

// 批量更新
camera.set({
  view: viewMatrix,
  time: 1.5
})

// 只上传某个成员范围，不重传整个 block
camera.member('eye', [0, 0, 5])
```

Phase 2 也支持结构化值，由命令自动创建并复用内部 UBO：

```ts
const drawScene = regl({
  vert, frag,
  uniformBlocks: {
    Camera: {
      view: regl.prop('view'),
      projection: regl.prop('projection'),
      eye: [0, 0, 5],
      time: regl.context('time')
    }
  },
  count: 3
})
```

显式包装（避免成员名 `buffer` / `values` 歧义）：

```ts
uniformBlocks: {
  Camera: {
    values: { view, projection },
    binding: 2
  }
}
```

Phase 2 行为：

- 静态结构化值只在首次绘制时打包/上传一次；
- 动态值按反射 std140 布局打包，只上传变化成员的范围；
- 对象中缺失的成员保留上一次的值；
- 支持数组、`vec3` padding、矩阵 stride、嵌套结构体与结构体数组；
- scope / batch 同样支持结构化值；
- 上下文恢复后会在下一次绘制重新打包上传。

底层也支持原始字节与范围绑定：

```ts
camera.subdata(new Float32Array([...]), 0)

uniformBlocks: {
  Camera: {
    buffer: camera,
    offset: 256,   // 必须是 uniformBufferOffsetAlignment 的倍数
    size: 80,
    binding: 2
  }
}
```

说明：

- UBO 仅在 WebGL2 下可用，WebGL1 调用会抛错；
- `uniformBlocks` 的 block 名来自 GLSL 中的 block 名称；
- 默认 binding 使用 block 在 program 中的索引，可通过 `binding` 显式覆盖；
- 命令没有显式提供某个 block 时，会尝试从 scope 继承；
- `member()` / `set()` 使用驱动反射出的 std140 offset / stride，只调用一次小范围 `bufferSubData`；
- Phase 2 的结构化 UBO 由命令私有，多个命令共享数据时请使用显式 `regl.uniformBuffer`。

### Sampler Object（WebGL2）

```ts
const sampler = regl.sampler({
  min: 'linear',
  mag: 'linear',
  wrap: 'clamp',
  compare: 'lequal',   // 阴影采样时使用；普通采样可省略
  minLod: -1000,
  maxLod: 1000,
  lodBias: 0,
  anisotropic: 4
})

const draw = regl({
  vert, frag,
  uniforms: {
    tex: {
      texture,
      sampler
    }
  },
  count: 3
})
```

也可以继续只传 texture：

```ts
uniforms: { tex: texture }
```

两者区别：

- `texture` 自带的 `min/mag/wrap` 仍会写入 texture object；
- 如果 uniform 使用 `{ texture, sampler }`，绘制时会把 sampler 绑定到该纹理单元；
- 没有 sampler 时会把该纹理单元的 sampler 解绑为 `null`，避免上一个 draw 的 sampler 残留。

Sampler 支持更新与销毁：

```ts
sampler({ min: 'nearest', mag: 'nearest' })
sampler.destroy()
```

说明：

- 仅 WebGL2 可用，WebGL1 调用 `regl.sampler` 会抛错；
- `compare` 用于 `sampler2DShadow` / `samplerCubeShadow`；
- `anisotropic` 需要 `EXT_texture_filter_anisotropic`；
- 上下文恢复时 sampler 会按保存的参数重新创建；
- `regl.stats.samplerCount` 记录当前 sampler 数量。

### WebGL2 选择

```ts
// 强制 WebGL2
const gl2 = createREGL({ canvas, version: 2 })

// 强制 WebGL1
const regl1 = createREGL({ canvas, version: 'webgl1' })

// 传入已有上下文（推荐用于测试 / 自定义上下文）
const gl = canvas.getContext('webgl2', { antialias: false })
const regl = createREGL({ gl })
```

构建后打开 [examples/index.html](examples/index.html) 查看全部 25 个示例；每个页面都可以直接在浏览器中打开，源码在页面内可读。

示例覆盖：

- [triangle.html](examples/triangle.html) — 最小 draw 命令
- [points.html](examples/points.html) — points / `gl_PointSize` / `gl_PointCoord` / 加法混合
- [elements.html](examples/elements.html) — elements 索引绘制
- [vao.html](examples/vao.html) — VAO + 命令 `vao` 选项
- [batch.html](examples/batch.html) — batch + 多 viewport
- [scope.html](examples/scope.html) — scope 继承 viewport / uniform
- [texture-sampler.html](examples/texture-sampler.html) — texture + WebGL2 sampler object
- [texture-array.html](examples/texture-array.html) — WebGL2 2D array texture / sampler2DArray
- [cube-map.html](examples/cube-map.html) — cube map + 3D 深度
- [framebuffer.html](examples/framebuffer.html) — 离屏渲染 + 后处理
- [material.html](examples/material.html) — 材质共享 program / VAO / 每对象 model uniform
- [blend.html](examples/blend.html) — blend.func / equation / color / colorMask 调试面板
- [depth.html](examples/depth.html) — depth test 开关与遮挡顺序
- [stencil.html](examples/stencil.html) — stencil 写入与模板测试窗口
- [scissor.html](examples/scissor.html) — scissor.box 动态裁剪
- [transparent.html](examples/transparent.html) — 透明物体排序与 `depth.mask: false`
- [mrt.html](examples/mrt.html) — WebGL2 MRT
- [msaa.html](examples/msaa.html) — WebGL2 MSAA render target + blit resolve
- [ubo.html](examples/ubo.html) — WebGL2 uniform block（Phase 2 结构化值）
- [instancing.html](examples/instancing.html) — WebGL2 instancing
- [webgpu.html](examples/webgpu.html) — WebGPU-first PoC：texture / uniform / pipeline / render pass
- [webgpu-depth-msaa.html](examples/webgpu-depth-msaa.html) — WebGPU depth24plus + MSAA resolve + indexed draw
- [webgpu-command.html](examples/webgpu-command.html) — WebGPU WGSL 命令层 `gpu({...})`
- [fps-webgl2.html](examples/fps-webgl2.html) — WebGL2 FPS：第一人称移动、射击、敌人 AI、实例化场景
- [fps-webgpu.html](examples/fps-webgpu.html) — WebGPU FPS：storage buffer instancing + WGSL

页面冒烟测试：

```bash
npm run test:examples
```

---

## WebGPU PoC

WebGPU 与 WebGL 从同一个主入口导出，也保留独立 subpath：

```ts
import { createREGL, createWEBGPU } from '@dxyl/regl-next'

const regl = createREGL({ canvas })
const gpu = await createWEBGPU({ canvas })

// 或者只引入 WebGPU 入口
import { createWEBGPU as createGPU } from '@dxyl/regl-next/webgpu'
```

`createWEBGPU` 返回 `Promise<WEBGPU>`；这是 WebGPU 设备初始化本身异步决定的，资源创建、pipeline、render pass 仍然是同步 API。

```ts
const gpu = await createWEBGPU({ canvas })

// 资源 API
const texture = gpu.texture({
  width: 256,
  height: 256,
  data: pixels
})

const sampler = gpu.sampler({
  magFilter: 'linear',
  minFilter: 'linear'
})

const uniform = gpu.buffer({
  data: new Float32Array([1, 0, 0, 1]),
  usage: ['uniform']
})

const pipeline = gpu.pipeline({
  code: wgsl,
  format: gpu.format,
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

const bindGroup = gpu.bindGroup(pipeline, [
  { binding: 0, resource: uniform },
  { binding: 1, resource: texture },
  { binding: 2, resource: sampler }
])

gpu.render({ clearColor: [0, 0, 0, 1] }, (pass) => {
  pass.draw({
    pipeline,
    bindGroup,
    vertexBuffers: [vertices],
    count: 3
  })
})

const pixels = await gpu.readTexture(target)
```

### WGSL 命令层

`createWEBGPU` 返回对象本身也是可调用函数，形式对齐 `createREGL`。

WebGPU 没有全局 uniforms：uniform 数据就是 bind group 中的 uniform buffer binding。

```ts
const camera = gpu.buffer({
  data: new Float32Array([1, 0, 0, 1]),
  usage: ['uniform']
})

const draw = gpu({
  code: wgsl,
  attributes: {
    position: {
      data: new Float32Array([-1, -1, 3, -1, -1, 3]),
      size: 2
    }
  },
  bindings: [
    { binding: 0, kind: 'uniform', resource: camera },
    {
      binding: 1,
      kind: 'texture',
      resource: texture,
      viewDimension: '2d'
    },
    { binding: 2, kind: 'sampler', resource: sampler }
  ],
  count: 3
})

camera.write(new Float32Array([0, 1, 0, 1]))

gpu.render({ color: target }, (pass) => {
  draw.draw(pass)
})
```

命令层绑定完全显式：

1. `bindings[].binding` 对应 WGSL `@group(0) @binding(n)`；
2. `kind: 'uniform' | 'storage' | 'texture' | 'sampler' | ...`；
3. `resource` 是 `GPUBufferResource` / `GPUTextureResource` / `GPUSamplerResource`；
4. `attributes` 按对象键顺序对应 `@location(0..n)`。

### 多个 bind group + dynamic offset

```ts
const camera = gpu.buffer({
  size: 512,
  usage: ['uniform', 'copy-dst']
})

const draw = gpu({
  code: wgsl,
  attributes: { ... },
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
      resource: texture
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

gpu.render({ color: target }, (pass) => {
  draw.draw(pass, {
    dynamicOffsets: { 0: [256] }
  })
})
```

也可以创建独立 bind group：

```ts
const group1 = gpu.bindGroup(
  pipeline,
  [{ binding: 0, resource: texture }],
  1
)
```

命令层也支持 indexed draw 和 instancing：

```ts
const draw = gpu({
  code: wgsl,
  attributes: {
    position: { data: positions, size: 2 },
    offset: {
      data: instanceOffsets,
      size: 2,
      divisor: 1
    }
  },
  indexBuffer: {
    buffer: indices,
    format: 'uint16'
  },
  count: 3,
  instances: 100
})
```

示例 WGSL：

```wgsl
struct U {
  color: vec4<f32>
};
@group(0) @binding(0) var<uniform> u: U;

@vertex fn vs_main(
  @location(0) position: vec2<f32>
) -> @builtin(position) vec4<f32> {
  return vec4<f32>(position, 0.0, 1.0);
}

@fragment fn fs_main() -> @location(0) vec4<f32> {
  return u.color;
}
```

### 3D / 2D Array / Cube 纹理

```ts
const volume = gpu.texture({
  width: 64,
  height: 64,
  depth: 32,
  dimension: '3d',
  data: volumeBytes
})

const layers = gpu.texture({
  width: 64,
  height: 64,
  layers: 8,
  data: layerBytes
})

const cube = gpu.texture({
  width: 64,
  height: 64,
  faces: [
    face0, face1, face2,
    face3, face4, face5
  ]
})
```

采样时在 pipeline binding 中声明 viewDimension：

```ts
bindings: [
  { binding: 0, kind: 'texture', viewDimension: '3d' },
  { binding: 1, kind: 'sampler' }
]
```

2D array / cube 可以用 `layerView(layer)` 取得单层 render view：

```ts
const layer = layers.layerView(3)
```

`readTexture` 支持 2D / 3D / 2D array / cube 的 4 字节颜色格式回读。

### Compute / Storage Buffer

```ts
const data = gpu.buffer({
  data: new Uint32Array([0]),
  usage: ['storage', 'copy-src', 'copy-dst']
})

const compute = gpu.compute({
  code: `
    @group(0) @binding(0) var<storage, read_write> data: array<u32>;

    @compute @workgroup_size(1)
    fn main() {
      data[0] = data[0] + 1u;
    }
  `,
  bindings: [
    { binding: 0, kind: 'storage', resource: data }
  ],
  workgroupCount: [1, 1, 1]
})

compute()

const bytes = await gpu.readBuffer(data)
```

storage texture：

```ts
bindings: [
  {
    binding: 0,
    kind: 'storage-texture',
    resource: storageTexture,
    storageTextureFormat: 'rgba8unorm'
  }
]
```

indirect draw：

```ts
const indirect = gpu.buffer({
  data: new Uint32Array([3, 1, 0, 0]),
  usage: ['indirect']
})

gpu.render({ color: target }, (pass) => {
  pass.draw({
    pipeline,
    vertexBuffers: [vertices],
    indirect: { buffer: indirect },
    count: 0
  })
})
```

`dispatchIndirect`：

```ts
gpu.compute({
  code: wgsl,
  bindings,
  indirectBuffer: { buffer: indirectDispatch }
})
```

### Query

```ts
const querySet = gpu.querySet({ type: 'timestamp', count: 2 })
const queryBuffer = gpu.buffer({
  size: 16,
  usage: ['query-resolve', 'copy-src', 'copy-dst']
})

gpu.render(
  {
    color: target,
    queries: {
      timestamp: { querySet }
    }
  },
  (pass) => { ... }
)

gpu.resolveQuerySet({
  querySet,
  destination: queryBuffer
})

const timestamps = await gpu.readBuffer(queryBuffer)
```

occlusion query 使用：

```ts
queries: {
  occlusion: { querySet, index: 0 }
}
```

timestamp 需要 device feature：

```ts
const gpu = await createWEBGPU({
  features: ['timestamp-query']
})
```

### Frame transient pool

```ts
const framePool = gpu.framePool()

const temporary = framePool.buffer({
  size: 1024,
  usage: ['uniform', 'copy-dst']
})

// 本帧使用 ...

await framePool.endFrame() // 等 GPU 完成后回收
```

### Uniform buffer 子区间绑定

```ts
bindings: [
  {
    binding: 0,
    kind: 'uniform',
    resource: cameraBuffer,
    offset: 256,
    size: 16
  }
]
```

### 3D / array 回读

```ts
const slice = await gpu.readTexture(volume, { layer: 1 })
const layer = await gpu.readTexture(arrayTexture, { layer: 3 })
```

### Pipeline Cache

```ts
const a = gpu.pipeline(pipelineOptions)
const b = gpu.pipeline(pipelineOptions) // 相同配置复用
gpu.clearPipelineCache()
```

### Buffer / Texture 对象池

```ts
const pool = gpu.pool({
  maxFreeBuffers: 32,
  maxFreeTextures: 16
})

const leased = pool.buffer({
  size: 4096,
  usage: ['vertex']
})

leased.resource // GPUBufferResource
leased.retain()
leased.release()

const tex = pool.texture({
  width: 256,
  height: 256,
  data: pixels
})
tex.release()

pool.stats()
pool.destroy()
```

对象池使用显式 `refCount`：

- `retain()` 增加引用；
- `release()` 归零后才回到 free list；
- free list 超过上限会直接销毁；
- `gpu.destroy()` 会销毁所有 pool。

### Scope / Batch

```ts
gpu.batch(
  {
    color: target,
    clearColor: [0, 0, 0, 1]
  },
  (batch) => {
    batch.draw(commandA)
    batch.draw(commandB)
  }
)
```

命令式 scope：

```ts
const scope = gpu.scope({
  color: target,
  clearColor: [0, 0, 0, 1]
})

scope.draw(commandA)
scope.draw(commandB)
scope.end()
```

一个 scope / batch 对应一个 command encoder + render pass，多个 command 在其中复用同一个 pass。

当前 PoC 覆盖：

- `createGPU` / adapter / device / canvas context；
- `GPUBuffer`、`GPUTexture`、`GPUSampler`；
- WGSL render pipeline；
- vertex buffer layout；
- uniform buffer；
- bind group；
- render pass / draw / indexed draw；
- depth texture / depth-stencil pipeline；
- MSAA `sampleCount` + `resolveTarget`；
- WGSL 命令层（`gpu({...})`）；
- 2D / 2D array / 3D / cube texture；
- 3D / array / cube 异步回读；
- compute pipeline / storage buffer；
- storage texture / dispatchIndirect；
- indirect draw / drawIndexedIndirect；
- timestamp / occlusion query；
- uniform buffer subrange binding；
- pipeline cache；
- buffer / texture 对象池（显式 refCount）；
- frame transient pool；
- scope / batch（一个 render pass 内多 command）；
- `frame(callback)` 动画循环；
- 异步 `readTexture`。

`@webgpu/types` 已作为依赖提供；如果项目的 TypeScript 没有自动识别 WebGPU 全局类型，可在 `tsconfig.json` 中加：

```json
{
  "compilerOptions": {
    "types": ["@webgpu/types"]
  }
}
```

当前不覆盖：

- GLSL → WGSL 转译；
- 自动 shader 反射 / 自动 bind group 布局；
- 自动 GC / 隐式跨帧资源回收（frame pool 需要显式 `await endFrame()`）；
- 完整的 regl 全局状态 scoping（WebGPU 无全局状态）。

因此这是 **WebGPU-first PoC**，不是“把 regl 换成 WebGPU”。

模块拆分：

```text
src/webgpu/
  index.ts       对外导出 createWEBGPU / createGPU
  context.ts     设备、canvas、资源 API 组装
  buffer.ts      GPUBuffer 资源
  texture.ts     GPUTexture 与上传
  sampler.ts     GPUSampler
  pipeline.ts    render pipeline / bind group
  render.ts      render pass 录制
  readback.ts    copyTextureToBuffer + mapAsync
  util.ts        usage / format / 资源判断
  types.ts       公共类型
```

---

## FPS 示例

两个完整的第一人称射击示例共享同一套游戏逻辑 [examples/fps-game.js](examples/fps-game.js)：

- [fps-webgl2.html](examples/fps-webgl2.html)
  - WebGL2
  - 实例化立方体场景
  - depth test / 动态光照 / 第一人称武器
- [fps-webgpu.html](examples/fps-webgpu.html)
  - WebGPU
  - storage buffer instancing
  - WGSL 光照 / depth24plus

玩法：

- 点击画面开始 / 锁定鼠标
- `WASD` 移动，`Shift` 加速
- 鼠标瞄准
- 左键射击
- `R` 换弹
- `Space` 跳跃
- 击杀 6 个敌方无人机，敌人靠近会反击

共享逻辑包含：

- 第一人称相机与移动
- 射击 ray-sphere 命中检测
- 敌人巡航 / 攻击 / 重生
- 计分、生命值、弹药、HUD
- tracer、muzzle flash、受击反馈

---

## API 兼容性

### 初始化

`createREGL` 支持与 regl 相同的参数：

- `gl` / `canvas` / `container`
- `attributes`（`getContext` 属性）
- `extensions` / `optionalExtensions`
- `pixelRatio` / `profile` / `onDone`

新增：

- `version: 1 | 2 | 'webgl1' | 'webgl2' | 'auto'`，默认 `'auto'`。

> 注意：旧版 regl 默认优先 WebGL1；regl-next 默认优先 WebGL2。需要与旧行为完全一致时传入
> `version: 'webgl1'`。

### 命令

支持 regl 的完整状态选项与写法，包括嵌套写法与扁平写法：

- `blend` / `depth` / `cull` / `stencil` / `polygonOffset` / `sample` / `scissor` / `viewport`
- `blend.enable`、`blend.func`、`depth.func`、`stencil.opFront` 等扁平键
- `stencil.op` 会同时设置 `opFront` 与 `opBack`
- `attributes` / `uniforms` / `uniformBlocks` / `context` / `elements` / `count` / `offset` / `instances` / `primitive` / `vao`
- `profile`
- `regl.prop` / `regl.context` / `regl.this`
- 动态函数 `(context, props, batchId) => value`
- 嵌套动态对象，例如 `blend: regl.prop('blend')`
- 数组中的动态元素

### 资源

- `regl.buffer`、`regl.elements`、`regl.texture`、`regl.texture3D`、`regl.texture2DArray`、`regl.cube`、
  `regl.renderbuffer`、`regl.framebuffer`、`regl.framebufferCube`、`regl.vao`、
  `regl.uniformBuffer`、`regl.sampler`
- 资源都支持重新调用更新、`subdata` / `subimage` / `resize` / `destroy`
- `regl.read`、`regl.clear`、`regl.frame`、`regl.on`、`regl.now`、`regl.poll`、
  `regl._refresh`、`regl._gl`、`regl.limits`、`regl.stats`

---

## 与旧版 regl 的主要差异

| 主题 | 旧版 regl | regl-next |
| --- | --- | --- |
| 绘制代码 | 运行时 `new Function` 生成 JS | 编译期「求值器 + 绘制计划」，无 eval |
| 状态管理 | `currentState` / `nextState` + dirty 标志 | 立即提交 + 值缓存 + `invalidate()` |
| WebGL2 | 通过 WebGL1 扩展模拟，部分能力缺失 | 原生 VAO / instancing / drawBuffers / uint32 索引 |
| 扩展名 | 只认 WebGL 扩展 | WebGL2 核心能力会以旧扩展名返回 `true` |
| 纹理格式 | 固定的 WebGL1 格式表 | 统一的格式表，自动裁剪 WebGL1 / WebGL2 可用格式 |
| 上下文恢复 | 大多数 buffer 只重建空存储 | **与旧版保持一致**：只有内联 attribute / VAO 数据保存副本 |
| TypeScript | 外部 `regl.d.ts` | 源码即类型，泛型 Props / Context |
| 默认上下文 | 优先 WebGL1 | 优先 WebGL2（可用 `version` 强制） |
| 状态作用域 | framebuffer / scope uniform 等状态会泄漏到作用域外 | framebuffer、context、scope uniform/attribute/绘制参数在 scope 结束后恢复，更接近词法作用域 |
| clear/read | 会推进 `tick` / `time` | 不推进；只有 `frame` / `poll` 推进 |

> 如果确实需要旧版的状态泄漏行为，可以在 scope 外部重新设置对应的状态/资源。

### 缓冲区恢复说明

为保持与旧版行为一致：

- `regl.buffer(data)` 创建的普通 buffer **不会**保存数据副本；上下文丢失后只重建空存储。
- 只有编译命令时内联在 `attributes` / VAO 中的数据会保存一份字节副本用于恢复。
- `regl.elements` 的索引数据也会在上下文丢失后重建为空存储。

如果需要完全恢复普通 buffer，请在 `restore` 事件中重新上传数据：

```ts
regl.on('restore', () => {
  position(subdata)
})
```

---

## WebGL2 能力

在 WebGL2 上下文中额外支持：

- 原生 VAO（无需 `OES_vertex_array_object`）
- 原生实例化（无需 `ANGLE_instanced_arrays`）
- 原生 MRT（无需 `WEBGL_draw_buffers`）
- Uniform Buffer（UBO），支持 block 反射布局、成员级更新和结构化值自动打包
- Sampler Object，支持 `min/mag/wrap/compare/LOD/anisotropic`
- 3D / 2D Array 纹理、`texImage3D`、`subimage`、FBO layer 附件
- MSAA render target / `blitFramebuffer` resolve
- 整数顶点属性（`ivec` / `uvec` / `vertexAttribIPointer`）
- MRT 单附件读取 / 清除
- PBO 异步回读 / 2D 纹理 PBO 上传 / buffer copy
- 32 位索引（无需 `OES_element_index_uint`）
- 浮点 / 半浮点纹理与渲染目标（配合 `EXT_color_buffer_float`）
- `sRGB` 纹理、深度纹理、整数纹理
- 尺寸内部格式：`r8`、`rg8`、`rgba8`、`r16f`、`rgba16f`、`r32f`、`rgba32f`、
  `rgba8ui`、`rgba16ui`、`rgba32ui`、`depth16/24/32f`、`depth24 stencil8` 等
- 更多压缩格式：ETC2/EAC（核心）、ASTC / BPTC / S3TC（扩展）
- `regl.limits` 中新增 `isWebGL2`、`max3DTextureSize`、`maxArrayTextureLayers`、
  `maxSamples`、`maxElementIndex`、`maxUniformBlockSize` 等字段

示例：

```ts
const regl = createREGL({ version: 2 })

const color0 = regl.texture({ width: 512, height: 512, format: 'rgba8' })
const color1 = regl.texture({ width: 512, height: 512, format: 'rgba16f', type: 'float16' })

const fbo = regl.framebuffer({
  colors: [color0, color1],
  depth: true,
  stencil: false
})

const drawMRT = regl({
  framebuffer: fbo,
  vert: /* glsl 300 es */,
  frag: /* layout(location = 0/1) out ... */,
  count: 3
})
```

---

## 设计说明

源码结构：

```
src/
  index.ts                 公共入口
  types.ts                 公共类型
  core/
    regl.ts                实例组装、frame/clear/read/事件/上下文恢复
    command.ts             命令编译与执行（draw / batch / scope）
    dynamic.ts             动态变量与求值器
    state.ts               WebGL 状态缓存
    shader.ts              shader 编译、program 缓存、uniform 反射
    capabilities.ts        扩展 / WebGL2 能力探测
    limits.ts              设备限制
    timer.ts               GPU 计时器
    webgl.ts               上下文 / 画布创建
    attribute.ts           顶点属性记录解析
  resources/
    buffer.ts              buffer
    elements.ts            索引缓冲
    texture.ts             2D / cube / 3D / 2D array 纹理
    renderbuffer.ts        renderbuffer
    framebuffer.ts         framebuffer / framebufferCube
    vao.ts                 VAO
    uniformbuffer.ts      WebGL2 UBO（反射布局 / 成员更新 / 结构化打包）
    sampler.ts            WebGL2 sampler object
  util/
    check.ts               错误检查
    constants.ts           GL 常量与名称映射
    data.ts                数组展平 / ndarray / half float
```

### 1. 不再生成代码

旧版 regl 会把每条命令编译成一段 JavaScript 字符串，再用 `new Function` 执行。regl-next 改成：

- 编译期把每个选项编译成 `CompiledValue`（闭包求值器）；
- 运行期按「绘制计划」依次提交状态、属性、uniform；
- 静态值直接缓存，动态值只执行闭包。

这带来 CSP 兼容性、可调试性和可维护性，代价是比极致手写代码生成多一些函数调用开销。
对于绝大多数 WebGL 应用，GPU / 驱动提交仍是主要开销。

### 2. 状态缓存

`GLStateCache` 记录已知的 GL 状态值，提交前比较，相同则跳过。命令只提交自己声明的状态，
未声明的状态保持原样（与 regl 语义一致）。外部直接操作 `_gl` 后调用 `regl._refresh()`
可以强制失效缓存。

### 3. 纹理格式表

所有纹理格式集中在 `buildFormatTables` 中描述，按上下文能力裁剪：

- 名称、内部格式、外部格式、通道数、默认类型、每像素字节数；
- WebGL1 扩展格式（float / half float / depth / sRGB / 压缩）；
- WebGL2 尺寸格式与整数格式；
- `regl.limits.textureFormats` 自动反映当前上下文可用格式。

### 4. 上下文恢复

- shader / program 原地重建，命令持有的 `ProgramInfo` 引用继续有效；
  命令计划在下次绘制时按名称刷新 uniform / attribute location。
- buffer / texture / renderbuffer / framebuffer / VAO 重新创建。
- 纹理尽量使用保存的像素描述重新上传；内联 attribute / VAO 数据保存副本。
- 普通 buffer 与索引 buffer 按旧版行为只重建空存储。

---

## 性能建议

- 复用命令与资源，不要在 `frame` 回调里创建。
- 大量相似物体优先使用 batch 模式（`draw([...])`）或实例化。
- 静态属性使用 `regl.vao(...)` 或命令的 `vao` 选项。
- 避免每帧传入新的普通数组；使用 TypedArray 或资源。
- 大量动态数据用 `subdata` 更新，而不是重新创建 buffer。
- 使用 `profile: true` 与 `regl.stats` 观察 CPU 时间与显存占用。

---

## 已知限制

- 不支持 transform feedback。
- UBO block 内不能包含 sampler，也不自动改写 GLSL；
- 结构化 UBO 的自动缓冲区由命令私有，跨命令共享请使用显式 `regl.uniformBuffer`。
- 不自动改写 GLSL；WebGL2 的 `#version 300 es`、`in/out`、`layout(location=...)` 需用户自行编写。
- `texture.copy` 在部分驱动上从 `alpha: false` 的默认 framebuffer 复制 RGBA 可能失败
  （SwiftShader 上可复现）；建议使用 `alpha: true` 上下文。
- 异步图片加载未做自动重传；请在图片 `onload` 后调用 `texture(...)` 或 `subimage`。
- 未实现多重采样渲染目标。

---

## 测试

`test/browser/tests.js` + `test/browser/ubo-tests.js` + `test/browser/sampler-tests.js` + `test/browser/texture-3d-tests.js` + `test/browser/msaa-tests.js` + `test/browser/integer-attribute-tests.js` + `test/browser/mrt-read-tests.js` + `test/browser/pbo-tests.js` 覆盖 109 个真实 WebGL1/WebGL2 场景，包括：

- 三角形、uniform 类型、矩阵、动态变量、batch、scope
- elements / offset / subdata / 动态索引 / 32 位索引
- 2D / cube 纹理、subimage、resize、mipmap、copy、浮点 / 整数 / r8 格式
- 3D / 2D array 纹理、subimage、mipmap、sampler3D、FBO layer 附件
- MSAA renderbuffer / framebuffer、blit resolve、WebGL1 报错
- 整数顶点属性（Int32Array / uint8 / VAO integer pointer）
- MRT readBuffer / clearBuffer 单附件与多附件
- PBO 回读、PBO 纹理上传、copyBufferSubData、getBufferSubData
- framebuffer / MRT / 深度纹理 / 浮点读取 / cube framebuffer / resize / use / clear
- UBO / uniform block 反射 / 成员更新 / 数组 stride / 范围绑定 / scope / batch / WebGL1 报错
- Phase 2 结构化 UBO / 静态缓存 / 动态差量 / 嵌套结构体数组 / 混合 Phase 1 / 上下文恢复
- Sampler object / nearest vs linear / sampler 解绑 / 参数更新 / destroy / cube / shadow compare / 上下文恢复
- VAO、WebGL1 ANGLE 实例化、WebGL2 原生实例化
- depth / blend / scissor / clear
- 上下文丢失与恢复（含纹理、FBO）
- 初始化、统计、销毁、profile

WebGPU PoC 测试（27 个场景）：

```bash
npm run test:webgpu
```

覆盖：

- 主入口 `createREGL` / `createWEBGPU` 导出
- GPUDevice / texture 清屏与异步回读
- WGSL pipeline + bind group + 纹理采样
- uniform buffer 写入与重绘
- depth24plus 深度测试
- indexed draw
- MSAA sampleCount 4 + resolveTarget
- frame 动画循环
- WGSL 命令层 `gpu({...})` / uniform buffer / texture / sampler bind group
- 命令层 index buffer / instancing
- 3D texture / 2D array texture / cube texture 采样
- 3D / array / cube 异步回读
- uniform buffer subrange binding
- compute storage buffer
- pipeline cache
- buffer pool refCount / reuse
- texture pool reuse / upload
- scope / batch
- indirect draw / indexed indirect draw / dispatchIndirect
- timestamp query / occlusion query
- compute storage texture
- frame pool
- multiple bind groups + dynamic offset

测试使用 Chrome + SwiftShader Vulkan；如果当前环境没有 WebGPU adapter，会明确跳过。

```bash
npm run build
npm run test:browser        # 开发版
node test/browser/run.mjs --prod  # 生产版
npm run test:webgpu
```

---

## License

MIT。API 设计与语义参考了 [regl](https://github.com/regl-project/regl)（MIT License）。
