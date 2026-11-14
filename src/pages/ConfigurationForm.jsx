import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useCredentials from '../hooks/useCredentials'
import { toast } from 'react-toastify'
import SimpleHeader from '../components/SimpleHeader'
import verifyCredential from '../api/verifyCredential'
import { describeS3Error } from '../api/s3Client'
import { normalizeCredential, validateCredential } from '../helpers/credentials'

const EMPTY_FORM = {
    name: '',
    secret_key: '',
    access_key: '',
    region: '',
    endpoint: '',
    publicUrl: ''
}

// CORS rule the bucket needs for this app. It is scoped to the origin the app is served from;
// "*" would let any website use the bucket's CORS grant from a visitor's browser.
function buildCorsJson(origin) {
    return JSON.stringify([
        {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
            AllowedOrigins: [origin],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3000
        }
    ], null, 4)
}

export default function ConfigurationForm() {

    const [formData, setFormData] = useState(EMPTY_FORM)
    const [errors, setErrors] = useState({})
    const [submitting, setSubmitting] = useState(false)
    const { addCredential, credentialsList } = useCredentials()
    const navigate = useNavigate()
    const [copiedKey, setCopiedKey] = useState(null)
    const [selectedProvider, setSelectedProvider] = useState('aws')
    const [providerSearch, setProviderSearch] = useState('')

    const appOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://your-app.example.com'
    const corsJson = buildCorsJson(appOrigin)

    const r2EndpointTemplate = 'https://<accountid>.r2.cloudflarestorage.com'
    const r2Region = 'auto'

    async function copyText(id, text) {
        try {
            await navigator.clipboard.writeText(text)
            setCopiedKey(id)
            setTimeout(() => setCopiedKey(null), 1500)
        } catch {
            toast.error('Could not copy to the clipboard')
        }
    }

    function applyProviderToForm(providerMeta) {
        setFormData((prev) => ({
            ...prev,
            region: providerMeta.region || prev.region,
            endpoint: providerMeta.endpoint || prev.endpoint
        }))
        toast.success('Applied provider values to form')
    }

    const providers = [
        {
            key: 'aws',
            label: 'AWS S3',
            description: 'Standard S3 buckets with IAM access.',
            endpoint: 'https://s3.amazonaws.com',
            region: 'us-east-1',
            steps: ['Open S3 Console', 'Permissions → CORS', 'Paste the JSON below', 'Ensure required IAM permissions']
        },
        {
            key: 'r2',
            label: 'Cloudflare R2',
            description: 'S3-compatible storage with zero egress to CF.',
            endpoint: r2EndpointTemplate,
            region: r2Region,
            steps: ['Create R2 bucket', 'Generate S3 API credentials', 'Use these values in the form']
        },
        {
            key: 'do',
            label: 'DigitalOcean Spaces',
            description: 'S3-compatible object storage.',
            endpoint: 'https://nyc3.digitaloceanspaces.com',
            region: 'nyc3',
            steps: ['Create Space', 'Use Access/Secret keys', 'Use these values in the form']
        },
        {
            key: 'gcs',
            label: 'Google Cloud Storage',
            description: 'Use Interoperability (HMAC) for S3 API.',
            endpoint: 'https://storage.googleapis.com',
            region: 'us-central1',
            steps: ['Enable HMAC keys (interoperability)', 'Use these values in the form']
        },
        {
            key: 'ibm',
            label: 'IBM Cloud Object Storage',
            description: 'S3-compatible storage.',
            endpoint: 'https://s3.us-south.cloud-object-storage.appdomain.cloud',
            region: 'us-south',
            steps: ['Create bucket', 'Use these values in the form']
        },
        {
            key: 'oracle',
            label: 'Oracle Cloud Object Storage',
            description: 'S3-compatible storage.',
            endpoint: 'https://objectstorage.ap-mumbai-1.oraclecloud.com',
            region: 'ap-mumbai-1',
            steps: ['Create bucket', 'Use these values in the form']
        },
        {
            key: 'scw',
            label: 'Scaleway Elements',
            description: 'S3-compatible storage.',
            endpoint: 'https://s3.fr-par.scw.cloud',
            region: 'fr-par',
            steps: ['Create bucket', 'Use these values in the form']
        },
        {
            key: 'wasabi',
            label: 'Wasabi',
            description: 'Hot cloud storage (S3-compatible).',
            endpoint: 'https://s3.us-east-1.wasabisys.com',
            region: 'us-east-1',
            steps: ['Create bucket', 'Use these values in the form']
        },
        {
            key: 'other',
            label: 'Other',
            description: 'Any S3-compatible provider.',
            endpoint: 'https://s3.provider.com',
            region: 'auto',
            steps: ['Find provider S3 endpoint & region', 'Use these values in the form']
        }
    ]

    function setField(field, value) {
        setFormData(prev => ({ ...prev, [field]: value }))
        setErrors(prev => {
            if (!prev[field]) return prev
            const next = { ...prev }
            delete next[field]
            return next
        })
    }

    async function handleSubmit(event) {
        event.preventDefault()
        if (submitting) return

        const candidate = normalizeCredential(formData)
        const fieldErrors = validateCredential(candidate)
        setErrors(fieldErrors)
        if (Object.keys(fieldErrors).length) {
            toast.error('Please fix the highlighted fields')
            return
        }
        setSubmitting(true)
        try {
            await verifyCredential(candidate)
        } catch (error) {
            // Keep what the user typed so a typo can be fixed without re-entering the keys.
            toast.error(`Could not connect: ${describeS3Error(error)}`)
            setSubmitting(false)
            return
        }
        addCredential(candidate)
        setSubmitting(false)
        toast.success('Connected')
        setFormData(EMPTY_FORM)
        navigate('/')
    }

    function fieldError(field) {
        return errors[field] ? <span id={`${field}-error`} role='alert' className='text-[11px] text-red-400'>{errors[field]}</span> : null
    }

    // Allow opening /config even when credentials exist (used for adding new credentials)

    return (
        <div className='w-full min-h-dvh bg-[#101010] text-gray-300'>
            <SimpleHeader />
            <div className='w-full flex flex-col items-center justify-start py-8 px-4'>
                <div className='w-full max-w-xl card px-5 pb-5 pt-7 shadow-sm'>
                    <h1 className='font-semibold text-xl mb-6 bg-gradient-to-r from-orange-300 to-red-400 bg-clip-text text-transparent'>
                        Enter your S3 Configurations
                    </h1>

                    <form onSubmit={handleSubmit} className='space-y-3' noValidate>
                        
                        <div className='flex flex-col items-start gap-1'>
                            <label htmlFor="access_key" className='text-sm text-gray-400'>
                                Access Key
                            </label>
                            <input
                                id='access_key'
                                type="password"
                                name='access_key'
                                autoComplete='off'
                                aria-invalid={Boolean(errors.access_key)}
                                value={formData.access_key}
                                onChange={(e) => setField('access_key', e.target.value)}
                                className='input w-full text-sm'
                                placeholder='••••••••••••'
                            />
                            {fieldError('access_key')}
                        </div>
                        <div className='flex flex-col items-start gap-1'>
                            <label htmlFor="secret_key" className='text-sm text-gray-400'>
                                Secret Key
                            </label>
                            <input
                                id='secret_key'
                                type="password"
                                name='secret_key'
                                autoComplete='off'
                                aria-invalid={Boolean(errors.secret_key)}
                                value={formData.secret_key}
                                onChange={(e) => setField('secret_key', e.target.value)}
                                className='input w-full text-sm'
                                placeholder='••••••••••••'
                            />
                            {fieldError('secret_key')}
                        </div>
                        <div className='flex flex-col items-start gap-1'>
                            <label htmlFor="region" className='text-sm text-gray-400'>
                                Region
                            </label>
                            <input
                                id='region'
                                type="text"
                                name='region'
                                aria-invalid={Boolean(errors.region)}
                                value={formData.region}
                                onChange={(e) => setField('region', e.target.value)}
                                className='input w-full text-sm'
                                placeholder='eg. eu-north-1'
                            />
                            {fieldError('region')}
                        </div>

                        <div className='flex flex-col items-start gap-1'>
                            <label htmlFor="name" className='text-sm text-gray-400'>
                                Bucket Name
                            </label>
                            <input
                                id='name'
                                type="text"
                                name='name'
                                aria-invalid={Boolean(errors.name)}
                                value={formData.name}
                                onChange={(e) => setField('name', e.target.value)}
                                className='input w-full text-sm'
                                placeholder='eg. bucketname'
                                autoFocus
                            />
                            {fieldError('name')}
                        </div>

                        <div className='flex flex-col items-start gap-1'>
                            <label htmlFor="endpoint" className='text-sm text-gray-400'>
                                Endpoint
                            </label>
                            <input
                                id='endpoint'
                                type="url"
                                name='endpoint'
                                aria-invalid={Boolean(errors.endpoint)}
                                value={formData.endpoint}
                                onChange={(e) => setField('endpoint', e.target.value)}
                                className='input w-full text-sm'
                                placeholder='eg. https://s3.amazonaws.com or https://nyc3.digitaloceanspaces.com'
                            />
                            {fieldError('endpoint')}
                        </div>
                        <div className='flex flex-col items-start gap-1'>
                            <label htmlFor="publicUrl" className='text-sm text-gray-400'>
                                Public Base URL (optional)
                            </label>
                            <input
                                id='publicUrl'
                                type="url"
                                name='publicUrl'
                                aria-invalid={Boolean(errors.publicUrl)}
                                value={formData.publicUrl}
                                onChange={(e) => setField('publicUrl', e.target.value)}
                                className='input w-full text-sm'
                                placeholder='eg. https://cdn.example.com/bucket (no trailing slash)'
                            />
                            {fieldError('publicUrl')}
                            <span className='text-[11px] text-gray-500 mt-1'>If set, View and Preview links use this base instead of signed URLs. Downloads are always signed.</span>
                        </div>
                        <button type='submit' className='btn btn-primary w-full text-sm mt-4' disabled={submitting}>
                            {submitting ? 'Connecting…' : 'Connect'}
                        </button>
                        {credentialsList.length > 0 && (
                            <button type='button' onClick={() => navigate('/')} className='btn btn-ghost w-full text-sm'>
                                Cancel
                            </button>
                        )}
                    </form>
                </div>
                
                <div className='w-full max-w-4xl card p-6 mt-6 shadow-sm'>
                    <div className='mb-4'>
                        <div className='inline-flex items-center gap-2 px-2 py-1 rounded-md bg-[#101010] border border-[#232323] text-[10px] uppercase tracking-wide text-gray-300'>
                            <span>storage setup</span>
                        </div>
                        <h3 className='text-xl font-semibold text-gray-200 mt-2'>Choose a Provider</h3>
                        <p className='text-sm text-gray-400 mt-1'>Pick a provider to see exact values and steps. Apply to form in one click.</p>
                        <div className='mt-4 flex flex-col md:flex-row md:items-center gap-3'>
                            <input
                                type='text'
                                placeholder='Search provider...'
                                value={providerSearch}
                                onChange={(e) => setProviderSearch(e.target.value)}
                                className='input text-sm w-full md:max-w-xs'
                            />
                            <div className='flex gap-2 overflow-x-auto pb-1'>
                                {providers
                                    .filter(p => p.label.toLowerCase().includes(providerSearch.toLowerCase()))
                                    .map(p => (
                                        <button
                                            key={p.key}
                                            onClick={() => setSelectedProvider(p.key)}
                                            className={`px-3 py-1 rounded-md text-xs border ${selectedProvider === p.key ? 'bg-[#ffffff10] border-[#3a3a3a]' : 'bg-[#0f0f0f] border-[#232323]'} text-gray-200 whitespace-nowrap`}
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                            </div>
                        </div>
                    </div>

                    <div className='grid grid-cols-1 gap-6'>
                        <div className='card-2 p-4'>
                            {(() => {
                                const p = providers.find(x => x.key === selectedProvider) || providers[0]
                                return (
                                    <div>
                                        <div className='flex items-start justify-between gap-4'>
                                            <div>
                                                <h4 className='font-semibold text-gray-200'>{p.label}</h4>
                                                <p className='text-xs text-gray-400 mt-1'>{p.description}</p>
                                            </div>
                                            <button onClick={() => applyProviderToForm(p)} className='btn btn-ghost text-xs'>Apply to form</button>
                                        </div>
                                        <div className='grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4'>
                                            <div className='card overflow-hidden'>
                                                <div className='flex items-center justify-between px-3 py-2 border-b border-[#232323]'>
                                                    <span className='text-xs text-gray-400'>Endpoint</span>
                                                    <button onClick={() => copyText(`${p.key}-endpoint`, p.endpoint)} className='btn btn-ghost text-[11px] py-1'>
                                                        {copiedKey === `${p.key}-endpoint` ? '✅ Copied' : '📋 Copy'}
                                                    </button>
                                                </div>
                                                <pre className='text-xs overflow-x-auto p-3 text-gray-200'>
{p.endpoint}
                                                </pre>
                                            </div>
                                            <div className='card overflow-hidden'>
                                                <div className='flex items-center justify-between px-3 py-2 border-b border-[#232323]'>
                                                    <span className='text-xs text-gray-400'>Region</span>
                                                    <button onClick={() => copyText(`${p.key}-region`, p.region)} className='btn btn-ghost text-[11px] py-1'>
                                                        {copiedKey === `${p.key}-region` ? '✅ Copied' : '📋 Copy'}
                                                    </button>
                                                </div>
                                                <pre className='text-xs overflow-x-auto p-3 text-gray-200'>
{p.region}
                                                </pre>
                                            </div>
                                        </div>
                                        <div className='mt-4'>
                                            <h5 className='text-xs text-gray-400 mb-2'>Steps</h5>
                                            <ol className='list-decimal list-inside space-y-1 text-xs text-gray-300'>
                                                {p.steps.map((s, i) => (<li key={i}>{s}</li>))}
                                            </ol>
                                        </div>
                                    </div>
                                )
                            })()}
                        </div>
                        <div className='card-2 p-4'>
                            <div className='flex items-center justify-between px-1'>
                                <span className='text-xs text-gray-400'>CORS Configuration</span>
                                <button onClick={() => copyText(`${selectedProvider}-cors`, corsJson)} className='btn btn-ghost text-[11px] py-1'>
                                    {copiedKey === `${selectedProvider}-cors` ? '✅ Copied' : '📋 Copy'}
                                </button>
                            </div>
                            <pre className='text-xs overflow-x-auto p-3 mt-2 text-gray-200'>
{corsJson}
                            </pre>
                            <p className='text-[11px] text-gray-400 px-1 pt-1'>AllowedOrigins is set to the address this app is served from ({appOrigin}). Avoid "*": it lets any website use this CORS rule from a visitor&apos;s browser. ExposeHeaders must include ETag for multipart uploads.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
