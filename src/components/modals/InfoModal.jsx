import { useEffect, useState } from 'react'
import useCredentials from '../../hooks/useCredentials'
import getFilePreview from '../../api/getFilePreview'
import getFolderStats from '../../api/getFolderStats'
import { describeS3Error } from '../../api/s3Client'
import { fileCategory } from '../../helpers/mimeGuess'
import { formatBytes, formatDate } from '../../helpers/format'
import { openInNewTab } from '../../helpers/url'
import Modal from './Modal'

function friendlyType(name, rawType) {
  if (rawType === 'folder') return 'Folder'
  if (!name) return 'Other'
  const cat = fileCategory(name)
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}

// Loads presigned/public URLs for a file or size/date stats for a folder, once per opened item.
function useItemDetails(item) {
  const { s3, credentials } = useCredentials()
  const [state, setState] = useState({ loading: true, shareUrl: null, downloadUrl: null, stats: null, error: '' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        if (item.type === 'file') {
          const [share, dl] = await Promise.all([
            getFilePreview(s3, item.key, false, credentials.name, credentials.publicUrl),
            getFilePreview(s3, item.key, true, credentials.name, credentials.publicUrl),
          ])
          if (!cancelled) setState({ loading: false, shareUrl: share, downloadUrl: dl, stats: null, error: '' })
        } else {
          const stats = await getFolderStats(s3, item.key, credentials.name)
          if (!cancelled) setState({ loading: false, shareUrl: null, downloadUrl: null, stats, error: '' })
        }
      } catch (err) {
        if (!cancelled) setState(s => ({ ...s, loading: false, error: describeS3Error(err) }))
      }
    }
    load()
    return () => { cancelled = true }
  }, [item.key, item.type, s3, credentials])

  return state
}

function InfoContent({ onClose, item: baseItem }) {
  const [copiedField, setCopiedField] = useState(null)
  const [copyError, setCopyError] = useState('')
  const { loading: isGenerating, shareUrl, downloadUrl, stats, error } = useItemDetails(baseItem)
  const item = stats
    ? { ...baseItem, size: stats.totalSize, created: stats.earliestLastModified, lastModified: stats.latestLastModified, objectCount: stats.objectCount }
    : baseItem

  async function copy(text, field) {
    try {
      await navigator.clipboard.writeText(text || '')
      setCopyError('')
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1500)
    } catch {
      setCopyError('Could not copy to the clipboard')
    }
  }

  const isFolder = item.type === 'folder'

  return (
    <Modal onClose={onClose} title='Object Details' titleClassName='font-semibold text-xl mb-4 bg-clip-text text-white text-center'>
      <div className='text-xs font-mono text-gray-300 space-y-3'>
        <div>
          <div className='text-gray-400 text-[11px]'>Name</div>
          <div className='text-white break-words'>{item.name}</div>
        </div>
        <div>
          <div className='text-gray-400 text-[11px]'>Path</div>
          <div className='text-white break-words'>{item.key || '-'}</div>
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <div>
            <div className='text-gray-400 text-[11px]'>Type</div>
            <div className='text-white'>{friendlyType(item.name, item.type)}</div>
          </div>
          <div>
            <div className='text-gray-400 text-[11px]'>Size</div>
            <div className='text-white'>{isFolder && isGenerating ? 'Calculating…' : formatBytes(item.size, { decimals: 2 })}</div>
          </div>
        </div>
        {isFolder && typeof item.objectCount === 'number' && (
          <div>
            <div className='text-gray-400 text-[11px]'>Objects</div>
            <div className='text-white'>{item.objectCount}</div>
          </div>
        )}
        {item.lastModified && (
          <div>
            <div className='text-gray-400 text-[11px]'>Last modified</div>
            <div className='text-white'>{formatDate(item.lastModified)}</div>
          </div>
        )}
        <div>
          <div className='text-gray-400 text-[11px]'>Created</div>
          <div className='text-white'>{formatDate(item.created || item.lastModified)}</div>
        </div>

        {error && <div role='alert' className='text-red-400'>{error}</div>}

        {item.type === 'file' && (
          <div className='space-y-2'>
            <div className='text-gray-400 text-[11px]'>URLs</div>
            {isGenerating ? (
              <div className='text-gray-500'>Generating URLs...</div>
            ) : (
              <div className='space-y-2'>
                <div className='flex items-center gap-2'>
                  <input readOnly aria-label='View URL' value={shareUrl || ''} className='flex-1 input px-2 py-1 text-[12px]' />
                  <button type='button' onClick={() => copy(shareUrl, 'share')} className='btn btn-ghost' disabled={!shareUrl}>{copiedField === 'share' ? 'Copied' : 'Copy'}</button>
                  <button type='button' onClick={() => openInNewTab(shareUrl)} className='btn btn-primary' disabled={!shareUrl}>View</button>
                </div>

                <div className='flex items-center gap-2'>
                  <input readOnly aria-label='Download URL' value={downloadUrl || ''} className='flex-1 input px-2 py-1 text-[12px]' />
                  <button type='button' onClick={() => copy(downloadUrl, 'download')} className='btn btn-ghost' disabled={!downloadUrl}>{copiedField === 'download' ? 'Copied' : 'Copy'}</button>
                  <button type='button' onClick={() => openInNewTab(downloadUrl)} className='btn btn-primary' disabled={!downloadUrl}>Download</button>
                </div>
                {copyError && <div role='alert' className='text-red-400'>{copyError}</div>}
              </div>
            )}
          </div>
        )}

        <div className='flex items-center gap-2 pt-3'>
          <button type='button' onClick={onClose} className='btn btn-ghost'>Close</button>
        </div>
      </div>
    </Modal>
  )
}

export default function InfoModal({ isOpen, item, onClose }) {
  if (!isOpen || !item) return null
  return <InfoContent key={item.key} item={item} onClose={onClose} />
}
