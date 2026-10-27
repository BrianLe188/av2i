import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "@xyflow/react/dist/style.css";
import "./index.css";
import { AuthProvider } from "./auth.tsx";
import { Gate } from "./components/auth/Gate.tsx";
import { AppLayout } from "./layouts/AppLayout.tsx";
import { AccountPage } from "./pages/AccountPage.tsx";
import { AuditPage } from "./pages/AuditPage.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { GroupPage } from "./pages/GroupPage.tsx";
import { GroupsPage } from "./pages/GroupsPage.tsx";
import { Guard, NotFound } from "./pages/Guard.tsx";
import { ConnectionPage } from "./pages/ConnectionPage.tsx";
import { ConnectionsPage } from "./pages/ConnectionsPage.tsx";
import { PoliciesPage } from "./pages/PoliciesPage.tsx";
import { PolicyPage } from "./pages/PolicyPage.tsx";
import { ProjectPage } from "./pages/ProjectPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { UsersPage } from "./pages/UsersPage.tsx";
import { PrefsProvider, usePrefs } from "./prefs.ts";

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
                  <Route path="projects" element={<ProjectsPage />} />
                  <Route path="users" element={<Guard action="user:List"><UsersPage /></Guard>} />
                  <Route path="groups" element={<Guard action="group:Manage"><GroupsPage /></Guard>} />
                  <Route path="groups/:id" element={<Guard action="group:Manage"><GroupPage /></Guard>} />
                  <Route path="policies" element={<Guard action="policy:Manage"><PoliciesPage /></Guard>} />
                  <Route path="policies/:name" element={<Guard action="policy:Manage"><PolicyPage /></Guard>} />
                  <Route path="connections" element={<Guard action="connection:Manage"><ConnectionsPage /></Guard>} />
                  <Route path="connections/:id" element={<Guard action="connection:Manage"><ConnectionPage /></Guard>} />
                  <Route path="audit" element={<Guard action="audit:Read"><AuditPage /></Guard>} />
                  <Route path="account" element={<AccountPage />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
                {/* the canvas is a layout of its own: the whole window, no sidebar */}
                <Route path="projects/:id" element={<ProjectPage />} />
                <Route path="designer" element={<Navigate to="/projects" replace />} />
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
