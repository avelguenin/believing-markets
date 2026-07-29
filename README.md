# Believing Markets — source code

This is the reviewable source for the model, the interface, and the site. It has
**no build dependencies** — everything is plain JavaScript and runs in Node (for
review) or the browser (for the site). The published `index.html` is a *build
artifact*; the files below are the source of truth.

## File map

| File | What it is | Review priority |
|------|------------|-----------------|
| **`engine_multi.js`** | **The deployed model.** Multi-domain Active-Inference agents, the market, and capital allocation. This is the core to review. | ★★★ |
| `engine.js` | The single-asset EFE variant (whitepaper §6.3): explicit Expected-Free-Energy choice over discrete positions. Referenced by some results (§10.6). | ★★ |
| `ui_multi.js` | The interface: controls, canvas charts, run loop. No model logic. | ★ |
| `index_template.html` | HTML/CSS shell with `%%ENGINE%%` / `%%UI%%` placeholders. | ★ |
| `build.js` | Regenerates `index.html` by inlining the two JS files into the shell. | — |
| `reproduce.js` | Headless harness that prints the whitepaper's key numbers (§10). | ★★ |
| `index.html` | **Build artifact** (do not edit by hand). What GitHub Pages serves. | — |
| `whitepaper.html` | Technical whitepaper (full spec + results + theory). | — |

## Run it (review, no browser needed)

Both engines are pure and seeded (a `mulberry32` PRNG), export a
`{ createModel, step }` API, and run under Node with zero dependencies:

```bash
node reproduce.js     # prints the §10 results table in ~30s — verify the model's behaviour
node build.js         # regenerate index.html from the sources
```

`reproduce.js` is the verifiable counterpart to the whitepaper: read the model in
`engine_multi.js`, then confirm every reported number here. A given
`(seed, parameters)` pair reproduces bit-for-bit.

Minimal manual run:

```js
const M = require('./engine_multi.js');
const m = M.createModel({ nAssets: 3, seed: 5 });
for (let i = 0; i < 1000; i++) M.step(m);
console.log(m.history.at(-1));   // { prices, apprec, capital, cash, leverage, ponzi, ... }
```

## Where to look in `engine_multi.js` (maps to the whitepaper)

- **Generative model** (§4): matrices `A0`, `A1`, `B0` near the top.
- **Belief → caution → loss aversion** (§5): `apprecOf`, and the `caution`/`gammaLoss`
  update inside `step()` (search "emotional memory").
- **Allocation policy** (§6): `assetAppeal`, then the softmax over destinations and
  the exposure/leverage formula in `step()` (search "AIF allocation").
- **Market** (§7): the price-formation block (search "price formation") — demand
  pressure, asymmetric arbitrage (`revAsym`), convex ceiling (`bubbleDrag`).
- **Multi-domain / capital** (§8): `capital[]` accumulation and the `1/K` depth
  scaling in the pressure term.
- **Default parameters** (Table 4): the `Object.assign` block at the top of `createModel`.

## Updating it — and hosting for review

The repository holds **both** the sources and the built `index.html`; GitHub Pages
serves the built file. To change the model:

1. Edit `engine_multi.js` (or `ui_multi.js`, `index_template.html`).
2. Run `node build.js` to regenerate `index.html`.
3. Optionally `node reproduce.js` to check the numbers still hold.
4. Commit the changed source **and** the rebuilt `index.html`.

### Branch / review workflow

Publish from `main`, review on branches:

- **`main`** — the published, stable branch. GitHub Pages is set to deploy from it
  (Settings → Pages → *Deploy from branch* → `main` / root).
- For any change, create a **feature branch** (e.g. `dev` or `review/tune-arbitrage`),
  commit there, and open a **Pull Request** into `main`. Reviewers read and comment
  line-by-line on `engine_multi.js` in the PR diff, and can run `node reproduce.js`
  on the branch to check behaviour. Merging to `main` re-publishes the site.

This keeps the live site stable while review happens on the branch. (GitHub Pages
builds only the one configured branch, so a PR branch isn't auto-previewed; to preview
a branch you can temporarily point Pages at it, or run `index.html` locally.)

### Optional: no-build setup

If you would rather avoid the build step entirely, `index.html` can instead load the
sources as external scripts:

```html
<script src="engine_multi.js"></script>
<script src="ui_multi.js"></script>
```

Then editing a source file updates the live site directly, with no rebuild — at the
cost of `index.html` no longer being a single standalone file (it needs its siblings,
which is fine on GitHub Pages). Ask and this can be switched over.

## License

Free to use, share, and adapt with attribution. Research and teaching model; not
investment advice.

## Reference

Guénin-Carlut, A., & Benazouz, S. (2024). *Modelling the social construction of
preferences in financial economics — Toward an Active Inference reconstruction of
Minskyian macroeconomics.* OSF. https://osf.io/rfsv7/

*Model, interface, and documents implemented by Claude (Anthropic).*
