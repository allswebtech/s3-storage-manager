import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'

import Home from './pages/Home'
import useCredentials from './hooks/useCredentials'

const ConfigurationForm = lazy(() => import('./pages/ConfigurationForm'))
const EditCredential = lazy(() => import('./pages/EditCredential'))

function PageFallback() {
  return (
    <div className='w-full min-h-dvh flex items-center justify-center bg-[#101010]'>
      <LoaderCircle size={22} className='animate-spin text-yellow-400' aria-label='Loading' />
    </div>
  )
}

function EditCredentialRoute() {
  const { selectedCredentialIndex, credentials } = useCredentials()
  // Remount the form when the selected credential changes so it never shows another credential's values.
  return <EditCredential key={`${selectedCredentialIndex}:${credentials?.endpoint}|${credentials?.name}`} />
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path='/' element={<Home />} />
        <Route path='/config' element={<ConfigurationForm />} />
        <Route path='/edit-credential' element={<EditCredentialRoute />} />
        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
    </Suspense>
  )
}
