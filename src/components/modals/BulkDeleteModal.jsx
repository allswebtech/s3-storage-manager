import { useState } from 'react'
import { toast } from 'react-toastify'
import useCredentials from '../../hooks/useCredentials'
import deleteFileOrFolder from '../../api/deleteFileOrFolder'
import { describeS3Error } from '../../api/s3Client'
import Modal from './Modal'

function BulkDelete({ onClose, items = [], onDone }) {
    const { s3, credentials } = useCredentials()
    const [busy, setBusy] = useState(false)
    const [progress, setProgress] = useState(0)
    const [confirmText, setConfirmText] = useState('')
    const confirmed = confirmText.trim().toUpperCase() === 'DELETE'

    async function handleDelete(e) {
        e?.preventDefault()
        if (busy || !confirmed) return
        setBusy(true)
        const failed = []
        let done = 0
        for (const it of items) {
            try {
                await deleteFileOrFolder(s3, it.key, credentials.name)
            } catch (err) {
                failed.push({ item: it, err })
            }
            done += 1
            setProgress(Math.round((done / items.length) * 100))
        }
        setBusy(false)
        if (failed.length) {
            toast.error(`${failed.length} of ${items.length} item(s) could not be deleted. First error (${failed[0].item.name}): ${describeS3Error(failed[0].err)}`, { autoClose: 10000 })
        } else {
            toast.success(`Deleted ${items.length} item(s)`)
        }
        onDone?.({ failed: failed.map(f => f.item.key) })
    }

    return (
        <Modal
            onClose={onClose}
            busy={busy}
            className='w-full max-w-md card p-5'
            title={`Delete ${items.length} item(s)`}
            titleClassName='font-semibold text-xl mb-4 text-red-300'
        >
            <form onSubmit={handleDelete}>
                <p className='text-xs text-gray-400 mb-4'>This action cannot be undone.</p>
                {busy && (
                    <div className='w-full h-2 bg-[#111] rounded mb-3 overflow-hidden' role='progressbar' aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                        <div className='h-2 bg-red-500 transition-all' style={{ width: `${progress}%` }} />
                    </div>
                )}
                {!busy && (
                    <div className='flex flex-col items-start gap-1 mb-4'>
                        <label htmlFor='bulk-delete-confirm' className='text-sm text-gray-400'>
                            Type DELETE to confirm
                        </label>
                        <input
                            id='bulk-delete-confirm'
                            type='text'
                            className='input w-full text-sm'
                            placeholder='DELETE'
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            autoFocus
                        />
                        {confirmText && !confirmed && (
                            <span className='text-[11px] text-red-400'>Confirmation text must be exactly DELETE</span>
                        )}
                    </div>
                )}
                <div className='flex items-center flex-row-reverse gap-2'>
                    <button type='submit' className='btn btn-danger' disabled={busy || !confirmed}>
                        {busy ? 'Deleting…' : 'Delete'}
                    </button>
                    <button type='button' className='btn btn-ghost' onClick={onClose} disabled={busy}>Cancel</button>
                </div>
            </form>
        </Modal>
    )
}

export default function BulkDeleteModal({ isOpen, ...props }) {
    if (!isOpen) return null
    return <BulkDelete {...props} />
}
