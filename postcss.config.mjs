import postcssImport from 'postcss-import';
import tailwindcss from '@tailwindcss/postcss';
import combineSelectors from 'postcss-combine-duplicated-selectors';

export default {
    plugins: [
        postcssImport(),                         // 合并多个 CSS 文件
        tailwindcss(),                           // Tailwind CSS
        combineSelectors({
            // removeDuplicatedProperties: true,
            removeDuplicatedValues: true,
        }),
    ]
};