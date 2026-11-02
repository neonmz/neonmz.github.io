import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { minify } from 'terser';

const swPath = "./src/sw/sw.js";
const dstPath = "./dist/sw.js";


try {
  const code = readFileSync(swPath, 'utf-8');
  const result = await minify(code, {
    compress: {
      drop_console: true,
      drop_debugger: true,
      passes: 2,
    },
    format: {
      comments: false,
    },
  });

  writeFileSync(dstPath, result.code);
  console.log(`${swPath} => ${dstPath}`);
} catch (err) {
  console.error('sw.js build failed:', err);
  process.exit(1);
}

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