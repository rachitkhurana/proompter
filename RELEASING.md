# Releasing

`@rachitkay/proompter` is published to npm from GitHub Actions (`.github/workflows/release.yml`) with npm trusted
publishing: no token is stored anywhere. npm only lets you set that up for a package that already exists, so the
very first publish is manual.

## First publish (0.0.1, once, by hand)

From a clean `main` at the release commit, with Node 22.18 or newer:

```sh
pnpm install --frozen-lockfile
npm login                                          # account rachitkay, with 2FA
npm publish --access public --provenance=false     # prepack builds and strips the private export
```

`--provenance=false` is needed only here: `package.json` asks for provenance, which npm can only create in CI.

Then on npmjs.com, open the package → **Settings** → **Trusted publishing** and add **GitHub Actions** with:

- Repository: `rachitkhurana/proompter`
- Workflow: `release.yml`

## Every release after that

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry. Commit to `main`.
2. Tag and push the tag:

   ```sh
   git tag v0.0.2
   git push origin v0.0.2
   ```

The workflow fails if the tag doesn't match the `package.json` version. Otherwise it runs the checks and
publishes with provenance.
