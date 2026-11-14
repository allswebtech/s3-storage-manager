import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BrowserRouter } from 'react-router-dom'
import CredentialsProvider from './context/CredentialsProvider.jsx'
import { Bounce, ToastContainer } from 'react-toastify'

// Served at '/' by default or under a sub-path (e.g. GitHub Pages) when built with VITE_BASE_PATH.
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={basename}>
    <CredentialsProvider>
      <App />
      <ToastContainer
        position="top-center"
        autoClose={5000}
        hideProgressBar
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="dark"
        transition={Bounce}
      />
    </CredentialsProvider>
  </BrowserRouter>
)
