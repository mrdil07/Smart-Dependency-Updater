# Demo: a breaking dependency upgrade

This is a tiny, self-contained project that reproduces a **real** breaking
change so you can watch Smart Dependency Updater fix it end-to-end.

## The scenario

`src/id.js` generates UUIDs using the **old** `uuid` v3 import style:

```js
const uuidv4 = require('uuid/v4'); // works in uuid@3, REMOVED in uuid@7+
```

In `uuid` v7 the deep import path `uuid/v4` was removed. The supported import is:

```js
const { v4: uuidv4 } = require('uuid');
```

So the moment Dependabot bumps `uuid` from `^3` to `^9`, the build breaks with:

```
Error: Cannot find module 'uuid/v4'
```

…which is exactly the kind of API change this action is built to repair.

## Try it locally

```bash
cd demo
npm install
npm test            # ✅ passes on uuid@3
```

Now simulate the Dependabot bump:

```bash
npm install uuid@9
npm test            # ❌ fails: Cannot find module 'uuid/v4'
```

The fix the bot should produce is a one-line import change in `src/id.js`:

```diff
-const uuidv4 = require('uuid/v4');
+const { v4: uuidv4 } = require('uuid');
```

Apply that and `npm test` passes again on `uuid@9`. 🎉

## Try it on GitHub (full loop)

1. Push this `demo/` folder to a repository as its own project.
2. Copy [`../examples/ci.yml`](../examples/ci.yml) and
   [`../examples/smart-dependency-updater.yml`](../examples/smart-dependency-updater.yml)
   into that repo's `.github/workflows/`.
3. Add an `OPENAI_API_KEY` secret.
4. Enable Dependabot (or open a PR that bumps `uuid` to `9`).
5. Watch CI fail, then watch the bot push the import fix and turn CI green.
