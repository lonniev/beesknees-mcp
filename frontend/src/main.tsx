import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./tollbooth.ts";
import { TourProvider } from "@tollbooth-dpyc/web/react";
import App from "./App.tsx";
import { TOURS } from "./lib/tour.ts";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      {/* The guided tour's words and names are the site's (lib/tour.ts); the
        * rest — the offer after a quiet while, who sees it — is the package's. */}
      <TourProvider tours={TOURS}>
        <App />
      </TourProvider>
    </BrowserRouter>
  </StrictMode>,
);
