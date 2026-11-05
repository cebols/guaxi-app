// ── Comprime o vídeo no próprio aparelho antes de subir ──────────────────────
// Reduz pra ~540×960, tira o som (no cardápio ele toca mudo), corta nos primeiros
// maxSeg segundos e grava MP4 H.264 (toca em qualquer celular).
// Caminho 1: WebCodecs + mp4-muxer. Caminho 2: MediaRecorder (WebM/MP4).
// Sem nenhum dos dois: devolve o arquivo original.

const MB = 1024 * 1024

function esperar(el, ev, ms = 15000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Não deu pra ler o vídeo')), ms)
    el.addEventListener(ev, () => { clearTimeout(t); res() }, { once: true })
    el.addEventListener('error', () => { clearTimeout(t); rej(new Error('Formato de vídeo não suportado neste aparelho')) }, { once: true })
  })
}

export function dimensoes(vw, vh, curto = 540, longo = 960) {
  const esc = Math.min(1, curto / Math.min(vw, vh), longo / Math.max(vw, vh))
  const par = x => Math.max(2, Math.round((x * esc) / 2) * 2)
  return [par(vw), par(vh)]
}

async function abrirVideo(file) {
  const v = document.createElement('video')
  v.muted = true; v.playsInline = true; v.preload = 'auto'
  v.setAttribute('playsinline', '')
  // precisa estar na página pro navegador entregar os quadros
  Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' })
  v.src = URL.createObjectURL(file)
  document.body.appendChild(v)
  try { await esperar(v, 'loadedmetadata') } catch (e) { fecharVideo(v); throw e }
  return v
}
function fecharVideo(v) { try { v.pause() } catch { /* ok */ } URL.revokeObjectURL(v.src); v.remove() }

// Toca do começo e chama desenhar(t) a cada quadro novo (t em segundos)
function percorrer(v, fim, fps, desenhar, onProgresso) {
  return new Promise((resolve, reject) => {
    let proximo = 0, acabou = false, ultimo = Date.now()
    const terminar = (erro) => {
      if (acabou) return
      acabou = true; clearInterval(vigia); v.pause()
      erro ? reject(erro) : resolve()
    }
    const passo = (t) => {
      if (acabou) return
      if (t >= fim) return terminar()
      if (t + 0.004 >= proximo) {
        desenhar(t)
        proximo += 1 / fps
        if (proximo < t) proximo = t + 1 / fps
        ultimo = Date.now()
        onProgresso?.(Math.min(0.99, t / fim))
      }
      agendar()
    }
    const rvfc = typeof v.requestVideoFrameCallback === 'function'
    const agendar = () => rvfc ? v.requestVideoFrameCallback((_, m) => passo(m.mediaTime)) : requestAnimationFrame(() => passo(v.currentTime))
    // travou (aba em segundo plano, formato que não decodifica…)
    const vigia = setInterval(() => {
      if (Date.now() - ultimo > 12000) terminar(new Error('A compressão parou — deixe a tela do app aberta enquanto comprime.'))
    }, 1000)
    v.addEventListener('ended', () => terminar(), { once: true })
    v.currentTime = 0
    agendar()
    v.play().catch(terminar)
  })
}

async function viaWebCodecs(v, w, h, fim, fps, bitrate, onProgresso) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null
  // H.264 primeiro (toca em tudo, inclusive iPhone); VP9 se o aparelho não codifica H.264
  const opcoes = [
    { mux: 'avc', cfg: { codec: 'avc1.42001f', width: w, height: h, bitrate, framerate: fps, avc: { format: 'avc' } } },
    { mux: 'vp9', cfg: { codec: 'vp09.00.10.08', width: w, height: h, bitrate, framerate: fps } },
  ]
  let escolha = null
  for (const o of opcoes) {
    try { if ((await VideoEncoder.isConfigSupported(o.cfg)).supported) { escolha = o; break } } catch { /* tenta a próxima */ }
  }
  if (!escolha) return null
  const cfg = escolha.cfg
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer')
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: escolha.mux, width: w, height: h, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' })
  let erro = null
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { erro = e } })
  enc.configure(cfg)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  let n = 0
  await percorrer(v, fim, fps, (t) => {
    if (erro || enc.encodeQueueSize > 8) return
    ctx.drawImage(v, 0, 0, w, h)
    const f = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6) })
    enc.encode(f, { keyFrame: n % (fps * 2) === 0 })
    f.close()
    n++
  }, onProgresso)
  await enc.flush()
  enc.close()
  if (erro) throw erro
  if (n < 2) return null
  muxer.finalize()
  return new Blob([muxer.target.buffer], { type: 'video/mp4' })
}

async function viaMediaRecorder(v, w, h, fim, fps, bitrate, onProgresso) {
  if (typeof MediaRecorder === 'undefined') return null
  const canvas = document.createElement('canvas')
  if (typeof canvas.captureStream !== 'function') return null
  const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(t => MediaRecorder.isTypeSupported(t))
  if (!mime) return null
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(v, 0, 0, w, h)
  const stream = canvas.captureStream(fps)
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate })
  const partes = []
  rec.ondataavailable = e => { if (e.data.size) partes.push(e.data) }
  const parou = new Promise(r => { rec.onstop = r })
  rec.start(500)
  try {
    await percorrer(v, fim, fps, () => ctx.drawImage(v, 0, 0, w, h), onProgresso)
  } finally {
    rec.stop()
    await parou
    stream.getTracks().forEach(t => t.stop())
  }
  return partes.length ? new Blob(partes, { type: mime.split(';')[0] }) : null
}

// → { blob, ext, duracao, cortou, comprimido }
export async function comprimirVideo(file, { maxSeg = 30, fps = 30, bitrate = 1_800_000, onProgresso } = {}) {
  const v = await abrirVideo(file)
  try {
    const dur = Number.isFinite(v.duration) ? v.duration : maxSeg
    const fim = Math.min(dur, maxSeg)
    const cortou = dur > maxSeg + 0.5
    const [w, h] = dimensoes(v.videoWidth || 540, v.videoHeight || 960)
    const extOriginal = (file.name.split('.').pop() || 'mp4').toLowerCase()
    // já está leve e é MP4: sobe como veio
    if (!cortou && file.type === 'video/mp4' && file.size <= 6 * MB && Math.max(v.videoWidth, v.videoHeight) <= 1280) {
      return { blob: file, ext: extOriginal, duracao: dur, cortou: false, comprimido: false }
    }
    let blob = null
    try { blob = await viaWebCodecs(v, w, h, fim, fps, bitrate, onProgresso) } catch { blob = null }
    if (!blob) blob = await viaMediaRecorder(v, w, h, fim, fps, bitrate, onProgresso)
    onProgresso?.(1)
    if (!blob) {
      if (cortou || file.size > 45 * MB) throw new Error('Este aparelho não consegue comprimir vídeo. Envie um vídeo de até 30 s e 45 MB.')
      return { blob: file, ext: extOriginal, duracao: dur, cortou: false, comprimido: false }
    }
    // a "compressão" ficou maior que o original (já era leve): fica o original
    if (!cortou && blob.size >= file.size && file.size <= 45 * MB) {
      return { blob: file, ext: extOriginal, duracao: dur, cortou: false, comprimido: false }
    }
    return { blob, ext: blob.type.includes('webm') ? 'webm' : 'mp4', duracao: fim, cortou, comprimido: true }
  } finally {
    fecharVideo(v)
  }
}
