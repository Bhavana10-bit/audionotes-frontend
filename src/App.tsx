import { useEffect, useMemo, useRef, useState } from 'react'

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

type UploadItem = {
  _id: string
  originalName: string
  mimeType: string
  size: number
  storageFilename: string
  transcription: string | null
  createdAt: string
  url: string
}


const ALLOWED_AUDIO_TYPES = [
  'audio/webm',
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/x-wav',
  'audio/flac',
]
const MAX_FILE_SIZE_MB = 25
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** idx
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

function isValidAudioFile(file: File): { ok: true } | { ok: false; message: string } {
  const type = file.type?.toLowerCase() || ''
  const isAllowed =
    type.startsWith('audio/') || ALLOWED_AUDIO_TYPES.some((t) => type.includes(t.split('/')[1]))
  if (!isAllowed) {
    return { ok: false, message: `Invalid file type: ${file.type || 'unknown'}. Use audio files (e.g. MP3, WAV, WebM).` }
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, message: `File too large. Max ${MAX_FILE_SIZE_MB} MB.` }
  }
  return { ok: true }
}

export default function App() {
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [isLoadingList, setIsLoadingList] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [recordedFile, setRecordedFile] = useState<File | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  async function fetchUploads() {
    setIsLoadingList(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/uploads`)
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data?.error || `Failed to fetch (${res.status})`)
      }
      const data = (await res.json()) as UploadItem[]
      setUploads(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch uploads')
    } finally {
      setIsLoadingList(false)
    }
  }

  async function uploadFile(file: File) {
    const validation = isValidAudioFile(file)
    if (!validation.ok) {
      setError(validation.message)
      return
    }
    setIsUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('audio', file)
      const res = await fetch(`${API_BASE}/api/uploads`, { method: 'POST', body: form })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body?.error || `Upload failed (${res.status})`)
      await fetchUploads()
      // if the uploaded file was the in-memory recording, clear the preview
      if (recordedFile && file === recordedFile) {
        try {
          if (recordingUrl) URL.revokeObjectURL(recordingUrl)
        } catch {
          // ignore
        }
        setRecordingUrl(null)
        setRecordedFile(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  async function updateName(id: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed) return
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/uploads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalName: trimmed }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data?.error || `Update failed (${res.status})`)
      setUploads((prev) =>
        prev.map((u) => (u._id === id ? { ...u, originalName: trimmed } : u))
      )
      setEditingId(null)
      setEditingName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update name')
    }
  }

  function startEdit(u: UploadItem) {
    setEditingId(u._id)
    setEditingName(u.originalName)
    setTimeout(() => editInputRef.current?.focus(), 0)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingName('')
  }

  async function deleteUpload(id: string) {
    setDeletingId(id)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/uploads/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data?.error || `Delete failed (${res.status})`)
      }
      setUploads((prev) => prev.filter((u) => u._id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeletingId(null)
    }
  }

  async function startRecording() {
    setError(null)
    setRecordedFile(null)
    if (recordingUrl) URL.revokeObjectURL(recordingUrl)
    setRecordingUrl(null)
    if (!('MediaRecorder' in window)) {
      setError('Recording not supported. Try Chrome or Firefox.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (ev) => {
        if (ev.data?.size) chunksRef.current.push(ev.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        try {
          if (recordingUrl) URL.revokeObjectURL(recordingUrl)
        } catch {/* ignore */}
        const url = URL.createObjectURL(blob)
        setRecordingUrl(url)
        const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('wav') ? 'wav' : 'webm'
        setRecordedFile(new File([blob], `recording-${Date.now()}.${ext}`, { type: blob.type }))
      }
      recorder.start()
      setIsRecording(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not access microphone.')
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    setIsRecording(false)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  useEffect(() => {
    void fetchUploads()
  }, [])

  

  useEffect(() => {
    return () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [recordingUrl])

  const canUploadRecorded = useMemo(() => !!recordedFile && !isUploading, [recordedFile, isUploading])

  function saveTranscription(u: UploadItem) {
    if (!u.transcription) return
    try {
      const text = u.transcription
      const safeName = (u.originalName || 'transcription').replace(/[^a-z0-9_.-]/gi, '_')
      const filename = `${safeName}-${u._id}.txt`
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 500)
    } catch(err) {
      console.error('Failed to save transcription:', err);
    }
  }

  

  return (
    <div className="min-h-screen bg-[#0c0f14] text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.15),transparent)]" />
      <div className="relative mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <header className="mb-14 text-center">
          <h1 className="bg-linear-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-5xl font-extrabold tracking-tight text-transparent sm:text-6xl">
            Speech-to-Text
          </h1>
          <p className="mt-4 text-lg text-slate-400">
            Upload or record audio. Transcriptions saved to MongoDB.
          </p>
        </header>

        {error && (
          <div
            className="mb-8 flex items-start justify-between gap-4 rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-red-200 shadow-lg"
            role="alert"
          >
            <div>
              <p className="font-semibold">Error</p>
              <p className="mt-1 text-sm">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-red-500/10"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-700/60 bg-slate-800/30 p-7 shadow-2xl ring-1 ring-white/5 backdrop-blur">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-2xl" aria-hidden>📁</span>
              <h2 className="text-xl font-bold text-white">Upload audio</h2>
            </div>
            <p className="mb-6 text-sm text-slate-400">
              MP3, WAV, WebM, OGG · max {MAX_FILE_SIZE_MB} MB
            </p>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-600 bg-slate-900/40 py-10 transition hover:border-emerald-500/50 hover:bg-slate-900/60">
              <input
                type="file"
                accept="audio/*"
                disabled={isUploading}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void uploadFile(file)
                  e.target.value = ''
                }}
              />
              <span className="text-4xl text-slate-500">🎵</span>
              <span className="mt-2 font-medium text-slate-300">
                {isUploading ? 'Uploading…' : 'Choose file or drag here'}
              </span>
              {isUploading && (
                <span className="mt-2 inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              )}
            </label>
          </section>

          <section className="rounded-2xl border border-slate-700/60 bg-slate-800/30 p-7 shadow-2xl ring-1 ring-white/5 backdrop-blur">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-2xl" aria-hidden>🎙️</span>
              <h2 className="text-xl font-bold text-white">Record</h2>
            </div>
            <p className="mb-6 text-sm text-slate-400">
              Use your microphone (WebM/Opus)
            </p>
            <div className="flex flex-wrap gap-3">
              {!isRecording ? (
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 hover:shadow-emerald-500/30 active:scale-[0.98]"
                >
                  Start recording
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="rounded-xl bg-rose-500 px-5 py-3 font-semibold text-white shadow-lg transition hover:bg-rose-400 active:scale-[0.98]"
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                disabled={!canUploadRecorded}
                onClick={() => recordedFile && void uploadFile(recordedFile)}
                className="rounded-xl border border-slate-600 bg-slate-700/50 px-5 py-3 font-semibold text-slate-200 transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Upload recording
              </button>
            </div>
            {recordingUrl && (
              <div className="mt-6">
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Preview
                </p>
                <audio controls src={recordingUrl} className="w-full rounded-lg bg-slate-900/50" />
              </div>
            )}
          </section>
        </div>

        <section className="mt-14">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 text-2xl font-bold text-white">
              <span aria-hidden>📜</span>
              Transcription history
            </h2>
            <button
              type="button"
              onClick={() => void fetchUploads()}
              disabled={isLoadingList}
              className="rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>

          {isLoadingList ? (
            <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-700/50 bg-slate-800/20 py-20">
              <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-slate-400">Loading…</span>
            </div>
          ) : uploads.length === 0 ? (
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/20 py-20 text-center text-slate-500">
              No uploads yet. Upload or record to get started.
            </div>
          ) : (
            <ul className="grid gap-6">
              {uploads.map((u) => (
                <li
                  key={u._id}
                  className="group rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6 shadow-xl ring-1 ring-white/5 transition hover:border-slate-600/60 hover:ring-emerald-500/10"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {editingId === u._id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void updateName(u._id, editingName)
                              if (e.key === 'Escape') cancelEdit()
                            }}
                            onBlur={() => {
                              if (editingName.trim()) void updateName(u._id, editingName)
                              else cancelEdit()
                            }}
                            className="max-w-full rounded-lg border border-emerald-500/50 bg-slate-900 px-3 py-2 text-sm font-medium text-white focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                          />
                          <button
                            type="button"
                            onClick={() => void updateName(u._id, editingName)}
                            className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-400"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-lg bg-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-500"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(u)}
                          className="text-left font-semibold text-white underline-offset-2 hover:underline group-hover:text-emerald-300"
                          title="Click to rename"
                        >
                          {u.originalName}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">
                        {new Date(u.createdAt).toLocaleString()} · {formatBytes(u.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => saveTranscription(u)}
                        disabled={!u.transcription}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === u._id}
                        onClick={() => void deleteUpload(u._id)}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {deletingId === u._id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                  <audio
                    controls
                    src={API_BASE ? `${API_BASE}${u.url}` : u.url}
                    className="mt-4 w-full rounded-xl bg-slate-900/50"
                  />
                  <div className="mt-4 rounded-xl bg-slate-900/40 p-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                      Transcription
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-200">
                      {u.transcription ?? (
                        <span className="italic text-slate-500">Not generated (set DEEPGRAM_API_KEY)</span>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
