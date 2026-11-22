/* 示例用的极简 4x4 矩阵工具（column-major，和 WebGL 一致）。 */
(function (global) {
  'use strict'

  function identity (out) {
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0
    out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0
    out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1
    return out
  }

  function perspective (out, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2)
    var nf = 1 / (near - far)
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1
    out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0
    return out
  }

  function lookAt (out, eye, center, up) {
    var z0 = eye[0] - center[0]
    var z1 = eye[1] - center[1]
    var z2 = eye[2] - center[2]
    var len = Math.hypot(z0, z1, z2) || 1
    z0 /= len; z1 /= len; z2 /= len

    var x0 = up[1] * z2 - up[2] * z1
    var x1 = up[2] * z0 - up[0] * z2
    var x2 = up[0] * z1 - up[1] * z0
    len = Math.hypot(x0, x1, x2) || 1
    x0 /= len; x1 /= len; x2 /= len

    var y0 = z1 * x2 - z2 * x1
    var y1 = z2 * x0 - z0 * x2
    var y2 = z0 * x1 - z1 * x0

    out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0
    out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0
    out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0
    out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2])
    out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2])
    out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2])
    out[15] = 1
    return out
  }

  function multiply (out, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3]
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7]
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11]
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15]

    for (var c = 0; c < 4; ++c) {
      var b0 = b[c * 4]
      var b1 = b[c * 4 + 1]
      var b2 = b[c * 4 + 2]
      var b3 = b[c * 4 + 3]
      out[c * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3
      out[c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3
      out[c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3
      out[c * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3
    }
    return out
  }

  function rotationX (out, rad) {
    var c = Math.cos(rad)
    var s = Math.sin(rad)
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0
    out[4] = 0; out[5] = c; out[6] = s; out[7] = 0
    out[8] = 0; out[9] = -s; out[10] = c; out[11] = 0
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1
    return out
  }

  function rotationY (out, rad) {
    var c = Math.cos(rad)
    var s = Math.sin(rad)
    out[0] = c; out[1] = 0; out[2] = -s; out[3] = 0
    out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0
    out[8] = s; out[9] = 0; out[10] = c; out[11] = 0
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1
    return out
  }

  function translation (out, x, y, z) {
    identity(out)
    out[12] = x
    out[13] = y
    out[14] = z
    return out
  }

  function scaling (out, x, y, z) {
    identity(out)
    out[0] = x
    out[5] = y
    out[10] = z
    return out
  }

  global.M4 = {
    identity: identity,
    perspective: perspective,
    lookAt: lookAt,
    multiply: multiply,
    rotationX: rotationX,
    rotationY: rotationY,
    translation: translation,
    scaling: scaling
  }
})(window)
