/*
 * ZenithTavern Server - your first server plugin. It runs inside SillyTavern's Node server,
 * so it can do things a browser extension can't: read/write files, call other websites
 * with secret keys, run long jobs.
 *
 * SillyTavern calls init(router) once at startup. Every route you add is available at
 *     /api/plugins/mytavern-server/<route>
 * Plugins only load because config.yaml has enableServerPlugins: true (the launcher sets it).
 */

export const info = {
    id: 'mytavern-server',          // lowercase letters, numbers, - and _ only
    name: 'ZenithTavern Server',
    description: 'Starter server plugin for ZenithTavern.',
};

export async function init(router) {
    // GET /api/plugins/mytavern-server/ping
    router.get('/ping', (_request, response) => {
        response.json({ ok: true, message: 'pong', time: new Date().toISOString() });
    });

    // POST /api/plugins/mytavern-server/echo   (JSON body in, same JSON out)
    // From the browser, send headers from SillyTavern.getContext().getRequestHeaders()
    // - they carry the security token POST requests need.
    router.post('/echo', (request, response) => {
        response.json({ ok: true, received: request.body ?? null });
    });

    console.log('[mytavern-server] ready');
}

export async function exit() {
    // Runs when the server shuts down. Close files/timers here if you opened any.
}
