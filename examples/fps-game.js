/* FPS demo shared game logic: input, camera, enemies, shooting, HUD, scene data. */
(function (global) {
  'use strict'

  var M4 = global.M4
  var MAX_INSTANCES = 128

  function clamp (x, a, b) {
    return Math.max(a, Math.min(b, x))
  }

  function add (a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  }

  function sub (a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  }

  function scale (a, s) {
    return [a[0] * s, a[1] * s, a[2] * s]
  }

  function dot (a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  }

  function cross (a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ]
  }

  function normalize (a) {
    var len = Math.hypot(a[0], a[1], a[2]) || 1
    return [a[0] / len, a[1] / len, a[2] / len]
  }

  function compose (pos, yaw, sx, sy, sz) {
    var out = new Float32Array(16)
    var c = Math.cos(yaw)
    var s = Math.sin(yaw)
    out[0] = c * sx; out[1] = 0; out[2] = -s * sx; out[3] = 0
    out[4] = 0; out[5] = sy; out[6] = 0; out[7] = 0
    out[8] = s * sz; out[9] = 0; out[10] = c * sz; out[11] = 0
    out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2]; out[15] = 1
    return out
  }

  function basisModel (pos, right, up, forward, sx, sy, sz) {
    var out = new Float32Array(16)
    out[0] = right[0] * sx; out[1] = right[1] * sx; out[2] = right[2] * sx; out[3] = 0
    out[4] = up[0] * sy; out[5] = up[1] * sy; out[6] = up[2] * sy; out[7] = 0
    out[8] = forward[0] * sz; out[9] = forward[1] * sz; out[10] = forward[2] * sz; out[11] = 0
    out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2]; out[15] = 1
    return out
  }

  function basisModelLine (start, end, thickness) {
    var dir = normalize(sub(end, start))
    var right = normalize(cross(dir, [0, 1, 0]))
    var up = cross(right, dir)
    var mid = scale(add(start, end), 0.5)
    var len = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])
    return basisModel(mid, right, up, dir, thickness, thickness, len)
  }

  function createGame (canvas) {
    var state = {
      pos: [0, 1.7, 8],
      yaw: 0,
      pitch: -0.02,
      vy: 0,
      onGround: true,
      keys: {},
      locked: false,
      started: false,
      looking: false,
      fallbackLook: false,
      health: 100,
      maxHealth: 100,
      ammo: 30,
      magSize: 30,
      score: 0,
      kills: 0,
      time: 0,
      fireCooldown: 0,
      reloadTimer: 0,
      muzzleFlash: 0,
      tracer: null,
      hitFlash: 0,
      damageFlash: 0,
      lastDamage: -99,
      instances: [],
      viewProj: new Float32Array(16),
      camera: [0, 0, 0],
      forward: [0, 0, -1],
      muzzle: [0, 0, 0]
    }

    var obstacles = [
      { x: -5, z: -5, r: 1.2 },
      { x: 5, z: -5, r: 1.2 },
      { x: -5, z: 5, r: 1.2 },
      { x: 5, z: 5, r: 1.2 },
      { x: -7.5, z: -1.5, r: 0.9 },
      { x: 7.5, z: 1.5, r: 0.9 }
    ]

    var enemies = [
      { base: [-6.5, 1.8, -6.5], phase: 0.2, speed: 0.7, health: 3, alive: true, respawn: 0, attack: 0 },
      { base: [6.5, 1.6, -5.5], phase: 1.8, speed: 0.9, health: 3, alive: true, respawn: 0, attack: 0.8 },
      { base: [-6.5, 2.0, 5.0], phase: 3.0, speed: 0.6, health: 3, alive: true, respawn: 0, attack: 1.6 },
      { base: [6.2, 2.1, 5.5], phase: 4.2, speed: 0.8, health: 3, alive: true, respawn: 0, attack: 2.4 },
      { base: [0, 2.4, -7.8], phase: 2.2, speed: 1.0, health: 3, alive: true, respawn: 0, attack: 3.1 },
      { base: [0, 1.5, 7.5], phase: 5.1, speed: 0.7, health: 3, alive: true, respawn: 0, attack: 4.0 }
    ]

    var overlay = document.getElementById('fps-start')
    var hudScore = document.getElementById('hud-score')
    var hudHealth = document.getElementById('hud-health')
    var hudHealthBar = document.getElementById('hud-health-bar')
    var hudAmmo = document.getElementById('hud-ammo')
    var hudEnemies = document.getElementById('hud-enemies')
    var hudMessage = document.getElementById('hud-message')
    var hudDamage = document.getElementById('hud-damage')
    var crosshair = document.getElementById('crosshair')

    function updateHud () {
      var alive = 0
      for (var i = 0; i < enemies.length; ++i) if (enemies[i].alive) alive++
      if (hudScore) hudScore.textContent = String(state.score).padStart(5, '0')
      if (hudHealth) hudHealth.textContent = String(Math.max(0, Math.ceil(state.health)))
      if (hudHealthBar) hudHealthBar.style.width = Math.max(0, state.health) + '%'
      if (hudAmmo) hudAmmo.textContent = state.reloadTimer > 0 ? '--' : String(state.ammo).padStart(2, '0')
      if (hudEnemies) hudEnemies.textContent = alive + ' / ' + enemies.length
      if (hudMessage) {
        hudMessage.textContent =
          state.reloadTimer > 0
            ? 'RELOADING...'
            : state.health < 35
              ? 'WARNING: CRITICAL'
              : state.started && !state.locked
                ? 'RIGHT-DRAG TO LOOK · CLICK TO LOCK MOUSE · WASD MOVE'
                : 'WASD MOVE · MOUSE AIM · CLICK FIRE · R RELOAD'
      }
      if (hudDamage) {
        hudDamage.style.opacity = String(
          Math.max(0, Math.min(1, state.damageFlash)) * 0.8
        )
      }
      if (crosshair) {
        crosshair.classList.toggle('hot', state.hitFlash > 0)
      }
      if (overlay) {
        overlay.classList.toggle('hidden', state.started)
      }
    }

    function startGame () {
      state.started = true
      updateHud()
      try {
        const result = canvas.requestPointerLock && canvas.requestPointerLock()
        if (result && typeof result.catch === 'function') {
          result.catch(function () {
            state.fallbackLook = true
            updateHud()
          })
        }
      } catch (error) {
        state.fallbackLook = true
        updateHud()
      }
      // 某些环境（iframe / 权限限制）不会触发 pointerlockchange。
      // 此时启用右键拖拽视角作为 fallback，避免鼠标到达屏幕边缘后视角停止。
      window.setTimeout(function () {
        if (!state.locked) {
          state.fallbackLook = true
          updateHud()
        }
      }, 350)
    }

    function cameraBasis () {
      var cp = Math.cos(state.pitch)
      var forward = normalize([
        Math.sin(state.yaw) * cp,
        Math.sin(state.pitch),
        -Math.cos(state.yaw) * cp
      ])
      var right = normalize(cross(forward, [0, 1, 0]))
      var up = normalize(cross(right, forward))
      return { forward: forward, right: right, up: up }
    }

    function shoot () {
      if (!state.started) return
      if (state.reloadTimer > 0 || state.fireCooldown > 0) return
      if (state.ammo <= 0) {
        reload()
        return
      }
      state.ammo--
      state.fireCooldown = 0.11
      state.muzzleFlash = 0.055
      var basis = cameraBasis()
      var origin = state.pos
      var dir = basis.forward
      var best = null
      var bestT = Infinity
      for (var i = 0; i < enemies.length; ++i) {
        var e = enemies[i]
        if (!e.alive) continue
        var c = enemyPosition(e)
        var oc = sub(c, origin)
        var tca = dot(oc, dir)
        if (tca <= 0) continue
        var d2 = dot(oc, oc) - tca * tca
        var radius = 0.65
        if (d2 > radius * radius) continue
        var thc = Math.sqrt(radius * radius - d2)
        var t = tca - thc
        if (t > 0 && t < bestT) {
          bestT = t
          best = e
        }
      }
      var end = add(origin, scale(dir, best ? bestT : 30))
      state.tracer = { start: state.muzzle, end: end, life: 0.07 }
      if (best) {
        best.health--
        state.hitFlash = 0.12
        state.score += 25
        if (best.health <= 0) {
          best.alive = false
          best.respawn = 2.2
          state.kills++
          state.score += 100
        }
      }
      updateHud()
    }

    function reload () {
      if (state.reloadTimer > 0 || state.ammo === state.magSize) return
      state.reloadTimer = 1.1
    }

    function enemyPosition (e) {
      var t = state.time * e.speed + e.phase
      return [
        e.base[0] + Math.sin(t) * 1.7,
        e.base[1] + Math.sin(t * 1.7) * 0.35,
        e.base[2] + Math.cos(t * 1.25) * 1.7
      ]
    }

    function update (dt) {
      dt = Math.min(0.05, Math.max(0, dt))
      state.time += dt
      state.fireCooldown = Math.max(0, state.fireCooldown - dt)
      state.muzzleFlash = Math.max(0, state.muzzleFlash - dt)
      state.hitFlash = Math.max(0, state.hitFlash - dt)
      state.damageFlash = Math.max(0, state.damageFlash - dt)
      if (state.tracer) {
        state.tracer.life -= dt
        if (state.tracer.life <= 0) state.tracer = null
      }
      if (state.reloadTimer > 0) {
        state.reloadTimer -= dt
        if (state.reloadTimer <= 0) {
          state.reloadTimer = 0
          state.ammo = state.magSize
        }
      }

      var speed = state.keys.ShiftLeft || state.keys.ShiftRight ? 7.2 : 4.5
      var moveX = 0
      var moveZ = 0
      if (state.keys.KeyW) moveZ += 1
      if (state.keys.KeyS) moveZ -= 1
      if (state.keys.KeyA) moveX -= 1
      if (state.keys.KeyD) moveX += 1
      var len = Math.hypot(moveX, moveZ)
      if (len > 0) {
        moveX /= len
        moveZ /= len
        var fx = Math.sin(state.yaw)
        var fz = -Math.cos(state.yaw)
        var rx = Math.cos(state.yaw)
        var rz = Math.sin(state.yaw)
        state.pos[0] += (fx * moveZ + rx * moveX) * speed * dt
        state.pos[2] += (fz * moveZ + rz * moveX) * speed * dt
      }
      state.pos[0] = clamp(state.pos[0], -9.2, 9.2)
      state.pos[2] = clamp(state.pos[2], -9.2, 9.2)

      for (var i = 0; i < obstacles.length; ++i) {
        var o = obstacles[i]
        var dx = state.pos[0] - o.x
        var dz = state.pos[2] - o.z
        var dist = Math.hypot(dx, dz)
        var min = o.r + 0.35
        if (dist < min && dist > 0.0001) {
          state.pos[0] = o.x + (dx / dist) * min
          state.pos[2] = o.z + (dz / dist) * min
        }
      }

      if (state.keys.Space && state.onGround) {
        state.vy = 5.2
        state.onGround = false
      }
      state.vy -= 14 * dt
      state.pos[1] += state.vy * dt
      if (state.pos[1] <= 1.7) {
        state.pos[1] = 1.7
        state.vy = 0
        state.onGround = true
      }

      for (var e = 0; e < enemies.length; ++e) {
        var enemy = enemies[e]
        if (!enemy.alive) {
          enemy.respawn -= dt
          if (enemy.respawn <= 0) {
            enemy.alive = true
            enemy.health = 3
            enemy.attack = 0.8
          }
          continue
        }
        enemy.attack -= dt
        var ep = enemyPosition(enemy)
        var distToPlayer = Math.hypot(
          ep[0] - state.pos[0],
          ep[1] - state.pos[1],
          ep[2] - state.pos[2]
        )
        if (distToPlayer < 8 && enemy.attack <= 0) {
          enemy.attack = 2.4 + Math.random() * 1.5
          state.health -= 7
          state.damageFlash = 0.55
          state.lastDamage = state.time
          if (state.health <= 0) {
            state.health = 100
            state.score = Math.max(0, state.score - 100)
            state.pos = [0, 1.7, 8]
            state.yaw = 0
            state.pitch = -0.02
          }
        }
      }

      if (state.time - state.lastDamage > 5) {
        state.health = Math.min(state.maxHealth, state.health + dt * 5)
      }

      updateHud()
    }

    function addInstance (out, model, color, emissive, kind) {
      out.push({ model: model, color: color, emissive: emissive, kind: kind })
    }

    function buildInstances () {
      var out = []
      addInstance(
        out,
        compose([0, -0.1, 0], 0, 22, 0.2, 22),
        [0.05, 0.08, 0.11, 1],
        0.02,
        1
      )
      addInstance(
        out,
        compose([0, 6.1, 0], 0, 22, 0.2, 22),
        [0.03, 0.04, 0.07, 1],
        0.02,
        0
      )
      var wallColor = [0.08, 0.1, 0.16, 1]
      addInstance(out, compose([-11, 3, 0], 0, 0.5, 6, 22), wallColor, 0.02, 0)
      addInstance(out, compose([11, 3, 0], 0, 0.5, 6, 22), wallColor, 0.02, 0)
      addInstance(out, compose([0, 3, -11], 0, 22, 6, 0.5), wallColor, 0.02, 0)
      addInstance(out, compose([0, 3, 11], 0, 22, 6, 0.5), wallColor, 0.02, 0)

      var pillarColor = [0.12, 0.16, 0.24, 1]
      addInstance(out, compose([-5, 3, -5], 0, 1.0, 6, 1.0), pillarColor, 0.06, 0)
      addInstance(out, compose([5, 3, -5], 0, 1.0, 6, 1.0), pillarColor, 0.06, 0)
      addInstance(out, compose([-5, 3, 5], 0, 1.0, 6, 1.0), pillarColor, 0.06, 0)
      addInstance(out, compose([5, 3, 5], 0, 1.0, 6, 1.0), pillarColor, 0.06, 0)

      var crateColor = [0.16, 0.2, 0.28, 1]
      addInstance(out, compose([-7.5, 0.65, -1.5], 0.2, 1.3, 1.3, 1.3), crateColor, 0.04, 0)
      addInstance(out, compose([7.5, 0.65, 1.5], -0.2, 1.3, 1.3, 1.3), crateColor, 0.04, 0)

      for (var i = 0; i < enemies.length; ++i) {
        var e = enemies[i]
        if (!e.alive) continue
        var p = enemyPosition(e)
        var pulse = 0.7 + 0.3 * Math.sin(state.time * 5 + e.phase)
        addInstance(
          out,
          compose(p, state.time * 0.7 + e.phase, 0.8, 0.8, 0.8),
          [1.0, 0.25 + 0.2 * pulse, 0.12, 1],
          0.8 * pulse,
          2
        )
      }

      var basis = cameraBasis()
      var gunPos = add(
        add(state.pos, scale(basis.right, 0.32)),
        add(scale(basis.up, -0.24), scale(basis.forward, 1.05))
      )
      var gunModel = basisModel(
        gunPos,
        basis.right,
        basis.up,
        basis.forward,
        0.09,
        0.09,
        0.3
      )
      addInstance(out, gunModel, [0.16, 0.24, 0.38, 1], 0.06, 3)
      var barrelPos = add(gunPos, scale(basis.forward, 0.22))
      addInstance(
        out,
        basisModel(
          barrelPos,
          basis.right,
          basis.up,
          basis.forward,
          0.035,
          0.035,
          0.2
        ),
        [0.08, 0.12, 0.18, 1],
        0.04,
        3
      )
      var tip = add(gunPos, scale(basis.forward, 0.3))
      state.muzzle = add(tip, scale(basis.forward, 0.08))
      addInstance(
        out,
        compose(state.muzzle, 0, 0.06, 0.06, 0.06),
        [0.3, 0.55, 0.9, 1],
        0.2,
        3
      )
      if (state.muzzleFlash > 0) {
        addInstance(
          out,
          compose(
            add(state.muzzle, scale(basis.forward, 0.05)),
            0,
            0.16,
            0.16,
            0.16
          ),
          [1, 0.7, 0.2, 1],
          1.0,
          4
        )
      }
      if (state.tracer) {
        addInstance(
          out,
          basisModelLine(state.tracer.start, state.tracer.end, 0.012),
          [0.5, 0.9, 1, 1],
          1.0,
          4
        )
      }

      state.instances = out
      state.camera = state.pos.slice()
      state.forward = basis.forward
      return out
    }

    function viewProjection () {
      var basis = cameraBasis()
      var view = new Float32Array(16)
      var proj = new Float32Array(16)
      var out = new Float32Array(16)
      M4.lookAt(
        view,
        state.pos,
        add(state.pos, basis.forward),
        [0, 1, 0]
      )
      M4.perspective(
        proj,
        Math.PI / 3,
        canvas.width / Math.max(1, canvas.height),
        0.05,
        60
      )
      M4.multiply(out, proj, view)
      state.viewProj = out
      return out
    }

    function onMouseMove (event) {
      if (!state.started) return
      if (!state.locked && !state.looking) return
      var sens = 0.0022
      state.yaw += event.movementX * sens
      state.pitch = clamp(
        state.pitch - event.movementY * sens,
        -1.15,
        1.15
      )
    }

    function onMouseDown (event) {
      if (event.button === 2) {
        if (!state.started) startGame()
        if (!state.locked && canvas.requestPointerLock) {
          canvas.requestPointerLock()
        }
        state.looking = true
        return
      }
      if (event.button !== 0) return
      if (!state.started) {
        startGame()
        return
      }
      if (!state.locked && canvas.requestPointerLock) {
        canvas.requestPointerLock()
      }
      shoot()
    }

    function onMouseUp (event) {
      if (event.button === 2) state.looking = false
    }

    function onKeyDown (event) {
      state.keys[event.code] = true
      if (event.code === 'Space') {
        event.preventDefault()
      }
      if (event.code === 'KeyR') reload()
    }

    function onKeyUp (event) {
      state.keys[event.code] = false
    }

    function onPointerLockChange () {
      state.locked = document.pointerLockElement === canvas
      if (state.locked) {
        state.started = true
        state.looking = false
      } else if (state.started) {
        state.fallbackLook = true
      }
      if (!state.locked) state.keys = {}
      updateHud()
    }

    canvas.addEventListener('contextmenu', function (event) {
      event.preventDefault()
    })
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('contextmenu', function (event) {
      event.preventDefault()
    })
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    if (overlay) {
      overlay.addEventListener('click', function () {
        startGame()
      })
    }

    buildInstances()
    updateHud()

    return {
      state: state,
      update: update,
      buildInstances: buildInstances,
      viewProjection: viewProjection,
      maxInstances: MAX_INSTANCES,
      cameraBasis: cameraBasis,
      enemyPosition: enemyPosition
    }
  }

  global.FPSGame = { create: createGame }
})(window)
