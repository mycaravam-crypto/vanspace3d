/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.js'],
    theme: {
        extend: {
            // index.html loads JetBrains Mono for the numeric/dimension text
            // (dims, weights, cog readout); without this, `font-mono` fell
            // back to the browser's generic monospace stack instead.
            fontFamily: {
                mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
            },
        },
    },
    plugins: [],
};
