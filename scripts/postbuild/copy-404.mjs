// scripts/postbuild/copy-404.mjs
// GitHub Pages 只会把 dist/404.html 当作 404 页面，其余路径一律忽略。
// 站点自己的错误页是按 /http/{status}/{lang}/ 生成的，这里把默认语言的那份复制到根目录。
import { copyFile, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const DIST = process.argv[2] || 'dist'
const STATUS = '404'
const SITE_CONFIG = 'src/config.ts'

/** zh_CN / zh-CN / zh CN 视为同一语言，与 SW 的归一化保持一致 */
const norm = (v) => String(v).toLowerCase().replace(/[_\s]+/g, '-')

/** 不引入 TS 配置，直接从源码里读默认语言；读不到就退回 en */
async function readDefaultLang() {
  try {
    const src = await readFile(SITE_CONFIG, 'utf8')
    const m = src.match(/\blang:\s*['"]([^'"]+)['"]/)
    return m ? m[1] : 'en'
  } catch {
    return 'en'
  }
}

const statusDir = join(DIST, 'http', STATUS)
let langs = []
try {
  const entries = await readdir(statusDir, { withFileTypes: true })
  langs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
} catch {
  throw new Error(`[copy-404] 找不到 ${statusDir}，请确认 /http/[...status] 路由已构建`)
}

const lang = await readDefaultLang()
const wanted = norm(lang)

// 优先精确匹配配置里的语言，其次忽略大小写/下划线，再退到 en、zh-cn、字典序第一个
const picked =
  langs.find((d) => d === lang) ||
  langs.find((d) => norm(d) === wanted) ||
  langs.find((d) => norm(d) === 'en') ||
  langs.find((d) => norm(d) === 'zh-cn') ||
  langs.sort()[0]

if (!picked) {
  throw new Error(`[copy-404] ${statusDir} 下没有任何语言目录`)
}

const source = join(statusDir, picked, 'index.html')
try {
  await stat(source)
} catch {
  throw new Error(`[copy-404] 缺少 ${source}`)
}

if (norm(picked) !== wanted) {
  console.warn(`[copy-404] 默认语言 ${lang} 没有对应页面，改用 ${picked}`)
}

await copyFile(source, join(DIST, '404.html'))
console.log(`[copy-404] ${source} → ${join(DIST, '404.html')}`)
