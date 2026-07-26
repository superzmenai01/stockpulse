/// <reference types="vite/client" />

// CSS modules — Vite handles these at runtime but TS strict mode needs explicit declaration
// 大少 2026-07-24 12:48: fix TS errors for all *.module.css imports
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}