import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import createS3Client from '../api/s3Client'
import { credentialsContext } from './credentialsContext'
import {
    clearAllStoredState,
    credentialId,
    forgetDirectory,
    loadCredentials,
    loadSelectedIndex,
    normalizeCredential,
    saveCredentials,
    saveSelectedIndex,
} from '../helpers/credentials'

function initialState() {
    const { list, invalidCount } = loadCredentials()
    return { list, invalidCount, index: loadSelectedIndex(list.length) }
}

export default function CredentialsProvider({ children }) {
    const [init] = useState(initialState)
    const [credentialsList, setCredentialsList] = useState(init.list)
    const [selectedCredentialIndex, setSelectedIndexState] = useState(init.index)
    const navigate = useNavigate()
    const location = useLocation()
    const warnedRef = useRef(false)

    useEffect(() => {
        if (init.invalidCount > 0 && !warnedRef.current) {
            warnedRef.current = true
            toast.warning(`${init.invalidCount} saved credential(s) are incomplete and were ignored`)
        }
    }, [init.invalidCount])

    // Without a usable credential only the configuration page makes sense.
    useEffect(() => {
        if (!credentialsList.length && location.pathname !== '/config') {
            navigate('/config', { replace: true })
        }
    }, [credentialsList.length, location.pathname, navigate])

    const index = selectedCredentialIndex < credentialsList.length ? selectedCredentialIndex : 0
    const credentials = credentialsList[index] || null

    const s3 = useMemo(() => (credentials ? createS3Client(credentials) : null), [credentials])
    useEffect(() => () => { try { s3?.destroy() } catch { /* ignore */ } }, [s3])

    const setSelectedCredentialIndex = useCallback((i) => {
        setSelectedIndexState(i)
        saveSelectedIndex(i)
    }, [])

    /** Add a credential (or select the identical one already saved). Returns its index. */
    const addCredential = useCallback((cred) => {
        const c = normalizeCredential(cred)
        const existing = credentialsList.findIndex(x => credentialId(x) === credentialId(c) && x.access_key === c.access_key)
        let next
        let idx = existing
        if (existing >= 0) {
            next = credentialsList.map((x, i) => (i === existing ? { ...x, ...c } : x))
        } else {
            next = [...credentialsList, c]
            idx = next.length - 1
        }
        saveCredentials(next)
        setCredentialsList(next)
        setSelectedCredentialIndex(idx)
        return idx
    }, [credentialsList, setSelectedCredentialIndex])

    const updateCredential = useCallback((i, cred) => {
        const c = normalizeCredential(cred)
        const prev = credentialsList[i]
        if (!prev) throw new Error('Credential not found')
        // Spread prev first so fields this version does not know about are kept.
        const merged = { ...prev, ...c }
        if (!cred.publicUrl) delete merged.publicUrl
        const next = credentialsList.map((x, j) => (j === i ? merged : x))
        if (credentialId(prev) !== credentialId(merged)) forgetDirectory(prev)
        saveCredentials(next)
        setCredentialsList(next)
    }, [credentialsList])

    const removeCredential = useCallback((i) => {
        const prev = credentialsList[i]
        if (!prev) return
        const next = credentialsList.filter((_, j) => j !== i)
        forgetDirectory(prev)
        saveCredentials(next)
        setCredentialsList(next)
        const sel = i < index ? index - 1 : (i === index ? 0 : index)
        setSelectedCredentialIndex(Math.max(0, Math.min(sel, next.length - 1)))
    }, [credentialsList, index, setSelectedCredentialIndex])

    const removeAllCredentials = useCallback(() => {
        clearAllStoredState()
        setCredentialsList([])
        setSelectedIndexState(0)
    }, [])

    const value = useMemo(() => ({
        s3,
        credentials,
        credentialsList,
        selectedCredentialIndex: index,
        setSelectedCredentialIndex,
        addCredential,
        updateCredential,
        removeCredential,
        removeAllCredentials,
    }), [s3, credentials, credentialsList, index, setSelectedCredentialIndex, addCredential, updateCredential, removeCredential, removeAllCredentials])

    return (
        <credentialsContext.Provider value={value}>
            {children}
        </credentialsContext.Provider>
    )
}
