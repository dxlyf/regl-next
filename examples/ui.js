/* 所有示例共用的错误提示与“已启动”标记。 */
(function () {
  'use strict'

  function showExampleError (error) {
    var message = error && error.stack ? error.stack : String(error)
    console.error(error)
    var existing = document.getElementById('example-error')
    if (existing) existing.remove()
    var pre = document.createElement('pre')
    pre.id = 'example-error'
    pre.className = 'error'
    pre.textContent = message
    document.body.appendChild(pre)
  }

  window.showExampleError = showExampleError
  window.markExampleReady = function () {
    window.__exampleReady = true
  }

  window.addEventListener('error', function (event) {
    showExampleError(event.error || event.message || 'unknown error')
  })
  window.addEventListener('unhandledrejection', function (event) {
    showExampleError(event.reason || 'unhandled rejection')
  })
})()
