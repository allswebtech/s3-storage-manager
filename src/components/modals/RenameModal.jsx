import { useState } from 'react'
import { describeS3Error } from '../../api/s3Client'
import { parentPrefix, splitExt, validateName } from '../../helpers/keys'
import Modal from './Modal'

function RenameForm({ handleClose, item, onRename }) {
	const isFolder = item?.type === 'folder'
	const oldName = item?.name || ''
	// Files keep their extension locked; folder names are edited as a whole (a dot is not an extension).
	const [baseName, extension] = isFolder ? [oldName, ''] : splitExt(oldName)
	const [newBaseName, setNewBaseName] = useState(baseName)
	const [isRenaming, setIsRenaming] = useState(false)
	const [error, setError] = useState('')

	async function handleSubmit(e) {
		e.preventDefault()
		if (isRenaming) return
		const newName = newBaseName + extension
		if (newName === oldName) {
			setError('The new name is the same as the current name')
			return
		}
		const msg = validateName(newName, { type: isFolder ? 'folder' : 'file', parent: parentPrefix(item.key) })
		if (msg) {
			setError(msg)
			return
		}
		setIsRenaming(true)
		setError('')
		try {
			await onRename(newName)
		} catch (err) {
			setError(err?.name === 'DestinationExistsError'
				? `A ${isFolder ? 'folder' : 'file'} named "${newName}" already exists here`
				: describeS3Error(err))
			setIsRenaming(false)
		}
	}

	return (
		<Modal
			onClose={handleClose}
			busy={isRenaming}
			title='Rename'
			titleClassName='font-semibold text-xl mb-6 bg-gradient-to-r from-orange-300 to-red-400 bg-clip-text text-transparent'
		>
			<form onSubmit={handleSubmit} className='space-y-3' noValidate>
				<div className='flex flex-col items-start gap-1'>
					<label htmlFor='rename' className='text-sm text-gray-400'>New Name</label>
					<div className='flex w-full'>
						<input
							id='rename'
							type='text'
							name='rename'
							value={newBaseName}
							onChange={e => { setNewBaseName(e.target.value); setError('') }}
							className='input rounded-r-none text-sm flex-1'
							autoFocus
							required
							aria-invalid={Boolean(error)}
							disabled={isRenaming}
						/>
						{extension && (
							<span className='inline-flex items-center px-3 bg-[#232323] border border-l-0 border-[#232323] rounded-r-md text-gray-400 text-sm select-none cursor-not-allowed'>
								{extension}
							</span>
						)}
					</div>
					{error && <span role='alert' className='text-[11px] text-red-400'>{error}</span>}
				</div>
				<div className='flex items-center flex-row-reverse gap-2'>
					<button onClick={handleClose} type='button' className='btn btn-ghost mt-4' disabled={isRenaming}>
						Cancel
					</button>
					<button type='submit' className='btn btn-primary mt-4' disabled={isRenaming}>
						{isRenaming ? 'Renaming...' : 'Rename'}
					</button>
				</div>
			</form>
		</Modal>
	)
}

export default function RenameModal({ isOpen, item, ...props }) {
	if (!isOpen || !item) return null
	return <RenameForm key={item.key} item={item} {...props} />
}
