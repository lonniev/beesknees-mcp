import { StrictMode, useMemo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./tollbooth.ts";
import { startLanguage } from "@tollbooth-dpyc/web";
import { TourProvider } from "@tollbooth-dpyc/web/react";
import App from "./App.tsx";
import { tours } from "./lib/tour.ts";
import { useT } from "./i18n/index.ts";
import "./index.css";

// The reader's language: their choice, else their country's, else English. The
// hive draws its own shell, so it starts this itself (the package's AppShell
// would otherwise).
void startLanguage();

/** The tours, in the language on screen: built again when it changes. */
function Tours({ children }: { children: ReactNode }) {
  const t = useT();
  const shown = useMemo(() => tours(t), [t]);
  return <TourProvider tours={shown}>{children}</TourProvider>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      {/* The guided tour's words and names are the site's (lib/tour.ts); the
        * rest — the offer after a quiet while, who sees it — is the package's. */}
      <Tours>
        <App />
      </Tours>
    </BrowserRouter>
  </StrictMode>,
);
