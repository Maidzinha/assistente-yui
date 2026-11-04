import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { emotionOf, type AvatarEmotion } from '../lib/avatarEmotion'
import { isTalking, mouthLevel } from '../lib/lipsync'
import type { Presence } from './SidePanels'

const EMOTIONS: Exclude<AvatarEmotion, 'neutral'>[] = ['happy', 'angry', 'sad', 'relaxed', 'surprised']
const VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'] as const

interface Props {
  model: ArrayBuffer
  presence: Presence
  /** Frase que está sendo falada agora (com as marcações de emoção). */
  sentence: string | null
  onError(message: string): void
}

/**
 * A Yui em 3D (modelo VRM): boca pela voz, piscadas, respiração, cabeça viva
 * e expressões conforme a emoção de cada frase.
 */
export function Avatar3D({ model, presence, sentence, onError }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef({ presence, sentence })
  live.current = { presence, sentence }
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    let raf = 0
    let vrm: VRM | null = null

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 20)
    scene.add(new THREE.HemisphereLight(0xfff0f5, 0x553344, 1.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(0.6, 1.8, 1.6)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xffb6d0, 0.8)
    rim.position.set(-1, 1.6, -1.2)
    scene.add(rim)

    const resize = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.parseAsync(model, '').then((gltf) => {
      if (disposed) return
      vrm = gltf.userData.vrm as VRM
      if (!vrm) throw new Error('o arquivo não tem dados de VRM')
      VRMUtils.removeUnnecessaryVertices(gltf.scene)
      VRMUtils.combineSkeletons(gltf.scene)
      VRMUtils.rotateVRM0(vrm) // modelos VRM 0.x ficam de frente para a câmera
      vrm.scene.traverse((o) => { o.frustumCulled = false })
      scene.add(vrm.scene)

      // Enquadra do peito para cima, olhando para a altura do rosto.
      vrm.scene.updateMatrixWorld(true)
      const head = vrm.humanoid.getNormalizedBoneNode('head')
      const headPos = new THREE.Vector3()
      head?.getWorldPosition(headPos)
      const target = new THREE.Vector3(headPos.x, headPos.y - 0.12, headPos.z)
      camera.position.set(headPos.x, headPos.y - 0.05, headPos.z + 1.35)
      camera.lookAt(target)
      if (vrm.lookAt) vrm.lookAt.target = camera
      setReady(true)
    }).catch((err: Error) => {
      if (!disposed) onError(`Não consegui abrir o modelo 3D: ${err.message}`)
    })

    // Estado da animação.
    const clock = new THREE.Clock()
    let nextBlink = 1.5
    let blinkT = -1
    let mouth = 0
    let vowel: (typeof VOWELS)[number] = 'aa'
    let nextVowel = 0
    const weights: Record<string, number> = {}
    const ease = (name: string, target: number, speed: number, dt: number) => {
      const cur = weights[name] ?? 0
      const v = cur + (target - cur) * Math.min(1, dt * speed)
      weights[name] = v
      vrm?.expressionManager?.setValue(name, v)
    }

    const loop = () => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(clock.getDelta(), 0.1)
      const t = clock.elapsedTime
      if (!vrm) return
      const { presence: p, sentence: s } = live.current
      const h = vrm.humanoid

      // Braços para baixo (o modelo vem em pose de T) e respiração.
      const breath = Math.sin(t * 1.6) * 0.5 + 0.5
      const lArm = h.getNormalizedBoneNode('leftUpperArm')
      const rArm = h.getNormalizedBoneNode('rightUpperArm')
      if (lArm) lArm.rotation.z = -1.22 + breath * 0.03
      if (rArm) rArm.rotation.z = 1.22 - breath * 0.03
      const lFore = h.getNormalizedBoneNode('leftLowerArm')
      const rFore = h.getNormalizedBoneNode('rightLowerArm')
      if (lFore) lFore.rotation.y = -0.15
      if (rFore) rFore.rotation.y = 0.15
      const chest = h.getNormalizedBoneNode('chest') ?? h.getNormalizedBoneNode('spine')
      if (chest) chest.rotation.x = -0.02 + breath * 0.025

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
      for (const v of VOWELS) ease(v, v === vowel ? Math.min(1, mouth * 1.1) : 0, 22, dt)

      // Emoção da frase atual (ou um jeitinho conforme o estado).
      const { emotion, weight } = p === 'speaking' ? emotionOf(s)
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

      // Cabeça viva: balança de leve, inclina ao ouvir, olha para cima ao pensar, acompanha a fala.
      const neck = h.getNormalizedBoneNode('neck')
      const headBone = h.getNormalizedBoneNode('head')
      const tilt = p === 'listening' ? 0.12 : p === 'thinking' ? -0.06 : 0
      const pitch = p === 'thinking' ? -0.1 : 0
      if (neck) {
        neck.rotation.y = Math.sin(t * 0.7) * 0.06
        neck.rotation.x = pitch * 0.5 + Math.sin(t * 0.9) * 0.02
      }
      if (headBone) {
        headBone.rotation.z += (tilt + Math.sin(t * 0.5) * 0.03 - headBone.rotation.z) * Math.min(1, dt * 3)
        headBone.rotation.x = pitch * 0.5 + mouth * 0.05 * Math.sin(t * 7)
      }

      vrm.update(dt)
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      if (vrm) VRMUtils.deepDispose(vrm.scene)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [model, onError])

  return <div ref={host} className={`avatar3d ${ready ? 'is-ready' : ''}`} aria-hidden="true" />
}
