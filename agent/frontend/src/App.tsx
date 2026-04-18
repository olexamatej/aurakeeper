import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import Billing from './pages/Billing'
import Settings from './pages/Settings'
import type { ReactNode } from 'react'

function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Layout>
              <Home />
            </Layout>
          }
        />
        <Route
          path="/dashboard"
          element={
            <Layout>
              <Dashboard />
            </Layout>
          }
        />
        <Route
          path="/billing"
          element={
            <Layout>
              <Billing />
            </Layout>
          }
        />
        <Route
          path="/settings"
          element={
            <Layout>
              <Settings />
            </Layout>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
