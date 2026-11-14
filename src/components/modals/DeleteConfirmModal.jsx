import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import Modal from './Modal'

function DeleteConfirm({ handleClose, onConfirm, type, name }) {
  const [input, setInput] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const isFolder = type === 'folder'
  const canDelete = !isDeleting && (!isFolder || input === name)

  async function confirm() {
    if (!canDelete) return
    setIsDeleting(true)
    try {
      await onConfirm()
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Modal
      onClose={handleClose}
      busy={isDeleting}
      title={isFolder ? 'Delete Folder' : 'Delete File'}
      titleClassName='font-semibold text-xl mb-6 bg-gradient-to-r from-orange-300 to-red-400 bg-clip-text text-transparent text-center'
    >
      <div className='space-y-3'>
        {isFolder ? (
          <div className='flex flex-col items-start gap-1'>
            <label htmlFor='delete-confirm-input' className='text-sm text-gray-400'>Type folder name to confirm</label>
            <input
              id='delete-confirm-input'
              className='input text-sm w-full'
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirm() }}
              placeholder={`Type '${name}' to confirm`}
              autoFocus
              disabled={isDeleting}
            />
            <span className='mt-1 text-xs text-gray-500'>Folder: <span className='font-mono bg-[#232323] px-2 py-0.5 rounded text-orange-200'>{name}</span></span>
          </div>
        ) : (
          <div className='flex flex-col items-start gap-1'>
            <span className='text-sm text-gray-400'>Are you sure you want to delete this file?</span>
            <span className='font-mono bg-[#232323] px-2 py-0.5 rounded text-orange-200 mt-1 break-all'>{name}</span>
          </div>
        )}
        <div className='flex items-center flex-row-reverse gap-2'>
          <button onClick={handleClose} type='button' className='btn btn-ghost mt-4' disabled={isDeleting}>
            Cancel
          </button>
          <button
            type='button'
            className='btn btn-primary mt-4 disabled:opacity-50'
            disabled={!canDelete}
            autoFocus={!isFolder}
            onClick={confirm}
          >
            {isDeleting ? (
              <span className='inline-flex items-center gap-2'>
                <LoaderCircle size={16} className='animate-spin' />
                Deleting...
              </span>
            ) : (
              'Delete'
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default function DeleteConfirmModal({ isOpen, ...props }) {
  if (!isOpen) return null
  return <DeleteConfirm {...props} />
}
