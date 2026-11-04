
const scripts = [
    "./postbuild/merge-ec-css.mjs",
    "./postbuild/generate-hash.mjs",
];

for (const script of scripts) {
  await import(script);
}