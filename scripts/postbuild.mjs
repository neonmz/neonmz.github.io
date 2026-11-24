
const scripts = [
    "./postbuild/copy-404.mjs",
    "./postbuild/merge-ec-css.mjs",
    "./postbuild/generate-hash.mjs",
];

for (const script of scripts) {
  await import(script);
}