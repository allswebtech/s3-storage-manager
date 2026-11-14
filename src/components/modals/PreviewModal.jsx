import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import useCredentials from '../../hooks/useCredentials'
import getFilePreview from '../../api/getFilePreview'
import { getObjectText, MAX_EDITABLE_BYTES, putTextObject } from '../../api/objectText'
import { describeS3Error } from '../../api/s3Client'
import { extOf, previewMode } from '../../helpers/mimeGuess'
import { safeHttpUrl } from '../../helpers/url'
import Modal from './Modal'

const TEXT_MODES = ['text', 'markdown', 'json', 'csv']
const EDITABLE_MODES = ['text', 'markdown', 'json']

function guessTextContentType(name) {
  const ext = extOf(name)
  if (ext === 'json') return 'application/json; charset=utf-8'
  if (ext === 'md' || ext === 'markdown') return 'text/markdown; charset=utf-8'
  if (ext === 'csv') return 'text/csv; charset=utf-8'
  return 'text/plain; charset=utf-8'
}

function parseCSV(text) {
  const rows = []
  for (const line of (text || '').split(/\r?\n/)) {
    if (line === '') continue
    const cells = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++ } else { inQ = false }
        } else { cur += ch }
      } else if (ch === ',') { cells.push(cur); cur = '' }
      else if (ch === '"') { inQ = true }
      else { cur += ch }
    }
    cells.push(cur)
    rows.push(cells)
  }
  return rows
}

function CSVTable({ text }) {
  const rows = parseCSV(text)
  return (
    <div className='overflow-auto'>
      <table className='min-w-full text-[11px] font-mono border-collapse'>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i === 0 ? 'bg-[#161616]' : ''}>
              {r.map((c, j) => (
                <td key={j} className='border border-[#242424] px-2 py-1 text-gray-200 whitespace-pre'>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * One instance per previewed object (keyed by key in PreviewModal), so no state can leak from a
 * previous file. Text is loaded through the SDK; Save is only possible after a successful load.
 */
function PreviewContent({ onClose, item, onSaved }) {
  const { s3, credentials } = useCredentials()
  const mode = previewMode(item.name || '')
  const isText = TEXT_MODES.includes(mode)
  const canEdit = EDITABLE_MODES.includes(mode)
  const tooLarge = isText && typeof item.size === 'number' && item.size > MAX_EDITABLE_BYTES

  const [url, setUrl] = useState(null)
  const [loaded, setLoaded] = useState(null) // { text, contentType, metadata } after a successful load
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [largeOnServer, setLargeOnServer] = useState(false)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function load() {
      try {
        const viewUrl = await getFilePreview(s3, item.key, false, credentials.name, credentials.publicUrl)
        if (cancelled) return
        setUrl(viewUrl)
        if (isText && !tooLarge) {
          const res = await getObjectText(s3, credentials.name, item.key, { signal: controller.signal })
          if (cancelled) return
          setLoaded(res)
          setBody(res.text)
        }
      } catch (e) {
        if (cancelled) return
        if (e?.name === 'ObjectTooLargeError') setLargeOnServer(true)
        else setError(`Could not load the file: ${describeS3Error(e)}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [s3, credentials, item.key, isText, tooLarge])

  const isLarge = tooLarge || largeOnServer
  const dirty = loaded != null && body !== loaded.text
  const saveVisible = canEdit && loaded != null && !isLarge
  const jsonInvalid = mode === 'json' && loaded != null && (() => { try { JSON.parse(body); return false } catch { return true } })()

  async function handleSave() {
    if (!saveVisible || !dirty || saving) return
    setSaving(true)
    setError(null)
    try {
      await putTextObject(s3, credentials.name, item.key, body, {
        contentType: loaded.contentType || guessTextContentType(item.name),
        preserve: loaded.metadata,
      })
      setLoaded(prev => ({ ...prev, text: body }))
      toast.success(`Saved ${item.name}`)
      onSaved?.(item)
    } catch (e) {
      const msg = `Save failed: ${describeS3Error(e)}`
      setError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  function requestClose() {
    if (saving) return
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    onClose()
  }

  const openUrl = safeHttpUrl(url)
  const largeMessage = 'File too large to open inline. Use Open to view it.'

  return (
    <Modal
      onClose={requestClose}
      busy={saving}
      overlayClassName='bg-[#000]/60'
      className='w-full max-w-4xl h-[80vh] card p-4 flex flex-col'
      labelledBy='preview-title'
    >
      <div className='flex items-center justify-between mb-3 gap-2'>
        <h1 id='preview-title' className='text-sm font-mono text-gray-300 truncate'>Preview: {item.name}</h1>
        <div className='flex items-center gap-2'>
          {saveVisible && (
            <button type='button' className='btn btn-primary' onClick={handleSave} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save'}</button>
          )}
          {openUrl && (
            <a className='btn btn-ghost' href={openUrl} target='_blank' rel='noopener noreferrer'>Open</a>
          )}
          <button type='button' className='btn btn-ghost' onClick={requestClose}>Close</button>
        </div>
      </div>
      {loading ? (
        <div className='flex-1 flex items-center justify-center text-gray-400 text-sm'>Loading…</div>
      ) : error && loaded == null ? (
        <div role='alert' className='text-red-400 text-sm'>{error}</div>
      ) : (
        <div className='flex-1 overflow-auto rounded border border-[#242424] bg-[#0e0e0e] p-3 flex flex-col'>
          {error && <div role='alert' className='text-red-400 text-xs mb-2'>{error}</div>}
          {mode === 'image' && openUrl && (
            <img src={openUrl} alt={item.name} className='max-w-full max-h-full object-contain mx-auto' />
          )}
          {mode === 'video' && openUrl && (
            <video src={openUrl} controls className='w-full h-full max-h-[70vh]' />
          )}
          {mode === 'audio' && openUrl && (
            <audio src={openUrl} controls className='w-full' />
          )}
          {mode === 'pdf' && openUrl && (
            <iframe title='pdf' src={`${openUrl}#toolbar=1&navpanes=0`} className='w-full h-full' />
          )}
          {isText && isLarge && <div className='text-xs text-gray-300'>{largeMessage}</div>}
          {mode === 'csv' && !isLarge && loaded && <CSVTable text={body} />}
          {canEdit && !isLarge && loaded && (
            <>
              {jsonInvalid && <div className='text-[11px] text-yellow-400 mb-1'>Content is not valid JSON.</div>}
              <textarea
                aria-label={`Contents of ${item.name}`}
                value={body}
                onChange={e => setBody(e.target.value)}
                className='w-full flex-1 min-h-[50vh] input p-2 font-mono text-[12px]'
                spellCheck={false}
              />
            </>
          )}
          {mode === 'download' && openUrl && (
            <div className='text-xs text-gray-300'>
              Inline preview not supported for this file. <a className='text-blue-400 underline' href={openUrl} target='_blank' rel='noopener noreferrer'>Open</a> or download.
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

export default function PreviewModal({ isOpen, item, ...props }) {
  if (!isOpen || !item || item.type !== 'file') return null
  return <PreviewContent key={item.key} item={item} {...props} />
}
