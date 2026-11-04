import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

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