import { useEffect, useMemo, useRef, useState } from 'react'

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

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** idx
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

export default function App() {
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [isLoadingList, setIsLoadingList] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [isRecording, setIsRecording] = useState(false)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [recordedFile, setRecordedFile] = useState<File | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  async function fetchUploads() {
    setIsLoadingList(true)
    setError(null)
    try {
      const res = await fetch('/api/uploads')
      if (!res.ok) throw new Error(`Failed to fetch uploads (${res.status})`)
      const data = (await res.json()) as UploadItem[]
      setUploads(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch uploads')
    } finally {
      setIsLoadingList(false)
    }
  }

  async function uploadFile(file: File) {
    setIsUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('audio', file)

      const res = await fetch('/api/uploads', {
        method: 'POST',
        body: form,
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `Upload failed (${res.status})`)
      }

      await fetchUploads()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  async function startRecording() {
    setError(null)
    setRecordedFile(null)
    if (recordingUrl) URL.revokeObjectURL(recordingUrl)
    setRecordingUrl(null)

    if (!('MediaRecorder' in window)) {
      setError('MediaRecorder is not supported in this browser.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const url = URL.createObjectURL(blob)
        setRecordingUrl(url)

        const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('wav') ? 'wav' : 'webm'
        const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: blob.type })
        setRecordedFile(file)
      }

      recorder.start()
      setIsRecording(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start recording')
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    setIsRecording(false)
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop()
      streamRef.current = null
    }
  }

  useEffect(() => {
    void fetchUploads()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (recordingUrl) URL.revokeObjectURL(recordingUrl)
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop()
      }
    }
  }, [recordingUrl])

  const canUploadRecorded = useMemo(() => !!recordedFile && !isUploading, [recordedFile, isUploading])

  return (
    <div className="min-h-full bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">SpeakEasy</h1>
          <p className="mt-1 text-sm text-slate-300">
            Upload or record audio. Files are stored in MongoDB metadata + on-disk in the backend.
          </p>
        </header>

        {error ? (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="text-sm font-semibold text-slate-200">Upload audio file</h2>
            <p className="mt-1 text-xs text-slate-400">Sends multipart/form-data field name: "audio".</p>

            <div className="mt-4">
              <input
                type="file"
                accept="audio/*"
                disabled={isUploading}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void uploadFile(file)
                  e.currentTarget.value = ''
                }}
                className="block w-full text-sm text-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-900 hover:file:bg-white disabled:opacity-60"
              />
              {isUploading ? <div className="mt-2 text-xs text-slate-400">Uploading…</div> : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="text-sm font-semibold text-slate-200">Record audio</h2>
            <p className="mt-1 text-xs text-slate-400">Uses MediaRecorder (usually records WebM/Opus).</p>

            <div className="mt-4 flex flex-wrap gap-2">
              {!isRecording ? (
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  Start recording
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-400"
                >
                  Stop
                </button>
              )}

              <button
                type="button"
                disabled={!canUploadRecorded}
                onClick={() => recordedFile && void uploadFile(recordedFile)}
                className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Upload recording
              </button>
            </div>

            {recordingUrl ? (
              <div className="mt-4">
                <div className="text-xs text-slate-400">Preview</div>
                <audio controls src={recordingUrl} className="mt-2 w-full" />
              </div>
            ) : null}
          </section>
        </div>

        <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-200">Previous uploads</h2>
            <button
              type="button"
              onClick={() => void fetchUploads()}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              Refresh
            </button>
          </div>

          {isLoadingList ? (
            <div className="mt-4 text-sm text-slate-400">Loading…</div>
          ) : uploads.length === 0 ? (
            <div className="mt-4 text-sm text-slate-400">No uploads yet.</div>
          ) : (
            <ul className="mt-4 space-y-3">
              {uploads.map((u) => (
                <li key={u._id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="font-medium text-slate-100">{u.originalName}</div>
                    <div className="text-xs text-slate-400">
                      {new Date(u.createdAt).toLocaleString()} • {formatBytes(u.size)}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-400">{u.mimeType}</div>
                  <audio controls src={u.url} className="mt-2 w-full" />
                  <div className="mt-2 text-xs text-slate-400">
                    Transcription: <span className="text-slate-300">{u.transcription ?? '(not generated)'}</span>
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
