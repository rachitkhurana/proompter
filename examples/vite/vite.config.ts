import { proompter } from "@rachitkay/proompter/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The standard Vite React setup plus Proompter. Turn it on with `VITE_PROOMPTER=true vite`.
export default defineConfig({ plugins: [proompter(), react()] });
