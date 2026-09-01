# Vendored React 18 UMD — for the fidelity capture tool only

`capture-bold-fidelity.mjs` renders `prototypes/Console Bold.dc.html` to make the
`proto-*` half of every fidelity pair. That prototype's DC runtime loads the
**React 18** UMD pair from unpkg at runtime, and the capture runs offline, so the
pair is served from here by a Playwright route intercept.

It cannot come from the workspace's own `node_modules`: the app is on React 19,
which dropped the UMD builds entirely.

To refresh:

    npm pack react@18.3.1
    tar xzf react-18.3.1.tgz package/umd/react.production.min.js
    cp package/umd/react.production.min.js e2e/vendor/react.js
    # and the same for react-dom@18.3.1 -> e2e/vendor/react-dom.js

`REACT_UMD_DIR` overrides this directory if you keep the pair elsewhere.

These files are third-party (MIT, Meta) and are not part of the shipped app —
nothing in `apps/` or `packages/` imports them.
