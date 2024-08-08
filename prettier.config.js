/**
 * @see https://prettier.io/docs/en/configuration
 * @type {import("prettier").Config}
 */
export default {
  plugins: ['prettier-plugin-astro', 'prettier-plugin-tailwindcss'],
  overrides: [
    {
      files: '*.astro',
      options: {
        parser: 'astro',
      },
    },
  ],
  printWidth: 150,
  singleQuote: true,
  jsxSingleQuote: true,
  arrowParens: 'avoid',
};