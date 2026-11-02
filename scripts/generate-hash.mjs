import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { rollup } from 'rollup';
import terser from '@rollup/plugin-terser'; 

const swPath = "./src/sw/sw.js";
const dstPath = "./dist/sw.js";

async function buildSw() {
  // 1. 让 Rollup 先做死代码消除和常量折叠
  const bundle = await rollup({
    input: swPath,
    output: dstPath,
  });

  // 2. 输出，并顺手交给 Terser 压扁
  await bundle.write({
    file: dstPath,
    format: 'es',
    plugins: [
      terser({
        compress: {
          drop_console: true,
          drop_debugger: true,
          passes: 2,
          toplevel: true, // 让 Terser 配合 Rollup 把顶层也扬了
        },
        mangle: {
          toplevel: true,
        },
        format: {
          comments: false,
        },
      })
    ]
  });
  
  console.log(`${swPath} => ${dstPath}`);
}
await buildSw().catch(console.error);

const distDir = './dist';

// 1. 获取所有路径
const files = readdirSync(distDir, { recursive: true })
  .map(f => f.toString())
  // 2. 过滤掉我们自己生成的 _hash 文件
  .filter(f => f !== '_hash')
  // 3. 核心修复：用 statSync 判断是不是普通文件！
  .filter(f => {
    const fullPath = path.join(distDir, f);
    return statSync(fullPath).isFile(); 
  });

// 4. 后续逻辑不变
const lines = files.map(f => {
  const fullPath = path.join(distDir, f);
  const buf = readFileSync(fullPath);
  const hash = createHash('md5').update(buf).digest('hex').slice(0, 8);
  const cleanPath = '/' + f.split(path.sep).join('/');
  return `${cleanPath} ${hash}`;
});

writeFileSync(path.join(distDir, '_hash'), lines.join('\n'));
console.log(`_hash generated with ${files.length} files.`);