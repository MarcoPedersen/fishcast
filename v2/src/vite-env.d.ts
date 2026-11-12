/// <reference types="vite/client" />

/** This build of the app (vite.config.ts `define`); absent in the tests and the model check. */
declare const __FC_BUILD__: string | undefined

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
