/**
 * 閺嬪嫬缂撻懘姘拱閿涙氨鏁?esbuild 閻㈢喐鍨?ESM / CJS / IIFE 娑撳顫掓禍褏澧块妴? *
 * - dist/regl-next.js    ESM
 * - dist/regl-next.cjs   CommonJS
 * - dist/regl-next.min.js IIFE閿涘牆鍙忕仦鈧?createREGL閿涘苯褰查惄瀛樺复閻?<script> 瀵洖鍙嗛敍? *
 * 缁鐎锋竟鐗堟閻?`tsc -p tsconfig.build.json` 閻㈢喐鍨氶崚?dist/types/閵? */

import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

await mkdir('dist', { recursive: true })

const common = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  sourcemap: true,
  target: ['es2020'],
  logLevel: 'info',
  define: {
    // 閻㈢喍楠囬弸鍕紦閸忔娊妫撮弰鍌濆惞閺傤叀鈻堥敍娑滅殶鐠囨洘鐎鍝勫讲娴犮儴顔曟稉?true
    __REGL_DEV__: 'false'
  }
}

await Promise.all([
  build({
    ...common,
    format: 'esm',
    outfile: 'dist/regl-next.js'
  }),
  build({
    ...common,
    format: 'cjs',
    outfile: 'dist/regl-next.cjs'
  }),
  build({
    ...common,
    format: 'iife',
    globalName: 'REGLNext',
    outfile: 'dist/regl-next.iife.js',
    footer: {
      js: 'window.createREGL = REGLNext.createREGL; window.createWEBGPU = REGLNext.createWEBGPU; window.createGPU = REGLNext.createGPU; window.reglNext = REGLNext;'
    }
  }),
  build({
    ...common,
    define: { __REGL_DEV__: 'true' },
    format: 'iife',
    globalName: 'REGLNext',
    outfile: 'dist/regl-next.dev.js',
    footer: {
      js: 'window.createREGL = REGLNext.createREGL; window.createWEBGPU = REGLNext.createWEBGPU; window.createGPU = REGLNext.createGPU; window.reglNext = REGLNext;'
    }
  }),
  build({
    ...common,
    format: 'iife',
    globalName: 'REGLNext',
    minify: true,
    outfile: 'dist/regl-next.min.js',
    footer: {
      js: 'window.createREGL = REGLNext.createREGL; window.createWEBGPU = REGLNext.createWEBGPU; window.createGPU = REGLNext.createGPU;'
    }
  }),
  build({
    ...common,
    entryPoints: ['src/webgpu/index.ts'],
    format: 'esm',
    outfile: 'dist/regl-next-webgpu.js'
  }),
  build({
    ...common,
    entryPoints: ['src/webgpu/index.ts'],
    format: 'cjs',
    outfile: 'dist/regl-next-webgpu.cjs'
  }),
  build({
    ...common,
    entryPoints: ['src/webgpu/index.ts'],
    format: 'iife',
    globalName: 'REGLNextWebGPU',
    outfile: 'dist/regl-next-webgpu.iife.js',
    footer: {
      js: 'window.createWEBGPU = REGLNextWebGPU.createWEBGPU; window.createGPU = REGLNextWebGPU.createGPU; window.reglNextWebGPU = REGLNextWebGPU;'
    }
  })
])
