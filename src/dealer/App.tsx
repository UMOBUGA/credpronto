import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './hooks/useSession'
import LoginPage from './pages/LoginPage'
import ApplicationsListPage from './pages/ApplicationsListPage'
import NewApplicationPage from './pages/NewApplicationPage'
import ApplicationDetailPage from './pages/ApplicationDetailPage'

export default function App() {
  const { data, isLoading } = useSession()

  if (isLoading) return <div className="page-loading">Carregando…</div>

  if (!data?.user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<ApplicationsListPage user={data.user} />} />
      <Route path="/nova" element={<NewApplicationPage />} />
      <Route path="/propostas/:id" element={<ApplicationDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
