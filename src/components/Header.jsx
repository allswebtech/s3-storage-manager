import { useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import useCredentials from '../hooks/useCredentials'
import Brand from './Brand'

export default function Header() {
    const navigate = useNavigate()
    const { credentials, credentialsList, selectedCredentialIndex, setSelectedCredentialIndex, removeAllCredentials } = useCredentials()
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const wrapperRef = useRef(null)

    function handleDisconnect() {
        const n = credentialsList.length
        const msg = n > 1
            ? `Disconnect and remove all ${n} saved credentials from this browser?`
            : 'Disconnect and remove the saved credential from this browser?'
        if (!window.confirm(msg)) return
        removeAllCredentials()
        navigate('/config')
    }

    function handleSelectCredential(idx) {
        setSelectedCredentialIndex(idx)
        setDropdownOpen(false)
        // Open the newly selected bucket in the folder last used there (not the previous bucket's path).
        navigate('/')
    }

    function handleAddCredential() {
        setDropdownOpen(false)
        navigate('/config')
    }

    // Close dropdown on outside click or Escape
    useEffect(() => {
        if (!dropdownOpen) return undefined
        function onDocClick(e) {
            const el = wrapperRef.current
            if (el && !el.contains(e.target)) setDropdownOpen(false)
        }
        function onKey(e) {
            if (e.key === 'Escape') setDropdownOpen(false)
        }
        document.addEventListener('mousedown', onDocClick)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDocClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [dropdownOpen])

    return (
        <div className='bg-[#181818] w-full p-4 border-b border-[#202020] sticky top-0 z-20'>
            <div className='w-full max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3'>
                <Brand />

                <div className='flex items-center gap-2 flex-wrap min-w-0'>
                    <div className='relative' ref={wrapperRef}>
                        <button
                            type='button'
                            className='surface px-3 py-2 flex items-center gap-2 rounded-md select-none cursor-pointer min-w-0 md:min-w-[140px]'
                            onClick={() => setDropdownOpen((v) => !v)}
                            aria-haspopup='listbox'
                            aria-expanded={dropdownOpen}
                            aria-label={`Selected bucket: ${credentials?.name || 'none'}. Switch credential`}
                        >
                            <span className='w-2 h-2 aspect-square rounded-full bg-green-400 animate-pulse' />
                            <span className='text-xs text-gray-300 truncate max-w-[120px] md:max-w-[180px]'>
                                {credentials?.name || 'No Credential'}
                            </span>
                            <svg aria-hidden='true' className='w-3 h-3 text-gray-400 ml-1' fill='none' stroke='currentColor' strokeWidth='2' viewBox='0 0 24 24'>
                                <path strokeLinecap='round' strokeLinejoin='round' d='M19 9l-7 7-7-7' />
                            </svg>
                        </button>
                        {dropdownOpen && (
                            <div role='listbox' aria-label='Saved credentials' className='absolute left-0 mt-1 w-full bg-[#181818] border border-[#202020] rounded-md shadow-lg z-30'>
                                {credentialsList.length > 1 && credentialsList.map((cred, idx) => (
                                    <button
                                        type='button'
                                        role='option'
                                        aria-selected={idx === selectedCredentialIndex}
                                        key={`${cred.endpoint}|${cred.name}|${idx}`}
                                        className={`block w-full text-left px-4 py-2 text-xs cursor-pointer hover:bg-[#232323] ${idx === selectedCredentialIndex ? 'bg-[#232323] text-orange-300' : 'text-gray-300'}`}
                                        onClick={() => handleSelectCredential(idx)}
                                    >
                                        {cred.name}
                                    </button>
                                ))}
                                <div className='border-t border-[#232323]' />
                                <button
                                    type='button'
                                    className='block w-full text-left px-4 py-2 text-xs cursor-pointer hover:bg-[#232323] text-blue-400'
                                    onClick={handleAddCredential}
                                >
                                    + Add Credential
                                </button>
                            </div>
                        )}
                    </div>
                    <button
                        type='button'
                        onClick={() => navigate('/edit-credential')}
                        className='btn btn-blue'
                    >
                        Edit Credential
                    </button>
                    <button type='button' onClick={handleDisconnect} className='btn btn-danger'>
                        Disconnect
                    </button>
                </div>
            </div>
        </div>
    )
}
