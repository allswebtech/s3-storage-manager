import { useState } from 'react'
import { toast } from 'react-toastify'
import addFolder from '../../api/addFolder'
import { describeS3Error } from '../../api/s3Client'
import useCredentials from '../../hooks/useCredentials'
import { toPrefix, validateName } from '../../helpers/keys'
import Modal from './Modal'

function CreateFolderForm({ handleClose, currentDirectory = '', onCreated }) {
	const { s3, credentials } = useCredentials()
	const [folderName, setFolderName] = useState('')
	const [isCreating, setIsCreating] = useState(false)
	const [error, setError] = useState('')
	const parent = toPrefix(currentDirectory)

	async function handleCreateFolder(event) {
		event.preventDefault()
		if (isCreating) return
		const msg = validateName(folderName, { type: 'folder', parent })
		if (msg) {
			setError(msg)
			return
		}
		setIsCreating(true)
		setError('')
		try {
			const key = await addFolder(s3, `${parent}${folderName}/`, credentials.name)
			toast.success(`Folder "${folderName}" created`)
			onCreated?.(key)
			handleClose()
		} catch (err) {
			setError(describeS3Error(err))
			setIsCreating(false)
		}
	}

	return (
		<Modal
			onClose={handleClose}
			busy={isCreating}
			title='Add Folder'
			titleClassName='font-semibold text-xl mb-6 bg-gradient-to-r from-orange-300 to-red-400 bg-clip-text text-transparent'
		>
			<form onSubmit={handleCreateFolder} className='space-y-3' noValidate>
				<div className='flex flex-col items-start gap-1'>
					<label htmlFor='new-folder-name' className='text-sm text-gray-400'>
						Name
					</label>
					<input
						id='new-folder-name'
						type='text'
						name='name'
						value={folderName}
						onChange={(e) => { setFolderName(e.target.value); setError('') }}
						className='input w-full text-sm'
						placeholder='eg. my folder'
						autoFocus
						required
						aria-invalid={Boolean(error)}
						disabled={isCreating}
					/>
					{error && <span role='alert' className='text-[11px] text-red-400'>{error}</span>}
				</div>

				<div className='flex items-center flex-row-reverse gap-2'>
					<button onClick={handleClose} type='button' className='btn btn-ghost mt-4' disabled={isCreating}>
						Cancel
					</button>

					<button type='submit' className='btn btn-primary mt-4' disabled={isCreating}>
						{isCreating ? 'Creating...' : 'Create'}
					</button>
				</div>
			</form>
		</Modal>
	)
}

export default function CreateFolderModal({ isOpen, ...props }) {
	if (!isOpen) return null
	return <CreateFolderForm {...props} />
}
