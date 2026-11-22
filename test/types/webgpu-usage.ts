import { createWEBGPU } from '../../src'
import type {
  GPUBufferResource,
  GPUPass,
  GPUPipelineResource,
  GPUTextureResource,
  WEBGPU
} from '../../src/webgpu'

async function typeUsage (): Promise<void> {
  const gpu: WEBGPU = await createWEBGPU()
  const texture: GPUTextureResource = gpu.texture({
    width: 4,
    height: 4,
    data: new Uint8Array(64)
  })
  const depth: GPUTextureResource = gpu.texture({
    width: 4,
    height: 4,
    format: 'depth24plus',
    usage: ['render-attachment']
  })
  const msaa: GPUTextureResource = gpu.texture({
    width: 4,
    height: 4,
    sampleCount: 4,
    usage: ['render-attachment']
  })
  const volume: GPUTextureResource = gpu.texture({
    width: 4,
    height: 4,
    depth: 2,
    dimension: '3d',
    data: new Uint8Array(4 * 4 * 2 * 4)
  })
  const layers: GPUTextureResource = gpu.texture({
    width: 4,
    height: 4,
    layers: 2,
    data: new Uint8Array(4 * 4 * 2 * 4)
  })
  const cube: GPUTextureResource = gpu.texture({
    width: 2,
    height: 2,
    faces: [
      new Uint8Array(16),
      new Uint8Array(16),
      new Uint8Array(16),
      new Uint8Array(16),
      new Uint8Array(16),
      new Uint8Array(16)
    ]
  })
  const layerView = layers.layerView(1)
  const storageBuffer: GPUBufferResource = gpu.buffer({
    data: new Uint32Array([0]),
    usage: ['storage', 'copy-src', 'copy-dst']
  })
  const compute = gpu.compute({
    code: '/* wgsl */',
    bindings: [
      { binding: 0, kind: 'storage', resource: storageBuffer }
    ],
    workgroupCount: [1, 1, 1]
  })
  compute()
  const storageBytes: Promise<Uint8Array> = gpu.readBuffer(storageBuffer)
  gpu.clearPipelineCache()
  const slice: Promise<Uint8Array> = gpu.readTexture(volume, { layer: 0 })
  void storageBytes
  void slice
  void volume
  void cube
  void layerView
  const buffer: GPUBufferResource = gpu.buffer({
    data: new Float32Array([0, 0, 0, 1]),
    usage: ['uniform']
  })
  const pipeline: GPUPipelineResource = gpu.pipeline({
    code: '/* wgsl */',
    attributes: [{ format: 'float32x2', stride: 8 }],
    bindings: [{ binding: 0, kind: 'uniform' }]
  })
  const bindGroup = gpu.bindGroup(pipeline, [
    { binding: 0, resource: buffer }
  ])
  gpu.render({ clearColor: [0, 0, 0, 1] }, (pass) => {
    pass.draw({
      pipeline,
      bindGroup,
      vertexBuffers: [buffer],
      count: 3
    })
  })
  gpu.render(
    {
      color: msaa,
      resolve: texture,
      depth: depth,
      clearColor: [0, 0, 0, 1],
      clearDepth: 1
    },
    (pass) => {
      pass.draw({
        pipeline,
        bindGroup,
        vertexBuffers: [buffer],
        count: 3
      })
    }
  )
  const pixels: Uint8Array = await gpu.readTexture(texture)
  const command = gpu({
    code: '/* wgsl */',
    attributes: {
      position: {
        data: new Float32Array([0, 0, 1, 0, 0, 1]),
        size: 2
      }
    },
    bindings: [
      {
        binding: 0,
        group: 0,
        kind: 'uniform',
        resource: buffer,
        size: 16,
        dynamicOffset: true
      },
      {
        binding: 0,
        group: 1,
        kind: 'texture',
        resource: texture,
        viewDimension: '2d'
      }
    ],
    indexBuffer: {
      buffer: buffer,
      format: 'uint16'
    },
    count: 3,
    instances: 2
  })
  command.draw({} as GPUPass, { dynamicOffsets: { 0: [256] } })
  gpu.bindGroup(pipeline, [
    { binding: 0, resource: buffer, group: 1 }
  ], 1)
  void command.pipeline
  gpu.command({ code: '/* wgsl */', count: 3 })
  const pool = gpu.pool({ maxFreeBuffers: 4 })
  const leased = pool.buffer({ size: 64, usage: ['vertex'] })
  leased.retain()
  leased.release()
  const scope = gpu.scope({})
  scope.draw(command)
  scope.end()
  gpu.batch({}, (batch) => {
    batch.draw(command)
  })
  const indirect = gpu.buffer({
    data: new Uint32Array([3, 1, 0, 0]),
    usage: ['indirect']
  })
  const indirectCommand = gpu({
    code: '/* wgsl */',
    indirectBuffer: { buffer: indirect },
    count: 0
  })
  gpu.render({}, (pass) => {
    pass.draw({
      pipeline,
      vertexBuffers: [buffer],
      indirect: { buffer: indirect },
      count: 0
    })
    void indirectCommand
  })
  const querySet = gpu.querySet({ type: 'timestamp', count: 2 })
  gpu.render(
    {
      queries: {
        timestamp: { querySet }
      }
    },
    () => {}
  )
  gpu.resolveQuerySet({ querySet, destination: buffer })
  const storageTexture = gpu.texture({
    width: 4,
    height: 4,
    usage: ['storage-binding', 'copy-src']
  })
  gpu.compute({
    code: '/* wgsl */',
    bindings: [
      {
        binding: 0,
        kind: 'storage-texture',
        resource: storageTexture,
        storageTextureFormat: 'rgba8unorm'
      }
    ],
    indirectBuffer: { buffer: indirect }
  })
  const framePool = gpu.framePool()
  const frameLease = framePool.buffer({ size: 64, usage: ['vertex'] })
  void frameLease
  await framePool.endFrame()
  framePool.destroy()
  const frame = gpu.frame((info) => {
    void info.time
    void info.width
  })
  frame.cancel()
  void pixels
}

void typeUsage
