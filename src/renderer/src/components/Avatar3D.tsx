import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { emotionOf, type AvatarEmotion } from '../lib/avatarEmotion'
import { isTalking, mouthLevel } from '../lib/lipsync'
import type { Presence } from './SidePanels'

const EMOTIONS: Exclude<AvatarEmotion, 'neutral'>[] = ['happy', 'angry', 'sad', 'relaxed', 'surprised']
const VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'] as const

/**
 * Enquadramentos prontos: quanto da Yui aparece, do topo da cabeça para baixo,
 * medido em "cabeças" (assim funciona igual para modelos altos ou baixinhos).
 */
const FRAMINGS = [
  { id: 'rosto', label: 'Rosto', height: 1.5 },
  { id: 'busto', label: 'Busto', height: 2.5 },
  { id: 'corpo', label: 'Corpo', height: Infinity }
] as const
const DEFAULT_HEIGHT = 2.5
type FramingId = (typeof FRAMINGS)[number]['id']

const FOV = 24
const MIN_HEIGHT = 1.2
const MAX_YAW = 1.0
const ZOOM_KEY = 'yui.avatar.enquadramento'

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

function savedHeight(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY))
    return Number.isFinite(v) && v >= MIN_HEIGHT ? v : DEFAULT_HEIGHT
  } catch {
    return DEFAULT_HEIGHT
  }
}

function saveHeight(v: number) {
  try { localStorage.setItem(ZOOM_KEY, String(v)) } catch { /* sem armazenamento */ }
}

interface Props {
  model: ArrayBuffer
  presence: Presence
  /** Frase que está sendo falada agora (com as marcações de emoção). */
  sentence: string | null
  onError(message: string): void
}

/**
 * A Yui em 3D (modelo VRM): boca pela voz, piscadas, respiração, expressões conforme a emoção
 * de cada frase, e o olhar acompanhando o mouse. Dá para arrastar (girar), usar a roda do mouse
 * (aproximar) e dar dois cliques (voltar ao enquadramento padrão).
 */
