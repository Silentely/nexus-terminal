// packages/frontend/src/types/splitpanes.d.ts
declare module 'splitpanes' {
  import { DefineComponent } from 'vue';

  const Splitpanes: DefineComponent<any, any, any>;
  const Pane: DefineComponent<any, any, any>;
  export { Splitpanes, Pane };
}
