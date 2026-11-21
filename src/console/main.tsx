import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/globals.css";
import "../styles/themes.css";
import { applyCachedAppearance } from "@/lib/appearance";
import { consoleLang } from "./i18n";
import { ConsoleApp } from "./ConsoleApp";

if (import.meta.env.VITE_MOCK === "1") await import("@/dev/mock");

applyCachedAppearance();
document.documentElement.lang = consoleLang;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConsoleApp />
  </React.StrictMode>,
);
