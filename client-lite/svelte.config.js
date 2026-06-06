import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    kit: {
        // Compile to static files served by the Rust backend's ServeDir.
        adapter: adapter({
            pages: 'build',
            assets: 'build',
            fallback: 'index.html', // SPA fallback for client-side routing
            precompress: false,
            strict: true
        }),
        // The Rust backend serves the client from the root path.
        paths: {
            base: ''
        }
    }
};

export default config;
