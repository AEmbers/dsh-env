/**
 * 浏览器半体的离线校验：把 client.js 当成宿主会下发的那份脚本来跑。
 *
 * client.js 不是模块，是 `window.__ModuleLoader__.load({ id, factory })` 的浏览器脚本；
 * 这里用一个假的 loader 把它接住，再给 factory 一个假的 `require`，最后用假的 cordis ctx
 * 调 `apply()`，把注册进各 slot 的条目打出来并渲染一遍。
 *
 * 两个场景：
 *   A. 现代宿主（0.2.0-rc.2）：`plugins.bundle.config` 在场 → 内联表单优先，本包 row 槽应被撤掉；
 *   B. 0.1.6 线宿主：`plugins.bundle.config` 缺席 → 回退注册 `plugins.row.config` 的 row 子页。
 *
 * 用法： node scripts/verify-client.mjs [client.js 路径]
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = resolve(process.argv[2] ?? resolve(here, '..', 'client.js'))
const requireFrom = createRequire(resolve(here, '..', 'package.json'))

const failures = []
const check = (ok, label, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail === undefined ? '' : ' :: ' + detail}`)
  if (!ok) failures.push(label)
}

/* ---- 假宿主环境：window.__ModuleLoader__ / document ---- */

let captured
globalThis.window = { __ModuleLoader__: { load: (entry) => { captured = entry } } }
globalThis.document = {
  head: { appendChild() {} },
  createElement: () => ({ id: '', textContent: '', isConnected: true, remove() {} }),
  getElementById: () => null,
}

new Function('window', 'document', readFileSync(clientPath, 'utf8'))(globalThis.window, globalThis.document)

const React = requireFrom('react')
const jsxRuntime = requireFrom('react/jsx-runtime')
const { renderToStaticMarkup } = requireFrom('react-dom/server')

/** 用给定的「已声明 slot 集合」跑一次 apply()，返回注册条目。 */
function run(slotsPresent) {
  const mod = captured.factory((id) => {
    if (id === 'react') return React
    if (id === 'react/jsx-runtime') return jsxRuntime
    throw new Error('client.js 请求了未预期的模块: ' + id)
  })
  const registrations = []
  const ctx = {
    // locale 缺席：installI18n 的回调不触发，t 保持中文兜底（老宿主路径）
    inject() {},
    effect: (fn) => { fn(); return () => {} },
    slots: {
      inject: (name, cb) => { if (slotsPresent.includes(name) && typeof cb === 'function') cb() },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  mod.apply(ctx)
  return { mod, registrations }
}

const has = (regs, name, key) => regs.some((r) => r.options.name === name && (key === undefined || (r.options.key ?? r.options.id) === key))

/* ---- 0. 模块外壳 ---- */

check(captured !== undefined, 'client.js 调用了 window.__ModuleLoader__.load')
check(captured.id === 'dsh-env', 'client 模块 id === 包名（宿主据此挂到 Loader 行）', String(captured?.id))

const probe = captured.factory((id) => (id === 'react' ? React : jsxRuntime))
check(Array.isArray(probe.inject) && probe.inject.includes('slots'), 'exports.inject 含 slots')

/* ---- A. 现代宿主 ---- */

const ALL = ['plugins.bundle.config', 'plugins.row.config', 'settings.section', 'settings.kit.item', 'settings.plugin.item']
const a = run(ALL)
console.log('\n[A] 现代宿主（0.2.0-rc.2）注册条目：')
for (const r of a.registrations) console.log(`    - ${r.options.name} ${r.options.id ?? r.options.key ?? ''} ${r.options.order ?? ''}`)

check(has(a.registrations, 'plugins.bundle.config', 'dsh-env'), '[A] plugins.bundle.config key === dsh-env')
check(!has(a.registrations, 'plugins.row.config', 'dsh-env#env-manager'), '[A] 内联位在场时本包 row 槽被撤掉（不会出现两个入口）')

const section = a.registrations.find((r) => r.options.name === 'settings.section')
check(section !== undefined, '[A] 注册了 settings.section（本 fork 自带的设置页）')
check(section?.options.id === 'env-secrets', '[A] settings.section id === env-secrets', String(section?.options.id))
check(section?.options.order === 17, '[A] order === 17（紧随「内置插件」/ kit「插件配置」之后）', String(section?.options.order))
check(typeof section?.options.label === 'function', '[A] settings.section 带 label thunk')
check(section?.options.label?.() === '环境变量 / 密钥管理', '[A] label 解析为中文标题（locale 缺席）', String(section?.options.label?.()))

check(has(a.registrations, 'settings.kit.item', 'env-manager'), '[A] settings.kit.item（装在 kit 页时同一张卡片仍出现）')
check(has(a.registrations, 'settings.plugin.item', 'env-manager'), '[A] settings.plugin.item（≤0.1.5 老宿主回退）')

/* ---- B. 0.1.6 线宿主：bundle.config 缺席 ---- */

const b = run(ALL.filter((s) => s !== 'plugins.bundle.config'))
console.log('\n[B] 0.1.6 线宿主（无 plugins.bundle.config）注册条目：')
for (const r of b.registrations) console.log(`    - ${r.options.name} ${r.options.id ?? r.options.key ?? ''} ${r.options.order ?? ''}`)

check(!has(b.registrations, 'plugins.bundle.config'), '[B] 没有 bundle.config 注册')
check(has(b.registrations, 'plugins.row.config', 'dsh-env#env-manager'), '[B] 回退注册 plugins.row.config key === dsh-env#env-manager')
check(b.registrations.some((r) => r.options.name === 'settings.section'), '[B] 设置页仍然注册（与宿主版本无关）')

/* ---- C. 渲染不炸 ---- */

try {
  const html = renderToStaticMarkup(React.createElement(section.component))
  check(html.includes('env_settingSection'), '[C] 设置页渲染出 env_settingSection')
  check(html.includes('环境变量 / 密钥管理'), '[C] 设置页渲染出中文标题')
  check(html.includes('env_pageHost'), '[C] 内嵌 page 视图表单')
  console.log('  渲染片段：', html.slice(0, 200).replace(/\s+/g, ' '))
} catch (error) {
  check(false, '[C] 设置页渲染', String(error?.message ?? error))
}

console.log('')
if (failures.length > 0) {
  console.error(`✗ ${failures.length} 项未通过`)
  process.exit(1)
}
console.log('✓ 全部通过')
