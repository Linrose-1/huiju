import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import ts from 'typescript'
const source = readFileSync(new URL('../src/services/activity-images.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
new Function('module', 'exports', code)(module, module.exports)
export default module.exports
