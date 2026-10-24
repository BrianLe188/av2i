import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./index.css";
import { App } from "./App.tsx";
import { AuthProvider } from "./auth.tsx";
import { Gate } from "./components/auth/Gate.tsx";
import { usePrefs } from "./prefs.ts";

function Root() {
  const prefs = usePrefs();
  return (
    <AuthProvider>
      <Gate prefs={prefs}>{(user) => <App prefs={prefs} user={user} />}</Gate>
    </AuthProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