export function Avatar3D({ model, presence, sentence, onError }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef({ presence, sentence })
  live.current = { presence, sentence }
  const [ready, setReady] = useState(false)
  const [framing, setFraming] = useState<FramingId | null>(null)
  // Controles da câmera, compartilhados entre os botões e o laço de animação.
  const view = useRef({ height: savedHeight(), goal: savedHeight(), yaw: 0, yawGoal: 0, max: 8 })

  const frameTo = (id: FramingId) => {
    const f = FRAMINGS.find((x) => x.id === id)!
    view.current.goal = Math.min(f.height, view.current.max)
    view.current.yawGoal = 0
    saveHeight(view.current.goal)
    setFraming(id)
  }

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    let raf = 0
    let vrm: VRM | null = null
    const v = view.current

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 30)
    scene.add(new THREE.HemisphereLight(0xfff0f5, 0x553344, 1.6))
    // As luzes acompanham a câmera, para o rosto ficar sempre bem iluminado ao girar.
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(0.6, 0.9, 1.6)
    const rim = new THREE.DirectionalLight(0xffb6d0, 0.8)
    rim.position.set(-1, 0.6, -2.6)
    camera.add(key, key.target, rim, rim.target)
    key.target.position.set(0, 0, -1.5)
    rim.target.position.set(0, 0, -1.5)
    scene.add(camera)

    // Ponto para onde a Yui olha: fica na câmera e se desloca na direção do mouse.
    const gaze = new THREE.Object3D()
    scene.add(gaze)

    let aspect = 1
    const resize = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      renderer.setSize(w, h, false)
      aspect = w / h
      camera.aspect = aspect
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    // Medidas do modelo, usadas para enquadrar.
    const body = { top: 1.5, floor: 0, x: 0, z: 0, head: 0.22 }
    /** VRM 0.x fica virado para trás e é girado em 180°; os eixos X e Z dos ossos invertem junto. */
    let s = 1

    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.parseAsync(model, '').then((gltf) => {
      if (disposed) return
      vrm = gltf.userData.vrm as VRM
      if (!vrm) throw new Error('o arquivo não tem dados de VRM')
      VRMUtils.removeUnnecessaryVertices(gltf.scene)
      VRMUtils.combineSkeletons(gltf.scene)
      VRMUtils.rotateVRM0(vrm) // modelos VRM 0.x ficam de frente para a câmera
      s = vrm.meta?.metaVersion === '0' ? -1 : 1
      vrm.scene.traverse((o) => { o.frustumCulled = false })
      scene.add(vrm.scene)

      vrm.scene.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(vrm.scene)
      const headPos = new THREE.Vector3()
      vrm.humanoid.getNormalizedBoneNode('head')?.getWorldPosition(headPos)
      body.x = headPos.x
      body.z = headPos.z
      body.floor = box.min.y
      // O topo da caixa é o topo do cabelo; limita para enfeites muito altos não afastarem o rosto.
      body.top = Math.min(box.max.y, headPos.y + 0.3)
      body.head = Math.max(0.08, body.top - headPos.y) // o osso da cabeça fica na base dela
      v.max = ((body.top - body.floor) * 1.32) / body.head
      v.goal = clamp(v.goal, MIN_HEIGHT, v.max)
      v.height = v.goal
      if (vrm.lookAt) vrm.lookAt.target = gaze
      setFraming(FRAMINGS.find((f) => Math.abs(Math.min(f.height, v.max) - v.goal) < 0.05)?.id ?? null)
      setReady(true)
    }).catch((err: Error) => {
      if (!disposed) onError(`Não consegui abrir o modelo 3D: ${err.message}`)
    })

    // ----- Mouse: olhar, girar e aproximar -----
    const pointer = { x: 0, y: 0, at: -Infinity }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      pointer.x = clamp((e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.5), -1, 1)
      pointer.y = clamp((r.top + r.height * 0.35 - e.clientY) / (window.innerHeight * 0.5), -1, 1)
      pointer.at = performance.now()
    }
    const onLeave = () => { pointer.at = -Infinity }
    window.addEventListener('pointermove', onMove)
    document.documentElement.addEventListener('pointerleave', onLeave)

    let drag: { id: number; x: number } | null = null
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      drag = { id: e.pointerId, x: e.clientX }
      el.setPointerCapture(e.pointerId)
      el.classList.add('is-dragging')
    }
    const onDrag = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      v.yawGoal = clamp(v.yawGoal - (e.clientX - drag.x) * 0.008, -MAX_YAW, MAX_YAW)
      drag.x = e.clientX
    }
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      drag = null
      el.classList.remove('is-dragging')
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      v.goal = clamp(v.goal * Math.exp(e.deltaY * 0.0012), MIN_HEIGHT, v.max)
      saveHeight(v.goal)
      setFraming(null)
    }
    const onDouble = () => {
      v.goal = Math.min(DEFAULT_HEIGHT, v.max)
      v.yawGoal = 0
      saveHeight(v.goal)
      setFraming('busto')
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onDrag)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('dblclick', onDouble)

    // Estado da animação.
    const clock = new THREE.Clock()
    let nextBlink = 1.5
    let blinkT = -1
    let mouth = 0
    let vowel: (typeof VOWELS)[number] = 'aa'
    let nextVowel = 0
    const look = { x: 0, y: 0 }
    const right = new THREE.Vector3()
    const weights: Record<string, number> = {}
    const ease = (name: string, target: number, speed: number, dt: number) => {
      const cur = weights[name] ?? 0
      const val = cur + (target - cur) * Math.min(1, dt * speed)
      weights[name] = val
      vrm?.expressionManager?.setValue(name, val)
    }

    const loop = () => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(clock.getDelta(), 0.1)
      const t = clock.elapsedTime
      if (!vrm) return
      const { presence: p, sentence: sen } = live.current
      const h = vrm.humanoid

      // Câmera: a cabeça fica sempre no alto do quadro; a altura visível define o zoom.
      v.height += (v.goal - v.height) * Math.min(1, dt * 6)
      v.yaw += (v.yawGoal - v.yaw) * Math.min(1, dt * 10)
      // Em quadros estreitos, afasta o bastante para os ombros caberem.
      const wanted = v.height * body.head
      const visible = Math.max(wanted, Math.min(body.head * 2, wanted * 0.8) / aspect)
      const dist = visible / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)))
      const centerY = body.top + visible * 0.05 - visible / 2
      camera.position.set(body.x + Math.sin(v.yaw) * dist, centerY, body.z + Math.cos(v.yaw) * dist)
      camera.lookAt(body.x, centerY, body.z)
      camera.updateMatrixWorld()

      // Olhar: segue o mouse; sem movimento por um tempo, volta para você. Pensando, olha para o alto.
      const following = performance.now() - pointer.at < 5000
      const goalX = p === 'thinking' ? 0.4 : following ? pointer.x : 0
      const goalY = p === 'thinking' ? 0.45 : following ? pointer.y : 0
      look.x += (goalX - look.x) * Math.min(1, dt * 4)
      look.y += (goalY - look.y) * Math.min(1, dt * 4)
      right.setFromMatrixColumn(camera.matrixWorld, 0)
      gaze.position.copy(camera.position).addScaledVector(right, look.x * dist * 0.6)
      gaze.position.y += look.y * dist * 0.4

      // Braços para baixo (o modelo vem em pose de T) e respiração.
      const breath = Math.sin(t * 1.6) * 0.5 + 0.5
      const lArm = h.getNormalizedBoneNode('leftUpperArm')
      const rArm = h.getNormalizedBoneNode('rightUpperArm')
      if (lArm) lArm.rotation.z = s * (-1.22 + breath * 0.03)
      if (rArm) rArm.rotation.z = s * (1.22 - breath * 0.03)
      const lFore = h.getNormalizedBoneNode('leftLowerArm')
      const rFore = h.getNormalizedBoneNode('rightLowerArm')
      if (lFore) lFore.rotation.y = -0.15
      if (rFore) rFore.rotation.y = 0.15
      const chest = h.getNormalizedBoneNode('chest') ?? h.getNormalizedBoneNode('spine')
      if (chest) chest.rotation.x = s * (-0.02 + breath * 0.025)
      // Balanço leve do corpo, para ela não parecer uma estátua.
      const hips = h.getNormalizedBoneNode('hips')
      if (hips) hips.rotation.y = Math.sin(t * 0.35) * 0.035
      const spine = h.getNormalizedBoneNode('spine')
      if (spine && spine !== chest) spine.rotation.z = s * Math.sin(t * 0.5) * 0.012

      // Boca: volume da voz, trocando a vogal a cada sílaba.
      const talking = p === 'speaking' && isTalking()
      let level = 0
      if (talking) {
        const m = mouthLevel()
        level = m ?? Math.max(0, 0.55 * Math.sin(t * 12) + 0.3 * Math.sin(t * 4.7 + 1) + 0.15)
      }
      mouth += (level - mouth) * Math.min(1, dt * 18)
      if (t > nextVowel) {
        vowel = VOWELS[Math.floor(Math.random() * VOWELS.length)]
        nextVowel = t + 0.09 + Math.random() * 0.08
      }
      for (const vw of VOWELS) ease(vw, vw === vowel ? Math.min(1, mouth * 1.1) : 0, 22, dt)

      // Emoção da frase atual (ou um jeitinho conforme o estado).
      const { emotion, weight } = p === 'speaking' ? emotionOf(sen)
        : p === 'listening' ? { emotion: 'relaxed' as const, weight: 0.35 }
        : p === 'confirming' ? { emotion: 'surprised' as const, weight: 0.25 }
        : { emotion: 'relaxed' as const, weight: 0.15 }
      for (const e of EMOTIONS) ease(e, e === emotion ? weight : 0, 5, dt)

      // Piscadas naturais (menos quando sorri muito, pois o sorriso já fecha os olhos).
      if (blinkT < 0 && t > nextBlink) blinkT = 0
      let blink = 0
      if (blinkT >= 0) {
        blinkT += dt
        blink = blinkT < 0.07 ? blinkT / 0.07 : blinkT < 0.16 ? 1 - (blinkT - 0.07) / 0.09 : 0
        if (blinkT >= 0.16) {
          blinkT = -1
          nextBlink = t + 1.8 + Math.random() * 3.5
        }
      }
      vrm.expressionManager?.setValue('blink', blink * (1 - (weights.happy ?? 0) * 0.8))

      // Cabeça viva: vira junto com o olhar, balança de leve, inclina ao ouvir, acompanha a fala.
      const neck = h.getNormalizedBoneNode('neck')
      const headBone = h.getNormalizedBoneNode('head')
      const turn = look.x * 0.34
      const nod = -look.y * 0.2 // negativo = olhar para cima
      const tilt = p === 'listening' ? 0.12 : p === 'thinking' ? -0.06 : 0
      if (neck) {
        neck.rotation.y = turn * 0.4 + Math.sin(t * 0.7) * 0.05
        neck.rotation.x = s * (nod * 0.4 + Math.sin(t * 0.9) * 0.02)
      }
      if (headBone) {
        headBone.rotation.y = turn * 0.6
        headBone.rotation.z += (s * (tilt + Math.sin(t * 0.5) * 0.03) - headBone.rotation.z) * Math.min(1, dt * 3)
        headBone.rotation.x = s * (nod * 0.6 + mouth * 0.05 * Math.sin(t * 7))
      }

      vrm.update(dt)
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onDrag)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('dblclick', onDouble)
      if (vrm) VRMUtils.deepDispose(vrm.scene)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [model, onError])

  return (
    <>
      <div
        ref={host}
        className={`avatar3d ${ready ? 'is-ready' : ''}`}
        title="Arraste para girar · roda do mouse aproxima · dois cliques voltam ao padrão"
      />
      {ready && (
        <div className="avatar-framing" role="group" aria-label="Enquadramento da Yui">
          {FRAMINGS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={framing === f.id ? 'is-selected' : ''}
              aria-pressed={framing === f.id}
              onClick={() => frameTo(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
