import "maplibre-gl/dist/maplibre-gl.css";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <App />
);
