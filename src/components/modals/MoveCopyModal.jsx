import { useState } from 'react'
import { toast } from 'react-toastify'
import useCredentials from '../../hooks/useCredentials'
import copyObjectOrFolder from '../../api/copyObjectOrFolder'
import moveObjectOrFolder from '../../api/moveObjectOrFolder'
import headObjectExists from '../../api/headObjectExists'
import { describeS3Error } from '../../api/s3Client'
import { numberedKey, resolveDestination, toPrefix } from '../../helpers/keys'
import Modal from './Modal'

const MAX_AUTO_RENAME = 1000

function MoveCopyForm({ onClose, items, mode = 'copy', onDone, currentDirectory = '' }) {
	const { s3, credentials } = useCredentials()
	const [targetPrefix, setTargetPrefix] = useState(() => toPrefix(currentDirectory))
	const [action, setAction] = useState('skip') // skip | replace | rename
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const multi = items.length > 1
	const verb = mode === 'copy' ? 'Copy' : 'Move'

	async function processOne(curItem) {
		const src = curItem.key
		// With several items the destination is always a folder (they cannot all get one file name).
		const finalDest = resolveDestination(curItem, multi ? toPrefix(targetPrefix) : targetPrefix)
		if (finalDest === src) return 'same'
		if (curItem.type === 'folder' && finalDest.startsWith(src)) {
			throw new Error('Destination cannot be inside the source folder')
		}

		let destKey = finalDest
		let overwrite = action === 'replace'
		if (!overwrite && await headObjectExists(s3, finalDest, credentials.name)) {
			if (action === 'skip') return 'skipped'
			let i = 1
			destKey = numberedKey(finalDest, i)
			while (await headObjectExists(s3, destKey, credentials.name)) {
				i++
				if (i > MAX_AUTO_RENAME) throw new Error('Could not find a free name')
				destKey = numberedKey(finalDest, i)
			}
			overwrite = true // just checked that destKey is free
		}

		if (mode === 'copy') await copyObjectOrFolder(s3, src, destKey, credentials.name)
		else await moveObjectOrFolder(s3, src, destKey, credentials.name, { overwrite })
		return 'done'
	}

	async function handleSubmit(e) {
		e.preventDefault()
		if (busy) return
		setBusy(true)
		setError('')
		const counts = { done: 0, skipped: 0, same: 0 }
		const failed = []
		for (const it of items) {
			try {
				counts[await processOne(it)]++
			} catch (err) {
				failed.push({ it, err })
			}
		}
		setBusy(false)

		const summary = [
			counts.done && `${counts.done} ${mode === 'copy' ? 'copied' : 'moved'}`,
			counts.skipped && `${counts.skipped} skipped (already exist)`,
			counts.same && `${counts.same} unchanged (same location)`,
		].filter(Boolean).join(', ')
		if (failed.length) {
			const first = `${failed[0].it.name}: ${failed[0].err?.name === 'DestinationExistsError' ? 'destination already exists' : describeS3Error(failed[0].err)}`
			if (!multi) {
				setError(first)
				onDone?.(counts.done > 0)
				return
			}
			toast.error(`${failed.length} item(s) failed (${first})${summary ? `; ${summary}` : ''}`, { autoClose: 10000 })
		} else if (counts.skipped && !counts.done) {
			toast.warning(summary)
		} else if (summary) {
			toast.success(summary)
		}
		onDone?.(counts.done > 0)
		onClose()
	}

	return (
		<Modal
			onClose={onClose}
			busy={busy}
			title={`${verb} ${multi ? `${items.length} items` : 'Item'}`}
			titleClassName='font-semibold text-xl mb-6 text-white'
		>
			<form onSubmit={handleSubmit} className='space-y-4'>
				{!multi && <p className='text-xs text-gray-400 font-mono break-all'>{items[0].key}</p>}
				<div>
					<label htmlFor='move-copy-destination' className='text-sm text-gray-400'>Destination path or folder</label>
					<input id='move-copy-destination' className='input w-full text-sm' placeholder='e.g. folder/subfolder/ or folder/newname.ext' value={targetPrefix} onChange={e => { setTargetPrefix(e.target.value); setError('') }} autoFocus />
					<span className='text-[11px] text-gray-500'>Leave empty for the bucket root. End with “/” for a folder.</span>
				</div>
				<div>
					<label htmlFor='move-copy-conflict' className='text-sm text-gray-400'>On conflict</label>
					<select id='move-copy-conflict' className='input text-sm' value={action} onChange={e => setAction(e.target.value)}>
						<option value='skip'>Skip</option>
						<option value='replace'>Replace</option>
						<option value='rename'>Auto rename</option>
					</select>
				</div>
				{error && <p role='alert' className='text-[11px] text-red-400 break-words'>{error}</p>}
				<div className='flex items-center flex-row-reverse gap-2'>
					<button type='submit' className='btn btn-primary' disabled={busy}>{busy ? 'Working…' : verb}</button>
					<button type='button' className='btn btn-ghost' onClick={onClose} disabled={busy}>Cancel</button>
				</div>
			</form>
		</Modal>
	)
}

export default function MoveCopyModal({ isOpen, item, items = null, ...props }) {
	const list = Array.isArray(items) && items.length ? items : (item ? [item] : [])
	if (!isOpen || !list.length) return null
	return <MoveCopyForm items={list} {...props} />
}
