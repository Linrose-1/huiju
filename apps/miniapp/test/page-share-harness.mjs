import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
export function loadPageShare(deps, uni) {
  // uni-app allows several composables/page handlers for one lifecycle.
  for (const name of ['onLoad', 'onShow', 'onHide', 'onUnload']) {
    const register = deps['@dcloudio/uni-app'][name], handlers = []
    deps['@dcloudio/uni-app'][name] = handler => {
      handlers.push(handler)
      if (handlers.length === 1) register((...args) => { for (const callback of handlers) callback(...args) })
    }
  }
  const source = readFileSync(new URL('../src/services/wechat/page-share.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('require', 'exports', 'uni', code)(name => name in deps ? deps[name] : require(name), exports, uni)
  return exports
}
