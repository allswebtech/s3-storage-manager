import { createContext } from 'react'

export const credentialsContext = createContext({
    s3: null,
    credentials: null,
    credentialsList: [],
    selectedCredentialIndex: 0,
    setSelectedCredentialIndex: () => {},
    addCredential: () => 0,
    updateCredential: () => {},
    removeCredential: () => {},
    removeAllCredentials: () => {},
})
