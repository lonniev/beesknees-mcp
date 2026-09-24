import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { configureTollbooth } from "@tollbooth-dpyc/web";
import App from "./App.tsx";
import "./index.css";

// The shared account pieces (profile, session key, avatar) read who this site
// is from here. Keys stay under "beesknees:", so a held key or avatar carries over.
configureTollbooth({
  slug: "beesknees",
  appName: "The Bee's Knees",
  mcpUrl: import.meta.env.VITE_MCP_URL as string,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
