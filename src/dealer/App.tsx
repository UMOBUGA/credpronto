import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './hooks/useSession'
import LoginPage from './pages/LoginPage'
import { DealerLayout } from './components/DealerLayout'
import ApplicationsListPage from './pages/ApplicationsListPage'
import NewApplicationPage from './pages/NewApplicationPage'
import ApplicationDetailPage from './pages/ApplicationDetailPage'
import DealerUsersPage from './pages/DealerUsersPage'
import MetricsPage from './pages/MetricsPage'

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
      <Route element={<DealerLayout user={data.user} />}>
        <Route path="/" element={<ApplicationsListPage />} />
        <Route path="/nova" element={<NewApplicationPage />} />
        <Route path="/propostas/:id" element={<ApplicationDetailPage />} />
        <Route path="/usuarios" element={<DealerUsersPage />} />
        <Route path="/metricas" element={<MetricsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
