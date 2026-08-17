import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./production/AppErrorBoundary";
import RootApp from "./production/RootApp";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("MOSAIC root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <RootApp />
    </AppErrorBoundary>
  </StrictMode>,
);
