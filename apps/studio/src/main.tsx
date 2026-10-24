import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "@xyflow/react/dist/style.css";
import "./index.css";
import { App } from "./App.tsx";
import { AuthProvider, useUser } from "./auth.tsx";
import { Gate } from "./components/auth/Gate.tsx";
import { AppLayout } from "./layouts/AppLayout.tsx";
import { AccountPage } from "./pages/AccountPage.tsx";
import { AuditPage } from "./pages/AuditPage.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Guard, NotFound } from "./pages/Guard.tsx";
import { UsersPage } from "./pages/UsersPage.tsx";
import { PrefsProvider, usePrefs, usePrefsContext } from "./prefs.ts";

/** The canvas is a layout of its own: the whole window, no sidebar. */
function Designer() {
  return <App prefs={usePrefsContext()} user={useUser()} />;
}

function Root() {
  const prefs = usePrefs();
  return (
    <PrefsProvider prefs={prefs}>
      <AuthProvider>
        <Gate prefs={prefs}>
          {() => (
            <BrowserRouter>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="users" element={<Guard action="user:List"><UsersPage /></Guard>} />
                  <Route path="audit" element={<Guard action="audit:Read"><AuditPage /></Guard>} />
                  <Route path="account" element={<AccountPage />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
                <Route path="designer" element={<Designer />} />
              </Routes>
            </BrowserRouter>
          )}
        </Gate>
      </AuthProvider>
    </PrefsProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
