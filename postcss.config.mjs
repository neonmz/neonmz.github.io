import postcssImport from 'postcss-import';
// import postcssNesting from 'tailwindcss/nesting/index.js';
import tailwindcss from '@tailwindcss/postcss';

export default {
    plugins: {
        'postcss-import': postcssImport,          // to combine multiple css files
        // 'tailwindcss/nesting': postcssNesting,
        '@tailwindcss/postcss': {},
    }
};
