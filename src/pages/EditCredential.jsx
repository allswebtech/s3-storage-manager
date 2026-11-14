import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useCredentials from '../hooks/useCredentials'
import { toast } from 'react-toastify'
import verifyCredential from '../api/verifyCredential'
import { describeS3Error } from '../api/s3Client'
import { normalizeCredential, validateCredential } from '../helpers/credentials'

function toForm(c) {
	return {
		name: c?.name || '',
		access_key: c?.access_key || '',
		secret_key: c?.secret_key || '',
		region: c?.region || '',
		endpoint: c?.endpoint || '',
		publicUrl: c?.publicUrl || ''
	}
}

const FIELDS = [
	{ name: 'access_key', placeholder: 'Access Key', type: 'text' },
	{ name: 'secret_key', placeholder: 'Secret Key', type: 'password' },
	{ name: 'region', placeholder: 'Region', type: 'text' },
	{ name: 'name', placeholder: 'Bucket Name', type: 'text' },
	{ name: 'endpoint', placeholder: 'Endpoint', type: 'url' },
	{ name: 'publicUrl', placeholder: 'Public Base URL (optional)', type: 'url' },
]

export default function EditCredential() {
	const { credentials, selectedCredentialIndex, updateCredential, removeCredential, credentialsList } = useCredentials()
	// The page is keyed by the selected credential (see App.jsx), so this initial value is always current.
	const [formData, setFormData] = useState(() => toForm(credentials))
	const [errors, setErrors] = useState({})
	const [saving, setSaving] = useState(false)
	const navigate = useNavigate()

	function handleChange(e) {
		const { name, value } = e.target
		setFormData(prev => ({ ...prev, [name]: value }))
		setErrors(prev => {
			if (!prev[name]) return prev
			const next = { ...prev }
			delete next[name]
			return next
		})
	}

	async function handleSubmit(e) {
		e.preventDefault()
		if (saving || !credentials) return
		const candidate = normalizeCredential(formData)
		const fieldErrors = validateCredential(candidate)
		setErrors(fieldErrors)
		if (Object.keys(fieldErrors).length) {
			toast.error('Please fix the highlighted fields')
			return
		}
		setSaving(true)
		try {
			await verifyCredential(candidate)
		} catch (err) {
			toast.error(`Could not connect: ${describeS3Error(err)}`)
			setSaving(false)
			return
		}
		try {
			updateCredential(selectedCredentialIndex, candidate)
			toast.success('Credentials updated!')
			navigate('/')
		} catch {
			toast.error('Failed to update credentials')
		} finally {
			setSaving(false)
		}
	}

	function handleDelete() {
		if (!credentials) return
		if (!window.confirm(`Delete the saved credential for "${credentials.name}" from this browser? This cannot be undone.`)) return
		const remaining = credentialsList.length - 1
		removeCredential(selectedCredentialIndex)
		toast.success('Credential removed')
		navigate(remaining > 0 ? '/' : '/config')
	}

	if (!credentials) return null

	return (
		<div className="w-full min-h-dvh flex items-center justify-center bg-[#101010] text-gray-300">
			<form onSubmit={handleSubmit} className="card p-8 shadow-lg w-full max-w-md flex flex-col gap-4" noValidate>
				<h2 className="text-2xl font-bold mb-2 text-center">Edit Credentials</h2>
				{FIELDS.map(f => (
					<div key={f.name} className="flex flex-col gap-1">
						<input
							className="input"
							name={f.name}
							type={f.type}
							placeholder={f.placeholder}
							aria-label={f.placeholder}
							aria-invalid={Boolean(errors[f.name])}
							autoComplete="off"
							value={formData[f.name]}
							onChange={handleChange}
						/>
						{errors[f.name] && <span role="alert" className="text-[11px] text-red-400">{f.placeholder}: {errors[f.name]}</span>}
					</div>
				))}
				<button type="submit" className="btn btn-primary mt-2" disabled={saving}>{saving ? 'Checking…' : 'Save'}</button>
				<div className="flex items-center gap-2">
					<button type="button" className="text-xs text-gray-400 hover:underline mt-2" onClick={() => navigate('/')}>Cancel</button>
					<button type="button" onClick={handleDelete} className="ml-auto btn btn-danger mt-2" disabled={saving}>Delete</button>
				</div>
			</form>
		</div>
	)
}
