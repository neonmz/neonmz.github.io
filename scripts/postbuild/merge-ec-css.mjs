// scripts/merge-ec-css.mjs
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const ASTRO_DIR = 'dist/_astro'
const GLOBAL_CSS_PATTERN = /^(global|index|style)\..*\.css$/ // 你的 global chunk 文件名规则
const EC_CSS_PATTERN = /^ec\..*\.css$/

async function main() {
  const files = await readdir(ASTRO_DIR)
  const ecFiles = files.filter((f) => EC_CSS_PATTERN.test(f))
  if (ecFiles.length === 0) {
    // 不能用 process.exit(0)：它会终止整个 postbuild.mjs，后面的脚本也会被跳过
    console.log('[merge-ec] 没找到 ec css，跳过')
    return
  }

  // 1. 读出所有 ec css 内容
  let ecCss = ''
  for (const f of ecFiles) {
    ecCss += await readFile(join(ASTRO_DIR, f), 'utf8')
    ecCss += '\n'
  }

  // 2. 找 global css 并合并
  const globalFiles = files.filter((f) => GLOBAL_CSS_PATTERN.test(f))
  if (globalFiles.length === 0) {
    // 抛错让 postbuild 以非零退出，但不要用 process.exit 硬切
    throw new Error('[merge-ec] 没找到 global css，请检查文件名规则')
  }

  for (const gf of globalFiles) {
    const p = join(ASTRO_DIR, gf)
    const original = await readFile(p, 'utf8')
    // biome-ignore lint/style/useTemplate: <explanation>
    await writeFile(p, original + '\n' + ecCss)
    console.log(`[merge-ec] 已合并进 ${gf}`)
    break
  }

  // 3. 删掉 ec css 文件
  for (const f of ecFiles) {
    await unlink(join(ASTRO_DIR, f))
    console.log(`[merge-ec] 已删除 ${f}`)
  }

  // 4. 遍历 dist 下所有 html，删掉指向 ec css 的 link
  const htmlFiles = []
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.name.endsWith('.html')) htmlFiles.push(full)
    }
  }
  await walk('dist')

  const linkRe = /<link[^>]+href="[^"]*\/_astro\/ec\.[^"]*\.css"[^>]*>/g
  for (const hf of htmlFiles) {
    const html = await readFile(hf, 'utf8')
    const cleaned = html.replace(linkRe, '')
    if (cleaned !== html) {
      await writeFile(hf, cleaned)
      console.log(`[merge-ec] 已清理 link: ${hf}`)
    }
  }

  console.log('[merge-ec] done')
}

await main()
